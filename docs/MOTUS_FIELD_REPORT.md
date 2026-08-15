# Motus in production: the first real pipeline

**From:** Terraveler (`vitruvyan/terraveler`), the Curator's verdict desk
**Kernel:** `vitruvyan-motus` 0.8.1, commit `508fd52`
**Date:** 2026-08-10
**Graph:** `terraveler-desk-verdict` v1.0.0, `graph:sha256:87919c18c41caa…`

> **Correction, 2026-08-13 — the anchor below is not evidence of anything.**
> `vitruvyan/motus` ADR-019 (accepted 2026-08-12, the day after this report)
> found that trace schema 2.0.0's terminal `payload_hash` — what §3.1 below
> calls "the run root" and what §7's bottom line rests on — covers **only the
> terminal record**, not the run. Every digest in a 2.0.0 chain is nulled
> before hashing, `prev_hash` included, so no digest incorporates its
> predecessor and the "chain" is independent hashes standing next to a pointer
> nothing hashes. An editor can rewrite `run_id`, `policy`, `metadata`, or any
> non-terminal record, reseal by the published recipe, and the anchored value
> — `sha256:1ca0f5f65226bcbab508992c2f1a44b2517fd25f35b94d49d0363a0a54fef1f1`,
> published as TRON Nile txid
> `bb294473c996ff97ae9a92c5b23c3ab2b7c28ad23322e4517c2495f44cc71b69` — does not
> move. §3.1's "anchoring that one 32-byte value commits to the entire run" is
> the claim ADR-019 disproves.
>
> What survives: the trace itself is a genuine, replayable record of a real
> run (everything in §3 and §5 that is not about the anchor's guarantee is
> unaffected), and §4.3's anchor implementation ( `scripts/anchor.py` ) is
> correct as written — it publishes and re-reads whatever root it is handed,
> and the defect was upstream of it, in what schema 2.0.0 called a root.
>
> §8 redoes this exercise on `vitruvyan-motus` 0.10.0 (trace schema 3.0.0,
> where `Trace.root` is derived rather than read back) and gets a second,
> real anchor whose tamper check actually holds. Read that section for the
> evidence this one does not have.

This is a field report, not a bug list. Terraveler ran a Motus graph against
live production data for the first time, wrote the trace to Postgres,
validated it with the shipped validator, published its root on a public
blockchain and read it back. Everything below is observed, with the command
that produced it. Where something is a question rather than a defect it is
written as a question.

The short version: **it worked, end to end, on the first attempt** — as a
graph execution. The evidentiary claim (§7) did not; see the correction above
and §8.

---

## 1. What ran

The Curator's verdict pass. Carta §2 gives the Curator the power to issue
`approved | rejected | changes-requested`; §5 makes every verdict motivated,
cited and appealable. Before Motus this was a script with `if`s, and the
verdict it produced was a row in a Postgres table — editable afterwards by
anyone holding the password, silently. The whole point of moving it to Motus
was to make that edit visible.

Nine nodes, seven of which executed on this run:

```
load_submission → check_shape → check_sources → check_verbatim
                → read_dossier → decide ─┬→ record_ruling      (terminal)
                                         └→ record_escalation  (terminal)
                                            no_submission      (terminal)
```

`decide` records a `Decision` and the transition routes **on that Decision**,
so the branch taken is a fact in the record rather than a control-flow event
that existed only inside the interpreter. That was the single most valuable
thing the port bought us, and it is worth stating plainly to the kernel's
author: routing-on-a-Decision is the feature that made this migration worth
doing. A verdict the graph took but did not record cannot reach a recording
node at all.

The subject was submission #27, a new-voyage draft on Mungo Park's 1795
journey to the Niger, carrying twelve verbatim quotations to be re-located in
their live source (an 853,373-character OCR text on archive.org).

## 2. The numbers

| | |
|---|---|
| records in the trace | 24 |
| trace size | 22,979 bytes canonical JSONL |
| wall clock | 18.0 s (incl. the 853 KB source fetch) |
| verdict | `escalate` — clean mechanically, needs a human reader |
| quotations verified | 12 / 12 |
| root | `sha256:1ca0f5f65226bcbab508992c2f1a44b2517fd25f35b94d49d0363a0a54fef1f1` |
| `motus-validate jsonl` | exit 0 |
| anchor txid | `bb294473c996ff97ae9a92c5b23c3ab2b7c28ad23322e4517c2495f44cc71b69` |
| chain | TRON Nile, memo 87/100 chars |
| first anchor cost | 2.100001 TRX (mostly one-time account creation) |

