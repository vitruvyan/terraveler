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


def watches(cfg):
    """The officers standing watch today. Growing this list is how the ship
    gains a watch — one Watch per commission in docs/SHIPS_OFFICERS.md §4,
    each behind its own consumer group so extraction stays possible."""
    return [
        Watch("curator-desk", "editorial", "reviews.advanced", curator_handler),
    ]
