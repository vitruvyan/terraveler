"""Terraveler voyage Extractor — a native Motus graph, run per voyage_slug.

    python extract.py --voyage cook-1768

    load_corpus -> plan_itinerary -> extract -> geocode -> anchor
                                                  -> verify -> assemble -> write_draft

Turns a voyage's pgvector text corpus (rag_docs) into a DRAFT submission JSON
in the submission_laperouse.json shape (meta + voyage + waypoints[].claims[].
evidence{quote, excerpt, source_url, source_title, license}).

Source integrity is non-negotiable: a diary_excerpt is either a VERBATIM
contiguous span re-verified against the live source text, or it is null. Never
fabricated, never paraphrased-then-passed-off-as-quote.

This script does NOT touch Supabase, the frontend, or anything public. It only
reads rag_docs / writes a submission JSON + a trace.

------------------------------------------------------------------------
What the port to native Motus changed, and why each change was forced

1.  **The `Corpus` side channel is gone.** The Axis version passed a mutable
    object to every node and the itinerary rode it — `corpus.waypoints = [...]`
    in one node, `for w in corpus.waypoints` in the next. `node-protocol.md`
    §1.2 forbids that, and the practical consequence was worse than the rule:
    two runs over different corpora produced traces whose RECORDS were
    identical, because everything that differed travelled outside the state.
    The itinerary now crosses node boundaries as facts, so it is in the trace.

2.  **`corpus.planned` was an `if`; it is a route.** The Axis assemble node
    ended with `if not corpus.planned: raise` — a branch keyed on a flag no
    reader of the trace could see. `plan_itinerary` now writes a keyed
    `Decision`, and the SPEC maps its value onto a node. The trace carries a
    routing record naming the decision the dispatch observed.

3.  **One fact per stage, holding the list — never one fact per waypoint.**
    A fact whose key is derived from the data (`waypoint:7`) cannot appear in
    `writes_declared`, and a partial declaration fails the run outright. So
    each stage writes its whole itinerary as a single keyed fact.

4.  **`geocode` split into `geocode` + `anchor`.** The gazetteer lookups are
    I/O; choosing which coordinate to trust is arithmetic. Splitting them buys
    a genuinely `pure` node, and `pure` is the only class verify-replay
    re-executes. Same for `assemble` / `write_draft`: building the submission
    is a computation, writing the file is an effect on the world.

The per-stop grounding (retrieve -> extract -> geocode -> verify) is otherwise
UNCHANGED and remains the only thing allowed to touch diary_excerpt text.
"""
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

from vitruvyan_motus import (
    Decision, EffectDescriptor, EffectReceipt, Fact, GraphSpec, NodeFailed,
    Policy, Rejection, Runtime, State,
)
from vitruvyan_motus.context import ReplayStatus
from vitruvyan_motus.effects import EffectClass

import extract_core as C
from extract_core import (
    CARTA_VERSION, EVIDENCE_BASES, EXTRACT_MODEL, EXTRACT_SYSTEM, MISMATCH_KM,
    PLAN_MODEL, PLAN_SYSTEM, VOYAGE_META, chronology_breaks, env,
    fetchable_source_url, haversine_km, reads_as_english,
)

RECORDED = EffectClass.RECORDED_EFFECT
EXTERNAL = EffectClass.EXTERNAL_EFFECT


# ------------------------------------------------------------------ the spec

