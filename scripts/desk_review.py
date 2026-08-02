#!/usr/bin/env python3
"""The Curator's verdict pass over the review queue.

    python3 scripts/desk_review.py                 # everything awaiting a verdict
    python3 scripts/desk_review.py 21 22 23        # named submissions
    python3 scripts/desk_review.py --dry-run       # report, record nothing
    python3 scripts/desk_review.py --json          # machine-readable, for an agent

Why this exists
---------------
Carta §2 gives the Curator the power to issue `approved | rejected |
changes-requested`, and §5 makes every verdict motivated, cited and appealable
to the Editor-in-chief. That was written down and never built, so in practice
the human signed every verdict — and by submission twenty-six he was signing
them without reading, because there is no way to read twenty-six drafts and no
information in the queue to read them *with*.

A human rubber-stamping is strictly worse than a declared automatic gate. It
looks like scrutiny, produces an audit row that says a person ruled, and checks
nothing. So this makes the Curator's authority operative and honest: the
verdicts it gives are recorded under its own name, with every finding attached,
and the editor keeps the final word through override and appeal.

What it will and will not decide
--------------------------------
Everything here is mechanical. A quotation either is in its source or is not; a
date either falls inside the voyage or does not; a licence either permits
ingestion or does not. Those are checks, not judgements, and a machine should
make them.

What it deliberately does NOT decide is whether an excerpt is the traveller's
account or the editor's commentary on it — the failure that put four footnotes
into Xuanzang, one of them describing a different pilgrim two centuries earlier.
That distinction is semantic, no cheap signal has ever caught it here (see
docs/LIBRARY_QUEUE.md for three attempts that failed), and a confident wrong
answer is worse than none. Those go to `escalate`, with the passage quoted, for
something that can read.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import datetime
import hashlib
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ingest"))

import psycopg2                                            # noqa: E402
import psycopg2.extras                                     # noqa: E402
from verbatim import UnverifiableSource, locate_in_source, norm, source_text                # noqa: E402
from whitelist import verify_source                        # noqa: E402

CARTA = ""          # set in main(), stamped into every verified span


def _stamp() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


UA = "terraveler-desk/1.0 (contact: dbaldoni@gmail.com)"
ACTOR = "curator-desk"
EVIDENCE_BASIS = {"contemporary-journal", "contemporary-testimony",
                  "later-chronicle", "reconstructed"}
CONFIDENCE = {"certain", "approximate", "reconstructed", "contested"}
# Reviews a draft needs before it may advance to a verdict. Mirrors
# REVIEWS_TO_ADVANCE in app/api/mcp/route.ts:313 — this script has no import
# path to the Next.js source at runtime, so the number is copied rather than
# shared, and the two must be kept in step by hand if the Carta's review
# requirement ever changes.
REVIEWS_TO_ADVANCE = 2
# Cap on a single source fetch. Verification runs unattended under the
# officers' watch; a djvu scan is tens of MB, a book is a few — anything
# beyond this is not a source we can locate a span in at this scale.
MAX_FETCH_BYTES = 30 * 1024 * 1024


def carta_version() -> str:
    m = re.search(r"Editorial Constitution — v(\d+\.\d+)",
                  (ROOT / "MAGNA_CARTA.md").read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("MAGNA_CARTA.md has no version line — refusing to guess")
    return m.group(1)


def connect():
    env = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "127.0.0.1"),
        port=int(os.environ.get("PGPORT", "6000")),
        dbname=os.environ.get("PGDATABASE", "terraveler"),
        user=os.environ.get("PGUSER", "terraveler"),
        password=os.environ.get("PGPASSWORD") or env.get("POSTGRES_PASSWORD", ""),
    )


_cache: dict[str, str] = {}


def fetch(url: str) -> str:
    """The readable text of a source, cached. What counts as readable is
    verbatim.readable_text, which both gates share — and which keys on the
    server's Content-Type rather than on the presence of an angle bracket."""
    if url in _cache:
        return _cache[url]
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        # The whitelist was checked against the URL we asked for; urlopen
        # follows redirects, so the guarantee must be re-established against
        # the URL that answered. A whitelisted host that open-redirects
        # off-list would otherwise bind PD/CC provenance to a body some
        # other server chose. And the read is capped: this runs unattended
        # now, and an unbounded r.read() on a shared VPS is an OOM with a
        # contributor's name on the trigger.
        final = r.geturl()
        if final != url:
            ok, why = verify_source(final)
            if not ok:
                raise UnverifiableSource(
                    f"redirected off-whitelist: {url} -> {final} ({why})")
        raw = r.read(MAX_FETCH_BYTES + 1)
        if len(raw) > MAX_FETCH_BYTES:
            raise UnverifiableSource(
                f"source larger than {MAX_FETCH_BYTES >> 20}MB: {url}")
        body = raw.decode("utf-8", "replace")
        ctype = r.headers.get("Content-Type", "")
    _cache[url] = source_text(body, ctype)
    return _cache[url]


