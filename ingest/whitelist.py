"""The trusted-source whitelist — the guardrail that keeps auto-ingestion inside
the Magna Carta guarantee (PD/CC only). Anything off this list is refused and
recorded as a Rejection in the Axis trace. This is NOT an open-web spider.
"""
from urllib.parse import urlparse

# domain → licence guarantee for the whole domain
ALLOWED_DOMAINS = {
    "gutenberg.org": "Public domain",
    "www.gutenberg.org": "Public domain",
    "gutendex.com": "Public domain",              # index over Gutenberg
    "en.wikipedia.org": "CC BY-SA 4.0",
    "fr.wikipedia.org": "CC BY-SA 4.0",
    "es.wikipedia.org": "CC BY-SA 4.0",
    "en.wikisource.org": "Public domain",
    "fr.wikisource.org": "Public domain",
    "commons.wikimedia.org": "per-file (PD/CC, verified)",
    "upload.wikimedia.org": "per-file (PD/CC, verified)",
    # planned: "gallica.bnf.fr", "archive.org", "www.biodiversitylibrary.org"
}


def domain_of(url: str) -> str:
    return (urlparse(url).netloc or "").lower()


def is_allowed(url: str) -> bool:
    return domain_of(url) in ALLOWED_DOMAINS


def license_for(url: str):
    return ALLOWED_DOMAINS.get(domain_of(url))
