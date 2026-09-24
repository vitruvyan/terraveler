"""terraveler_oculus (light) — trusted-source harvester.

Given a subject, discovers candidate sources across the WHITELIST ONLY. Which
sources it searches is data-driven off `source_registry` — a consultative
capability registry, read from `source_search_adapters` in Postgres, of what
each adapter can search and with what config — never off two hardcoded names.
Every candidate URL an adapter proposes is still checked against
`whitelist.is_allowed()` unchanged; a misconfigured adapter row can only
shrink discovery, never widen what may be ingested. No open-web spidering,
ever. See `source_registry.py` for the adapter functions and the trust/
capability boundary.

A lean echo of Vitruvyan's Oculus intake gateway — minus Redis streams and
evidence packs (the Motus trace is our audit).
"""
import urllib.parse

import fetch as F
import source_registry as SR

# Candidates go to the curator LLM in a single prompt (curate.py). Before the
# registry, discovery had exactly two adapters and topped out around 11
# candidates/subject; four adapters at their configured max_candidates can
# already exceed 40. Nobody decided to spend that many curator tokens per
# subject, so the total is capped explicitly, after merging every adapter's
# results and sorting by adapter priority — not left to however many adapters
# happen to be enabled on a given day.
DEFAULT_CANDIDATE_CAP = 24


def discover(subject: str, lang: str = "en", max_books: int = 3,
             max_articles: int = 8, image_terms=None,
             registry: "SR.RegistrySnapshot | None" = None,
             total_cap: int = DEFAULT_CANDIDATE_CAP):
    """Return a FLAT list of on-whitelist candidate sources for a subject,
    each with a hint for the curator agent to judge relevance, plus enough
    bookkeeping for the caller to write an honest trace.

    `max_books`/`max_articles` are a legacy soft cap kept only so old callers
    that still pass them get the old behaviour: they clamp the 'gutendex' and
    the Wikipedia-kind 'mediawiki_search' adapter respectively, on top of
    whatever `max_candidates` the DB row already configures. Every other
    adapter is capped by its own DB row alone.

    `registry`: an already-loaded `SR.RegistrySnapshot`, for a caller that
    wants to inspect or reuse the same snapshot across more than one call
    (e.g. a test). Left as the default `None`, `SR.get_registry()` is called
    here instead, which loads at most once per process and per
    `CACHE_TTL_SECONDS` after that — so every real caller (scout.py,
    pipeline_native.py's `discover` node) still only pays the DB/snapshot
    round-trip once per run, without needing to pass anything in explicitly.

    Returns:
      { "candidates": [...], "image_terms": [...],
        "adapters_used": [...], "adapters_unimplemented": [...],
        "adapters_failed": [...], "adapters_gap": [...],
        "dropped_by_cap": {adapter: n}, "registry_source": "db"|"snapshot",
        "registry_note": "..." }
    """
    reg = registry if registry is not None else SR.get_registry()

    search_adapters = sorted(
        (a for a in reg.adapters if a.capability == "search"),
        key=lambda a: (a.priority, a.id))

    adapters_used = []
    unimplemented = []
    failed = []
    pooled = []  # (priority, adapter_name, candidate_dict)

    for a in search_adapters:
        adapters_used.append({
            "adapter": a.adapter, "priority": a.priority,
            "endpoint_id": a.endpoint_id, "institution_id": a.institution_id,
            "max_candidates": a.max_candidates})
        fn = SR.ADAPTERS.get(a.adapter)
        if fn is None:
            unimplemented.append(a.adapter)
            continue

        effective_max = a.max_candidates
        if a.adapter == "gutendex":
            effective_max = min(effective_max, max_books)
        elif a.adapter == "mediawiki_search" and a.config.get("kind") == "wikipedia":
            effective_max = min(effective_max, max_articles)

        try:
            found = fn(subject, lang, a.config, effective_max) or []
        except Exception as exc:
            failed.append({"adapter": a.adapter,
                           "why": f"{type(exc).__name__}: {str(exc)[:160]}"})
            continue
        for c in found[:effective_max]:
            pooled.append((a.priority, a.adapter, c))

    pooled.sort(key=lambda t: t[0])
    kept, dropped = pooled[:total_cap], pooled[total_cap:]

    dropped_by_cap: dict = {}
    for _, adapter_name, _ in dropped:
        dropped_by_cap[adapter_name] = dropped_by_cap.get(adapter_name, 0) + 1

    candidates = []
    for cid, (_, _, c) in enumerate(kept, start=1):
        c = dict(c)
        c["id"] = cid
        c.setdefault("hint", f"{c.get('kind', '?')}: {c.get('title', '')}")
        candidates.append(c)

    return {
        "candidates": candidates,
        "image_terms": image_terms or [subject],
        "adapters_used": adapters_used,
        "adapters_unimplemented": sorted(set(unimplemented)),
        "adapters_failed": failed,
        "adapters_gap": reg.gap,
        "dropped_by_cap": dropped_by_cap,
        "registry_source": reg.source,
        "registry_note": reg.note,
    }


# ---------------------------------------------------------------- geo intake
# Oculus is the universal intake gateway. Geocoding a place NAME -> coordinate
# lives here (name normalization is the LLM's job upstream; this is the
# deterministic gazetteer lookup). Wikidata P625 first (citable QID), then
# Nominatim/OSM as fallback. Never fabricates: returns None if unanchored.
def geocode(place: str):
    place = (place or "").strip()
    if not place:
        return None
    # 1) Wikidata: search the entity, read its P625 coordinate.
    try:
        q = urllib.parse.urlencode({
            "action": "wbsearchentities", "search": place, "language": "en",
            "format": "json", "limit": 1, "type": "item"})
        hits = (F.get_json(f"https://www.wikidata.org/w/api.php?{q}").get("search") or [])
        if hits:
            qid = hits[0]["id"]
            ent = F.get_json(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")
            claims = ent["entities"][qid].get("claims", {})
            p625 = claims.get("P625")
            if p625:
                v = p625[0]["mainsnak"]["datavalue"]["value"]
                return {"lat": round(v["latitude"], 5), "lng": round(v["longitude"], 5),
                        "provenance": f"wikidata:{qid}", "gazetteer": "wikidata",
                        "matched": hits[0].get("label", place),
                        "source_url": f"https://www.wikidata.org/wiki/{qid}"}
    except Exception:
        pass
    # 2) Nominatim / OpenStreetMap fallback.
    try:
        q = urllib.parse.urlencode({"q": place, "format": "json", "limit": 1})
        r = F.get_json(f"https://nominatim.openstreetmap.org/search?{q}")
        if r:
            return {"lat": round(float(r[0]["lat"]), 5), "lng": round(float(r[0]["lon"]), 5),
                    "provenance": "nominatim", "gazetteer": "nominatim",
                    "matched": r[0].get("display_name", place)[:60],
                    "source_url": None}
    except Exception:
        pass
    return None  # unanchored -> caller forces confidence=reconstructed
