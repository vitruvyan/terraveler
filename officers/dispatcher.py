"""The dispatcher — wire to officers. Deliberately boring (Ship's Officers §6).

One consumer group per officer, group:{officer} per the canonical Conclave.
The dispatcher validates the envelope, hands the event to the officer's
handler, acks on success, and leaves failures in the PEL — a sweep reclaims
them with XAUTOCLAIM, and the server's own delivery counter (XPENDING
times_delivered) decides when a message has had its chances and goes to the
dead-letter path. No in-process attempt ledger: a restart must not grant a
failing event a fresh set of retries.

A dead letter is recorded in audit_log (action 'dead-letter') and the
trigger derives the dlq.entry event from it — the ledger announces, this
process never writes to `events` directly. The DLQ's final consumer is the
Herald; its destination is the editor.

New consumer groups begin at "$": a watch begins at its conferral, not at
history. The outbox retains everything, so a deliberate backfill is always
possible later — but it is a decision the editor takes, never a side effect
of a container starting.
"""
import hashlib
import json
import logging
import subprocess
import sys
import time

import psycopg2
import psycopg2.extras

import telegram
from relay import channel_for

log = logging.getLogger("dispatcher")

CONSUMER = "officers-1"
ENVELOPE_REQUIRED = ("event_id", "ts", "stream", "type", "version", "actor",
                     "carta_version", "payload")
KNOWN_VERSIONS = {"v1"}


class Watch:
    """One officer's standing watch: a channel, a group, a handler."""

    def __init__(self, officer: str, stream: str, type_: str, handler):
        self.officer = officer
        self.group = f"group:{officer}"
        self.channel = channel_for(stream, type_)
        self.handler = handler


def _decode(raw: dict) -> dict:
    return {(k.decode() if isinstance(k, bytes) else k):
            (v.decode() if isinstance(v, bytes) else v)
            for k, v in raw.items()}


def envelope_error(fields: dict) -> str | None:
    """Consumer-side contract enforcement (§7), strict: an event the
    dispatcher cannot vouch for never seeds a run — it dead-letters."""
    missing = [k for k in ENVELOPE_REQUIRED if not fields.get(k)]
    if missing:
        return f"envelope missing {missing}"
    if fields["version"] not in KNOWN_VERSIONS:
        return f"unknown envelope version '{fields['version']}'"
    try:
        payload = json.loads(fields["payload"])
    except Exception as e:
        return f"payload is not JSON: {e}"
    if not isinstance(payload, dict):
        return "payload is not an object"
    return None


def _idempotency_key(channel: str, envelope_event_id: str, group: str) -> str:
    # Keyed on the ENVELOPE event_id, not the Redis entry id: a relay
    # re-ship gives the same logical event a new entry id, and the same
    # logical failure must produce the same key (contract invariant).
    return hashlib.sha256(
        f"{channel}:{envelope_event_id}:{group}".encode()).hexdigest()[:16]


def _dead_letter(cfg, watch, fields, reason, retry_count):
    """The fact recorded is the failure; the ledger announces it. A fresh
    connection on purpose — the handler's failure may have poisoned the
    watch's own, and a dead letter lost to an aborted transaction is a
    silence exactly where the design demands a noise."""
    payload = {
        "original_stream": watch.channel,
        "original_event_id": fields.get("event_id", "unknown"),
        "consumer_group": watch.group,
        "failure_reason": str(reason)[:500],
        "retry_count": retry_count,
        "idempotency_key": _idempotency_key(
            watch.channel, fields.get("event_id", "unknown"), watch.group),
    }
    sid = None
    try:
        sid = json.loads(fields.get("payload") or "{}").get("submission_id")
    except Exception:
        pass
    conn = psycopg2.connect(host=cfg.PGHOST, port=cfg.PGPORT,
                            dbname=cfg.PGDATABASE, user=cfg.PGUSER,
                            password=cfg.PGPASSWORD, connect_timeout=10)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "insert into audit_log (submission_id, actor, action, findings, carta_version)"
                " values (%s, 'dispatcher', 'dead-letter', %s, %s)",
                (sid, psycopg2.extras.Json(payload),
                 fields.get("carta_version", "unknown")))
        conn.commit()
    finally:
        conn.close()
    log.error("dead-lettered %s from %s after %d deliveries: %s",
              fields.get("event_id"), watch.channel, retry_count, reason)


