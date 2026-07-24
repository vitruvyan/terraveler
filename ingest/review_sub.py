import json, sys
d = json.load(open("/app/out/cook-1768.submission.json"))
wps = d.get("waypoints") or d.get("voyage",{}).get("waypoints") or []
print("waypoints:", len(wps))
print("%-3s %-26s %-18s %-13s %s" % ("seq","place","coord","confidence","quote?"))
for w in wps:
    seq = w.get("seq")
    place = (w.get("place_historical") or w.get("place_modern") or "")[:26]
    lat = w.get("latitude"); lng = w.get("longitude")
    coord = f"{lat:.2f},{lng:.2f}" if isinstance(lat,(int,float)) else "—"
    conf = w.get("confidence","")
    claims = w.get("claims") or []
    q = ""
    for c in claims:
        for e in (c.get("evidence") or []):
            if e.get("quote"): q = e["quote"][:40]; break
        if q: break
    if not q and w.get("diary_excerpt"): q = w["diary_excerpt"][:40]
    prov = w.get("coord_provenance") or w.get("geocode_provenance") or ""
    print("%-3s %-26s %-18s %-13s %s" % (seq, place, coord, conf, ("«"+q+"…»") if q else "—"))
    if prov: print("       prov:", prov)
