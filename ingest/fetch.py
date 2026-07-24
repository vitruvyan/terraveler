"""Public-domain / CC source fetchers + chunker. Stdlib only (urllib).

Adapted from the original Gemini ingestion script — same sources, same
verbatim-safe policy (only PD/CC; copyrighted secondary sites are never
ingested). Embedding + storage are handled downstream by the Axis nodes.
"""
import re
import json
import urllib.request
import urllib.parse
import urllib.error

UA = "terraveler-rag/2.0 (contact: dbaldoni@gmail.com)"


def _get(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def get_text(url):
    return _get(url).decode("utf-8", "replace")


def get_json(url):
    return json.loads(_get(url).decode("utf-8", "replace"))


def fetch_gutenberg(url):
    txt = get_text(url)
    a = re.search(r"\*\*\* START OF.*?\*\*\*", txt, re.S)
    b = re.search(r"\*\*\* END OF", txt)
    if a:
        txt = txt[a.end():]
    if b:
        txt = txt[:b.start()]
    return txt.strip()


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
            "desc": re.sub(r"<[^>]+>", " ", (meta.get("ImageDescription") or {}).get("value", "")).strip(),
        })
        if len(out) >= limit:
            break
    return out


def chunk(text, size=900, overlap=150):
    text = re.sub(r"[ \t]+", " ", text)
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, buf = [], ""
    for p in paras:
        if len(buf) + len(p) + 1 <= size:
            buf = (buf + "\n" + p).strip()
        else:
            if buf:
                chunks.append(buf)
            buf = (buf[-overlap:] + "\n" + p).strip() if buf else p
            while len(buf) > size:
                chunks.append(buf[:size])
                buf = buf[size - overlap:]
    if buf:
        chunks.append(buf)
    return chunks