class Findings:
    """Everything the pass noticed, in the shape the audit log stores."""

    def __init__(self) -> None:
        self.rows: list[list] = []

    def add(self, level: str, where: str, what: str) -> None:
        self.rows.append([level, 0, f"{where}: {what}"])

    def fail(self, where, what): self.add("FAIL", where, what)
    def warn(self, where, what): self.add("WARN", where, what)
    def note(self, where, what): self.add("INFO", where, what)
    def escalate(self, where, what): self.add("ESCALATE", where, what)

    def count(self, level: str) -> int:
        return sum(1 for r in self.rows if r[0] == level)


def check_shape(payload: dict, f: Findings, carta: str) -> None:
    meta = payload.get("meta") or {}
    voyage = payload.get("voyage") or {}
    drafted_under = meta.get("carta_version")
    if drafted_under != carta:
        # A draft is not at fault for being older than the constitution — the
        # Carta moves and a queue takes days. What matters is whether the
        # amendment changed something this draft depends on. v0.5 changed what
        # a quotation IS, so a draft built before it carries text a scribe
        # retyped rather than a span copied from the source, and the quotation
        # check below will say so line by line. Anything else is a note.
        material = drafted_under and drafted_under < "0.5" <= carta
        (f.fail if material else f.note)(
            "meta",
            f"drafted under Carta v{drafted_under}, in force is v{carta}"
            + (" — v0.5 changed what a quotation is: these were transcribed by the "
               "scribe rather than copied out of the source, so the draft must be "
               "regenerated rather than edited" if material else
               " — no clause this draft depends on changed"))
    basis = voyage.get("evidence_basis")
    if basis not in EVIDENCE_BASIS:
        f.fail("voyage", f"evidence_basis {basis!r} is not one of {sorted(EVIDENCE_BASIS)}")
    if not (voyage.get("what_was_lost") or "").strip():
        f.fail("voyage", "what_was_lost is empty — Carta 3.6 requires a voyage to say "
                         "what the archive does not hold")
    if not payload.get("waypoints"):
        f.fail("waypoints", "no waypoints — a voyage with no itinerary is not a voyage")


def check_chronology(waypoints: list, f: Findings) -> None:
    prev = None
    for w in waypoints:
        d = (w.get("arrival_date") or "")[:10]
        if not d:
            continue
        if prev and d < prev[0]:
            f.warn(f"wp{w.get('seq')}",
                   f"dated {d} but follows wp{prev[1]} dated {prev[0]} — a stage out of "
                   f"order needs an editorial decision, not a guess")
        prev = (d, w.get("seq"))


