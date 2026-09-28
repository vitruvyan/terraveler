#!/usr/bin/env python3
"""Does the registry decide what the hardcoded whitelist decides — and where
does it decide differently, on purpose?

    PGPASSWORD=... python3 scripts/check_registry_equivalence.py
    ... --json          machine-readable

Registry mode has never run in production: source_governance_comparisons is
empty, so nothing has ever measured the registry against the whitelist it is
about to replace as the Curator's authority. This is that measurement, run
offline against the LIVE registry (read-only) and a fixed corpus:

  - every host the legacy whitelist knows, in every URL shape that matters
    (ports, case, trailing dot, userinfo tricks, lookalike suffixes);
  - archive.org items, with a stubbed metadata fetch (no network);
  - every endpoint the registry holds beyond the legacy nine, i.e. the
    approvals this change makes live — or leaves recorded but inert.

Each row is classified:

  MATCH               both decide the same
  EXPECTED_WIDENING   registry allows, legacy does not, and the host is an
                      editor-approved endpoint beyond the legacy nine
  REGRESSION          legacy allows, registry does not        -> exit 1
  UNEXPECTED_WIDENING registry allows something no approval covers -> exit 1

Read the EXPECTED_WIDENING and MATCH-because-inert lines before flipping
SOURCE_AUTHORITY_MODE: they are exactly what changes.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ingest"))

import whitelist  # noqa: E402
import source_governance_shadow as G  # noqa: E402

PD_ITEM = lambda api: {"metadata": {"date": "1850", "access-restricted-item": "false"}}  # noqa: E731
RESTRICTED_ITEM = lambda api: {"metadata": {"date": "1850", "access-restricted-item": "true"}}  # noqa: E731

# (label, url, fetch_json)
LEGACY_CORPUS = [
    ("gutenberg", "https://www.gutenberg.org/ebooks/1", None),
    ("gutenberg apex", "https://gutenberg.org/files/1/1.txt", None),
    ("gutenberg explicit port", "https://www.gutenberg.org:443/ebooks/1", None),
    ("gutenberg uppercase", "https://WWW.GUTENBERG.ORG/ebooks/1", None),
    ("gutendex", "https://gutendex.com/books/?search=cook", None),
    ("runeberg", "https://runeberg.org/x/", None),
    ("wikipedia en", "https://en.wikipedia.org/wiki/Francisco_Pizarro", None),
    ("wikipedia es", "https://es.wikipedia.org/wiki/Tall%C3%A1n", None),
    ("wikisource fr", "https://fr.wikisource.org/wiki/Anything", None),
    ("wikimedia commons", "https://commons.wikimedia.org/wiki/File:X.jpg", None),
    ("wikimedia upload", "https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg", None),
    ("archive.org PD item", "https://archive.org/details/somebook", PD_ITEM),
    ("archive.org download", "https://archive.org/download/somebook/somebook_djvu.txt", PD_ITEM),
    ("www.archive.org PD item", "https://www.archive.org/details/somebook", PD_ITEM),
    ("archive.org restricted item", "https://archive.org/details/restricted", RESTRICTED_ITEM),
    # Negatives and shapes an attacker would try.
    ("unknown host", "https://example.com/book.txt", None),
    ("suffix lookalike", "https://wikisource.org.attacker.example/x", None),
    ("prefix lookalike", "https://notwikisource.org/x", None),
    ("userinfo trick", "https://en.wikipedia.org@attacker.example/x", None),
    ("gutenberg as subdomain of attacker", "https://www.gutenberg.org.attacker.example/x", None),
    ("plain http", "http://www.gutenberg.org/ebooks/1", None),
    ("no host", "file:///etc/passwd", None),
    ("empty", "", None),
]


def registry_rows() -> list[dict]:
    conn = G.get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select e.id, e.host_pattern, e.match_type, e.status, e.trust_mode "
                "from source_endpoints e order by e.id")
            return list(cur.fetchall())
    finally:
        conn.close()


def outcome(mode: str, url: str, fetch_json) -> tuple[bool, str]:
    os.environ["SOURCE_AUTHORITY_MODE"] = mode
    res = whitelist.resolve_source_authority(url, fetch_json=fetch_json)
    return bool(res["allowed"]), str(res["reason_codes"][0])[:110]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    endpoints = registry_rows()
    legacy_hosts = {"gutenberg.org", "www.gutenberg.org", "gutendex.com", "runeberg.org",
                    ".wikisource.org", ".wikipedia.org", ".wikimedia.org", "archive.org", "www.archive.org"}
    approved_beyond_legacy = {e["host_pattern"]: e for e in endpoints
                              if e["host_pattern"] not in legacy_hosts and e["status"] == "active"}

    corpus = list(LEGACY_CORPUS)
    for host, e in approved_beyond_legacy.items():
        h = host.lstrip(".")
        corpus.append((f"registry approval: {h} ({e['trust_mode']})", f"https://{h}/some/record/1", PD_ITEM))

    rows, bad = [], 0
    for label, url, fetch_json in corpus:
        l_ok, l_why = outcome("legacy", url, fetch_json)
        r_ok, r_why = outcome("registry", url, fetch_json)
        host = whitelist.domain_of(url)
        if l_ok == r_ok:
            klass = "MATCH"
        elif l_ok and not r_ok:
            klass = "REGRESSION"
        elif host in approved_beyond_legacy or ("." + host) in approved_beyond_legacy:
            klass = "EXPECTED_WIDENING"
        else:
            klass = "UNEXPECTED_WIDENING"
        if klass in ("REGRESSION", "UNEXPECTED_WIDENING"):
            bad += 1
        rows.append({"case": label, "url": url, "legacy": l_ok, "registry": r_ok,
                     "class": klass, "legacy_why": l_why, "registry_why": r_why})

    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
    else:
        width = max(len(r["case"]) for r in rows)
        for r in rows:
            print(f"{r['class']:<19} {r['case']:<{width}}  legacy={str(r['legacy']):<5} registry={str(r['registry']):<5}"
                  f"  | {r['registry_why']}")
        counts = {}
        for r in rows:
            counts[r["class"]] = counts.get(r["class"], 0) + 1
        print("\n" + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
        print("RESULT:", "FAIL — do not flip the mode" if bad else "ok — every difference is an approved endpoint")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
