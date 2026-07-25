# Historical basemaps — provenance and how to add an era

The political overlays in `public/world_*.geojson` come from
**[aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps)**,
licensed **CC BY-SA 4.0**. Attribution is shown on the map itself (the note
under the Cartographer layer links back to the source).

## What was changed

Nothing in the data. The bundled files are the upstream `geojson/world_<year>.geojson`
with exactly two mechanical edits:

1. **Coordinates rounded to 3 decimals** (~110 m — far finer than a world
   political overlay resolves), which roughly halves each file. A 1.9 MB
   download on a phone is a real cost; the precision is not.
2. **Whitespace stripped** from the JSON.

No properties are added. An earlier version of `world_1715.geojson` carried a
derived `EMPIRE` field baked in by a script that no longer exists; it was
replaced with the pristine upstream file, and the great-power assignment now
lives in `lib/historical-maps.ts` where it can be reviewed and versioned like
any other editorial decision. (The code rules were verified to reproduce that
baked field exactly: 758 features, 0 divergences.)

## Adding an era

```bash
YEAR=1650
curl -sO "https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_${YEAR}.geojson"
python3 - "$YEAR" <<'EOF'
import json, sys
y = sys.argv[1]
def rnd(o):
    if isinstance(o, list): return [rnd(x) for x in o]
    if isinstance(o, float): return round(o, 3)
    return o
d = json.load(open(f"world_{y}.geojson"))
for f in d["features"]:
    f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
json.dump(d, open(f"public/world_{y}.geojson", "w"), separators=(",", ":"))
EOF
```

Then add an entry to `EPOCHS` in `lib/historical-maps.ts`: the year, the file,
a one-line blurb, and that era's great powers. Naming conventions differ
between files — 1715 says `United Kingdom`, 1783 says `UK`; 1715 contains the
misspelling `Neterlands` — so check the actual values before writing the
`match` lists:

```bash
python3 -c "
import json; d=json.load(open('public/world_1650.geojson'))
vals={f['properties'].get(k) for f in d['features'] for k in ('SUBJECTO','NAME')}
print(sorted(v for v in vals if v))" | head -60
```

Voyages pick their era automatically (`epochFor`, nearest by start date), so
nothing else needs editing — but do check which voyages move: adding 1650
would pull any voyage starting before ~1682 off the 1530 map.

## Known upstream quirks

The reconstructions are approximate by nature and the project says so. Some
attributions are debatable — in `world_1783`, Quebec and Louisiana are still
marked French although both had changed hands by 1763. We render the source
faithfully rather than silently correcting it, and the map carries the
standing caveat: *"A reconstruction; precision varies."*