def _handle_entries(cfg, conn, r, watch, entries) -> int:
    handled = 0
    for redis_id, raw in entries:
        if isinstance(redis_id, bytes):
            redis_id = redis_id.decode()
        fields = _decode(raw)
        err = envelope_error(fields)
        if err:
            _dead_letter(cfg, watch, fields, f"contract: {err}", 1)
            r.xack(watch.channel, watch.group, redis_id)
            continue
        try:
            watch.handler(cfg, conn, fields)
            r.xack(watch.channel, watch.group, redis_id)
            handled += 1
        except Exception as e:
            # Not acked: the entry stays in the PEL and the sweep will
            # reclaim it once idle. The connection may be poisoned —
            # roll it back so the next entry starts clean.
            log.warning("handler %s failed on %s: %s", watch.officer,
                        redis_id, e)
            try:
                conn.rollback()
            except Exception:
                pass
    return handled


def _sweep_pel(cfg, conn, r, watch):
    """Reclaim entries whose consumer stalled or failed. The server's
    times_delivered is the retry ledger — restart-stable, unforgeable
    from here."""
    try:
        resp = r.xautoclaim(watch.channel, watch.group, CONSUMER,
                            min_idle_time=cfg.PEL_MIN_IDLE_MS,
                            start_id="0-0", count=10)
        entries = resp[1] if isinstance(resp, (list, tuple)) and len(resp) > 1 else []
    except Exception as e:
        log.warning("xautoclaim failed on %s: %s", watch.channel, e)
        return
    for redis_id, raw in entries:
        if isinstance(redis_id, bytes):
            redis_id = redis_id.decode()
        if raw is None:
            # Entry trimmed out from under the PEL (MAXLEN) — nothing left
            # to run; the outbox still holds the durable record.
            r.xack(watch.channel, watch.group, redis_id)
            continue
        fields = _decode(raw)
        delivered = cfg.DLQ_MAX_RETRIES + 1
        try:
            pending = r.xpending_range(watch.channel, watch.group,
                                       min=redis_id, max=redis_id, count=1)
            if pending:
                delivered = pending[0].get("times_delivered", delivered)
        except Exception:
            pass
        if delivered > cfg.DLQ_MAX_RETRIES:
            _dead_letter(cfg, watch, fields,
                         "retries exhausted (see prior handler warnings)",
                         delivered)
            r.xack(watch.channel, watch.group, redis_id)
            continue
        _handle_entries(cfg, conn, r, watch, [(redis_id, raw)])


def run_watch(cfg, r, watch, stop, health):
    """One officer's consume loop. Everything — group creation, connection,
    consuming — lives inside the retry loop: a watch may degrade, it must
    never silently die. The beat is written every pass, so /health sees a
    stuck watch go stale rather than a dead one vanish."""
    health[f"watch_beat:{watch.officer}"] = time.time()
    conn = None
    last_sweep = 0.0
    while not stop.is_set():
        try:
            try:
                r.xgroup_create(watch.channel, watch.group, id="$",
                                mkstream=True)
                log.info("created %s on %s (from $ — a watch begins at its "
                         "conferral, not at history)", watch.group, watch.channel)
            except Exception as e:
                if "BUSYGROUP" not in str(e):
                    raise
            if conn is None or conn.closed:
                conn = psycopg2.connect(
                    host=cfg.PGHOST, port=cfg.PGPORT, dbname=cfg.PGDATABASE,
                    user=cfg.PGUSER, password=cfg.PGPASSWORD,
                    connect_timeout=10)
            while not stop.is_set():
                health[f"watch_beat:{watch.officer}"] = time.time()
                resp = r.xreadgroup(watch.group, CONSUMER,
                                    {watch.channel: ">"}, count=10, block=5000)
                if resp:
                    entries = resp[0][1]
                    if entries:
                        _handle_entries(cfg, conn, r, watch, entries)
                if time.time() - last_sweep > cfg.PEL_SWEEP_SECONDS:
                    _sweep_pel(cfg, conn, r, watch)
                    last_sweep = time.time()
        except Exception:
            log.exception("watch %s: pass failed; retrying in 5s", watch.officer)
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            conn = None
            stop.wait(5)
    if conn is not None:
        conn.close()


