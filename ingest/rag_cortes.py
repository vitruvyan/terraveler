import urllib.request, json, subprocess
q = "What was La Noche Triste?"
req = urllib.request.Request("http://localhost:6002/v1/embeddings/create",
    data=json.dumps({"text": q}).encode(), headers={"Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req))
v = r["embedding"]; print("query embedding dim:", len(v))
lit = "[" + ",".join("%.6f" % x for x in v) + "]"
sql = ("select round((1-(embedding<=>'%s'))::numeric,3) sim, left(title,44) t "
       "from rag_docs where voyage_slug='cortes-1519' "
       "order by embedding<=>'%s' limit 5;") % (lit, lit)
out = subprocess.run(["docker","exec","terraveler_postgres","psql","-U","terraveler",
    "-d","terraveler","-c",sql], capture_output=True, text=True)
print(out.stdout or out.stderr)
# also confirm via the match_rag_docs function (what /chat uses)
sql2 = "select similarity, left(title,44) from match_rag_docs('%s'::vector, 5, 'cortes-1519');" % lit
out2 = subprocess.run(["docker","exec","terraveler_postgres","psql","-U","terraveler",
    "-d","terraveler","-c",sql2], capture_output=True, text=True)
print("via match_rag_docs():"); print(out2.stdout or out2.stderr)
