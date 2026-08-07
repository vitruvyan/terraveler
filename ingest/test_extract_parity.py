"""Parity between the retired Axis extract graph and the native Motus one.

    python3 -m unittest test_extract_parity -v      (from ingest/)

This file is the last place in Terraveler that imports `vitruvyan_motus.compat`,
and it imports it on purpose: the Axis graph lives on here as the ORACLE the
native graph is measured against. Deleting it would end the only check that the
port did not quietly change what gets published.

The five Axis node bodies below are lifted VERBATIM from `extract.py` as it
stood at 96867e5, with one mechanical edit: the helpers they call now come from
`extract_core`, so a single stub reaches both pipelines. Nothing else changed —
if the two graphs disagree, the disagreement is the port's, not the lift's.

What is real and what is stubbed:
  real   — the corpus (SELECT on rag_docs, read-only), the embedding service,
           the pgvector kNN retrieval, the verbatim matcher, the chronology
           guard, VOYAGE_META
  stub   — the two model calls, the gazetteer, the live source re-fetch

The stubs are deterministic and derived from their input, which is what makes
the comparison mean anything: both pipelines see byte-identical answers, so any
difference in the submission is a difference in the pipelines.
"""
import argparse
import hashlib
import json
import os
import re
import tempfile
import unittest
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

# The one legitimate compat import left in the repository. See the docstring.
from vitruvyan_motus.compat import (
    GraphState, Runner, Policy, NodeFailed,
    Fact, LegacyDecision as Decision, Rejection,
)

import extract_core as C
import extract as N


# ====================================================== the Axis graph (oracle)
# Lifted verbatim from extract.py @ 96867e5. Do not "improve" it: its value is
# that it is the code that produced the drafts already on the desk.

