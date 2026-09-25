#!/usr/bin/env python3
"""Embed a just-published submission into rag_docs.

    python3 scripts/embed_published.py <submission_id>
    python3 scripts/embed_published.py <submission_id> --dry-run

Why this exists
----------------
Publishing (`orchestration/publish.py`) is deliberately manual (Ship's
Officers A0, moored) and records an `audit_log` row with `action='publish'`.
`supabase/events_outbox.sql`'s trigger turns that into a `submission.published`
event on the `editorial` stream — and until this script, nothing consumed it.
Approved, published content was invisible to the site's own RAG search/chat
(`rag/app/main.py`), because `rag_docs` was fed only by the bulk archival
ingestion pipeline (`ingest/pipeline_native.py`), never by Terraveler's own
authored voyages.

What it embeds, and what it deliberately does not
---------------------------------------------------
Not a re-ingestion of the cited books: `ingest/pipeline_native.py` already
does that at a different scale (its own docstring cites 6,721 chunks for one
voyage) and re-running it here would duplicate that work for no reason. This
embeds two things, both already sitting in the database at publish time and
neither requiring a new fetch or a new verification:

  1. The voyage's own narrative — title, summary, what_was_lost, and each
     waypoint's place and claim text. New writing, licensed CC BY-SA like the
     rest of Terraveler's approved content (Magna Carta, "Approved content is
     published under CC BY-SA").
  2. The quotations the Curator already verified verbatim against their
     sources (`verified_spans`) — already fetched and checked once, at review
     time; this re-embeds the stored span rather than re-fetching or
     re-verifying anything.

Idempotent by construction: re-running for the same submission replaces this
voyage's own narrative/span rows rather than accumulating duplicates, so a
redelivered event or a second manual run is harmless. The bulk archival
pipeline's own rows for the same voyage_slug are left untouched — they are
distinguished by title suffix, never by a separate table, so there is exactly
one place either pipeline's ownership of a row is decided (see `upsert`
below).
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

from whitelist import license_for  # noqa: E402

EMBED_URL = os.environ.get("EMBED_URL", "http://terraveler_embedding:8010")
NARRATIVE_LICENSE = "CC BY-SA"
BATCH = 16
# These suffixes are this script's entire claim of ownership over rows in a
# shared table: only rows whose title ends this way are ever deleted or
# considered "ours" on a re-run. The bulk ingestion pipeline's rows carry a
# source title instead and are never touched here.
WAYPOINT_MARK = " — waypoint "
SPAN_MARK = " — verified quotation"


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


def load_submission(conn, sid: int):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select id, status, target_voyage, payload from submissions where id = %s", (sid,))
        sub = cur.fetchone()
        if not sub:
            raise SystemExit(f"submission #{sid} not found")
        cur.execute(
            "select 1 from audit_log where submission_id = %s and action = 'publish' limit 1",
            (sid,))
        published = cur.fetchone() is not None
        cur.execute("select spans from verified_spans where submission_id = %s", (sid,))
        row = cur.fetchone()
        spans = row["spans"] if row else {}
    return sub, published, (spans or {})


def narrative_docs(slug: str, payload: dict) -> list[dict]:
    """The voyage's own writing — new text, not a source excerpt."""
    voyage = payload.get("voyage") or {}
    docs = []
    header = "\n\n".join(p for p in (
        voyage.get("title"),
        voyage.get("summary"),
        f"What was lost: {voyage.get('what_was_lost')}" if voyage.get("what_was_lost") else None,
    ) if p)
    if header.strip():
        docs.append({"voyage_slug": slug, "type": "text", "title": voyage.get("title") or slug,
                     "content": header, "source_url": None, "license": NARRATIVE_LICENSE,
                     "credit": None, "media_url": None, "chunk_index": 0})
    for i, wp in enumerate(payload.get("waypoints") or [], 1):
        claim_texts = [c.get("text") for c in (wp.get("claims") or []) if c and c.get("text")]
        pieces = [p for p in (wp.get("place_historical"), wp.get("place_modern"), *claim_texts) if p]
        text = "\n".join(pieces)
        if not text.strip():
            continue
        title = f"{voyage.get('title') or slug}{WAYPOINT_MARK}{wp.get('seq', i)}"
        docs.append({"voyage_slug": slug, "type": "text", "title": title,
                     "content": text, "source_url": None, "license": NARRATIVE_LICENSE,
                     "credit": None, "media_url": None, "chunk_index": i})
    return docs


def span_docs(slug: str, payload: dict, spans: dict) -> list[dict]:
    """Quotations the Curator already verified verbatim — re-embedded, not re-fetched."""
    docs = []
    for wp in payload.get("waypoints") or []:
        seq = wp.get("seq")
        for ci, claim in enumerate(wp.get("claims") or [], 1):
            span = spans.get(f"{seq}.{ci}") or {}
            reading = span.get("reading_span")
            if not reading:
                continue
            evidence = claim.get("evidence") or {}
            url = span.get("source_url") or evidence.get("source_url")
            docs.append({"voyage_slug": slug, "type": "text",
                         "title": f"wp{seq}.claim{ci}{SPAN_MARK}",
                         "content": reading, "source_url": url,
                         "license": (license_for(url) if url else None) or evidence.get("license"),
                         "credit": None, "media_url": None, "chunk_index": None})
    return docs


