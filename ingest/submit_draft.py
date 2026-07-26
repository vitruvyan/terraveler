#!/usr/bin/env python3
"""Carry a generated draft into the review queue, through the same door as everyone else.

    python3 ingest/submit_draft.py out/darwin-1831.submission.json
    python3 ingest/submit_draft.py out/darwin-1831.submission.json --dry-run

Why this exists
---------------
extract.py deliberately touches nothing public: it reads rag_docs and writes a
submission JSON. Nothing then carried that file anywhere, so the AXIS pipeline
could produce a draft and the editorial desk would never see it. The Carta's
process (§5) runs idea → assessment → research → draft → verification → verdict
→ ingestion, and between *draft* and *verification* there was simply no bridge.

Why it goes through MCP rather than writing to the database
-----------------------------------------------------------
An INSERT into `submissions` would have been three lines. It would also have
been a second private entrance into the review queue — and this codebase has
already been bitten once by exactly that shape: the curated ingestion path
bypassed the licence whitelist for years on the grounds that a human had vetted
it, and three in-copyright editions walked straight through.

So the pipeline registers as a contributor and calls `submit_draft` like any
external Scribe. It gets no privilege nobody else has: the same Stage-0 gate,
the same peer review, the same human verdict, the same rows in audit_log. If a
draft this pipeline produces cannot pass the gate, that is information, not an
inconvenience to route around.

Credentials come from the environment and are never written to the repository:

    TERRAVELER_MCP_URL     default https://www.terraveler.com/api/mcp
    TERRAVELER_MCP_HANDLE  the pipeline's contributor handle
    TERRAVELER_MCP_KEY     its api_key (shown once at registration)
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

MCP_URL = os.environ.get("TERRAVELER_MCP_URL", "https://www.terraveler.com/api/mcp")
HANDLE = os.environ.get("TERRAVELER_MCP_HANDLE", "")
KEY = os.environ.get("TERRAVELER_MCP_KEY", "")


def rpc(method: str, params: dict, rid: int = 1) -> dict:
    body = json.dumps({"jsonrpc": "2.0", "id": rid,
                       "method": method, "params": params}).encode()
    req = urllib.request.Request(
        MCP_URL, data=body,
        headers={"Content-Type": "application/json",
                 "Accept": "application/json, text/event-stream"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        sys.exit(f"MCP {e.code}: {e.read().decode('utf-8', 'replace')[:400]}")
    except urllib.error.URLError as e:
        sys.exit(f"MCP unreachable at {MCP_URL}: {e.reason}")


def tool_text(resp: dict) -> str:
    """The MCP content envelope, unwrapped — or the raw response if it is an
    error, because an error is exactly what we most need to read."""
    if "error" in resp:
        return f"ERROR: {json.dumps(resp['error'])}"
    content = (resp.get("result") or {}).get("content") or []
    return "\n".join(c.get("text", "") for c in content) or json.dumps(resp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="the submission JSON written by extract.py")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be sent, contact nobody")
    args = ap.parse_args()

    try:
        sub = json.loads(open(args.path, encoding="utf-8").read())
    except FileNotFoundError:
        sys.exit(f"no such draft: {args.path}")
    except json.JSONDecodeError as e:
        sys.exit(f"{args.path}: not valid JSON ({e})")

    meta = sub.get("meta") or {}
    wps = sub.get("waypoints") or []
    quoted = sum(1 for w in wps
                 for c in (w.get("claims") or [])
                 if (c.get("evidence") or {}).get("quote"))
    size_kb = len(json.dumps(sub)) / 1000

    print(f"draft      {args.path}")
    print(f"  voyage   {meta.get('target_voyage')}  type={meta.get('type')}")
    print(f"  carta    {meta.get('carta_version')}   scribe={meta.get('scribe_model')}")
    print(f"  content  {len(wps)} waypoints, {quoted} quoted claims, {size_kb:.1f} kB")

    if args.dry_run:
        print("dry run — nothing sent")
        return

    if not HANDLE or not KEY:
        sys.exit("set TERRAVELER_MCP_HANDLE and TERRAVELER_MCP_KEY "
                 "(the pipeline's own contributor credentials)")

    print(f"\nsubmitting to {MCP_URL} as '{HANDLE}' …")
    resp = rpc("tools/call", {
        "name": "submit_draft",
        "arguments": {"handle": HANDLE, "api_key": KEY, "submission": sub},
    })
    text = tool_text(resp)
    print(text)

    # A Stage-0 rejection is a real outcome, not a transport failure: the draft
    # reached the desk and was refused. Exit non-zero anyway so a scripted run
    # does not mistake it for acceptance.
    if text.startswith("ERROR") or '"gate_failures": [' in text and '"gate_failures": []' not in text:
        sys.exit(1)


if __name__ == "__main__":
    main()
