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

A second submission type: waypoint-enrichment
-----------------------------------------------
`payload["meta"]["type"] == "waypoint-enrichment"` does not describe a new
voyage — `payload["voyage"]` does not even exist for it. It names an existing
voyage (`meta.target_voyage`, e.g. "boudeuse-1766") and carries waypoints that
either add detail to a stop already published or describe a stop the original
bundle never had (Aotourou's own itinerary continues well past where
Bougainville's own voyage ends in the bundle). This path patches the existing
data/<file>.json in place and never touches ATLAS — the voyage already has an
index entry, and this is not a new one. See apply_waypoint_enrichment() for
the merge/append decision, which cannot simply trust the submission's own
`seq` against the bundle's: a waypoint-enrichment submission numbers its own
waypoints from 1, independent of the target voyage's numbering, so a `seq`
collision is exactly as likely to mean "unrelated stop that happens to share a
small integer" as "the same stop." Only `new-voyage` and `waypoint-enrichment`
are handled; every other submission type (idea, content-suggestion,
correction, feature-suggestion) has a payload shape "publishing" doesn't yet
have a definition for, and main() fails loudly on those rather than guessing.

Embedding, automatically
-------------------------
A publish that succeeds — bundle written, audit_log recorded — now also calls
into scripts/embed_published.py's own logic in-process (see run_embed()) so
that a real publish and its embedding stop being two manual commands. This
does not change what publishing itself does or does not touch: embedding
writes straight to Postgres's rag_docs today (scripts/embed_published.py's
own architecture, already independent of git), so folding it into this
command is not a second exception to "publication goes through a reviewable
commit" — it was never inside that rule to begin with. A --dry-run never
reaches this call, and neither does a --force publish of a submission that
was never approved ('publish-forced' in audit_log): embed_published.py's own
logic already refuses to treat that action as authorising an embed, so this
script honours the same line rather than working around it. --no-embed is the
escape hatch for a publish that shouldn't also spend an embedding call.
"""
import argparse
import calendar
import json
import os
import re
import subprocess
import sys
import unicodedata
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ATLAS_TS = ROOT / "lib" / "voyages.ts"
LIB_DATA_TS = ROOT / "lib" / "data.ts"
VISUAL_PROFILES = ("mesoamerica", "andes", "marine-chart", "mariner", "unillustrated")
SUBMISSION_TYPES = ("new-voyage", "waypoint-enrichment")


def visual_profile(voyage: dict, waypoints: list) -> str:
    """Conservative, reviewable default from structured geography and vessel.

    A place can be on a multi-region route, so a single coordinate never
    licenses a regional engraving. Unknown contexts stay unillustrated.
    The editor may override this suggestion before committing the bundle.
    """
    if voyage.get("kind") in ("space", "surface") or voyage.get("body") not in (None, "earth"):
        return "unillustrated"

    positions = []
    for waypoint in waypoints:
        try:
            positions.append((float(waypoint["latitude"]), float(waypoint["longitude"])))
        except (KeyError, TypeError, ValueError):
            continue
    if len(positions) >= 2:
        mesoamerican = sum(10 <= lat <= 33 and -118 <= lon <= -86 for lat, lon in positions)
        andean = sum(-24 <= lat <= 6 and -82 <= lon <= -66 for lat, lon in positions)
        if mesoamerican >= 2 and mesoamerican / len(positions) >= 0.6:
            return "mesoamerica"
        if andean >= 2 and andean / len(positions) >= 0.6:
            return "andes"
    if voyage.get("ships"):
        return "marine-chart"
    return "unillustrated"


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


def normalize_provenance(existing) -> list:
    """A bundle's "provenance" field has worn three shapes across this
    project's history: absent entirely (everything published before
    6457eab, and the handful — Bougainville among them — authored outside
    this script altogether), a single object (every to_bundle() bundle from
    6457eab until this fix, which is what a submission's OWN publication
    overwrote), and now a list, one entry per publication that ever touched
    the bundle. This is the one place that reconciles all three into the
    list shape, so a caller never has to re-learn the history."""
    if existing is None:
        return []
    if isinstance(existing, list):
        return existing
    return [existing]


def provenance_entry(provenance: dict, submission_type: str, waypoints: list) -> dict:
    """One publication's record, Carta §3.5 plus what it actually touched.
    `waypoints` is the sorted list of seq numbers this publication wrote or
    created — every one of them for a new-voyage bundle (there is nothing
    else yet), a subset for a waypoint-enrichment. Kept as its own function
    so the shape is defined once rather than duplicated between to_bundle()
    and publish_waypoint_enrichment()."""
    return {**provenance, "type": submission_type, "waypoints": waypoints}


def append_provenance(bundle: dict, entry: dict) -> list:
    """The accumulation itself: whatever the bundle already carries (in
    any of the three shapes normalize_provenance() reconciles), plus this
    publication's own entry. Additive always — a later publication's
    provenance is recorded beside the earlier ones, never in place of them,
    which is what §3.5's "recorded forever" actually requires once a voyage
    can be published into more than once."""
    return normalize_provenance(bundle.get("provenance")) + [entry]


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
            # A list from the start, of one entry, because a voyage is never
            # published only once: publish_waypoint_enrichment() appends to
            # this same list rather than overwriting it (see append_provenance).
            "provenance": [provenance_entry(provenance, "new-voyage",
                                             [w["seq"] for w in out_wps])]}


def atlas_entry(bundle: dict, blurb: str, profile: str) -> str:
    v, n = bundle["voyage"], bundle["navigator"]
    years = f'{v["start_date"]}–{v["end_date"]}' if v["start_date"] else ""
    return (
        "  {\n"
        f'    slug: "{v["slug"]}",\n'
        f'    visualProfile: "{profile}",\n'
        f'    href: "/voyage/{v["slug"]}",\n'
        f'    title: {json.dumps(v["title"])},\n'
        f'    navigator: {json.dumps(n["name"])},\n'
        f'    years: "{years}",\n'
        f'    blurb:\n      {json.dumps(blurb)},\n'
        "  },\n"
    )


def resolve_data_file(slug: str) -> Path:
    """Map a target_voyage slug to its data/<file>.json.

    The published filename is not the slug: data/bougainville.json holds
    voyage.slug == "boudeuse-1766" (named for the navigator, not the ship),
    so the mapping cannot be "grep the filename." lib/data.ts's LOCAL map is
    the one place this correspondence is asserted as a checked TypeScript
    type (VoyageSlug keys every import), so it is read first — but it is
    read as a lead, not as proof: the result is always cross-checked against
    the candidate file's own voyage.slug before it is trusted. A slug that
    map does not know (or a parse that finds nothing, e.g. the file's shape
    changes) falls back to scanning every data/*.json for the one whose own
    voyage.slug matches, refusing outright if more than one does rather than
    guessing.
    """
    slug_to_name: dict[str, str] = {}
    name_to_file: dict[str, str] = {}
    if LIB_DATA_TS.exists():
        text = LIB_DATA_TS.read_text(encoding="utf-8")
        name_to_file = dict(re.findall(r'import\s+(\w+)\s+from\s+"@/data/([\w.-]+)\.json";', text))
        local_block = re.search(r"const LOCAL:[^=]*=\s*\{(.*?)\n\};", text, re.S)
        if local_block:
            slug_to_name = dict(re.findall(r'"([\w-]+)":\s*(\w+),', local_block.group(1)))

    path = None
    name = slug_to_name.get(slug)
    if name and name in name_to_file:
        candidate = DATA / f"{name_to_file[name]}.json"
        if candidate.exists():
            path = candidate

    if path is None:
        found = []
        for candidate in sorted(DATA.glob("*.json")):
            try:
                doc = json.loads(candidate.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(doc, dict):
                # data/space_events.json is a bare list (a different shape
                # entirely, not a voyage bundle) — not every file under
                # data/ is one of these.
                continue
            if (doc.get("voyage") or {}).get("slug") == slug:
                found.append(candidate)
        if len(found) == 1:
            path = found[0]
        elif len(found) > 1:
            sys.exit(f"more than one data/*.json declares voyage.slug {slug!r}: "
                     f"{[str(f.relative_to(ROOT)) for f in found]} — refusing to guess which one "
                     f"target_voyage means.")

    if path is None:
        sys.exit(f"no data/*.json found for target_voyage {slug!r} (checked {LIB_DATA_TS.relative_to(ROOT)}'s "
                 f"LOCAL map and every data/*.json's own voyage.slug). A waypoint-enrichment names a "
                 f"voyage that must already be published — this script does not create one.")

    doc = json.loads(path.read_text(encoding="utf-8"))
    found_slug = (doc.get("voyage") or {}).get("slug")
    if found_slug != slug:
        sys.exit(f"{path.relative_to(ROOT)} declares voyage.slug {found_slug!r}, not the {slug!r} "
                 f"this submission targets — the mapping and the file disagree, refusing to publish "
                 f"into what may be the wrong voyage.")
    return path


# --- waypoint matching (enrichment vs. new) -------------------------------
#
# A waypoint-enrichment submission numbers its own `waypoints` from 1 — that
# numbering is scoped to the submission, not to the target bundle's global
# seq. Submission #97 (Aotourou's own itinerary, grafted onto
# boudeuse-1766) is the case that proves it: its seq 1..8 collide with the
# bundle's existing seq 1..15 by pure coincidence of both starting at 1,
# while describing almost entirely different stops (seq 1 is Tahiti in the
# submission and Brest in the bundle). Treating equal seq as "the same
# waypoint" here would silently overwrite Brest with Tahiti. So identity is
# decided by content instead — a place both records name in common, and a
# date the bundle's own [arrival_date, departure_date] window for that stop
# contains (with a small buffer for a diarist's approximate day) — and only
# a submission waypoint that matches nothing already published is treated as
# new.

_PLACE_STOPWORDS = {"isle", "isles", "new", "the", "of", "and", "via", "des",
                     "de", "la", "du", "le", "les", "port"}
_DATE_BUFFER = timedelta(days=5)


def _normalize_place_tokens(text, strip_trailing_region=False) -> set:
    if not text:
        return set()
    text = str(text)
    if strip_trailing_region and "," in text:
        # place_modern in this data follows "<city>, <country/region>" — the
        # trailing segment is usually a country, which is far too weak a
        # signal on its own (two different French waypoints both mention
        # "France"). Dropping it before tokenizing is what stops that: seq5
        # "Paris, France" must not match "Saint-Malo, France" just because
        # they share a country, and did in an earlier version of this
        # function until this fix. place_historical has no such convention
        # (free-form names like "Isle de France") and is left untouched.
        text = text.rsplit(",", 1)[0]
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return {t for t in re.findall(r"[a-z0-9]+", s)
            if len(t) >= 4 and t not in _PLACE_STOPWORDS}


def _modern_tokens(text) -> set:
    return _normalize_place_tokens(text, strip_trailing_region=True)


def _historical_tokens(text) -> set:
    return _normalize_place_tokens(text, strip_trailing_region=False)


def _date_bounds(value):
    """The [earliest, latest] a partial date (YYYY, YYYY-MM or YYYY-MM-DD)
    could mean, or None if it does not parse. Used only for a coarse
    closeness check, never written to a bundle — arrival_date itself is
    passed through verbatim wherever it is stored."""
    if not value:
        return None
    m = re.match(r"^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$", str(value).strip())
    if not m:
        return None
    year = int(m.group(1))
    try:
        if m.group(2):
            month = int(m.group(2))
            if m.group(3):
                day = int(m.group(3))
                d = date(year, month, day)
                return (d, d)
            last = calendar.monthrange(year, month)[1]
            return (date(year, month, 1), date(year, month, last))
        return (date(year, 1, 1), date(year, 12, 31))
    except ValueError:
        return None


def _dates_close(sub_date, existing_arrival, existing_departure) -> bool:
    sub = _date_bounds(sub_date)
    arrival = _date_bounds(existing_arrival)
    if sub is None or arrival is None:
        return False
    departure = _date_bounds(existing_departure)
    lo = arrival[0] - _DATE_BUFFER
    hi = (departure[1] if departure else arrival[1]) + _DATE_BUFFER
    return sub[0] <= hi and sub[1] >= lo


def find_existing_match_index(sub_wp: dict, existing_waypoints: list) -> "int | None":
    for i, ex in enumerate(existing_waypoints):
        sub_modern, sub_hist = _modern_tokens(sub_wp.get("place_modern")), _historical_tokens(sub_wp.get("place_historical"))
        ex_modern, ex_hist = _modern_tokens(ex.get("place_modern")), _historical_tokens(ex.get("place_historical"))
        places_match = bool(
            (sub_modern & ex_modern) or (sub_hist & ex_hist)
            or (sub_modern & ex_hist) or (sub_hist & ex_modern)
        )
        if places_match and _dates_close(sub_wp.get("arrival_date"),
                                          ex.get("arrival_date"), ex.get("departure_date")):
            return i
    return None


def merge_enrichment_waypoint(existing: dict, sub_wp: dict, spans: dict, notes: list) -> dict:
    """Enrich an already-published waypoint without deleting anything it
    already carries.

    The bundle schema gives each waypoint exactly one `event` paragraph and
    one verified quotation (diary_excerpt + its own citation) — there is no
    slot for a second, independent narrative thread or a second verified
    span. So enrichment here means: append the prose the submission adds
    (never overwrite, never duplicate a sentence already present), fill any
    field that is currently empty with what the submission supplies, add any
    new imagery (media is already a list — purely additive, deduped by url),
    and — because the one diary_excerpt slot is shared with its own
    citation as a unit — only ever populate it from empty. A verified span
    for a waypoint that already carries one has nowhere to go without
    mismatching its existing citation, so it is recorded as a note for an
    editor to apply by hand rather than silently dropped or silently
    clobbering the first citation.
    """
    out = dict(existing)
    seq = sub_wp.get("seq")
    place = out.get("place_historical") or out.get("place_modern") or f"seq {out.get('seq')}"

    for field, value in (
        ("latitude", sub_wp.get("latitude")), ("longitude", sub_wp.get("longitude")),
        ("place_historical", sub_wp.get("place_historical")),
        ("place_modern", sub_wp.get("place_modern")),
        ("arrival_date", sub_wp.get("arrival_date")),
        ("date_note", sub_wp.get("date_note")),
    ):
        if out.get(field) in (None, "") and value not in (None, ""):
            out[field] = value

    claim_texts = [c.get("text") for c in (sub_wp.get("claims") or []) if c and c.get("text")]
    addition = " ".join(t for t in claim_texts if t and t not in (out.get("event") or ""))
    if addition:
        out["event"] = f"{out['event']} {addition}".strip() if out.get("event") else addition

    span = spans.get(f"{seq}.1") or {}
    if span.get("reading_span") and not out.get("diary_excerpt"):
        claims = sub_wp.get("claims") or []
        ev = (claims[0].get("evidence") if claims else None) or {}
        out["diary_excerpt"] = span.get("reading_span")
        out["diary_excerpt_raw"] = span.get("raw_span")
        out["diary_excerpt_transformations"] = span.get("transformations")
        out["diary_source_citation"] = ev.get("source_title")
        out["diary_source_url"] = ev.get("source_url")
        notes.append(f"  waypoint {out['seq']} ({place}): added a verified excerpt")
    elif span.get("reading_span"):
        notes.append(f"  waypoint {out['seq']} ({place}): has a newly verified span but already "
                     f"carries a diary_excerpt — one quotation per waypoint in this schema, so this "
                     f"one is noted, not applied; an editor can swap it in by hand")

    media = list(out.get("media") or [])
    have = {m.get("url") for m in media}
    added_media = 0
    for plate in sub_wp.get("plates") or []:
        if not plate.get("url") or plate["url"] in have:
            continue
        media.append({"url": plate.get("url"), "caption": plate.get("caption"),
                      "credit": plate.get("credit"), "source_url": plate.get("source_url"),
                      "license": plate.get("license")})
        have.add(plate["url"])
        added_media += 1
    if added_media:
        out["media"] = media

    if addition or added_media:
        bits = []
        if addition:
            bits.append(f"+{len(claim_texts)} claim(s) merged into event")
        if added_media:
            bits.append(f"+{added_media} image(s)")
        notes.append(f"  waypoint {out['seq']} ({place}): enriched, {', '.join(bits)}")
    return out


def new_enrichment_waypoint(sub_wp: dict, spans: dict, seq: int, wp_id: int) -> dict:
    """A submission waypoint that matches nothing already published — built
    the same way to_bundle() builds a brand-new waypoint (claims[0] as the
    event, a verified span as the only source of diary_excerpt, never
    ev["quote"]), with a fresh seq/id in the bundle's own numbering rather
    than whatever the submission called it."""
    claims = sub_wp.get("claims") or []
    ev = (claims[0].get("evidence") if claims else None) or {}
    span = spans.get(f"{sub_wp.get('seq')}.1") or {}
    media = [{"url": p.get("url"), "caption": p.get("caption"), "credit": p.get("credit"),
             "source_url": p.get("source_url"), "license": p.get("license")}
             for p in (sub_wp.get("plates") or []) if p.get("url")] or None
    return {
        "id": wp_id, "voyage_id": 1, "seq": seq,
        "place_historical": sub_wp.get("place_historical"),
        "place_modern": sub_wp.get("place_modern"),
        "latitude": sub_wp.get("latitude"), "longitude": sub_wp.get("longitude"),
        "arrival_date": sub_wp.get("arrival_date"), "departure_date": None,
        "date_note": sub_wp.get("date_note"),
        "event": (claims[0].get("text") if claims else None) or None,
        "diary_excerpt": span.get("reading_span"),
        "diary_excerpt_raw": span.get("raw_span"),
        "diary_excerpt_transformations": span.get("transformations"),
        "diary_source_citation": ev.get("source_title"),
        "diary_source_url": ev.get("source_url"),
        "confidence": sub_wp.get("confidence") or "certain",
        "media_url": None,
        "media": media,
    }


def apply_waypoint_enrichment(bundle: dict, payload: dict, spans: dict):
    """Merge a waypoint-enrichment submission's waypoints into an existing
    bundle. Returns (new_bundle, notes, matches) where matches is
    [(submission_waypoint, resulting_waypoint, is_new), ...] in submission
    order, for main()'s missing-verified-span gate to walk.

    New waypoints are always appended after the bundle's existing ones, in
    the submission's own order, with fresh seq/id continuing from the
    bundle's current maximum — never inserted into the middle of an
    already-published, seq-ordered voyage. Reordering existing, possibly
    externally-referenced seq numbers to slot a new stop chronologically
    between two old ones is a riskier edit than this script takes on; a
    voyage whose new content belongs mid-sequence is an editorial call for a
    human, not an inference this makes silently.
    """
    existing = [dict(w) for w in bundle.get("waypoints") or []]
    original = list(existing)  # matching looks only at what was already published
    notes: list = []
    matches: list = []

    next_id = (max((w.get("id") or 0) for w in existing) + 1) if existing else 1
    next_seq = (max((w.get("seq") or 0) for w in existing) + 1) if existing else 1

    for sub_wp in payload.get("waypoints") or []:
        idx = find_existing_match_index(sub_wp, original)
        if idx is not None:
            merged = merge_enrichment_waypoint(existing[idx], sub_wp, spans, notes)
            existing[idx] = merged
            matches.append((sub_wp, merged, False))
        else:
            wp = new_enrichment_waypoint(sub_wp, spans, next_seq, next_id)
            place = wp.get("place_historical") or wp.get("place_modern") or f"seq {next_seq}"
            notes.append(f"  waypoint {next_seq} ({place}, {wp.get('arrival_date')}): new — appended")
            existing.append(wp)
            matches.append((sub_wp, wp, True))
            next_id += 1
            next_seq += 1

    new_bundle = dict(bundle)
    new_bundle["waypoints"] = existing
    return new_bundle, notes, matches


def run_embed(submission_id: int, slug: str, bundle: dict) -> None:
    """Call straight into embed_published.py's own pieces, in-process, right
    after a real publish. Both scripts live in scripts/ and share the same
    database; a subprocess would only add a second psycopg2 connection and a
    second Python startup for isolation nothing here needs. Always embeds
    from the bundle just written (embed_published.bundle_docs), not the
    submission payload — see that function's own docstring for why a
    waypoint-enrichment payload cannot be handed to upsert() directly.
    """
    import embed_published as EP
    conn = EP.psycopg2.connect(**EP.pg_params())
    try:
        docs = EP.bundle_docs(slug, bundle)
        if not docs:
            print(f"  embed     skipped — {slug} has nothing embeddable")
            return
        rows = EP.embed(docs)
        EP.upsert(conn, slug, rows, dry_run=False)
        print(f"  embed     {len(rows)} chunk(s) embedded for {slug} (submission {submission_id})")
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("submission_id", type=int)
    ap.add_argument("--file", help="bundle filename stem (default: the slug)")
    ap.add_argument("--blurb", default="", help="one line for the atlas index")
    ap.add_argument("--visual-profile", choices=VISUAL_PROFILES,
                    help="editorial override of the automatically inferred illustration class")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="publish a submission that is not approved (records why in the output)")
    ap.add_argument("--allow-missing-spans", action="store_true",
                    help="publish a submission with quotations but no verified_spans row at "
                         "all — legacy data from before that table existed. Refused without "
                         "this flag; publishes with no diary_excerpt for those quotations "
                         "when given.")
    ap.add_argument("--no-embed", action="store_true",
                    help="skip the automatic embed_published step after a real publish "
                         "(embedding still requires a genuine, non-forced 'publish' — see "
                         "run_embed()). Has no effect on --dry-run, which never embeds.")
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
    submission_type = meta.get("type") or "new-voyage"
    if submission_type not in SUBMISSION_TYPES:
        sys.exit(f"submission {args.submission_id} has payload.meta.type={submission_type!r}, which "
                 f"publish_submission.py does not know how to publish. Only {SUBMISSION_TYPES} have "
                 f"a publish path today — 'idea', 'content-suggestion', 'correction' and "
                 f"'feature-suggestion' need their own design for what 'publishing' even means for "
                 f"that shape, not a guess made here.")

    if submission_type == "waypoint-enrichment":
        publish_waypoint_enrichment(args, row, meta, spans, provenance)
        return

    bundle = to_bundle(row["payload"], spans, provenance)
    profile = args.visual_profile or visual_profile(bundle["voyage"], bundle["waypoints"])

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
    print(f"  visual    {profile}{' (editorial override)' if args.visual_profile else ' (inferred)'}")
    print(f"  provenance ideator={provenance['ideator']!r} "
          f"scribe_model={provenance['scribe_model']!r} carta={provenance['carta_version']!r}")

    atlas = ATLAS_TS.read_text(encoding="utf-8")
    already = f'slug: "{slug}"' in atlas
    print(f"  ATLAS     {'already present — will not duplicate' if already else 'entry will be added'}")

    if args.dry_run:
        print("\ndry run — nothing written\n")
        print(atlas_entry(bundle, blurb, profile))
        return

    path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if not already:
        # Appended before the closing bracket of ATLAS_ENTRIES. The build fails
        # if this and data/ ever disagree, which is the guarantee that keeps a
        # voyage from shipping half-visible — so the two writes stay together.
        marker = "] as const satisfies readonly AtlasEntry[];"
        if marker not in atlas:
            sys.exit(f"could not find the end of ATLAS_ENTRIES in {ATLAS_TS} — "
                     f"add the entry by hand:\n\n{atlas_entry(bundle, blurb, profile)}")
        atlas = atlas.replace(marker, atlas_entry(bundle, blurb, profile) + marker)
        ATLAS_TS.write_text(atlas, encoding="utf-8")

    record_publication(args.submission_id, slug, provenance["carta_version"] or "unknown",
                       approved=row["status"] == "approved")

    print(f"\nwritten. Next, and deliberately not automatic:")
    print(f"  1. add the bundle import + LOCAL entry in lib/data.ts (the build will tell you)")
    print(f"  2. npm run build   — proves ATLAS and data/ agree")
    print(f"  3. review the diff and commit: publication is a reviewable change, not a side effect")
    print(f"  4. python3 scripts/load_bundles.py   — put it in Postgres too")

    maybe_embed(args, row, slug, bundle)


def maybe_embed(args, row: dict, slug: str, bundle: dict) -> None:
    """Shared tail of both real-publish paths: embed iff this was a genuine
    approved publish and --no-embed was not given. A --force publish of an
    unapproved submission records 'publish-forced', which — same as
    embed_published.py's own standalone gate — does not authorise this."""
    if args.no_embed:
        return
    if row["status"] != "approved":
        print(f"  embed     skipped — publication was --force'd on an unapproved submission "
              f"('publish-forced' in audit_log), which does not authorise embedding either")
        return
    run_embed(args.submission_id, slug, bundle)


def publish_waypoint_enrichment(args, row: dict, meta: dict, spans: dict, provenance: dict) -> None:
    """The waypoint-enrichment counterpart of main()'s new-voyage body: patch
    an existing data/<file>.json in place instead of writing a new one and
    an ATLAS entry. See apply_waypoint_enrichment() for the merge itself."""
    target_slug = row.get("target") or meta.get("target_voyage")
    if not target_slug:
        sys.exit(f"submission {args.submission_id} is a waypoint-enrichment with no target_voyage "
                 f"(checked both the submissions.target_voyage column and payload.meta.target_voyage) "
                 f"— nothing to enrich.")
    if row.get("target") and meta.get("target_voyage") and row["target"] != meta["target_voyage"]:
        sys.exit(f"submission {args.submission_id} disagrees with itself about its target: "
                 f"submissions.target_voyage={row['target']!r} but payload.meta.target_voyage="
                 f"{meta['target_voyage']!r}. Refusing rather than guessing which one governs.")

    path = resolve_data_file(target_slug)
    bundle = json.loads(path.read_text(encoding="utf-8"))

    new_bundle, notes, matches = apply_waypoint_enrichment(bundle, row["payload"], spans)

    if spans:
        # Mirrors main()'s own "dropped" gate for new-voyage: spans is
        # non-empty, so the submission WAS verified, and a quoted claim
        # whose waypoint still has no diary_excerpt after the merge — new or
        # already-published — is a gap, not the legacy case
        # --allow-missing-spans covers.
        dropped = [sub_wp["seq"] for sub_wp, out_wp, _ in matches
                   if not out_wp.get("diary_excerpt")
                   and any((cl.get("evidence") or {}).get("quote")
                           for cl in (sub_wp.get("claims") or []))]
        if dropped:
            sys.exit(
                f"submission {args.submission_id} has verified spans but is missing one for "
                f"stage(s) {dropped}, each of which offered a quotation. Carta 3.4 promises the "
                f"raw span beside the readable one for every quotation published — publishing "
                f"without it would drop that promise silently.\n"
                f"Run:  python3 scripts/desk_review.py {args.submission_id}")

    enriched = sum(1 for _, _, is_new in matches if not is_new)
    appended = sum(1 for _, _, is_new in matches if is_new)

    # The bug this fix exists for: apply_waypoint_enrichment() only ever
    # touched "waypoints", so this publication's own provenance — the whole
    # reason §3.5 exists — was computed above and then silently never written
    # anywhere but audit_log. Recorded here as one entry alongside whatever
    # the bundle already carried (a list, a lone pre-fix object, or nothing),
    # never in its place.
    touched_seqs = sorted({out_wp["seq"] for _, out_wp, _ in matches})
    new_bundle["provenance"] = append_provenance(
        bundle, provenance_entry(provenance, "waypoint-enrichment", touched_seqs))

    print(f"submission {args.submission_id}  status={row['status']}  type=waypoint-enrichment")
    print(f"  target    {target_slug}")
    print(f"  bundle    {path.relative_to(ROOT)}")
    print(f"  waypoints {len(bundle.get('waypoints') or [])} existing, "
          f"{enriched} enriched, {appended} appended -> {len(new_bundle['waypoints'])} total")
    for note in notes:
        print(note)
    print(f"  provenance ideator={provenance['ideator']!r} "
          f"scribe_model={provenance['scribe_model']!r} carta={provenance['carta_version']!r} "
          f"waypoints={touched_seqs} "
          f"({len(normalize_provenance(bundle.get('provenance')))} prior publication(s) on record)")
    print(f"  ATLAS     unchanged — {target_slug} already has an entry")

    if args.dry_run:
        print("\ndry run — nothing written\n")
        return

    path.write_text(json.dumps(new_bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    record_publication(args.submission_id, target_slug, provenance["carta_version"] or "unknown",
                       approved=row["status"] == "approved")

    print(f"\nwritten. Next, and deliberately not automatic:")
    print(f"  1. npm run build   — proves data/ still parses and the site still builds")
    print(f"  2. review the diff and commit: publication is a reviewable change, not a side effect")
    print(f"  3. python3 scripts/load_bundles.py   — put it in Postgres too")

    maybe_embed(args, row, target_slug, new_bundle)


if __name__ == "__main__":
    main()
