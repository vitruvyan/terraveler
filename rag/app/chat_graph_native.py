"""The TerraVeler chat pipeline as a native Motus graph.

The graph keeps all auditable state in Motus. Retrieval and composition are
recorded effects; routing is declared in the GraphSpec rather than hidden in
node-local branching.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
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

RELEVANCE_THRESHOLD = 0.35
_TRANSIENT_PROVIDER_STATUSES = frozenset({408, 409, 429, 500, 502, 503, 504, 529})


class OpenRouterHTTPError(RuntimeError):
    """A safe, classified OpenRouter failure.

    Provider response text is kept for operator logs only. The trace persists
    only status and a provider error type/code, never arbitrary response text.
    """

    def __init__(self, status: int, error_type: str, message: str) -> None:
        self.status = status
        self.error_type = error_type
        self.provider_message = message
        super().__init__(f"OpenRouter HTTP {status} ({error_type}): {message}")


SYSTEM_PROMPT = (
    "You are Antonio Pigafetta, chronicler of great voyages. Answer the user's "
    "question ONLY from the numbered sources below, which come from the ship's "
    "journals and reference works for the voyage in question. Cite the sources "
    "you use inline as [n]. If the answer is not in the sources, say plainly that "
    "the sources do not tell. "
    "Answer in the language the QUESTION is written in, whatever language the "
    "sources happen to be in. "
    "Write plain prose only: no Markdown, no headings, no asterisks, no bullet "
    "lists, no bold. Short paragraphs. "
    "Be concise, accurate and vivid — a few sentences unless more is truly asked for."
)

UNREACHABLE_ANSWER = (
    "The passages are before me — {n} of them, from this voyage's own sources — "
    "but I cannot compose from them at this moment: the hand that writes my "
    "answers is not responding. Nothing is missing from the record. The sources "
    "are listed below; they are the ones I would have quoted."
)

DECLINED_ANSWER = (
    "The sources at hand do not tell of this. Ask me something closer to the "
    "voyage's journals, and I will answer from them."
)


SPEC = GraphSpec.from_dict({
    "schema_version": "1.0.0",
    "name": "terraveler-chat",
    "version": "1.0.0",
    "entry": "retrieve",
    "nodes": [
        {"name": "retrieve", "effect_class": "recorded_effect",
         "reads_declared": ["question", "voyage"],
         "writes_declared": ["n_sources", "top_similarity", "sources", "retrieval"]},
        {"name": "evaluate", "effect_class": "pure",
         "reads_declared": ["top_similarity", "n_sources"],
         "writes_declared": ["answerable", "grounding"]},
        {"name": "answer", "effect_class": "recorded_effect",
         "reads_declared": ["sources", "question"],
         "writes_declared": ["answer", "answered", "failure"]},
        {"name": "decline", "effect_class": "pure",
         "reads_declared": [],
         "writes_declared": ["answer", "answered"]},
    ],
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
    pg: dict[str, Any]
    embed_url: str
    openrouter_key: str
    model: str = "~anthropic/claude-opus-latest"
    k: int = 6
    max_tokens: int = 4000


def _embed(embed_url: str, text: str) -> list[float]:
    req = urllib.request.Request(
        embed_url.rstrip("/") + "/v1/embeddings/create",
        data=json.dumps({"text": text}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["embedding"]


def _provider_error(exc: urllib.error.HTTPError) -> tuple[str, str]:
    """Extract a safe error discriminator plus an operator-facing message."""
    try:
        raw = exc.read().decode("utf-8", "replace")
        payload = json.loads(raw)
    except (OSError, UnicodeError, json.JSONDecodeError):
        return "http_error", str(exc.reason or "request failed")

    error = payload.get("error") if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return "http_error", str(exc.reason or "request failed")

    # OpenRouter is OpenAI-compatible, while its Anthropic-compatible Messages
    # endpoint can expose provider-shaped error metadata. Accept both forms.
    discriminator = error.get("type") or error.get("code") or "http_error"
    message = error.get("message") or exc.reason or "request failed"
    return str(discriminator), str(message)


def _retry_delay(exc: urllib.error.HTTPError, attempt: int) -> float:
    retry_after = exc.headers.get("retry-after") if exc.headers else None
    if retry_after:
        try:
            return min(max(float(retry_after), 0.0), 10.0)
        except ValueError:
            pass
    return float(2 ** attempt)


def _openrouter(cfg: ChatConfig, question: str, sources: list[dict]) -> tuple[str, dict]:
    """Compose through OpenRouter's Anthropic-compatible Messages endpoint."""
    if not cfg.openrouter_key:
        raise RuntimeError("OPENROUTER_API_KEY is not configured")

    context = "\n\n".join(
        f"[{i + 1}] ({d['title']})\n{d['content']}" for i, d in enumerate(sources)
    )
    prompt = (
        f"Sources:\n{context}\n\nQuestion: {question}\n\n"
        "Answer the question above in the SAME LANGUAGE THE QUESTION IS WRITTEN "
        "IN. The sources may be in other languages; that does not change which "
        "language you answer in. Plain prose, no Markdown."
    )
    body = {
        "model": cfg.model,
        "max_tokens": cfg.max_tokens,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
    }

    for attempt in range(3):
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/messages",
            data=json.dumps(body).encode(),
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {cfg.openrouter_key}",
                "http-referer": "https://terraveler.com",
                "x-title": "TerraVeler",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                payload = json.load(r)
            text = "".join(
                part.get("text", "") for part in payload.get("content", [])
                if isinstance(part, dict)
            )
            if not text.strip():
                raise RuntimeError("OpenRouter returned no text content")
            return text, payload
        except urllib.error.HTTPError as exc:
            error_type, message = _provider_error(exc)
            if exc.code in _TRANSIENT_PROVIDER_STATUSES and attempt < 2:
                delay = _retry_delay(exc, attempt)
                print(
                    f"⚠ OpenRouter transient HTTP {exc.code} ({error_type}); "
                    f"retry {attempt + 2}/3 in {delay:g}s"
                )
                time.sleep(delay)
                continue
            raise OpenRouterHTTPError(exc.code, error_type, message) from exc
        except urllib.error.URLError as exc:
            if attempt < 2:
                delay = float(2 ** attempt)
                print(
                    f"⚠ OpenRouter network failure ({type(exc.reason).__name__}); "
                    f"retry {attempt + 2}/3 in {delay:g}s"
                )
                time.sleep(delay)
                continue
            raise

    raise RuntimeError("OpenRouter retry loop exhausted")


