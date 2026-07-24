"""Photo-association agent — per-waypoint Commons search + gpt-4.1 association.

For each waypoint: search Wikimedia Commons (PD/CC only) for images of that
place/event, then let gpt-4.1 pick up to 2 that genuinely depict it. Writes
`bougainville_media.json` = { seq: [ {url, caption, credit, source_url, license} ] }.
"""
import os
import re
import json
import urllib.request

import fetch as F

KEY = os.environ["OPENAI_API_KEY"]
MODEL = os.getenv("MATCH_MODEL", "gpt-4.1")

wps = json.load(open("bougainville.json", encoding="utf-8"))["waypoints"]


def search_term(w):
    p = w.get("place_historical") or w.get("place_modern") or ""
    return re.split(r"[(/]", p)[0].strip()


# gather PD/CC candidates per waypoint
pool = []
for w in wps:
    term = search_term(w)
    if not term:
        continue
    try:
        imgs = F.commons_images(term, 4)
    except Exception:
        imgs = []
    for im in imgs:
        if not im.get("img"):
            continue
        pool.append({"seq": w["seq"], "term": term, "title": im["title"],
                     "desc": (im.get("desc") or "")[:150], "url": im["img"],
                     "credit": im.get("credit"), "source_url": im.get("page"),
                     "license": im["license"]})
for i, c in enumerate(pool):
    c["id"] = i

wp_txt = "\n".join(f'seq {w["seq"]}: {search_term(w)} — {(w.get("event") or "")[:120]}' for w in wps)
cand_txt = ""
for w in wps:
    cs = [c for c in pool if c["seq"] == w["seq"]]
    if not cs:
        continue
    cand_txt += f'\nWaypoint seq {w["seq"]} ({search_term(w)}):\n'
    for c in cs:
        cand_txt += f'  id {c["id"]}: {c["title"].replace("File:", "")[:52]} — {c["desc"][:80]}\n'

SYSTEM = (
    "You attach historical photos to the waypoints (stops) of an 18th-century sea "
    "voyage. For each waypoint, choose UP TO 2 images FROM THAT WAYPOINT'S OWN "
    "candidate list that genuinely depict the place, its people, or the event — "
    "period-appropriate engravings, maps, or portraits preferred. Skip modern "
    "photographs of the place, unrelated images, and generic world maps. If none "
    "fit, assign none. Return STRICT JSON: "
    '{"media":[{"seq":<int>,"photo_ids":[<int>,...]}]}')
USER = f"WAYPOINTS:\n{wp_txt}\n\nCANDIDATES BY WAYPOINT:{cand_txt}"

body = {"model": MODEL, "temperature": 0, "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": USER}]}
req = urllib.request.Request(
    "https://api.openai.com/v1/chat/completions",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
res = json.loads(urllib.request.urlopen(req, timeout=120).read())["choices"][0]["message"]["content"]
data = json.loads(res)

byid = {c["id"]: c for c in pool}
media_by_seq = {}
for m in data.get("media", []):
    items = []
    for pid in m.get("photo_ids", []):
        c = byid.get(pid)
        if not c:
            continue
        items.append({"url": c["url"],
                      "caption": c["title"].replace("File:", "").rsplit(".", 1)[0],
                      "credit": c["credit"] or None, "source_url": c["source_url"],
                      "license": c["license"]})
    if items:
        media_by_seq[str(m["seq"])] = items

seqmap = {w["seq"]: search_term(w) for w in wps}
print(f"\n════ media[] per waypoint ({MODEL}) ════")
for seq in sorted(media_by_seq, key=int):
    print(f'\nseq {seq} · {seqmap.get(int(seq))}:')
    for it in media_by_seq[seq]:
        print(f'   - {it["caption"][:52]:52} [{it["license"][:12]}]')
json.dump(media_by_seq, open("bougainville_media.json", "w"), indent=2, ensure_ascii=False)
total = sum(len(v) for v in media_by_seq.values())
print(f"\nsaved bougainville_media.json — {total} images across {len(media_by_seq)} waypoints")
