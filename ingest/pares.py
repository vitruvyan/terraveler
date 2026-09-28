"""PARES — Portal de Archivos Españoles (Ministerio de Cultura).

What it gives Terraveler, honestly: ARCHIVAL DESCRIPTIONS. A record page
carries the title, the signatura, the date, the reference code and — the part
worth quoting — "Alcance y Contenido", the archivist's own statement of what a
document contains, in Spanish. It does not carry the document's text: those are
images. So a citation from PARES is a citation of the finding aid — archive,
signatura, date, and the description's own words — never a transcription of the
document itself.

The reuse terms PARES prints on every record: descriptive information and
public-domain images "pueden reproducirse y utilizarse sin permiso previo" with
credit to the Ministerio de Cultura and a citation of the source (archive,
signatura, PARES URL); image dissemination of documents that are not public
domain needs authorisation. The editor approved the source item_verified,
rights `mixed`: rights are established per record, which is what
`verify_pares_item` does — and only for the DESCRIPTION.

The shape of a citable URL, the record's boundaries and its required fields
live in vocab/pares.json, shared with lib/sourceSearch.ts.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

sys.path.append(str(Path(__file__).resolve().parent))
from html_text import visible_text  # noqa: E402
import tls  # noqa: E402

_SHAPE = json.loads((Path(__file__).resolve().parent.parent / "vocab" / "pares.json").read_text(encoding="utf-8"))
HOST = _SHAPE["host"]
_PATH_RE = re.compile(_SHAPE["description_path_pattern"])
UA = "terraveler-rag/2.0 (contact: dbaldoni@gmail.com)"
MAX_BYTES = 2 * 1024 * 1024

LICENCE = ("PARES descriptive record (Ministerio de Cultura) — reproducible with "
           "attribution to the archive, signatura and PARES URL; the record's "
           "description only, not the document's images")


def is_description_url(url: str) -> bool:
    """True only for https://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/<id>."""
    try:
        p = urlparse(url)
    except ValueError:
        return False
    return (p.scheme == "https" and p.hostname == HOST and p.port in (None, 443)
            and not p.username and not p.password and bool(_PATH_RE.match(p.path or "")))


def fetch_record_html(url: str, timeout: int = 60) -> str:
    """The record page, over a verified connection that also trusts PARES's
    missing intermediate (see tls.py). Redirects are refused: a record URL that
    moves is a URL this gate has not looked at."""
    if not is_description_url(url):
        raise ValueError(f"not a PARES record URL: {url!r}")

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    ctx = tls.context_for(url)
    opener = urllib.request.build_opener(
        _NoRedirect, urllib.request.HTTPSHandler(context=ctx) if ctx else urllib.request.HTTPSHandler())
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with opener.open(req, timeout=timeout) as r:
        raw = r.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("PARES record larger than 2MB")
    return raw.decode("utf-8", "replace")


def record_text(html: str) -> str:
    """The record itself, without the site's navigation and footer: from
    "Identificación" to the ministry's copyright line."""
    text = visible_text(html)
    start = text.find(_SHAPE["record_start_marker"])
    end = text.find(_SHAPE["record_end_marker"], start if start >= 0 else 0)
    body = text[start:end] if start >= 0 and end > start else text
    return re.sub(r"\n{3,}", "\n\n", body).strip()


def verify_pares_item(url: str, fetch_json=None, fetch_html=None) -> tuple[bool, str]:
    """Is this URL one specific, genuine PARES description whose own page states
    the reuse terms? `fetch_json` is accepted and ignored (the strategy
    signature is shared with archive.org's); `fetch_html` is the seam tests use."""
    if not is_description_url(url):
        return False, (f"not a PARES record URL (https://{HOST}/ParesBusquedas20/catalogo/description/<id>): "
                       f"{url!r}")
    try:
        html = (fetch_html or fetch_record_html)(url)
    except Exception as exc:  # noqa: BLE001 — the reason goes to the trace
        return False, f"PARES record unreachable: {type(exc).__name__}: {str(exc)[:120]}"
    text = visible_text(html)
    missing = [m for m in _SHAPE["required_field_markers"] if m not in text]
    if missing:
        return False, f"page is not a PARES description (missing {', '.join(missing)})"
    if _SHAPE["reuse_statement_marker"] not in text:
        return False, "the record does not state PARES's reuse terms — cannot admit it"
    return True, LICENCE