def _fingerprint(text: str) -> str:
    return "effect:sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def make_nodes(cfg: ChatConfig) -> dict[str, Any]:
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
                cur.execute(
                    "select * from match_rag_docs(%s::vector, %s, %s)",
                    (lit, cfg.k, voyage),
                )
                rows = [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

        ctx.record_effect(EffectDescriptor(
            effect_class=EffectClass.RECORDED_EFFECT,
            description=f"queried match_rag_docs for voyage {voyage!r}, k={cfg.k}",
        ))

        top = float(rows[0]["similarity"]) if rows else 0.0
        now = ctx.now()
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
        top = state.fact("top_similarity") or 0.0
        n = state.fact("n_sources") or 0
        now = ctx.now()
        answerable = bool(n) and top >= RELEVANCE_THRESHOLD

        state = state.with_decision(Decision(
            "answerable", "yes" if answerable else "no", now,
            reason=(f"top similarity {top:.3f} "
                    f"{'≥' if answerable else '<'} threshold {RELEVANCE_THRESHOLD}"),
        ))

        if answerable:
            return state.with_fact(Fact("grounding", "sources sufficient", "evaluate", now))
        return state.with_rejection(Rejection(
            "answer from sources",
            f"insufficient relevance (top {top:.3f} < {RELEVANCE_THRESHOLD})",
            now,
            evidence={"top_similarity": round(top, 4), "n_sources": n},
        )).with_fact(Fact("grounding", "sources insufficient", "evaluate", now))

    def answer(state: State, ctx) -> State:
        sources = state.fact("sources") or []
        question = state.metadata("question")
        try:
            text, payload = _openrouter(cfg, question, sources)
        except Exception as exc:
            now = ctx.now()
            failure = type(exc).__name__
            evidence = {"n_sources": len(sources), "model": cfg.model,
                        "provider": "openrouter"}
            if isinstance(exc, OpenRouterHTTPError):
                failure = f"OpenRouterHTTP{exc.status}:{exc.error_type}"
                evidence.update({"http_status": exc.status,
                                 "error_type": exc.error_type})

            ctx.record_effect(EffectDescriptor(
                effect_class=EffectClass.RECORDED_EFFECT,
                description=(f"{cfg.model} via OpenRouter was unreachable while "
                             f"composing from {len(sources)} source(s): {failure}"),
                receipt=EffectReceipt(receipt_id=failure, status="unknown"),
            ))
            print(f"⚠ compose failed ({failure}): {exc}")
            return (
                state
                .with_fact(Fact("answer", UNREACHABLE_ANSWER.format(n=len(sources)),
                                "policy", now))
                .with_fact(Fact("answered", False, "answer", now))
                .with_fact(Fact("failure", failure, "answer", now))
                .with_rejection(Rejection(
                    "compose an answer from sufficient sources",
                    f"the writing model was unreachable ({failure})", now,
                    evidence=evidence,
                ))
            )

        now = ctx.now()
        usage = payload.get("usage") or {}
        ctx.record_effect(EffectDescriptor(
            effect_class=EffectClass.RECORDED_EFFECT,
            description=(f"{cfg.model} via OpenRouter answered from {len(sources)} "
                         f"source(s) ({usage.get('input_tokens')} in / "
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


def config_from_env(pg: dict[str, Any]) -> ChatConfig:
    return ChatConfig(
        pg=pg,
        embed_url=os.getenv("EMBED_URL", "http://terraveler_embedding:8010"),
        openrouter_key=os.getenv("OPENROUTER_API_KEY", ""),
        model=os.getenv("OPENROUTER_MODEL", "~anthropic/claude-opus-latest"),
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
    sources = [
        {k: d[k] for k in ("title", "source_url", "type", "media_url", "credit")}
        for d in (result.state.fact("sources") or [])
    ]
    return result.state.fact("answer"), sources, result