def plan_itinerary_node(ctx, corpus):
    def node(state):
        meta = C.VOYAGE_META[ctx.voyage]
        lo, hi = meta.get("narrative_chunk_range", (0, 10**9))
        conn = C.pg_connect(ctx)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT DISTINCT title, source_url
                    FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text' AND license ILIKE 'public domain'
                """, (ctx.voyage,))
                sources = cur.fetchall()
                cur.execute("""
                    SELECT chunk_index, content, source_url, title, license
                    FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text' AND license ILIKE 'public domain'
                      AND chunk_index BETWEEN %s AND %s
                    ORDER BY chunk_index
                """, (ctx.voyage, lo, hi))
                corpus.chunks = cur.fetchall()
        finally:
            conn.close()

        state = state.with_decision(Decision(
            f"Plan itinerary: primary-journal narrative chunk_index range "
            f"[{lo},{hi}] (excludes front matter / table of contents / "
            f"back-of-book index) across {len(sources)} public-domain source(s)",
            C._now()))

        if ctx.chunk_limit:
            corpus.chunks = corpus.chunks[:ctx.chunk_limit]

        n = len(corpus.chunks)
        state = state.with_fact(Fact("pd_narrative_chunks", n, "plan_itinerary", C._now()))
        if n == 0:
            return state.with_rejection(Rejection(
                "plan_itinerary",
                f"no public-domain narrative chunks found for {ctx.voyage} in "
                f"range [{lo},{hi}]", C._now()))

        corpus.planned = False
        sample = C._plan_sample(corpus.chunks, ctx.plan_sample_size)
        listing = "\n\n".join(
            f"[chunk_index={c['chunk_index']}]\n{c['content'][:500]}" for c in sample)
        source_listing = "\n".join(f"- {s['title']} ({s['source_url']})" for s in sources)

        user = (
            f"VOYAGE: {meta['title']}\n"
            f"SUMMARY: {meta['summary']}\n\n"
            f"PRIMARY-JOURNAL SOURCE(S) IN THE CORPUS:\n{source_listing}\n\n"
            f"SAMPLE CHUNKS scattered across the full narrative span "
            f"(chunk_index {lo}-{hi}, {n} total chunks in range, "
            f"{len(sample)} sampled here):\n\n{listing}"
        )

        try:
            data = C._chat_json(C.PLAN_MODEL, C.PLAN_SYSTEM, user)
            stops = data.get("stops", [])
        except Exception as e:
            raise RuntimeError(
                f"planning call failed for {ctx.voyage}: {str(e)[:160]}. "
                f"No draft written — a voyage with no itinerary is a failed run, "
                f"not a short one.") from e

        corpus.planned = True
        waypoints = []
        for i, s in enumerate(stops):
            place = (s.get("place") or "").strip()
            if not place:
                continue
            waypoints.append({
                "seq": i + 1,
                "place_historical_raw": place,
                "canonical_what_happened": s.get("what_happened") or "",
                "chunk_lo": lo, "chunk_hi": hi,
                "candidate_dates": [s["approx_date"]] if s.get("approx_date") else [],
            })
        corpus.waypoints = waypoints

        state = state.with_fact(Fact("plan_sample_chunks", len(sample), "plan_itinerary", C._now()))
        state = state.with_fact(Fact("plan_stops", len(waypoints), "plan_itinerary", C._now()))

        if waypoints:
            first_l, last_l = waypoints[0]["place_historical_raw"].lower(), \
                waypoints[-1]["place_historical_raw"].lower()
            if "plymouth" not in first_l:
                state = state.with_rejection(Rejection(
                    "plan_itinerary endpoint check",
                    f"first stop '{waypoints[0]['place_historical_raw']}' does not "
                    f"mention Plymouth — verify the departure port is correct", C._now()))
            if not any(k in last_l for k in ("england", "downs", "london", "home")):
                state = state.with_rejection(Rejection(
                    "plan_itinerary endpoint check",
                    f"last stop '{waypoints[-1]['place_historical_raw']}' does not "
                    f"obviously read as the return/home leg — verify", C._now()))
            return state.with_decision(Decision(
                f"Plan itinerary ({C.PLAN_MODEL}): sampled {len(sample)}/{n} chunks "
                f"across narrative range [{lo},{hi}] -> {len(waypoints)} canonical "
                f"ordered stops (departure: '{waypoints[0]['place_historical_raw']}', "
                f"return: '{waypoints[-1]['place_historical_raw']}')", C._now()))
        return state.with_rejection(Rejection(
            "plan_itinerary", "planning call returned zero usable stops", C._now()))
    node.__name__ = "plan_itinerary"
    return node


def extract_node(ctx, corpus):
    def node(state):
        n_with_excerpt = 0
        failed_calls = []
        for w in corpus.waypoints:
            chunks = C.retrieve_chunks(ctx, corpus, w)
            w["_retrieved"] = chunks
            if not chunks:
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w['place_historical_raw']}'",
                    "no PD chunks retrieved near its chunk range", C._now()))
                continue
            listing = "\n\n".join(
                f"[chunk_index={c['chunk_index']}]\n{c['content']}" for c in chunks)
            try:
                data = C._chat_json(C.EXTRACT_MODEL, C.EXTRACT_SYSTEM,
                                    f"WAYPOINT HINT: {w['place_historical_raw']} "
                                    f"(candidate dates: {w['candidate_dates']})\n\n"
                                    f"JOURNAL EXCERPTS:\n\n{listing}")
            except Exception as e:
                failed_calls.append(w["seq"])
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w['place_historical_raw']}'",
                    f"extract call failed: {str(e)[:120]}", C._now()))
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
                w["evidence_source"] = chunks[0]
            else:
                w["evidence_source"] = src
                n_with_excerpt += 1

        state = state.with_fact(Fact("waypoints_with_candidate_excerpt", n_with_excerpt, "extract", C._now()))
        if failed_calls and len(failed_calls) > max(2, len(corpus.waypoints) // 5):
            raise RuntimeError(
                f"{len(failed_calls)} of {len(corpus.waypoints)} extract calls failed "
                f"for {ctx.voyage} (seqs {failed_calls[:8]}...). No draft written: a "
                f"truncated itinerary is indistinguishable from a complete one once "
                f"it reaches the desk.")

        return state.with_decision(Decision(
            f"Extract ({C.EXTRACT_MODEL}): grounded {len(corpus.waypoints)} waypoints, "
            f"{n_with_excerpt} with a candidate verbatim excerpt (pre-verification)", C._now()))
    node.__name__ = "extract"
    return node


def geocode_node(ctx, corpus):
    def node(state):
        for w in corpus.waypoints:
            approx = (w.get("approx_lat"), w.get("approx_lng"))
            has_approx = isinstance(approx[0], (int, float)) and isinstance(approx[1], (int, float))

            g = None
            try:
                g = C.oculus.geocode(w.get("geocode_name"))
            except Exception:
                g = None

            provenance = None
            retried = False
            if g and has_approx:
                dist = C.haversine_km(g["lat"], g["lng"], approx[0], approx[1])
                if dist > C.MISMATCH_KM:
                    retried = True
                    g2 = None
                    try:
                        g2 = C.oculus.geocode(w.get("place_historical") or w["place_historical_raw"])
                    except Exception:
                        g2 = None
                    if g2:
                        dist2 = C.haversine_km(g2["lat"], g2["lng"], approx[0], approx[1])
                        if dist2 <= C.MISMATCH_KM:
                            g = g2
                            dist = dist2
                        else:
                            g = None
                    else:
                        g = None
                    if g is None:
                        state = state.with_rejection(Rejection(
                            f"wp{w['seq']} geocode '{w.get('geocode_name')}'",
                            f"gazetteer mismatch >{C.MISMATCH_KM}km from model estimate "
                            f"({dist:.0f}km) even after retry — falling back to model coord",
                            C._now()))

            if g:
                w["latitude"], w["longitude"] = g["lat"], g["lng"]
                provenance = f"gazetteer:{g['gazetteer']}:{g.get('provenance')}"
                w["confidence"] = "approximate" if retried else "certain"
                if str(g.get("provenance", "")).startswith("wikidata:"):
                    w["wikidata_qid"] = g["provenance"].split(":", 1)[1]
                    w["identity_confidence"] = "approximate" if retried else "certain"
            elif has_approx:
                w["latitude"], w["longitude"] = approx[0], approx[1]
                provenance = "model-estimate (gazetteer unanchored/mismatched)"
                w["confidence"] = "reconstructed"
            else:
                w["latitude"], w["longitude"] = None, None
                provenance = "none"
                w["confidence"] = "reconstructed"
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} geocode", "no gazetteer hit and no model approx coord", C._now()))
            w["coord_provenance"] = provenance

        n_certain = sum(1 for w in corpus.waypoints if w["confidence"] == "certain")
        n_approx = sum(1 for w in corpus.waypoints if w["confidence"] == "approximate")
        n_recon = sum(1 for w in corpus.waypoints if w["confidence"] == "reconstructed")
        state = state.with_fact(Fact("confidence_certain", n_certain, "geocode", C._now()))
        state = state.with_fact(Fact("confidence_approximate", n_approx, "geocode", C._now()))
        state = state.with_fact(Fact("confidence_reconstructed", n_recon, "geocode", C._now()))
        return state.with_decision(Decision(
            f"Geocode: {n_certain} certain, {n_approx} approximate, {n_recon} reconstructed",
            C._now()))
    node.__name__ = "geocode"
    return node


def verify_node(ctx, corpus):
    def node(state):
        passed, dropped = 0, 0
        for w in corpus.waypoints:
            if not w.get("diary_excerpt"):
                continue
            src = w.get("evidence_source")
            url = C.fetchable_source_url(src["source_url"]) if src else None
            if not url:
                w["diary_excerpt"] = None
                dropped += 1
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} verify", "no source_url on evidence chunk", C._now()))
                continue
            try:
                live = corpus.fetch_live(url)
            except Exception as e:
                w["diary_excerpt"] = None
                dropped += 1
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} verify '{w['place_historical']}'",
                    f"source unreachable ({url}): {str(e)[:100]}", C._now()))
                continue
            raw, reading, transformations = C.locate_in_source(w["diary_excerpt"], live)
            w["verbatim_exact"] = (raw is not None and w["diary_excerpt"] == raw)
            w["normalizations"] = transformations or []
            if raw is not None:
                w["diary_excerpt"] = reading
                w["diary_excerpt_raw"] = raw
                if not C.reads_as_english(w["diary_excerpt"]):
                    dropped += 1
                    state = state.with_rejection(Rejection(
                        f"wp{w['seq']} verify '{w['place_historical']}'",
                        "excerpt verified verbatim but is not in English — nulled "
                        "per Carta 4 (sources may be in any language; published "
                        "content is in English)", C._now()))
                    w["diary_excerpt"] = None
                    continue
                passed += 1
                how = ("VERBATIM" if not transformations else
                       "VERBATIM once the page's own line breaks were closed "
                       "(Carta 3.4)")
                state = state.with_decision(Decision(
                    f"wp{w['seq']} '{w['place_historical']}': diary_excerpt VERIFIED "
                    f"{how} against live source", C._now()))
            else:
                dropped += 1
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} verify '{w['place_historical']}'",
                    "excerpt NOT found verbatim in re-fetched live source — "
                    "nulled per source-integrity rule (never fabricated)", C._now()))
                w["diary_excerpt"] = None

        rejoined = sum(1 for w in corpus.waypoints
                       if w.get("diary_excerpt") and w.get("normalizations"))
        state = state.with_fact(Fact("excerpts_verified", passed, "verify", C._now()))
        state = state.with_fact(Fact("excerpts_rejoined_across_lines", rejoined,
                                     "verify", C._now()))
        state = state.with_fact(Fact("excerpts_dropped", dropped, "verify", C._now()))
        return state.with_decision(Decision(
            f"Verify: {passed} excerpts VERBATIM-confirmed against live source, "
            f"{dropped} nulled (source-integrity gate)", C._now()))
    node.__name__ = "verify"
    return node


def assemble_node(ctx, corpus):
    def node(state):
        meta = C.VOYAGE_META[ctx.voyage]
        waypoints_out = []
        for w in corpus.waypoints:
            if w.get("latitude") is None:
                continue
            if not w.get("arrival_date"):
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w.get('place_historical') or w['place_historical_raw']}'",
                    "no arrival date in the source — dropped from the submission "
                    "(a chrono-diary cannot place an undated stage on the timeline)",
                    C._now()))
                continue
            src = w.get("evidence_source") or {}
            evidence = {
                "quote": w.get("diary_excerpt"),
                "excerpt": w.get("diary_excerpt"),
                "source_url": C.fetchable_source_url(src.get("source_url")),
                "source_title": src.get("title"),
                "license": src.get("license"),
                "verbatim_exact": w.get("verbatim_exact"),
                "normalizations": w.get("normalizations") or [],
                "raw_span": w.get("diary_excerpt_raw"),
            }
            claim_confidence = w["confidence"] if w.get("diary_excerpt") else (
                "reconstructed" if w["confidence"] == "certain" else w["confidence"])
            claims = [{
                "text": w.get("event") or "",
                "confidence": claim_confidence,
                "evidence": evidence,
            }] if evidence["excerpt"] and evidence["source_url"] else []
            if not claims:
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w.get('place_historical') or w['place_historical_raw']}'",
                    "no verbatim excerpt confirmed — stage kept, claim omitted "
                    "(Carta 3.4: verbatim or absent)", C._now()))
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

        for where, why in C.chronology_breaks(waypoints_out):
            state = state.with_rejection(Rejection(where, why, C._now()))

        submission = {
            "meta": {
                "type": "new-voyage",
                "target_voyage": ctx.voyage,
                "ideator": "terraveler-implementer",
                "contributor_rank": "cabin-boy",
                "scribe_model": C.EXTRACT_MODEL,
                "carta_version": C.CARTA_VERSION,
            },
            "voyage": {
                "slug": ctx.voyage,
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
        if not getattr(corpus, "planned", False):
            raise RuntimeError(
                f"{ctx.voyage}: planning never completed, so there is no itinerary "
                f"to assemble. Refusing to write a draft that would read as a "
                f"finished run.")
        corpus.submission = submission

        os.makedirs(ctx.out_dir, exist_ok=True)
        out_path = os.path.join(ctx.out_dir, f"{ctx.voyage}.submission.json")
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(submission, fh, indent=2, ensure_ascii=False)

        state = state.with_fact(Fact("final_waypoints", len(waypoints_out), "assemble", C._now()))
        return state.with_decision(Decision(
            f"Assembled DRAFT submission with {len(waypoints_out)} waypoints -> {out_path}",
            C._now()))
    node.__name__ = "assemble"
    return node


def build_nodes(ctx, corpus):
    return [
        plan_itinerary_node(ctx, corpus),
        extract_node(ctx, corpus),
        geocode_node(ctx, corpus),
        verify_node(ctx, corpus),
        assemble_node(ctx, corpus),
    ]


# ============================================================== the stub world

def _h(text, mod):
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest(), 16) % mod


def _sentences(text):
    """Spans a quoter could plausibly copy: real sentences, long enough to be
    findable, short enough to be a quotation."""
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text)
            if 60 <= len(s.strip()) <= 300]


class StubWorld:
    """Deterministic stand-ins for everything that costs money or leaves the
    machine. Both pipelines get byte-identical answers from it."""

    def __init__(self, voyage):
        self.voyage = voyage
        self.calls = {"plan": 0, "extract": 0, "geocode": 0, "fetch": 0}
        self.live_text = {}

    # ---- the two model calls -------------------------------------------
    def chat_json(self, model, system, user, temperature=0, timeout=180):
        if system is C.PLAN_SYSTEM or system.startswith("You are a maritime historian"):
            return self._plan(user)
        return self._extract(user)

    def _plan(self, user):
        self.calls["plan"] += 1
        idx = [int(m) for m in re.findall(r"\[chunk_index=(\d+)\]", user)]
        # A fixed, deliberately awkward itinerary: one stop the gazetteer will
        # anchor, one it will place far away (forcing the retry path), one it
        # will not find at all, and one with no date (dropped at assemble).
        stops = [
            {"place": "Plymouth, England", "approx_date": "1768-08-26",
             "what_happened": "Departure."},
            {"place": "Madeira", "approx_date": "1768-09-13",
             "what_happened": "Watering and wine."},
            {"place": "Rio de Janeiro, Brazil", "approx_date": "1768-11-13",
             "what_happened": "A cold reception from the viceroy."},
            {"place": "Nowhere-on-Earth Shoal", "approx_date": "1769-02-01",
             "what_happened": "A place no gazetteer holds."},
            {"place": "Undated Anchorage", "approx_date": None,
             "what_happened": "A stage the record never dates."},
            {"place": "The Downs, England", "approx_date": "1771-07-13",
             "what_happened": "Home."},
        ]
        self._plan_chunk_hint = idx
        return {"stops": stops}

    def _extract(self, user):
        self.calls["extract"] += 1
        blocks = re.findall(r"\[chunk_index=(\d+)\]\n(.*?)(?=\n\n\[chunk_index=|\Z)",
                            user, flags=re.S)
        hint = re.search(r"WAYPOINT HINT: (.*?) \(candidate dates", user)
        place = hint.group(1) if hint else "Somewhere"
        out = {
            "place_historical": place,
            "place_modern": place,
            "geocode_name": place,
            "approx_lat": None, "approx_lng": None,
            "arrival_date": None,
            "event": f"The ship called at {place}.",
            "diary_excerpt": None,
            "excerpt_chunk_index": None,
        }
        # dates and coordinates, deterministic per place
        if "Undated" not in place:
            out["arrival_date"] = f"17{68 + _h(place, 4)}-{1 + _h(place, 12):02d}-15"
        out["approx_lat"] = round(-60 + _h(place + "lat", 12000) / 100.0, 4)
        out["approx_lng"] = round(-180 + _h(place + "lng", 36000) / 100.0, 4)
        # a real verbatim span out of a real chunk, when one is long enough
        for ci, body in blocks:
            spans = _sentences(body)
            if spans:
                out["diary_excerpt"] = spans[_h(place, len(spans))]
                out["excerpt_chunk_index"] = int(ci)
                break
        return out

    # ---- the gazetteer ---------------------------------------------------
    def geocode(self, place):
        self.calls["geocode"] += 1
        if place is None or "Nowhere" in place:
            return None
        # A hit that agrees with the model estimate for most places, and one
        # that is deliberately half a world away, to exercise the retry.
        far = "Rio de Janeiro" in (place or "")
        base_lat = -60 + _h((place or "") + "lat", 12000) / 100.0
        base_lng = -180 + _h((place or "") + "lng", 36000) / 100.0
        if far:
            base_lat, base_lng = base_lat * -1, base_lng * -1
        return {"lat": round(base_lat, 4), "lng": round(base_lng, 4),
                "gazetteer": "stub", "provenance": f"wikidata:Q{_h(place, 900000)}",
                "source_url": "https://www.wikidata.org/wiki/Qstub"}

    # ---- the live source -------------------------------------------------
    def fetch_gutenberg(self, url):
        """The 'live' source is the corpus itself, reassembled. That is what
        makes the verbatim gate testable offline: a span copied out of a chunk
        is genuinely present in the text the matcher is handed."""
        self.calls["fetch"] += 1
        if url not in self.live_text:
            self.live_text[url] = "\n".join(
                r["content"] for r in _corpus_rows(self.voyage))
        return self.live_text[url]


_CORPUS_CACHE = {}


def _corpus_rows(voyage):
    if voyage not in _CORPUS_CACHE:
        ctx = _ctx(voyage, "/tmp")
        lo, hi = C.VOYAGE_META[voyage].get("narrative_chunk_range", (0, 10**9))
        conn = C.pg_connect(ctx)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT chunk_index, content FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text'
                      AND license ILIKE 'public domain'
                      AND chunk_index BETWEEN %s AND %s
                    ORDER BY chunk_index
                """, (voyage, lo, hi))
                _CORPUS_CACHE[voyage] = [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()
    return _CORPUS_CACHE[voyage]


def _ctx(voyage, out_dir, chunk_limit=40, plan_sample_size=12):
    return argparse.Namespace(
        voyage=voyage, plan_sample_size=plan_sample_size, out_dir=out_dir,
        chunk_limit=chunk_limit, policy_name="exploration",
        pg_host=C.env("PGHOST", "127.0.0.1"), pg_port=int(C.env("PGPORT", "6000")),
        pg_db=C.env("PGDATABASE", "terraveler"), pg_user=C.env("PGUSER", "terraveler"),
        pg_pass=C.env("PGPASSWORD", ""))


class _Patched:
    """Point the shared core at the stub world, for both pipelines alike."""

    def __init__(self, world):
        self.world = world
        self.saved = {}

    def __enter__(self):
        class _Oculus:
            geocode = staticmethod(self.world.geocode)

        class _Fetch:
            fetch_gutenberg = staticmethod(self.world.fetch_gutenberg)
            get_json = staticmethod(lambda *a, **k: {})

        for name, value in (("_chat_json", self.world.chat_json),
                            ("oculus", _Oculus), ("F", _Fetch)):
            self.saved[name] = getattr(C, name)
            setattr(C, name, value)
        return self

    def __exit__(self, *exc):
        for name, value in self.saved.items():
            setattr(C, name, value)
        return False


# ================================================================== the runs

def run_legacy(voyage, out_dir):
    ctx = _ctx(voyage, out_dir)
    corpus = C.Corpus()
    state = GraphState.empty(f"legacy-{voyage}").with_intent(f"extract:{voyage}")
    final = Runner(build_nodes(ctx, corpus), policy=Policy.EXPLORATION).run(state)
    return corpus.submission, {f.key: f.value for f in final.facts}, final


def run_native(voyage, out_dir, *, sink=None):
    ctx = _ctx(voyage, out_dir)
    result = N.run_extract(ctx, run_id=f"native-{voyage}", sink=sink,
                           policy=Policy.EXPLORATION,
                           ts=datetime(2026, 8, 7, 12, 0, tzinfo=timezone.utc))
    facts = {f.key: f.value for f in result.state.facts}
    return result.state.fact("submission"), facts, result


VOYAGES = ["cook-1768", "darwin-1831", "columbus-1492"]

# Facts the port deliberately renamed or added; compared separately.
_ONLY_NATIVE = {"voyage", "out_dir", "plan_sample_size", "chunk_limit", "policy",
                "sources", "plan_sample", "stops", "waypoints", "gazetteer_hits",
                "anchored", "verified", "submission", "draft_path"}


class Parity(unittest.TestCase):
    maxDiff = None

    def _both(self, voyage):
        world = StubWorld(voyage)
        with tempfile.TemporaryDirectory() as d_old, tempfile.TemporaryDirectory() as d_new:
            with _Patched(world):
                old_sub, old_facts, _ = run_legacy(voyage, d_old)
                new_sub, new_facts, res = run_native(voyage, d_new)
            with open(os.path.join(d_old, f"{voyage}.submission.json")) as fh:
                old_file = json.load(fh)
            with open(os.path.join(d_new, f"{voyage}.submission.json")) as fh:
                new_file = json.load(fh)
        return old_sub, new_sub, old_facts, new_facts, old_file, new_file, res

    def test_submissions_are_identical(self):
        for voyage in VOYAGES:
            with self.subTest(voyage=voyage):
                old, new, _, _, old_file, new_file, _ = self._both(voyage)
                self.assertIsNotNone(old, "the oracle produced no submission")
                self.assertEqual(old, new, f"{voyage}: submissions diverge")
                self.assertEqual(old_file, new_file,
                                 f"{voyage}: the files written to disk diverge")

    def test_shared_facts_are_identical(self):
        for voyage in VOYAGES:
            with self.subTest(voyage=voyage):
                _, _, old_facts, new_facts, _, _, _ = self._both(voyage)
                shared = set(old_facts) & set(new_facts)
                self.assertTrue(shared, "no facts in common — the lift is wrong")
                for k in sorted(shared):
                    self.assertEqual(old_facts[k], new_facts[k], f"fact {k!r} diverges")
                # every legacy fact still exists under its own name
                self.assertEqual(set(old_facts) - set(new_facts), set(),
                                 "the port dropped a fact the Axis graph published")


if __name__ == "__main__":
    unittest.main()
