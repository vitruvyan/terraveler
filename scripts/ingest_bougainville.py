#!/usr/bin/env python3
"""
Terraveler RAG ingestion — Bougainville v1.

Builds the rag_docs corpus (public-domain journals + Diderot + CC-BY-SA
Wikipedia + public-domain Wikimedia Commons images described by Gemini-vision).
Stdlib only (urllib) — no pip installs.

Run schema first (supabase/rag_schema.sql), then:

  DRY_RUN=1 python scripts/ingest_bougainville.py     # just gather & report, no API/DB
  # then, with keys set, for real:
  GEMINI_API_KEY=...  SUPABASE_URL=https://xxx.supabase.co  SUPABASE_SERVICE_KEY=... \
      DRY_RUN=0 python scripts/ingest_bougainville.py

Only public-domain / CC sources are ingested. Copyrighted secondary sites
(e.g. herodote.net) are NOT ingested — link to them / short quotes only.
"""
import os, re, json, time, base64, urllib.request, urllib.parse, urllib.error

DRY_RUN = os.environ.get("DRY_RUN", "1") != "0"
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
SB_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SB_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
VISION_MODEL = os.environ.get("GEMINI_VISION_MODEL", "gemini-1.5-flash")
EMBED_MODEL = "text-embedding-004"
VOYAGE = "boudeuse-1766"
UA = "terraveler-rag/1.0 (contact: dbaldoni@gmail.com)"

# ---------------------------------------------------------------- sources
TEXT_SOURCES = [
    {"kind": "gutenberg",
     "title": "Bougainville — A Voyage Round the World (trans. Forster, 1772)",
     "url": "https://www.gutenberg.org/cache/epub/73429/pg73429.txt",
     "source_url": "https://www.gutenberg.org/ebooks/73429",
     "license": "Public domain"},
    {"kind": "gutenberg",
     "title": "Diderot — Supplément au Voyage de Bougainville",
     "url": "https://www.gutenberg.org/cache/epub/6501/pg6501.txt",
     "source_url": "https://www.gutenberg.org/ebooks/6501",
     "license": "Public domain"},
    {"kind": "gutenberg",
     "title": "Bougainville — Voyage autour du monde (French, 1771)",
     "url": "https://www.gutenberg.org/cache/epub/28485/pg28485.txt",
     "source_url": "https://www.gutenberg.org/ebooks/28485",
     "license": "Public domain"},
    {"kind": "wikipedia", "lang": "en",
     "license": "CC BY-SA 4.0",
     "titles": ["Louis Antoine de Bougainville", "Tahiti", "Ahutoru",
                "Jeanne Barret", "Philibert Commerson", "Noble savage",
                "Bougainvillea"]},
]

IMAGE_QUERIES = [
    "Louis-Antoine de Bougainville portrait",
    "Tahiti 18th century engraving",
    "Bougainvillea botanical illustration",
    "La Boudeuse ship 18th century",
    "Ahutoru Tahitian",
    "Jeanne Barret circumnavigation",
]
IMAGES_PER_QUERY = 2

# ---------------------------------------------------------------- http
def _read(req, timeout):
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"HTTP {e.code}: {detail}") from None

def _get(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    return _read(req, 60)

def get_text(url):
    return _get(url).decode("utf-8", "replace")

def get_json(url):
    return json.loads(_get(url).decode("utf-8", "replace"))

def post_json(url, body, headers):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"User-Agent": UA, "Content-Type": "application/json", **headers})
    raw = _read(req, 120)
    return json.loads(raw.decode("utf-8", "replace")) if raw else {}

# ---------------------------------------------------------------- fetchers
def fetch_gutenberg(url):
    txt = get_text(url)
    a = re.search(r"\*\*\* START OF.*?\*\*\*", txt, re.S)
    b = re.search(r"\*\*\* END OF", txt)
    if a: txt = txt[a.end():]
    if b: txt = txt[:b.start()]
    return txt.strip()

def fetch_wikisource(lang, page):
    api = f"https://{lang}.wikisource.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "prop": "extracts", "explaintext": 1,
        "titles": page, "redirects": 1, "format": "json"})
    pages = get_json(api)["query"]["pages"]
    return " ".join((p.get("extract") or "") for p in pages.values()).strip()

def fetch_wikipedia(lang, title):
    api = f"https://{lang}.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "prop": "extracts", "explaintext": 1,
        "titles": title, "redirects": 1, "format": "json"})
    pages = get_json(api)["query"]["pages"]
    return " ".join((p.get("extract") or "") for p in pages.values()).strip()

def commons_images(query, limit):
    api = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "generator": "search", "gsrsearch": query,
        "gsrnamespace": 6, "gsrlimit": limit * 3, "prop": "imageinfo",
        "iiprop": "url|extmetadata", "iiurlwidth": 1024, "format": "json"})
    out = []
    pages = (get_json(api).get("query") or {}).get("pages") or {}
    for p in pages.values():
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata") or {}
        lic = (meta.get("LicenseShortName") or {}).get("value", "")
        if not re.search(r"public domain|^cc", lic, re.I):
            continue  # keep only PD / CC
        out.append({
            "title": p.get("title", ""),
            "img": ii.get("thumburl") or ii.get("url"),
            "page": ii.get("descriptionurl"),
            "license": lic,
            "credit": re.sub("<[^>]+>", "", (meta.get("Artist") or {}).get("value", "")).strip(),
        })
        if len(out) >= limit:
            break
    return out

