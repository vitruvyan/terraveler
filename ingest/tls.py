"""TLS for the few hosts whose servers send an incomplete certificate chain.

The Ministerio de Cultura's PARES portal serves only its leaf certificate and
omits the FNMT intermediate that issued it, so a strict client — every client
this project runs — refuses it: "unable to verify the first certificate".
The remedy is NOT to turn verification off. vocab/tls_intermediates.json holds
the missing intermediate, and `context_for(url)` returns a context that trusts
it IN ADDITION to the system roots, for that host only. A certificate listed
there can complete a chain that ends at a root the system already trusts; it
cannot make an unknown root trusted, and a host not listed there gets the
default context, unchanged.

Shared with lib/tlsFetch.ts through the same JSON file.
"""
from __future__ import annotations

import json
import ssl
from pathlib import Path
from urllib.parse import urlparse

_VOCAB = Path(__file__).resolve().parent.parent / "vocab" / "tls_intermediates.json"


def _hosts() -> dict:
    try:
        return json.loads(_VOCAB.read_text(encoding="utf-8")).get("hosts", {})
    except (OSError, ValueError):
        return {}


def extra_pem_for(host: str) -> str | None:
    entry = _hosts().get((host or "").lower().rstrip("."))
    return entry.get("pem") if entry else None


def context_for(url: str) -> ssl.SSLContext | None:
    """A verifying SSL context that also trusts this host's listed
    intermediate, or None (= the default, unchanged) for any other host."""
    pem = extra_pem_for(urlparse(url).hostname or "")
    if not pem:
        return None
    ctx = ssl.create_default_context()
    ctx.load_verify_locations(cadata=pem)
    return ctx
