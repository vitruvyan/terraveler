#!/usr/bin/env python3
"""
Build the place gazetteer: resolve the atlas's place names to Wikidata entities.

Why this exists
---------------
Bougainville's "Taïti (New Cythera)" and Cook's "King George's Island" are the
same island, and nothing in the atlas knew it: each voyage carried free-text
place names and coordinates, so the same landfall appeared as many unrelated
strings. Identity is what turns a collection of voyages into an atlas.

The ingestion pipeline already resolved places against Wikidata to get their
coordinates (ingest/oculus.py) and then discarded everything but lat/lng —
including the QID, which is precisely the identity. This script recovers it for
the voyages already published; extract.py persists it going forward.

Resolution is verified, not guessed
-----------------------------------
Searching Wikidata for "Tahiti" returns the island — and also a street in the
Czech Republic. Name search alone is not evidence. Since every waypoint already
carries coordinates the extractor established, each candidate entity is checked
against them: a candidate is accepted only if its own P625 coordinate falls
within tolerance of where the voyage actually was. That makes the identity an
attested claim rather than a lucky first hit, and it yields an honest
confidence — which the Magna Carta requires of any claim (§3.3).

Unresolved places are left out rather than guessed: "verbatim or absent".

Usage:
    python3 scripts/build_gazetteer.py            # writes data/gazetteer.json
    python3 scripts/build_gazetteer.py --dry-run  # report only
"""

from __future__ import annotations

import hashlib
import json
import os
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "gazetteer.json"

# Wikidata asks bots to identify themselves and go easy; this runs rarely.
UA = "TerravelerGazetteer/1.0 (https://www.terraveler.com; editorial desk)"
PAUSE = 0.25

# A voyage's anchorage is not an island's centroid, and 18th-century positions
# carry their own error. Generous enough for that, tight enough to reject a
# same-named place on another continent.
NEAR_KM = 60      # confident: the entity is where the voyage was
FAR_KM = 250      # plausible: accepted, but flagged approximate


CACHE_PATH = ROOT / ".gazetteer-cache.json"          # Wikidata payloads (transient)
DECISIONS_PATH = DATA / "gazetteer-decisions.json"   # judgements (versioned, auditable)
PENDING_PATH = DATA / "gazetteer-pending.json"       # shortlists awaiting judgement
_cache: dict = {}
_decisions: dict = {}


def cache_load() -> None:
    global _cache
    if CACHE_PATH.exists():
        try:
            _cache = json.loads(CACHE_PATH.read_text())
        except Exception:
            _cache = {}


def cache_save() -> None:
    CACHE_PATH.write_text(json.dumps(_cache))


def decisions_load() -> None:
    """Judgements are content-addressed by the question asked, so they survive
    re-runs, new voyages and re-orderings: the same shortlist for the same name
    always finds its answer. Kept in the repo rather than a cache directory
    because an identification is a claim, and git is where this project keeps
    the provenance of claims."""
    global _decisions
    if DECISIONS_PATH.exists():
        try:
            raw = json.loads(DECISIONS_PATH.read_text())
            _decisions = {d["key"]: d for d in raw.get("decisions", [])}
        except Exception:
            _decisions = {}


def decision_key(atlas_name: str, qids: list[str]) -> str:
    return hashlib.sha1(("|".join([atlas_name.lower().strip(), *sorted(qids)])).encode()).hexdigest()[:16]


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def haversine(a_lat, a_lng, b_lat, b_lng) -> float:
    R = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = math.radians(b_lat - a_lat), math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def candidate_names(wp: dict) -> list[str]:
    """Names worth searching, most identifiable first.

    Modern names resolve best ("Tahiti, French Polynesia" → Tahiti); historical
    ones carry the period voice and often the alias we most want to record
    ("King George's Island"). Parentheses usually hold alternative names, so
    they are split out rather than searched as one string.
    """
    names: list[str] = []
    for field in ("place_modern", "place_historical"):
        raw = (wp.get(field) or "").strip()
        if not raw:
            continue
        head = raw.split(",")[0].strip()          # drop ", Society Islands, French Polynesia"
        parts = re.split(r"[()/]", head)
        for p in parts:
            p = p.strip(" .")
            if len(p) > 2 and p.lower() not in {name.lower() for name in names}:
                names.append(p)
    return names[:4]