def check_quotations(waypoints: list, f: Findings, basis: str | None = None,
                     verified: dict | None = None) -> dict:
    """The heart of it. Every quotation is re-located in its live source, and
    the submitted text must equal the span the source actually holds.

    Equality is the point. It is not enough for the passage to exist: under
    Carta 3.4 the published text IS the source's own span, so a draft carrying
    a quotation the model retyped — however faithfully — is not publishable,
    it is merely close. Drafts built before that rule fail here, which is what
    this pass is for."""
    stats = {"quoted": 0, "verified": 0, "unreachable": 0, "mismatched": 0, "absent": 0}
    for w in waypoints:
        for ci, c in enumerate(w.get("claims") or [], 1):
            ev = c.get("evidence") or {}
            quote = ev.get("quote")
            if not quote:
                continue
            stats["quoted"] += 1
            where = f"wp{w.get('seq')}.claim{ci}"
            url = ev.get("source_url")
            if not url:
                f.fail(where, "a quotation with no source_url")
                stats["absent"] += 1
                continue
            ok, why = verify_source(url)
            if not ok:
                f.fail(where, f"source refused by the licence gate: {why}")
                continue
            try:
                body = fetch(url)
            except UnverifiableSource as e:
                f.fail(where, f"cannot be verified: {e}")
                stats["absent"] += 1
                continue
            except Exception as e:
                f.warn(where, f"source unreachable ({url}): {str(e)[:90]} — not a verdict "
                              f"on the quotation, a verdict on the network")
                stats["unreachable"] += 1
                continue
            raw, reading, transformations = locate_in_source(quote, body)
            if raw is not None and verified is not None:
                # The materialised span. Everything downstream reads THIS and
                # never the contributor's text — which is the only way the
                # guarantee survives a path that does not run the pipeline.
                verified[f"{w.get('seq')}.{ci}"] = {
                    "raw_span": raw,
                    "reading_span": reading,
                    "transformations": transformations,
                    "source_url": url,
                    "source_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
                    "start_offset": body.find(raw),
                    "length": len(raw),
                    "verified_at": _stamp(),
                    "carta_version": CARTA,
                }
            if raw is None:
                f.fail(where, f"NOT FOUND in the live source — fabricated or altered "
                              f"(Carta 3.4). Offered: {quote[:90]!r}")
                stats["absent"] += 1
            elif norm(quote) != norm(reading):
                f.fail(where, "found in the source but not as submitted. The published text "
                              "must be the source's own span (Carta 3.4), and this was "
                              f"transcribed. Source has {reading[:80]!r}, draft has "
                              f"{quote[:80]!r}")
                stats["mismatched"] += 1
            else:
                stats["verified"] += 1
                # Verbatim and in the source is not the same as being the
                # traveller speaking. No cheap signal has ever separated an
                # account from a commentary on it here, so this is flagged for
                # something that can read rather than guessed at.
                # Only where a traveller's own log survives. On a voyage whose
                # evidence basis is a later chronicle, third person is not a
                # warning sign — it is the whole nature of the source, and
                # escalating every line of Cabot would bury the real ones.
                # A span that crosses a page break drags the running head and
                # the page number in with it. Verbatim, and not a sentence.
                if re.search(r"\n\s*\n[^\n]{0,60}\b\d{1,4}\b[^\n]{0,60}\n\s*\n", raw):
                    f.escalate(where, "the span crosses a page break and carries the running "
                                      "head or page number into the quotation — verbatim, and "
                                      "not something a reader should be shown")
                # A chapter-contents line. Verbatim, inside the narrative
                # range, in English, naming the right place — and it proves
                # nothing, because it is the book's own summary of what the
                # chapter contains. Two reached a draft of Mungo Park and only
                # a reader caught them; the mechanical checks had no reason to
                # object to any of it.
                #
                # ESCALATE and never FAIL. docs/LIBRARY_QUEUE.md records three
                # attempts to separate apparatus from account by pattern, all
                # of which failed, and this is a narrower signal rather than a
                # solution to that problem.
                flat = " ".join(reading.split())
                dashes = flat.count("—") + flat.count("--")
                # Case-insensitive, or a sentence opening with "We sailed from
                # Portsmouth" reads as nobody speaking — which it did, and the
                # escalation it produced was noise that would have taught a
                # reader to skim these.
                first_person = re.search(r"\b(I|we|my|our|us|me)\b", flat, re.I)
                if dashes >= 1 and not first_person and len(flat) > 40:
                    f.escalate(where,
                        "reads like a chapter-contents line rather than narrative — "
                        "fragments joined by dashes, nobody speaking. Verbatim and in "
                        f"the source, and it may still prove nothing: {flat[:110]!r}")
                if (basis == "contemporary-journal" and len(quote) > 40
                        and not first_person):
                    f.escalate(where, f"verbatim, but nobody in it speaks in the first "
                                      f"person, on a voyage whose own journal survives — "
                                      f"check this is the traveller and not the editor "
                                      f"annotating him: {reading[:110]!r}")
    return stats


