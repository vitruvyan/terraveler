"""Photo editor (iconography) handler: governed Commons images, receipt-bound selection.

The model proposes search queries and judges candidates from Commons metadata
only; it cannot see images and cannot cite anything but a receipt obtained in
this attempt. Trusted code copies each selected receipt's exact snapshot into
the result, so licence, URLs, artist and dates are never model-written. SQL
re-checks every selection against its receipt and the attempt's claim time.
"""
from __future__ import annotations

import copy
import json
import os
import re
from typing import Callable
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from orchestration.editorial_gateway import DEPICTIONS, generate_candidate
from orchestration.editorial_handlers import EvidenceError

MAX_FETCHED = 12
MAX_SELECTED = 8
SEARCH_LIMIT = 10
QUOTES = re.compile(r'["“”«»]')
RECEIPT_ID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def mcp_tool_port(env=None, open_request=None) -> Callable[[str, dict], dict]:
    """A JSON-RPC caller for the public Commons tools on the configured Terraveler MCP endpoint."""
    values = os.environ if env is None else env
    url = values.get("EDITORIAL_MCP_URL", "")
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path != "/api/mcp"):
            raise ValueError()
    except (TypeError, ValueError):
        raise EvidenceError("editorial-commons-not-configured") from None

    def call(name: str, arguments: dict) -> dict:
        if name not in ("search_commons_images", "fetch_commons_image"):
            raise EvidenceError("editorial-commons-tool-invalid")
        request = Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": name, "arguments": arguments}}).encode(),
            headers={"Content-Type": "application/json", "Accept": "application/json"}, method="POST")
        try:
            opener = open_request or build_opener(_NoRedirect()).open
            with opener(request, timeout=30) as response:
                raw = response.read(1_000_001)
            if len(raw) > 1_000_000:
                raise ValueError()
            envelope = json.loads(raw)
            if envelope.get("jsonrpc") != "2.0" or envelope.get("id") != 1 or envelope.get("error"):
                raise ValueError()
            result = envelope["result"]
            if result.get("isError"):
                # A refused file (licence, host, missing) is an expected, bounded outcome.
                return {"refused": True}
            body = result["structuredContent"]
            if not isinstance(body, dict):
                raise ValueError()
            return body
        except Exception:
            raise EvidenceError("editorial-commons-unavailable") from None
    return call


def _candidate_summary(snapshot: dict, receipt_id: str) -> dict:
    """What the model may read about one consulted file: metadata, never URLs to fetch."""
    def text(value, limit):
        return value[:limit] if isinstance(value, str) else None
    licence = snapshot.get("licence") or {}
    return {"receipt_id": receipt_id, "title": text(snapshot.get("title"), 255),
            "description": text(snapshot.get("description"), 600), "artist": text(snapshot.get("artist"), 200),
            "credit": text(snapshot.get("credit"), 200), "date_original": text(snapshot.get("date_original"), 100),
            "object_name": text(snapshot.get("object_name"), 200), "licence": text(licence.get("short_name"), 100),
            "mime": text(snapshot.get("mime"), 40), "width": snapshot.get("width"), "height": snapshot.get("height")}


def _judgment_text(value, *, optional=False):
    if value is None and optional:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 1000 or QUOTES.search(value):
        raise EvidenceError("editorial-invalid-image-judgment")
    return value.strip()


