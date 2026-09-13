#!/usr/bin/env python3
"""Push a Telegram message when a new agent registers, or an agent submits
new content.

    python3 scripts/notify_agent_activity.py
    python3 scripts/notify_agent_activity.py --notify-test

Scope, deliberately narrow (see docs/SECRETS.md for the shared bot):
  - oauth-register, outcome=accepted — a brand new agent identity was
    created. Not every token request: token issuance is not audited at all
    today (no securityAudit() call in app/api/oauth/token/route.ts), and a
    session can renew its token many times — that would be a login-noise
    generator, not a signal. Registration is rare and means something.
  - propose_idea / submit_draft / suggest_content / suggest_feature,
    outcome=accepted — new editorial material entering the queue.
    submit_review, claim_gap and appeal are real activity too but are not
    "writing content" in the sense asked for, and including them would
    roughly double the message volume for review/claim traffic that isn't
    the thing this was built to surface.

Same checkpoint-by-id pattern as check_motus_raised.py, against a different
table (mcp_security_audit instead of the three Motus trace stores) — kept
as a separate script rather than folded into that one because the two
watch genuinely different things for genuinely different reasons: one is
"a node misbehaved," this one is "something happened that is worth knowing
about," and conflating them would make either harder to reason about.
"""
from __future__ import annotations

import argparse
import os
import urllib.parse
import urllib.request
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = Path(os.environ.get(
    "AGENT_ACTIVITY_STATE_FILE", Path.home() / "backups" / "terraveler" / "agent_activity_state.json"))

REGISTER_ACTION = "oauth-register"
CONTENT_ACTIONS = ("propose_idea", "submit_draft", "suggest_content", "suggest_feature")


def _dotenv() -> dict:
    env = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    return env


def pg_params() -> dict:
    env = _dotenv()
    return {
        "host": os.environ.get("PGHOST", "127.0.0.1"),
        "port": int(os.environ.get("PGPORT", "6000")),
        "dbname": os.environ.get("PGDATABASE", "terraveler"),
        "user": os.environ.get("PGUSER", "terraveler"),
        "password": os.environ.get("PGPASSWORD") or env.get("POSTGRES_PASSWORD", ""),
    }


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


def load_state() -> dict:
    if STATE_FILE.exists():
        import json
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict) -> None:
    import json
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def fetch_events(conn, since_id: int) -> tuple[list[dict], int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select a.id, a.action, a.agent_id, a.created_at,
                   aa.voyager_name, aa.display_name
            from mcp_security_audit a
            left join agent_accounts aa on aa.id = a.agent_account_id
            where a.id > %s
              and a.outcome = 'accepted'
              and a.action = any(%s)
            order by a.id
            """,
            (since_id, [REGISTER_ACTION, *CONTENT_ACTIONS]),
        )
        rows = cur.fetchall()
    events, max_id = [], since_id
    for row_id, action, agent_id, created_at, voyager_name, display_name in rows:
        max_id = max(max_id, row_id)
        who = voyager_name or display_name or agent_id or "unknown agent"
        events.append({
            "id": row_id, "action": action, "who": who, "created_at": str(created_at),
        })
    return events, max_id


def describe(event: dict) -> str:
    if event["action"] == REGISTER_ACTION:
        return f"🆕 {event['who']} registered as a new agent — {event['created_at']}"
    return f"✍️ {event['who']} submitted {event['action']} — {event['created_at']}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--notify-test", action="store_true",
                    help="send a test Telegram message and exit, without touching the checkpoint")
    args = ap.parse_args()

    if args.notify_test:
        notify("Terraveler / notify_agent_activity.py: test notification — if you see this, "
               "the Telegram wiring works.")
        print("test notification sent (see stdout above for delivery status)")
        return 0

    state = load_state()
    conn = psycopg2.connect(**pg_params())
    try:
        if "mcp_security_audit" not in state:
            # Cold start: unlike check_motus_raised.py's deliberate full
            # retroactive backlog (rare anomalies worth surfacing even
            # historically), a fresh run here would mean blasting every
            # past registration and submission as an individual Telegram
            # message — 23 of them the day this script was written. This
            # watches for what happens next, not what already happened.
            with conn.cursor() as cur:
                cur.execute("select coalesce(max(id), 0) from mcp_security_audit")
                since = cur.fetchone()[0]
            state["mcp_security_audit"] = since
            save_state(state)
            print(f"cold start: checkpoint set to id {since}, nothing historical reported")
            return 0
        since = state["mcp_security_audit"]
        events, max_id = fetch_events(conn, since)
    finally:
        conn.close()
    state["mcp_security_audit"] = max_id
    save_state(state)

    if not events:
        print("no new agent registrations or content submissions")
        return 0

    for event in events:
        line = describe(event)
        print(line)
        notify(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
