"""Terraveler RAG + Chat API — the endpoint Vercel's /api/ask calls.

Two endpoints:
  POST /rag/search  — embed question + pgvector search, return source docs.
  POST /chat        — the full Antonio Pigafetta answer, orchestrated by an
                      Axis graph (embed → retrieve → evaluate → generate). Every
                      call yields an immutable trace persisted to `chat_traces`.

Bearer-token gated. Retrieval + generation both run here on our own infra.
"""
import os
import json
import urllib.request
from types import SimpleNamespace
from typing import List, Optional
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import psycopg2
from psycopg2.extras import RealDictCursor

from app.chat_graph import run_chat

EMBED_URL = os.getenv("EMBED_URL", "http://terraveler_embedding:8010")
TOKEN = os.getenv("RAG_TOKEN", "")
OPENAI_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1")
PG = dict(
    host=os.getenv("PGHOST", "terraveler_postgres"),
    port=int(os.getenv("PGPORT", "5432")),
    dbname=os.getenv("PGDATABASE", "terraveler"),
    user=os.getenv("PGUSER", "terraveler"),
    password=os.getenv("PGPASSWORD", ""),
)
DEFAULT_VOYAGE = "boudeuse-1766"

CHAT_CTX = SimpleNamespace(
    embed_url=EMBED_URL, pg=PG, openai_key=OPENAI_KEY, openai_model=OPENAI_MODEL, k=8)

app = FastAPI(title="Terraveler RAG + Chat API", version="2.0.0")


def _require(authorization: str):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")


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
    return {"status": "healthy" if pg else "degraded", "pg": pg, "openai": bool(OPENAI_KEY)}


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
    if not OPENAI_KEY:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY not configured on the backend")
    voyage = req.voyage or DEFAULT_VOYAGE

    answer, sources, trace, meta = run_chat(CHAT_CTX, req.question, voyage)

    # persist the Axis trace (answer-level governance / audit)
    try:
        conn = psycopg2.connect(**PG)
        with conn, conn.cursor() as cur:
            cur.execute("""
                insert into chat_traces
                  (trace_id, voyage_slug, question, answerable, top_similarity,
                   n_sources, answer, trace)
                values (%s,%s,%s,%s,%s,%s,%s,%s)
            """, (meta["trace_id"], voyage, req.question, meta["answerable"],
                  meta["top_similarity"], meta["n_sources"], answer, json.dumps(trace)))
        conn.close()
    except Exception as e:
        print(f"⚠ could not persist chat trace: {e}")

    return {"answer": answer, "sources": sources, "trace_id": meta["trace_id"]}
