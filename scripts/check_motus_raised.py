#!/usr/bin/env python3
"""Scan every Motus trace store for a node that raised, and say so.

    python3 scripts/check_motus_raised.py

Why this exists
----------------
Motus already does its job here: when a `recorded_effect` node raises, the
runtime does not crash the whole request — a chat answer or a curator
verdict should not 500 because one node hit an edge case — but it DOES
write "outcome": "raised" into the trace, faithfully, every time. Nothing
Terraveler-side ever read that back. `read_dossier`'s Decimal bug (2026-09-13)
ran silently on every real submission until caught by accident, reading a
trace by hand for an unrelated reason. This script exists so the next one
does not depend on an accident: Motus already gives the evidence, this is
the part that was missing — someone (or something) actually looking at it.

Not a Motus change. The continue-and-record disposition is Motus behaving
correctly; the gap was entirely on the consuming side, in three different
places that each accumulate their own trace store:

  - verdict_traces.trace_jsonl   (curator, scripts/desk_graph.py)   — text, JSONL
  - chat_traces.trace            (Pigafetta, rag/app/chat_graph_native.py) — jsonb {"records": [...]}
  - ingestion_runs.trace         (ingest, ingest/pipeline_native.py)      — jsonb {"records": [...]}

Checkpointed by id per table in STATE_FILE so a second run only reports
NEW raised nodes, not the same backlog again — except the very first run,
which deliberately starts from id 0 and surfaces the full history, the same
way the rest of this project treats a first audit: retroactively, not just
going forward.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = Path(os.environ.get(
    "MOTUS_RAISED_STATE_FILE", Path.home() / "backups" / "terraveler" / "motus_raised_state.json"))


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


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def scan_jsonl_table(conn, table: str, id_col: str, name_col: str, jsonl_col: str,
                     since_id: int) -> tuple[list[dict], int]:
    with conn.cursor() as cur:
        cur.execute(
            f"select {id_col}, {name_col}, {jsonl_col}, created_at from {table} "
            f"where {id_col} > %s order by {id_col}", (since_id,))
        rows = cur.fetchall()
    found, max_id = [], since_id
    for row_id, name, jsonl, created_at in rows:
        max_id = max(max_id, row_id)
        if not jsonl:
            continue
        for line in jsonl.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("outcome") == "raised":
                found.append({"store": table, "row_id": row_id, "run": name,
                             "node": rec.get("node"), "created_at": str(created_at)})
    return found, max_id


def scan_jsonb_table(conn, table: str, id_col: str, name_col: str, jsonb_col: str,
                     since_id: int) -> tuple[list[dict], int]:
    with conn.cursor() as cur:
        cur.execute(
            f"select {id_col}, {name_col}, {jsonb_col}, created_at from {table} "
            f"where {id_col} > %s order by {id_col}", (since_id,))
        rows = cur.fetchall()
    found, max_id = [], since_id
    for row_id, name, trace, created_at in rows:
        max_id = max(max_id, row_id)
        if not trace:
            continue
        for rec in (trace.get("records") or []):
            if rec.get("outcome") == "raised":
                found.append({"store": table, "row_id": row_id, "run": name,
                             "node": rec.get("node"), "created_at": str(created_at)})
    return found, max_id


TABLES = [
    ("verdict_traces", "jsonl", "id", "run_id", "trace_jsonl"),
    ("chat_traces", "jsonb", "id", "trace_id", "trace"),
    ("ingestion_runs", "jsonb", "id", "trace_id", "trace"),
]


def main() -> int:
    state = load_state()
    conn = psycopg2.connect(**pg_params())
    all_found: list[dict] = []
    try:
        for table, kind, id_col, name_col, data_col in TABLES:
            since = state.get(table, 0)
            scan = scan_jsonl_table if kind == "jsonl" else scan_jsonb_table
            found, max_id = scan(conn, table, id_col, name_col, data_col, since)
            all_found.extend(found)
            state[table] = max_id
    finally:
        conn.close()

    save_state(state)

    if not all_found:
        print("no raised nodes since last check")
        return 0

    print(f"{len(all_found)} raised node(s) found — Motus continued the run and recorded it, "
          f"nobody has looked until now:")
    for f in all_found:
        print(f"  [{f['store']}#{f['row_id']}] {f['created_at']}  run={f['run']!r}  node={f['node']!r}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