Record layout: 1 header + 1 `run_started` + 7 × (node_started, transition,
routing) + 1 `run_completed` = 24.

## 3. What the kernel got right, with evidence

### 3.1 The root is the final record's payload hash

`run_completed.integrity.payload_hash` **is** the run root. Because every
record carries `prev_hash` of its predecessor, anchoring that one 32-byte
value commits to the entire run. That is what makes a single-value blockchain
anchor possible at all, and it should be documented as a guarantee rather than
left to be discovered — an integrator who does not notice it will anchor
something larger and more fragile.

### 3.2 Effect receipts caught a real bug

`check_verbatim` records the fetch as an external effect with a
`result_fingerprint` over the bytes the archive served:

```
GET https://archive.org/download/travelsininter00park/travelsininter00park_djvu.txt:
853373 readable character(s), sha256:e66b1b6aa538a8e029ab2370804c508b2d1d50ee…
```

Two runs over a changed source produce different fingerprints. This is how the
desk can claim a quotation was verified against a *specific* state of a
*specific* document, which is exactly the claim the Magna Carta requires and
could not previously substantiate.

### 3.3 Recorded effects proved a design assertion

Four nodes read the draft independently, and each records the payload digest
it saw. All four report `sha256:e9f54337c1022f3fd62067d7f60b25c1db87a7d46…` —
identical. The trace therefore *demonstrates* the four checks saw the same
bytes, where a single cached read could only have asserted it. This was a
design bet when the graph was written; the first real run confirmed it pays.

### 3.4 The validator refuses what it should

The point of the whole exercise. The real trace and three tampered copies,
through `motus-validate jsonl`:

| trace | exit | rule | what it caught |
|---|---|---|---|
| untouched | 0 | — | — |
| verdict `escalate`→`approve` in `decide`'s routing record | 1 | T11 | `records[18].integrity.payload_hash` does not match the record |
| one hex digit flipped in a digest in `record_escalation` | 1 | T11 | `records[20].integrity.payload_hash` does not match |
| one whole record deleted (`check_verbatim` finished) | 1 | T11 | `records[11].integrity.prev_hash` breaks the chain |

Two distinct failure modes — payload mismatch and chain break — both under
T11, each naming the offending record and field. The messages are good enough
to act on without reading the validator's source.

### 3.5 The canonical JSONL round-trips through Postgres

Stored as `text`, extracted with `psql -tAc` and validated: exit 0,
byte-identical but for psql's trailing newline. So a third party can check a
verdict with nothing but the database and the shipped validator, trusting
neither us nor our code. **This is the claim that most needed to be true, and
it is true.**

### 3.6 The integrity hash is over a canonical form, and that is worth saying out loud

We had written, in three places, that a trace must not be stored as `jsonb`
because Postgres reorders keys and the chain is computed over bytes. **That is
wrong**, and testing it on the chat pipeline is what showed it:

| document | `motus-validate trace` |
|---|---|
| chat trace read back out of a `jsonb` column | exit 0 |
| same document, every object's keys sorted in reverse | exit 0 |
| same document, one routing value changed `yes`→`no` | exit 1, T11 |

So key order does not reach the digest, integrity checking is demonstrably
live, and a jsonb column is a perfectly safe place to keep a trace. We have
corrected our own comments.

The reason this belongs in a report to the kernel rather than only in our own
changelog: an integrator's first question about storage is exactly this one,
and guessing wrong costs a column type and a migration. One line in the docs —
"integrity digests are computed over the canonical serialisation; storage may
reorder keys freely" — would have saved us the mistake and would save the next
person the same one.

(We still store JSONL as `text`, for a smaller reason that survives: the column
then holds the exact stream `motus-validate jsonl` reads, so checking a verdict
is one psql redirect with no intermediate rendering to be faithful about.)

### 3.7 The routing record keeps the road not taken

From the chat graph (`terraveler-chat`, `retrieve → evaluate → answer |
decline`), the routing record after `evaluate`:

```json
{"on": "answerable", "value": "yes", "outcome": "matched", "selected": "answer",
 "origin": {"seq": 6, "kind": "transition", "index": 0},
 "candidates": [{"target": "answer",  "taken": true,  "condition": {"kind": "map", "key": "yes"}},
                {"target": "decline", "taken": false, "condition": {"kind": "map", "key": "no"}},
                {"target": "decline", "taken": false, "condition": {"kind": "default"}}]}
```

It records not only which branch was taken but which branches existed and were
refused, and `origin` points back at the exact write that decided it. An
auditor asking "could this run have declined, and why didn't it?" is answered
by the record rather than by reading the graph definition alongside it. Worth
advertising: it is not obvious from the API that routing is this introspectable,
and it is the single most useful thing in either of our traces.

