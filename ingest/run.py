"""Terraveler ingestion — orchestrated by Motus.

    python run.py --voyage boudeuse-1766 --policy exploration --wipe
    python run.py --voyage boudeuse-1766 --limit 40           # fast smoke test
    python run.py --discover --subject "Magellan" --voyage magellan-1519

Produces a contract-validatable Motus trace, persisted to:
  - table `ingestion_runs` (jsonb)
  - /app/traces/<run_id>.jsonl  (the JSONL form contract/validate.py accepts)

The trace is the reliability evidence: every source loaded or refused, every
curator drop with its score, every codex rejection with its quality reasons,
every embed batch that failed — and, since 0.7, which effects each node
observed and how the run reached its end.

Two graphs live in `pipeline_native.py`; this file only chooses between them,
runs one, and writes down what happened.
"""
import os
import json
import argparse
from datetime import datetime, timezone

import psycopg2

from vitruvyan_motus import JsonlTraceSink, NodeFailed, Policy, Runtime, State

import staging
from pipeline_native import (
    DISCOVERY_SPEC, INGESTION_SPEC, IngestConfig,
    make_discovery_nodes, make_ingestion_nodes,
)

TRACE_DIR = "/app/traces"


def env(k, default=None):
    return os.environ.get(k, default)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voyage", required=True)
    ap.add_argument("--subject", default="")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--curator-model", default="gpt-4.1-mini")
    ap.add_argument("--policy", choices=["strict", "exploration"], default="exploration")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--wipe", action="store_true")
    ap.add_argument("--discover", action="store_true")
    args = ap.parse_args()

    cfg = IngestConfig(
        voyage=args.voyage,
        subject=args.subject,
        lang=args.lang,
        curator_model=args.curator_model,
        policy_name=args.policy,
        limit=args.limit or 0,
        wipe=args.wipe,
        embed_url=env("EMBED_URL", "http://terraveler_embedding:8010"),
        pg_host=env("PGHOST", "terraveler_postgres"),
        pg_port=int(env("PGPORT", "5432")),
        pg_db=env("PGDATABASE", "terraveler"),
        pg_user=env("PGUSER", "terraveler"),
        pg_pass=env("PGPASSWORD", ""),
    )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"{args.voyage}-{stamp}"
    started = datetime.now(timezone.utc)

    staging.ensure(cfg)
    spec = DISCOVERY_SPEC if args.discover else INGESTION_SPEC
    nodes = (make_discovery_nodes(cfg, run_id) if args.discover
             else make_ingestion_nodes(cfg, run_id))
    policy = Policy.STRICT if args.policy == "strict" else Policy.EXPLORATION

    os.makedirs(TRACE_DIR, exist_ok=True)
    # The sink writes the run as it happens, so a process killed mid-ingest
    # still leaves the part it completed on disk, named for what it is.
    sink = JsonlTraceSink(TRACE_DIR)

    mode = (f"discover subject={args.subject!r} curator={args.curator_model}"
            if args.discover else "curated-sources")
    print(f"▶ Motus ingest  voyage={args.voyage}  graph={spec.name}  mode=[{mode}]  "
          f"policy={args.policy}"
          f"{'  limit=' + str(args.limit) if args.limit else ''}"
          f"{'  WIPE' if args.wipe else ''}")

    runtime = Runtime(spec, nodes, policy=policy, sink=sink)
    # A failed run is exactly the one the audit exists for. NodeFailed carries
    # the trace built up to the failure, so the evidence is persisted first and
    # the process dies loudly after — never the other way round.
    try:
        result = runtime.run(
            State.empty(f"ingest:{args.voyage}",
                        metadata={"voyage": args.voyage, "policy": args.policy}),
            run_id=run_id)
        trace, state, failure = result.trace, result.state, None
        status = result.status
    except NodeFailed as exc:
        trace, state, failure = exc.trace, exc.state, exc
        status = "run_failed"
    finally:
        # Scratch space, never a second corpus: the payload goes once the run
        # that owned it is over, whether it succeeded or not.
        try:
            staging.clear(cfg, run_id)
        except Exception as exc:
            print(f"⚠ could not clear staging for {run_id}: {exc}")

    finished = datetime.now(timezone.utc)

    facts = {f.key: f.value for f in state.facts} if state is not None else {}
    summary = {
        "run_id": run_id,
        "graph": spec.name,
        "graph_fingerprint": spec.graph_fingerprint,
        "voyage": args.voyage,
        "policy": args.policy,
        "status": status,
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "facts": facts,
        "decisions": [{"key": d.key, "value": d.value, "reason": d.reason}
                      for d in (state.decisions if state is not None else ())],
        "rejections": [{"what": r.what, "why": r.reason}
                       for r in (state.rejections if state is not None else ())],
        "records": len(trace.records) if trace is not None else 0,
    }

    try:
        conn = psycopg2.connect(host=cfg.pg_host, port=cfg.pg_port, dbname=cfg.pg_db,
                                user=cfg.pg_user, password=cfg.pg_pass)
        with conn, conn.cursor() as cur:
            cur.execute("""
                insert into ingestion_runs
                  (trace_id, voyage_slug, policy, started_at, finished_at,
                   facts, chunks_embedded, chunks_rejected, trace)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (run_id, args.voyage, args.policy, started, finished,
                  int(facts.get("total_docs", 0)), int(facts.get("embedded", 0)),
                  int(facts.get("rejected", 0)),
                  trace.to_json() if trace is not None else None))
        conn.close()
    except Exception as exc:
        print(f"⚠ could not persist audit row: {exc}")

    print("─" * 60)
    print(json.dumps(summary, indent=2, default=str))
    print("─" * 60)
    for path in sink.artifacts:
        print(f"  trace artifact: {path}")
    if failure:
        print(f"✘ run FAILED — {failure}")
        raise SystemExit(1)
    print("✔ run complete")


if __name__ == "__main__":
    main()
