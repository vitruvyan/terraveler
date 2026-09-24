#!/usr/bin/env python3
"""Dump `source_search_adapters` (joined against endpoint/institution status)
to a committed JSON snapshot — the offline fallback `ingest/source_registry.py`
reads from when the database is unreachable.

    python3 scripts/sync_whitelist_snapshot.py
    python3 scripts/sync_whitelist_snapshot.py --out ingest/adapters_snapshot.json

Why this exists
----------------
`source_registry.get_registry()` refuses to silently fall back to a hardcoded
Gutenberg+Wikipedia discovery list if Postgres is unreachable — that is
exactly the "aggiungere un adapter non lo rende mai cercabile" failure this
whole feature exists to fix, just moved from "the code never asked the DB" to
"the DB briefly wasn't there". The alternative to a silent hardcoded fallback
isn't always "fail the run" either, when a committed snapshot of what the
registry looked like the last time it WAS reachable is a reasonable degraded
mode — reachability blips happen, whitelist rows change rarely. So: a snapshot,
committed, dated, and named in the trace whenever it is the thing actually
used (see `source_registry._load_snapshot_fallback`).

This is NOT `ingest/whitelist.py`'s `SOURCE_AUTHORITY_MODE` system — that is a
separate, frozen migration (legacy -> shadow -> registry trust authority) out
of scope here. This script only mirrors CAPABILITY metadata (what can be
searched), never TRUST (what may be fetched); the trust decision is still
made fresh, every time, by `whitelist.is_allowed()`/`verify_source()`, live,
never from a snapshot.

Run this after changing `source_search_adapters` and commit the result.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "ingest"))
import source_registry as SR  # noqa: E402


def build_snapshot(conn) -> dict:
    adapters = SR.load_adapters(conn)
    gap = SR.gap_endpoints(conn)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "adapters": [
            {"id": a.id, "adapter": a.adapter, "config": a.config,
             "capability": a.capability, "priority": a.priority,
             "max_candidates": a.max_candidates, "endpoint_id": a.endpoint_id,
             "institution_id": a.institution_id, "notes": a.notes}
            for a in adapters
        ],
        "gap": gap,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(
        os.path.dirname(__file__), "..", "ingest", "adapters_snapshot.json"))
    args = ap.parse_args()

    conn = SR.get_db_connection()
    try:
        snapshot = build_snapshot(conn)
    finally:
        conn.close()

    out_path = os.path.abspath(args.out)
    with open(out_path, "w") as f:
        json.dump(snapshot, f, indent=2, sort_keys=False)
        f.write("\n")

    print(f"wrote {len(snapshot['adapters'])} adapter(s), "
          f"{len(snapshot['gap'])} gap endpoint(s) -> {out_path}")


if __name__ == "__main__":
    main()
