#!/usr/bin/env python3
"""Push a Telegram message for every real curator verdict.

    python3 scripts/notify_curator_verdicts.py
    python3 scripts/notify_curator_verdicts.py --notify-test

Why this exists
----------------
The Curator (scripts/desk_graph.py, run automatically by
officers/dispatcher.py right after peer review completes) already rules
autonomously on clean submissions — approve, request changes, or escalate
to the human — with zero human involvement for the cases it can decide.
That automation already existed; what didn't was any way for the human to
see it happening without going and looking. This is the oversight half of
that: not a new decision-maker, a window onto the one that already runs.

Scope, deliberately matching what was asked for — visibility into the
officer's existing autonomy, not an expansion of it:
  - curator-desk / verdict / approve   — ruled clean, autonomously
  - curator-desk / verdict / changes   — sent back to the author, autonomously
  - curator-desk / review  / escalate  — could NOT be ruled alone, needs you
  - curator-gate / verdict / reject    — failed Stage-0 shape checks outright

Deliberately excluded: curator-gate / verdict / pass-gate. It fires on
essentially every submission (28 of the 33 historical curator rows at
the time this was written) and is not a decision — it just means the
submission's shape was well-formed enough to proceed to review. Including
it would make this a high-volume, low-signal feed instead of "here is
what the officer decided."

Same checkpoint-by-id, cold-start-to-present pattern as
notify_agent_activity.py, against audit_log instead of mcp_security_audit.

The escalate case is the one WATCHED entry that gets Accept/Reject/Review
buttons rather than plain text — it's the only one asking the editor to do
something; approve/changes/reject already happened autonomously and the
message is purely informational. Accept/Reject are answered by the same
webhook (app/api/telegram/webhook/route.ts) built for source proposals,
routed through lib/deskVerdict.ts's resolveVerdict() — an approve via
Telegram always carries an override, since the whole reason a submission
reached this queue is that its dossier wasn't clean enough for the Curator
to rule alone.
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = Path(os.environ.get(
    "CURATOR_VERDICT_STATE_FILE", Path.home() / "backups" / "terraveler" / "curator_verdict_state.json"))

DESK_SUBMISSIONS_URL = "https://www.terraveler.com/desk?tab=submissions"

# (actor, action, verdict) -> label
WATCHED = {
    ("curator-desk", "verdict", "approve"): "✅ approved autonomously",
    ("curator-desk", "verdict", "changes"): "📝 sent back for changes, autonomously",
    ("curator-desk", "review", "escalate"): "🔺 escalated — needs your review",
    ("curator-gate", "verdict", "reject"): "❌ rejected at intake (Stage-0 shape check)",
}

# Which WATCHED entries get Accept/Reject/Review buttons instead of plain
# text — only the one actually asking the editor to decide something.
ACTIONABLE = {("curator-desk", "review", "escalate")}


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


def notify(text: str, reply_markup: dict | None = None) -> None:
    env = _dotenv()
    token = os.environ.get("TELEGRAM_TOKEN") or env.get("TELEGRAM_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID") or env.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        print("(no TELEGRAM_TOKEN/TELEGRAM_CHAT_ID configured — skipping notification)")
        return
    payload = {"chat_id": chat_id, "text": text}
    if reply_markup is not None:
        payload["reply_markup"] = json.dumps(reply_markup)
    body = urllib.parse.urlencode(payload).encode()
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
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def fetch_verdicts(conn, since_id: int) -> tuple[list[dict], int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select a.id, a.submission_id, a.actor, a.action, a.verdict, a.created_at,
                   s.type, s.target_voyage
            from audit_log a
            left join submissions s on s.id = a.submission_id
            where a.id > %s
              and a.actor in ('curator-desk', 'curator-gate')
            order by a.id
            """,
            (since_id,),
        )
        rows = cur.fetchall()
    found, max_id = [], since_id
    for row_id, submission_id, actor, action, verdict, created_at, sub_type, target_voyage in rows:
        max_id = max(max_id, row_id)
        key = (actor, action, verdict)
        label = WATCHED.get(key)
        if not label:
            continue  # e.g. curator-gate/pass-gate — deliberately not a signal
        found.append({
            "id": row_id, "submission_id": submission_id, "label": label,
            "type": sub_type, "target_voyage": target_voyage, "created_at": str(created_at),
            "actionable": key in ACTIONABLE,
        })
    return found, max_id


def describe(v: dict) -> str:
    where = v["target_voyage"] or v["type"] or "?"
    return f"{v['label']} — submission #{v['submission_id']} ({where}) — {v['created_at']}"


def buttons(v: dict) -> dict:
    row1 = [
        {"text": "✅ Accetta", "callback_data": f"sub:approve:{v['submission_id']}"},
        {"text": "❌ Rifiuta", "callback_data": f"sub:reject:{v['submission_id']}"},
    ]
    row2 = [{"text": "🔍 Rivedi sul desk", "url": DESK_SUBMISSIONS_URL}]
    return {"inline_keyboard": [row1, row2]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--notify-test", action="store_true",
                    help="send a test Telegram message and exit, without touching the checkpoint")
    args = ap.parse_args()

    if args.notify_test:
        notify("Terraveler / notify_curator_verdicts.py: test notification — if you see this, "
               "the Telegram wiring works.")
        print("test notification sent (see stdout above for delivery status)")
        return 0

    state = load_state()
    conn = psycopg2.connect(**pg_params())
    try:
        if "audit_log" not in state:
            # Cold start: report nothing historical, same reasoning as
            # notify_agent_activity.py — 24 real curator verdicts already
            # sat in audit_log the day this was written, and blasting all
            # of them as individual messages the first time this runs
            # would be exactly the noise this exists to avoid.
            with conn.cursor() as cur:
                cur.execute("select coalesce(max(id), 0) from audit_log")
                since = cur.fetchone()[0]
            state["audit_log"] = since
            save_state(state)
            print(f"cold start: checkpoint set to id {since}, nothing historical reported")
            return 0
        since = state["audit_log"]
        events, max_id = fetch_verdicts(conn, since)
    finally:
        conn.close()
    state["audit_log"] = max_id
    save_state(state)

    if not events:
        print("no new curator verdicts")
        return 0

    for event in events:
        line = describe(event)
        print(line)
        notify(line, reply_markup=buttons(event) if event["actionable"] else None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