# ---------------------------------------------------------------- chunking
def chunk(text, size=900, overlap=150):
    text = re.sub(r"[ \t]+", " ", text)
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, buf = [], ""
    for p in paras:
        if len(buf) + len(p) + 1 <= size:
            buf = (buf + "\n" + p).strip()
        else:
            if buf: chunks.append(buf)
            buf = (buf[-overlap:] + "\n" + p).strip() if buf else p
            while len(buf) > size:
                chunks.append(buf[:size]); buf = buf[size - overlap:]
    if buf: chunks.append(buf)
    return chunks

# ---------------------------------------------------------------- gemini
def _retry(fn, tries=4):
    for i in range(tries):
        try:
            return fn()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 ** i)

def gemini_embed(text):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{EMBED_MODEL}:embedContent?key={GEMINI_KEY}"
    body = {"model": f"models/{EMBED_MODEL}", "content": {"parts": [{"text": text[:8000]}]}}
    return _retry(lambda: post_json(url, body, {})["embedding"]["values"])

def gemini_describe(image_bytes, mime, title):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{VISION_MODEL}:generateContent?key={GEMINI_KEY}"
    prompt = ("Describe this historical image for a search index in 2-4 sentences: "
              "subject, what it depicts, people/place, medium/style, and era. "
              f"Filename/title hint: {title}. Be factual; do not invent.")
    body = {"contents": [{"parts": [
        {"text": prompt},
        {"inline_data": {"mime_type": mime, "data": base64.b64encode(image_bytes).decode()}},
    ]}]}
    r = _retry(lambda: post_json(url, body, {}))
    return r["candidates"][0]["content"]["parts"][0]["text"].strip()

# ---------------------------------------------------------------- supabase
def supabase_insert(rows):
    url = f"{SB_URL}/rest/v1/rag_docs"
    post_json(url, rows, {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
                          "Prefer": "return=minimal"})

# ---------------------------------------------------------------- main
def gather():
    docs = []  # each: dict without embedding yet
    for s in TEXT_SOURCES:
        try:
            if s["kind"] == "gutenberg":
                body = fetch_gutenberg(s["url"]); srcs = [(s["title"], s.get("source_url", s["url"]), body)]
            elif s["kind"] == "wikisource":
                body = fetch_wikisource(s["lang"], s["page"])
                srcs = [(s["title"], f"https://{s['lang']}.wikisource.org/wiki/" + urllib.parse.quote(s["page"]), body)]
            elif s["kind"] == "wikipedia":
                srcs = []
                for t in s["titles"]:
                    body = fetch_wikipedia(s["lang"], t)
                    srcs.append((f"Wikipedia — {t}", f"https://{s['lang']}.wikipedia.org/wiki/" + urllib.parse.quote(t), body))
            else:
                continue
            for title, url, body in srcs:
                cs = chunk(body)
                for i, c in enumerate(cs):
                    docs.append({"voyage_slug": VOYAGE, "type": "text", "title": title,
                                 "content": c, "source_url": url, "license": s["license"],
                                 "credit": None, "media_url": None, "chunk_index": i})
                print(f"  text: {title} -> {len(cs)} chunks ({len(body)} chars)")
        except Exception as e:
            print(f"  !! text source failed ({s.get('title')}): {e}")

    for q in IMAGE_QUERIES:
        try:
            imgs = commons_images(q, IMAGES_PER_QUERY)
        except Exception as e:
            print(f"  !! image search failed ({q}): {e}")
            imgs = []
        print(f"  images '{q}': {len(imgs)} PD/CC hits")
        for im in imgs:
            if not im["img"]:
                continue
            try:
                desc = f"[DRY_RUN description placeholder] {im['title']}"
                if not DRY_RUN:
                    raw = _get(im["img"])
                    mime = "image/png" if im["img"].lower().endswith(".png") else "image/jpeg"
                    desc = gemini_describe(raw, mime, im["title"])
                docs.append({"voyage_slug": VOYAGE, "type": "image", "title": im["title"],
                             "content": desc, "source_url": im["page"], "license": im["license"],
                             "credit": im["credit"] or None, "media_url": im["img"], "chunk_index": None})
            except Exception as e:
                print(f"    !! skip image ({im['title'][:40]}): {e}")
    return docs


def main():
    print(f"DRY_RUN={DRY_RUN}  vision={VISION_MODEL}  embed={EMBED_MODEL}")
    docs = gather()
    n_text = sum(1 for d in docs if d["type"] == "text")
    n_img = sum(1 for d in docs if d["type"] == "image")
    print(f"\nGathered {len(docs)} docs  ({n_text} text chunks, {n_img} images)")
    if DRY_RUN:
        print("DRY_RUN: not embedding or writing. Review the counts above.")
        return
    if not (GEMINI_KEY and SB_URL and SB_KEY):
        raise SystemExit("Set GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY to run for real.")
    # Clear any previous rows for this voyage so re-runs stay clean (no duplicates).
    _read(urllib.request.Request(
        f"{SB_URL}/rest/v1/rag_docs?voyage_slug=eq.{VOYAGE}", method="DELETE",
        headers={"User-Agent": UA, "apikey": SB_KEY,
                 "Authorization": f"Bearer {SB_KEY}", "Prefer": "return=minimal"}), 60)
    print(f"cleared previous rows for {VOYAGE}")
    batch = []
    for i, d in enumerate(docs, 1):
        d["embedding"] = "[" + ",".join(f"{x:.6f}" for x in gemini_embed(d["content"])) + "]"
        batch.append(d)
        if len(batch) >= 40:
            supabase_insert(batch); print(f"  inserted {i}/{len(docs)}"); batch = []
        time.sleep(0.05)
    if batch:
        supabase_insert(batch); print(f"  inserted {len(docs)}/{len(docs)}")
    print("Done.")


if __name__ == "__main__":
    main()
