#!/usr/bin/env python3
"""Load the published voyage bundles from data/*.json into Postgres.

    python3 scripts/load_bundles.py            # all published voyages
    python3 scripts/load_bundles.py --voyage cook-1768
    python3 scripts/load_bundles.py --dry-run  # say what would change

Why this exists
---------------
Five of the six published voyages have only ever lived as JSON in data/. The
site serves them through the fallback in lib/data.ts, which works so well that
nobody noticed the database did not have them — the content tables did not even
exist until today. Until this runs, the database is not the source of truth for
anything except Bougainville, and every feature that queries Postgres (search
over stages, the RAG's structured lookups, the Desk) sees an atlas of one.

seed.sql is not that loader. It is a hand-written INSERT of Bougainville alone,
and writing five more of those by hand would guarantee they drift from the
bundles the moment either changes.

What it will not do
-------------------
It refuses to touch a voyage that is not in ATLAS (lib/voyages.ts). That
registry is the single published list, and the build already fails if it and
data/ disagree — a loader that quietly wrote a voyage ATLAS does not know about
would be a hole straight through that guarantee.

It writes nothing outside the voyages it is given: waypoints are deleted and
rewritten per voyage because they are wholly derived from the bundle, and the
delete is always scoped by voyage_id.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

import pathlib

import psycopg2
import psycopg2.extras

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ATLAS_TS = ROOT / "lib" / "voyages.ts"

# The bundle filename does not always match the slug (bougainville.json holds
# boudeuse-1766), so the slug inside each file is authoritative and this map is
# only used to report which file a problem came from.
WAYPOINT_COLUMNS = [
    "seq", "place_historical", "place_modern", "latitude", "longitude",
    "arrival_date", "departure_date", "date_note", "event",
    "diary_excerpt", "diary_source_citation", "diary_source_url",
    "confidence", "media_url", "r_au", "theta_deg", "body", "is_flyby", "media",
]


def atlas_slugs() -> set:
    """The published registry, read from the TypeScript rather than duplicated.

    Parsing TS with a regex is ugly, and it is still better than keeping a
    second copy of the list in Python: a duplicate would be wrong eventually,
    whereas this is wrong immediately and loudly if ATLAS changes shape.
    """
    src = ATLAS_TS.read_text(encoding="utf-8")
    slugs = set(re.findall(r'slug:\s*"([^"]+)"', src))
    if not slugs:
        sys.exit(f"could not read any slug from {ATLAS_TS} — has ATLAS changed shape?")
    return slugs


def bundles() -> dict:
    """slug -> (path, bundle) for every data/*.json that is a voyage bundle."""
    out = {}
    for path in sorted(DATA.glob("*.json")):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            sys.exit(f"{path.name}: not valid JSON ({e})")
        if not isinstance(doc, dict) or "voyage" not in doc:
            continue                      # gazetteer.json and friends
        slug = doc["voyage"].get("slug")
        if not slug:
            sys.exit(f"{path.name}: bundle has no voyage.slug")
        if slug in out:
            sys.exit(f"two bundles claim slug {slug}: {out[slug][0].name} and {path.name}")
        out[slug] = (path, doc)
    return out


def _dotenv_password() -> str:
    """Postgres runs in Docker on port 6000, and its password is already in .env.
    Every script that asked the operator to export it by hand got the port wrong
    at least once. Read the file the compose stack reads."""
    f = pathlib.Path(__file__).resolve().parent.parent / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if line.startswith("POSTGRES_PASSWORD="):
                return line.split("=", 1)[1].strip().strip('"')
    return ""


def connect():
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "127.0.0.1"),
        port=int(os.environ.get("PGPORT", "6000")),
        dbname=os.environ.get("PGDATABASE", "terraveler"),
        user=os.environ.get("PGUSER", "terraveler"),
        password=os.environ.get("PGPASSWORD") or _dotenv_password(),
    )


def upsert_navigator(cur, nav: dict) -> int:
    cur.execute("""
        insert into navigators (slug, name, nationality, birth_year, death_year,
                                portrait_url, bio)
        values (%(slug)s, %(name)s, %(nationality)s, %(birth_year)s,
                %(death_year)s, %(portrait_url)s, %(bio)s)
        on conflict (slug) do update set
            name         = excluded.name,
            nationality  = excluded.nationality,
            birth_year   = excluded.birth_year,
            death_year   = excluded.death_year,
            portrait_url = excluded.portrait_url,
            bio          = excluded.bio
        returning id
    """, {k: nav.get(k) for k in
          ("slug", "name", "nationality", "birth_year", "death_year",
           "portrait_url", "bio")})
    return cur.fetchone()[0]


def upsert_voyage(cur, voyage: dict, navigator_id: int) -> int:
    params = {k: voyage.get(k) for k in
              ("slug", "title", "ships", "sponsor", "purpose", "start_date",
               "end_date", "summary", "kind", "render", "body",
               "evidence_basis", "what_was_lost")}
    params["navigator_id"] = navigator_id
    cur.execute("""
        insert into voyages (navigator_id, slug, title, ships, sponsor, purpose,
                             start_date, end_date, summary, kind, render, body,
                             evidence_basis, what_was_lost)
        values (%(navigator_id)s, %(slug)s, %(title)s, %(ships)s, %(sponsor)s,
                %(purpose)s, %(start_date)s, %(end_date)s, %(summary)s,
                %(kind)s, %(render)s, %(body)s, %(evidence_basis)s,
                %(what_was_lost)s)
        on conflict (slug) do update set
            navigator_id   = excluded.navigator_id,
            title          = excluded.title,
            ships          = excluded.ships,
            sponsor        = excluded.sponsor,
            purpose        = excluded.purpose,
            start_date     = excluded.start_date,
            end_date       = excluded.end_date,
            summary        = excluded.summary,
            kind           = excluded.kind,
            render         = excluded.render,
            body           = excluded.body,
            evidence_basis = excluded.evidence_basis,
            what_was_lost  = excluded.what_was_lost
        returning id
    """, params)
    return cur.fetchone()[0]


def replace_waypoints(cur, voyage_id: int, waypoints: list) -> int:
    """Waypoints are wholly derived from the bundle, so they are replaced rather
    than merged — a stage removed from a bundle must disappear from the
    database, and an upsert-by-seq would silently leave it behind. The delete is
    scoped by voyage_id and touches nothing else."""
    cur.execute("delete from waypoints where voyage_id = %s", (voyage_id,))
    rows = []
    for w in waypoints:
        row = [voyage_id]
        for col in WAYPOINT_COLUMNS:
            v = w.get(col)
            if col == "media" and v is not None:
                v = psycopg2.extras.Json(v)
            row.append(v)
        rows.append(tuple(row))
    psycopg2.extras.execute_values(
        cur,
        f"insert into waypoints (voyage_id, {', '.join(WAYPOINT_COLUMNS)}) values %s",
        rows,
    )
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voyage", help="load only this slug (default: all published)")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change and roll back")
    args = ap.parse_args()

    published = atlas_slugs()
    found = bundles()

    # The same guarantee lib/data.ts enforces at compile time, enforced here
    # too: neither registry may quietly gain or lose a voyage.
    missing = published - set(found)
    extra = set(found) - published
    if missing:
        sys.exit(f"in ATLAS but no bundle in data/: {', '.join(sorted(missing))}")
    if extra:
        print(f"note: bundles not in ATLAS, skipped: {', '.join(sorted(extra))}",
              file=sys.stderr)

    targets = [args.voyage] if args.voyage else sorted(published)
    for slug in targets:
        if slug not in published:
            sys.exit(f"{slug} is not in ATLAS — refusing to load an unpublished voyage")

    # The transaction is managed explicitly rather than with `with conn:`,
    # which commits on a clean exit — leaving --dry-run depending on the order
    # of a rollback and an implicit commit. All voyages land together or none
    # do, so a failure halfway cannot leave the atlas half-loaded.
    conn = connect()
    try:
        cur = conn.cursor()
        total = 0
        for slug in targets:
            path, doc = found[slug]
            nav_id = upsert_navigator(cur, doc["navigator"])
            v_id = upsert_voyage(cur, doc["voyage"], nav_id)
            n = replace_waypoints(cur, v_id, doc.get("waypoints", []))
            total += n
            print(f"  {slug:15} navigator={nav_id:3} voyage={v_id:3} "
                  f"waypoints={n:3}  ({path.name})")
        print(f"{len(targets)} voyages, {total} waypoints")
        if args.dry_run:
            conn.rollback()
            print("dry run — rolled back, nothing written")
        else:
            conn.commit()
            print("committed")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
