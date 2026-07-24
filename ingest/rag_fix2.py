import urllib.request, json, subprocess
req = urllib.request.Request("http://localhost:6002/v1/embeddings/create",
    data=json.dumps({"text": "What was La Noche Triste?"}).encode(), headers={"Content-Type": "application/json"})
v = json.load(urllib.request.urlopen(req))["embedding"]
lit = "[" + ",".join("%.6f" % x for x in v) + "]"
def run(setup):
    sql = setup + ("select similarity::numeric(5,3), left(title,40) t from match_rag_docs('%s'::vector, 5, 'cortes-1519');" % lit)
    o = subprocess.run(["docker","exec","terraveler_postgres","psql","-U","terraveler","-d","terraveler","-c",sql],
        capture_output=True, text=True)
    return (o.stdout or o.stderr)
print("=== DEFAULT ==="); print(run(""))
print("=== iterative_scan=relaxed_order ==="); print(run("set hnsw.iterative_scan=relaxed_order; "))
print("=== exact (no index) ==="); print(run("set enable_indexscan=off; set enable_bitmapscan=off; "))