def search(name: str) -> list[str]:
    key = f"search:{name}"
    if key in _cache:
        return _cache[key]
    q = urllib.parse.urlencode({
        "action": "wbsearchentities", "search": name, "language": "en",
        "format": "json", "limit": 6, "type": "item"})
    try:
        hits = get_json(f"https://www.wikidata.org/w/api.php?{q}").get("search") or []
    except Exception:
        return []
    _cache[key] = [h["id"] for h in hits]
    return _cache[key]


def fetch_entities(qids: list[str]) -> dict:
    """wbgetentities takes 50 ids at a time — one call instead of fifty."""
    out: dict = {}
    fresh = [q for q in qids if f"ent:{q}" not in _cache]
    for q in qids:
        if f"ent:{q}" in _cache:
            out[q] = _cache[f"ent:{q}"]
    for i in range(0, len(fresh), 50):
        batch = fresh[i:i + 50]
        q = urllib.parse.urlencode({
            "action": "wbgetentities", "ids": "|".join(batch), "format": "json",
            "props": "labels|aliases|descriptions|claims", "languages": "en"})
        try:
            got = get_json(f"https://www.wikidata.org/w/api.php?{q}").get("entities") or {}
            for qid, ent in got.items():
                _cache[f"ent:{qid}"] = ent
            out.update(got)
        except Exception as e:
            print(f"  ! entity batch failed: {e}", file=sys.stderr)
        time.sleep(PAUSE)
    return out


EARTH = "http://www.wikidata.org/entity/Q2"


def coord_of(entity: dict):
    """P625 for Earth only. Wikidata records coordinates for lunar and Martian
    features too, on the same property with a different globe — reading those as
    terrestrial is how a crater becomes a village."""
    try:
        for claim in entity["claims"]["P625"]:
            v = claim["mainsnak"]["datavalue"]["value"]
            if v.get("globe", EARTH) != EARTH:
                continue
            return float(v["latitude"]), float(v["longitude"])
    except Exception:
        pass
    return None


def instance_labels(entity: dict) -> list[str]:
    try:
        return [c["mainsnak"]["datavalue"]["value"]["id"] for c in entity["claims"].get("P31", [])]
    except Exception:
        return []


# Deciding what a landfall can be is a semantic judgement, not a pattern.
# Wikidata's P31 classes are a long tail of thousands — "airport", "metro
# station", "naval base" and "earthquake" were only the four wrong answers the
# first six voyages happened to surface. Enumerating the rest by hand is a
# losing race, so the decision is made by a model that reads the candidate and
# the question, and every decision is written down.
#
# Cost discipline (AGENTS.md §5): the model is asked once per (place, shortlist)
# and never again. Coordinates do the cheap filtering first — usually leaving
# one or two candidates — so judgement is spent only where it decides something.

def class_labels(qids: list[str]) -> dict:
    """Human-readable P31 labels, batched and cached."""
    need = [q for q in qids if f"cls:{q}" not in _cache]
    for i in range(0, len(need), 50):
        batch = need[i:i + 50]
        q = urllib.parse.urlencode({
            "action": "wbgetentities", "ids": "|".join(batch), "format": "json",
            "props": "labels", "languages": "en"})
        try:
            got = get_json(f"https://www.wikidata.org/w/api.php?{q}").get("entities") or {}
            for qid, ent in got.items():
                _cache[f"cls:{qid}"] = (ent.get("labels", {}).get("en", {}) or {}).get("value", "")
        except Exception as e:
            print(f"  ! class batch failed: {e}", file=sys.stderr)
        time.sleep(PAUSE)
    return {q: _cache.get(f"cls:{q}", "") for q in qids}


