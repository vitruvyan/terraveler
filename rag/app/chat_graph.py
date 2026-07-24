"""The Terraveler chat pipeline as an Axis graph.

A user question runs through four Axis nodes:

    embed_query → retrieve → evaluate → generate

`evaluate` is the point of the whole exercise: it makes an *auditable routing
decision* — are the retrieved sources relevant enough to answer? If not, it
records a motivated Rejection and the answer becomes an honest "the sources do
not tell", instead of a hallucination. Every query yields an immutable
GraphState trace: what was retrieved, what was decided, and what path was NOT
taken and why. That trace is Terraveler's answer-level governance.

Bulk data (vectors, docs, the answer text) rides a side `Bag`; GraphState holds
only the audit.
"""
import json
import urllib.request
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor

from axis import GraphState, Runner, Policy
from axis.state import Fact, Decision, Rejection

RELEVANCE_THRESHOLD = 0.35  # cosine similarity below which we decline to answer

SYSTEM_PROMPT = (
    "You are Antonio Pigafetta, chronicler of great voyages. Answer the user's "
    "question ONLY from the numbered sources below, which come from the ship's "
    "journals and reference works for the voyage in question. Cite the sources "
    "you use inline as [n]. If the answer is not in the sources, say plainly that "
    "the sources do not tell. Reply in the user's language. Be concise, accurate and vivid."
)


def _now():
    return datetime.now(timezone.utc)


class Bag:
    """Side-channel for bulk data (not part of the audit trace)."""
    def __init__(self, question, voyage):
        self.question = question
        self.voyage = voyage
        self.qvec = None
        self.docs = []
        self.top_sim = 0.0
        self.answerable = False
        self.answer = ""


def _embed(embed_url, text):
    req = urllib.request.Request(
        embed_url.rstrip("/") + "/v1/embeddings/create",
        data=json.dumps({"text": text}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["embedding"]


def _openai(api_key, model, question, docs):
    context = "\n\n".join(f"[{i+1}] ({d['title']})\n{d['content']}"
                          for i, d in enumerate(docs))
    body = {"model": model, "temperature": 0.3, "messages": [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Sources:\n{context}\n\nQuestion: {question}"},
    ]}
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)["choices"][0]["message"]["content"]


# ---------------------------------------------------------------- nodes
def embed_query_node(ctx, bag):
    def node(state):
        bag.qvec = _embed(ctx.embed_url, bag.question)
        return state.with_fact(Fact("query_embedded", len(bag.qvec), "embed_query", _now()))
    node.__name__ = "embed_query"
    return node


def retrieve_node(ctx, bag):
    def node(state):
        lit = "[" + ",".join(f"{x:.6f}" for x in bag.qvec) + "]"
        conn = psycopg2.connect(**ctx.pg)
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("select * from match_rag_docs(%s::vector, %s, %s)",
                            (lit, ctx.k, bag.voyage))
                bag.docs = cur.fetchall()
        finally:
            conn.close()
        bag.top_sim = float(bag.docs[0]["similarity"]) if bag.docs else 0.0
        state = state.with_fact(Fact("retrieved", len(bag.docs), "retrieve", _now()))
        state = state.with_fact(Fact("top_similarity", round(bag.top_sim, 4), "retrieve", _now()))
        return state.with_decision(Decision(
            f"Retrieved {len(bag.docs)} docs (top similarity {bag.top_sim:.3f})", _now()))
    node.__name__ = "retrieve"
    return node


def evaluate_node(ctx, bag):
    def node(state):
        if bag.docs and bag.top_sim >= RELEVANCE_THRESHOLD:
            bag.answerable = True
            return state.with_decision(Decision(
                f"Sources sufficient (top {bag.top_sim:.3f} ≥ {RELEVANCE_THRESHOLD}) — will answer", _now()))
        bag.answerable = False
        return state.with_rejection(Rejection(
            "answer from sources",
            f"insufficient relevance (top {bag.top_sim:.3f} < {RELEVANCE_THRESHOLD})", _now()))
    node.__name__ = "evaluate"
    return node


def generate_node(ctx, bag):
    def node(state):
        if bag.answerable:
            bag.answer = _openai(ctx.openai_key, ctx.openai_model, bag.question, bag.docs)
            return state.with_fact(Fact("answered", 1, "generate", _now())) \
                        .with_decision(Decision("Generated grounded answer from sources", _now()))
        bag.answer = ("The sources at hand do not tell of this. Ask me something "
                      "closer to the voyage's journals, and I will answer from them.")
        return state.with_decision(Decision(
            "Declined: answered 'sources do not tell' (no LLM call)", _now()))
    node.__name__ = "generate"
    return node


def run_chat(ctx, question, voyage):
    """Execute the Axis chat graph. Returns (answer, sources, trace_dict, meta)."""
    bag = Bag(question, voyage)
    nodes = [embed_query_node(ctx, bag), retrieve_node(ctx, bag),
             evaluate_node(ctx, bag), generate_node(ctx, bag)]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    trace_id = f"chat-{voyage}-{stamp}"
    state = GraphState.empty(trace_id).with_intent(f"chat:{voyage}")
    runner = Runner(nodes, policy=Policy.STRICT)
    final = runner.run(state)
    sources = [{
        "title": d["title"], "source_url": d["source_url"], "type": d["type"],
        "media_url": d["media_url"], "credit": d["credit"],
    } for d in bag.docs]
    meta = {"trace_id": trace_id, "answerable": bag.answerable,
            "top_similarity": bag.top_sim, "n_sources": len(bag.docs)}
    return bag.answer, sources, final.to_dict(), meta
