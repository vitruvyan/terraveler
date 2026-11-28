"""The Publisher, as a Motus graph.

`docs/SHIPS_OFFICERS.md` §4.2/§6 ratifies this commission and its node
order: `load_approved -> guard_verdict -> assemble_bundle -> write_bundle ->
update_atlas -> commit_push -> record_published`. This is that graph, not a
new design — it turns an `approved` submission into a published voyage, and
nothing else. Authority is `propose`->execute (§4.2): it acts only on an
authorization (a real `approve` verdict already in `audit_log`) that
already exists, and adds no judgment of its own.

Rebuilt from scratch. The previous implementation (`orchestration/`) was
lost in a 2026-09-13 incident — deliberately left uncommitted across
several sessions, which is exactly what let one unrelated directory
deletion take it with nothing to recover from. This version is committed
from the moment it exists. A known bug from the lost version, recorded in
the handoff that survived (`~/terraveler-content-handoff.md`, outside the
wiped directory): `commit_push` ran a bare `git push`, which pushes the
CURRENT branch to its own upstream — publishing from any branch other than
`main` landed on a Vercel Preview, not Production, while still reporting
"pushed": true. Fixed here by pushing explicitly to `origin HEAD:main`,
never the ambient branch.

Scope, deliberately narrow for this rebuild: `new-voyage` submissions only
— the type every real historical `feat(atlas): publish <slug>` commit
handled. `content-suggestion` (an edit to an already-published waypoint)
and `idea` (a proposal, not content) are real and valuable but are a
different shape of write than "assemble one whole new voyage bundle";
extending this graph to them is future work, not a gap silently swallowed
here — `load_approved` refuses any other type by name.

Also deliberately not attempted here: image matching (`_match_images` in
the lost version, matching `rag_docs` images to a waypoint's place name).
The content handoff that survived records its own real yield as very low
(0-1 photo per voyage even when it worked) and every relaxation tried
produced a false positive on real data. A published voyage with zero
images is correct and safe; a wrongly-attributed one is not. Add it back
deliberately, with the same care, not as a side effect of this rebuild.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

from vitruvyan_motus import (
    Decision, EffectDescriptor, Fact, GraphSpec, Rejection, Runtime, State,
)
from vitruvyan_motus.effects import EffectClass

RECORDED = EffectClass.RECORDED_EFFECT

# The checkout the code itself sits in. Used ONLY as a read-only fallback for a
# dry run; a real run never derives its repo root from __file__ (see
# resolve_repo_root).
CODE_ROOT = Path(__file__).resolve().parent.parent.parent.parent
# The live checkout is mounted by running containers; no git operation and no
# file write may ever target it. Overridable only so tests can aim the guard
# at a temp dir.
LIVE_CHECKOUT = Path("/home/caravaggio/terraveler")
REPO_ROOT_ENV = "TERRAVELER_PUBLISH_REPO"
# Leading letter: the slug becomes a JS identifier in lib/data.ts.
SLUG_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
PUBLISHABLE_TYPES = ("new-voyage",)
# The note printed beside a quotation whose licence could not be read as open
# (the Curator's default profile, ingest/licence.py). Kept identical to
# scripts/publish_submission.py::RIGHTS_NOTE by a test.
RIGHTS_NOTE = "rights not verified — brief quotation under Carta §3.2"


def _excerpt_of(span: dict, evidence: dict):
    """(reading, raw, rights, citation) for one waypoint's quotation.

    The verified span is the ONLY source of the excerpt — never the
    contributor's own `excerpt`/`quote`, which nothing has checked against the
    source. A claim with no span was refused (absent, fabricated, or over the cap
    its source's rights allow — Carta 3.2) and prints no excerpt; the editor sees
    that at the Desk and resubmits. Mirrors scripts/publish_submission.py
    (citation_of / rights_of), which has always refused this fallback."""
    reading = span.get("reading_span")
    raw = span.get("raw_span")
    rights = span.get("rights") or None
    citation = evidence.get("source_title")
    if (rights or {}).get("profile") == "quote-only":
        citation = f"{citation} ({RIGHTS_NOTE})" if citation else RIGHTS_NOTE.capitalize()
    return reading, raw, rights, citation
# Approval alone is not enough per se; §4.2 requires the verdict live in
# audit_log under the roles that may issue one, not merely a status column
# an operator could hand-edit.
# The Curator's `curator-desk` approve is a mechanical pass, not an editorial
# authorization: only the editor's own approve may publish (Phase 1).
APPROVING_ACTORS = ("editor-in-chief",)

SPEC = GraphSpec.from_dict({
    "schema_version": "1.0.0",
    "name": "terraveler-publisher",
    "version": "1.0.0",
    "entry": "load_approved",
    "nodes": [
        {"name": "load_approved", "effect_class": "recorded_effect",
         "reads_declared": ["submission_id"],
         "writes_declared": ["sub_type", "target_voyage", "payload", "queue"]},
        {"name": "guard_verdict", "effect_class": "recorded_effect",
         "reads_declared": ["submission_id"],
         "writes_declared": ["verdict_ok", "authorization"]},
        {"name": "assemble_bundle", "effect_class": "recorded_effect",
         "reads_declared": ["submission_id", "payload", "target_voyage"],
         "writes_declared": ["bundle", "atlas_entry", "assembly"]},
        {"name": "write_bundle", "effect_class": "recorded_effect",
         "reads_declared": ["target_voyage", "bundle", "atlas_entry"],
         "writes_declared": ["files_written", "write"]},
        {"name": "update_atlas", "effect_class": "recorded_effect",
         "reads_declared": ["target_voyage", "bundle"],
         "writes_declared": ["navigator_id", "voyage_id"]},
        {"name": "commit_push", "effect_class": "recorded_effect",
         "reads_declared": ["target_voyage", "files_written"],
         "writes_declared": ["commit_sha", "pushed"]},
        {"name": "record_published", "effect_class": "recorded_effect",
         "reads_declared": ["submission_id", "target_voyage", "commit_sha"],
         "writes_declared": ["published", "outcome"]},
        # A refused submission ends here. Pure and effect-free on purpose.
        {"name": "refuse", "effect_class": "pure",
         "reads_declared": ["submission_id", "rejections"], "writes_declared": ["refusal"]},
    ],
    "transitions": {
        # Every guard records a Decision and the graph ROUTES on it. A refusal
        # (a Rejection alone does not stop a run: State.fact() returns None for
        # a missing fact and a `next` would carry on) goes to `refuse`, which is
        # terminal, so nothing after a guard ever runs on a refused submission.
        "load_approved": {"kind": "route", "on": "queue",
                          "map": {"loaded": "guard_verdict", "refused": "refuse"},
                          "default": "refuse"},
        "guard_verdict": {"kind": "route", "on": "authorization",
                          "map": {"granted": "assemble_bundle", "refused": "refuse"},
                          "default": "refuse"},
        "assemble_bundle": {"kind": "route", "on": "assembly",
                            "map": {"ok": "write_bundle", "refused": "refuse"},
                            "default": "refuse"},
        "write_bundle": {"kind": "route", "on": "write",
                         "map": {"written": "update_atlas", "refused": "refuse"},
                         "default": "refuse"},
        "update_atlas": {"kind": "next", "to": "commit_push"},
        "commit_push": {"kind": "next", "to": "record_published"},
        "record_published": {"kind": "terminal"},
        "refuse": {"kind": "terminal"},
    },
})


@dataclass(frozen=True)
class PublishConfig:
    pg: dict[str, Any]
    carta: str
    dry_run: bool = False
    # Explicit configuration, never derived from __file__. None means "read
    # TERRAVELER_PUBLISH_REPO"; a real run with neither is refused.
    repo_root: Path | None = None


def _common_git_dir(path: Path) -> Path | None:
    """The shared .git of a checkout, read from files (no git call): the .git
    dir itself, or for a linked worktree the `commondir` its gitdir points at."""
    dot = path / ".git"
    if dot.is_dir():
        return dot.resolve()
    if dot.is_file():
        text = dot.read_text(encoding="utf-8", errors="replace").strip()
        if text.startswith("gitdir:"):
            gitdir = Path(text[len("gitdir:"):].strip())
            if not gitdir.is_absolute():
                gitdir = path / gitdir
            common = gitdir / "commondir"
            if common.is_file():
                return (gitdir / common.read_text().strip()).resolve()
            return gitdir.resolve()
    return None


def _is_live_checkout(path: Path) -> bool:
    """True for the live checkout, anything inside it, and any git worktree of
    it (a worktree shares the live repo's object store and refs)."""
    try:
        live = LIVE_CHECKOUT.resolve()
        resolved = path.resolve()
        if resolved == live or resolved.is_relative_to(live):
            return True
        if path.exists() and LIVE_CHECKOUT.exists() and path.samefile(LIVE_CHECKOUT):
            return True
        return _common_git_dir(resolved) == (live / ".git").resolve()
    except OSError:
        return True  # cannot tell -> treat as unsafe


def resolve_repo_root(cfg: PublishConfig) -> tuple[Path | None, str | None]:
    """(root, None) or (None, why-refused).

    The repo root comes from configuration (cfg.repo_root or
    TERRAVELER_PUBLISH_REPO). It must be a git checkout and must not be the live
    checkout, which running containers mount. A dry run may fall back to the
    code's own checkout, because it only reads."""
    raw = cfg.repo_root or os.environ.get(REPO_ROOT_ENV)
    if not raw:
        if cfg.dry_run:
            return CODE_ROOT, None
        return None, (f"no repo root configured (set PublishConfig.repo_root or "
                      f"{REPO_ROOT_ENV}); the Publisher never derives it from its own location")
    root = Path(raw)
    if _is_live_checkout(root):
        if cfg.dry_run:
            return root, None  # reads only: no write and no git call happens
        return None, (f"{root} is the live checkout (mounted by running containers); "
                      f"the Publisher never writes or runs git there")
    if not (root / ".git").exists():
        return None, f"{root} is not a git checkout"
    return root, None


def _slugify(text: str) -> str:
    import unicodedata
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", folded.lower()).strip("-")
    return slug or "navigator"


def _run_git(repo_root: Path, *args: str) -> str:
    # Last line of defence: whatever the caller believed, no git call may
    # target the live checkout.
    if _is_live_checkout(Path(repo_root)):
        raise RuntimeError(f"refusing git {' '.join(args)}: {repo_root} is the live checkout")
    result = subprocess.run(
        ["git", *args], cwd=repo_root, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def _refused(state: State, now, decision: str, what: str, reason: str, evidence: dict) -> State:
    """A refusal is a Rejection (why) AND a Decision (which the graph routes on).
    Either alone is not enough: the Rejection does not stop a run, the Decision
    does not say why."""
    return (state.with_rejection(Rejection(what, reason, now, evidence=evidence))
            .with_decision(Decision(decision, "refused", now, reason=reason)))


def make_nodes(cfg: PublishConfig) -> dict:

    def load_approved(state: State, ctx) -> State:
        sid = state.fact("submission_id")
        now = ctx.now()
        root, why = resolve_repo_root(cfg)
        if root is None:
            return _refused(state, now, "queue", "publish from an unsafe repo root", why,
                            {"submission_id": sid})
        conn = psycopg2.connect(**cfg.pg)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "select type, status, target_voyage, payload from submissions where id = %s",
                    (sid,))
                row = cur.fetchone()
        finally:
            conn.close()

        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"read submissions#{sid}: {'found' if row else 'not found'}"))

        if not row:
            return _refused(state, now, "queue", "publish this submission",
                            f"submission #{sid} not found", {"submission_id": sid})
        if row["status"] != "approved":
            return _refused(
                state, now, "queue", "publish this submission",
                f"submission #{sid} is '{row['status']}', not 'approved' — "
                f"the Publisher acts only on an existing approval, never grants one",
                {"submission_id": sid, "status": row["status"]})
        if row["type"] not in PUBLISHABLE_TYPES:
            return _refused(
                state, now, "queue", "publish this submission",
                f"submission #{sid} is type '{row['type']}' — the Publisher handles "
                f"{PUBLISHABLE_TYPES} only in this version",
                {"submission_id": sid, "type": row["type"]})
        target = row["target_voyage"]
        if not isinstance(target, str) or not SLUG_RE.match(target):
            return _refused(
                state, now, "queue", "publish without a clean target voyage",
                f"submission #{sid} has target_voyage {target!r}: a new voyage needs a "
                f"lowercase-hyphenated slug, and nothing is written without one",
                {"submission_id": sid, "target_voyage": target})

        return (state
                .with_fact(Fact("sub_type", row["type"], "load_approved", now))
                .with_fact(Fact("target_voyage", row["target_voyage"], "load_approved", now))
                .with_fact(Fact("payload", row["payload"], "load_approved", now))
                .with_decision(Decision("queue", "loaded", now,
                                        reason=f"#{sid} approved, type {row['type']}")))

    def guard_verdict(state: State, ctx) -> State:
        sid = state.fact("submission_id")
        now = ctx.now()
        conn = psycopg2.connect(**cfg.pg)
        try:
            with conn.cursor() as cur:
                # The approve must be the LATEST verdict on the submission: an
                # approve followed by a reject or a request for changes is no
                # longer an authorization.
                cur.execute(
                    "select actor, verdict from audit_log where submission_id = %s "
                    "and action = 'verdict' order by id desc limit 1", (sid,))
                latest = cur.fetchone()
                approved = bool(latest and latest[1] == "approve"
                                and latest[0] in APPROVING_ACTORS)
        finally:
            conn.close()

        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"checked audit_log for an approve verdict on #{sid}: "
                        f"{'present' if approved else 'ABSENT'}"))

        if not approved:
            return _refused(
                state, now, "authorization", "publish without a recorded approval",
                f"the latest verdict on #{sid} is not an approve from {APPROVING_ACTORS} "
                f"in audit_log — a status column alone is not §4.2's authorization",
                {"submission_id": sid})
        return (state.with_fact(Fact("verdict_ok", True, "guard_verdict", now))
                .with_decision(Decision("authorization", "granted", now,
                                        reason=f"latest verdict on #{sid} is an approve")))

    def assemble_bundle(state: State, ctx) -> State:
        sid = state.fact("submission_id")
        payload = state.fact("payload") or {}
        target_voyage = state.fact("target_voyage")
        now = ctx.now()

        voyage_in = payload.get("voyage") or {}
        navigator_name = voyage_in.get("navigator") or "Unknown"
        navigator_slug = _slugify(navigator_name)

        conn = psycopg2.connect(**cfg.pg)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("select spans from verified_spans where submission_id = %s", (sid,))
                row = cur.fetchone()
        finally:
            conn.close()
        spans = (row["spans"] if row else {}) or {}
        # No verified_spans row and a draft that quotes: the Desk never verified
        # (or refused) those quotations, so there is nothing to print. Say so
        # rather than publishing waypoints that silently lack them —
        # scripts/publish_submission.py refuses the same case.
        quoted = sum(1 for wp in payload.get("waypoints") or []
                     for c in (wp.get("claims") or [])[:1]
                     if ((c.get("evidence") or {}).get("quote") or (c.get("evidence") or {}).get("excerpt")))
        if row is None and quoted:
            return _refused(
                state, now, "assembly", "quotations with no verified spans",
                f"#{sid} quotes {quoted} claim(s) but has no verified_spans row: the Desk has not verified "
                f"them, and the contributor's own text is never printed in their place (Carta 3.4). "
                f"Run the Desk (scripts/desk_review.py {sid}) or resubmit.",
                {"submission_id": sid, "quoted_claims": quoted})

        waypoints = []
        for wp in payload.get("waypoints") or []:
            seq = wp.get("seq")
            claims = wp.get("claims") or []
            claim = claims[0] if claims else {}
            evidence = claim.get("evidence") or {}
            span = spans.get(f"{seq}.1") or {}
            # Provenance (§4.2, §8.5): the raw span as submitted and the reading
            # span as verified against the live source travel together, not
            # collapsed into one. The verified span is the only source of the
            # excerpt (see _excerpt_of).
            reading, raw, rights, citation = _excerpt_of(span, evidence)
            waypoints.append({
                "seq": seq,
                "place_historical": wp.get("place_historical"),
                "place_modern": wp.get("place_modern"),
                "latitude": wp.get("latitude"),
                "longitude": wp.get("longitude"),
                "arrival_date": wp.get("arrival_date"),
                "departure_date": wp.get("departure_date"),
                "date_note": wp.get("date_note"),
                "event": claim.get("text"),
                "diary_excerpt": reading,
                "diary_excerpt_raw": raw,
                "diary_excerpt_transformations": span.get("transformations") or None,
                "diary_source_citation": citation,
                "diary_source_url": evidence.get("source_url"),
                "diary_source_rights": rights,
                "confidence": wp.get("confidence") or "certain",
                "media_url": None,
                "media": [],
            })

        bundle = {
            "navigator": {
                "slug": navigator_slug,
                "name": navigator_name,
                "nationality": None,
                "birth_year": None,
                "death_year": None,
                "portrait_url": None,
                "bio": None,
            },
            "voyage": {
                "slug": target_voyage,
                "title": voyage_in.get("title"),
                "ships": voyage_in.get("ships"),
                "sponsor": voyage_in.get("sponsor"),
                "purpose": voyage_in.get("purpose"),
                "start_date": waypoints[0]["arrival_date"] if waypoints else None,
                "end_date": waypoints[-1]["arrival_date"] if waypoints else None,
                "summary": voyage_in.get("summary"),
                "evidence_basis": voyage_in.get("evidence_basis"),
                "what_was_lost": voyage_in.get("what_was_lost"),
            },
            "waypoints": waypoints,
        }

        years_start = (waypoints[0]["arrival_date"] or "")[:4] if waypoints else ""
        years_end = (waypoints[-1]["arrival_date"] or "")[:4] if waypoints else ""
        atlas_entry = {
            "slug": target_voyage,
            # Required by AtlasEntry. "unillustrated" is the only profile that
            # claims nothing: the editor assigns a real one when image
            # eligibility is decided, never the machine.
            "visualProfile": "unillustrated",
            "href": f"/voyage/{target_voyage}",
            "title": voyage_in.get("title") or target_voyage,
            "navigator": navigator_name,
            "years": f"{years_start}–{years_end}" if years_start else "",
            "blurb": ((voyage_in.get("summary") or "")[:180]),
        }

        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"assembled bundle for {target_voyage}: {len(waypoints)} waypoint(s), "
                        f"navigator {navigator_slug!r}"))

        return (state
                .with_fact(Fact("bundle", bundle, "assemble_bundle", now))
                .with_fact(Fact("atlas_entry", atlas_entry, "assemble_bundle", now))
                .with_decision(Decision("assembly", "ok", now,
                                        reason=f"{len(waypoints)} waypoint(s) assembled")))

    def write_bundle(state: State, ctx) -> State:
        target_voyage = state.fact("target_voyage")
        bundle = state.fact("bundle")
        atlas_entry = state.fact("atlas_entry")
        now = ctx.now()

        root, why = resolve_repo_root(cfg)
        if root is None:
            return _refused(state, now, "write", "write a new bundle file", why,
                            {"slug": target_voyage})

        data_path = root / "data" / f"{target_voyage}.json"
        if data_path.exists():
            return _refused(
                state, now, "write", "write a new bundle file",
                f"data/{target_voyage}.json already exists — the Publisher must escalate "
                f"a slug collision (§4.2), never overwrite previously verified content",
                {"path": str(data_path)})

        data_ts_path = root / "lib" / "data.ts"
        voyages_ts_path = root / "lib" / "voyages.ts"
        data_ts = data_ts_path.read_text(encoding="utf-8")
        voyages_ts = voyages_ts_path.read_text(encoding="utf-8")
        if f'"{target_voyage}"' in data_ts or f'"{target_voyage}"' in voyages_ts:
            return _refused(
                state, now, "write", "write a new bundle file",
                f"{target_voyage!r} already referenced in lib/data.ts or lib/voyages.ts",
                {"slug": target_voyage})

        if cfg.dry_run:
            ctx.record_effect(EffectDescriptor(
                effect_class=RECORDED,
                description=f"DRY RUN: would write data/{target_voyage}.json, "
                            f"lib/data.ts, lib/voyages.ts"))
            return (state.with_fact(Fact("files_written", [], "write_bundle", now))
                    .with_decision(Decision("write", "written", now, reason="dry run")))

        data_path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n",
                             encoding="utf-8")

        var_name = re.sub(r"[^a-zA-Z0-9]", "_", target_voyage)
        import_line = f'import {var_name} from "@/data/{target_voyage}.json";\n'
        last_import = list(re.finditer(r'^import .+;\n', data_ts, re.MULTILINE))[-1]
        data_ts = data_ts[:last_import.end()] + import_line + data_ts[last_import.end():]
        local_entry = f'  "{target_voyage}": {var_name},\n'
        close_brace = data_ts.index("\n};", data_ts.index("const LOCAL"))
        data_ts = data_ts[:close_brace + 1] + local_entry + data_ts[close_brace + 1:]
        data_ts_path.write_text(data_ts, encoding="utf-8")

        entry_ts = (
            "  {\n"
            f'    slug: "{atlas_entry["slug"]}",\n'
            f'    visualProfile: "{atlas_entry["visualProfile"]}",\n'
            f'    href: "{atlas_entry["href"]}",\n'
            f'    title: {json.dumps(atlas_entry["title"], ensure_ascii=False)},\n'
            f'    navigator: {json.dumps(atlas_entry["navigator"], ensure_ascii=False)},\n'
            f'    years: "{atlas_entry["years"]}",\n'
            f'    blurb:\n      {json.dumps(atlas_entry["blurb"], ensure_ascii=False)},\n'
            "  },\n"
        )
        marker = "] as const satisfies readonly AtlasEntry[];"
        idx = voyages_ts.index(marker)
        voyages_ts = voyages_ts[:idx] + entry_ts + voyages_ts[idx:]
        voyages_ts_path.write_text(voyages_ts, encoding="utf-8")

        files = [str(data_path.relative_to(root)), "lib/data.ts", "lib/voyages.ts"]
        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"wrote {len(files)} file(s) for {target_voyage}"))
        return (state.with_fact(Fact("files_written", files, "write_bundle", now))
                .with_decision(Decision("write", "written", now,
                                        reason=f"{len(files)} file(s) written")))

    def update_atlas(state: State, ctx) -> State:
        target_voyage = state.fact("target_voyage")
        bundle = state.fact("bundle")
        now = ctx.now()

        if cfg.dry_run:
            ctx.record_effect(EffectDescriptor(
                effect_class=RECORDED, description="DRY RUN: would upsert Postgres voyages/navigators/waypoints"))
            return (state
                    .with_fact(Fact("navigator_id", None, "update_atlas", now))
                    .with_fact(Fact("voyage_id", None, "update_atlas", now)))

        nav = bundle["navigator"]
        voyage = bundle["voyage"]
        conn = psycopg2.connect(**cfg.pg)
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    "insert into navigators (slug, name, nationality, birth_year, death_year, "
                    "portrait_url, bio) values (%s,%s,%s,%s,%s,%s,%s) "
                    "on conflict (slug) do update set name = excluded.name "
                    "returning id",
                    (nav["slug"], nav["name"], nav["nationality"], nav["birth_year"],
                     nav["death_year"], nav["portrait_url"], nav["bio"]))
                navigator_id = cur.fetchone()[0]

                cur.execute(
                    "insert into voyages (navigator_id, slug, title, ships, sponsor, purpose, "
                    "start_date, end_date, summary, evidence_basis, what_was_lost) "
                    "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                    "on conflict (slug) do update set title = excluded.title "
                    "returning id",
                    (navigator_id, voyage["slug"], voyage["title"], voyage["ships"],
                     voyage["sponsor"], voyage["purpose"], voyage["start_date"],
                     voyage["end_date"], voyage["summary"], voyage["evidence_basis"],
                     voyage["what_was_lost"]))
                voyage_id = cur.fetchone()[0]

                for wp in bundle["waypoints"]:
                    cur.execute(
                        "insert into waypoints (voyage_id, seq, place_historical, place_modern, "
                        "latitude, longitude, arrival_date, departure_date, date_note, event, "
                        "diary_excerpt, diary_source_citation, diary_source_url, confidence, "
                        "media_url) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                        "on conflict (voyage_id, seq) do update set event = excluded.event",
                        (voyage_id, wp["seq"], wp["place_historical"], wp["place_modern"],
                         wp["latitude"], wp["longitude"], wp["arrival_date"],
                         wp["departure_date"], wp["date_note"], wp["event"],
                         wp["diary_excerpt"], wp["diary_source_citation"],
                         wp["diary_source_url"], wp["confidence"], wp["media_url"]))
        finally:
            conn.close()

        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"upserted voyage {target_voyage} (navigator #{navigator_id}, "
                        f"voyage #{voyage_id}) into Postgres"))
        return (state
                .with_fact(Fact("navigator_id", navigator_id, "update_atlas", now))
                .with_fact(Fact("voyage_id", voyage_id, "update_atlas", now)))

    def commit_push(state: State, ctx) -> State:
        target_voyage = state.fact("target_voyage")
        files = state.fact("files_written") or []
        now = ctx.now()

        if cfg.dry_run or not files:
            ctx.record_effect(EffectDescriptor(
                effect_class=RECORDED, description="DRY RUN or nothing to commit — skipping git"))
            return (state
                    .with_fact(Fact("commit_sha", None, "commit_push", now))
                    .with_fact(Fact("pushed", False, "commit_push", now)))

        root, why = resolve_repo_root(cfg)
        if root is None:
            raise RuntimeError(f"refusing to commit: {why}")
        _run_git(root, "add", *files)
        message = f"feat(atlas): publish {target_voyage}\n\nvia the Publisher (orchestration/publish.py)"
        _run_git(root, "commit", "-m", message)
        sha = _run_git(root, "rev-parse", "HEAD")
        # The bug this line exists to not repeat: a bare `git push` sends the
        # CURRENT branch to its own upstream. Publishing from anywhere but
        # `main` landed on a Vercel Preview while still reporting success.
        # Target `main` explicitly, from whatever branch this happens to run on.
        _run_git(root, "push", "origin", "HEAD:main")

        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"committed {sha[:8]} and pushed origin HEAD:main"))
        return (state
                .with_fact(Fact("commit_sha", sha, "commit_push", now))
                .with_fact(Fact("pushed", True, "commit_push", now)))

    def record_published(state: State, ctx) -> State:
        sid = state.fact("submission_id")
        target_voyage = state.fact("target_voyage")
        commit_sha = state.fact("commit_sha")
        now = ctx.now()

        if cfg.dry_run:
            ctx.record_effect(EffectDescriptor(
                effect_class=RECORDED, description="DRY RUN — no audit_log row written"))
            return state.with_fact(Fact("published", False, "record_published", now))

        conn = psycopg2.connect(**cfg.pg)
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    "insert into audit_log (submission_id, actor, action, verdict, findings, "
                    "carta_version) values (%s, %s, %s, %s, %s, %s)",
                    (sid, "publisher", "publish", None,
                     json.dumps([["INFO", 0,
                       f"published {target_voyage} at commit {commit_sha}"]]),
                     cfg.carta))
        finally:
            conn.close()

        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"recorded publish of #{sid} ({target_voyage}) in audit_log"))
        return (state
                .with_fact(Fact("published", True, "record_published", now))
                .with_decision(Decision("outcome", "published", now,
                                        reason=f"{target_voyage} live at {commit_sha}")))

    def refuse(state: State, ctx) -> State:
        """Terminal. Whatever refused has already said why, in the trace."""
        sid = state.fact("submission_id")
        now = ctx.now()
        return state.with_fact(Fact(
            "refusal", f"#{sid} refused: " + "; ".join(r.reason for r in state.rejections),
            "refuse", now))

    return {
        "refuse": refuse, "load_approved": load_approved, "guard_verdict": guard_verdict,
        "assemble_bundle": assemble_bundle, "write_bundle": write_bundle,
        "update_atlas": update_atlas, "commit_push": commit_push,
        "record_published": record_published,
    }


def run_publish(cfg: PublishConfig, submission_id: int, *, run_id: str | None = None, sink=None, ts=None):
    """Execute the Publisher graph on Motus. Returns the RunResult.

    submission_id is seeded as a Fact, not metadata — metadata reaches only
    the trace header, and a Fact lands in run_started.initial_state, inside
    the stream itself (same reasoning as scripts/desk_graph.py's
    initial_state()).
    """
    from datetime import datetime, timezone
    ts = ts or datetime.now(timezone.utc)
    runtime = Runtime(SPEC, make_nodes(cfg), sink=sink)
    return runtime.run(
        State.new(f"publish:{submission_id}",
                 facts=[Fact("submission_id", submission_id, "caller", ts)]),
        run_id=run_id,
    )
