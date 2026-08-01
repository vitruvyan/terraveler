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

import anthropic
import psycopg2
from psycopg2.extras import RealDictCursor

from axis import GraphState, Runner, Policy
from axis.state import Fact, Decision, Rejection

RELEVANCE_THRESHOLD = 0.35  # cosine similarity below which we decline to answer

# Two clauses here are not stylistic and were both written after watching the
# answer land in the actual bubble.
#
#   THE LANGUAGE. "Reply in the user's language" read as a hint about who was
#   being served, and the model took its cue from the sources instead: an
#   English question about Cook's Endeavour came back in Spanish, fluently and
#   entirely wrongly. This corpus is multilingual by construction — Bernal
#   Díaz is Spanish, Pigafetta is Italian, Cook is English — so "the user's
#   language" has to name the QUESTION as the thing it is read from, or the
#   passages win.
#
#   THE MARKDOWN. components/Pigafetta.tsx renders the answer as text in a
#   div; there is no markdown parser behind it and adding one is not the fix.
#   Un-instructed, the model returns headings and **bold**, and the reader gets
#   literal asterisks in a chat bubble on a site whose argument is typography.
#   The prose voice is also the right one here: this is a chronicler speaking,
#   not a report with sections.
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
        # None while nothing has gone wrong. Set to an exception class name
        # when the writing model could not be reached — see generate_node.
        self.failure = None


def _embed(embed_url, text):
    req = urllib.request.Request(
        embed_url.rstrip("/") + "/v1/embeddings/create",
        data=json.dumps({"text": text}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["embedding"]


def _compose(api_key, model, question, docs):
    """Write the answer from the retrieved passages.

    The chronicler wrote through OpenAI until the credit ran out, and the way
    it failed is the reason this function is shaped as it is: `urllib` raised
    an HTTPError, the exception left the graph, and FastAPI turned it into a
    bare 500 — no trace persisted, no decision recorded, a pipeline whose whole
    claim is auditability going silent at exactly the moment there was
    something to audit. The provider moved to Anthropic (the key was already in
    the compose file and unused); the honesty is in generate_node below.

    Sources are numbered here and cited as [n] by the prompt, so a reader can
    walk any sentence back to the passage it came from. Effort stays low and
    thinking stays adaptive: this is composition from passages already in hand,
    not reasoning, and a chat window is waiting.

    THE LANGUAGE RULE IS REPEATED HERE, LAST, AND THAT IS THE POINT. Stated
    only in the system prompt it lost twice to the passages: an English
    question about Cook came back in Spanish, and "Who was Jeanne Barret?" came
    back in French, because the sources that answer her are French and they are
    the nearest thing to the answer. Eight retrieved passages are a great deal
    of text in one language sitting between the instruction and the writing.
    Putting it after the question makes it the last thing read, which is what
    it took — the wording did not change, its position did.
    """
    context = "\n\n".join(f"[{i+1}] ({d['title']})\n{d['content']}"
                          for i, d in enumerate(docs))
    prompt = (
        f"Sources:\n{context}\n\nQuestion: {question}\n\n"
        "Answer the question above in the SAME LANGUAGE THE QUESTION IS WRITTEN "
        "IN. The sources may be in other languages; that does not change which "
        "language you answer in. Plain prose, no Markdown."
    )
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=model,
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        output_config={"effort": "low"},
        messages=[{"role": "user", "content": prompt}],
        timeout=90.0,
    )
    return "".join(b.text for b in msg.content if b.type == "text").strip()


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
    """The last node, and the one that has to distinguish two silences.

    A voyage whose sources do not cover the question, and a chronicler who
    cannot write today, are not the same absence — and for a year this graph
    only knew how to declare the first. The second arrived as a stack trace:
    the LLM call raised, the exception escaped run_chat, and main.py never
    reached the line that persists the trace, so the one failure with an
    external cause left no record at all. The reader was told "the chronicler
    is unavailable", which is true and says nothing, and an operator looking at
    chat_traces saw no row and concluded nothing had happened.

    Both are declared now, in the atlas's own grammar: a Rejection carrying the
    motive, a trace that is written either way, and a sentence to the reader
    that says WHICH silence this is. The sources travel with it — they were
    retrieved successfully and are the same passages the answer would have
    quoted, so a reader who came for the record still gets the record. This is
    the Carta's rule about a burnt archive, applied to our own machinery: an
    absence is stated, never disguised as an answer or as an empty page.
    """
    def node(state):
        if not bag.answerable:
            bag.answer = ("The sources at hand do not tell of this. Ask me something "
                          "closer to the voyage's journals, and I will answer from them.")
            return state.with_decision(Decision(
                "Declined: answered 'sources do not tell' (no LLM call)", _now()))
        try:
            bag.answer = _compose(ctx.anthropic_key, ctx.anthropic_model,
                                  bag.question, bag.docs)
            return state.with_fact(Fact("answered", 1, "generate", _now())) \
                        .with_decision(Decision("Generated grounded answer from sources", _now()))
        except Exception as e:
            # The class, not the text: a message can carry a key or a URL, and
            # this string is persisted to chat_traces and shown to a reader.
            bag.failure = type(e).__name__
            bag.answer = (
                f"The passages are before me — {len(bag.docs)} of them, from this "
                "voyage's own sources — but I cannot compose from them at this "
                "moment: the hand that writes my answers is not responding. "
                "Nothing is missing from the record. The sources are listed "
                "below; they are the ones I would have quoted."
            )
            print(f"⚠ generate failed ({bag.failure}): {e}")
            return state.with_rejection(Rejection(
                "compose an answer from sufficient sources",
                f"the writing model was unreachable ({bag.failure})", _now()))
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
    # `answerable` is the EVIDENCE verdict and keeps its meaning: the sources
    # were sufficient. `failure` is separate and says whether the writing model
    # could be reached. A row with answerable=true and a failure set is the
    # shape an operator wants to be able to count — it is our outage, not a
    # gap in the atlas, and collapsing the two would hide exactly that.
    meta = {"trace_id": trace_id, "answerable": bag.answerable,
            "top_similarity": bag.top_sim, "n_sources": len(bag.docs),
            "failure": bag.failure}
    return bag.answer, sources, final.to_dict(), meta
