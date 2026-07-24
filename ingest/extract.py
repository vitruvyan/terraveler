"""Terraveler voyage Extractor — Axis graph, run per voyage_slug.

    python extract.py --voyage cook-1768

Nodes: plan_itinerary -> extract -> geocode -> verify -> assemble.
Turns a voyage's pgvector text corpus (rag_docs) into a DRAFT submission
JSON in the submission_laperouse.json shape (meta + voyage + waypoints[].
claims[].evidence{quote, excerpt, source_url, source_title, license}).

Source integrity is non-negotiable: a diary_excerpt is either a VERBATIM
contiguous span re-verified against the live source text, or it is null.
Never fabricated, never paraphrased-then-passed-off-as-quote.

This script does NOT touch Supabase, the frontend, or anything public. It
only reads rag_docs / writes a submission JSON + a trace JSON.

------------------------------------------------------------------------
Design note (2026-07-23): itinerary PLANNING, not DISCOVERY.

The original version of this script tried to *discover* the itinerary by
outlining every PD chunk with an LLM (batch by batch) and then clustering
the resulting candidates into a canonical waypoint list. That approach
systematically favored densely-documented legs (whichever places got the
most journal chunks devoted to them) and dropped or scrambled the sparser
legs, because clustering/tie-breaking only ever sees candidates that
survived the outline pass, with no notion of "this voyage MUST include a
departure port and a return leg even if they're each only a few chunks".

`plan_itinerary_node` replaces outline+skeleton with a single planning
call: it shows the model the voyage's title/summary plus a SCATTERED
sample of chunks spanning the *entire* narrative chunk_index range (not
just the densest section), and asks for the canonical, ordered, complete
list of major stops — explicitly requiring a departure port and a
return/home leg. Which stops a well-documented historical voyage visited,
and in what order, is settled historical fact; letting the model propose
that list (grounded in a real span-covering sample, not vibes) is fine.
The per-stop grounding (retrieve -> extract -> geocode -> verify) is
UNCHANGED and remains the only thing allowed to touch diary_excerpt/quote
text — plan_itinerary never sees or produces a quote.
"""
import os
import re
import io
import sys
import json
import math
import time
import argparse
import unicodedata
import urllib.request
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

from axis import GraphState, Runner, Policy
from axis.state import Fact, Decision, Rejection

import fetch as F
import oculus

KEY = os.getenv("OPENAI_API_KEY", "")
EXTRACT_MODEL = os.getenv("EXTRACT_MODEL", "gpt-4.1")
PLAN_MODEL = os.getenv("PLAN_MODEL", EXTRACT_MODEL)
UA = "terraveler-extract/0.1 (contact: dbaldoni@gmail.com)"

VOYAGE_META = {
    "cook-1768": {
        "title": "The First Voyage of Captain James Cook (1768-1771)",
        "navigator": "Lieutenant James Cook",
        "ships": "HM Bark Endeavour",
        "sponsor": "Royal Society (Transit of Venus observation) & the Admiralty, "
                   "under secret instructions from King George III",
        "summary": "Cook's first voyage: from Plymouth round Cape Horn to Tahiti "
                    "to observe the Transit of Venus, west through the Society "
                    "Islands to become the first European expedition to "
                    "circumnavigate and chart New Zealand, on to the uncharted "
                    "east coast of New Holland (Australia) — including a near-wreck "
                    "on the Great Barrier Reef and repairs at the Endeavour River — "
                    "then home by way of Batavia, the Cape of Good Hope, and "
                    "St Helena to England.",
        "date_window": (1768, 1771),
        # rag_docs' primary journal source for this voyage is the Wharton 1893
        # edition ("Captain Cook's Journal During His First Voyage Round the
        # World", Project Gutenberg ebook 8106) — the FULL first-voyage journal,
        # Plymouth departure through Australia/Batavia/the Cape to the return
        # anchorage in the Downs. chunk_index is PER-SOURCE (restarts at 0 for
        # every distinct rag_docs title/source_url — the corpus also holds a
        # handful of Wikipedia articles, each with their own 0-based
        # chunk_index, which the 'public domain' license filter below already
        # excludes). This book's own front matter (publisher's preface + table
        # of contents + an editorial aside that strays into 2nd/3rd-voyage
        # sailing dates) runs chunk_index 0-195; the journal narrative proper
        # runs 196-2113 ("CHAPTER 1. ENGLAND TO RIO JANEIRO." at chunk 198,
        # through the return to the Downs / journey home to London at chunk
        # 2107); the back-of-book alphabetical INDEX runs 2114-2130. Confirmed
        # by direct inspection of the corpus rows (2026-07-23).
        "narrative_chunk_range": (196, 2113),
    },
    "cortes-1519": {
        "title": "The Conquest of Mexico by Hernán Cortés (1519-1521)",
        "navigator": "Hernán Cortés",
        "ships": "the Spanish expedition and its Tlaxcalan and indigenous allies",
        "sponsor": "sailing from Cuba, then acting in the name of King Charles I of Spain",
        "summary": "Cortés's march on the Aztec empire: the landing near Veracruz, "
                   "the alliance with Tlaxcala and the massacre at Cholula, the entry "
                   "into Tenochtitlan and the seizure of Moctezuma, the disastrous "
                   "retreat of La Noche Triste, the victory at Otumba, and the final "
                   "siege and fall of Tenochtitlan in 1521.",
        "date_window": (1519, 1521),
        # Multi-volume primary source (Bernal Díaz's Memoirs, Vols I & II): chunk_index
        # restarts per volume, so no single narrative range applies — defaults to the
        # whole PD span; per-stop pgvector retrieval + the canonical-itinerary plan
        # carry completeness across both volumes.
    },
}


