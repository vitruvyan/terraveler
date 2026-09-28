"""Reading a licence off an item, and what to do when there is none to read.

The source registry can say "this institution's items are checked one by one"
(`item_verified`), or hold an approval whose rights class nobody could state
(`domain_trusted`, rights `unknown`). Until this module the second was inert
and the first, without a strategy for that host, was refused — so an editor who
could not know a library's licences left it approved and blocked for good.

Magna Carta §3.2 already says what happens to material that is not openly
licensed: it "may be linked and briefly quoted with attribution — never
ingested". This module is that sentence made operable:

  - OPEN. The item's own machine-readable statement carries a licence we can
    classify as open (public domain, CC0, CC BY, CC BY-SA) → the quotation is
    unrestricted by length and the licence read is recorded.
  - DEFAULT PROFILE ("quote-only"). Anything else — no licence found, one that
    cannot be classified, or an NC / ND clause (not compatible with publishing
    under CC BY-SA) → a brief attributed quotation, capped at QUOTE_WORD_CAP
    words, never ingested; the published citation says the rights were not
    verified.

The contributor may DECLARE a licence in `evidence.license`; that is a hint for
whoever reads the draft, never evidence. Nothing but the item's own machine
statement makes a source "open": a declaration the page merely mentions
somewhere (a footer, a comment, an echoed URL) proves nothing, so it plays no
part here at all — the code reads, nobody's say-so decides.

A wrong "open" is the dangerous error (a long quotation from a copyrighted
text), so what may open anything is deliberately narrow, and everything else
resolves to the default profile:

  - only signals that are ABOUT THIS ITEM can open: Dublin Core rights/licence
    `<meta>` tags, and JSON-LD `license` on a CreativeWork-type node that IS the
    page's item (its url/@id is the fetched URL, or it is the page's
    mainEntity). A `<link rel=license>` or a generic `<meta name=license>` is
    the site template's (CMS plugins emit it on every page) — it can veto, never
    open;
  - a text value opens only if the WHOLE value is one of a few closed phrases
    ("Public domain", "CC0 1.0", "CC BY 4.0", "CC BY-SA 4.0" and translations of
    "public domain"). Anything longer, qualified, negated or in another wording
    is not read as open — a deny-list of negations always misses one;
  - any signal that is present but not a plain open licence — an NC/ND clause,
    a reserved-rights or "©" wording, an unknown URL, prose — is a veto.

Nothing here decides ingestion: `whitelist.verify_source` stays the only gate
that says "may be ingested", and quote-only sources never pass it.
"""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

_VOCAB = json.loads(
    (Path(__file__).resolve().parent.parent / "vocab" / "controlled.json").read_text(encoding="utf-8"))

# What "brief" means in Carta §3.2, for a source whose licence could not be
# read. Chosen by the editor (2026-09-28): about four or five lines. Lives in
# vocab/controlled.json so lib/gate.ts (Stage-0) and this module cannot disagree.
QUOTE_WORD_CAP = int(_VOCAB["quote_only_word_cap"])
# The cap is per quotation; many brief quotations could rebuild a long text, so
# one source may also contribute only this much per submission.
QUOTE_TOTAL_CAP = int(_VOCAB["quote_only_total_cap"])

# Open licences: (key, label, URL patterns that state it)
_OPEN_URLS = [
    ("pd", "Public domain", [r"creativecommons\.org/publicdomain/(?:mark|zero)/1\.0"]),
    ("cc-by", "CC BY", [r"creativecommons\.org/licenses/by/\d\.\d"]),
    ("cc-by-sa", "CC BY-SA", [r"creativecommons\.org/licenses/by-sa/\d\.\d"]),
]

# The only text values that open anything: the WHOLE (trimmed, case-folded,
# dash-normalised, trailing-punctuation-stripped) value must be one of these.
_OPEN_TEXT = [
    ("pd", "Public domain",
     re.compile(r"^(?:public[ -]domain(?: mark)?(?: 1\.0)?|cc0(?: 1\.0)?(?: universal)?|"
                r"dominio p[uú]blico|domaine public|publiek domein|dom[ií]nio p[uú]blico)$")),
    ("cc-by", "CC BY", re.compile(r"^cc[ -]by(?: \d\.\d)?$")),
    ("cc-by-sa", "CC BY-SA", re.compile(r"^cc[ -]by[ -]sa(?: \d\.\d)?$")),
]

