import urllib.request, json, subprocess
QS = ["Why was Tahiti called New Cythera?", "Who was Jeanne Barret?", "What happened at the Strait of Magellan?"]
for q in QS:
    req = urllib.request.Request("http://localhost:6002/v1/embeddings/create",
        data=json.dumps({"text": q}).encode(), headers={"Content-Type": "application/json"})
    v = json.load(urllib.request.urlopen(req))["embedding"]
    lit = "[" + ",".join(f"{x:.6f}" for x in v) + "]"
    sql = ("select round((1-(embedding<=>'%s'))::numeric,3) sim, type, "
           "left(title,46) title from rag_docs where voyage_slug='boudeuse-1766' "
           "order by embedding<=>'%s' limit 5;") % (lit, lit)
    out = subprocess.run(["docker","exec","terraveler_postgres","psql","-U","terraveler",
        "-d","terraveler","-c",sql], capture_output=True, text=True)
    print("Q:", q)
    print(out.stdout or out.stderr)
