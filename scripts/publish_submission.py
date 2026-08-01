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


def fetch_provenance(submission_id: int, meta: dict) -> dict:
    """Carta §3.5: provenance recorded forever. `ideator` and `scribe_model`
    come from the submission's own declared meta (Carta 2: humans submit
    intent, AI drafts — the `meta` block in app/api/mcp/route.ts). carta_version
    is read from the audit_log's approving verdict rather than payload.meta:
    lib/carta.ts makes the same distinction for the same reason — the audit
    trail is the record of which rules actually governed a decision, and a
    draft's self-declared version can be (harmlessly) older than the one it
    was judged under. Falls back to the declared version when no approving
    verdict is on record, which only happens under --force."""
    out = subprocess.run(
        ["docker", "exec", "terraveler_postgres", "psql", "-U", "terraveler",
         "-d", "terraveler", "-tAc",
         f"select carta_version, created_at from audit_log where submission_id={int(submission_id)} "
         f"and action='verdict' and verdict='approve' order by created_at desc limit 1"],
        capture_output=True, text=True)
    line = out.stdout.strip() if out.returncode == 0 else ""
    verdict_carta, _, approved_at = line.partition("|")
    # Contributor-supplied free text headed for a public bundle: the gate only
    # checks these exist (lib/gate.ts). Control characters go, length is
    # capped — attribution needs a name, not a payload.
    def clean(v):
        if v is None:
            return None
        return re.sub(r"[\x00-\x1f\x7f]", " ", str(v))[:200].strip() or None

    return {
        "ideator": clean(meta.get("ideator")),
        "scribe_model": clean(meta.get("scribe_model")),
        "carta_version": verdict_carta or meta.get("carta_version"),
        # §3.5 names the date alongside ideator, model and version. This is
        # the date of the approving verdict — the moment the work became
        # publishable — not of the publication run, which audit_log's own
        # 'publish' row records for itself.
        "date": approved_at or None,
        "submission_id": submission_id,
    }


def record_publication(submission_id: int, slug: str, carta_version: str,
                       approved: bool) -> None:
    """Carta §3.5: the audit trail is where provenance lives forever, and
    every other step that changes a submission's disposition writes to it —
    desk_review.py's verdicts, the web desk's overrides and appeals.
    Publication was the one step in the chain that left no row: a bundle
    could appear in data/ and ATLAS with nothing in audit_log to say when it
    shipped or that it happened at all."""
    # A --force publication of an unapproved submission is a human's escape
    # hatch, and it stays one: 'publish-forced' is deliberately unmapped in
    # the outbox trigger, so no submission.published event — whose contract
    # asserts an approved verdict, and whose consumer is the Publisher —
    # announces a state that does not hold. The ledger still records it.
    action = "publish" if approved else "publish-forced"
    findings = json.dumps([["INFO", 0, f"published data/{slug}.json"]])
    # carta_version can come from an unapproved submission's self-declared
    # meta (the --force fallback in fetch_provenance) rather than the trusted
    # audit_log row, so it is untrusted input and gets the same single-quote
    # escaping a parameterised query would give it for free.
    safe_carta = str(carta_version).replace("'", "''")
    sql = (
        "insert into audit_log (submission_id, actor, action, findings, carta_version) "
        f"values ({int(submission_id)}, 'editor-in-chief', '{action}', "
        f"$json${findings}$json$::jsonb, '{safe_carta}')"
    )
    out = subprocess.run(
        ["docker", "exec", "terraveler_postgres", "psql", "-U", "terraveler",
         "-d", "terraveler", "-c", sql],
        capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"bundle written but the audit_log entry failed: {out.stderr.strip()[:300]}")


def fetch_spans(submission_id: int) -> dict:
    """The spans the desk located in the sources, or nothing.

    Nothing is a refusal, not a default. Publishing from the submitted payload
    when this is empty is precisely the hole an external review walked through:
    every gate reported PASS and the atlas printed a sentence the source does
    not contain."""
    out = subprocess.run(
        ["docker", "exec", "terraveler_postgres", "psql", "-U", "terraveler",
         "-d", "terraveler", "-tAc",
         f"select coalesce(spans::text,'{{}}') from verified_spans "
         f"where submission_id={int(submission_id)}"],
        capture_output=True, text=True)
    if out.returncode != 0 or not out.stdout.strip():
        return {}
    return json.loads(out.stdout.strip())