_DASHES = re.compile("[‐-―−﹘﹣－]")
# A machine rights field is a short statement; a longer value is prose. Checked
# BEFORE any pattern runs, so a hostile megabyte-long value costs nothing.
_MAX_SIGNAL_LEN = 200

# Dublin Core (and the schema.org-adjacent dcterms) rights/licence tags are
# item-scoped by convention: a repository emits them for the record it serves.
_ITEM_META = re.compile(r"^(?:dc|dcterms|dct)\.(?:rights|license|licence)$", re.I)
# Everything else that names a licence is a statement about the page's
# template as often as about the item.
_PAGE_META = re.compile(r"^(?:license|licence|rights|copyright|(?:og:)?license)$", re.I)

_MAX_JSONLD_BLOBS = 20


def _norm_url(u: str) -> str:
    """A URL as a comparison key: host lower-cased, scheme, fragment and
    trailing slash ignored."""
    try:
        p = urlsplit((u or "").strip())
    except ValueError:
        return ""
    return f"{(p.hostname or '').lower()}{p.path.rstrip('/')}?{p.query}"


class _Signals(HTMLParser):
    """Machine statements about the licence, tagged with their scope:
    ("item", value) can open; ("page", value) can only veto."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.found: list[tuple[str, str]] = []
        self._in_jsonld = False
        self._jsonld: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "link":
            rel = a.get("rel", "").lower().replace("dcterms:", "").replace("cc:", "").split()
            if "license" in rel or "licence" in rel:
                self.found.append(("page", a.get("href", "")))
        elif tag == "meta":
            name = (a.get("name") or a.get("property") or "").strip()
            if _ITEM_META.match(name):
                self.found.append(("item", a.get("content", "")))
            elif _PAGE_META.match(name):
                self.found.append(("page", a.get("content", "")))
        elif tag == "script" and a.get("type", "").lower() == "application/ld+json":
            if len(self._jsonld) < _MAX_JSONLD_BLOBS:
                self._in_jsonld = True
                self._jsonld.append("")

    def handle_endtag(self, tag):
        if tag == "script":
            self._in_jsonld = False

    def handle_data(self, data):
        if self._in_jsonld and self._jsonld:
            self._jsonld[-1] += data

    def finish(self, page_url: str | None) -> list[tuple[str, str]]:
        for blob in self._jsonld:
            try:
                self.found.extend(_jsonld_licences(json.loads(blob), page_url))
            except (ValueError, RecursionError):
                continue
        return [(scope, v.strip()) for scope, v in self.found if v and v.strip()]


# A JSON-LD `license` is a statement about the item only when it sits on a node
# that IS a creative work AND is the page's own item. On a WebSite /
# Organization / WebPage node it is the site's licence (often CC0 for the
# catalogue data); on a work node that is one of many on a list page, or a
# generic site-level CreativeWork, it is somebody else's.
_WORK_TYPES = {
    "creativework", "book", "article", "manuscript", "photograph", "imageobject", "map", "periodical",
    "thesis", "painting", "chapter", "digitaldocument", "archivecomponent", "report", "legislation",
    "visualartwork", "newspaper", "publicationissue", "publicationvolume", "scholarlyarticle",
    "newsarticle", "sculpture", "drawing", "collection", "musiccomposition", "audioobject", "videoobject",
}


def _is_work(node: dict) -> bool:
    t = node.get("@type")
    types = t if isinstance(t, list) else [t]
    return any(isinstance(x, str) and x.rsplit("/", 1)[-1].rsplit(":", 1)[-1].lower() in _WORK_TYPES for x in types)


def _is_this_page(node: dict, page_url: str | None) -> bool:
    if not page_url:
        return False
    want = _norm_url(page_url)
    return any(isinstance(node.get(k), str) and _norm_url(node[k]) == want for k in ("url", "@id"))


def _license_values(v) -> list[str]:
    if isinstance(v, str):
        return [v]
    if isinstance(v, dict):
        return [str(v.get("@id") or v.get("url") or "")]
    if isinstance(v, list):
        return [x for item in v for x in _license_values(item)]
    return []


def _jsonld_licences(node, page_url: str | None, _in_main: bool = False, _depth: int = 0) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    if _depth > 20:
        return out
    if isinstance(node, dict):
        for k, v in node.items():
            if k.lower() in ("license", "licence"):
                if _is_work(node):
                    scope = "item" if (_in_main or _is_this_page(node, page_url)) else "page"
                    out.extend((scope, x) for x in _license_values(v))
                else:
                    out.extend(("page", x) for x in _license_values(v))
            else:
                out.extend(_jsonld_licences(v, page_url, _in_main or k in ("mainEntity", "mainEntityOfPage"),
                                            _depth + 1))
    elif isinstance(node, list):
        for x in node:
            out.extend(_jsonld_licences(x, page_url, _in_main, _depth + 1))
    return out


def _classify(value: str):
    """('open', key, label) | ('veto', None, why). Never None: a signal that is
    present and is not a plain open licence is a veto, not silence."""
    if len(value) > _MAX_SIGNAL_LEN:
        return ("veto", None, "a rights statement too long to be a licence")
    value = _DASHES.sub("-", value)
    if re.match(r"https?://", value, re.I):
        for key, label, pats in _OPEN_URLS:
            if any(re.search(p, value, re.I) for p in pats):
                return ("open", key, label)
        return ("veto", None, "a licence URL that is not an open licence (NC/ND, reserved rights, or unknown)")
    text = value.strip().casefold().rstrip(".;, ")
    for key, label, pat in _OPEN_TEXT:
        if pat.match(text):
            return ("open", key, label)
    return ("veto", None, "a rights statement that is not a plain open licence")


def read_licence(html: str, page_url: str | None = None) -> dict | None:
    """The item's own machine-readable licence statement, classified.

    {"profile": "open", "licence": "CC BY-SA", "basis": "page-metadata"} only
    when at least one item-scoped signal is a plain open licence AND no signal
    of any scope vetoes it; {"profile": "quote-only", ...} when any signal is a
    veto; None when there is nothing to classify (or only page-level open
    statements, which prove nothing about the item)."""
    if not html:
        return None
    parser = _Signals()
    try:
        parser.feed(html)
        parser.close()
        signals = parser.finish(page_url)
    except Exception:  # noqa: BLE001 — a hostile or malformed page is unreadable, not fatal
        return None
    classified = [(scope, *_classify(v)) for scope, v in signals]
    if any(kind == "veto" for _s, kind, _k, _l in classified):
        return {"profile": "quote-only", "licence": None,
                "basis": "the item's metadata carries a rights statement that is not a plain open licence"}
    opens = sorted({label for scope, kind, _k, label in classified if scope == "item" and kind == "open"})
    if not opens:
        return None
    return {"profile": "open", "licence": " / ".join(opens), "basis": "page-metadata"}


def decide_rights(html: str | None, page_url: str | None = None) -> dict:
    """The rights profile for an item whose licence is read per item.

    Only the item's own machine-readable statement can make it "open"; a
    contributor's declaration is deliberately not an input. Otherwise the
    default profile applies. Always returns a profile — nothing here blocks."""
    reading = read_licence(html or "", page_url)
    if reading:
        return reading
    return {"profile": "quote-only", "licence": None,
            "basis": "licence not readable on the item — default profile (Carta §3.2)"}


# Scripts written without spaces (Chinese, Japanese, Thai, Tibetan, Yi…) have no
# word boundary to count, so each of their characters counts as a word. The same
# ranges and the same whitespace set are in lib/gate.ts::quoteWords — keep them
# identical (test/quote-only-licence.test.ts checks the two agree).
_UNSPACED = re.compile(
    "[฀-໿ༀ-࿿က-႟ក-៿぀-ヿ㐀-䶿一-鿿"
    "ꀀ-꓏豈-﫿ｦ-ﾟ\U00020000-\U000323af]")
_SPACE = re.compile("[ \t\n\r\f\v  -     　]+")


def word_count(text: str) -> int:
    return len([w for w in _SPACE.split(_UNSPACED.sub(" x ", text or "")) if w])


def over_cap(rights: dict, quote: str) -> bool:
    return rights.get("profile") == "quote-only" and word_count(quote) > QUOTE_WORD_CAP
