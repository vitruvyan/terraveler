# Motus in production: the first real pipeline

**From:** Terraveler (`vitruvyan/terraveler`), the Curator's verdict desk
**Kernel:** `vitruvyan-motus` 0.8.1, commit `508fd52`
**Date:** 2026-08-10
**Graph:** `terraveler-desk-verdict` v1.0.0, `graph:sha256:87919c18c41caa…`

This is a field report, not a bug list. Terraveler ran a Motus graph against
live production data for the first time, wrote the trace to Postgres,
validated it with the shipped validator, published its root on a public
blockchain and read it back. Everything below is observed, with the command
that produced it. Where something is a question rather than a defect it is
written as a question.

The short version: **it worked, end to end, on the first attempt.** The
kernel's guarantees held under a real workload and the trace turned out to be
worth what it claims. The findings are about the edges — replay, durability
reporting, and the anchor interface that does not exist yet.

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
