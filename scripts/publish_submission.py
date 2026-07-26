#!/usr/bin/env python3
"""Turn an approved submission into a published voyage.

    python3 scripts/publish_submission.py 6
    python3 scripts/publish_submission.py 6 --dry-run

Why this exists
---------------
The Carta's process runs idea → assessment → research → draft → verification →
verdict → **ingestion**, and the last arrow did not exist. A submission could be
drafted, gated, peer-reviewed and approved by the editor, and remain invisible
forever: nothing turned it into a voyage. Darwin sat approved with 33 verified
waypoints and no row in `voyages`.

That was the mirror of the gap at the other end, where nothing carried a
generated draft to the desk. Both ends of the chain were open; the middle was
the only part anyone had built.

What it does
------------
Writes a bundle to data/<name>.json and adds the entry to ATLAS in
lib/voyages.ts, then stops. It does not commit, deploy, or touch the database.

That is deliberate. In this architecture publishing a voyage *is* a change to
the repository — ATLAS is TypeScript checked at build time, and `data/` is both
the fallback the site serves and the input to scripts/load_bundles.py. Routing
publication through git means a voyage appears by a reviewable, revertable
commit rather than by a row appearing in a table one evening. The editor's
verdict authorises publication; the commit performs it.

What it will not invent
-----------------------
A navigator record has a name and a slug and nothing else. The submission
carries no biography, no birth year, no portrait, and this script will not
supply them: an empty field is a gap someone can fill, while a plausible one is
a claim nobody checked. Voyage dates are derived from the waypoints' own
arrival dates rather than guessed.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ATLAS_TS = ROOT / "lib" / "voyages.ts"


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "unknown"


def fetch_submission(sid: int) -> dict:
    """Read straight from Postgres inside the container — the same route every
    other script here takes, and the one that avoids the host's other Postgres
    on 5432 which does not have this database."""
    out = subprocess.run(
        ["docker", "exec", "terraveler_postgres", "psql", "-U", "terraveler",
         "-d", "terraveler", "-tAc",
         f"select jsonb_build_object('status',status,'target',target_voyage,"
         f"'payload',payload) from submissions where id={int(sid)}"],
        capture_output=True, text=True)
    if out.returncode != 0 or not out.stdout.strip():
        sys.exit(f"submission {sid} not found ({out.stderr.strip()[:200]})")
    return json.loads(out.stdout.strip())


def truncate(text: str, limit: int) -> str:
    """A fallback blurb, cut at a word rather than through one. Prefer passing
    --blurb: the atlas index is the first thing a reader sees of a voyage, and
    the opening clause of a summary is rarely the sentence you would choose."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",;:—-") + "…"


def years_of(waypoints: list) -> tuple:
    ys = sorted({m.group(1) for w in waypoints
                 if (m := re.match(r"(\d{4})", str(w.get("arrival_date") or "")))})
    return (ys[0], ys[-1]) if ys else (None, None)


def to_bundle(payload: dict) -> dict:
    v = payload["voyage"]
    wps = payload.get("waypoints") or []
    nav_name = v.get("navigator") or "Unknown"
    first, last = years_of(wps)

    navigator = {
        "id": 1, "slug": slugify(nav_name), "name": nav_name,
        # Left empty on purpose — see the module docstring. A biography the
        # submission never contained is not ours to write here.
        "nationality": None, "birth_year": None, "death_year": None,
        "portrait_url": None, "bio": None,
    }
    voyage = {
        "id": 1, "navigator_id": 1, "slug": v["slug"], "title": v["title"],
        "ships": v.get("ships"), "sponsor": v.get("sponsor"),
        "purpose": None,
        "start_date": first, "end_date": last,
        "summary": v.get("summary"),
        "evidence_basis": v.get("evidence_basis"),
        "what_was_lost": v.get("what_was_lost"),
    }

    out_wps = []
    for i, w in enumerate(wps, 1):
        claims = w.get("claims") or []
        ev = (claims[0].get("evidence") if claims else None) or {}
        out_wps.append({
            "id": i, "voyage_id": 1, "seq": i,
            "place_historical": w.get("place_historical"),
            "place_modern": w.get("place_modern"),
            "latitude": w.get("latitude"), "longitude": w.get("longitude"),
            "arrival_date": w.get("arrival_date"), "departure_date": None,
            "date_note": None,
            "event": (claims[0].get("text") if claims else None) or None,
            # Verbatim or absent (Carta §3.4). A stage whose quote the verify
            # node could not confirm arrives here with no claim at all, and
            # leaves with a null excerpt rather than an approximation.
            "diary_excerpt": ev.get("quote"),
            "diary_source_citation": ev.get("source_title"),
            "diary_source_url": ev.get("source_url"),
            "confidence": w.get("confidence") or "certain",
            "media_url": None,
        })
    return {"navigator": navigator, "voyage": voyage, "waypoints": out_wps}