def _now():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- text norm (verbatim check)
def norm(s):
    """Normalize text for verbatim matching: unicode quotes, whitespace, case.
    Mirrors scripts/curator.py's norm() exactly — same substring-match contract."""
    s = unicodedata.normalize("NFKC", s)
    s = (s.replace("‘", "'").replace("’", "'")
           .replace("“", '"').replace("”", '"')
           .replace("—", "-").replace("–", "-"))
    return re.sub(r"\s+", " ", s).strip().casefold()


def gutenberg_raw_url(url):
    """rag_docs.source_url for gutenberg texts is the human-readable /ebooks/{id}
    page (nice for citation) — but that's HTML, not fetchable as plain text.
    Map it to the actual raw .txt location used at ingestion time (pipeline.py's
    fetch_gutenberg fetched from cache/epub/{id}/pg{id}.txt). Verify MUST re-fetch
    this raw URL, and the submission should cite it too (matches the
    submission_laperouse.json shape, whose source_url is already a raw .txt link
    that a re-verifier — e.g. scripts/curator.py — can fetch and substring-match)."""
    if not url:
        return url
    m = re.search(r"gutenberg\.org/ebooks/(\d+)", url)
    if m:
        i = m.group(1)
        return f"https://www.gutenberg.org/cache/epub/{i}/pg{i}.txt"
    return url


