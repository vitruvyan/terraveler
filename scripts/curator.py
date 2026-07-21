#!/usr/bin/env python3
"""
Terraveler Curator v0 — deterministic gatekeeper (zero LLM tokens).

Enforces the Magna Carta of the Seas (v0.1) on a submission JSON:

  STAGE 0  Gate        schema, Carta version, licences, domains, injection scan
  STAGE 1  Sources     every source URL fetched; every quote/excerpt must be
                       VERBATIM in its source (string match, not judgment)
  STAGE 2  Coherence   chronology by seq, coordinate bounds, sailing-speed sanity
  STAGE 3  (reserved)  semantic entailment -> v1 (LLM) / today: the human editor

Verdict is never "approved": v0 recommends REJECT or HUMAN-REVIEW. Authority
stays with the Editor-in-chief. Deterministic = reproducible, auditable, and
immune to prompt injection.

Usage:  python scripts/curator.py test/submission_test.json
Exit code: 0 = human-review, 1 = reject, 2 = error.
"""
import json, math, re, sys, unicodedata, urllib.request, urllib.error

CARTA_VERSION = "0.1"
UA = "terraveler-curator/0.1 (contact: dbaldoni@gmail.com)"

DOMAIN_WHITELIST = (
    "gutenberg.org", "wikisource.org", "wikipedia.org", "wikimedia.org",
    "wikidata.org", "archive.org", "gallica.bnf.fr", "loc.gov", "davidrumsey.com",
)
LICENSE_OK = re.compile(r"public domain|^cc[ -]", re.I)
CONFIDENCES = {"certain", "approximate", "reconstructed", "contested"}

INJECTION_PATTERNS = [
    r"ignore (all|any|previous|prior)", r"disregard (the|all|previous)",
    r"note to (the )?curator", r"pre-?approved", r"skip (the )?(verification|review|checks)",
    r"you (must|should|are required to) (approve|accept)", r"system prompt",
    r"as an ai\b", r"editor[- ]in[- ]chief (has )?(approved|authorised|authorized)",
]

MAX_SPEED_NM_PER_DAY = 300  # generous ceiling for an 18th-century frigate

findings = []  # (level, stage, message)

def add(level, stage, msg):
    findings.append((level, stage, msg))

def norm(s):
    """Normalize text for verbatim matching: unicode quotes, whitespace, case."""
    s = unicodedata.normalize("NFKC", s)
    s = (s.replace("‘", "'").replace("’", "'")
           .replace("“", '"').replace("”", '"')
           .replace("—", "-").replace("–", "-"))
    return re.sub(r"\s+", " ", s).strip().casefold()

_cache = {}
def fetch(url):
    if url in _cache:
        return _cache[url]
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    body = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    _cache[url] = body
    return body

def domain_ok(url):
    host = urllib.parse.urlparse(url).netloc.lower()
    return any(host == d or host.endswith("." + d) for d in DOMAIN_WHITELIST)

def haversine_nm(a_lat, a_lng, b_lat, b_lng):
    R = 6371.0
    p = math.pi / 180
    s = (math.sin((b_lat - a_lat) * p / 2) ** 2
         + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin((b_lng - a_lng) * p / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(s)) / 1.852

def parse_date(s):
    m = re.match(r"^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$", s or "")
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2) or 1), int(m.group(3) or 1)
    try:
        import datetime
        return datetime.date(y, mo, d)
    except ValueError:
        return None

