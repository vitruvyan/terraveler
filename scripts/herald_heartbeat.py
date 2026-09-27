#!/usr/bin/env python3
"""The Herald's daily heartbeat (docs/SHIPS_OFFICERS.md §4.4, A1).

    python3 scripts/herald_heartbeat.py

Why this exists
----------------
The Herald's event-driven watches (officers/dispatcher.py: escalation.raised,
appeal.filed, dlq.entry) report only when something is wrong. A silent
Herald is meant to mean "nothing needed you today" — but that is
indistinguishable from a dead one unless something proves it is still
alive on a schedule cron controls, not events. This is that proof: one
line, once a day, that also carries the one fact worth checking while it's
already awake — whether the officer fleet's own /health is happy.

Not wired to any scheduler in this repo yet — add a daily crontab/systemd-
timer entry on the host (same place notify_curator_verdicts.py's own cron
entry lives).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HEALTH_URL = os.environ.get("OFFICERS_HEALTH_URL", "http://127.0.0.1:6005/health")


def _dotenv() -> dict:
    env = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    return env


def notify(text: str) -> None:
    env = _dotenv()
    token = os.environ.get("TELEGRAM_TOKEN") or env.get("TELEGRAM_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID") or env.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        print("(no TELEGRAM_TOKEN/TELEGRAM_CHAT_ID configured — skipping notification)")
        return
    body = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage", data=body, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            if r.status != 200:
                print(f"(Telegram notification failed: HTTP {r.status})")
    except Exception as exc:  # noqa: BLE001 — a notification failure is not a check failure
        print(f"(Telegram notification failed: {exc})")


def fleet_status() -> str:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=10) as r:
            body = json.loads(r.read())
    except urllib.error.URLError as e:
        return f"unreachable ({e})"
    except Exception as e:  # noqa: BLE001 — reported, not raised
        return f"unreadable ({e})"
    status = body.get("status", "unknown")
    if status == "healthy":
        return "healthy"
    stale = body.get("stale") or []
    return f"degraded — stale: {', '.join(stale) if stale else 'unspecified'}"


def main() -> None:
    fleet = fleet_status()
    notify(f"\U0001F397️ Herald heartbeat — still watching. Officer fleet: {fleet}")
    print(f"herald heartbeat sent — fleet status: {fleet}")


if __name__ == "__main__":
    main()