def haversine_km(a_lat, a_lng, b_lat, b_lng):
    R = 6371.0
    p = math.pi / 180
    s = (math.sin((b_lat - a_lat) * p / 2) ** 2
         + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin((b_lng - a_lng) * p / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(s))


# ---------------------------------------------------------------- OpenAI call
def _chat_json(model, system, user, temperature=0, timeout=120):
    if not KEY:
        raise RuntimeError("OPENAI_API_KEY not set")
    body = {
        "model": model, "temperature": temperature,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                content = json.load(r)["choices"][0]["message"]["content"]
            return json.loads(content)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1.6 ** attempt)


def _embed(text):
    body = json.dumps({"text": text}).encode()
    url = os.environ.get("EMBED_URL", "http://terraveler_embedding:8010").rstrip("/") \
        + "/v1/embeddings/create"
    req = urllib.request.Request(url, data=body, method="POST",
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.loads(r.read().decode())
    if not resp.get("success"):
        raise RuntimeError(resp.get("error") or "embed failed")
    return resp["embedding"]


def _emb_literal(vec):
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


# ---------------------------------------------------------------- side-channel
class Corpus:
    def __init__(self):
        self.chunks = []          # ordered PD journal chunks for the voyage (planning sample source)
        self.waypoints = []       # plan_itinerary -> extract -> geocode -> verify
        self.submission = None
        self._fetch_cache = {}    # url -> live re-fetched full text (verify)

    def fetch_live(self, url):
        if url not in self._fetch_cache:
            self._fetch_cache[url] = F.fetch_gutenberg(url)
        return self._fetch_cache[url]


# ---------------------------------------------------------------- db
def pg_connect(ctx):
    return psycopg2.connect(host=ctx.pg_host, port=ctx.pg_port, dbname=ctx.pg_db,
                             user=ctx.pg_user, password=ctx.pg_pass)


# ================================================================== NODE 1: plan_itinerary
PLAN_SYSTEM = """You are a maritime historian producing the canonical, ORDERED \
itinerary — the complete list of major stops, in chronological order — for a \
specific historical voyage. Which places a well-documented voyage like this \
visited, and in what order, is settled historical fact; you are not \
inventing anything, you are enumerating it correctly and completely. (The \
actual diary quotes proving each stop will be grounded separately, later, \
against the real source text — you are not being asked for quotes here, \
only for the itinerary skeleton.)

You are given the voyage's title/summary, and a SAMPLE of chunks scattered \
across the ENTIRE chunk_index span of the primary journal source in the \
corpus (not just its densest, most-quoted middle section) — use it as \
supporting context and a sanity check, but rely primarily on your own \
historical knowledge of this voyage for completeness and ordering, since a \
sparse sample can easily under-represent a real leg that the ship still \
visited.

REQUIREMENTS — all mandatory:
1. The FIRST stop MUST be the voyage's departure port (where it set sail from).
2. The LAST stop MUST be the return/home leg (where and how the voyage ended).
3. Include EVERY major landfall or leg in between, in chronological order. \
Do NOT skip a leg just because the sample shows it only briefly or not at \
all — if you know historically the ship went there, include it. Do NOT \
merge two historically distinct legs into one stop just to shorten the list.
4. 10-24 stops is typical for a multi-year global voyage; let the true \
number of distinct legs decide the count, don't force a round number.
5. For each stop, give your best-effort approximate arrival date (partial is \
fine, e.g. "1770-04" or "1770-04-29"); null if genuinely unknown.

Return STRICT JSON: {"stops": [{"place": "<place name, plain English, with \
enough context to disambiguate e.g. 'Botany Bay, New Holland (Australia)'>", \
"approx_date": "<YYYY-MM[-DD] or null>", "what_happened": "<<=200 char \
summary of what happened at/around this stop>"}, ...]} in final \
chronological order, departure first, return/home last."""


def _plan_sample(corpus_chunks, target):
    """Scatter a representative sample across the WHOLE narrative range so the
    planner sees the full span (including sparsely-documented legs), rather
    than whatever happens to be densest. Always anchors the first and last
    narrative chunks (departure / return context)."""
    n = len(corpus_chunks)
    if n == 0:
        return []
    step = max(1, n // target)
    sample = corpus_chunks[::step][:target]
    for edge in (corpus_chunks[0], corpus_chunks[-1]):
        if edge not in sample:
            sample.append(edge)
    sample.sort(key=lambda c: c["chunk_index"])
    return sample


def plan_itinerary_node(ctx, corpus):
    def node(state):
        meta = VOYAGE_META[ctx.voyage]
        lo, hi = meta.get("narrative_chunk_range", (0, 10**9))
        conn = pg_connect(ctx)
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
            f"back-of-book index) across {len(sources)} public-domain source(s)", _now()))

        if ctx.chunk_limit:
            corpus.chunks = corpus.chunks[:ctx.chunk_limit]

        n = len(corpus.chunks)
        state = state.with_fact(Fact("pd_narrative_chunks", n, "plan_itinerary", _now()))
        if n == 0:
            return state.with_rejection(Rejection(
                "plan_itinerary",
                f"no public-domain narrative chunks found for {ctx.voyage} in "
                f"range [{lo},{hi}]", _now()))

        sample = _plan_sample(corpus.chunks, ctx.plan_sample_size)
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
            data = _chat_json(PLAN_MODEL, PLAN_SYSTEM, user)
            stops = data.get("stops", [])
        except Exception as e:
            return state.with_rejection(Rejection(
                "plan_itinerary", f"planning call failed: {str(e)[:140]}", _now()))

        waypoints = []
        for i, s in enumerate(stops):
            place = (s.get("place") or "").strip()
            if not place:
                continue
            waypoints.append({
                "seq": i + 1,
                "place_historical_raw": place,
                "canonical_what_happened": s.get("what_happened") or "",
                # full narrative range -> the per-stop retrieve step below does an
                # UNBIASED semantic kNN search over the whole journal for this
                # place, rather than assuming a chunk-position prior we don't have.
                "chunk_lo": lo, "chunk_hi": hi,
                "candidate_dates": [s["approx_date"]] if s.get("approx_date") else [],
            })
        corpus.waypoints = waypoints

        state = state.with_fact(Fact("plan_sample_chunks", len(sample), "plan_itinerary", _now()))
        state = state.with_fact(Fact("plan_stops", len(waypoints), "plan_itinerary", _now()))

        # audit-only sanity check on the two mandatory endpoints (non-fatal —
        # exploration policy keeps going either way, but this is visible in
        # the trace for human review).
        if waypoints:
            first_l, last_l = waypoints[0]["place_historical_raw"].lower(), \
                waypoints[-1]["place_historical_raw"].lower()
            if "plymouth" not in first_l:
                state = state.with_rejection(Rejection(
                    "plan_itinerary endpoint check",
                    f"first stop '{waypoints[0]['place_historical_raw']}' does not "
                    f"mention Plymouth — verify the departure port is correct", _now()))
            if not any(k in last_l for k in ("england", "downs", "london", "home")):
                state = state.with_rejection(Rejection(
                    "plan_itinerary endpoint check",
                    f"last stop '{waypoints[-1]['place_historical_raw']}' does not "
                    f"obviously read as the return/home leg — verify", _now()))
            return state.with_decision(Decision(
                f"Plan itinerary ({PLAN_MODEL}): sampled {len(sample)}/{n} chunks "
                f"across narrative range [{lo},{hi}] -> {len(waypoints)} canonical "
                f"ordered stops (departure: '{waypoints[0]['place_historical_raw']}', "
                f"return: '{waypoints[-1]['place_historical_raw']}')", _now()))
        return state.with_rejection(Rejection(
            "plan_itinerary", "planning call returned zero usable stops", _now()))
    node.__name__ = "plan_itinerary"
    return node


# ================================================================== NODE 2: extract
EXTRACT_SYSTEM = """You are grounding ONE waypoint of a historical voyage or \
expedition using ONLY the primary-source excerpts shown below (a journal, \
memoir, or chronicle, all public domain). Do not use outside knowledge for \
facts not supported by the shown text, except for well-known geography \
needed to name the place.

Produce:
- place_historical: the place name as the 18th-century journal calls it.
- place_modern: the modern name, with country/region for disambiguation.
- geocode_name: a geocoding-ready name string INCLUDING country/region, e.g. \
"Botany Bay, New South Wales, Australia" — this is critical, a bare place \
name is not enough.
- approx_lat, approx_lng: your best-guess coordinate (decimal degrees) for \
place_modern, used only to sanity-check a gazetteer lookup — do not spend \
long deliberating, a reasonable estimate is fine.
- arrival_date: best date you can support from the text or context, ISO \
format, partial is fine ("1769-04" or "1769-04-13"); null if unknown.
- event: 1-2 sentences of prose describing what happened here, grounded in \
the shown excerpts.
- diary_excerpt: a VERBATIM, CONTIGUOUS span (1-3 sentences, copied \
EXACTLY, same spelling/punctuation) from ONE of the shown chunks that \
supports the event — or null if no good verbatim span exists. NEVER \
paraphrase and call it an excerpt. NEVER invent a quote. The span MUST be \
actual narrative prose (a full sentence or sentences describing what \
happened, with a subject and a verb) — NEVER a chapter/section heading, a \
table-of-contents-style line, or a fragment containing a bare page number \
(e.g. reject anything shaped like "CHAP. II. The Passage from Madeira to \
Rio de Janeiro, with some Account of ... 18"). If the only text mentioning \
this place is a heading, set diary_excerpt to null rather than use it.
- excerpt_chunk_index: the chunk_index (integer, shown in brackets before \
each excerpt) the diary_excerpt was copied from — null if diary_excerpt is \
null.

Return STRICT JSON with exactly these keys: place_historical, place_modern, \
geocode_name, approx_lat, approx_lng, arrival_date, event, diary_excerpt, \
excerpt_chunk_index."""


def retrieve_chunks(ctx, corpus, waypoint, k=8, pad=60):
    ctx_hint = waypoint.get("canonical_what_happened") or ""
    query_text = (f"{waypoint['place_historical_raw']} — historical voyage "
                  f"primary-source narrative. {ctx_hint}").strip()
    try:
        vec = _embed(query_text)
    except Exception:
        vec = None

    nlo, nhi = VOYAGE_META[ctx.voyage].get("narrative_chunk_range", (0, 10**9))
    conn = pg_connect(ctx)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            lo = max(nlo, waypoint["chunk_lo"] - pad)
            hi = min(nhi, waypoint["chunk_hi"] + pad)
            if vec is not None:
                cur.execute("""
                    SELECT chunk_index, content, source_url, title, license,
                           1 - (embedding <=> %s::vector) AS similarity
                    FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text' AND license ILIKE 'public domain'
                      AND chunk_index BETWEEN %s AND %s
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                """, (_emb_literal(vec), ctx.voyage, lo, hi, _emb_literal(vec), k))
            else:
                cur.execute("""
                    SELECT chunk_index, content, source_url, title, license, NULL AS similarity
                    FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text' AND license ILIKE 'public domain'
                      AND chunk_index BETWEEN %s AND %s
                    ORDER BY chunk_index
                    LIMIT %s
                """, (ctx.voyage, lo, hi, k))
            rows = cur.fetchall()
            if not rows:
                # fall back to plain chunk_index window, no semantic filter
                cur.execute("""
                    SELECT chunk_index, content, source_url, title, license
                    FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text' AND license ILIKE 'public domain'
                      AND chunk_index BETWEEN %s AND %s
                    ORDER BY chunk_index
                    LIMIT %s
                """, (ctx.voyage, waypoint["chunk_lo"], waypoint["chunk_hi"], k))
                rows = cur.fetchall()
            return rows
    finally:
        conn.close()


def extract_node(ctx, corpus):
    def node(state):
        n_with_excerpt = 0
        for w in corpus.waypoints:
            chunks = retrieve_chunks(ctx, corpus, w)
            w["_retrieved"] = chunks
            if not chunks:
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w['place_historical_raw']}'",
                    "no PD chunks retrieved near its chunk range", _now()))
                continue
            listing = "\n\n".join(
                f"[chunk_index={c['chunk_index']}]\n{c['content']}" for c in chunks)
            try:
                data = _chat_json(EXTRACT_MODEL, EXTRACT_SYSTEM,
                                   f"WAYPOINT HINT: {w['place_historical_raw']} "
                                   f"(candidate dates: {w['candidate_dates']})\n\n"
                                   f"JOURNAL EXCERPTS:\n\n{listing}")
            except Exception as e:
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w['place_historical_raw']}'",
                    f"extract call failed: {str(e)[:120]}", _now()))
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

        state = state.with_fact(Fact("waypoints_with_candidate_excerpt", n_with_excerpt, "extract", _now()))
        return state.with_decision(Decision(
            f"Extract ({EXTRACT_MODEL}): grounded {len(corpus.waypoints)} waypoints, "
            f"{n_with_excerpt} with a candidate verbatim excerpt (pre-verification)", _now()))
    node.__name__ = "extract"
    return node