The same node's `reads` block carries the same quality — each read names the
seq, kind, collection and index of the write it read from, so a fact's
provenance inside a run is a link rather than a name lookup.

---

## 4. Findings and questions for the kernel

### 4.1 `opaque_config` costs us replay on 7 of 9 nodes — is there an idiom we missed?

`run_completed.replay`:

```json
{"capability": "partial",
 "constraints": ["node:check_shape:opaque_config",
                 "node:check_sources:opaque_config",
                 "node:check_verbatim:opaque_config",
                 "node:load_submission:opaque_config",
                 "node:read_dossier:opaque_config",
                 "node:record_escalation:opaque_config",
                 "node:record_ruling:opaque_config",
                 "only-pure-nodes-are-reexecutable"]}
```

Our nodes come from `make_nodes(cfg)`, a factory closing over a `DeskConfig`
dataclass (connection params, Carta version, a span store, a fetch cache).
Motus sees an opaque closure and correctly declines to promise re-execution.

We are not asking for that to be relaxed — flagging it is the honest
behaviour. The question is whether there is an intended idiom for
**parameterising nodes without forfeiting replay**: a declared config object
that Motus can fingerprint into the trace, so the constraint becomes
`config:sha256:…` (reproducible given the same config) rather than
`opaque_config` (reproducible never). Closure-over-config is the obvious way
to write a parameterised graph in Python, so whatever the intended alternative
is, it deserves to be in the docs — otherwise every integrator lands here.

Concretely: 7 of our 9 nodes are unreplayable, and the two that are (`decide`,
`no_submission`) are the two that touch nothing. Replay capability is
`partial` for a graph where it could plausibly be near-total.

### 4.2 `durability_profile: "in-memory"` while the run reports `evidence: persisted`

The header says:

```json
"durability_profile": "in-memory",
"sink": {"flush_interval_ms": 0, "chunk_records": 1}
```

This run was invoked with a `JsonlTraceSink` writing to disk, and the
`RunResult` reported `evidence = "persisted"` (we store that verdict in the
`verdict_traces.evidence` column precisely so an incomplete trace declares
itself). A reader of the header alone would conclude the evidence was never
durable, which contradicts what the result object says about the same run.

Question rather than assertion: what is `durability_profile` meant to describe
— the *runtime's* buffering strategy, or the *sink's* durability? If the
former, the name invites the wrong reading and the two fields should probably
reference each other. If the latter, attaching a `JsonlTraceSink` should move
it off `in-memory`.

### 4.3 The anchor interface (motus#51) — here is a working implementation to design against

Motus ships no anchor and holds no chain credentials, by decision: the
repository provides the socket, not the plug. We agree with that and built the
plug (`scripts/anchor.py`, ~380 lines, TRON Nile via `tronpy`).

It was deliberately written to be replaceable. It touches **no Motus
internals**: `anchor()` and `verify()` take a root string and a receipt dict
and would keep working if Motus vanished. The shape that fell out of actually
building it, offered as input to whatever #51 becomes:

```python
anchor(root: str, *, wait: bool = True) -> receipt: dict
verify(root: str, receipt: dict) -> bool
```

Three things we learned that an interface should account for:

1. **`verify()` is the half that matters and the half people skip.** It must
   re-read from the chain and never trust the receipt's own copy of the
   payload — a local file that certifies itself certifies nothing. If the
   interface only specifies `anchor()`, implementations will ship without it.
2. **Broadcast success and confirmation are different events.** Ours returns a
   receipt whose `confirmation` field may say `{"unconfirmed": …}` when the
   network did not confirm within 60 s. That is a fact about the network, not
   a failed anchor, and the receipt should be able to say so rather than
   forcing a boolean.
3. **Memo sizing depends on the root's format.** A TRON memo carries 100
   characters. `sha256:` + 64 hex = 71, plus our 16-character namespace prefix
   = 87. Our own migration brief had computed 80, assuming a bare digest —
   Motus 0.8.1 names its hash function inside the value, which is the right
   call (a digest that does not say what produced it cannot be recomputed) but
   it costs 7 characters that a naive integrator will not have budgeted. Worth
   one sentence in the docs.

We are not proposing batching. Appendix H of the Vitruvyan ledger design
proposes 100 events behind a Merkle root; we deliberately did not build it,
because a batching scheme whose single-item case was never made to work is a
scheme nobody can debug. The single-item case now works and is on chain.

### 4.4 Small: `receipt_id`/`status` are `None` on recorded effects

