"""terraveler_officers — the watch, in one hull.

The canonical pattern (vitruvyan-core, SERVICE_PATTERN.md) gives every
order its own service; at Terraveler's scale the orders share a container
and keep their own consumer groups, so extraction stays possible and the
VPS stays light. Three kinds of thread live here:

  relay       outbox -> wire        (relay.py)
  watches     wire -> officers      (dispatcher.py, one per commission)
  health      GET /health           (below; the ops watch reads this)

No business logic in this file — it starts threads and answers /health.
"""
import json
import logging
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psycopg2
import redis

import dispatcher
import relay
from config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger(settings.SERVICE_NAME)

STOP = threading.Event()
HEALTH: dict = {}
_BACKLOG_CACHE = {"ts": 0.0, "value": None, "error": None}
_BACKLOG_LOCK = threading.Lock()

# A watch's beat pauses for the whole of a handler run, and a legitimate
# desk pass fetches sources for minutes — so a watch is stale only past its
# handler timeout, while the relay answers to a tight clock. One threshold
# would either page on every healthy long run or miss a dead relay for
# fifteen minutes.
def _stale_after(key: str) -> float:
    if key.startswith("watch_beat:"):
        return settings.CURATOR_TIMEOUT_SECONDS + 120
    return 60


def _unpublished_count():
    """Cached, timeboxed, one connection at a time: /health must never be
    the thing that exhausts max_connections — it exists to report that
    somebody else did."""
    now = time.time()
    with _BACKLOG_LOCK:
        if now - _BACKLOG_CACHE["ts"] < settings.HEALTH_CACHE_SECONDS:
            return _BACKLOG_CACHE["value"], _BACKLOG_CACHE["error"]
        try:
            conn = psycopg2.connect(
                host=settings.PGHOST, port=settings.PGPORT,
                dbname=settings.PGDATABASE, user=settings.PGUSER,
                password=settings.PGPASSWORD, connect_timeout=3)
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "select count(*) from events where published_at is null")
                    _BACKLOG_CACHE.update(
                        ts=now, value=cur.fetchone()[0], error=None)
            finally:
                conn.close()
        except Exception as e:
            _BACKLOG_CACHE.update(
                ts=now, value=None, error=e.__class__.__name__)
        return _BACKLOG_CACHE["value"], _BACKLOG_CACHE["error"]


class Health(BaseHTTPRequestHandler):
    timeout = 10

    def do_GET(self):
        if self.path != "/health":
            self.send_response(404)
            self.end_headers()
            return
        now = time.time()
        beats = {k: round(now - v, 1) for k, v in HEALTH.items()}
        stale = [k for k, age in beats.items() if age > _stale_after(k)]
        expected = {"relay_beat"} | (
            set() if settings.MOORED
            else {f"watch_beat:{w.officer}" for w in dispatcher.watches(settings)})
        missing = sorted(expected - set(beats))
        stale += [f"never-beat:{k}" for k in missing]
        backlog, db_error = _unpublished_count()
        if db_error:
            stale.append(f"db:{db_error}")
        body = {
            "service": settings.SERVICE_NAME,
            "status": "healthy" if not stale else "degraded",
            "moored": settings.MOORED,
            "outbox_unpublished": backlog,
            "seconds_since_beat": beats,
            "stale": stale,
        }
        data = json.dumps(body).encode()
        self.send_response(200 if not stale else 503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):  # health polls are not news
        pass


def main():
    server = ThreadingHTTPServer(("0.0.0.0", settings.HEALTH_PORT), Health)

    def stop(*_):
        log.info("stopping")
        STOP.set()
        server.shutdown()

    # Registered before anything starts: a SIGTERM in the startup window
    # must stop cleanly, not kill threads mid-flight.
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    r = redis.Redis.from_url(settings.REDIS_URL)
    r.ping()
    log.info("redis reachable")

    threads = [threading.Thread(
        target=relay.run, args=(settings, r, STOP, HEALTH),
        name="relay", daemon=True)]
    if settings.MOORED:
        log.warning("MOORED: the relay ships, no officer stands watch "
                    "(Ship's Officers §2 — authority suspended, distribution intact)")
    else:
        for watch in dispatcher.watches(settings):
            threads.append(threading.Thread(
                target=dispatcher.run_watch,
                args=(settings, redis.Redis.from_url(settings.REDIS_URL),
                      watch, STOP, HEALTH),
                name=f"watch:{watch.officer}", daemon=True))
    for t in threads:
        t.start()
        log.info("started %s", t.name)

    threading.Thread(target=server.serve_forever, name="health",
                     daemon=True).start()
    while not STOP.is_set():
        time.sleep(1)
    for t in threads:
        t.join(timeout=10)
    log.info("stopped")


if __name__ == "__main__":
    main()
