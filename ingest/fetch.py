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

from html_text import visible_text as _visible_text

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


def _wikisource_render_to_text(raw_html: str) -> str:
    """Turn Wikisource's rendered page HTML (from `action=parse&prop=text`,
    which resolves the `<pages index=... />` transclusions that
    `prop=extracts` never follows) into clean narrative text.

    The cleaning itself now lives in `html_text.visible_text` — shared with
    `verbatim.py::source_text`, which needs the same "strip markup down to
    what a reader would see" reduction for a different reason (checking a
    quotation against an HTML source safely, not just making one readable).
    Was a private, module-local regex pipeline until that second use case
    needed the exact same machine, hardened further; see `html_text.py`'s
    module docstring for what changed and why. Zero-width spaces (U+200B,
    MediaWiki's invisible page-boundary markers) and entity decoding are
    handled inside `visible_text` now too.
    """
    return _visible_text(raw_html)


def fetch_mediawiki_extract(host, title):
    """Plain-text extract, generalized over HOST rather than hardcoded to
    wikipedia.org — but Wikipedia and Wikisource are NOT the same shape of
    problem, so they no longer share one API call under the hood.

    Wikipedia articles are self-contained prose and `prop=extracts` (a
    plain-text rendering MediaWiki computes for us) works well there.
    Wikisource "work" pages, though, are composed via transclusion: a
    `{{header}}` template followed by `<pages index="....djvu"
    include=N-M />` tags that pull the real text from the `Page:`
    namespace at render time. `prop=extracts` does not follow that
    transclusion and silently returns an empty (or near-empty,
    header-only) extract — no error, just missing text. So Wikisource
    hosts go through `action=parse&prop=text` instead, which renders the
    page the way a reader sees it (transclusions resolved), and the
    result is reduced to text by `_wikisource_render_to_text`.

    Both branches are still reached through this one function (and
    `fetch_wikipedia`/`fetch_wikisource` below still just pick the host)
    because the dispatch — not the fetch mechanics — is what callers
    depend on."""
    if host.endswith(".wikisource.org"):
        api = f"https://{host}/w/api.php?" + urllib.parse.urlencode({
            "action": "parse", "prop": "text", "page": title,
            "redirects": 1, "format": "json"})
        parse = get_json(api).get("parse") or {}
        raw_html = (parse.get("text") or {}).get("*") or ""
        return _wikisource_render_to_text(raw_html)

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