def to_bundle(payload: dict, spans: dict, provenance: dict) -> dict:
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
        span = spans.get(f"{w.get('seq')}.1") or {}
        out_wps.append({
            "id": i, "voyage_id": 1, "seq": i,
            "place_historical": w.get("place_historical"),
            "place_modern": w.get("place_modern"),
            "latitude": w.get("latitude"), "longitude": w.get("longitude"),
            "arrival_date": w.get("arrival_date"), "departure_date": None,
            "date_note": None,
            "event": (claims[0].get("text") if claims else None) or None,
            # Verbatim or absent (Carta §3.4), and "verbatim" means the span
            # located in the source — never `ev["quote"]`, which is whatever the
            # contributor typed. Publishing that was how a draft arriving
            # through MCP could put "the voyage began." on a page printing
            # "The Voyage began." with every gate reporting PASS. There is no
            # fallback here on purpose: a quotation with no verified span is
            # not published, and the run says so rather than approximating.
            "diary_excerpt": span.get("reading_span"),
            # Carta §3.4's other half: the untouched span stored beside the
            # readable one, and what was done to get from one to the other —
            # both additive, both optional on read (older bundles have
            # neither), never a replacement for diary_excerpt itself.
            "diary_excerpt_raw": span.get("raw_span"),
            "diary_excerpt_transformations": span.get("transformations"),
            "diary_source_citation": ev.get("source_title"),
            "diary_source_url": ev.get("source_url"),
            "confidence": w.get("confidence") or "certain",
            "media_url": None,
        })
    return {"navigator": navigator, "voyage": voyage, "waypoints": out_wps,
            # Carta §3.5: who asked, what drafted it, under which constitution,
            # traceable back to the submission that carried it all. Additive at
            # the top level, next to voyage/waypoints rather than folded into
            # either — it describes the bundle's origin, not the voyage itself.
            "provenance": provenance}


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
    ap.add_argument("--allow-missing-spans", action="store_true",
                    help="publish a submission with quotations but no verified_spans row at "
                         "all — legacy data from before that table existed. Refused without "
                         "this flag; publishes with no diary_excerpt for those quotations "
                         "when given.")
    args = ap.parse_args()

    row = fetch_submission(args.submission_id)
    if row["status"] != "approved" and not args.force:
        sys.exit(f"submission {args.submission_id} is '{row['status']}', not 'approved'. "
                 f"The editor's verdict is what authorises publication (Carta §5).")

    spans = fetch_spans(args.submission_id)
    quoted_claims = sum(1 for w in (row["payload"].get("waypoints") or [])
                        for c in (w.get("claims") or [])
                        if (c.get("evidence") or {}).get("quote"))
    if quoted_claims and not spans:
        # No verified_spans row at all — either this predates the mechanism
        # (supabase/verified_spans.sql, added under Carta 0.5) or it never
        # went through scripts/desk_review.py. Carta 3.4 has no fallback to
        # the contributor's own typing, so this cannot proceed unannounced —
        # but a genuinely legacy submission is a known, named case rather
        # than a defect, so it is an opt-in rather than an unconditional
        # refusal.
        if not args.allow_missing_spans:
            sys.exit(
                f"submission {args.submission_id} carries {quoted_claims} quotation(s) and has no "
                f"verified spans. Carta 3.4: what the atlas prints is the span located in the "
                f"source, not the text the contributor typed — and there is deliberately no "
                f"fallback to the latter.\n"
                f"Run:  python3 scripts/desk_review.py {args.submission_id}\n"
                f"Or, if this is legacy data from before verified_spans existed and you mean to "
                f"publish it with no diary_excerpt for its quotations: rerun with "
                f"--allow-missing-spans.")
        print(f"  ⚠ no verified spans for submission {args.submission_id} — publishing "
              f"{quoted_claims} quotation(s) with no diary_excerpt, by --allow-missing-spans.")

    meta = (row["payload"].get("meta")) or {}
    provenance = fetch_provenance(args.submission_id, meta)
    bundle = to_bundle(row["payload"], spans, provenance)

    if spans:
        # spans is non-empty, so the submission WAS verified — a quotation
        # missing its own entry here is not the legacy case above, it is a
        # gap in an otherwise-verified draft. Publishing it silently is
        # exactly how "PASS — VERIFIED VERBATIM" printed a sentence the
        # source never held (supabase/verified_spans.sql), so no flag
        # overrides this one.
        dropped = [w["seq"] for w in bundle["waypoints"]
                   if w["diary_excerpt"] is None and any(
                       (cl.get("evidence") or {}).get("quote")
                       for src in (row["payload"].get("waypoints") or [])
                       if src.get("seq") == w["seq"]
                       for cl in (src.get("claims") or []))]
        if dropped:
            sys.exit(
                f"submission {args.submission_id} has verified spans but is missing one for "
                f"stage(s) {dropped}, each of which offered a quotation. Carta 3.4 promises the "
                f"raw span beside the readable one for every quotation published — publishing "
                f"without it would drop that promise silently.\n"
                f"Run:  python3 scripts/desk_review.py {args.submission_id}")
    slug = bundle["voyage"]["slug"]
    # The slug is contributor-controlled (lib/gate.ts validates meta, claims
    # and licences — it never looks at voyage.slug) and from here it reaches a
    # filesystem path, a psql statement and generated TypeScript. A slug that
    # is not already its own slugification is refused, not repaired: repairing
    # would publish under a name nobody submitted, and the whole class of
    # traversal/quoting escapes lives exactly in the characters slugify()
    # would have removed.
    if not slug or slug != slugify(slug):
        sys.exit(f"submission {args.submission_id} declares voyage.slug {slug!r}, which is not "
                 f"a clean slug (expected {slugify(slug or 'unknown')!r}). A slug names a file "
                 f"in data/, an entry in lib/voyages.ts and an audit row — it gets no "
                 f"characters beyond [a-z0-9-].")
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
    print(f"  provenance ideator={provenance['ideator']!r} "
          f"scribe_model={provenance['scribe_model']!r} carta={provenance['carta_version']!r}")

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

    record_publication(args.submission_id, slug, provenance["carta_version"] or "unknown",
                       approved=row["status"] == "approved")

    print(f"\nwritten. Next, and deliberately not automatic:")
    print(f"  1. add the bundle import + LOCAL entry in lib/data.ts (the build will tell you)")
    print(f"  2. npm run build   — proves ATLAS and data/ agree")
    print(f"  3. review the diff and commit: publication is a reviewable change, not a side effect")
    print(f"  4. python3 scripts/load_bundles.py   — put it in Postgres too")


if __name__ == "__main__":
    main()
