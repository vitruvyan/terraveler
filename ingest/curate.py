"""Curator agent (v1) — LLM-assisted source relevance filter.

The whitelist already guarantees LICENCE. This agent judges RELEVANCE: given a
subject and the candidate sources oculus surfaced, it keeps those primarily
about the subject and drops the tangential noise (off-topic Wikipedia hits).
Uses a cheap model (gpt-4o-mini). Every keep/drop is auditable (recorded as a
Decision/Rejection in the Axis trace).
"""
import os
import json
import urllib.request

KEY = os.getenv("OPENAI_API_KEY", "")

SYSTEM = (
    "You curate sources for a geo-historical encyclopedia entry about a SUBJECT "
    "(an expedition/voyage or an explorer). For EACH candidate, assign a relevance "
    "score 0-3 using this rubric:\n"
    "  3 = the subject itself, or its leader/commander (e.g. the explorer's own biography)\n"
    "  2 = a person, ship, place, or event that was PART OF the subject "
    "(a crew member, the expedition's ships, a leg of the voyage, a mission it carried out)\n"
    "  1 = mentions the subject only in passing / tangential\n"
    "  0 = unrelated, or shares only a name (e.g. a modern ship or street named after the explorer)\n"
    "Return STRICT JSON only: "
    '{"decisions":[{"id":<int>,"score":<0-3>,"reason":"<short>"}]}'
)


def judge(subject: str, candidates: list) -> dict:
    """candidates: [{id, kind, title, hint}]. Returns {id: {keep, reason}}."""
    if not KEY:
        raise RuntimeError("OPENAI_API_KEY not set")
    model = os.getenv("CURATOR_MODEL", "gpt-4.1")
    listing = "\n".join(
        f'{c["id"]}. [{c["kind"]}] {c["title"]} — {(c.get("hint") or "")[:180]}'
        for c in candidates)
    body = {
        "model": model, "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"SUBJECT: {subject}\n\nCANDIDATES:\n{listing}"},
        ],
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        content = json.load(r)["choices"][0]["message"]["content"]
    data = json.loads(content)
    out = {}
    for d in data.get("decisions", []):
        score = int(d.get("score", 0))
        out[int(d["id"])] = {"score": score, "keep": score >= 2,
                             "reason": d.get("reason", "")}
    return out
