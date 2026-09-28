"""Reading a licence off an item, and what to do when there is none to read.

The source registry can say "this institution's items are checked one by one"
(`item_verified`), or hold an approval whose rights class nobody could state
(`domain_trusted`, rights `unknown`). Until this module the second was inert
and the first, without a strategy for that host, was refused — so an editor who
could not know a library's licences left it approved and blocked for good.

Magna Carta §3.2 already says what happens to material that is not openly
licensed: it "may be linked and briefly quoted with attribution — never
ingested". This module is that sentence made operable:

  - OPEN. The item's own metadata carries a licence we can classify as open
    (public domain, CC0, CC BY, CC BY-SA) → the quotation is unrestricted by
    length and the licence read is recorded.
    The contributor may DECLARE a licence in `evidence.license`; that is a hint
    at what to look for, never evidence. Nothing but the item's own machine
    statement makes a source "open": a declaration the page merely mentions
    somewhere (a footer, a comment, an echoed URL) proves nothing, so it does
    not count — the code reads, nobody's say-so decides.
  - DEFAULT PROFILE ("quote-only"). Anything else — no licence found, one that
    cannot be classified, or an NC / ND clause (not compatible with publishing
    under CC BY-SA) → a brief attributed quotation, capped at QUOTE_WORD_CAP
    words, never ingested; the published citation says the rights were not
    verified.

A wrong "open" is the dangerous error (a long quotation from a copyrighted
text), so the structured signals are deliberately narrow: `<link rel=license>`,
`<meta>` rights tags, JSON-LD `license` on a CreativeWork-type node — machine
statements about THIS item. A body-text "© … CC BY-SA" footer, or a licence on
the WebSite / Organization node, is usually about the site and is not one. Any
doubt — a "©", a negation, an NC/ND/reserved-rights wording in any language, a
statement that is about metadata — resolves to the default profile.

Nothing here decides ingestion: `whitelist.verify_source` stays the only gate
that says "may be ingested", and quote-only sources never pass it.
"""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path

# What "brief" means in Carta §3.2, for a source whose licence could not be
# read. Chosen by the editor (2026-09-28): about four or five lines. Lives in
# vocab/controlled.json so lib/gate.ts (Stage-0) and this module cannot disagree.
QUOTE_WORD_CAP = int(json.loads(
    (Path(__file__).resolve().parent.parent / "vocab" / "controlled.json").read_text(encoding="utf-8")
)["quote_only_word_cap"])
# The cap is per quotation; many brief quotations could rebuild a long text, so
# the same source URL may also contribute only this much per submission.
QUOTE_TOTAL_CAP = int(json.loads(
    (Path(__file__).resolve().parent.parent / "vocab" / "controlled.json").read_text(encoding="utf-8")
)["quote_only_total_cap"])

# (key, label, URL patterns that state it, name patterns that state it)
_OPEN = [
    ("pd", "Public domain",
     [r"creativecommons\.org/publicdomain/(?:mark|zero)/1\.0"],
     [r"\bpublic[ -]domain\b", r"\bdominio p[uú]blico\b", r"\bdomaine public\b",
      r"\bpubliek domein\b", r"\bdom[ií]nio p[uú]blico\b", r"\bCC0\b"]),
    ("cc-by", "CC BY",
     [r"creativecommons\.org/licenses/by/\d\.\d"],
     [r"\bCC[ -]BY(?![ -]?(?:SA|NC|ND))\b"]),
    ("cc-by-sa", "CC BY-SA",
     [r"creativecommons\.org/licenses/by-sa/\d\.\d"],
     [r"\bCC[ -]BY[ -]SA\b"]),
]

# A clause that makes a work incompatible with publishing under CC BY-SA.
_RESTRICTIVE_URLS = [
    r"creativecommons\.org/licenses/by(?:-sa)?-(?:nc|nd)(?:-(?:sa|nd))?/",
    r"creativecommons\.org/licenses/by-(?:nc|nd)",
    # NoC-US is public domain in the US ONLY and NoC-OKLR carries other legal
    # restrictions: neither is a statement this atlas can publish under.
    r"rightsstatements\.org/vocab/(?:InC|CNE|UND|NoC-CR|NoC-NC|NoC-US|NoC-OKLR)",
]