SPEC = GraphSpec.from_dict({
    "schema_version": "1.0.0",
    "name": "terraveler-extract",
    "version": "1.0.0",
    "entry": "load_corpus",
    "nodes": [
        # Reads the corpus out of rag_docs. The *results* are the effect; it
        # mutates nothing.
        {"name": "load_corpus", "effect_class": "recorded_effect",
         "reads_declared": ["voyage", "chunk_limit", "plan_sample_size"],
         "writes_declared": ["sources", "pd_narrative_chunks", "plan_sample",
                             "plan_sample_chunks", "corpus"]},
        {"name": "plan_itinerary", "effect_class": "recorded_effect",
         "reads_declared": ["voyage", "sources", "plan_sample",
                            "pd_narrative_chunks"],
         "writes_declared": ["stops", "plan_stops", "itinerary"]},
        {"name": "extract", "effect_class": "recorded_effect",
         "reads_declared": ["voyage", "stops"],
         "writes_declared": ["waypoints", "waypoints_with_candidate_excerpt",
                             "extraction"]},
        # The lookups only. What they returned goes in the state, so the node
        # that decides can be re-executed without a network.
        {"name": "geocode", "effect_class": "recorded_effect",
         "reads_declared": ["waypoints"],
         "writes_declared": ["gazetteer_hits", "geocoding"]},
        # pure: haversine over numbers already recorded. Nothing outside.
        {"name": "anchor", "effect_class": "pure",
         "reads_declared": ["waypoints", "gazetteer_hits"],
         "writes_declared": ["anchored", "confidence_certain",
                             "confidence_approximate", "confidence_reconstructed",
                             "anchoring"]},
        {"name": "verify", "effect_class": "recorded_effect",
         "reads_declared": ["anchored"],
         "writes_declared": ["verified", "excerpts_verified",
                             "excerpts_rejoined_across_lines", "excerpts_dropped",
                             "excerpts"]},
        # pure: shapes the submission out of what verify confirmed.
        {"name": "assemble", "effect_class": "pure",
         "reads_declared": ["voyage", "verified"],
         "writes_declared": ["submission", "final_waypoints", "draft"]},
        # The only node in this graph that changes anything outside the run.
        {"name": "write_draft", "effect_class": "external_effect",
         "reads_declared": ["voyage", "out_dir", "submission"],
         "writes_declared": ["draft_path"]},
        # The two ways this graph declines to produce a draft. Both pure: a
        # refusal is a recorded conclusion, not an action.
        {"name": "no_corpus", "effect_class": "pure",
         "reads_declared": ["voyage"], "writes_declared": ["outcome"]},
        {"name": "no_itinerary", "effect_class": "pure",
         "reads_declared": ["voyage"], "writes_declared": ["outcome"]},
    ],
    "transitions": {
        # The two branches that used to be `if`s live here, keyed to a decision
        # a node recorded.
        "load_corpus": {"kind": "route", "on": "corpus",
                        "map": {"found": "plan_itinerary", "empty": "no_corpus"},
                        "default": "no_corpus"},
        "plan_itinerary": {"kind": "route", "on": "itinerary",
                           "map": {"planned": "extract", "empty": "no_itinerary"},
                           "default": "no_itinerary"},
        "extract": {"kind": "next", "to": "geocode"},
        "geocode": {"kind": "next", "to": "anchor"},
        "anchor": {"kind": "next", "to": "verify"},
        "verify": {"kind": "next", "to": "assemble"},
        "assemble": {"kind": "next", "to": "write_draft"},
        "write_draft": {"kind": "terminal"},
        "no_corpus": {"kind": "terminal"},
        "no_itinerary": {"kind": "terminal"},
    },
})


# ------------------------------------------------------------------ helpers

def _plain(row):
    """A RealDictRow is not a JSON value; the Motus boundary refuses it."""
    return {k: v for k, v in dict(row).items()}


def _fingerprint(payload: bytes) -> str:
    return "effect:sha256:" + hashlib.sha256(payload).hexdigest()


# ------------------------------------------------------------------ the nodes

