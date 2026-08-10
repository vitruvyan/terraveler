#!/usr/bin/env python3
"""The Curator's verdict pass over the review queue.

    python3 scripts/desk_review.py                 # everything awaiting a verdict
    python3 scripts/desk_review.py 21 22 23        # named submissions
    python3 scripts/desk_review.py --dry-run       # report, record nothing
    python3 scripts/desk_review.py --json          # machine-readable, for an agent

Why this exists
---------------
Carta §2 gives the Curator the power to issue `approved | rejected |
changes-requested`, and §5 makes every verdict motivated, cited and appealable
to the Editor-in-chief. That was written down and never built, so in practice
the human signed every verdict — and by submission twenty-six he was signing
them without reading, because there is no way to read twenty-six drafts and no
information in the queue to read them *with*.

A human rubber-stamping is strictly worse than a declared automatic gate. It
looks like scrutiny, produces an audit row that says a person ruled, and checks
nothing. So this makes the Curator's authority operative and honest: the
verdicts it gives are recorded under its own name, with every finding attached,
and the editor keeps the final word through override and appeal.

What it will and will not decide
--------------------------------
Everything here is mechanical. A quotation either is in its source or is not; a
date either falls inside the voyage or does not; a licence either permits
ingestion or does not. Those are checks, not judgements, and a machine should
make them.

What it deliberately does NOT decide is whether an excerpt is the traveller's
account or the editor's commentary on it — the failure that put four footnotes
into Xuanzang, one of them describing a different pilgrim two centuries earlier.
That distinction is semantic, no cheap signal has ever caught it here (see
docs/LIBRARY_QUEUE.md for three attempts that failed), and a confident wrong
answer is worse than none. Those go to `escalate`, with the passage quoted, for
something that can read.

What changed when it became a graph
-----------------------------------
This file is now the command line and nothing else. The checks are in
`desk_checks.py` and the pass itself is a Motus graph in `desk_graph.py`,
because the one hole left in the Carta's guarantee was that a verdict — however
motivated, cited and appealable — was a database row, and a database row can be
edited afterwards by anyone holding the password, silently.

It cannot be, now. Every run leaves an immutable, hash-chained trace; the trace
is stored beside the submission in `verdict_traces` in the canonical form the
shipped validator accepts, so anyone can check it without trusting this code;
and its root is published on a public chain by `scripts/anchor.py`, so a verdict
edited after the fact no longer matches what was published before it.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import psycopg2                                            # noqa: E402
import psycopg2.extras                                     # noqa: E402

from vitruvyan_motus import JsonlTraceSink, NodeFailed, Policy   # noqa: E402

import desk_checks as K                                    # noqa: E402
import desk_graph as G                                     # noqa: E402


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
        "host": os.environ.get("PGHOST", "127.0.0.1"),
        "port": int(os.environ.get("PGPORT", "6000")),
        "dbname": os.environ.get("PGDATABASE", "terraveler"),
        "user": os.environ.get("PGUSER", "terraveler"),
        "password": os.environ.get("PGPASSWORD") or env.get("POSTGRES_PASSWORD", ""),
    }


def ensure_trace_table(pg: dict) -> None:
    """`verdict_traces`, created where it is used.

    The same idiom as `chat_traces` (rag/app/main.py): the officers' container
    mounts the repository read-only and cannot apply a migration, so the table
    the pass needs is asserted by the pass. `supabase/verdict_traces.sql` holds
    the same statement for anyone building a database from the files.
    """
    conn = psycopg2.connect(**pg)
    try:
        with conn, conn.cursor() as cur:
            cur.execute("""
                create table if not exists verdict_traces (
                  id            bigint generated always as identity primary key,
                  submission_id bigint references submissions(id),
                  run_id        text not null,
                  verdict       text,
                  root          text,
                  evidence      text,
                  status        text,
                  schema_version text,
                  trace_jsonl   text not null,
                  created_at    timestamptz not null default now()
                );
            """)
            cur.execute("create index if not exists verdict_traces_submission "
                        "on verdict_traces (submission_id, id desc);")
            cur.execute("create unique index if not exists verdict_traces_root "
                        "on verdict_traces (root) where root is not null;")
    finally:
        conn.close()


def persist_trace(pg: dict, submission_id: int, run_id: str, verdict, trace,
                  evidence: str, status: str) -> str | None:
    """Store the trace beside the submission, and return its root.

    `trace_jsonl` is `text` and not `jsonb` on purpose. jsonb reorders keys and
    drops the duplicate-free byte sequence the hash chain was computed over, so
    a trace stored as jsonb is a trace that no longer validates — the integrity
    chain would be checked against bytes Postgres chose rather than the ones
    Motus signed. `chat_traces.trace` is jsonb and has that defect today; this
    column does not repeat it.

    The root gets its own column because it is the only value Phase 3 publishes,
    and something published deserves to be selectable rather than parsed back
    out of a document.
    """
    root = trace.root if trace is not None else None
    conn = psycopg2.connect(**pg)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "insert into verdict_traces (submission_id, run_id, verdict, root,"
                " evidence, status, schema_version, trace_jsonl)"
                " values (%s,%s,%s,%s,%s,%s,%s,%s)"
                # The index is partial (a run that never reached a terminal has
                # no root, and several such runs must be storable), so the
                # arbiter has to repeat the predicate — without it Postgres
                # cannot tell which index this conflict clause means.
                " on conflict (root) where root is not null do nothing",
                (submission_id, run_id, verdict, root, evidence, status,
                 (trace.header.get("schema_version") if trace is not None else None),
                 trace.to_jsonl() if trace is not None else ""))
    finally:
        conn.close()
    return root


def queue(pg: dict, ids: list[int]) -> list[dict]:
    conn = psycopg2.connect(**pg)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if ids:
                # The same status gate as the queue pass: an explicit id is a
                # way to pick a submission out of the queue, not a way to
                # re-rule one that has left it (approved, rejected, appealed —
                # the editor's ground).
                cur.execute("select id,type,target_voyage,status from submissions "
                            "where id = any(%s) and status in %s order by id",
                            (ids, G.RULEABLE))
            else:
                cur.execute("select id,type,target_voyage,status from submissions "
                            "where status in %s order by id", (G.RULEABLE,))
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*", type=int)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--policy", choices=["strict", "exploration"],
                    default="exploration")
    ap.add_argument("--trace-dir", default=None,
                    help="also write each run's trace as JSONL into this "
                         "directory (the database copy is written regardless)")
    args = ap.parse_args()

    carta = carta_version()
    pg = pg_params()
    policy = Policy.STRICT if args.policy == "strict" else Policy.EXPLORATION
    if not args.dry_run:
        ensure_trace_table(pg)

    subs = queue(pg, args.ids)
    if not subs:
        print("nothing awaiting a verdict.")
        return 0

    sink = JsonlTraceSink(args.trace_dir) if args.trace_dir else None
    out = []
    for sub in subs:
        sid = sub["id"]
        # One config, one span store, one run. See run_desk's docstring.
        cfg = G.DeskConfig(pg=pg, carta=carta, dry_run=args.dry_run)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        run_id = f"verdict-{sid}-{stamp}"
        started = datetime.now(timezone.utc)

        # NodeFailed carries BOTH the accumulated state and the trace built up
        # to the failure — persist the evidence first and re-raise after. A run
        # that died is exactly the run an audit exists for.
        try:
            result = G.run_desk(cfg, sid, run_id=run_id, sink=sink,
                                policy=policy, ts=started)
            state, trace, failure = result.state, result.trace, None
            status, evidence = result.status, result.evidence
        except NodeFailed as exc:
            state, trace, failure = exc.state, exc.trace, exc
            status, evidence = "run_failed", getattr(exc, "evidence", "not-required")

        verdict = state.decision("verdict")
        payload = G._payload(cfg, sid)[0] or {}
        spans = cfg.spans.staged()
        rows = K.compose(state.fact("findings") or [], payload, spans)

        root = None
        if not args.dry_run:
            root = persist_trace(pg, sid, run_id, verdict, trace, evidence, status)

        res = {
            "id": sid,
            "target": sub["target_voyage"],
            "type": sub["type"],
            "verdict": state.decision("recorded") == "superseded" and "superseded" or verdict,
            "reason": (state.fact("verdict_reason")
                       or state.fact("outcome")
                       or "nothing to rule on"),
            "stats": state.fact("stats") or state.fact("gate_stats") or {},
            "findings": rows,
            "verified_spans": spans,
            "run_id": run_id,
            "trace_root": root or (trace.root if trace is not None else None),
            "recorded": state.decision("recorded"),
        }
        out.append(res)

        if not args.json:
            s = res["stats"]
            print(f"\n#{sid:<3} {str(res['target']):<20} → {str(res['verdict']).upper()}"
                  f"  ({s.get('verified', 0)}/{s.get('quoted', 0)} quotations verified)")
            print(f"     {res['reason']}")
            for level, _, text in rows[:8]:
                print(f"     {level:<9} {text[:150]}")
            extra = len(rows) - 8
            if extra > 0:
                print(f"     … and {extra} more")
            if res["trace_root"]:
                print(f"     trace {run_id}  root {res['trace_root']}")
        if failure is not None:
            raise failure

    if args.json:
        print(json.dumps(out, indent=2, ensure_ascii=False))
    elif args.dry_run:
        print("\n(dry run — nothing recorded)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
