"""Discovery capability registry — what `oculus.py` can SEARCH, read from
`source_search_adapters` (see `supabase/source_search_adapters.sql`).

This is deliberately NOT the trust resolver. `whitelist.is_allowed()` /
`whitelist.verify_source()` decide what may be FETCHED and are untouched by
this module. This registry only decides which adapter FUNCTIONS get a chance
to *propose* candidates for a subject, and with what config. A row here can
only narrow what gets searched inside what the whitelist already permits — it
can never widen it:

  - every candidate URL an adapter builds is still checked against the
    whitelist before use, unchanged;
  - `mediawiki_search` specifically re-derives its target host from
    `config["api_base_template"]` and checks THAT host against
    `whitelist.is_allowed()` before making any HTTP request — a misconfigured
    template (e.g. pointing off-whitelist) must fail loudly, as an exception
    the caller turns into a trace Rejection naming the adapter, never as a
    silent request.

Governance stays where it already lived (`source_endpoints`,
`source_institutions`); this table is purely consultative metadata about
search capability, joined against that governance data's `status='active'` at
read time so a retired/quarantined endpoint automatically drops out of
discovery too — but that is a courtesy, not the security boundary. The
security boundary is still, only, and always `whitelist.py`.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional
from urllib.parse import urlparse

sys.path.append(os.path.dirname(__file__))
import fetch as F
import whitelist as W
from source_governance_shadow import get_db_connection

SNAPSHOT_PATH = os.path.join(os.path.dirname(__file__), "adapters_snapshot.json")

# Process-level cache TTL. The ingest container is one-shot
# (`profiles: ["jobs"]` in docker-compose.yml) — one process, one voyage, one
# call to `discover()` — so in practice this cache is populated once and never
# revisited within a run. The TTL only matters if this process ever outlives
# a single run (e.g. a long-lived worker); `refresh()` bypasses it explicitly.
CACHE_TTL_SECONDS = 300

# A language subtag, not a path. Rejects anything that could turn
# `{lang}` substitution into a host/path escape (`../../evil`,
# `x@evil.com`, embedded slashes or dots) rather than silently
# sanitizing it — an adapter config is trusted-but-verify input, not user
# input to be cleaned up on the fly.
LANG_RE = re.compile(r"^[a-z]{2,3}(-[a-z]+)?$")


@dataclass
class AdapterRow:
    """One row of `source_search_adapters`, already filtered to enabled +
    covering an active endpoint/institution."""
    id: int
    adapter: str
    config: dict
    capability: str
    priority: int
    max_candidates: int
    endpoint_id: Optional[int] = None
    institution_id: Optional[int] = None
    notes: Optional[str] = None


@dataclass
class RegistrySnapshot:
    adapters: list  # list[AdapterRow], capability in ('search','verify_only')
    gap: list        # list[{"id","host_pattern","match_type"}] — active endpoints, no adapter
    source: str       # "db" or "snapshot"
    generated_at: str
    note: str         # one line, fit for a trace Fact


# ------------------------------------------------------------- DB queries

def load_adapters(db_conn=None) -> list:
    """Enabled adapters covering at least one ACTIVE endpoint, ordered by
    priority (ascending — lower runs, and is kept, first)."""
    owns_conn = db_conn is None
    conn = db_conn if db_conn is not None else get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                select a.id, a.adapter, a.config, a.capability, a.priority,
                       a.max_candidates, a.endpoint_id, a.institution_id, a.notes
                from source_search_adapters a
                where a.enabled = true
                  and (
                    (a.endpoint_id is not null and exists (
                       select 1 from source_endpoints e
                       where e.id = a.endpoint_id and e.status = 'active'))
                    or
                    (a.institution_id is not null and exists (
                       select 1 from source_endpoints e
                       where e.institution_id = a.institution_id and e.status = 'active'))
                  )
                order by a.priority asc, a.id asc
            """)
            rows = cur.fetchall()
        return [AdapterRow(
            id=r["id"], adapter=r["adapter"], config=r["config"] or {},
            capability=r["capability"], priority=r["priority"],
            max_candidates=r["max_candidates"], endpoint_id=r["endpoint_id"],
            institution_id=r["institution_id"], notes=r["notes"])
            for r in rows]
    finally:
        if owns_conn:
            conn.close()


