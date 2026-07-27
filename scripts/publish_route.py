#!/usr/bin/env python3
"""Publish a voyage whose record was destroyed.

    python3 scripts/publish_route.py data/routes/dias-1487.json
    python3 scripts/publish_route.py data/routes/dias-1487.json --dry-run

Why this exists
---------------
Magna Carta §3.6 recognises four evidence bases, and two of them describe a
voyage with no quotable narrative: `later-chronicle`, written afterwards from
sources that no longer exist, and `reconstructed`, where no narrative source
survives at all. The atlas could not publish either, because the only route in
was the ingestion pipeline, and the pipeline needs public-domain narrative text
to quote from. A voyage whose records burned cannot supply that by definition.

So §3.6 was half true. It named a category the atlas had no way to hold, and
Bartolomeu Dias — the case the clause was written for — could not be published
through any path. The Portuguese maritime archive burned in the Lisbon
earthquake of 1755; what survives is João de Barros writing sixty years later,
in Portuguese, which the language gate would null on sight.

This is the other path. A route is asserted by the editor from established
scholarship, with every position's precision declared, and **no excerpts at
all**. That is not a weaker version of a voyage. It is the honest shape of one
whose evidence is gone, and refusing to draw it would promote an accident of the
archive into a verdict on who mattered in history.

What it will not let through
----------------------------
A route file is refused unless it is genuinely this case: the evidence basis
must be one of the two, no waypoint may carry an excerpt, the voyage must cite
the source its route comes from even though nothing is quoted from it (§3.1 —
no source, no entry), and `what_was_lost` must say what is missing and how it
went. A journal-tier voyage belongs in the pipeline, and this script says so
rather than offering a shortcut around verification.
"""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ATLAS_TS = ROOT / "lib" / "voyages.ts"

# The two bases that describe a voyage with nothing to quote. A
# contemporary-journal or contemporary-testimony voyage has a text, and a text
# belongs in the pipeline where every claim is checked against it.
ROUTELESS_BASES = {"later-chronicle", "reconstructed"}
CONFIDENCES = {"certain", "approximate", "reconstructed", "contested"}


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower() or "unknown"


def fail(msg: str):
    sys.exit(f"refused: {msg}")


def validate(route: dict) -> None:
    v = route.get("voyage") or {}
    for f in ("slug", "title", "navigator", "summary", "evidence_basis",
              "what_was_lost", "route_source", "route_source_url"):
        if not str(v.get(f) or "").strip():
            fail(f"voyage.{f} is required")

    if v["evidence_basis"] not in ROUTELESS_BASES:
        fail(f"evidence_basis is '{v['evidence_basis']}'. This path is only for "
             f"{sorted(ROUTELESS_BASES)} — a voyage with a text to quote belongs in "
             f"the ingestion pipeline, where every claim is checked against it.")

    wps = route.get("waypoints") or []
    if not wps:
        fail("a route with no waypoints is not a route")

    seen = set()
    for w in wps:
        tag = f"waypoint {w.get('seq', '?')} '{w.get('place_historical', '?')}'"
        for f in ("seq", "place_historical", "latitude", "longitude", "confidence"):
            if w.get(f) in (None, ""):
                fail(f"{tag}: {f} is required")
        if w["seq"] in seen:
            fail(f"{tag}: duplicate seq")
        seen.add(w["seq"])
        if w["confidence"] not in CONFIDENCES:
            fail(f"{tag}: confidence '{w['confidence']}' is not one of {sorted(CONFIDENCES)}")
        # The whole point. An excerpt here would be a quotation nobody verified
        # against a source nobody can read, which is the one thing the Carta
        # forbids outright.
        if w.get("diary_excerpt"):
            fail(f"{tag}: carries a diary_excerpt. This path publishes routes "
                 f"without quotations — if there is a verifiable passage, the "
                 f"voyage belongs in the pipeline (Carta 3.4).")
        if not str(w.get("arrival_date") or w.get("date_note") or "").strip():
            fail(f"{tag}: needs an arrival_date or a date_note. A stage nobody can "
                 f"place in time still has to say so.")

    # Chronology: the same rule the pipeline applies, applied here too.
    def year(w):
        m = re.match(r"(\d{3,4})", str(w.get("arrival_date") or ""))
        return int(m.group(1)) if m else None
    ordered = sorted(wps, key=lambda w: w["seq"])
    prev = None
    for w in ordered:
        y = year(w)
        if y and prev and y < prev:
            fail(f"waypoint {w['seq']} '{w['place_historical']}' is dated {y} but "
                 f"follows a stage dated {prev}. A voyage runs forwards.")
        if y:
            prev = y


