"""Terraveler RAG + Chat API — the endpoint Vercel's /api/ask calls.

Two endpoints:
  POST /rag/search  — embed question + pgvector search, return source docs.
  POST /chat        — the full Antonio Pigafetta answer, orchestrated by a
                      native Motus graph (retrieve → evaluate → answer|decline).
                      Every call yields a contract-validatable trace persisted
                      to `chat_traces`.

Bearer-token gated. Retrieval + generation both run here on our own infra.

**The trace shape changed here, deliberately and by decision.** Rows written
before this commit hold the Axis-era legacy shape — six keys, `trace_id` at
the top, no schema version. Rows written after hold a Motus trace document:
`{schema_version, run, records}`, the form `contract/validate.py` accepts.
`guarantees.md` §4 pinned the legacy shape until "Terraveler migrates by
decision, not by surprise"; this is that decision.

The two are self-distinguishing and no migration of old rows is needed: a
Motus document has `schema_version` at the top and a legacy one does not.
Nothing in this repository reads the column programmatically — it is written
here and read by people.
"""
import os
import json
import urllib.request
from typing import List, Optional
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import psycopg2
from psycopg2.extras import RealDictCursor

from vitruvyan_motus import NodeFailed
from app.chat_graph_native import config_from_env, run_chat_native

EMBED_URL = os.getenv("EMBED_URL", "http://terraveler_embedding:8010")
TOKEN = os.getenv("RAG_TOKEN", "")
PG = dict(
    host=os.getenv("PGHOST", "terraveler_postgres"),
    port=int(os.getenv("PGPORT", "5432")),
    dbname=os.getenv("PGDATABASE", "terraveler"),
    user=os.getenv("PGUSER", "terraveler"),
    password=os.getenv("PGPASSWORD", ""),
)
DEFAULT_VOYAGE = "boudeuse-1766"

CHAT_CFG = config_from_env(PG)

app = FastAPI(title="Terraveler RAG + Chat API", version="2.0.0")


def _require(authorization: str):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def _persist(run_id, voyage, question, *, answerable, top_similarity,
             n_sources, answer, trace, what):
    """Write one row to `chat_traces`. Never raises: a run that answered must
    not be turned into a 500 because the audit row would not go down.

    `trace` is a Motus Trace (or None if the run died before producing one).
    `to_json()` is the contract form — the same bytes `contract/validate.py`
    accepts — so a row can be pulled out of the database and checked by
    someone who trusts neither this service nor its author.
    """
    try:
        conn = psycopg2.connect(**PG)
        with conn, conn.cursor() as cur:
            cur.execute("""
                insert into chat_traces
                  (trace_id, voyage_slug, question, answerable, top_similarity,
                   n_sources, answer, trace)
                values (%s,%s,%s,%s,%s,%s,%s,%s)
            """, (run_id, voyage, question, answerable, top_similarity,
                  n_sources, answer,
                  trace.to_json() if trace is not None else None))
        conn.close()
    except Exception as exc:
        print(f"⚠ could not persist {what}: {exc}")


@app.on_event("startup")
def _ensure_trace_table():
    try:
        conn = psycopg2.connect(**PG)
        with conn, conn.cursor() as cur:
            cur.execute("""
                create table if not exists chat_traces (
                  id          bigint generated always as identity primary key,
                  trace_id    text not null,
                  voyage_slug text,
                  question    text,
                  answerable  boolean,
                  top_similarity float,
                  n_sources   int,
                  answer      text,
                  trace       jsonb,
                  created_at  timestamptz default now()
                );
            """)
        conn.close()
    except Exception as e:
        print(f"⚠ chat_traces ensure failed: {e}")


class SearchReq(BaseModel):
    question: str
    voyage: Optional[str] = None
    k: int = 8


class ChatReq(BaseModel):
    question: str
    voyage: Optional[str] = None


def _embed(text: str) -> List[float]:
    req = urllib.request.Request(
        EMBED_URL.rstrip("/") + "/v1/embeddings/create",
        data=json.dumps({"text": text}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["embedding"]


@app.get("/health")
def health():
    try:
        c = psycopg2.connect(**PG)
        c.close()
        pg = True
    except Exception:
        pg = False
    return {"status": "healthy" if pg else "degraded", "pg": pg,
            "model_key": bool(CHAT_CFG.anthropic_key), "model": CHAT_CFG.model}


@app.post("/rag/search")
def search(req: SearchReq, authorization: str = Header(default="")):
    _require(authorization)
    if not req.question or not req.question.strip():
        raise HTTPException(status_code=400, detail="empty question")
    vec = _embed(req.question)
    lit = "[" + ",".join(f"{x:.6f}" for x in vec) + "]"
    conn = psycopg2.connect(**PG)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "select * from match_rag_docs(%s::vector, %s, %s)",
                (lit, req.k, req.voyage))
            rows = cur.fetchall()
    finally:
        conn.close()
    return {"sources": [{
        "title": r["title"], "content": r["content"], "source_url": r["source_url"],
        "type": r["type"], "media_url": r["media_url"], "credit": r["credit"],
        "similarity": float(r["similarity"]),
    } for r in rows]}


@app.post("/chat")
def chat(req: ChatReq, authorization: str = Header(default="")):
    _require(authorization)
    if not req.question or not req.question.strip():
        raise HTTPException(status_code=400, detail="empty question")
    if not CHAT_CFG.anthropic_key:
        raise HTTPException(status_code=503,
                            detail="ANTHROPIC_API_KEY not configured on the backend")
    voyage = req.voyage or DEFAULT_VOYAGE

    run_id = f"chat-{voyage}-{_stamp()}"

    # The graph runs STRICT: a failing node used to burn its own trace and
    # this endpoint 500'd with no audit row — the runs that most needed a
    # record left none. The native NodeFailed carries BOTH the accumulated
    # state and the trace built up to the failure, so what gets persisted
    # now is the real account of the run rather than a state snapshot: which
    # nodes ran, which effects were observed, and where it stopped.
    try:
        answer, sources, result = run_chat_native(
            CHAT_CFG, req.question, voyage, run_id=run_id)
    except NodeFailed as e:
        _persist(run_id, voyage, req.question,
                 answerable=None, top_similarity=None, n_sources=None,
                 answer=None, trace=e.trace, what="failed chat trace")
        raise HTTPException(status_code=500,
                            detail="chat failed — the trace was recorded")

    # Every figure below is read back OUT of the state the run committed,
    # never carried alongside it: the row and the trace cannot disagree.
    state = result.state
    _persist(run_id, voyage, req.question,
             answerable=(state.decision("answerable") == "yes"),
             top_similarity=state.fact("top_similarity"),
             n_sources=state.fact("n_sources"),
             answer=answer, trace=result.trace, what="chat trace")

    return {"answer": answer, "sources": sources, "trace_id": run_id}