# Free-text rights statements in a machine field (a <meta> rights tag, a JSON-LD
# `license` that is prose rather than a URL). Restrictive wording is checked
# first: a field that says both resolves to the cautious side.
_RESTRICTIVE_TEXT = [
    r"\bCC[ -]BY(?:[ -]SA)?[ -](?:NC|ND)\b", r"\bnon[- ]?commercial\b", r"\bno[- ]?derivativ",
    r"©", r"\(c\)", r"\bcopyright", r"\bcopr\b",
    # "all rights reserved" in the languages of the approved hosts and their neighbours.
    r"\b(?:all\s+)?rights?\s+reserved\b",
    r"\b(?:tous\s+)?droits?\s+r[ée]serv[ée]s?\b", r"\b(?:todos\s+)?(?:los\s+)?derechos?\s+reservad",
    r"\b(?:todos\s+os\s+)?direitos?\s+reservad", r"\b(?:tutti\s+i\s+)?diritti\s+riservati\b",
    r"\balle\s+rechte?\s+vorbehalten\b", r"\balle\s+rechten\s+voorbehouden\b", r"\bvoorbehouden\b",
    r"\bin\s+copyright\b", r"\breservad[oa]s?\b",
    # About the catalogue record, not the work.
    r"\bmeta-?data\b", r"\bmetadat", r"\bcatalog", r"\bcatálog", r"\bdatabase\b", r"\bbase de datos\b",
]
# A negated statement ("not in the public domain", "no es de dominio público")
# is the opposite of the statement it contains.
_NEGATION = re.compile(
    r"\b(?:not|no|non|nicht|kein\w*|niet|pas|não|nao|nunca|never)\b[\W\w]{0,30}?"
    r"(?:public[ -]domain|dominio p[uú]blico|domaine public|publiek domein|dom[ií]nio p[uú]blico|\bCC0\b|\bCC[ -]BY)",
    re.I)
_DASHES = re.compile("[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]")
# A machine rights field is a short statement. A paragraph is prose.
_MAX_SIGNAL_LEN = 200

_RIGHTS_META = re.compile(r"^(?:dc|dcterms|dct)\.(?:rights|license)$|^(?:license|rights|copyright)$|^(?:og:)?license$", re.I)
_URL = re.compile(r"https?://[^\s\"'<>)]+", re.I)


