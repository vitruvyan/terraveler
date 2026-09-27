"""The Herald's one delivery channel today (docs/SHIPS_OFFICERS.md §4.4).

Deliberately the same wire call as scripts/notify_curator_verdicts.py — not
imported from there, because that script lives outside this image (see
Dockerfile: only officers/*.py is copied in) and is invoked by cron against
audit_log directly, a different transport for a different trigger (temporal,
not causal — Ship's Officers §5).

notify() raises rather than swallowing a failure: a delivery that did not
happen is not "recorded", so the caller must not ack the event. Raising
leaves it in the PEL, and the dispatcher's own retry-then-dead-letter
machinery (already built for every other officer) is what a real Telegram
outage should hit, not a second, bespoke retry policy here.
"""
import urllib.parse
import urllib.request


def notify(cfg, text: str) -> None:
    token = getattr(cfg, "TELEGRAM_TOKEN", "")
    chat_id = getattr(cfg, "TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        raise RuntimeError("TELEGRAM_TOKEN/TELEGRAM_CHAT_ID not configured")
    body = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        if r.status != 200:
            raise RuntimeError(f"Telegram delivery failed: HTTP {r.status}")
