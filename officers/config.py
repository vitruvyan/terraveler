"""All env vars, centralized — no os.getenv scattered across files.

The shape follows vitruvyan-core's SERVICE_PATTERN.md (config.py as the
single source of environment), at Terraveler's scale: one hull for all
the officers instead of one service per order.
"""
import os


class Settings:
    SERVICE_NAME = "terraveler_officers"
    REDIS_URL = os.getenv("REDIS_URL", "redis://terraveler_redis:6379")
    PGHOST = os.getenv("PGHOST", "terraveler_postgres")
    PGPORT = int(os.getenv("PGPORT", "5432"))
    PGDATABASE = os.getenv("PGDATABASE", "terraveler")
    PGUSER = os.getenv("PGUSER", "terraveler")
    PGPASSWORD = os.getenv("PGPASSWORD", "")
    REPO = os.getenv("REPO", "/repo")
    RELAY_POLL_SECONDS = float(os.getenv("RELAY_POLL_SECONDS", "2"))
    RELAY_BATCH = int(os.getenv("RELAY_BATCH", "100"))
    DLQ_MAX_RETRIES = int(os.getenv("DLQ_MAX_RETRIES", "3"))
    CURATOR_TIMEOUT_SECONDS = int(os.getenv("CURATOR_TIMEOUT_SECONDS", "900"))
    CURATOR_COOLDOWN_SECONDS = float(os.getenv("CURATOR_COOLDOWN_SECONDS", "10"))
    # A failed entry sits in the PEL until idle this long, then the sweep
    # reclaims it; the server's times_delivered decides when it is spent.
    PEL_MIN_IDLE_MS = int(os.getenv("PEL_MIN_IDLE_MS", "60000"))
    PEL_SWEEP_SECONDS = float(os.getenv("PEL_SWEEP_SECONDS", "30"))
    HEALTH_PORT = int(os.getenv("HEALTH_PORT", "8080"))
    HEALTH_CACHE_SECONDS = float(os.getenv("HEALTH_CACHE_SECONDS", "10"))
    # Mooring (Ship's Officers §2): OFFICERS_MOORED=1 keeps the relay
    # shipping but starts no watches — authority suspended, distribution
    # intact. The switch exists so mooring is a decision, not a docker stop.
    MOORED = os.getenv("OFFICERS_MOORED", "0").strip().lower() in {"1", "true", "yes"}
    # Streams trim at ~100k approximate (canonical Conclave default). The
    # outbox is the durable record; the stream is a projection of it.
    STREAM_MAXLEN = int(os.getenv("STREAM_MAXLEN", "100000"))


settings = Settings()
