"""Per-run staging: where the ingestion payload lives between nodes.

The Axis pipeline passed a `Corpus` object to every node and the real data
rode it — whole Gutenberg bodies, the chunks cut from them, the vectors. That
is the side channel `node-protocol.md` §1.2 forbids, and Motus offers no
sanctioned place for working memory: everything in `State` becomes trace, and
this payload is 4.9 MB for a voyage like cortes-1519, in 6,721 chunks. A trace
of that size for a run whose evidence is "12 sources loaded, 3 refused, 6,721
chunks embedded" would be almost entirely noise.

**Why the stages were not merged instead.** In the chat graph the answer was
to fuse two nodes so the payload never crossed a boundary. That is wrong here,
and node-protocol §7.2 says why: *an attempt that raised commits nothing.* Fuse
load → chunk → embed → upsert into one node, let the embedding service fail
halfway, and every licence-gate rejection recorded earlier in that node is
structurally erased from the trace. The stages are separate precisely so a
node that finishes hands in what it found; that property is worth a round trip
through Postgres.

So the payload goes where payload goes: storage. Each node reads its input
stage and writes its output stage, records the I/O as an effect, and puts only
counts and decisions in the state. Cost, measured against the run it serves:
the embedding pass makes ~210 network calls for cortes-1519; staging adds
three table scans of the same data. It disappears into the noise.

Rows are keyed by run and deleted when the run's work is promoted, so this
table is scratch space, never a second corpus.
"""
from __future__ import annotations

import json

import psycopg2
from psycopg2.extras import RealDictCursor, execute_values

RAW = "raw"    # a fetched text: title, url, body, licence, work_id
IMG = "img"    # an image doc, already document-shaped -- it never had a body
DOC = "doc"    # one embeddable doc, with its vector once embed has run

DDL = """
create table if not exists ingest_staging (
  run_id   text    not null,
  stage    text    not null check (stage in ('raw','img','doc')),
  idx      int     not null,
  payload  jsonb   not null,
  embedding text,
  primary key (run_id, stage, idx)
);
create index if not exists ingest_staging_run on ingest_staging (run_id, stage);
"""


def connect(cfg):
    return psycopg2.connect(host=cfg.pg_host, port=cfg.pg_port, dbname=cfg.pg_db,
                            user=cfg.pg_user, password=cfg.pg_pass)


def ensure(cfg) -> None:
    conn = connect(cfg)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(DDL)
    finally:
        conn.close()


def put(cfg, run_id: str, stage: str, rows: list[dict],
        embeddings: list[str] | None = None) -> int:
    """Replace this run's rows for one stage. Returns how many landed."""
    if embeddings is not None and len(embeddings) != len(rows):
        raise ValueError("embeddings must line up with rows one for one")
    conn = connect(cfg)
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute("delete from ingest_staging where run_id=%s and stage=%s",
                        (run_id, stage))
            if rows:
                execute_values(cur, """
                    insert into ingest_staging (run_id, stage, idx, payload, embedding)
                    values %s
                """, [(run_id, stage, i, json.dumps(r),
                       embeddings[i] if embeddings is not None else None)
                      for i, r in enumerate(rows)])
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def get(cfg, run_id: str, stage: str) -> list[dict]:
    """This run's rows for one stage, in the order they were written."""
    conn = connect(cfg)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                select payload, embedding from ingest_staging
                where run_id=%s and stage=%s order by idx
            """, (run_id, stage))
            out = []
            for row in cur.fetchall():
                item = dict(row["payload"])
                if row["embedding"] is not None:
                    item["embedding"] = row["embedding"]
                out.append(item)
            return out
    finally:
        conn.close()


def clear(cfg, run_id: str) -> None:
    conn = connect(cfg)
    try:
        with conn, conn.cursor() as cur:
            cur.execute("delete from ingest_staging where run_id=%s", (run_id,))
    finally:
        conn.close()