def main() -> int:
    dry = "--dry-run" in sys.argv
    cache_load()
    decisions_load()

    # 1. Collect every waypoint that has coordinates to verify against.
    stops: list[dict] = []
    for path in sorted(DATA.glob("*.json")):
        if path.name == "gazetteer.json":
            continue
        try:
            doc = json.loads(path.read_text())
        except Exception:
            continue
        if "waypoints" not in doc or "voyage" not in doc:
            continue
        # Wikidata place coordinates are Earth coordinates. Apollo 11's stations
        # sit at 0.67N 23.47E *on the Moon*; those same numbers on Earth fall in
        # the Congo basin, so verifying a lunar waypoint against a terrestrial
        # gazetteer would manufacture false identities. Off-Earth voyages need
        # their own gazetteer (planetary nomenclature), not this one.
        if (doc["voyage"].get("body") or "earth") != "earth":
            print(f"  skipping {doc['voyage']['slug']}: not an Earth voyage")
            continue
        slug = doc["voyage"]["slug"]
        for wp in doc["waypoints"]:
            lat, lng = wp.get("latitude"), wp.get("longitude")
            if lat is None or lng is None:
                continue          # space voyages carry no geographic position
            names = candidate_names(wp)
            if not names:
                continue
            stops.append({"voyage": slug, "seq": wp["seq"], "lat": lat, "lng": lng,
                          "names": names,
                          # Newer extractions carry the identity already (see
                          # ingest/extract.py); no need to re-derive it.
                          "known_qid": wp.get("wikidata_qid"),
                          "year": str(wp.get("arrival_date") or "")[:4] or None,
                          "historical": wp.get("place_historical"),
                          "modern": wp.get("place_modern")})

    print(f"waypoints with coordinates: {len(stops)}")

    # 2. Search each distinct name once.
    by_name: dict[str, list[str]] = {}
    all_names = sorted({n for s in stops for n in s["names"]})
    print(f"distinct names to resolve: {len(all_names)}")
    for i, name in enumerate(all_names, 1):
        cached = f"search:{name}" in _cache
        by_name[name] = search(name)
        if i % 25 == 0:
            print(f"  searched {i}/{len(all_names)}")
        if not cached:
            time.sleep(PAUSE)
    cache_save()

    # 3. Fetch every candidate entity in batches.
    qids = sorted({q for hits in by_name.values() for q in hits})
    print(f"candidate entities to fetch: {len(qids)}")
    entities = fetch_entities(qids)
    cache_save()
    print(f"entities fetched: {len(entities)}")

    # 4. Identify each stop: coordinates narrow, judgement decides.
    all_classes = sorted({c for e in entities.values() for c in instance_labels(e)})
    labels_of = class_labels(all_classes)
    cache_save()

    def shortlist(stop):
        """Candidates the coordinates cannot rule out. Cheap, deterministic and
        free: it usually leaves one or two entities, which is what makes the
        judgement below affordable."""
        out = []
        for name in stop["names"]:
            for qid in by_name.get(name, []):
                ent = entities.get(qid)
                if not ent:
                    continue
                c = coord_of(ent)
                if not c:
                    continue
                d = haversine(stop["lat"], stop["lng"], c[0], c[1])
                if d > FAR_KM:
                    continue
                out.append({
                    "qid": qid,
                    "distance_km": round(d, 1),
                    "matched_on": name,
                    "label": (ent.get("labels", {}).get("en", {}) or {}).get("value", qid),
                    "description": (ent.get("descriptions", {}).get("en", {}) or {}).get("value", ""),
                    "classes": [labels_of.get(c2, c2) for c2 in instance_labels(ent)],
                })
        best: dict[str, dict] = {}
        for o in out:
            if o["qid"] not in best or o["distance_km"] < best[o["qid"]]["distance_km"]:
                best[o["qid"]] = o
        return sorted(best.values(), key=lambda o: o["distance_km"])

    def ask_model(stop, cands) -> dict | None:
        """Which of these entities is the place this voyage called at?

        Asked once per shortlist and cached forever. The model compares
        candidates against each other rather than classifying each in
        isolation, which is what distinguishes an island from the airport on
        it. Returning null is a valid answer: an unidentified landfall is
        better than an invented one (Carta §3.4)."""
        model = os.getenv("GAZETTEER_MODEL", "claude-sonnet-5")
        key = os.getenv("ANTHROPIC_API_KEY" if model.startswith("claude")
                        else "OPENAI_API_KEY", "")
        if not key:
            return None
        listing = "\n".join(
            f'  {i+1}. {c["qid"]} — {c["label"]}: {c["description"] or "no description"} '
            f'[{", ".join(c["classes"]) or "unclassified"}] — {c["distance_km"]} km away'
            for i, c in enumerate(cands))
        prompt = (
            f'A {stop.get("year") or "historical"} voyage recorded a landfall it called '
            f'"{stop["historical"] or stop["modern"]}"'
            + (f' (today: {stop["modern"]})' if stop.get("modern") else "")
            + f'. Wikidata entities near the position the voyage recorded:\n{listing}\n\n'
            'Which entity IS that place? Reject anything that could not be a landfall of '
            'that period — airports, railway or metro stations, military bases, museums, '
            'monuments, events, modern institutions — even when it sits at the right '
            'coordinates and carries the right name. Prefer the geographic feature or '
            'settlement itself; where a historical and a modern entity both exist, prefer '
            'the one the voyage would have called at. If none of them is the place, say so.\n'
            'Answer as JSON only: {"qid": "Q…" or null, "reason": "one short sentence"}')
        # Either provider, chosen by the model name — the same fix extract.py
        # needed. 244 stops sat unidentified for a day because one account's
        # billing ran out, which is not a fact about geography.
        if model.startswith("claude"):
            url = "https://api.anthropic.com/v1/messages"
            headers = {"x-api-key": key, "anthropic-version": "2023-06-01",
                       "Content-Type": "application/json"}
            body = {"model": model, "max_tokens": 512,
                    "system": "Answer with a single JSON object and nothing else.",
                    "messages": [{"role": "user", "content": prompt}]}
        else:
            url = "https://api.openai.com/v1/chat/completions"
            headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
            body = {"model": model, "temperature": 0,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "user", "content": prompt}]}
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                payload = json.load(r)
            if model.startswith("claude"):
                # Every text block, not the first: a reply can lead with
                # something else and the KeyError then says only 'text'.
                text = "".join(b.get("text", "") for b in payload.get("content", [])
                               if b.get("type") == "text")
            else:
                text = payload["choices"][0]["message"]["content"]
            text = text.strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
            out = json.loads(text[text.find("{"):text.rfind("}") + 1] or text)
            return {"qid": out.get("qid") or None, "reason": (out.get("reason") or "")[:300],
                    "decided_by": payload.get("model", model)}
        except urllib.error.HTTPError as e:
            # The body says what is wrong; the status alone says only that
            # something is.
            print(f"  ! judgement failed for {stop['historical']}: HTTP {e.code} "
                  f"{e.read().decode('utf-8', 'replace')[:160]}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"  ! judgement failed for {stop['historical']}: {e}", file=sys.stderr)
            return None

    # Shortlist every stop, then judge only what the coordinates left ambiguous.
    options: dict[int, list] = {}
    pending: list[dict] = []
    new_decisions = 0
    for i, s_ in enumerate(stops):
        cands = shortlist(s_)
        if s_.get("known_qid"):
            hit = next((c for c in cands if c["qid"] == s_["known_qid"]), None)
            if hit:
                options[i] = [hit]
                continue
        if not cands:
            options[i] = []
            continue
        atlas_name = s_["historical"] or s_["modern"] or ""
        key = decision_key(atlas_name, [c["qid"] for c in cands])
        verdict = _decisions.get(key)
        if verdict is None:
            verdict = ask_model(s_, cands)
            if verdict:
                verdict = {**verdict, "key": key, "atlas_name": atlas_name,
                           "candidates": [c["qid"] for c in cands],
                           "decided_at": time.strftime("%Y-%m-%d")}
                _decisions[key] = verdict
                new_decisions += 1
        if verdict is None:
            # No judgement available yet: record the question for an operator
            # (or a later run with a key) rather than guessing an answer.
            pending.append({"key": key, "voyage": s_["voyage"], "seq": s_["seq"],
                            "atlas_name": atlas_name, "modern": s_.get("modern"),
                            "year": s_.get("year"), "candidates": cands})
            options[i] = []
            continue
        picked = verdict.get("qid")
        options[i] = [c for c in cands if c["qid"] == picked] if picked else []

    if new_decisions:
        DECISIONS_PATH.write_text(json.dumps(
            {"note": "Which Wikidata entity each landfall is. Content-addressed by the "
                     "question asked, so re-runs and new voyages reuse them.",
             "decisions": sorted(_decisions.values(), key=lambda d: d["atlas_name"].lower())},
            ensure_ascii=False, indent=1) + "\n")
        print(f"new judgements recorded: {new_decisions}")

    if pending:
        PENDING_PATH.write_text(json.dumps({"pending": pending}, ensure_ascii=False, indent=1) + "\n")
        print(f"awaiting judgement: {len(pending)} stops → {PENDING_PATH.relative_to(ROOT)}")
        print("  (set ANTHROPIC_API_KEY or OPENAI_API_KEY and re-run, or adjudicate them into "
              f"{DECISIONS_PATH.relative_to(ROOT)})")
    elif PENDING_PATH.exists():
        PENDING_PATH.unlink()

    chosen: dict[int, dict] = {i: o[0] for i, o in options.items() if o}

    # No reconciliation pass is needed: identity is settled by the judgement
    # itself. Two stops asking the same question — Bougainville's "Batavia" and
    # Cook's, with the same candidates — share a decision key and so cannot
    # disagree, and stops that ask differently ("Cape of Good Hope (Table Bay)"
    # and "Table Bay") converge when the answer is the same entity. What used to
    # be a reconciliation heuristic here was really a symptom of deciding
    # per-stop by distance.

    gazetteer: dict[str, dict] = {}
    unresolved: list[dict] = []
    for i, s in enumerate(stops):
        best = chosen.get(i)
        if not best:
            unresolved.append(s)
            continue
        qid = best["qid"]
        ent = entities[qid]
        label = (ent.get("labels", {}).get("en", {}) or {}).get("value") or best["matched_on"]
        aliases = [a["value"] for a in (ent.get("aliases", {}).get("en") or [])]
        desc = (ent.get("descriptions", {}).get("en", {}) or {}).get("value")
        lat, lng = coord_of(ent)

        entry = gazetteer.setdefault(qid, {
            "qid": qid,
            "name": label,
            "description": desc,
            "latitude": round(lat, 5),
            "longitude": round(lng, 5),
            "instance_of": [labels_of.get(c, c) for c in instance_labels(ent)],
            "aliases": [],
            "names_in_the_atlas": [],
            "visits": [],
            "source_url": f"https://www.wikidata.org/wiki/{qid}",
        })
        for a in aliases:
            if a not in entry["aliases"]:
                entry["aliases"].append(a)
        for field in ("historical", "modern"):
            v = s.get(field)
            if v and v not in entry["names_in_the_atlas"]:
                entry["names_in_the_atlas"].append(v)
        entry["visits"].append({
            "voyage": s["voyage"],
            "seq": s["seq"],
            "called_it": s["historical"] or s["modern"],
            "distance_km": best["distance_km"],
            # Distance from the position the voyage itself recorded is the
            # evidence for this identification, so it sets the confidence
            # rather than being hidden — Carta §3.3.
            "confidence": "certain" if best["distance_km"] <= NEAR_KM else "approximate",
        })

    for e in gazetteer.values():
        e["visits"].sort(key=lambda v: (v["voyage"], v["seq"]))
        e["voyages"] = sorted({v["voyage"] for v in e["visits"]})

    shared = {q: e for q, e in gazetteer.items() if len(e["voyages"]) > 1}
    print(f"\nresolved places: {len(gazetteer)}")
    print(f"unresolved stops: {len(unresolved)}")
    print(f"places visited by more than one voyage: {len(shared)}")
    for e in sorted(shared.values(), key=lambda e: -len(e["voyages"]))[:12]:
        called = " / ".join(sorted({v['called_it'] for v in e['visits'] if v['called_it']}))
        print(f"   {e['name']:26} {e['qid']:10} {len(e['voyages'])} voyages — called: {called[:70]}")
    if unresolved:
        print("\nunresolved (left out rather than guessed):")
        for s in unresolved[:12]:
            print(f"   {s['voyage']:16} wp{s['seq']:<3} {s['historical'] or s['modern']}")

    if dry:
        print("\n--dry-run: nothing written")
        return 0

    payload = {
        "generated_from": "scripts/build_gazetteer.py",
        "source": "Wikidata (CC0), verified against each voyage's own recorded coordinates",
        "tolerance_km": {"certain": NEAR_KM, "accepted": FAR_KM},
        "places": [gazetteer[q] for q in sorted(gazetteer, key=lambda q: gazetteer[q]["name"])],
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n")
    print(f"\nwrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} kB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