# ================================================================== NODE 3: geocode
MISMATCH_KM = 600


def geocode_node(ctx, corpus):
    def node(state):
        for w in corpus.waypoints:
            approx = (w.get("approx_lat"), w.get("approx_lng"))
            has_approx = isinstance(approx[0], (int, float)) and isinstance(approx[1], (int, float))

            g = None
            try:
                g = oculus.geocode(w.get("geocode_name"))
            except Exception:
                g = None

            provenance = None
            retried = False
            if g and has_approx:
                dist = haversine_km(g["lat"], g["lng"], approx[0], approx[1])
                if dist > MISMATCH_KM:
                    retried = True
                    g2 = None
                    try:
                        g2 = oculus.geocode(w.get("place_historical") or w["place_historical_raw"])
                    except Exception:
                        g2 = None
                    if g2:
                        dist2 = haversine_km(g2["lat"], g2["lng"], approx[0], approx[1])
                        if dist2 <= MISMATCH_KM:
                            g = g2
                            dist = dist2
                        else:
                            g = None  # both gazetteer hits disagree with the model -> distrust gazetteer
                    else:
                        g = None
                    if g is None:
                        state = state.with_rejection(Rejection(
                            f"wp{w['seq']} geocode '{w.get('geocode_name')}'",
                            f"gazetteer mismatch >{MISMATCH_KM}km from model estimate "
                            f"({dist:.0f}km) even after retry — falling back to model coord", _now()))

            if g:
                w["latitude"], w["longitude"] = g["lat"], g["lng"]
                provenance = f"gazetteer:{g['gazetteer']}:{g.get('provenance')}"
                w["confidence"] = "approximate" if retried else "certain"
            elif has_approx:
                w["latitude"], w["longitude"] = approx[0], approx[1]
                provenance = "model-estimate (gazetteer unanchored/mismatched)"
                w["confidence"] = "reconstructed"
            else:
                w["latitude"], w["longitude"] = None, None
                provenance = "none"
                w["confidence"] = "reconstructed"
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} geocode", "no gazetteer hit and no model approx coord", _now()))
            w["coord_provenance"] = provenance

        n_certain = sum(1 for w in corpus.waypoints if w["confidence"] == "certain")
        n_approx = sum(1 for w in corpus.waypoints if w["confidence"] == "approximate")
        n_recon = sum(1 for w in corpus.waypoints if w["confidence"] == "reconstructed")
        state = state.with_fact(Fact("confidence_certain", n_certain, "geocode", _now()))
        state = state.with_fact(Fact("confidence_approximate", n_approx, "geocode", _now()))
        state = state.with_fact(Fact("confidence_reconstructed", n_recon, "geocode", _now()))
        return state.with_decision(Decision(
            f"Geocode: {n_certain} certain, {n_approx} approximate, {n_recon} reconstructed", _now()))
    node.__name__ = "geocode"
    return node


