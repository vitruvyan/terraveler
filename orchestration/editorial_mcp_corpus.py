"""Trusted handler port for task-scoped MCP corpus reads; never a SQL fallback."""
from __future__ import annotations

import json
import math
import os
import re
from urllib.parse import urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener
from orchestration.editorial_handlers import EvidenceError


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


QUERY_EMBEDDING_DIMENSIONS = 768
DEFAULT_EMBEDDING_URL = "http://127.0.0.1:6002/v1/embeddings/create"


def query_embedding(task, *, env=None, open_request=None):
    """Embed the work item's own question in the corpus's space (self-hosted nomic).

    Off unless EDITORIAL_CORPUS_RELEVANCE=1. Once on, a missing question or an
    unreachable embedding service fails the attempt: a silent fallback to an
    unranked read is how every research item came to share one book's first pages.
    """
    values = os.environ if env is None else env
    if values.get("EDITORIAL_CORPUS_RELEVANCE") != "1":
        return None
    work_item = (task.get("input") or {}).get("work_item") if isinstance(task.get("input"), dict) else None
    question = work_item.get("question") if isinstance(work_item, dict) else None
    if not isinstance(question, str) or not question.strip() or len(question) > 2000:
        raise EvidenceError("editorial-research-question-required")
    url = values.get("EDITORIAL_EMBEDDING_URL", DEFAULT_EMBEDDING_URL)
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError()
        request = Request(url, data=json.dumps({"text": question}).encode(),
                          headers={"Content-Type": "application/json", "Accept": "application/json"}, method="POST")
        opener = open_request or build_opener(_NoRedirect()).open
        with opener(request, timeout=20) as response:
            raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError()
        vector = json.loads(raw)["embedding"]
        if (not isinstance(vector, list) or len(vector) != QUERY_EMBEDDING_DIMENSIONS
                or any(type(x) not in (int, float) or not math.isfinite(x) or abs(x) > 1000 for x in vector)):
            raise ValueError()
        return [float(x) for x in vector]
    except Exception:
        raise EvidenceError("editorial-embedding-unavailable") from None


def retrieve_mcp_sources(task, *, env=None, open_request=None, embed_request=None):
    values = os.environ if env is None else env
    vector = query_embedding(task, env=values, open_request=embed_request)
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
    arguments = {"task_id": task["id"], "attempt": task["attempt"]}
    if vector is not None:
        arguments["query_embedding"] = vector
    request = Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "read_editorial_corpus", "arguments": arguments}}).encode(),
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
        if vector is not None and (body.get("retrieval") or {}).get("mode") != "relevance":
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