def gap_endpoints(db_conn=None) -> list:
    """Active endpoints covered by NO adapter row (by endpoint_id or by their
    institution_id) — the discovery blind spot, computed by set difference so
    it can never silently drift from the seed data."""
    owns_conn = db_conn is None
    conn = db_conn if db_conn is not None else get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                select e.id, e.host_pattern, e.match_type
                from source_endpoints e
                where e.status = 'active'
                  and not exists (
                    select 1 from source_search_adapters a
                    where a.enabled = true
                      and (a.endpoint_id = e.id or a.institution_id = e.institution_id)
                  )
                order by e.host_pattern
            """)
            return [dict(r) for r in cur.fetchall()]
    finally:
        if owns_conn:
            conn.close()


# ------------------------------------------------------------- caching + fallback

def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _load_snapshot_fallback(reason: str) -> RegistrySnapshot:
    if not os.path.exists(SNAPSHOT_PATH):
        raise RuntimeError(
            f"source_registry: {reason}, and no fallback snapshot at "
            f"{SNAPSHOT_PATH!r} — refusing to silently degrade to a hardcoded "
            f"Gutenberg+Wikipedia discovery list. Restore database "
            f"connectivity, or regenerate the snapshot with "
            f"`python3 scripts/sync_whitelist_snapshot.py` against a reachable "
            f"database and commit ingest/adapters_snapshot.json.")
    with open(SNAPSHOT_PATH) as f:
        data = json.load(f)
    adapters = [AdapterRow(**a) for a in data.get("adapters", [])]
    gap = data.get("gap", [])
    snapshot_date = data.get("generated_at", "unknown date")
    return RegistrySnapshot(
        adapters=adapters, gap=gap, source="snapshot", generated_at=_now_iso(),
        note=(f"DB unreachable ({reason}); using committed snapshot of "
              f"{snapshot_date} ({len(adapters)} adapter(s))"))


def _load_registry() -> RegistrySnapshot:
    try:
        conn = get_db_connection()
    except Exception as exc:
        return _load_snapshot_fallback(f"{type(exc).__name__}: {str(exc)[:160]}")
    try:
        adapters = load_adapters(conn)
        gap = gap_endpoints(conn)
    except Exception as exc:
        return _load_snapshot_fallback(f"{type(exc).__name__}: {str(exc)[:160]}")
    finally:
        conn.close()
    return RegistrySnapshot(
        adapters=adapters, gap=gap, source="db", generated_at=_now_iso(),
        note=(f"loaded {len(adapters)} adapter(s) from source_search_adapters; "
              f"{len(gap)} active endpoint(s) have no adapter coverage"))


_cache: dict = {"snapshot": None, "loaded_at": 0.0}


def get_registry(force_refresh: bool = False) -> RegistrySnapshot:
    """Process-level cache, loaded at most once per `CACHE_TTL_SECONDS`. Not
    per-subject: the first `oculus.discover()` call in a process loads it,
    and every call after that (in the same process, within the TTL) reuses
    it instead of hitting the DB again — which is what makes it safe for
    `oculus.discover()` to call this itself with no caller-side bookkeeping."""
    now = time.time()
    if (not force_refresh and _cache["snapshot"] is not None
            and (now - _cache["loaded_at"]) < CACHE_TTL_SECONDS):
        return _cache["snapshot"]
    snapshot = _load_registry()
    _cache["snapshot"] = snapshot
    _cache["loaded_at"] = now
    return snapshot


def refresh() -> RegistrySnapshot:
    """Explicit cache bust — no LISTEN/NOTIFY, no background invalidation.
    The ingest container is one-shot, so a fresh process already gets a fresh
    load; this exists for long-lived callers (tests, a future worker)."""
    return get_registry(force_refresh=True)


# ------------------------------------------------------------- adapter functions
#
# Signature: (subject: str, lang: str, config: dict, max_candidates: int)
#   -> list[{kind, title, url, source_url, license, lang, hint}]
# Same shape `curate.py`/`pipeline_native.py` already expect from
# `gutendex_books`/`wikipedia_candidates` (oculus.py, pre-registry).

class AdapterRejected(Exception):
    """Raised by an adapter function when its OWN config would produce an
    off-whitelist request. Never raised for "found nothing" — that is just an
    empty list. `oculus.discover()` turns this into a trace Rejection naming
    the adapter; it never lets the request happen."""


def gutendex(subject: str, lang: str, config: dict, max_candidates: int) -> list:
    """Public-domain books from Project Gutenberg, via the Gutendex index.
    `config` is currently unused (the index has one fixed, whitelisted host);
    kept as a parameter so a future per-mirror config does not need a new
    adapter function."""
    import urllib.parse
    q = urllib.parse.urlencode({"search": subject})
    data = F.get_json(f"https://gutendex.com/books/?{q}")
    out = []
    for b in data.get("results", []):
        fmts = b.get("formats", {})
        txt = None
        for k, v in fmts.items():
            if k.startswith("text/plain") and isinstance(v, str) and not v.endswith(".zip"):
                txt = v
                break
        if not txt or not W.is_allowed(txt):
            continue
        title = b.get("title", "")
        authors = ", ".join(a.get("name", "") for a in b.get("authors", []))
        full_title = (f"{title} — {authors}").strip(" —")
        out.append({
            "kind": "gutenberg", "lang": lang,
            "title": full_title,
            "hint": f"Public-domain book: {full_title}",
            "url": txt,
            "source_url": f"https://www.gutenberg.org/ebooks/{b.get('id')}",
            "license": "Public domain",
        })
        if len(out) >= max_candidates:
            break
    return out


def _mediawiki_host(config: dict, lang: str) -> str:
    template = config.get("api_base_template") or ""
    if not template:
        raise AdapterRejected("mediawiki_search: config has no api_base_template")
    api_url = template.replace("{lang}", lang)
    host = urlparse(api_url).netloc
    if not host:
        raise AdapterRejected(f"mediawiki_search: unparseable api_base_template {template!r}")
    if not W.is_allowed(api_url):
        raise AdapterRejected(
            f"mediawiki_search: host {host!r} (from api_base_template) is "
            f"off-whitelist — refusing before any request")
    return api_url


def mediawiki_search(subject: str, lang: str, config: dict, max_candidates: int) -> list:
    """Generic MediaWiki `list=search` adapter, parameterized by
    `config = {api_base_template, kind, license}`. Used today for Wikipedia
    and Wikisource (see `supabase/source_search_adapters.sql`); any other
    project exposing the same search API could reuse this by adding a row
    instead of a new function.

    The host is derived from `api_base_template` and checked against
    `whitelist.is_allowed()` BEFORE any HTTP request — the template is
    adapter config, not a trusted constant, and a bad row must fail as an
    `AdapterRejected` the caller can name, never as a request that happens
    anyway.
    """
    import urllib.parse
    if not LANG_RE.match(lang or ""):
        raise AdapterRejected(
            f"mediawiki_search: lang {lang!r} does not match {LANG_RE.pattern!r} "
            f"— refusing to build a host/path from it")
    kind = config.get("kind", "mediawiki")
    license_ = config.get("license", "unknown")
    api_base = _mediawiki_host(config, lang)
    host = urlparse(api_base).netloc

    api = api_base + "?" + urllib.parse.urlencode({
        "action": "query", "list": "search", "srsearch": subject,
        "srlimit": max_candidates, "format": "json"})
    res = F.get_json(api).get("query", {}).get("search", [])
    out = []
    for t in res:
        snippet = re.sub(r"<[^>]+>", "", t.get("snippet", ""))
        title = t["title"]
        page_url = f"https://{host}/wiki/" + title.replace(" ", "_")
        out.append({
            "kind": kind, "lang": lang, "title": title, "hint": snippet,
            "license": license_, "url": page_url, "source_url": page_url,
        })
        if len(out) >= max_candidates:
            break
    return out


ADAPTERS: dict = {
    "gutendex": gutendex,
    "mediawiki_search": mediawiki_search,
    # "archive_org_metadata" is deliberately absent: its only registered
    # capability is 'verify_only', which oculus.discover() never calls into
    # this dict for — see the capability filter there.
}