# ------------------------------------------------------------- the Curator
def curator_handler(cfg, conn, fields):
    """The Curator's watch: reviews.advanced says the dossier exists, so the
    desk rules. The officer IS scripts/desk_review.py — the same pass, the
    same §10.4 guard, the same escalation duty, whoever invokes it; this
    handler decides WHETHER to invoke it, never what it rules.

    Idempotency is two checks against canonical state, because delivery is
    at-least-once: a submission that left 'human-review' was ruled on, and
    one whose latest ledger row is the Curator's own escalation is already
    on the editor's desk — re-running would re-escalate the same draft on
    every redelivery, forever. The status transition itself is guarded a
    third time inside desk_review.py (conditional UPDATE), so even the
    race this check cannot see loses harmlessly."""
    payload = json.loads(fields.get("payload") or "{}")
    sid = payload.get("submission_id")
    if not sid:
        log.info("reviews.advanced without submission_id — nothing to rule on")
        return
    with conn.cursor() as cur:
        cur.execute("select status from submissions where id = %s", (sid,))
        row = cur.fetchone()
        cur.execute("select actor, verdict from audit_log where submission_id = %s"
                    " order by id desc limit 1", (sid,))
        last = cur.fetchone()
    conn.commit()
    if row is None:
        log.info("submission %s not found — skipping", sid)
        return
    if row[0] != "human-review":
        log.info("submission %s is '%s', not 'human-review' — already ruled, skipping",
                 sid, row[0])
        return
    if last is not None and last[0] == "curator-desk" and last[1] == "escalate":
        log.info("submission %s already escalated by the desk — the editor's, skipping", sid)
        return
    log.info("curator-desk waking on submission %s", sid)
    proc = subprocess.run(
        [sys.executable, f"{cfg.REPO}/scripts/desk_review.py", str(sid)],
        env={"PGHOST": cfg.PGHOST, "PGPORT": str(cfg.PGPORT),
             "PGDATABASE": cfg.PGDATABASE, "PGUSER": cfg.PGUSER,
             "PGPASSWORD": cfg.PGPASSWORD, "PATH": "/usr/local/bin:/usr/bin:/bin",
             "HOME": "/tmp", "PYTHONIOENCODING": "utf-8"},
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=cfg.CURATOR_TIMEOUT_SECONDS)
    if proc.returncode != 0:
        raise RuntimeError(
            f"desk_review.py exited {proc.returncode}: "
            f"{(proc.stderr or proc.stdout)[-400:]}")
    log.info("curator-desk ruled on submission %s:\n%s", sid, proc.stdout[-1500:])
    # A deliberate breath between rulings: verification hammers the same
    # archives the whole pipeline depends on, and a storm of events must
    # not become a storm of fetches.
    time.sleep(cfg.CURATOR_COOLDOWN_SECONDS)


def embedder_handler(cfg, conn, fields):
    """The Archivist (docs/SHIPS_OFFICERS.md §4.9): re-embed what the
    Publisher just shipped so the site's own RAG search/chat can answer
    questions about it. No idempotency check needed before running it —
    scripts/embed_published.py replaces its own prior rows for the voyage
    rather than accumulating them, so a redelivered event is harmless."""
    payload = json.loads(fields.get("payload") or "{}")
    sid = payload.get("submission_id")
    if not sid:
        log.info("submission.published without submission_id — nothing to embed")
        return
    log.info("archivist waking on submission %s", sid)
    proc = subprocess.run(
        [sys.executable, f"{cfg.REPO}/scripts/embed_published.py", str(sid)],
        env={"PGHOST": cfg.PGHOST, "PGPORT": str(cfg.PGPORT),
             "PGDATABASE": cfg.PGDATABASE, "PGUSER": cfg.PGUSER,
             "PGPASSWORD": cfg.PGPASSWORD, "PATH": "/usr/local/bin:/usr/bin:/bin",
             "HOME": "/tmp", "PYTHONIOENCODING": "utf-8"},
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=cfg.EMBEDDER_TIMEOUT_SECONDS)
    if proc.returncode != 0:
        raise RuntimeError(
            f"embed_published.py exited {proc.returncode}: "
            f"{(proc.stderr or proc.stdout)[-400:]}")
    log.info("archivist indexed submission %s:\n%s", sid, proc.stdout[-1500:])
    time.sleep(cfg.EMBEDDER_COOLDOWN_SECONDS)