def iconography(task, config, *, call_tool: Callable[[str, dict], dict] | None = None, generator=generate_candidate):
    call = call_tool or mcp_tool_port()
    base = copy.deepcopy(task)
    base.setdefault("input", {})

    # 1. The model proposes search queries for the work item.
    query_task = copy.deepcopy(base)
    query_task["input"]["iconography_stage"] = "queries"
    generated = generator(query_task, config)
    queries = (generated or {}).get("candidate", {}).get("queries")
    if (not isinstance(queries, list) or not 2 <= len(queries) <= 4
            or any(not isinstance(q, str) or not 2 <= len(q.strip()) <= 300 or QUOTES.search(q) for q in queries)):
        raise EvidenceError("editorial-invalid-image-queries")

    # 2. Governed search: candidates only, licence decided per file by the MCP tool.
    titles: list[str] = []
    for query in queries:
        found = call("search_commons_images", {"query": query.strip(), "limit": SEARCH_LIMIT})
        for candidate in found.get("candidates", []) if isinstance(found, dict) else []:
            title = candidate.get("title") if isinstance(candidate, dict) else None
            if candidate.get("usable") is True and isinstance(title, str) and title not in titles:
                titles.append(title)
    # 3. Consultation: each fetched file gets its own receipt in this attempt.
    consulted: dict[str, dict] = {}
    for title in titles[:MAX_FETCHED]:
        body = call("fetch_commons_image", {"title": title})
        if body.get("refused"):
            continue
        receipt = body.get("consultation")
        if body.get("consultation_status") != "recorded" or not isinstance(receipt, dict):
            raise EvidenceError("editorial-image-receipt-required")
        receipt_id, digest = receipt.get("id"), receipt.get("response_sha256")
        if not isinstance(receipt_id, str) or not RECEIPT_ID.fullmatch(receipt_id) or not re.fullmatch(r"[0-9a-f]{64}", str(digest)):
            raise EvidenceError("editorial-image-receipt-required")
        snapshot = {k: v for k, v in body.items() if k not in ("consultation", "consultation_status")}
        consulted[receipt_id] = {"snapshot": snapshot, "receipt_sha256": digest}

    queries_used = [q.strip() for q in queries]
    if not consulted:
        return {"kind": "iconography", "images": [], "queries": queries_used,
                "uncertainties": ["No usable public-domain, CC0, CC BY or CC BY-SA Commons image was found for these queries."],
                "candidate": generated, "verification": "candidate-only"}

    # 4. The model selects among receipts only, judging metadata it can read.
    selection_task = copy.deepcopy(base)
    selection_task["input"]["iconography_stage"] = "selection"
    selection_task["input"]["image_candidates"] = [
        _candidate_summary(entry["snapshot"], receipt_id) for receipt_id, entry in consulted.items()]
    chosen = generator(selection_task, config)
    candidate = (chosen or {}).get("candidate")
    if not isinstance(candidate, dict) or candidate.get("kind") != "iconography":
        raise EvidenceError("editorial-invalid-image-selection")
    selections, uncertainties = candidate.get("selections"), candidate.get("uncertainties")
    if (not isinstance(selections, list) or len(selections) > MAX_SELECTED
            or not isinstance(uncertainties, list)
            or any(not isinstance(u, str) or not u.strip() or QUOTES.search(u) for u in uncertainties)):
        raise EvidenceError("editorial-invalid-image-selection")

    # 5. Trusted composition: exact receipt snapshots plus the bounded judgment.
    images, seen = [], set()
    for selection in selections:
        if not isinstance(selection, dict) or set(selection) != {"receipt_id", "depiction", "relevance", "caution"}:
            raise EvidenceError("editorial-invalid-image-selection")
        receipt_id = selection["receipt_id"]
        if receipt_id not in consulted or receipt_id in seen:
            raise EvidenceError("editorial-unknown-image-receipt")
        if selection["depiction"] not in DEPICTIONS:
            raise EvidenceError("editorial-invalid-image-judgment")
        seen.add(receipt_id)
        images.append({"receipt_id": receipt_id, "receipt_sha256": consulted[receipt_id]["receipt_sha256"],
                       "snapshot": copy.deepcopy(consulted[receipt_id]["snapshot"]),
                       "depiction": selection["depiction"],
                       "relevance": _judgment_text(selection["relevance"]),
                       "caution": _judgment_text(selection["caution"], optional=True)})
    if not images and not uncertainties:
        raise EvidenceError("editorial-empty-image-selection-unexplained")
    return {"kind": "iconography", "images": images, "queries": queries_used,
            "uncertainties": [u.strip() for u in uncertainties],
            "candidate": {"queries": generated, "selection": chosen}, "verification": "candidate-only"}