`recorded_effect` entries carry `"receipt": {"receipt_id": null, "status":
null}` where we passed no receipt. Harmless and arguably correct, but it means
a consumer walking effects must null-check two fields that are structurally
present. If a receipt is optional for recorded effects, omitting the key might
read better than emitting a null-filled object. Very low priority.

---

## 5. What the migration found in *our* code

Recorded because it speaks to what the kernel's structure is worth, not
because it is Motus's problem. Pointing the graph at the real queue instead of
at fixtures exposed two bugs that predate the migration entirely, and both
were legible **because** the trace records shapes and digests:

- **archive.org could never be verified.** `archive.org/download/…` answers
  from per-item CDN nodes (`dn760108.eu.archive.org`), and our redirect guard
  re-checked the answering host against a whitelist holding only the apex. All
  twelve of #27's quotations failed as `absent` — twelve real passages,
  present in the source, unreachable by the desk that polices them. Fixed by
  requiring both ends of the redirect to be inside `archive.org` (the leading
  dot matters: `evil-archive.org` and `archive.org.evil.com` are refused).
  0/12 → 12/12.
- **Shape checks were blind to submission type.** Carta §3.6 binds the
  *voyage*; a waypoint-enrichment makes no voyage and carries no `voyage` key,
  yet was failed for lacking `evidence_basis` and `what_was_lost`. All five
  enrichments in the table were structurally unapprovable whatever they
  contained.

Both had been live for weeks. The pass had to become legible before they
became visible.

