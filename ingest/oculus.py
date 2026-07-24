"""terraveler_oculus (light) — trusted-source harvester.

Given a subject, discovers candidate sources across the WHITELIST ONLY:
Gutenberg (via the Gutendex index), Wikipedia, Wikimedia Commons. Every
candidate is checked against whitelist.is_allowed and tagged with its licence;
anything off-whitelist is dropped. No open-web spidering, ever.

A lean echo of Vitruvyan's Oculus intake gateway — minus Redis streams and
evidence packs (the Axis GraphState trace is our audit).
"""
import re
import urllib.parse

import fetch as F
import whitelist as W


def gutendex_books(subject: str, limit: int = 3):
    """Public-domain books from Project Gutenberg matching the subject."""
    q = urllib.parse.urlencode({"search": subject})
    data = F.get_json(f"https://gutendex.com/books/?{q}")
    out = []
    for b in data.get("results", []):
        fmts = b.get("formats", {})
        txt = None
        for k, v in fmts.items():
            if k.startswith("text/plain") and isinstance(v, str) and not v.endswith(".zip"):
                txt = v
                break
        if not txt or not W.is_allowed(txt):
            continue
        title = b.get("title", "")
        authors = ", ".join(a.get("name", "") for a in b.get("authors", []))
        out.append({
            "kind": "gutenberg",
            "title": (f"{title} — {authors}").strip(" —"),
            "url": txt,
            "source_url": f"https://www.gutenberg.org/ebooks/{b.get('id')}",
            "license": "Public domain",
        })
        if len(out) >= limit:
            break
    return out


def wikipedia_candidates(subject: str, lang: str = "en", limit: int = 8):
    api = f"https://{lang}.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "list": "search", "srsearch": subject,
        "srlimit": limit, "format": "json"})
    res = F.get_json(api).get("query", {}).get("search", [])
    out = []
    for t in res:
        snippet = re.sub(r"<[^>]+>", "", t.get("snippet", ""))
        out.append({"title": t["title"], "snippet": snippet})
    return out


def discover(subject: str, lang: str = "en", max_books: int = 3,
             max_articles: int = 8, image_terms=None):
    """Return a FLAT list of on-whitelist candidate sources for a subject,
    each with a hint for the curator agent to judge relevance.

    { "candidates": [ {id, kind, title, hint, license, ...} ], "image_terms": [...] }
    """
    candidates = []
    cid = 0
    for b in gutendex_books(subject, max_books):
        cid += 1
        candidates.append({**b, "id": cid,
                           "hint": f"Public-domain book: {b['title']}"})
    for w in wikipedia_candidates(subject, lang, max_articles):
        cid += 1
        candidates.append({"id": cid, "kind": "wikipedia", "lang": lang,
                           "title": w["title"], "hint": w["snippet"],
                           "license": "CC BY-SA 4.0",
                           "source_url": f"https://{lang}.wikipedia.org/wiki/"
                                         + w["title"].replace(" ", "_")})
    return {"candidates": candidates, "image_terms": image_terms or [subject]}


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