DESK_URL = "https://www.terraveler.com/desk?tab=submissions"


def _findings_text(findings) -> str:
    """findings is the audit_log array-of-tuples shape,
    [[level, priority, text], ...] — join the text a human should read.
    Defensive on purpose: this composes a message for a human, and a
    malformed or unexpected shape must produce a plainer message, never
    an exception that drops the notification."""
    if not findings:
        return ""
    lines = []
    for row in findings:
        if isinstance(row, (list, tuple)) and len(row) >= 3:
            lines.append(str(row[2]))
        elif row:
            lines.append(str(row))
    return " ".join(lines)


def compose_herald_message(event_type: str, payload: dict) -> str | None:
    """The Herald composes what the ledger already decided into something a
    human can act on without opening a shell (§4.4) — it adds no judgment of
    its own. Returns None for anything it does not yet have a form for,
    which the handler treats as "nothing to deliver", not a failure."""
    if event_type == "escalation.raised":
        sid = payload.get("submission_id")
        why = _findings_text(payload.get("findings")) or "no reason recorded"
        return (f"\U0001F6A8 The Curator could not rule alone on submission "
                f"#{sid}: {why}\n{DESK_URL}")
    if event_type == "appeal.filed":
        sid = payload.get("submission_id")
        why = _findings_text(payload.get("findings")) or "no reason recorded"
        return (f"⚖️ Submission #{sid} was appealed: {why}\n{DESK_URL}")
    if event_type == "dlq.entry":
        stream = payload.get("original_stream", "unknown stream")
        reason = payload.get("failure_reason", "no reason recorded")
        retries = payload.get("retry_count", "?")
        return (f"☠️ An event on {stream} was dead-lettered after "
                f"{retries} attempts: {reason}")
    return None


# -------------------------------------------------------------- the Herald
def herald_handler(cfg, conn, fields):
    """The Herald's watch (docs/SHIPS_OFFICERS.md §4.4): report only. The
    judgment already happened in whatever ledger row produced this event —
    this composes it into a message and delivers it, nothing more.

    No idempotency guard against redelivery: a duplicate Telegram message on
    a PEL replay is a minor nuisance, and the one failure mode a Herald may
    never have is silently dropping a real escalation because a state check
    disagreed with the event. telegram.notify() raises on delivery failure,
    which is exactly what should leave this event unacked for the standard
    retry-then-dead-letter path."""
    payload = json.loads(fields.get("payload") or "{}")
    event_type = fields.get("type", "")
    text = compose_herald_message(event_type, payload)
    if text is None:
        log.info("herald: no message form for %s, skipping", event_type)
        return
    telegram.notify(cfg, text)
    with conn.cursor() as cur:
        cur.execute(
            "insert into audit_log (submission_id, actor, action, findings, carta_version)"
            " values (%s, 'herald', 'notify', %s, %s)",
            (payload.get("submission_id"),
             psycopg2.extras.Json([["INFO", 4, f"delivered {event_type}"]]),
             fields.get("carta_version") or "unknown"))
    conn.commit()
    log.info("herald delivered %s", event_type)


def watches(cfg):
    """The officers standing watch today. Growing this list is how the ship
    gains a watch — one Watch per commission in docs/SHIPS_OFFICERS.md §4,
    each behind its own consumer group so extraction stays possible."""
    return [
        Watch("curator-desk", "editorial", "reviews.advanced", curator_handler),
        Watch("archivist", "editorial", "submission.published", embedder_handler),
        Watch("herald", "editorial", "escalation.raised", herald_handler),
        Watch("herald", "editorial", "appeal.filed", herald_handler),
        Watch("herald", "ops", "dlq.entry", herald_handler),
    ]