def to_bundle(route: dict) -> dict:
    v = route["voyage"]
    wps = sorted(route["waypoints"], key=lambda w: w["seq"])
    years = [m.group(1) for w in wps
             if (m := re.match(r"(\d{3,4})", str(w.get("arrival_date") or "")))]
    nav = {
        "id": 1, "slug": slugify(v["navigator"]), "name": v["navigator"],
        "nationality": v.get("nationality"), "birth_year": v.get("birth_year"),
        "death_year": v.get("death_year"), "portrait_url": None, "bio": None,
    }
    voyage = {
        "id": 1, "navigator_id": 1, "slug": v["slug"], "title": v["title"],
        "ships": v.get("ships"), "sponsor": v.get("sponsor"), "purpose": None,
        "start_date": v.get("start_date") or (years[0] if years else None),
        "end_date": v.get("end_date") or (years[-1] if years else None),
        "summary": v["summary"],
        "evidence_basis": v["evidence_basis"],
        "what_was_lost": v["what_was_lost"],
    }
    out = []
    for i, w in enumerate(wps, 1):
        out.append({
            "id": i, "voyage_id": 1, "seq": i,
            "place_historical": w["place_historical"],
            "place_modern": w.get("place_modern"),
            "latitude": w["latitude"], "longitude": w["longitude"],
            "arrival_date": w.get("arrival_date"), "departure_date": None,
            "date_note": w.get("date_note"),
            "event": w.get("event"),
            # Never a quotation. The source of the *route* is cited on the
            # voyage; no stage claims words nobody can check.
            "diary_excerpt": None,
            "diary_source_citation": v["route_source"],
            "diary_source_url": v["route_source_url"],
            "confidence": w["confidence"],
            "media_url": None,
        })
    return {"navigator": nav, "voyage": voyage, "waypoints": out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--blurb", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    route = json.loads(Path(args.path).read_text(encoding="utf-8"))
    validate(route)
    bundle = to_bundle(route)
    v = bundle["voyage"]
    conf = {}
    for w in bundle["waypoints"]:
        conf[w["confidence"]] = conf.get(w["confidence"], 0) + 1

    print(f"route     {args.path}")
    print(f"  slug    {v['slug']}  ({v['evidence_basis']})")
    print(f"  stages  {len(bundle['waypoints'])}, no excerpts by design")
    print(f"  each    {', '.join(f'{n} {k}' for k, n in sorted(conf.items()))}")
    print(f"  route from  {route['voyage']['route_source']}")

    if args.dry_run:
        print("dry run — nothing written")
        return

    out = DATA / f"{v['slug']}.json"
    out.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    atlas = ATLAS_TS.read_text(encoding="utf-8")
    if f'slug: "{v["slug"]}"' not in atlas:
        years = f'{v["start_date"]}–{v["end_date"]}' if v["start_date"] else ""
        entry = ("  {\n"
                 f'    slug: "{v["slug"]}",\n'
                 f'    href: "/voyage/{v["slug"]}",\n'
                 f'    title: {json.dumps(v["title"])},\n'
                 f'    navigator: {json.dumps(bundle["navigator"]["name"])},\n'
                 f'    years: "{years}",\n'
                 f'    blurb:\n      {json.dumps(args.blurb or v["summary"][:180])},\n'
                 "  },\n")
        marker = "] as const satisfies readonly AtlasEntry[];"
        if marker not in atlas:
            sys.exit(f"could not find the end of ATLAS_ENTRIES — add by hand:\n\n{entry}")
        ATLAS_TS.write_text(atlas.replace(marker, entry + marker), encoding="utf-8")

    print(f"\nwritten {out.relative_to(ROOT)}. Then: wire lib/data.ts, npm run build, "
          f"review the diff, commit, and scripts/load_bundles.py.")


if __name__ == "__main__":
    main()