A third, from the chat graph, found the same way — by running it and reading
the trace instead of trusting the diagram. `terraveler-chat` routes on an
`answerable` Decision that `evaluate` computes as
`top_cosine_similarity >= 0.35`. Three questions were put to the same voyage
(Shackleton's *Endurance*, 1,789 indexed documents):

| question | top similarity | routed to |
|---|---|---|
| what happened when the ice crushed the *Endurance* | 0.546 | `answer` |
| the price of copper on the London exchange in 1914 | 0.533 | `answer` |
| how to configure a Kubernetes ingress controller with TLS | 0.434 | `answer` |

**The `decline` branch is unreachable in practice.** A question about container
orchestration, put to Antarctic expedition journals, clears the threshold by a
comfortable margin — because cosine similarity against a corpus of that size
has a floor well above 0.35, whatever is asked. The graph is correct; the
threshold is calibrated against nothing. Every question therefore reaches the
model, and the honest refusal the reader eventually sees ("they tell nothing
whatever of Kubernetes") is written by the chronicler in prose, not decided by
the pipeline.

That is our bug and not the kernel's, and it is recorded here because of HOW it
surfaced: the `candidates` block showed `decline` present, offered and refused
on all three runs. A branch that is never taken looks identical to a branch
that cannot be taken, until something writes down that it was offered.

---

## 6. Reproducing this

```bash
# the run (writes trace + audit_log + verified_spans; --dry-run writes nothing)
python3 scripts/desk_review.py 27 --trace-dir /tmp/traces

# the trace, checked by the shipped validator, from the database
psql -tAc "select trace_jsonl from verdict_traces where submission_id=27" > t.jsonl
motus-validate jsonl t.jsonl            # exit 0

# the chain
python3 scripts/anchor.py --submission 27     # publish the root
python3 scripts/anchor.py --verify 27         # re-read it from the chain
```

Anchored transaction:
<https://nile.tronscan.org/#/transaction/bb294473c996ff97ae9a92c5b23c3ab2b7c28ad23322e4517c2495f44cc71b69>

---

## 7. Bottom line

Motus 0.8.1 carried a real, effect-heavy, network-touching production pipeline
on the first attempt, and the trace it produced survives adversarial checking
by a third party using only the shipped validator. The verdict on submission
#27 can no longer be quietly edited by anyone — including us, including the
person holding the database password — without the edit failing to match a
digest published on a public chain before the edit was possible.

That is the property Terraveler needed and could not build for itself. The
open questions above are refinements at the edges of something that already
works.

---

## 8. Addendum, 2026-08-13 — the corrected anchor, on 0.10.0

**Kernel:** `vitruvyan-motus` 0.10.0, commit `c861c9151c99ec5ec158aaf5b5eb5cddb1cf1710`
(the v0.10.0 tag). Pinned past 0.9.0 deliberately — see
`requirements.txt` — but nothing below exercises anything 0.10.0 adds over
0.9.0. `Runtime(SPEC, make_nodes(cfg), policy=policy, sink=sink)` passes
neither `commitments=` nor `witness=`, and `scripts/test_motus_inert.py`
proves in a fresh subprocess that an unconfigured run never imports
`vitruvyan_motus.commitlog`, `.commitments` or `.sealing` — ADR-021 decision
1's "bit-for-bit 0.8.1", checked rather than trusted.

**Subject:** submission #28, a waypoint-enrichment on Bougainville's *Boudeuse*
voyage (1766), still live in the queue (`peer-review`, 0/2 reviews recorded).
Chosen over re-running #27 because its likely verdict — `escalate`, for a
short dossier — does not move the submission's status, so the run adds an
audit trail without ruling on a live draft twice.

**One other correction found along the way.** `desk_graph.py` had declared
`check_verbatim` (which only issues GETs against archive.org) as
`external_effect`, reasoning that "the spans it locates are staged for a
write" — but that write happens downstream, in `record_ruling` /
`record_escalation`, which already declare it. The criterion this migration's
brief gives is READ or MUTATE and nothing else; a GET is a read regardless of
what a later node does with its result. Reclassified to `recorded_effect`
(the per-effect `EffectDescriptor` tags inside the node moved with it — Motus
rejects a `recorded_effect` node that records an `external_effect`, and
would have rejected this correction if it were wrong). Safe-direction, not
the dangerous one — it only over-restricted resume, which this graph does not
yet use — but wrong per the rule, and the run below reflects the fix.

```
$ python3 scripts/desk_review.py 28 --trace-dir /tmp/traces
#28  boudeuse-1766        → ESCALATE  (0/0 quotations verified)
     mechanical checks passed but the review dossier is short
     INFO      meta: drafted under Carta v0.6, in force is v0.7 — no clause this draft depends on changed
     ESCALATE  desk: §10.4 blocks this approval — 0/2 reviews recorded for submission #28, 0 refuting.
     trace verdict-28-20260813T175054Z  root sha256:61f0f713e6cc7437453936125d009e30482606de32499d82989b81d56dd7a809

$ python3 -m vitruvyan_motus.contract.validate jsonl /tmp/traces/verdict-28-*.jsonl --spec desk.spec.json
(exit 0)

$ python3 scripts/anchor.py --submission 28
#28  verdict-28-20260813T175054Z  escalate
  root     sha256:61f0f713e6cc7437453936125d009e30482606de32499d82989b81d56dd7a809
  memo     VITRUVYAN_AUDIT:sha256:61f0f713e6cc7437453936125d009e30482606de32499d82989b81d56dd7a809  (87/100 characters)
  txid     bf04dd767abefc20a89ea815f63c0eefb3a9daee32d3231780057266fff4f9e3
  explorer https://nile.tronscan.org/#/transaction/bf04dd767abefc20a89ea815f63c0eefb3a9daee32d3231780057266fff4f9e3
  verify   True

$ python3 scripts/anchor.py --verify 28          # fresh process, independent re-read
#28  verdict-28-20260813T175054Z
  verdict  escalate
  root     sha256:61f0f713e6cc7437453936125d009e30482606de32499d82989b81d56dd7a809
  txid     bf04dd767abefc20a89ea815f63c0eefb3a9daee32d3231780057266fff4f9e3
  on chain YES — the memo carries this root
```

**The memo, read by hand and not through our own code** —
`gettransactionbyid` against `nile.trongrid.io`, `raw_data.data` decoded from
hex outside `anchor.py` entirely:

```
VITRUVYAN_AUDIT:sha256:61f0f713e6cc7437453936125d009e30482606de32499d82989b81d56dd7a809
```

87 characters, published whole — `sha256:` prefix intact, as the migration
brief's step 0 requires and `anchor.memo_for` asserts before broadcasting
anything.

### 8.1 The tamper check — the point of the whole exercise

Not "break the chain and watch the validator refuse it" (§3.4 already showed
that, and `TamperedTrace` in `test_desk_graph.py` covers it on every run). The
question ADR-019 exists to answer is stronger: can an editor who rewrites a
value **and correctly reseals everything after it** — recomputing every
downstream `payload_hash`/`prev_hash` exactly by the published recipe, so the
forged document is internally perfect — still be caught. Under schema 2.0.0,
no: the terminal digest didn't move. Under 3.0.0:

```
stored root    sha256:61f0f713e6cc7437453936125d009e30482606de32499d82989b81d56dd7a809
anchor txid    bf04dd767abefc20a89ea815f63c0eefb3a9daee32d3231780057266fff4f9e3
loaded root    sha256:61f0f713e6cc7437453936125d009e30482606de32499d82989b81d56dd7a809

tampering record #2 (load_submission.writes.facts.n_waypoints): 15 -> 16
forged root    sha256:7ac13d3917254ed0fbc02a331c9906f62028fabbe35c2c0bf4a50ee5576965a4

verify(original root, real receipt): True
verify(forged root,    real receipt): False
```

The forged, resealed document is not merely rejected as broken — reading it
back through `motus-validate jsonl` gives **exit 0**, the same clean result as
the untouched trace: as a document it is internally flawless. It fails only
because `verify()` re-reads the chain and the chain was written before the
edit. That is the guarantee §3.1 claimed prematurely, now actually held: an
editor holding the database password can rewrite and correctly reseal a
verdict, and the one thing they cannot do is make the result agree with a
root published somewhere they do not control.

### 8.2 Where this leaves the old anchor

`bb294473c996ff97ae9a92c5b23c3ab2b7c28ad23322e4517c2495f44cc71b69` stays on
Nile — a testnet transaction cannot be un-sent and there is no reason to try —
but it is not superseded evidence, it is void evidence: it never bound
anything, on any schema. Submission #27's trace itself is untouched and
remains a genuine record of that run; if it needs a valid anchor, re-running
`desk_review.py 27` under 0.10.0 and anchoring the resulting (schema 3.0.0)
root would give it one, the same way #28 got one here.

---

## 9. Addendum, 2026-08-15 — v0.11.0: update, don't adapt

**Kernel:** `vitruvyan-motus` 0.11.0, commit `4243cd017f00aecae145fca8b03e6c38a977cda8`
(the v0.11.0 tag, dereferenced — `git rev-parse v0.11.0` names the annotated tag
object, `8ddc49c9515a4a49a8a3c712239dd82f58ade605`; `v0.11.0^{}` peels it to the
commit above, which is what `requirements.txt` now pins, matching 0.10.0's pin
being a plain commit too. Not a kernel defect — an annotated tag is always two
addressable objects — but it cost us a confused half hour diffing a tag object
against its own commit and finding zero difference, so it is recorded here for
whoever does this next.)

The brief for this round asked us not to adapt `desk_graph.py`,
`desk_checks.py`, `desk_review.py`, `anchor.py` or `chat_graph_native.py` — run
what exists, report what breaks. Nothing broke. Every line below is a thing we
ran, not a thing we inferred.

### 9.1 What ran, for real

- `python3 -m unittest test_desk_graph test_motus_inert test_anchor -v` from
  `scripts/` — 33 + 1 + 16 = 50 tests, all green, unmodified, against 0.11.0.
- `python3 scripts/desk_review.py --dry-run --trace-dir …` against the **live**
  queue (real Postgres, real archive.org) — three submissions awaiting a
  verdict: #27 (`mungopark-1795`, re-run, still 12/12 quotations verified,
  still `escalate`), #28 (`boudeuse-1766`), and #29 (`cortes-1519`, new since
  §8, also `escalate` on a short dossier). `--dry-run` was our own choice, not
  a limitation: this pass exists to check the update, not to hand the Curator's
  desk a fresh verdict on a live draft, so we deliberately did not move a real
  submission's status without asking first. A non-dry-run pass is one flag away
  if it's wanted.
