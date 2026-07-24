"""Verify the photo-association agent: assign each voyage photo to the waypoint
it illustrates (or none). gpt-4.1, one call. Dry-run — prints, writes nothing.
"""
import os
import json
import subprocess
import urllib.request

KEY = os.environ["OPENAI_API_KEY"]
MODEL = os.getenv("MATCH_MODEL", "gpt-4.1")
VOYAGE = os.getenv("VOYAGE", "boudeuse-1766")

wps = json.load(open("bougainville.json", encoding="utf-8"))["waypoints"]
WP = [{"seq": w["seq"],
       "place": w.get("place_historical") or w.get("place_modern"),
       "event": (w.get("event") or "")[:200]} for w in wps]

sql = (f"select json_agg(json_build_object('title',title,'caption',content,"
       f"'media_url',media_url)) from rag_docs where voyage_slug='{VOYAGE}' and type='image';")
out = subprocess.run(
    ["docker", "exec", "terraveler_postgres", "psql", "-U", "terraveler",
     "-d", "terraveler", "-t", "-A", "-c", sql],
    capture_output=True, text=True).stdout.strip()
photos = json.loads(out) or []
for i, p in enumerate(photos):
    p["id"] = i

wp_txt = "\n".join(f"seq {w['seq']}: {w['place']} — {w['event']}" for w in WP)
ph_txt = "\n".join(f'{p["id"]}: {p["title"]} — {(p.get("caption") or "")[:120]}' for p in photos)

SYSTEM = (
    "You associate historical photos with the waypoints (stops) of a voyage. For "
    "EACH photo, assign the single waypoint 'seq' it best illustrates, or null if it "
    "fits none (e.g. a generic portrait of the navigator, or an image tied to no "
    "specific stop). Be strict: only assign when the photo clearly depicts that "
    "place/event/person-at-that-stop. Return STRICT JSON: "
    '{"assignments":[{"photo_id":<int>,"seq":<int|null>,"reason":"<short>"}]}')
USER = f"WAYPOINTS:\n{wp_txt}\n\nPHOTOS:\n{ph_txt}"

body = {"model": MODEL, "temperature": 0, "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": USER}]}
req = urllib.request.Request(
    "https://api.openai.com/v1/chat/completions",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
res = json.loads(urllib.request.urlopen(req, timeout=90).read())["choices"][0]["message"]["content"]
data = json.loads(res)

seqmap = {w["seq"]: w["place"] for w in WP}
print(f"\n════ PHOTO → WAYPOINT associations ({MODEL}) — {len(photos)} photos ════\n")
for a in sorted(data.get("assignments", []), key=lambda x: (x.get("seq") is None, x.get("seq") or 0)):
    p = photos[a["photo_id"]]
    seq = a.get("seq")
    where = f"seq {seq} · {seqmap.get(seq, '?')}" if seq else "— none —"
    title = p["title"].replace("File:", "")[:46]
    print(f"  {title:46} ->  {where}")
    if a.get("reason"):
        print(f"  {'':46}     ({a['reason'][:64]})")