def check_confidence(waypoints: list, f: Findings) -> None:
    for w in waypoints:
        if w.get("confidence") not in CONFIDENCE:
            f.fail(f"wp{w.get('seq')}", f"confidence {w.get('confidence')!r} is not one of "
                                        f"{sorted(CONFIDENCE)}")
        quoted = any((c.get('evidence') or {}).get('quote') for c in (w.get("claims") or []))
        if quoted and w.get("confidence") == "reconstructed":
            f.warn(f"wp{w.get('seq')}", "carries a verbatim quotation but is marked "
                                        "reconstructed — one of the two is wrong")


def review(sub: dict, carta: str) -> dict:
    f = Findings()
    payload = sub["payload"] or {}
    waypoints = payload.get("waypoints") or []
    check_shape(payload, f, carta)
    check_confidence(waypoints, f)
    check_chronology(waypoints, f)
    verified: dict = {}
    stats = check_quotations(waypoints, f,
                             (payload.get("voyage") or {}).get("evidence_basis"), verified)

    if f.count("FAIL"):
        verdict, why = "changes", "findings must be answered before this can be published"
    elif f.count("ESCALATE"):
        verdict, why = "escalate", "clean on every mechanical check; needs a reader"
    elif stats["unreachable"]:
        verdict, why = "escalate", "a source could not be reached — retry before ruling"
    elif not stats["verified"] and stats["quoted"]:
        verdict, why = "changes", "no quotation could be verified"
    else:
        verdict, why = "approve", "every mechanical check passed"
    return {"id": sub["id"], "target": sub["target_voyage"], "type": sub["type"],
            "verdict": verdict, "reason": why, "stats": stats,
            "findings": f.rows, "verified_spans": verified}