- The chat graph (`rag/app/chat_graph_native.py`, `run_chat_native`), against
  live Postgres + the live embedding service, unmodified: question "What
  happened when Cook's ship first made landfall?" against `cook-1768`, 6
  sources, top similarity **0.8008**. The `answer` node's Anthropic call
  returned `401 Unauthorized` — an API-key problem on our side, unrelated to
  Motus — and the node's own graceful-failure path (§ described in the
  original report) handled it exactly as designed: no crash, a `Rejection`
  recorded, the sources still returned. We did not chase the 401; it isn't
  this report's subject and the graceful path is the thing worth confirming
  still works, which it does.
- **Not run:** `scripts/anchor.py` for real. A live anchor publishes a
  transaction on TRON, permanently, at a real (if tiny) cost — not something to
  spend during a routine update check without asking. `test_anchor.py` (stubbed,
  no network) passed; the anchor's actual on-chain behavior under 0.11.0 is
  unverified and we are saying so rather than assuming it from the stub.
- **Not run:** registering `motus-mcp` as a live stdio server inside a client.
  That needs editing this session's own MCP client configuration and a
  restart, which is out of scope for a same-session check. We confirmed the
  binary starts cleanly (`motus-mcp < /dev/null`, exit 0, no output, no
  traceback) and used the documented CLI-equivalent form,
  `python -m vitruvyan_motus.mcp <verb>`, for every question below — the brief
  states the two are the same surface, and nothing we found contradicts that.

### 9.2 The J2 question — the one you told us matters most