def bundle_docs(slug: str, bundle: dict) -> list[dict]:
    """The same rows narrative_docs()+span_docs() would produce, built from a
    published bundle (data/<file>.json) instead of a raw submission payload.

    Why this exists rather than reusing narrative_docs/span_docs directly: a
    waypoint-enrichment submission's own payload only ever lists the
    waypoints IT touches or adds — a fraction of the voyage, numbered in a
    scope of its own (see scripts/publish_submission.py's
    apply_waypoint_enrichment) — not the full, merged set the bundle now
    holds. Handing that partial payload to upsert() would still delete every
    existing waypoint/span row for the slug (its delete is unconditional on
    voyage_slug) and replace them with only the submitted fraction, silently
    erasing the rest of the voyage's embeddings. Reading from the bundle
    instead means every call embeds the voyage exactly as published, in full,
    regardless of which submission last touched it or how much it changed —
    the same idempotence narrative_docs/span_docs already promised, just
    measured against the file on disk rather than the payload that produced
    it. narrative_docs/span_docs stay as they are (and stay covered by their
    own tests below) for embed_published.py's original, standalone use
    against a new-voyage payload.
    """
    voyage = bundle.get("voyage") or {}
    docs = []
    header = "\n\n".join(p for p in (
        voyage.get("title"),
        voyage.get("summary"),
        f"What was lost: {voyage.get('what_was_lost')}" if voyage.get("what_was_lost") else None,
    ) if p)
    if header.strip():
        docs.append({"voyage_slug": slug, "type": "text", "title": voyage.get("title") or slug,
                     "content": header, "source_url": None, "license": NARRATIVE_LICENSE,
                     "credit": None, "media_url": None, "chunk_index": 0})
    for i, wp in enumerate(bundle.get("waypoints") or [], 1):
        seq = wp.get("seq", i)
        pieces = [p for p in (wp.get("place_historical"), wp.get("place_modern"), wp.get("event")) if p]
        text = "\n".join(pieces)
        if text.strip():
            title = f"{voyage.get('title') or slug}{WAYPOINT_MARK}{seq}"
            docs.append({"voyage_slug": slug, "type": "text", "title": title,
                         "content": text, "source_url": None, "license": NARRATIVE_LICENSE,
                         "credit": None, "media_url": None, "chunk_index": i})
        excerpt = wp.get("diary_excerpt")
        if excerpt:
            url = wp.get("diary_source_url")
            docs.append({"voyage_slug": slug, "type": "text",
                         "title": f"wp{seq}.claim1{SPAN_MARK}",
                         "content": excerpt, "source_url": url,
                         "license": (license_for(url) if url else None),
                         "credit": None, "media_url": None, "chunk_index": None})
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


def upsert(conn, slug: str, rows: list[dict], dry_run: bool) -> None:
    if dry_run:
        print(f"DRY RUN: would replace {slug}'s narrative/span rag_docs with {len(rows)} row(s) "
              f"— nothing written")
        for r in rows:
            print(f"  [{r['chunk_index']}] {r['title']}: {r['content'][:80]!r}")
        return
    with conn, conn.cursor() as cur:
        cur.execute("delete from rag_docs where voyage_slug = %s and title like %s",
                    (slug, f"%{WAYPOINT_MARK}%"))
        cur.execute("delete from rag_docs where voyage_slug = %s and title = any(%s)",
                    (slug, [r["title"] for r in rows if r["title"].endswith(SPAN_MARK)] or
                     [f"__none__{SPAN_MARK}"]))
        # The header row's title is the voyage title, which is not
        # distinguishable by suffix from a bulk-ingestion source title of the
        # same name — chunk_index 0 with a NULL source_url is, since every
        # bulk-ingested text row carries a real source_url.
        cur.execute("delete from rag_docs where voyage_slug = %s and chunk_index = 0 "
                    "and source_url is null and license = %s", (slug, NARRATIVE_LICENSE))
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
    ap.add_argument("submission_id", type=int)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = psycopg2.connect(**pg_params())
    try:
        sub, published, spans = load_submission(conn, args.submission_id)
        if not published:
            raise SystemExit(
                f"submission #{args.submission_id} has no 'publish' audit_log entry — "
                f"nothing to embed. Publishing (orchestration/publish.py) is what "
                f"authorises this, same as it authorises the atlas entry.")
        slug = sub["target_voyage"]
        if not slug:
            print(f"submission #{args.submission_id} names no target_voyage — skipping")
            return 0
        payload = sub["payload"] or {}
        docs = narrative_docs(slug, payload) + span_docs(slug, payload, spans)
        if not docs:
            print(f"submission #{args.submission_id} ({slug}) has nothing embeddable — skipping")
            return 0
        rows = embed(docs)
        upsert(conn, slug, rows, args.dry_run)
        print(f"embedded {len(rows)} chunk(s) for {slug} from submission #{args.submission_id}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