# ================================================================== NODE 4: verify
def verify_node(ctx, corpus):
    def node(state):
        passed, dropped = 0, 0
        for w in corpus.waypoints:
            if not w.get("diary_excerpt"):
                continue
            src = w.get("evidence_source")
            url = gutenberg_raw_url(src["source_url"]) if src else None
            if not url:
                w["diary_excerpt"] = None
                dropped += 1
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} verify", "no source_url on evidence chunk", _now()))
                continue
            try:
                live = corpus.fetch_live(url)
            except Exception as e:
                w["diary_excerpt"] = None
                dropped += 1
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} verify '{w['place_historical']}'",
                    f"source unreachable ({url}): {str(e)[:100]}", _now()))
                continue
            if norm(w["diary_excerpt"]) in norm(live):
                passed += 1
                state = state.with_decision(Decision(
                    f"wp{w['seq']} '{w['place_historical']}': diary_excerpt VERIFIED "
                    f"VERBATIM against live source", _now()))
            else:
                dropped += 1
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} verify '{w['place_historical']}'",
                    "excerpt NOT found verbatim in re-fetched live source — "
                    "nulled per source-integrity rule (never fabricated)", _now()))
                w["diary_excerpt"] = None

        state = state.with_fact(Fact("excerpts_verified", passed, "verify", _now()))
        state = state.with_fact(Fact("excerpts_dropped", dropped, "verify", _now()))
        return state.with_decision(Decision(
            f"Verify: {passed} excerpts VERBATIM-confirmed against live source, "
            f"{dropped} nulled (source-integrity gate)", _now()))
    node.__name__ = "verify"
    return node