Both real pipelines write schema `3.0.0`, so both are governed by J2. Every
genuine trace we produced validated at exit 0, **including the one pipeline
that writes floats**: the chat graph's `retrieve` node stages real pgvector
cosine similarities — `0.7709, 0.7718, 0.7846, 0.7905, 0.7952, 0.8008` — after
a `round(x, 4)`, and the resulting trace passed `motus-validate jsonl` and
`vitruvyan_motus.mcp diagnose` clean. `desk_graph.py`'s own traces carry no
floats at all (counts, digests, strings), so #27/#28/#29 were not a stress
test of J2 — the chat-graph run is the one that actually exercised it against
real data, and it did not reject anything.

Read against the kernel source (`contract/validate.py`), this looks
structural rather than lucky: `_canonical_number` only ever fires against a
lexeme that was NOT produced by the same `json.dumps` call that computed the
trace's own digest, and every number that reaches a genuine Motus-written
trace passes through Motus's own canonical serializer on the way in — there
is no code path in either of our graphs that hand-writes JSON text into a
trace. The scenario J2 is built to catch (a re-serializing reader, or a hand
edit, producing a lexeme that reads the same to a human but hashes
differently) is not a scenario our own writers can produce by accident. So:
**no rejection of a genuine trace, on either pipeline we have, and we don't
expect one from the future either** — which is the answer you said would let
you freeze the format, and we're glad to be the boring confirmation rather
than the caught bug this time.

One explicit gap: we did not attempt to construct an adversarial-but-genuine
edge case (a similarity that rounds to exactly `0.35`, a `-0.0`, a value near
a float64 boundary) because we don't have one in real data and manufacturing
one would be a synthetic probe of your kernel, not a report on our
integration — see the brief's own distinction between the two.

### 9.3 The verifier

No output from `motus-validate` or `vitruvyan_motus.mcp diagnose` differs in
kind from 0.10.0: still rule names (T11, T8) on tamper, still `exit 0` on a
clean trace, still a derived root printed alongside. `TamperedTrace` in
`test_desk_graph.py` — turn `changes` into `approve` in the `decide`
transition, flip a digit in a recorded value, delete a record — still catches
all three, still cites T11/T8 by name, unchanged.

### 9.4 The two questions

**`stream()` or only `run()`?** Only `run()`. Checked exhaustively, not
sampled: every `Runtime(...)` construction and every `.run(`/`.stream(` call
site across `scripts/`, `rag/`, `ingest/`, and `officers/` —
`scripts/desk_graph.py`, `scripts/test_desk_graph.py`,
`scripts/test_motus_inert.py`, `rag/app/chat_graph_native.py`,
`ingest/run.py`, `ingest/extract.py`, `ingest/test_codex.py`,
`ingest/test_extract_parity.py` — calls `.run()`. `grep -rn "\.stream("` over
the same tree returns nothing. `Runtime.stream()` exists in 0.11.0
(`runtime.py:676`) — we checked it's there, not just absent from our grep — we
simply never call it.

**Can your sink fail at run open?** Only on local disk, never on an
unreachable remote archive — we have no sink that is not `JsonlTraceSink`
(`InMemoryTraceSink` appears only in tests) and every use of it points at a
local path, never a network target. Whether it can still fail there:
- `JsonlTraceSink.__init__` calls `self.directory.mkdir(parents=True,
  exist_ok=True)` — so a *missing* directory is not actually a failure mode,
  even at `desk_review.py`'s call site, which (unlike `ingest/run.py`) does
  not `os.makedirs` first. The sink makes its own directory.
- `open_run()` — called once per run, at the start — constructs a
  `_JsonlRunSession` whose `__init__` opens a file eagerly, exclusively
  (`O_EXCL`, `O_NOFOLLOW`). That is a real `open(2)` syscall on the run's
  critical path before any node executes, and it can raise on a full disk or a
  permissions problem. We did not reproduce this — you asked us not to spend
  time reproducing what's already yours, and this one is a kernel-independent
  filesystem condition, not a Terraveler bug — but reading `sinks.py` says
  plainly that it is a live code path, not a hypothetical one, most exposed in
  `ingest/run.py`'s long-running jobs (a full disk on `/app/traces` mid-ingest
  is far more plausible over an hour-long run than in `desk_review.py`'s
  seconds-long ones).
- The decision-relevant fact, given the two answers together: **the specific
  defect you described — an abandoned streaming driver whose sink fails at
  bind, jamming the Runtime forever — cannot currently be triggered by any
  Terraveler code**, because we never call `stream()`. A disk-full or
  permissions failure in our `run()`-based usage fails the one call it
  happened in; it does not leave a long-lived `Runtime` object jammed, because
  we never keep one open across multiple sink binds the way a streaming
  consumer would. We read that as: for our exposure specifically, the fix
  urgency is low; we can't speak to whether it's urgent for embedders who do
  use `stream()`.