def record(cur, res: dict, carta: str) -> None:
    status = {"approve": "approved", "changes": "changes-requested",
              "reject": "rejected"}.get(res["verdict"])
    if status == "approved":
        # Carta §10.4: "the editor rules with the reviewers' dossier in
        # hand." The web desk enforces this on its own path
        # (app/api/desk/verdict/route.ts) but this pass had none — it could
        # compute "approve" from the mechanical checks alone and write
        # status='approved' straight out of 'peer-review' with zero reviews
        # recorded, which is the exact violation the web desk exists to
        # refuse. The guard lives here, in the one function every caller of
        # this script goes through to write a verdict, so no future caller
        # can approve around it.
        # And the dossier is read, not counted. Two Scribes both refuting a
        # claim against its sources is precisely the case §10.4 exists for —
        # the quotation can be verbatim in the source while the source's words
        # belong to an editor and not the traveller, which no mechanical check
        # here can see. A cardinality check would have approved over their
        # objection; a refutation is a reader's finding, and weighing one is
        # a reader's job.
        cur.execute("select verdict from reviews where submission_id = %s", (res["id"],))
        dossier = [r[0] for r in cur.fetchall()]
        refutes = dossier.count("refute")
        if len(dossier) < REVIEWS_TO_ADVANCE or refutes:
            res["findings"].append(["ESCALATE", 0,
                f"desk: §10.4 blocks this approval — {len(dossier)}/{REVIEWS_TO_ADVANCE} reviews "
                f"recorded for submission #{res['id']}, {refutes} refuting. The editor "
                f"rules with the reviewers' dossier in hand, not without it; escalating "
                f"instead of approving."])
            res["verdict"] = "escalate"
            res["reason"] = ("mechanical checks passed but a reviewer refutes"
                             if refutes else
                             "mechanical checks passed but the review dossier is short")
            status = None
    if status:
        # The world may have moved during this pass: verification fetches
        # sources for minutes, and in that window the editor may have ruled
        # or the contributor may have appealed — and ruling on an appeal is
        # the one thing the Curator's commission forbids (Carta §5, Ship's
        # Officers §4.1). So the transition is conditional on the submission
        # still being in a state this desk may rule from, and a lost race
        # records nothing: the ledger must not hold a Curator verdict that
        # never took effect.
        cur.execute(
            "update submissions set status=%s, updated_at=now() "
            " where id=%s and status in ('submitted','peer-review','human-review')",
            (status, res["id"]))
        if cur.rowcount == 0:
            res["verdict"] = "superseded"
            res["reason"] = ("the submission changed hands during verification "
                             "(editor's verdict, or an appeal) — nothing recorded")
            return
    # Written when the pass located anything, verdict or not. The publisher
    # reads this and nothing else: a span located in the source, with the
    # offset, the length and the hash of the exact bytes it was found in.
    # Without it the atlas published `evidence.quote` — the contributor's own
    # typing — for every submission that arrived through MCP rather than
    # through the pipeline. An EMPTY pass, though, writes nothing: a run
    # where every source was unreachable must not overwrite spans a previous
    # run located — evidence is replaced by evidence, never by absence.
    if res["verified_spans"]:
        cur.execute("insert into verified_spans (submission_id, spans, carta_version) "
                    "values (%s,%s,%s) on conflict (submission_id) do update "
                    "set spans = excluded.spans, carta_version = excluded.carta_version, "
                    "verified_at = now()",
                    (res["id"], psycopg2.extras.Json(res["verified_spans"]), carta))
    # The actor is the Curator, never the editor. A verdict recorded under a
    # human's name that a human did not give is the defect this replaces.
    cur.execute(
        "insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)"
        " values (%s,%s,%s,%s,%s,%s)",
        (res["id"], ACTOR, "verdict" if status else "review",
         res["verdict"], psycopg2.extras.Json(res["findings"]), carta))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*", type=int)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    global CARTA
    carta = CARTA = carta_version()
    conn = connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    if args.ids:
        # The same status gate as the queue pass: an explicit id is a way to
        # pick a submission out of the queue, not a way to re-rule one that
        # has left it (approved, rejected, appealed — the editor's ground).
        cur.execute("select id,type,target_voyage,status,payload from submissions "
                    "where id = any(%s) "
                    "  and status in ('peer-review','human-review','submitted') "
                    "order by id", (args.ids,))
    else:
        cur.execute("select id,type,target_voyage,status,payload from submissions "
                    "where status in ('peer-review','human-review','submitted') order by id")
    subs = cur.fetchall()
    if not subs:
        print("nothing awaiting a verdict.")
        return 0

    out = []
    write = conn.cursor()
    for sub in subs:
        res = review(dict(sub), carta)
        out.append(res)
        if not args.dry_run:
            record(write, res, carta)
        if not args.json:
            s = res["stats"]
            print(f"\n#{res['id']:<3} {str(res['target']):<20} → {res['verdict'].upper()}"
                  f"  ({s['verified']}/{s['quoted']} quotations verified)")
            print(f"     {res['reason']}")
            for level, _, text in res["findings"][:8]:
                print(f"     {level:<9} {text[:150]}")
            extra = len(res["findings"]) - 8
            if extra > 0:
                print(f"     … and {extra} more")
    if not args.dry_run:
        conn.commit()
    if args.json:
        print(json.dumps(out, indent=2, ensure_ascii=False))
    elif args.dry_run:
        print("\n(dry run — nothing recorded)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
