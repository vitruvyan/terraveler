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
    The contributor may DECLARE a licence in `evidence.license`; a declaration
    is a pointer to where to look, not a verdict. It is accepted only when the
    fetched page itself carries that licence's URL or name — the code confirms
    it, nobody's say-so does — and the record says it was established that way.
  - DEFAULT PROFILE ("quote-only"). Anything else — no licence found, one that
    cannot be classified, or an NC / ND clause (not compatible with publishing
    under CC BY-SA) → a brief attributed quotation, capped at QUOTE_WORD_CAP
    words, never ingested; the published citation says the rights were not
    verified.

A wrong "open" is the dangerous error (a long quotation from a copyrighted
text), so the structured signals are deliberately narrow: `<link rel=license>`,
`<meta>` rights tags, JSON-LD `license` — machine statements about THIS item.
A body-text "© … CC BY-SA" footer, which is usually about the site, is not one.

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

# (key, label, URL patterns that state it, name patterns that state it)
_OPEN = [
    ("pd", "Public domain",
     [r"creativecommons\.org/publicdomain/(?:mark|zero)/1\.0",
      r"rightsstatements\.org/vocab/NoC-(?:US|OKLR)/"],
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
    r"rightsstatements\.org/vocab/(?:InC|CNE|UND|NoC-CR|NoC-NC)",
]

# Free-text rights statements in a machine field (a <meta> rights tag, a JSON-LD
# `license` that is prose rather than a URL). Restrictive wording is checked
# first: a field that says both resolves to the cautious side.
_RESTRICTIVE_TEXT = [
    r"\bCC[ -]BY(?:[ -]SA)?[ -](?:NC|ND)\b", r"\bnon[- ]?commercial\b", r"\bno[- ]?derivativ",
    r"\ball rights reserved\b", r"\btous droits r[ée]serv[ée]s\b",
    r"\btodos los derechos reservados\b", r"\balle rechten voorbehouden\b",
    r"\bin copyright\b",
]

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
            except ValueError:
                continue
        return [u.strip() for u in self.urls if u and u.strip()]


def _jsonld_licences(node) -> list[str]:
    out: list[str] = []
    if isinstance(node, dict):
        for k, v in node.items():
            if k.lower() in ("license", "licence"):
                if isinstance(v, str):
                    out.append(v)
                elif isinstance(v, dict):
                    out.append(str(v.get("@id") or v.get("url") or ""))
                elif isinstance(v, list):
                    for x in v:
                        out.extend(_jsonld_licences({"license": x}))
            else:
                out.extend(_jsonld_licences(v))
    elif isinstance(node, list):
        for x in node:
            out.extend(_jsonld_licences(x))
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
    by_url = _classify_url(value)
    if by_url:
        return by_url
    if any(re.search(p, value, re.I) for p in _RESTRICTIVE_TEXT):
        return ("restricted", None, "an NC/ND or reserved-rights statement")
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
    except Exception:  # noqa: BLE001 — malformed HTML is unreadable, not fatal
        return None
    classified = [c for c in (_classify_signal(u) for u in parser.finish()) if c]
    if not classified:
        return None
    if any(kind == "restricted" for kind, _k, _l in classified):
        return {"profile": "quote-only", "licence": None,
                "basis": "the item's metadata carries an NC/ND or reserved-rights statement"}
    labels = sorted({label for _kind, _key, label in classified})
    return {"profile": "open", "licence": " / ".join(labels), "basis": "page-metadata"}


def _declared_key(declared: str) -> str | None:
    """Which OPEN licence a contributor's declaration names, or None. Anything
    that is not clearly one of the three — including every NC/ND variant and
    prose like 'free to use' — names nothing."""
    d = (declared or "").strip()
    if not d or re.search(r"\b(?:NC|ND)\b|non[- ]?commercial|no[- ]?deriv", d, re.I):
        return None
    if re.search(r"public[ -]domain|\bCC0\b|\bPDM\b|dominio p[uú]blico|domaine public", d, re.I):
        return "pd"
    if re.search(r"\bCC[ -]BY[ -]SA\b|by-sa", d, re.I):
        return "cc-by-sa"
    if re.search(r"\bCC[ -]BY\b|licenses/by/", d, re.I):
        return "cc-by"
    return None


def confirm_declared(html: str, declared: str) -> dict | None:
    """A declared open licence, accepted only if the fetched page carries that
    licence's own URL or name. The code confirms; the contributor does not."""
    key = _declared_key(declared)
    if not key or not html:
        return None
    for k, label, url_pats, name_pats in _OPEN:
        if k != key:
            continue
        if any(re.search(p, html, re.I) for p in url_pats + name_pats):
            return {"profile": "open", "licence": label, "basis": "declared by the contributor, matched on the page"}
    return None


def decide_rights(html: str | None, declared: str | None) -> dict:
    """The rights profile for an item whose licence is read per item.

    Order: the item's own metadata; then a declaration the page confirms; then
    the default profile. Always returns a profile — nothing here blocks."""
    reading = read_licence(html or "")
    if reading:
        return reading
    confirmed = confirm_declared(html or "", declared or "")
    if confirmed:
        return confirmed
    return {"profile": "quote-only", "licence": None,
            "basis": "licence not readable on the item — default profile (Carta §3.2)"}


def word_count(text: str) -> int:
    return len((text or "").split())


def over_cap(rights: dict, quote: str) -> bool:
    return rights.get("profile") == "quote-only" and word_count(quote) > QUOTE_WORD_CAP
