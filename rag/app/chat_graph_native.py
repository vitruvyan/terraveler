"""The Terraveler chat pipeline as a native Motus graph.

The Axis version of this pipeline (``chat_graph.py``) is kept beside it and
still serves. This one exists to answer a question the predecessor could not:
**what does the run look like when the runtime, not the code, decides where
execution goes?**

Three things are deliberately different, and each is the point of an experiment:

1.  **There is no `Bag`.** The Axis graph passes a mutable object to every node
    and the real data rides it — ``bag.answerable = True`` in one node, ``if
    bag.answerable`` in the next. ``node-protocol.md`` §1.2 forbids exactly
    that, and §1.4 forbids the branch inside the node. Everything here flows
    through ``State``, which means everything here is in the trace.

2.  **The branch is a routing record, not an `if`.** ``evaluate`` writes a
    keyed ``Decision`` and the *spec* maps its value onto a node. A reader of
    the trace sees which decision the dispatch observed, which candidates it
    had, and which it took — instead of inferring it from source.

3.  **`embed_query` and `retrieve` are one node.** They were two in the Axis
    graph, and the 768-float query vector had to cross the boundary between
    them. That vector is not evidence of anything — it is working memory — but
    a contract with no side channel would have forced it into the trace. So the
    contract made the seam visible, and the honest fix was to remove the seam:
    embedding is an implementation detail of retrieval, not a step anybody
    audits. What crosses a node boundary here is only what a reader would want
    to see.

The retrieved sources DO stay in the state, at their full length. For
Terraveler that volume is evidence rather than noise: *which sources the
chronicler consulted, and what they actually said*, is precisely the thing the
trace exists to prove.
"""
from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from dataclasses import dataclass
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor

from vitruvyan_motus import (
    Decision,
    EffectDescriptor,
    EffectReceipt,
    Fact,
    GraphSpec,
    Rejection,
    Runtime,
    State,
)
from vitruvyan_motus.effects import EffectClass

RELEVANCE_THRESHOLD = 0.35  # cosine similarity below which we decline to answer

SYSTEM_PROMPT = (
    "You are Antonio Pigafetta, chronicler of great voyages. Answer the user's "
    "question ONLY from the numbered sources below, which come from the ship's "
    "journals and reference works for the voyage in question. Cite the sources "
    "you use inline as [n]. If the answer is not in the sources, say plainly that "
    "the sources do not tell. Reply in the user's language. Be concise, accurate and vivid."
)

DECLINED_ANSWER = (
    "The sources at hand do not tell of this. Ask me something closer to the "
    "voyage's journals, and I will answer from them."
)


# ---------------------------------------------------------------- the spec

SPEC = GraphSpec.from_dict({
    "schema_version": "1.0.0",
    "name": "terraveler-chat",
    "version": "1.0.0",
    "entry": "retrieve",
    "nodes": [
        # recorded_effect: it reads the outside world (the embedding service
        # and the corpus) and the *results* are the effect. It mutates nothing.
        # Declaring reads is optional — but declaring SOME means declaring all:
        # the runtime holds a node to whatever list it gives. Reading a
        # metadata key counts as a read of that key (node-protocol §3.2), which
        # is how `question` and `voyage` come to be listed here.
        {"name": "retrieve", "effect_class": "recorded_effect",
         "reads_declared": ["question", "voyage"],
         "writes_declared": ["n_sources", "top_similarity", "sources", "retrieval"]},
        # pure: it reads what retrieve wrote and decides. Nothing outside.
        # A pure node may still draw the clock through ctx (node-protocol §6.1).
        {"name": "evaluate", "effect_class": "pure",
         "reads_declared": ["top_similarity", "n_sources"],
         "writes_declared": ["answerable", "grounding"]},
        {"name": "answer", "effect_class": "recorded_effect",
         "reads_declared": ["sources", "question"],
         "writes_declared": ["answer", "answered"]},
        {"name": "decline", "effect_class": "pure",
         "reads_declared": [],
         "writes_declared": ["answer", "answered"]},
    ],
    # The whole argument of the port is in these four lines: the branch lives
    # in the spec, keyed to a decision a node recorded, so the trace carries a
    # routing record naming the exact Decision the dispatch observed.
    "transitions": {
        "retrieve": {"kind": "next", "to": "evaluate"},
        "evaluate": {
            "kind": "route",
            "on": "answerable",
            "map": {"yes": "answer", "no": "decline"},
            "default": "decline",
        },
        "answer": {"kind": "terminal"},
        "decline": {"kind": "terminal"},
    },
})


@dataclass(frozen=True)
class ChatConfig:
    """Deployment configuration, read-only and shared.

    This is NOT the `Bag` in disguise: nothing here is ever written by a node,
    and no information passes between nodes through it. It is the connection
    string and the model name — the sort of thing §1.2 was never about.
    """
    pg: dict[str, Any]
    embed_url: str
    anthropic_key: str
    model: str = "claude-sonnet-5"
    k: int = 6
    max_tokens: int = 1024


# ---------------------------------------------------------------- adapters

