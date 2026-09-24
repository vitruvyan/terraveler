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
    # Both offsets index the ORIGINAL text, so the tail must be cut before the
    # head — or, as it did until codex's quality gate caught it, b.start() gets
    # applied to a string already shortened by a.end() and lets exactly
    # a.end() characters of Project Gutenberg licence ride into the corpus,
    # labelled as the traveller's own words and "Public domain".
    if b:
        txt = txt[:b.start()]
    if a:
        txt = txt[a.end():]
    return txt.strip()


def fetch_archive_text(url):
    """An archive.org OCR text (…_djvu.txt). No Gutenberg-style markers to
    strip; the scan carries the library's own front matter, which the
    narrative_chunk_range in VOYAGE_META is there to skip.

    Licence is NOT established here — whitelist.verify_source() must have
    cleared the item first, because archive.org serves lending-restricted
    books from URLs of exactly this shape."""
    return get_text(url).strip()


def fetch_mediawiki_extract(host, title):
    """Plain-text extract via MediaWiki's `prop=extracts`, generalized over
    HOST rather than hardcoded to wikipedia.org — Wikipedia and Wikisource
    are the same API and the same response shape, so one function serves
    both instead of `fetch_wikipedia` quietly assuming every MediaWiki
    candidate is a Wikipedia one."""
    api = f"https://{host}/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "prop": "extracts", "explaintext": 1,
        "titles": title, "redirects": 1, "format": "json"})
    pages = get_json(api)["query"]["pages"]
    return " ".join((p.get("extract") or "") for p in pages.values()).strip()


def fetch_wikipedia(lang, title):
    return fetch_mediawiki_extract(f"{lang}.wikipedia.org", title)


def fetch_wikisource(lang, title):
    return fetch_mediawiki_extract(f"{lang}.wikisource.org", title)


def fetch_by_kind(candidate: dict) -> str:
    """The single dispatch every caller must use to turn a discovered/curated
    candidate into its body text.

    Replaces a bug that shipped twice, identically, in
    `pipeline_native.py::fetch_node` and `scout.py`:

        body = (fetch_gutenberg(c["url"]) if c["kind"] == "gutenberg"
                else fetch_wikipedia(c["lang"], c["title"]))

    Any candidate whose kind was not literally "gutenberg" fell into that
    `else` and was fetched FROM WIKIPEDIA regardless of what it actually was
    — a "wikisource" candidate downloaded Wikipedia's page of the same title
    (or nothing, if none existed) and got stored under Wikisource's
    provenance and licence anyway. Invisible to the trace: the fetch
    "succeeded", just against the wrong source. An unrecognized kind here
    raises instead of silently defaulting to Wikipedia — the whole point of
    replacing this dispatch."""
    kind = candidate.get("kind")
    if kind == "gutenberg":
        return fetch_gutenberg(candidate["url"])
    if kind == "wikipedia":
        return fetch_wikipedia(candidate["lang"], candidate["title"])
    if kind == "wikisource":
        return fetch_wikisource(candidate["lang"], candidate["title"])
    if kind == "archive":
        return fetch_archive_text(candidate["url"])
    raise ValueError(f"fetch_by_kind: no fetcher registered for kind={kind!r} "
                      f"(candidate: {candidate.get('title', '?')!r})")


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