# ================================================================== NODE 5: assemble
def assemble_node(ctx, corpus):
    def node(state):
        meta = VOYAGE_META[ctx.voyage]
        waypoints_out = []
        for w in corpus.waypoints:
            if w.get("latitude") is None:
                continue  # unanchored — drop from submission, kept only in trace/rejections
            src = w.get("evidence_source") or {}
            evidence = {
                "quote": w.get("diary_excerpt"),
                "excerpt": w.get("diary_excerpt"),
                "source_url": gutenberg_raw_url(src.get("source_url")),
                "source_title": src.get("title"),
                "license": src.get("license"),
            }
            claim_confidence = w["confidence"] if w.get("diary_excerpt") else (
                "reconstructed" if w["confidence"] == "certain" else w["confidence"])
            waypoints_out.append({
                "seq": w["seq"],
                "place_historical": w.get("place_historical") or w["place_historical_raw"],
                "place_modern": w.get("place_modern"),
                "latitude": w["latitude"],
                "longitude": w["longitude"],
                "arrival_date": w.get("arrival_date"),
                "confidence": w["confidence"],
                "coord_provenance": w.get("coord_provenance"),
                "claims": [{
                    "text": w.get("event") or "",
                    "confidence": claim_confidence,
                    "evidence": evidence,
                }],
            })
        for i, w in enumerate(waypoints_out):
            w["seq"] = i + 1

        submission = {
            "meta": {
                "type": "new-voyage",
                "target_voyage": ctx.voyage,
                "ideator": "terraveler-implementer",
                "contributor_rank": "cabin-boy",
                "scribe_model": EXTRACT_MODEL,
                "carta_version": "0.1",
            },
            "voyage": {
                "slug": ctx.voyage,
                "title": meta["title"],
                "navigator": meta["navigator"],
                "ships": meta["ships"],
                "sponsor": meta["sponsor"],
                "summary": meta["summary"],
            },
            "waypoints": waypoints_out,
        }
        corpus.submission = submission

        os.makedirs(ctx.out_dir, exist_ok=True)
        out_path = os.path.join(ctx.out_dir, f"{ctx.voyage}.submission.json")
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(submission, fh, indent=2, ensure_ascii=False)

        state = state.with_fact(Fact("final_waypoints", len(waypoints_out), "assemble", _now()))
        return state.with_decision(Decision(
            f"Assembled DRAFT submission with {len(waypoints_out)} waypoints -> {out_path}", _now()))
    node.__name__ = "assemble"
    return node


