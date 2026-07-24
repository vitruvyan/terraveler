"""Terraveler ingestion — Axis-orchestrated.

    python run.py --voyage boudeuse-1766 --policy exploration --wipe
    python run.py --voyage boudeuse-1766 --limit 40           # fast smoke test

Produces an immutable GraphState trace, persisted to:
  - pgvector table `ingestion_runs` (jsonb)
  - /app/traces/<trace_id>.json (mounted volume)
The trace is the reliability evidence: every doc embedded/rejected, with reasons.
"""
import os
import json
import argparse
from types import SimpleNamespace
from datetime import datetime, timezone

import psycopg2

from axis import GraphState, Runner, Policy
from pipeline import Corpus, build_nodes, build_discovery_nodes


def env(k, default=None):
    return os.environ.get(k, default)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voyage", required=True, help="voyage/subject slug (e.g. laperouse-1785)")
    ap.add_argument("--policy", choices=["strict", "exploration"], default="exploration")
    ap.add_argument("--limit", type=int, default=0, help="cap docs (0 = all) for a smoke test")
    ap.add_argument("--wipe", action="store_true", help="delete existing rows for this voyage first")
    # discovery mode (oculus + curator agent)
    ap.add_argument("--discover", action="store_true",
                    help="auto-discover sources for --subject via oculus + curator")
    ap.add_argument("--subject", default="", help="subject to harvest (discovery mode)")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--curator-model", default="gpt-4.1")
    args = ap.parse_args()

    if args.discover and not args.subject:
        raise SystemExit("--discover requires --subject")
    if args.discover:
        os.environ["CURATOR_MODEL"] = args.curator_model

    ctx = SimpleNamespace(
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
    trace_id = f"{args.voyage}-{stamp}"
    started = datetime.now(timezone.utc)

    corpus = Corpus()
    nodes = build_discovery_nodes(ctx, corpus) if args.discover else build_nodes(ctx, corpus)
    policy = Policy.STRICT if args.policy == "strict" else Policy.EXPLORATION

    state = GraphState.empty(trace_id).with_intent(f"ingest:{args.voyage}")
    runner = Runner(nodes, policy=policy)

    mode = f"discover subject={args.subject!r} curator={args.curator_model}" if args.discover else "curated-sources"
    print(f"▶ Axis ingest  voyage={args.voyage}  mode=[{mode}]  policy={args.policy}"
          f"{'  limit=' + str(args.limit) if args.limit else ''}{'  WIPE' if args.wipe else ''}")
    final = runner.run(state)
    finished = datetime.now(timezone.utc)

    facts = {f.key: f.value for f in final.facts}
    summary = {
        "trace_id": trace_id,
        "voyage": args.voyage,
        "policy": args.policy,
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "facts": facts,
        "decisions": [d.description for d in final.decisions],
        "rejections": [{"what": r.description, "why": r.reason} for r in final.rejections],
        "events": len(final.events),
    }

    # persist trace JSON to mounted volume
    os.makedirs("/app/traces", exist_ok=True)
    with open(f"/app/traces/{trace_id}.json", "w") as fh:
        json.dump({**summary, "trace": final.to_dict()}, fh, indent=2)

    # persist audit row to pgvector DB
    try:
        conn = psycopg2.connect(host=ctx.pg_host, port=ctx.pg_port, dbname=ctx.pg_db,
                                user=ctx.pg_user, password=ctx.pg_pass)
        with conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ingestion_runs
                  (trace_id, voyage_slug, policy, started_at, finished_at,
                   facts, chunks_embedded, chunks_rejected, trace)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (trace_id, args.voyage, args.policy, started, finished,
                  int(facts.get("total_docs", 0)), int(facts.get("embedded", 0)),
                  int(facts.get("rejected", 0)), json.dumps(final.to_dict())))
        conn.close()
    except Exception as e:
        print(f"⚠ could not persist audit row: {e}")

    print("─" * 60)
    print(json.dumps(summary, indent=2))
    print("─" * 60)
    print(f"✔ trace: /app/traces/{trace_id}.json")


if __name__ == "__main__":
    main()