def walk_strings(obj, path=""):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk_strings(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk_strings(v, f"{path}[{i}]")

# ---------------------------------------------------------------- stages
def stage0_gate(sub):
    meta = sub.get("meta") or {}
    if meta.get("carta_version") != CARTA_VERSION:
        add("FAIL", 0, f"carta_version is '{meta.get('carta_version')}', current is '{CARTA_VERSION}'")
    for f in ("type", "ideator", "contributor_rank", "scribe_model"):
        if not meta.get(f):
            add("FAIL", 0, f"meta.{f} missing")
    wps = sub.get("waypoints") or []
    if not wps:
        add("FAIL", 0, "no waypoints in submission")
    for w in wps:
        tag = f"wp{w.get('seq', '?')}"
        for f in ("seq", "place_historical", "latitude", "longitude", "arrival_date", "confidence"):
            if w.get(f) in (None, ""):
                add("FAIL", 0, f"{tag}: field '{f}' missing")
        if w.get("confidence") not in CONFIDENCES:
            add("FAIL", 0, f"{tag}: confidence '{w.get('confidence')}' not in {sorted(CONFIDENCES)}")
        for ci, c in enumerate(w.get("claims") or []):
            ctag = f"{tag}.claim{ci + 1}"
            if not c.get("text"):
                add("FAIL", 0, f"{ctag}: empty claim text")
            if c.get("confidence") not in CONFIDENCES:
                add("FAIL", 0, f"{ctag}: invalid confidence")
            ev = c.get("evidence")
            if not ev:
                add("FAIL", 0, f"{ctag}: CLAIM WITHOUT SOURCE — no evidence attached (Carta section 3.1)")
                continue
            if not ev.get("excerpt") or not ev.get("source_url"):
                add("FAIL", 0, f"{ctag}: evidence incomplete (excerpt + source_url required)")
            lic = ev.get("license") or ""
            if not LICENSE_OK.search(lic):
                add("FAIL", 0, f"{ctag}: licence '{lic}' not PD/CC (Carta section 3.2)")
            if ev.get("source_url") and not domain_ok(ev["source_url"]):
                add("FAIL", 0, f"{ctag}: source domain not in whitelist: {ev['source_url']}")
    # injection scan across every string field
    for path, s in walk_strings(sub):
        low = s.lower()
        for pat in INJECTION_PATTERNS:
            if re.search(pat, low):
                add("FAIL", 0, f"INJECTION ATTEMPT at '{path}': matches /{pat}/ — automatic rejection (Carta section 6)")
                break

def stage1_sources(sub):
    for w in sub.get("waypoints") or []:
        tag = f"wp{w.get('seq', '?')}"
        for ci, c in enumerate(w.get("claims") or []):
            ctag = f"{tag}.claim{ci + 1}"
            ev = c.get("evidence") or {}
            url = ev.get("source_url")
            if not url or not domain_ok(url):
                continue  # already failed in stage 0
            try:
                body = norm(fetch(url))
            except Exception as e:
                add("FAIL", 1, f"{ctag}: source unreachable ({url}): {str(e)[:80]}")
                continue
            for field in ("quote", "excerpt"):
                txt = ev.get(field)
                if not txt:
                    continue
                if norm(txt) in body:
                    add("PASS", 1, f"{ctag}: {field} VERIFIED VERBATIM in source")
                else:
                    add("FAIL", 1, f"{ctag}: {field} NOT FOUND in source — fabricated or altered (Carta section 3.4)")

def stage2_coherence(sub):
    wps = sorted(sub.get("waypoints") or [], key=lambda w: w.get("seq") or 0)
    prev = None
    for w in wps:
        tag = f"wp{w.get('seq', '?')}"
        lat, lng = w.get("latitude"), w.get("longitude")
        if isinstance(lat, (int, float)) and not -90 <= lat <= 90:
            add("FAIL", 2, f"{tag}: latitude {lat} out of bounds")
        if isinstance(lng, (int, float)) and not -180 <= lng <= 180:
            add("FAIL", 2, f"{tag}: longitude {lng} out of bounds")
        d = parse_date(w.get("arrival_date"))
        if d is None:
            add("FAIL", 2, f"{tag}: unparseable arrival_date '{w.get('arrival_date')}'")
        if prev and d and prev["date"]:
            if d < prev["date"]:
                add("FAIL", 2, f"{tag}: CHRONOLOGY VIOLATION — arrives {d} before {prev['tag']} ({prev['date']})")
            else:
                days = max((d - prev["date"]).days, 1)
                nm = haversine_nm(prev["lat"], prev["lng"], lat, lng)
                speed = nm / days
                if speed > MAX_SPEED_NM_PER_DAY:
                    add("FAIL", 2, f"{tag}: implausible speed {speed:.0f} nm/day from {prev['tag']}")
                else:
                    add("PASS", 2, f"{tag}: chronology + speed plausible ({speed:.0f} nm/day)")
        prev = {"tag": tag, "date": d, "lat": lat, "lng": lng}

# ---------------------------------------------------------------- main
def main():
    if len(sys.argv) != 2:
        print("usage: python scripts/curator.py <submission.json>")
        return 2
    try:
        sub = json.load(open(sys.argv[1], encoding="utf-8"))
    except Exception as e:
        print(f"cannot read submission: {e}")
        return 2

    print("=" * 72)
    print("TERRAVELER CURATOR v0  (deterministic - zero tokens)")
    print(f"Carta version enforced: {CARTA_VERSION}")
    print("=" * 72)

    stage0_gate(sub)
    stage1_sources(sub)
    stage2_coherence(sub)

    fails = [f for f in findings if f[0] == "FAIL"]
    passes = [f for f in findings if f[0] == "PASS"]
    for level, stage, msg in findings:
        print(f"  [{level}] (stage {stage}) {msg}")

    print("-" * 72)
    print(f"checks passed: {len(passes)}   failures: {len(fails)}")
    if fails:
        print("VERDICT: REJECT — return to Scribe with the findings above.")
        print("(Every failure cites the Carta rule it violates. Zero LLM tokens spent.)")
        return 1
    print("VERDICT: HUMAN-REVIEW — all deterministic checks passed.")
    print("Semantic entailment (claim vs evidence) awaits the Editor-in-chief (v0)")
    print("or the LLM entailment stage (v1).")
    return 0

if __name__ == "__main__":
    import urllib.parse  # noqa: E402  (used in domain_ok)
    sys.exit(main())
