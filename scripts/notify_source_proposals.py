#!/usr/bin/env python3
"""Push a Telegram message — with Accept/Reject/Review buttons — for every
new source proposal.

    python3 scripts/notify_source_proposals.py
    python3 scripts/notify_source_proposals.py --notify-test

Why this exists
----------------
suggest_source writes its own audit_log row (action=propose_source), in a
different table from everything notify_agent_activity.py watches
(mcp_security_audit) — so a source proposal has never triggered any
Telegram message at all, buttoned or not, since the Sources tab shipped.
An agent could propose a source and the only way to know was to open the
desk and look.

The buttons close the loop the desk's own Approve/Reject already does: the
agent that proposed a source already researched it enough to suggest a
trust_mode and rights_class (source_proposal_intents.suggested_trust_mode /
.suggested_rights_class), so Accept can be a genuine one-tap action rather
than a shortcut to a form. The webhook at app/api/telegram/webhook/route.ts
answers the tap; Review is a plain URL button straight to the desk, no
webhook involved, for whenever a proposal needs an actual look before a
verdict.

Deliberately excluded: propose_source_additional. It attaches new intent to
an EXISTING pending proposal rather than creating one — nothing new to
decide, so nothing new worth a message.

Same checkpoint-by-id, cold-start-to-present, separate-script-per-concern
pattern as notify_agent_activity.py and notify_curator_verdicts.py.
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
    "SOURCE_PROPOSAL_STATE_FILE", Path.home() / "backups" / "terraveler" / "source_proposal_state.json"))

DESK_SOURCES_URL = "https://www.terraveler.com/desk?tab=sources"


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


def host(url: str) -> str:
    try:
        h = urllib.parse.urlparse(url).netloc or url
    except Exception:  # noqa: BLE001
        h = url
    return h[4:] if h.startswith("www.") else h


def fetch_proposal_ids(conn, since_id: int) -> tuple[list[int], int]:
    """New proposal ids since the checkpoint, read out of the audit_log row
    each propose_source call writes. findings carries a machine-readable
    ["PROPOSAL_ID", 0, "<id>"] entry precisely so this doesn't have to guess
    which source_proposals row a given audit_log row was about — audit_log's
    own submission_id column is FK'd to the unrelated submissions table and
    can't hold it."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select a.id, a.findings
            from audit_log a
            where a.id > %s and a.action = 'propose_source'
            order by a.id
            """,
            (since_id,),
        )
        rows = cur.fetchall()
    ids, max_id = [], since_id
    for row_id, findings in rows:
        max_id = max(max_id, row_id)
        for finding in findings or []:
            if len(finding) >= 3 and finding[0] == "PROPOSAL_ID":
                try:
                    ids.append(int(finding[2]))
                except (TypeError, ValueError):
                    pass
                break
    return ids, max_id


def fetch_proposal_detail(conn, proposal_ids: list[int]) -> list[dict]:
    if not proposal_ids:
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
            select p.id, p.target_url, p.status, p.proposed_by_actor_type, p.proposed_by_actor_id,
                   i.reason, i.suggested_trust_mode, i.suggested_rights_class
            from source_proposals p
            left join lateral (
                select reason, suggested_trust_mode, suggested_rights_class
                from source_proposal_intents
                where proposal_id = p.id
                order by id desc limit 1
            ) i on true
            where p.id = any(%s)
            order by p.id
            """,
            (proposal_ids,),
        )
        rows = cur.fetchall()
    return [
        {
            "id": pid, "target_url": url, "status": status,
            "actor_type": actor_type, "actor_id": actor_id,
            "reason": reason, "trust_mode": trust_mode, "rights_class": rights_class,
        }
        for pid, url, status, actor_type, actor_id, reason, trust_mode, rights_class in rows
    ]


def describe(p: dict) -> str:
    lines = [
        f"📚 Nuova proposta di source — #{p['id']}",
        f"{host(p['target_url'])}",
        f"proposta da {p['actor_type']} #{p['actor_id']}",
    ]
    if p["reason"]:
        lines.append(f"\n{p['reason'][:500]}")
    classification = " / ".join(x for x in (p["trust_mode"], p["rights_class"]) if x)
    if classification:
        lines.append(f"\nClassificazione suggerita dall'agente: {classification}")
    else:
        lines.append("\n(l'agente non ha suggerito una classificazione — richiede scelta manuale)")
    return "\n".join(lines)


def buttons(p: dict) -> dict:
    row1 = [
        {"text": "✅ Accetta", "callback_data": f"src:approve:{p['id']}"},
        {"text": "❌ Rifiuta", "callback_data": f"src:reject:{p['id']}"},
    ]
    row2 = [{"text": "🔍 Rivedi sul desk", "url": DESK_SOURCES_URL}]
    return {"inline_keyboard": [row1, row2]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--notify-test", action="store_true",
                    help="send a test Telegram message and exit, without touching the checkpoint")
    args = ap.parse_args()

    if args.notify_test:
        notify("Terraveler / notify_source_proposals.py: test notification — if you see this, "
               "the Telegram wiring works.")
        print("test notification sent (see stdout above for delivery status)")
        return 0

    state = load_state()
    conn = psycopg2.connect(**pg_params())
    try:
        if "audit_log" not in state:
            # Cold start: report nothing historical — same reasoning as the
            # other two notify_*.py scripts. Real pending proposals sitting
            # in the queue when this first runs are still visible on the
            # desk; this only watches for what happens next.
            with conn.cursor() as cur:
                cur.execute("select coalesce(max(id), 0) from audit_log")
                since = cur.fetchone()[0]
            state["audit_log"] = since
            save_state(state)
            print(f"cold start: checkpoint set to id {since}, nothing historical reported")
            return 0
        since = state["audit_log"]
        proposal_ids, max_id = fetch_proposal_ids(conn, since)
        proposals = fetch_proposal_detail(conn, proposal_ids)
    finally:
        conn.close()
    state["audit_log"] = max_id
    save_state(state)

    if not proposal_ids:
        print("no new source proposals")
        return 0

    # A proposal already resolved in the same 5-minute window (a human
    # acting from the desk before this poll ran) is skipped rather than
    # describing a queue entry that's no longer pending.
    for p in proposals:
        if p["status"] != "submitted":
            print(f"proposal #{p['id']} already {p['status']} — skipping notification")
            continue
        line = describe(p)
        print(line)
        notify(line, reply_markup=buttons(p))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
