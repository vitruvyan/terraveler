"""Oculus + Curator dry-run — show what the whitelist harvester finds for a
subject, then what the curator agent KEEPS vs DROPS. No embedding.

    python scout.py --subject "Lapérouse expedition"
"""
import argparse

import oculus
import curate
import fetch as F


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--subject", required=True)
    ap.add_argument("--lang", default="en")
    a = ap.parse_args()

    d = oculus.discover(a.subject, a.lang)
    cands = d["candidates"]
    print(f"\n════ OCULUS — subject: {a.subject!r} — {len(cands)} candidates (all on-whitelist)\n")

    verdicts = curate.judge(a.subject, cands)

    kept, dropped, total_chunks = [], [], 0
    print("── CURATOR AGENT DECISIONS ──")
    for c in cands:
        v = verdicts.get(c["id"], {"keep": False, "score": 0, "reason": "no verdict"})
        mark = "KEEP" if v["keep"] else "drop"
        print(f"   {mark} [{v.get('score','?')}] [{c['kind']}] {c['title'][:48]:48}  — {v['reason'][:46]}")
        (kept if v["keep"] else dropped).append(c)

    print(f"\n── FETCH/CHUNK the KEPT sources ({len(kept)}) ──")
    for c in kept:
        try:
            if c["kind"] == "gutenberg":
                body = F.fetch_gutenberg(c["url"])
            else:
                body = F.fetch_wikipedia(c["lang"], c["title"])
            n = len(F.chunk(body))
        except Exception as e:
            n = 0
            print(f"   !! {c['title'][:40]}: {str(e)[:60]}")
        print(f"   [{c['license'][:10]:10}] {c['title'][:52]:52} -> {n:4} chunks")
        total_chunks += n

    print("\n── IMAGES (Commons, PD/CC verified) ──")
    imgs = 0
    for term in d["image_terms"]:
        try:
            hits = F.commons_images(term, 4)
        except Exception:
            hits = []
        for im in hits:
            print(f"   [{im['license'][:20]:20}] {im['title'][:56]}")
        imgs += len(hits)

    print(f"\n════ RESULT: kept {len(kept)}/{len(cands)} sources "
          f"(~{total_chunks} chunks) + {imgs} images; dropped {len(dropped)} as noise ════\n")


if __name__ == "__main__":
    main()
