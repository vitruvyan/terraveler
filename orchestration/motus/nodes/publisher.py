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

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PUBLISHABLE_TYPES = ("new-voyage",)
# Approval alone is not enough per se; §4.2 requires the verdict live in
# audit_log under the roles that may issue one, not merely a status column
# an operator could hand-edit.
APPROVING_ACTORS = ("curator-desk", "editor-in-chief")

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
         "writes_declared": ["verdict_ok"]},
        {"name": "assemble_bundle", "effect_class": "recorded_effect",
         "reads_declared": ["submission_id", "payload", "target_voyage"],
         "writes_declared": ["bundle", "atlas_entry"]},
        {"name": "write_bundle", "effect_class": "recorded_effect",
         "reads_declared": ["target_voyage", "bundle", "atlas_entry"],
         "writes_declared": ["files_written"]},
        {"name": "update_atlas", "effect_class": "recorded_effect",
         "reads_declared": ["target_voyage", "bundle"],
         "writes_declared": ["navigator_id", "voyage_id"]},
        {"name": "commit_push", "effect_class": "recorded_effect",
         "reads_declared": ["target_voyage", "files_written"],
         "writes_declared": ["commit_sha", "pushed"]},
        {"name": "record_published", "effect_class": "recorded_effect",
         "reads_declared": ["submission_id", "target_voyage", "commit_sha"],
         "writes_declared": ["published", "outcome"]},
    ],
    "transitions": {
        "load_approved": {"kind": "next", "to": "guard_verdict"},
        "guard_verdict": {"kind": "next", "to": "assemble_bundle"},
        "assemble_bundle": {"kind": "next", "to": "write_bundle"},
        "write_bundle": {"kind": "next", "to": "update_atlas"},
        "update_atlas": {"kind": "next", "to": "commit_push"},
        "commit_push": {"kind": "next", "to": "record_published"},
        "record_published": {"kind": "terminal"},
    },
})


@dataclass(frozen=True)
class PublishConfig:
    pg: dict[str, Any]
    carta: str
    dry_run: bool = False
    repo_root: Path = REPO_ROOT


def _slugify(text: str) -> str:
    import unicodedata
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", folded.lower()).strip("-")
    return slug or "navigator"


def _run_git(repo_root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=repo_root, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def make_nodes(cfg: PublishConfig) -> dict:

    def load_approved(state: State, ctx) -> State:
        sid = state.fact("submission_id")
        now = ctx.now()
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
            return state.with_rejection(Rejection(
                "publish this submission", f"submission #{sid} not found", now,
                evidence={"submission_id": sid}))
        if row["status"] != "approved":
            return state.with_rejection(Rejection(
                "publish this submission",
                f"submission #{sid} is '{row['status']}', not 'approved' — "
                f"the Publisher acts only on an existing approval, never grants one",
                now, evidence={"submission_id": sid, "status": row["status"]}))
        if row["type"] not in PUBLISHABLE_TYPES:
            return state.with_rejection(Rejection(
                "publish this submission",
                f"submission #{sid} is type '{row['type']}' — the Publisher handles "
                f"{PUBLISHABLE_TYPES} only in this version", now,
                evidence={"submission_id": sid, "type": row["type"]}))

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
                cur.execute(
                    "select 1 from audit_log where submission_id = %s "
                    "and action = 'verdict' and verdict = 'approve' and actor = any(%s) limit 1",
                    (sid, list(APPROVING_ACTORS)))
                approved = cur.fetchone() is not None
        finally:
            conn.close()

        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"checked audit_log for an approve verdict on #{sid}: "
                        f"{'present' if approved else 'ABSENT'}"))

        if not approved:
            return state.with_rejection(Rejection(
                "publish without a recorded approval",
                f"no approve verdict from {APPROVING_ACTORS} in audit_log for #{sid} — "
                f"a status column alone is not §4.2's authorization", now,
                evidence={"submission_id": sid}))
        return state.with_fact(Fact("verdict_ok", True, "guard_verdict", now))

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

        waypoints = []
        for wp in payload.get("waypoints") or []:
            seq = wp.get("seq")
            claims = wp.get("claims") or []
            claim = claims[0] if claims else {}
            evidence = claim.get("evidence") or {}
            span = spans.get(f"{seq}.1") or {}
            # Provenance (§4.2, §8.5): the raw span as submitted and the reading
            # span as verified against the live source travel together, not
            # collapsed into one. When no verified_spans row exists (an older
            # submission, from before that table), the evidence's own excerpt
            # is the only copy there is — both fields carry the same text
            # rather than inventing a distinction the record does not have.
            reading = span.get("reading_span") or evidence.get("excerpt") or evidence.get("quote")
            raw = span.get("raw_span") or evidence.get("quote") or reading
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
                "diary_source_citation": evidence.get("source_title"),
                "diary_source_url": evidence.get("source_url"),
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
                .with_fact(Fact("atlas_entry", atlas_entry, "assemble_bundle", now)))

    def write_bundle(state: State, ctx) -> State:
        target_voyage = state.fact("target_voyage")
        bundle = state.fact("bundle")
        atlas_entry = state.fact("atlas_entry")
        now = ctx.now()

        data_path = cfg.repo_root / "data" / f"{target_voyage}.json"
        if data_path.exists():
            return state.with_rejection(Rejection(
                "write a new bundle file",
                f"data/{target_voyage}.json already exists — the Publisher must escalate "
                f"a slug collision (§4.2), never overwrite previously verified content", now,
                evidence={"path": str(data_path)}))

        data_ts_path = cfg.repo_root / "lib" / "data.ts"
        voyages_ts_path = cfg.repo_root / "lib" / "voyages.ts"
        data_ts = data_ts_path.read_text(encoding="utf-8")
        voyages_ts = voyages_ts_path.read_text(encoding="utf-8")
        if f'"{target_voyage}"' in data_ts or f'"{target_voyage}"' in voyages_ts:
            return state.with_rejection(Rejection(
                "write a new bundle file",
                f"{target_voyage!r} already referenced in lib/data.ts or lib/voyages.ts", now,
                evidence={"slug": target_voyage}))

        if cfg.dry_run:
            ctx.record_effect(EffectDescriptor(
                effect_class=RECORDED,
                description=f"DRY RUN: would write data/{target_voyage}.json, "
                            f"lib/data.ts, lib/voyages.ts"))
            return state.with_fact(Fact("files_written", [], "write_bundle", now))

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

        files = [str(data_path.relative_to(cfg.repo_root)), "lib/data.ts", "lib/voyages.ts"]
        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"wrote {len(files)} file(s) for {target_voyage}"))
        return state.with_fact(Fact("files_written", files, "write_bundle", now))

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

        _run_git(cfg.repo_root, "add", *files)
        message = f"feat(atlas): publish {target_voyage}\n\nvia the Publisher (orchestration/publish.py)"
        _run_git(cfg.repo_root, "commit", "-m", message)
        sha = _run_git(cfg.repo_root, "rev-parse", "HEAD")
        # The bug this line exists to not repeat: a bare `git push` sends the
        # CURRENT branch to its own upstream. Publishing from anywhere but
        # `main` landed on a Vercel Preview while still reporting success.
        # Target `main` explicitly, from whatever branch this happens to run on.
        _run_git(cfg.repo_root, "push", "origin", "HEAD:main")

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

    return {
        "load_approved": load_approved, "guard_verdict": guard_verdict,
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