def make_nodes(ctx):
    """Build the node table. The closure carries configuration only — the
    connection parameters and the output directory. Nothing here is ever
    written by a node, and no information passes between nodes through it."""

    def load_corpus(state, ctx_run):
        voyage = state.fact("voyage")
        chunk_limit = state.fact("chunk_limit") or 0
        sample_size = state.fact("plan_sample_size")
        meta = VOYAGE_META[voyage]
        lo, hi = meta.get("narrative_chunk_range", (0, 10 ** 9))

        conn = C.pg_connect(ctx)
        try:
            import psycopg2.extras
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT DISTINCT title, source_url
                    FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text' AND license ILIKE 'public domain'
                """, (voyage,))
                sources = [_plain(r) for r in cur.fetchall()]
                cur.execute("""
                    SELECT chunk_index, content, source_url, title, license
                    FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text' AND license ILIKE 'public domain'
                      AND chunk_index BETWEEN %s AND %s
                    ORDER BY chunk_index
                """, (voyage, lo, hi))
                chunks = [_plain(r) for r in cur.fetchall()]
        finally:
            conn.close()
        ctx_run.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=(f"read rag_docs for {voyage}: {len(sources)} public-domain "
                         f"source(s), {len(chunks)} narrative chunks in [{lo},{hi}]")))

        if chunk_limit:
            chunks = chunks[:chunk_limit]
        n = len(chunks)
        now = ctx_run.now()

        # The sample is evidence: it is literally what the planner was shown,
        # truncated exactly as the prompt truncates it. The other thousand
        # chunks are not — they stay in rag_docs, where they already live.
        sample = C._plan_sample(chunks, sample_size)
        shown = [{"chunk_index": c["chunk_index"], "shown": c["content"][:500]}
                 for c in sample]

        state = (state
                 .with_fact(Fact("sources", sources, "load_corpus", now))
                 .with_fact(Fact("pd_narrative_chunks", n, "load_corpus", now))
                 .with_fact(Fact("plan_sample", shown, "load_corpus", now))
                 .with_fact(Fact("plan_sample_chunks", len(shown), "load_corpus", now)))
        if n == 0:
            return state.with_rejection(Rejection(
                "load_corpus",
                f"no public-domain narrative chunks found for {voyage} in "
                f"range [{lo},{hi}]", now,
            )).with_decision(Decision(
                "corpus", "empty", now,
                reason=f"0 chunks in narrative range [{lo},{hi}]"))
        return state.with_decision(Decision(
            "corpus", "found", now,
            reason=(f"primary-journal narrative chunk_index range [{lo},{hi}] "
                    f"(excludes front matter / table of contents / back-of-book "
                    f"index) across {len(sources)} public-domain source(s), "
                    f"{n} chunks")))

    def plan_itinerary(state, ctx_run):
        voyage = state.fact("voyage")
        sources = state.fact("sources") or []
        shown = state.fact("plan_sample") or []
        n = state.fact("pd_narrative_chunks") or 0
        meta = VOYAGE_META[voyage]
        lo, hi = meta.get("narrative_chunk_range", (0, 10 ** 9))
        now = ctx_run.now()

        listing = "\n\n".join(
            f"[chunk_index={c['chunk_index']}]\n{c['shown']}" for c in shown)
        source_listing = "\n".join(
            f"- {s['title']} ({s['source_url']})" for s in sources)
        user = (
            f"VOYAGE: {meta['title']}\n"
            f"SUMMARY: {meta['summary']}\n\n"
            f"PRIMARY-JOURNAL SOURCE(S) IN THE CORPUS:\n{source_listing}\n\n"
            f"SAMPLE CHUNKS scattered across the full narrative span "
            f"(chunk_index {lo}-{hi}, {n} total chunks in range, "
            f"{len(shown)} sampled here):\n\n{listing}"
        )
        try:
            data = C._chat_json(PLAN_MODEL, PLAN_SYSTEM, user)
            stops_raw = data.get("stops", [])
        except Exception as e:
            # A failed plan is not an empty voyage. Returning here produced a
            # submission with zero waypoints that looked like a completed run —
            # a rate limit took three voyages that way in one batch, and the
            # only sign was a suspiciously round number.
            raise RuntimeError(
                f"planning call failed for {voyage}: {str(e)[:160]}. "
                f"No draft written — a voyage with no itinerary is a failed run, "
                f"not a short one.") from e
        ctx_run.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"{PLAN_MODEL} planned the itinerary from {len(shown)} sampled chunks"))

        stops = []
        for i, s in enumerate(stops_raw):
            place = (s.get("place") or "").strip()
            if not place:
                continue
            stops.append({
                "seq": i + 1,
                "place_historical_raw": place,
                "canonical_what_happened": s.get("what_happened") or "",
                # full narrative range -> the per-stop retrieve step below does
                # an UNBIASED semantic kNN search over the whole journal for
                # this place, rather than assuming a chunk-position prior we
                # do not have.
                "chunk_lo": lo, "chunk_hi": hi,
                "candidate_dates": [s["approx_date"]] if s.get("approx_date") else [],
            })

        state = (state
                 .with_fact(Fact("stops", stops, "plan_itinerary", now))
                 .with_fact(Fact("plan_stops", len(stops), "plan_itinerary", now)))
        if not stops:
            return state.with_rejection(Rejection(
                "plan_itinerary", "planning call returned zero usable stops", now,
            )).with_decision(Decision(
                "itinerary", "empty", now, reason="zero usable stops"))

        # Audit-only sanity check on the two mandatory endpoints (non-fatal —
        # this is visible in the trace for human review, and nothing branches
        # on it).
        first_l = stops[0]["place_historical_raw"].lower()
        last_l = stops[-1]["place_historical_raw"].lower()
        if "plymouth" not in first_l:
            state = state.with_rejection(Rejection(
                "plan_itinerary endpoint check",
                f"first stop '{stops[0]['place_historical_raw']}' does not "
                f"mention Plymouth — verify the departure port is correct", now))
        if not any(k in last_l for k in ("england", "downs", "london", "home")):
            state = state.with_rejection(Rejection(
                "plan_itinerary endpoint check",
                f"last stop '{stops[-1]['place_historical_raw']}' does not "
                f"obviously read as the return/home leg — verify", now))
        return state.with_decision(Decision(
            "itinerary", "planned", now,
            reason=(f"{PLAN_MODEL}: sampled {len(shown)}/{n} chunks across "
                    f"narrative range [{lo},{hi}] -> {len(stops)} canonical "
                    f"ordered stops (departure: "
                    f"'{stops[0]['place_historical_raw']}', return: "
                    f"'{stops[-1]['place_historical_raw']}')")))

    def extract(state, ctx_run):
        voyage = state.fact("voyage")
        stops = state.fact("stops") or []
        now = ctx_run.now()
        n_with_excerpt = 0
        failed_calls = []
        waypoints = []
        calls = 0

        for w in [dict(s) for s in stops]:
            chunks = [_plain(c) for c in
                      C.retrieve_chunks(ctx, None, w)]
            # Provenance without duplication: which chunks the model saw, by
            # index. The one chunk the quotation is copied from is kept whole
            # below, because that is the span a reader has to be able to check.
            w["retrieved_chunk_indexes"] = [c["chunk_index"] for c in chunks]
            if not chunks:
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w['place_historical_raw']}'",
                    "no PD chunks retrieved near its chunk range", now))
                waypoints.append(w)
                continue
            listing = "\n\n".join(
                f"[chunk_index={c['chunk_index']}]\n{c['content']}" for c in chunks)
            try:
                data = C._chat_json(EXTRACT_MODEL, EXTRACT_SYSTEM,
                                    f"WAYPOINT HINT: {w['place_historical_raw']} "
                                    f"(candidate dates: {w['candidate_dates']})\n\n"
                                    f"JOURNAL EXCERPTS:\n\n{listing}")
                calls += 1
            except Exception as e:
                failed_calls.append(w["seq"])
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w['place_historical_raw']}'",
                    f"extract call failed: {str(e)[:120]}", now))
                waypoints.append(w)
                continue

            w["place_historical"] = data.get("place_historical") or w["place_historical_raw"]
            w["place_modern"] = data.get("place_modern")
            w["geocode_name"] = data.get("geocode_name") or w["place_modern"] or w["place_historical"]
            w["approx_lat"] = data.get("approx_lat")
            w["approx_lng"] = data.get("approx_lng")
            w["arrival_date"] = data.get("arrival_date")
            w["event"] = data.get("event")
            w["diary_excerpt"] = data.get("diary_excerpt")
            eci = data.get("excerpt_chunk_index")
            src = None
            if w["diary_excerpt"] and eci is not None:
                src = next((c for c in chunks if c["chunk_index"] == eci), None)
            if src is None:
                w["diary_excerpt"] = None
                w["evidence_source"] = chunks[0]  # still ground the event in a real chunk
            else:
                w["evidence_source"] = src
                n_with_excerpt += 1
            waypoints.append(w)

        ctx_run.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=(f"{EXTRACT_MODEL} grounded {calls} of {len(stops)} stops "
                         f"against retrieved journal chunks")))

        # A run that lost most of its stages to a transport failure is a failed
        # run, not a short voyage. Verrazzano came back with 2 waypoints of ~20
        # after a 429, and a 2-stage draft passes the Stage-0 gate and reaches
        # the desk looking deliberate.
        if failed_calls and len(failed_calls) > max(2, len(stops) // 5):
            raise RuntimeError(
                f"{len(failed_calls)} of {len(stops)} extract calls failed "
                f"for {voyage} (seqs {failed_calls[:8]}...). No draft written: a "
                f"truncated itinerary is indistinguishable from a complete one once "
                f"it reaches the desk.")

        return (state
                .with_fact(Fact("waypoints", waypoints, "extract", now))
                .with_fact(Fact("waypoints_with_candidate_excerpt", n_with_excerpt,
                                "extract", now))
                .with_decision(Decision(
                    "extraction", "complete" if not failed_calls else "partial", now,
                    reason=(f"{EXTRACT_MODEL}: grounded {len(stops)} waypoints, "
                            f"{n_with_excerpt} with a candidate verbatim excerpt "
                            f"(pre-verification)"))))

    def geocode(state, ctx_run):
        """The lookups, and only the lookups.

        Which of two gazetteer answers to believe is arithmetic over numbers
        already recorded; it belongs in `anchor`, which is `pure` and therefore
        the only part of this pair verify-replay can re-execute. What this node
        writes down is what the gazetteer said — including that it said nothing.
        """
        waypoints = state.fact("waypoints") or []
        now = ctx_run.now()
        hits = []
        lookups = 0

        for w in waypoints:
            approx = (w.get("approx_lat"), w.get("approx_lng"))
            has_approx = (isinstance(approx[0], (int, float))
                          and isinstance(approx[1], (int, float)))
            try:
                g = C.oculus.geocode(w.get("geocode_name"))
                lookups += 1
            except Exception:
                g = None

            entry = {"seq": w["seq"], "primary": g, "retry": None,
                     "retried": False, "primary_km": None}
            # The retry condition itself needs the distance, so it is computed
            # here too — but it is recorded, and `anchor` recomputes it from
            # the record rather than trusting this one.
            if g and has_approx:
                dist = haversine_km(g["lat"], g["lng"], approx[0], approx[1])
                entry["primary_km"] = dist
                if dist > MISMATCH_KM:
                    entry["retried"] = True
                    try:
                        entry["retry"] = C.oculus.geocode(
                            w.get("place_historical") or w["place_historical_raw"])
                        lookups += 1
                    except Exception:
                        entry["retry"] = None
            hits.append(entry)

        ctx_run.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=(f"gazetteer: {lookups} lookup(s) for "
                         f"{len(waypoints)} waypoint(s)")))
        return (state
                .with_fact(Fact("gazetteer_hits", hits, "geocode", now))
                .with_decision(Decision(
                    "geocoding", "queried", now,
                    reason=(f"{lookups} gazetteer lookup(s), "
                            f"{sum(1 for h in hits if h['retried'])} retried after a "
                            f"mismatch >{MISMATCH_KM}km"))))

    def anchor(state, ctx_run):
        """Pure: pick the coordinate, from what the gazetteer already said."""
        waypoints = state.fact("waypoints") or []
        hits = {h["seq"]: h for h in (state.fact("gazetteer_hits") or [])}
        now = ctx_run.now()
        out = []

        for w in [dict(x) for x in waypoints]:
            h = hits.get(w["seq"]) or {"primary": None, "retry": None,
                                       "retried": False, "primary_km": None}
            approx = (w.get("approx_lat"), w.get("approx_lng"))
            has_approx = (isinstance(approx[0], (int, float))
                          and isinstance(approx[1], (int, float)))
            g = h["primary"]
            retried = h["retried"]
            dist = h["primary_km"]

            if g and has_approx and dist is not None and dist > MISMATCH_KM:
                g2 = h["retry"]
                if g2:
                    dist2 = haversine_km(g2["lat"], g2["lng"], approx[0], approx[1])
                    if dist2 <= MISMATCH_KM:
                        g = g2
                    else:
                        g = None  # both gazetteer hits disagree -> distrust gazetteer
                else:
                    g = None
                if g is None:
                    state = state.with_rejection(Rejection(
                        f"wp{w['seq']} geocode '{w.get('geocode_name')}'",
                        f"gazetteer mismatch >{MISMATCH_KM}km from model estimate "
                        f"({dist:.0f}km) even after retry — falling back to model coord",
                        now))

            if g:
                w["latitude"], w["longitude"] = g["lat"], g["lng"]
                w["coord_provenance"] = f"gazetteer:{g['gazetteer']}:{g.get('provenance')}"
                w["confidence"] = "approximate" if retried else "certain"
                # Keep the identity, not just the position. g["provenance"] is
                # "wikidata:Q42000" — the fact that this landfall IS Tahiti,
                # which lets the atlas notice that Cook's King George's Island
                # and Bougainville's Taïti are one island.
                if str(g.get("provenance", "")).startswith("wikidata:"):
                    w["wikidata_qid"] = g["provenance"].split(":", 1)[1]
                    w["identity_confidence"] = "approximate" if retried else "certain"
            elif has_approx:
                w["latitude"], w["longitude"] = approx[0], approx[1]
                w["coord_provenance"] = "model-estimate (gazetteer unanchored/mismatched)"
                w["confidence"] = "reconstructed"
            else:
                w["latitude"], w["longitude"] = None, None
                w["coord_provenance"] = "none"
                w["confidence"] = "reconstructed"
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} geocode",
                    "no gazetteer hit and no model approx coord", now))
            out.append(w)

        n_certain = sum(1 for w in out if w["confidence"] == "certain")
        n_approx = sum(1 for w in out if w["confidence"] == "approximate")
        n_recon = sum(1 for w in out if w["confidence"] == "reconstructed")
        return (state
                .with_fact(Fact("anchored", out, "anchor", now))
                .with_fact(Fact("confidence_certain", n_certain, "anchor", now))
                .with_fact(Fact("confidence_approximate", n_approx, "anchor", now))
                .with_fact(Fact("confidence_reconstructed", n_recon, "anchor", now))
                .with_decision(Decision(
                    "anchoring",
                    "certain" if n_recon == 0 else ("none" if n_certain == 0 else "mixed"),
                    now,
                    reason=(f"{n_certain} certain, {n_approx} approximate, "
                            f"{n_recon} reconstructed"))))

    def verify(state, ctx_run):
        anchored = state.fact("anchored") or []
        now = ctx_run.now()
        passed, dropped = 0, 0
        out = []
        # Working memory for this call only: the same source is quoted by
        # several waypoints and re-fetching it each time is rude to the
        # archive. It is not a channel — nothing after this node can see it.
        fetched = {}

        def fetch_live(url):
            if url not in fetched:
                fetched[url] = C.F.fetch_gutenberg(url)
            return fetched[url]

        for w in [dict(x) for x in anchored]:
            if not w.get("diary_excerpt"):
                out.append(w)
                continue
            src = w.get("evidence_source")
            url = fetchable_source_url(src["source_url"]) if src else None
            if not url:
                w["diary_excerpt"] = None
                dropped += 1
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} verify", "no source_url on evidence chunk", now))
                out.append(w)
                continue
            try:
                live = fetch_live(url)
            except Exception as e:
                w["diary_excerpt"] = None
                dropped += 1
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} verify '{w['place_historical']}'",
                    f"source unreachable ({url}): {str(e)[:100]}", now))
                out.append(w)
                continue
            # Carta 3.4 (v0.5). The scribe says WHICH passage; the source says
            # what it contains. Everything published from here is copied out of
            # the live text, so no habit of the quoter — a lowered capital, a
            # straightened quotation mark, a decomposed ligature, a tidied
            # hyphen — can reach the page.
            raw, reading, transformations = C.locate_in_source(w["diary_excerpt"], live)
            w["verbatim_exact"] = (raw is not None and w["diary_excerpt"] == raw)
            w["normalizations"] = transformations or []
            if raw is not None:
                w["diary_excerpt"] = reading
                w["diary_excerpt_raw"] = raw
                # Verbatim is necessary and not sufficient. A quotation can be
                # perfectly authentic and still unpublishable: Carta §4 says the
                # published language is English, always.
                if not reads_as_english(w["diary_excerpt"]):
                    dropped += 1
                    state = state.with_rejection(Rejection(
                        f"wp{w['seq']} verify '{w['place_historical']}'",
                        "excerpt verified verbatim but is not in English — nulled "
                        "per Carta 4 (sources may be in any language; published "
                        "content is in English)", now))
                    w["diary_excerpt"] = None
                    out.append(w)
                    continue
                passed += 1
                w["verification"] = ("verbatim" if not transformations
                                     else "verbatim-after-line-rejoin")
            else:
                dropped += 1
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} verify '{w['place_historical']}'",
                    "excerpt NOT found verbatim in re-fetched live source — "
                    "nulled per source-integrity rule (never fabricated)", now))
                w["diary_excerpt"] = None
            out.append(w)

        ctx_run.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=(f"re-fetched {len(fetched)} live source(s) to confirm "
                         f"{passed + dropped} candidate quotation(s)")))

        rejoined = sum(1 for w in out
                       if w.get("diary_excerpt") and w.get("normalizations"))
        # One keyed decision for the stage, not one per waypoint: a key derived
        # from the data cannot be declared (node-protocol §3.2). Which waypoint
        # passed is in `verified`, waypoint by waypoint.
        return (state
                .with_fact(Fact("verified", out, "verify", now))
                .with_fact(Fact("excerpts_verified", passed, "verify", now))
                .with_fact(Fact("excerpts_rejoined_across_lines", rejoined, "verify", now))
                .with_fact(Fact("excerpts_dropped", dropped, "verify", now))
                .with_decision(Decision(
                    "excerpts",
                    "none" if passed == 0 else ("all" if dropped == 0 else "partial"),
                    now,
                    reason=(f"{passed} excerpts VERBATIM-confirmed against live "
                            f"source, {dropped} nulled (source-integrity gate)"))))

    def assemble(state, ctx_run):
        """Pure: the submission is a function of what verify confirmed."""
        voyage = state.fact("voyage")
        verified = state.fact("verified") or []
        meta = VOYAGE_META[voyage]
        now = ctx_run.now()
        waypoints_out = []

        for w in verified:
            if w.get("latitude") is None:
                continue  # unanchored — dropped from the submission, kept in the trace
            # Undated stages get the same treatment as unanchored ones. This is
            # a chrono-diary: a stage that cannot be placed in time cannot be
            # scrubbed to, and the Stage-0 gate refuses it. Dropped, not dated:
            # interpolating a date from the stages either side would be
            # inventing the single thing the reader most relies on.
            if not w.get("arrival_date"):
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w.get('place_historical') or w['place_historical_raw']}'",
                    "no arrival date in the source — dropped from the submission "
                    "(a chrono-diary cannot place an undated stage on the timeline)",
                    now))
                continue
            src = w.get("evidence_source") or {}
            evidence = {
                "quote": w.get("diary_excerpt"),
                "excerpt": w.get("diary_excerpt"),
                "source_url": fetchable_source_url(src.get("source_url")),
                "source_title": src.get("title"),
                "license": src.get("license"),
                # Provenance for the one transformation Carta 3.4 allows.
                "verbatim_exact": w.get("verbatim_exact"),
                "normalizations": w.get("normalizations") or [],
                # The span exactly as the source holds it, line breaks and all.
                "raw_span": w.get("diary_excerpt_raw"),
            }
            claim_confidence = w["confidence"] if w.get("diary_excerpt") else (
                "reconstructed" if w["confidence"] == "certain" else w["confidence"])
            # A claim whose quote verify could not confirm has a source and
            # nothing to stand on it. The stage keeps its place in the route and
            # simply carries no claim — the same thing the log page already says
            # out loud, and a gap a reader can close.
            claims = [{
                "text": w.get("event") or "",
                "confidence": claim_confidence,
                "evidence": evidence,
            }] if evidence["excerpt"] and evidence["source_url"] else []
            if not claims:
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w.get('place_historical') or w['place_historical_raw']}'",
                    "no verbatim excerpt confirmed — stage kept, claim omitted "
                    "(Carta 3.4: verbatim or absent)", now))
            waypoints_out.append({
                "seq": w["seq"],
                "place_historical": w.get("place_historical") or w["place_historical_raw"],
                "place_modern": w.get("place_modern"),
                "latitude": w["latitude"],
                "longitude": w["longitude"],
                "arrival_date": w.get("arrival_date"),
                "confidence": w["confidence"],
                "coord_provenance": w.get("coord_provenance"),
                "claims": claims,
            })
        for i, w in enumerate(waypoints_out):
            w["seq"] = i + 1

        # A voyage runs forwards. Deterministic and free, so it runs on every
        # voyage rather than on the ones anyone thought to check. It flags
        # rather than repairs: which of two real visits a stage refers to is an
        # editorial question, and a script that silently picked one would be
        # inventing an answer.
        for where, why in chronology_breaks(waypoints_out):
            state = state.with_rejection(Rejection(where, why, now))

        submission = {
            "meta": {
                "type": "new-voyage",
                "target_voyage": voyage,
                "ideator": "terraveler-implementer",
                "contributor_rank": "cabin-boy",
                "scribe_model": EXTRACT_MODEL,
                "carta_version": CARTA_VERSION,
            },
            "voyage": {
                "slug": voyage,
                "title": meta["title"],
                "navigator": meta["navigator"],
                "ships": meta["ships"],
                "sponsor": meta["sponsor"],
                "summary": meta["summary"],
                "evidence_basis": meta["evidence_basis"],
                "what_was_lost": meta["what_was_lost"],
            },
            "waypoints": waypoints_out,
        }
        return (state
                .with_fact(Fact("submission", submission, "assemble", now))
                .with_fact(Fact("final_waypoints", len(waypoints_out), "assemble", now))
                .with_decision(Decision(
                    "draft", "assembled", now,
                    reason=f"{len(waypoints_out)} waypoints survived to the draft")))

    def write_draft(state, ctx_run):
        voyage = state.fact("voyage")
        out_dir = state.fact("out_dir")
        submission = state.fact("submission")
        now = ctx_run.now()

        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f"{voyage}.submission.json")
        payload = json.dumps(submission, indent=2, ensure_ascii=False)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(payload)

        # The idempotency key is the path: writing the same draft twice
        # produces the same file, which is what at-least-once buys here.
        ctx_run.record_effect(EffectDescriptor(
            effect_class=EXTERNAL,
            description=f"wrote the draft submission to {path}",
            idempotency_key=path,
            receipt=EffectReceipt(
                receipt_id=path,
                status="completed",
                result_fingerprint=_fingerprint(payload.encode("utf-8")),
            ),
        ))
        return state.with_fact(Fact("draft_path", path, "write_draft", now))

    def no_corpus(state, ctx_run):
        return state.with_fact(Fact(
            "outcome", "no-corpus", "no_corpus", ctx_run.now()))

    def no_itinerary(state, ctx_run):
        return state.with_fact(Fact(
            "outcome", "no-itinerary", "no_itinerary", ctx_run.now()))

    return {"load_corpus": load_corpus, "plan_itinerary": plan_itinerary,
            "extract": extract, "geocode": geocode, "anchor": anchor,
            "verify": verify, "assemble": assemble, "write_draft": write_draft,
            "no_corpus": no_corpus, "no_itinerary": no_itinerary}


# ------------------------------------------------------------------ the run

def initial_state(voyage, *, out_dir, plan_sample_size, chunk_limit, policy, ts):
    """Every input the run can turn on, as a Fact.

    Not as metadata: run metadata reaches the trace HEADER and nothing else, so
    two runs over different inputs produce byte-identical record streams and a
    reader has no way to tell them apart from the records alone. A Fact lands
    in `run_started.initial_state`, inside the stream.
    """
    return State.new(
        f"extract:{voyage}",
        facts=[
            Fact("voyage", voyage, "caller", ts),
            Fact("out_dir", out_dir, "caller", ts),
            Fact("plan_sample_size", plan_sample_size, "caller", ts),
            Fact("chunk_limit", chunk_limit, "caller", ts),
            Fact("policy", policy, "caller", ts),
        ],
        metadata={"voyage": voyage, "policy": policy},
    )


# Only `pure` nodes are re-executed by verify-replay; everything else in this
# graph reads the outside world or writes to it. Saying `partial` with that
# constraint is the strongest claim this graph can honour — and per invariant
# IV, declaring nothing would not have meant "reproducible", it would have
# meant "none", which is a weaker statement than the truth.
DECLARED_REPLAY = ReplayStatus.declared(
    "partial", ("only-pure-nodes-are-reexecutable",))


def run_extract(ctx, *, run_id, sink=None, policy=Policy.EXPLORATION, ts=None):
    """Execute the extract graph on Motus. Returns the RunResult."""
    ts = ts or datetime.now(timezone.utc)
    runtime = Runtime(SPEC, make_nodes(ctx), policy=policy, sink=sink)
    return runtime.run(
        initial_state(ctx.voyage, out_dir=ctx.out_dir,
                      plan_sample_size=ctx.plan_sample_size,
                      chunk_limit=ctx.chunk_limit, policy=ctx.policy_name, ts=ts),
        run_id=run_id, replay=DECLARED_REPLAY)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voyage", required=True, choices=list(VOYAGE_META.keys()))
    ap.add_argument("--policy", choices=["strict", "exploration"], default="exploration")
    ap.add_argument("--plan-sample-size", type=int, default=60,
                    help="number of chunks scattered across the full narrative "
                         "range shown to the itinerary planner")
    ap.add_argument("--out-dir", default="/app/out")
    ap.add_argument("--chunk-limit", type=int, default=0,
                    help="cap PD chunks fed to the planner sample (0 = all) — for smoke tests")
    args = ap.parse_args()

    # Fail before the graph runs, not after: an unclassified voyage would
    # otherwise reach the desk claiming a journal it may not have.
    _m = VOYAGE_META[args.voyage]
    if _m.get("evidence_basis") not in EVIDENCE_BASES:
        sys.exit(f"{args.voyage}: VOYAGE_META needs an 'evidence_basis' from "
                 f"{list(EVIDENCE_BASES)}, got {_m.get('evidence_basis')!r}")
    if not (_m.get("what_was_lost") or "").strip():
        sys.exit(f"{args.voyage}: VOYAGE_META needs 'what_was_lost' — one sentence "
                 f"naming what is missing from the record and how it went. If "
                 f"genuinely nothing is missing, say that in a sentence.")

    ctx = argparse.Namespace(
        voyage=args.voyage,
        plan_sample_size=args.plan_sample_size,
        out_dir=args.out_dir,
        chunk_limit=args.chunk_limit,
        policy_name=args.policy,
        pg_host=env("PGHOST", "terraveler_postgres"),
        pg_port=int(env("PGPORT", "5432")),
        pg_db=env("PGDATABASE", "terraveler"),
        pg_user=env("PGUSER", "terraveler"),
        pg_pass=env("PGPASSWORD", ""),
    )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"extract-{args.voyage}-{stamp}"
    started = datetime.now(timezone.utc)
    policy = Policy.STRICT if args.policy == "strict" else Policy.EXPLORATION

    print(f"▶ Motus extract  voyage={args.voyage}  graph={SPEC.name}  "
          f"policy={args.policy}", file=sys.stderr)
    # NodeFailed carries BOTH the accumulated state and the trace built up to
    # the failure — persist the evidence first and exit non-zero after.
    try:
        result = run_extract(ctx, run_id=run_id, policy=policy, ts=started)
        state, trace, failure = result.state, result.trace, None
        status = result.status
    except NodeFailed as exc:
        state, trace, failure = exc.state, exc.trace, exc
        status = "run_failed"
    finished = datetime.now(timezone.utc)

    facts = {f.key: f.value for f in state.facts} if state is not None else {}
    summary = {
        "run_id": run_id,
        "graph": SPEC.name,
        "graph_fingerprint": SPEC.graph_fingerprint,
        "voyage": args.voyage,
        "policy": args.policy,
        "status": status,
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        # The bulky ones live in the trace; the summary names the numbers.
        "facts": {k: v for k, v in facts.items()
                  if k not in ("submission", "verified", "anchored", "waypoints",
                               "stops", "plan_sample", "sources", "gazetteer_hits")},
        "decisions": [{"key": d.key, "value": d.value, "reason": d.reason}
                      for d in (state.decisions if state is not None else ())],
        "rejections": [{"what": r.what, "why": r.reason}
                       for r in (state.rejections if state is not None else ())],
        "records": len(trace.records) if trace is not None else 0,
    }

    os.makedirs(ctx.out_dir, exist_ok=True)
    trace_path = os.path.join(ctx.out_dir, f"{run_id}.trace.json")
    with open(trace_path, "w", encoding="utf-8") as fh:
        fh.write(trace.to_json() if trace is not None else "null")

    try:
        conn = C.pg_connect(ctx)
        with conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ingestion_runs
                  (trace_id, voyage_slug, policy, started_at, finished_at,
                   facts, chunks_embedded, chunks_rejected, trace)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (run_id, args.voyage, args.policy, started, finished,
                  int(facts.get("plan_stops", 0)),
                  int(facts.get("final_waypoints", 0)),
                  len(state.rejections) if state is not None else 0,
                  trace.to_json() if trace is not None else None))
        conn.close()
    except Exception as e:
        print(f"⚠ could not persist audit row to ingestion_runs: {e}", file=sys.stderr)

    print(json.dumps(summary, indent=2, ensure_ascii=False, default=str))
    print(f"  trace: {trace_path}", file=sys.stderr)
    if failure:
        print(f"✘ run FAILED — {failure}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