def _embed(embed_url: str, text: str) -> list[float]:
    req = urllib.request.Request(
        embed_url.rstrip("/") + "/v1/embeddings/create",
        data=json.dumps({"text": text}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["embedding"]


def _anthropic(cfg: ChatConfig, question: str, sources: list[dict]) -> tuple[str, dict]:
    context = "\n\n".join(
        f"[{i + 1}] ({d['title']})\n{d['content']}" for i, d in enumerate(sources)
    )
    body = {
        "model": cfg.model,
        "max_tokens": cfg.max_tokens,
        "system": SYSTEM_PROMPT,
        "messages": [
            {"role": "user", "content": f"Sources:\n{context}\n\nQuestion: {question}"}
        ],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode(),
        headers={
            "content-type": "application/json",
            "x-api-key": cfg.anthropic_key,
            "anthropic-version": "2023-06-01",
        })
    with urllib.request.urlopen(req, timeout=120) as r:
        payload = json.load(r)
    text = "".join(part.get("text", "") for part in payload.get("content", []))
    return text, payload


def _fingerprint(text: str) -> str:
    return "effect:sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- the nodes

def make_nodes(cfg: ChatConfig) -> dict[str, Any]:
    """Build the node table. The closure carries configuration only."""

    def retrieve(state: State, ctx) -> State:
        question = state.metadata("question")
        voyage = state.metadata("voyage")

        qvec = _embed(cfg.embed_url, question)
        ctx.record_effect(EffectDescriptor(
            effect_class=EffectClass.RECORDED_EFFECT,
            description=f"embedded the question ({len(qvec)}-d) via {cfg.embed_url}",
        ))

        lit = "[" + ",".join(f"{x:.6f}" for x in qvec) + "]"
        conn = psycopg2.connect(**cfg.pg)
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("select * from match_rag_docs(%s::vector, %s, %s)",
                            (lit, cfg.k, voyage))
                rows = [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()
        ctx.record_effect(EffectDescriptor(
            effect_class=EffectClass.RECORDED_EFFECT,
            description=f"queried match_rag_docs for voyage {voyage!r}, k={cfg.k}",
        ))

        top = float(rows[0]["similarity"]) if rows else 0.0
        now = ctx.now()

        # Sources go in whole: for this project, what the chronicler read is
        # the evidence. Similarity is rounded because a float's last digits
        # are noise, not testimony.
        sources = [{
            "title": r["title"],
            "source_url": r["source_url"],
            "type": r["type"],
            "media_url": r["media_url"],
            "credit": r["credit"],
            "content": r["content"],
            "similarity": round(float(r["similarity"]), 4),
        } for r in rows]

        return (
            state
            .with_fact(Fact("n_sources", len(sources), "retrieve", now))
            .with_fact(Fact("top_similarity", round(top, 4), "retrieve", now))
            .with_fact(Fact("sources", sources, "retrieve", now))
            .with_decision(Decision(
                "retrieval", "hit" if sources else "empty", now,
                reason=f"{len(sources)} source(s), top similarity {top:.3f}"))
        )

    def evaluate(state: State, ctx) -> State:
        """The node the whole pipeline exists for, and now a pure one.

        It reads two facts and writes one decision. The runtime routes on that
        decision; this function does not know, and must not know, which node
        runs next.
        """
        top = state.fact("top_similarity") or 0.0
        n = state.fact("n_sources") or 0
        now = ctx.now()
        answerable = bool(n) and top >= RELEVANCE_THRESHOLD

        state = state.with_decision(Decision(
            "answerable", "yes" if answerable else "no", now,
            reason=(f"top similarity {top:.3f} "
                    f"{'≥' if answerable else '<'} threshold {RELEVANCE_THRESHOLD}")))

        if answerable:
            return state.with_fact(Fact("grounding", "sources sufficient", "evaluate", now))
        # A refusal is recorded as a refusal, not merely as an absence.
        return state.with_rejection(Rejection(
            "answer from sources",
            f"insufficient relevance (top {top:.3f} < {RELEVANCE_THRESHOLD})",
            now,
            evidence={"top_similarity": round(top, 4), "n_sources": n},
        )).with_fact(Fact("grounding", "sources insufficient", "evaluate", now))

    def answer(state: State, ctx) -> State:
        sources = state.fact("sources") or []
        question = state.metadata("question")
        text, payload = _anthropic(cfg, question, sources)
        now = ctx.now()

        usage = payload.get("usage") or {}
        ctx.record_effect(EffectDescriptor(
            effect_class=EffectClass.RECORDED_EFFECT,
            description=(f"{cfg.model} answered from {len(sources)} source(s) "
                         f"({usage.get('input_tokens')} in / "
                         f"{usage.get('output_tokens')} out)"),
            receipt=EffectReceipt(
                receipt_id=payload.get("id") or "unknown",
                status="completed",
                result_fingerprint=_fingerprint(text),
            ),
        ))
        return (
            state
            .with_fact(Fact("answer", text, cfg.model, now))
            .with_fact(Fact("answered", True, "answer", now))
        )

    def decline(state: State, ctx) -> State:
        now = ctx.now()
        return (
            state
            .with_fact(Fact("answer", DECLINED_ANSWER, "policy", now))
            .with_fact(Fact("answered", False, "decline", now))
        )

    return {"retrieve": retrieve, "evaluate": evaluate,
            "answer": answer, "decline": decline}


# ---------------------------------------------------------------- run it

def config_from_env(pg: dict[str, Any]) -> ChatConfig:
    return ChatConfig(
        pg=pg,
        embed_url=os.getenv("EMBED_URL", "http://terraveler_embedding:8010"),
        anthropic_key=os.getenv("ANTHROPIC_API_KEY", ""),
        model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5"),
        k=int(os.getenv("RAG_K", "6")),
    )


def run_chat_native(cfg: ChatConfig, question: str, voyage: str, *,
                    run_id: str | None = None, sink=None):
    """Execute the chat graph on Motus. Returns (answer, sources, result)."""
    runtime = Runtime(SPEC, make_nodes(cfg), sink=sink)
    result = runtime.run(
        State.empty(f"chat:{voyage}", metadata={"question": question, "voyage": voyage}),
        run_id=run_id,
    )
    sources = [{k: d[k] for k in ("title", "source_url", "type", "media_url", "credit")}
               for d in (result.state.fact("sources") or [])]
    return result.state.fact("answer"), sources, result