def atlas_entry(bundle: dict, blurb: str) -> str:
    v, n = bundle["voyage"], bundle["navigator"]
    years = f'{v["start_date"]}–{v["end_date"]}' if v["start_date"] else ""
    return (
        "  {\n"
        f'    slug: "{v["slug"]}",\n'
        f'    href: "/voyage/{v["slug"]}",\n'
        f'    title: {json.dumps(v["title"])},\n'
        f'    navigator: {json.dumps(n["name"])},\n'
        f'    years: "{years}",\n'
        f'    blurb:\n      {json.dumps(blurb)},\n'
        "  },\n"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("submission_id", type=int)
    ap.add_argument("--file", help="bundle filename stem (default: the slug)")
    ap.add_argument("--blurb", default="", help="one line for the atlas index")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="publish a submission that is not approved (records why in the output)")
    args = ap.parse_args()

    row = fetch_submission(args.submission_id)
    if row["status"] != "approved" and not args.force:
        sys.exit(f"submission {args.submission_id} is '{row['status']}', not 'approved'. "
                 f"The editor's verdict is what authorises publication (Carta §5).")

    bundle = to_bundle(row["payload"])
    slug = bundle["voyage"]["slug"]
    stem = args.file or slug
    path = DATA / f"{stem}.json"
    quoted = sum(1 for w in bundle["waypoints"] if w["diary_excerpt"])
    blurb = args.blurb or truncate(bundle["voyage"]["summary"] or "", 180)

    print(f"submission {args.submission_id}  status={row['status']}")
    print(f"  slug      {slug}")
    print(f"  navigator {bundle['navigator']['name']} ({bundle['navigator']['slug']})")
    print(f"  years     {bundle['voyage']['start_date']}–{bundle['voyage']['end_date']}")
    print(f"  waypoints {len(bundle['waypoints'])}, {quoted} with a verified excerpt")
    print(f"  bundle    {path.relative_to(ROOT)}")

    atlas = ATLAS_TS.read_text(encoding="utf-8")
    already = f'slug: "{slug}"' in atlas
    print(f"  ATLAS     {'already present — will not duplicate' if already else 'entry will be added'}")

    if args.dry_run:
        print("\ndry run — nothing written\n")
        print(atlas_entry(bundle, blurb))
        return

    path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if not already:
        # Appended before the closing bracket of ATLAS_ENTRIES. The build fails
        # if this and data/ ever disagree, which is the guarantee that keeps a
        # voyage from shipping half-visible — so the two writes stay together.
        marker = "] as const satisfies readonly AtlasEntry[];"
        if marker not in atlas:
            sys.exit(f"could not find the end of ATLAS_ENTRIES in {ATLAS_TS} — "
                     f"add the entry by hand:\n\n{atlas_entry(bundle, blurb)}")
        atlas = atlas.replace(marker, atlas_entry(bundle, blurb) + marker)
        ATLAS_TS.write_text(atlas, encoding="utf-8")

    print(f"\nwritten. Next, and deliberately not automatic:")
    print(f"  1. add the bundle import + LOCAL entry in lib/data.ts (the build will tell you)")
    print(f"  2. npm run build   — proves ATLAS and data/ agree")
    print(f"  3. review the diff and commit: publication is a reviewable change, not a side effect")
    print(f"  4. python3 scripts/load_bundles.py   — put it in Postgres too")


if __name__ == "__main__":
    main()
