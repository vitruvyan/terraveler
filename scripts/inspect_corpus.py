#!/usr/bin/env python3
"""Print a corpus compactly so a person can find where the narrative starts.

    python3 scripts/inspect_corpus.py polo-1271
    python3 scripts/inspect_corpus.py polo-1271 --from 300 --to 380

It suggests nothing. Two automatic approaches were tried and both failed, which
is worth recording because they are the obvious ones:

  * Scoring chunks as "apparatus" by typography — bare numbers, roman numerals,
    leader dots, few finite sentences. It finds tables of contents and indexes
    and misses everything else, because front matter is often ordinary prose: a
    dedication and an acknowledgements page read exactly like narrative.

  * Scoring by density of dates inside the voyage's own window. Cook's front
    matter contains an editorial aside listing sailing dates from his second
    and third voyages, so the signal fires before the journal starts — the very
    trap the hand-written comment on that range warned about.

The boundary is semantic: it is where the *account* begins, and no cheap signal
knows that. Since a wrong range means quoting a title page as a diary excerpt,
past the integrity gate and into a published log, a confident wrong answer is
worse here than no answer. So this prints and a person decides.
"""
import argparse
import os
import psycopg2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--from", dest="lo", type=int, default=0)
    ap.add_argument("--to", dest="hi", type=int, default=40)
    ap.add_argument("--tail", type=int, default=0, help="show the last N chunks instead")
    ap.add_argument("--width", type=int, default=96)
    args = ap.parse_args()

    conn = psycopg2.connect(
        host=os.environ.get("PGHOST", "127.0.0.1"),
        port=int(os.environ.get("PGPORT", "6000")),
        dbname=os.environ.get("PGDATABASE", "terraveler"),
        user=os.environ.get("PGUSER", "terraveler"),
        password=os.environ.get("PGPASSWORD", ""))
    cur = conn.cursor()
    cur.execute("""SELECT chunk_index, content FROM rag_docs
                   WHERE voyage_slug=%s AND type='text' AND license ILIKE 'public domain'
                   ORDER BY chunk_index""", (args.slug,))
    rows = cur.fetchall()
    if not rows:
        raise SystemExit(f"{args.slug}: no public-domain text")

    print(f"{args.slug}: {len(rows)} chunks, {rows[0][0]}–{rows[-1][0]}")
    sel = rows[-args.tail:] if args.tail else [r for r in rows if args.lo <= r[0] <= args.hi]
    for i, c in sel:
        print(f"{i:5} │ {' '.join(c.split())[:args.width]}")
    conn.close()


if __name__ == "__main__":
    main()