# ================================================================== wiring
def build_nodes(ctx, corpus):
    return [
        plan_itinerary_node(ctx, corpus),
        extract_node(ctx, corpus),
        geocode_node(ctx, corpus),
        verify_node(ctx, corpus),
        assemble_node(ctx, corpus),
    ]


def env(k, default=None):
    return os.environ.get(k, default)


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

    ctx = argparse.Namespace(
        voyage=args.voyage,
        plan_sample_size=args.plan_sample_size,
        out_dir=args.out_dir,
        chunk_limit=args.chunk_limit,
        pg_host=env("PGHOST", "terraveler_postgres"),
        pg_port=int(env("PGPORT", "5432")),
        pg_db=env("PGDATABASE", "terraveler"),
        pg_user=env("PGUSER", "terraveler"),
        pg_pass=env("PGPASSWORD", ""),
    )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    trace_id = f"extract-{args.voyage}-{stamp}"
    started = datetime.now(timezone.utc)

    corpus = Corpus()
    nodes = build_nodes(ctx, corpus)
    policy = Policy.STRICT if args.policy == "strict" else Policy.EXPLORATION

    state = GraphState.empty(trace_id).with_intent(f"extract:{args.voyage}")
    runner = Runner(nodes, policy=policy)

    print(f"▶ Axis extract  voyage={args.voyage}  policy={args.policy}", file=sys.stderr)
    final = runner.run(state)
    finished = datetime.now(timezone.utc)

    facts = {f.key: f.value for f in final.facts}
    summary = {
        "trace_id": trace_id,
        "voyage": args.voyage,
        "policy": args.policy,
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "facts": facts,
        "decisions": [d.description for d in final.decisions],
        "rejections": [{"what": r.description, "why": r.reason} for r in final.rejections],
        "events": len(final.events),
    }

    os.makedirs(ctx.out_dir, exist_ok=True)
    trace_path = os.path.join(ctx.out_dir, f"{trace_id}.trace.json")
    with open(trace_path, "w", encoding="utf-8") as fh:
        json.dump({**summary, "trace": final.to_dict()}, fh, indent=2, ensure_ascii=False)

    try:
        conn = pg_connect(ctx)
        with conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ingestion_runs
                  (trace_id, voyage_slug, policy, started_at, finished_at,
                   facts, chunks_embedded, chunks_rejected, trace)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (trace_id, args.voyage, args.policy, started, finished,
                  int(facts.get("plan_stops", 0)),
                  int(facts.get("final_waypoints", 0)),
                  len(final.rejections), json.dumps(final.to_dict())))
        conn.close()
    except Exception as e:
        print(f"⚠ could not persist audit row to ingestion_runs: {e}", file=sys.stderr)

    print("─" * 60)
    print(json.dumps(summary, indent=2))
    print("─" * 60)
    print(f"✔ trace: {trace_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