### 9.5 Questions we had to ask the MCP, and what that says about the docs

Used as `python -m vitruvyan_motus.mcp <verb> …` (the documented CLI-equivalent
of the stdio server, per §9.1). Every entry below is a real question we had —
either live, during this update, or standing open since §4 of this report —
and the server's real answer.

**Answered well — and the answer is itself evidence the old brief was
missing a page.** `classify` on "a node that only performs HTTP GET requests
against an external archive, and the passages it locates are later written to
a database by a downstream node" returned the exact table
(`contract/node-protocol.md` §4.1/§4.4): GET → `recorded_effect`, sourced,
with the asymmetry spelled out ("a read declared `external_effect` costs safe
resumes — a real price, paid silently, forever"). That is precisely the
information that would have stopped us mis-declaring `check_verbatim` as
`external_effect` the first time (§8's correction). The MCP answering it well
is not a reason to stop flagging it: it is proof a table like this belongs in
the primary docs an integrator reads before writing a node, not only in a tool
they have to think to ask.

**Answered well.** `diagnose` on our own live-queue trace reproduced
`motus-validate jsonl`'s result and added the derived root, matching what
`desk_review.py` printed independently. `review-graph` on our real
`desk_graph.SPEC` (dumped via `G.SPEC.to_dict()`) accepted it cleanly and
printed a graph fingerprint. We did not compare that fingerprint against the
one in §0 of this report's header — the graph changed (the §8 `check_verbatim`
reclassification) between the two measurements, so a different fingerprint is
expected regardless of the kernel version and comparing them would have been a
made-up signal, not a real one. Whether `review-graph`'s fingerprint is stable
for one unchanged spec across kernel versions is untested by us.

**Did not help where we expected it to.** `where`, asked "how to parameterise
a node's closure config so the replay constraint becomes `config:sha256:…`
instead of `opaque_config`" (our own open question 4.1, standing since the
0.8.1 report), returned all twelve top-level module docstrings, unfiltered —
not a narrowed answer, just everything. The question is still open.

**Declined rather than guessed — which is the right behavior, but the
question is still open.** `explain`, asked the free-text version of open
question 4.2 (`durability_profile: "in-memory"` next to a `RunResult` that
reports `evidence: persisted`), answered "I cannot tell" and printed the list
of exception class names instead. `explain SinkFailed` (a real class name)
did answer, correctly but thinly: "a required trace sink refused a record;
logical success is impossible," `SinkFailed → MotusError → Exception`. Reading
the tool's own behavior: `explain` seems scoped to naming a known error class,
not to adjudicating a conceptual/narrative question about field semantics —
which is a reasonable scope, but it means our two standing open questions from
§4 (4.1 and 4.2) are undiminished by 0.11.0's MCP, not resolved by it.

We did not have a case of the MCP answering confidently and wrong — every weak
answer above was either an honest non-answer or an unfiltered dump, never a
wrong one stated as fact.

### 9.6 One thing that did break, and it is on our host, not in your kernel

`pip install "vitruvyan-motus[mcp] @ git+…"` pulled `starlette==1.6.0` into
this machine's shared `--user` site-packages, which conflicts with an
unrelated tool already installed there (`fastapi==0.115.14` wants
`starlette<0.47.0`). This is not a Terraveler-repository problem — `rag/` and
`embedding/` pin their own `starlette`/`fastapi` inside their own containers,
independent of the host, and are unaffected — but it is a real, observed
breakage from installing the `[mcp]` extra on a machine that has other Python
tooling in the same site-packages, and worth knowing about before recommending
a bare `pip install …[mcp]` to an integrator who isn't working inside a
container.

### 9.7 Bottom line

Nothing in `desk_graph.py`, `desk_checks.py`, `desk_review.py`, `anchor.py`,
or `chat_graph_native.py` needed to change for 0.11.0. Every genuine trace we
produced — three from the live Curator queue, one from the live chat graph
with real floating-point similarities — validated clean under J2. The two
questions you asked us to answer directly: we use only `run()`, never
`stream()`, so the streaming-sink-bind defect you already know about cannot
reach us today; our own sink can still fail at run open on a full disk or a
permissions error, on local disk only, never on a remote target, and we did
not reproduce that failure ourselves. And the MCP is worth keeping: one answer
above was good enough to retroactively explain our own §8 mistake, two were
not useful, and none were confidently wrong.
