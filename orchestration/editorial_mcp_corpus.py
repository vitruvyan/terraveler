"""Trusted handler port for task-scoped MCP corpus reads; never a SQL fallback."""
from __future__ import annotations

import json
import os
import re
from urllib.parse import urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener
from orchestration.editorial_handlers import EvidenceError


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def retrieve_mcp_sources(task, *, env=None, open_request=None):
    values = os.environ if env is None else env
    url, key = values.get("EDITORIAL_MCP_URL", ""), values.get("EDITORIAL_MCP_CORPUS_KEY", "")
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path != "/api/mcp"
                or not 32 <= len(key) <= 512 or re.search(r"[\r\n]", key)
                or type(task.get("id")) is not int or task["id"] < 1
                or type(task.get("attempt")) is not int or not 1 <= task["attempt"] <= 5):
            raise ValueError()
    except (TypeError, ValueError):
        raise EvidenceError("editorial-mcp-corpus-not-configured") from None
    request = Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "read_editorial_corpus", "arguments": {"task_id": task["id"], "attempt": task["attempt"]}}}).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json",
                 "X-Editorial-MCP-Key": key}, method="POST")
    try:
        opener = open_request or build_opener(_NoRedirect()).open
        with opener(request, timeout=25) as response:
            raw = response.read(131073)
        if len(raw) > 131072:
            raise ValueError()
        envelope = json.loads(raw)
        if envelope.get("jsonrpc") != "2.0" or envelope.get("id") != 1 or envelope.get("error"):
            raise ValueError()
        result = envelope["result"]
        if result.get("isError"):
            raise ValueError()
        body = result["structuredContent"]
        receipt = body["consultation"]
        if (body["task_id"] != task["id"] or body["attempt"] != task["attempt"]
                or not re.fullmatch(r"[0-9a-fA-F-]{36}", receipt["id"])
                or not re.fullmatch(r"[0-9a-f]{64}", receipt["snapshot_sha256"])):
            raise ValueError()
        sources = body["sources"]
        if not isinstance(sources, list) or not 1 <= len(sources) <= 40:
            raise ValueError()
        for source in sources:
            if not isinstance(source, dict) or not isinstance(source.get("governance"), dict):
                raise ValueError()
            source["governance"]["mcp_consultation_id"] = receipt["id"]
            source["governance"]["mcp_snapshot_sha256"] = receipt["snapshot_sha256"]
        if len(json.dumps(sources, ensure_ascii=False).encode()) > 24000:
            raise ValueError()
        return sources
    except Exception:
        # Keys, HTTP bodies and source bytes never become worker error logs.
        raise EvidenceError("editorial-mcp-corpus-unavailable") from None
