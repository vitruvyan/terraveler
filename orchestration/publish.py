#!/usr/bin/env python3
"""The Publisher CLI — one submission per invocation, deliberately.

    python3 orchestration/publish.py <submission_id>
    python3 orchestration/publish.py <submission_id> --dry-run

No "publish everything approved" default: `commit_push` is a real
`git commit && git push`, and a batch mode would make one bad bundle a bad
push for everything queued behind it. See
`orchestration/motus/nodes/publisher.py` for the graph itself and why this
rebuild exists.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import psycopg2                                            # noqa: E402
import psycopg2.extras                                     # noqa: E402

from vitruvyan_motus import JsonlTraceSink, NodeFailed      # noqa: E402

from orchestration.motus.nodes import publisher as P        # noqa: E402


def carta_version() -> str:
    m = re.search(r"Editorial Constitution — v(\d+\.\d+)",
                  (ROOT / "MAGNA_CARTA.md").read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("MAGNA_CARTA.md has no version line — refusing to guess")
    return m.group(1)


def pg_params() -> dict:
    env = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    return {
        "host": __import__("os").environ.get("PGHOST", "127.0.0.1"),
        "port": int(__import__("os").environ.get("PGPORT", "6000")),
        "dbname": __import__("os").environ.get("PGDATABASE", "terraveler"),
        "user": __import__("os").environ.get("PGUSER", "terraveler"),
        "password": __import__("os").environ.get("PGPASSWORD") or env.get("POSTGRES_PASSWORD", ""),
    }


def ensure_trace_table(pg: dict) -> None:
    """Same idiom as scripts/desk_review.py's own ensure_trace_table — the
    officers' container mounts the repository read-only, so the table this
    pass needs is asserted by the pass. supabase/publication_traces.sql
    holds the same statement for anyone building the database from files."""
    conn = psycopg2.connect(**pg)
    try:
        with conn, conn.cursor() as cur:
            cur.execute("""
                create table if not exists publication_traces (
                  id            bigint generated always as identity primary key,
                  submission_id bigint,
                  run_id        text not null,
                  slug          text,
                  commit_sha    text,
                  root          text,
                  evidence      text,
                  status        text,
                  schema_version text,
                  trace_jsonl   text not null,
                  created_at    timestamptz not null default now()
                );
            """)
            cur.execute("create index if not exists publication_traces_submission "
                        "on publication_traces (submission_id, id desc);")
            cur.execute("create unique index if not exists publication_traces_root "
                        "on publication_traces (root) where root is not null;")
    finally:
        conn.close()


def persist_trace(pg: dict, submission_id: int, run_id: str, slug: str | None,
                  commit_sha: str | None, trace, evidence: str, status: str) -> str | None:
    root = trace.root if trace is not None else None
    conn = psycopg2.connect(**pg)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "insert into publication_traces (submission_id, run_id, slug, commit_sha, "
                "root, evidence, status, schema_version, trace_jsonl) "
                "values (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "on conflict (root) where root is not null do nothing",
                (submission_id, run_id, slug, commit_sha, root, evidence, status,
                 (trace.header.get("schema_version") if trace is not None else None),
                 trace.to_jsonl() if trace is not None else ""))
    finally:
        conn.close()
    return root


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("submission_id", type=int)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--trace-dir", default=None)
    args = ap.parse_args()

    carta = carta_version()
    pg = pg_params()
    if not args.dry_run:
        ensure_trace_table(pg)

    cfg = P.PublishConfig(pg=pg, carta=carta, dry_run=args.dry_run)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"publish-{args.submission_id}-{stamp}"
    sink = JsonlTraceSink(args.trace_dir) if args.trace_dir else None

    try:
        result = P.run_publish(cfg, args.submission_id, run_id=run_id, sink=sink)
        state, trace, failure = result.state, result.trace, None
        status, evidence = result.status, result.evidence
    except NodeFailed as exc:
        state, trace, failure = exc.state, exc.trace, exc
        status, evidence = "run_failed", getattr(exc, "evidence", "not-required")

    published = bool(state.fact("published"))
    target_voyage = state.fact("target_voyage")
    commit_sha = state.fact("commit_sha")

    root = None
    if not args.dry_run:
        root = persist_trace(pg, args.submission_id, run_id, target_voyage,
                             commit_sha, trace, evidence, status)

    res = {
        "submission_id": args.submission_id,
        "published": published,
        "target_voyage": target_voyage,
        "commit_sha": commit_sha,
        "run_id": run_id,
        "trace_root": root or (trace.root if trace is not None else None),
        "rejections": [
            {"what": r.what, "why": r.reason} for r in (state.rejections or [])
        ],
    }

    if args.json:
        print(json.dumps(res, indent=2, ensure_ascii=False))
    else:
        if published:
            print(f"published {target_voyage} — commit {commit_sha}")
        else:
            print(f"NOT published (submission #{args.submission_id})")
            for rej in res["rejections"]:
                print(f"  {rej['what']}: {rej['why']}")
        if res["trace_root"]:
            print(f"trace {run_id}  root {res['trace_root']}")
        if args.dry_run:
            print("(dry run — no files written, no git, no audit_log row)")

    if failure is not None:
        raise failure
    return 0 if (published or args.dry_run) else 1


if __name__ == "__main__":
    raise SystemExit(main())
