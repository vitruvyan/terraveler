"""Read-only canonical corpus port; no discovery, fetch or licence inference.

Only voyages explicitly named in the dossier's approved submission snapshots
are eligible. Every stored text fragment needs both a recorded PD/CC label and
an effective domain-trusted governance approval at retrieval time.
"""
from __future__ import annotations

import json
import re
from urllib.parse import urlsplit

from orchestration.editorial_handlers import EvidenceError

# Leave room for research, draft, review and immutable context in Limen's 64KiB
# request cap. This is deliberately below the 40KiB source material ceiling.
SOURCE_BYTES = 12000


def _scopes(task):
    snapshots = task.get("sources")
    if not isinstance(snapshots, list):
        raise EvidenceError("editorial-voyage-scope-required")
    scopes = set()
    for snapshot in snapshots:
        if not isinstance(snapshot, dict):
            continue
        slug = snapshot.get("target_voyage")
        if isinstance(slug, str) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,119}", slug):
            scopes.add(slug)
    if not scopes or len(scopes) > 20:
        raise EvidenceError("editorial-voyage-scope-required")
    return sorted(scopes)


def _read_rows(scopes):
    import psycopg2
    from psycopg2.extras import RealDictCursor
    # libpq PG* values, matching the worker. No fallback password or network
    # endpoint and no text from user-input used as an SQL identifier.
    conn = psycopg2.connect(connect_timeout=5,
                           options="-c statement_timeout=5000 -c lock_timeout=3000",
                           cursor_factory=RealDictCursor)
    try:
        with conn, conn.cursor() as cursor:
            cursor.execute(
                "select id,voyage_slug,title,left(content,2500) as content,source_url,license "
                "from public.rag_docs where type='text' and voyage_slug=any(%s) "
                "and trim(license) ~* '^(Public domain|CC0( 1[.]0)?|CC BY(-SA)?( [1-4][.]0)?)$' "
                "order by id limit 40", (scopes,))
            return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def _resolve(url):
    # Existing resolver consults only stored governance decisions, never the
    # web. Unknown, quarantined, revoked and item-verification sources close.
    from ingest.source_governance_shadow import resolve_trust_from_db
    return resolve_trust_from_db(url)


def _label(value):
    if not isinstance(value, str):
        return False
    return bool(re.fullmatch(r"(?:Public domain|CC0(?: 1\.0)?|CC BY(?:-SA)?(?: [1-4]\.0)?)", value.strip(), re.I))


def retrieve_sources(task, *, read_rows=None, resolve=None):
    scopes = _scopes(task)
    rows = (read_rows or _read_rows)(scopes)
    resolver = resolve or _resolve
    references, used, seen = [], 2, set()
    for row in rows:
        if (not isinstance(row, dict) or row.get("voyage_slug") not in scopes
                or type(row.get("id")) is not int or row["id"] < 1 or row["id"] in seen
                or not _label(row.get("license"))):
            continue
        text, title, url = row.get("content"), row.get("title"), row.get("source_url")
        if not all(isinstance(v, str) and v.strip() for v in (text, title, url)):
            continue
        parsed = urlsplit(url)
        if (parsed.scheme not in ("http", "https") or not parsed.hostname
                or parsed.username or parsed.password or parsed.query or parsed.fragment):
            continue
        policy = resolver(url)
        if (not isinstance(policy, dict) or policy.get("matched") is not True
                or policy.get("decision") != "allow" or policy.get("trust_mode") != "domain_trusted"
                or policy.get("rights_class") not in ("public_domain", "creative_commons")
                or type(policy.get("endpoint_id")) is not int or policy["endpoint_id"] < 1
                or type(policy.get("policy_decision_id")) is not int or policy["policy_decision_id"] < 1):
            continue
        reference = {"id": f"rag:{row['id']}", "text": text[:2500], "title": title[:500],
                     "url": url, "rights": row["license"], "governance": {
                         key: policy[key] for key in ("endpoint_id", "policy_decision_id", "rights_class", "trust_mode")}}
        size = len(json.dumps(reference, ensure_ascii=True).encode()) + 2
        if used + size > SOURCE_BYTES:
            continue
        references.append(reference)
        used += size
        seen.add(row["id"])
    if not references:
        raise EvidenceError("editorial-no-approved-corpus-sources")
    return references