class _Signals(HTMLParser):
    """Machine statements about the item: <link rel=license>, rights <meta>,
    JSON-LD `license`. Body anchors and prose are ignored on purpose."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.urls: list[str] = []
        self._in_jsonld = False
        self._jsonld: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "link":
            rel = a.get("rel", "").lower().replace("dcterms:", "").replace("cc:", "").split()
            if "license" in rel or "licence" in rel:
                self.urls.append(a.get("href", ""))
        elif tag == "meta":
            name = a.get("name") or a.get("property") or ""
            if _RIGHTS_META.match(name.strip()):
                self.urls.append(a.get("content", ""))
        elif tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self._in_jsonld = True
            self._jsonld.append("")

    def handle_endtag(self, tag):
        if tag == "script":
            self._in_jsonld = False

    def handle_data(self, data):
        if self._in_jsonld and self._jsonld:
            self._jsonld[-1] += data

    def finish(self) -> list[str]:
        for blob in self._jsonld:
            try:
                self.urls.extend(_jsonld_licences(json.loads(blob)))
            except (ValueError, RecursionError):
                continue
        return [u.strip() for u in self.urls if u and u.strip()]


# A JSON-LD `license` is a statement about the item only when it sits on a node
# that IS a creative work. On a WebSite / Organization / WebPage node it is the
# site's own licence (often CC0 for the catalogue data), which says nothing
# about the text being quoted.
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


def _jsonld_licences(node, _depth: int = 0) -> list[str]:
    out: list[str] = []
    if _depth > 20:
        return out
    if isinstance(node, dict):
        for k, v in node.items():
            if k.lower() in ("license", "licence"):
                if not _is_work(node):
                    continue
                if isinstance(v, str):
                    out.append(v)
                elif isinstance(v, dict):
                    out.append(str(v.get("@id") or v.get("url") or ""))
                elif isinstance(v, list):
                    for x in v:
                        out.extend(_jsonld_licences({"@type": node.get("@type"), "license": x}, _depth + 1))
            else:
                out.extend(_jsonld_licences(v, _depth + 1))
    elif isinstance(node, list):
        for x in node:
            out.extend(_jsonld_licences(x, _depth + 1))
    return out


def _classify_url(url: str):
    """('open', key, label) | ('restricted', None, label) | None"""
    for pat in _RESTRICTIVE_URLS:
        if re.search(pat, url, re.I):
            return ("restricted", None, "an NC/ND or reserved-rights statement")
    for key, label, url_pats, _names in _OPEN:
        if any(re.search(p, url, re.I) for p in url_pats):
            return ("open", key, label)
    return None


def _classify_signal(value: str):
    """A machine field's value: a licence URL, or a rights statement in words."""
    value = _DASHES.sub("-", value)
    by_url = _classify_url(value)
    if by_url:
        return by_url
    if _NEGATION.search(value) or any(re.search(p, value, re.I) for p in _RESTRICTIVE_TEXT):
        return ("restricted", None, "an NC/ND or reserved-rights statement")
    if len(value) > _MAX_SIGNAL_LEN:
        return None
    for key, label, _urls, name_pats in _OPEN:
        if any(re.search(p, value, re.I) for p in name_pats):
            return ("open", key, label)
    return None


def read_licence(html: str) -> dict | None:
    """The item's own machine-readable licence statement, classified.

    {"profile": "open", "licence": "CC BY-SA", "basis": "page-metadata"} when
    every recognisable statement is open; {"profile": "quote-only", ...} when
    any is restrictive (conflicting signals resolve to the cautious side);
    None when there is nothing to classify."""
    if not html:
        return None
    parser = _Signals()
    try:
        parser.feed(html)
        parser.close()
        signals = parser.finish()
    except Exception:  # noqa: BLE001 — a hostile or malformed page is unreadable, not fatal
        return None
    classified = [c for c in (_classify_signal(u) for u in signals) if c]
    if not classified:
        return None
    if any(kind == "restricted" for kind, _k, _l in classified):
        return {"profile": "quote-only", "licence": None,
                "basis": "the item's metadata carries an NC/ND or reserved-rights statement"}
    labels = sorted({label for _kind, _key, label in classified})
    return {"profile": "open", "licence": " / ".join(labels), "basis": "page-metadata"}


def decide_rights(html: str | None) -> dict:
    """The rights profile for an item whose licence is read per item.

    Only the item's own machine-readable statement can make it "open"; a
    contributor's declaration is deliberately not an input. Otherwise the
    default profile applies. Always returns a profile — nothing here blocks."""
    reading = read_licence(html or "")
    if reading:
        return reading
    return {"profile": "quote-only", "licence": None,
            "basis": "licence not readable on the item — default profile (Carta §3.2)"}


# Scripts written without spaces (Chinese, Japanese, Thai…) have no word
# boundary to count, so each of their characters counts as a word. The same
# ranges are in lib/gate.ts::quoteWords — keep them identical.
_UNSPACED = re.compile(
    "[\u0e00-\u0eff\u1000-\u109f\u1780-\u17ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
    "\uff66-\uff9f\U00020000-\U0002fa1f]")


def word_count(text: str) -> int:
    return len(_UNSPACED.sub(" x ", text or "").split())


def over_cap(rights: dict, quote: str) -> bool:
    return rights.get("profile") == "quote-only" and word_count(quote) > QUOTE_WORD_CAP
