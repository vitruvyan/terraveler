import json, collections, re

SRC = "public/world_1715.geojson"

# The great powers of ~1715 (European AND Asian). First keyword match wins.
EMPIRES = [
    ("British",            ["united kingdom", "great britain", "(uk)", "british"]),
    ("French",             ["france", "french"]),
    ("Spanish",            ["spain", "spanish"]),
    ("Portuguese",         ["portugal", "portuguese", "brazil"]),
    ("Habsburg (Austria)", ["austrian", "habsburg"]),
    ("Dutch",              ["netherlands", "neterlands", "dutch"]),
    ("Russian (Muscovy)",  ["russia", "muscovy"]),
    ("Qing (Manchu)",      ["qing", "manchu", "china"]),
    ("Mughal",             ["mughal"]),
    ("Safavid (Persia)",   ["safavid", "persia"]),
    ("Ottoman",            ["ottoman", "egypt", "algiers", "tunis"]),
    ("Japan (Tokugawa)",   ["tokugawa", "japan"]),
]

def kw_match(text, kw):
    # word-start boundary for alpha keywords (so "russia" != "prussia");
    # plain substring for parenthetical tokens like "(uk)".
    if kw[0].isalpha():
        return re.search(r"(?<![a-z])" + re.escape(kw), text) is not None
    return kw in text

def classify(p):
    text = " | ".join([
        (p.get("NAME") or ""), (p.get("SUBJECTO") or ""), (p.get("PARTOF") or "")
    ]).lower()
    for empire, kws in EMPIRES:
        if any(kw_match(text, k) for k in kws):
            return empire
    return "Other"

d = json.load(open(SRC, encoding="utf-8"))
dist = collections.Counter()
members = collections.defaultdict(list)
for f in d["features"]:
    p = f.setdefault("properties", {})
    emp = classify(p)
    p["EMPIRE"] = emp
    dist[emp] += 1
    if emp != "Other":
        members[emp].append((p.get("NAME") or "").strip())

json.dump(d, open(SRC, "w", encoding="utf-8"), ensure_ascii=False)

lines = [f"features: {len(d['features'])}", ""]
for k, v in dist.most_common():
    lines.append(f"{v:4d}  {k}")
lines.append("\n=== members (non-Other) ===")
for emp, _ in EMPIRES:
    if members[emp]:
        lines.append(f"\n{emp}: " + ", ".join(sorted(set(members[emp]))))
open("scratch_empires.txt", "w", encoding="utf-8").write("\n".join(lines))
print("done")
