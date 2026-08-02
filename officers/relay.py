"""The relay — outbox to wire.

The ledger announces (supabase/events_outbox.sql writes the `events` row in
the same transaction as the audit fact) and this loop carries: rows with
published_at null are XADDed to their channel and stamped. The bus never
hears an event the database did not commit first, because the row IS the
commit.

Delivery is at-least-once by design: a crash between the XADD and the stamp
re-ships that one row on restart, and every consumer is idempotent by
event_id (docs/SHIPS_OFFICERS.md §5). The alternative — stamp first, ship
second — could lose an event forever, and a bus that forgets is worse than
a bus that repeats.

Channel naming is the canonical Conclave's, derived from the row:
terraveler:{stream}:{type} — except dead letters, which the design names as
one stream, terraveler:dlq, whatever their origin.
"""
import json
import logging
import time

import psycopg2
import psycopg2.extras

log = logging.getLogger("relay")

ENVELOPE_FIELDS = ("event_id", "ts", "stream", "type", "version", "actor",
                   "causation_id", "correlation_id", "trace_id", "carta_version")


def channel_for(stream: str, type_: str) -> str:
    if type_ == "dlq.entry":
        return "terraveler:dlq"
    return f"terraveler:{stream}:{type_}"


def connect(cfg):
    return psycopg2.connect(
        host=cfg.PGHOST, port=cfg.PGPORT, dbname=cfg.PGDATABASE,
        user=cfg.PGUSER, password=cfg.PGPASSWORD)


def ship_batch(cfg, conn, r) -> int:
    """Ship up to RELAY_BATCH unpublished rows. One commit per row, so a
    crash costs at most one duplicate on the wire, never a hole."""
    shipped = 0
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select id, event_id, ts, stream, type, version, actor,"
            "       causation_id, correlation_id, trace_id, carta_version, payload"
            "  from events where published_at is null order by id limit %s",
            (cfg.RELAY_BATCH,))
        rows = cur.fetchall()
    for row in rows:
        fields = {}
        for k in ENVELOPE_FIELDS:
            v = row[k]
            if v is not None:
                fields[k] = v.isoformat() if hasattr(v, "isoformat") else str(v)
        fields["payload"] = json.dumps(row["payload"], ensure_ascii=False)
        r.xadd(channel_for(row["stream"], row["type"]), fields,
               maxlen=cfg.STREAM_MAXLEN, approximate=True)
        with conn.cursor() as cur:
            cur.execute("update events set published_at = now() where id = %s",
                        (row["id"],))
        conn.commit()
        shipped += 1
        log.info("shipped %s #%s -> %s", row["type"], row["event_id"],
                 channel_for(row["stream"], row["type"]))
    return shipped


def run(cfg, r, stop, health):
    conn = None
    consecutive_failures = 0
    while not stop.is_set():
        try:
            if conn is None or conn.closed:
                conn = connect(cfg)
            n = ship_batch(cfg, conn, r)
            consecutive_failures = 0
            health["relay_beat"] = time.time()
            if n == 0:
                stop.wait(cfg.RELAY_POLL_SECONDS)
        except Exception:
            # Ship-then-stamp means a stamp that keeps failing would re-ship
            # the same rows forever; the backoff grows so a persistent fault
            # trickles duplicates instead of storming them, and /health goes
            # stale (no beat) so the fault is seen rather than absorbed.
            consecutive_failures += 1
            wait = min(5 * (2 ** min(consecutive_failures, 5)), 300)
            log.exception("relay pass failed (%d in a row); retrying in %ss",
                          consecutive_failures, wait)
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            conn = None
            stop.wait(wait)
    if conn is not None:
        conn.close()
