#!/usr/bin/env python3
"""Embed Terraveler's own how-to-use-the-site documentation into rag_docs.

    python3 scripts/embed_site_help.py
    python3 scripts/embed_site_help.py --dry-run

Why this exists
----------------
Pigafetta (`rag/app/chat_graph_native.py`) only ever answered from a voyage's
own journals and reference works — a question like "how do I contribute a
voyage" got the same "the sources do not tell" as an unanswerable historical
one, because nothing about using the site itself had ever been embedded.
`chat_graph_native.py`'s `retrieve()` now also asks `match_rag_docs(...)` for
`type = 'help'` chunks independent of voyage (`supabase/rag_docs_help_type.sql`
added the type); this script is what actually puts them there.

What it embeds, and what it deliberately does not
---------------------------------------------------
The site's own existing, human-written documentation about using
Terraveler — not new copy invented for this: `README.md` (what the site is,
evidence tiers, notebooks), `docs/HOW_IT_WORKS.md` (the waypoint life cycle,
how humans and agents each contribute), `MAGNA_CARTA.md` (the governing
rules a "why does review work this way" question would actually be answered
by). Not `AGENTS.md`/`SKILLS.md`/deploy runbooks — those are for the people
and agents who build Terraveler, not the people and agents who use it.

Idempotent by construction, the same way `embed_published.py` is: every row
this script owns is marked `voyage_slug = '_site_help'`, `type = 'help'`, so
a re-run replaces its own prior chunks rather than accumulating duplicates.
Nothing else in `rag_docs` carries that voyage_slug, so this can never
collide with or delete a real voyage's content.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

import psycopg2
import psycopg2.extras

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ingest"))

from fetch import chunk  # noqa: E402

EMBED_URL = os.environ.get("EMBED_URL", "http://terraveler_embedding:8010")
LICENSE = "CC BY-SA"
BATCH = 16
SITE_HELP_SLUG = "_site_help"
# Same sentinel app/about/page.tsx splits README.md on: everything after it is
# developer documentation (deploy runbooks, internal env vars, `lib/cimd.ts`),
# never shown to an end user on /about and just as wrong for Pigafetta to cite
# at one.
README_SENTINEL = "<!-- ABOUT-PAGE-ENDS"

# (source_url shown to the reader, title prefix, file relative to repo root)
DOCS = [
    ("/about", "About Terraveler", ROOT / "README.md"),
    ("/how-it-works", "How Terraveler works", ROOT / "docs" / "HOW_IT_WORKS.md"),
    ("/magna-carta", "Magna Carta of the Seas", ROOT / "MAGNA_CARTA.md"),
]


def pg_params() -> dict:
    return {
        "host": os.environ.get("PGHOST", "127.0.0.1"),
        "port": int(os.environ.get("PGPORT", "6000")),
        "dbname": os.environ.get("PGDATABASE", "terraveler"),
        "user": os.environ.get("PGUSER", "terraveler"),
        "password": os.environ.get("PGPASSWORD", ""),
    }


def _post_json(url: str, body: dict, timeout: int = 180) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _emb_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


def help_docs() -> list[dict]:
    docs = []
    for source_url, title, path in DOCS:
        text = path.read_text(encoding="utf-8")
        if path.name == "README.md":
            text = text.split(README_SENTINEL)[0]
        for i, piece in enumerate(chunk(text)):
            docs.append({
                "voyage_slug": SITE_HELP_SLUG, "type": "help",
                "title": f"{title} [{i}]", "content": piece,
                "source_url": source_url, "license": LICENSE,
                "credit": None, "media_url": None, "chunk_index": i,
            })
    return docs


def embed(docs: list[dict]) -> list[dict]:
    out = []
    for start in range(0, len(docs), BATCH):
        batch = docs[start:start + BATCH]
        texts = [d["content"] for d in batch]
        resp = _post_json(f"{EMBED_URL.rstrip('/')}/v1/embeddings/batch", {"texts": texts})
        if not resp.get("success"):
            raise RuntimeError(resp.get("error") or "embed returned success=false")
        vecs = resp["embeddings"]
        if len(vecs) != len(batch):
            raise RuntimeError(f"count mismatch {len(vecs)} != {len(batch)}")
        out.extend({**d, "embedding": _emb_literal(v)} for d, v in zip(batch, vecs))
    return out


def upsert(conn, rows: list[dict], dry_run: bool) -> None:
    if dry_run:
        print(f"DRY RUN: would replace all {SITE_HELP_SLUG!r} rag_docs with {len(rows)} row(s) "
              f"— nothing written")
        for r in rows:
            print(f"  [{r['title']}] {r['content'][:80]!r}")
        return
    with conn, conn.cursor() as cur:
        cur.execute("delete from rag_docs where voyage_slug = %s", (SITE_HELP_SLUG,))
        if rows:
            psycopg2.extras.execute_values(cur, """
                insert into rag_docs
                  (voyage_slug, type, title, content, source_url, license,
                   credit, media_url, chunk_index, embedding)
                values %s
            """, [(d["voyage_slug"], d["type"], d["title"], d["content"],
                   d["source_url"], d["license"], d["credit"], d["media_url"],
                   d["chunk_index"], d["embedding"]) for d in rows])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    docs = help_docs()
    if not docs:
        print("nothing to embed")
        return 0

    conn = psycopg2.connect(**pg_params())
    try:
        rows = embed(docs)
        upsert(conn, rows, args.dry_run)
        print(f"embedded {len(rows)} site-help chunk(s) from {len(DOCS)} document(s)")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
