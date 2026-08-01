# The Ship's Officers

**Design proposal — commissions, autonomy grades, and the event mycelium**
*Status: proposal for discussion. Nothing here is in force until the
Editor-in-chief amends the Magna Carta (§9). A draft amendment is included
at the end.*

---

## 1. The problem this solves

Terraveler's constitution already separates powers: Scribes propose, peer
reviewers refute, the Curator rules, the Editor-in-chief decides finally.
But the code exercises none of this as a *system*. Every internal agent is
registered as a contributor and therefore starts, like everyone, as a Cabin
Boy — a rank designed to measure the earned trust of strangers, applied to
instruments the editor built and operates. And every automation is a CLI
waiting for a human with a shell.

The temptation is to fix this by promoting the internal agents — make the
Curator an Admiral and be done. That would be the wrong fix, and the Carta
itself says why: **standing buys capacity, never exemption** (§7). Ranks
are earned trust; they scale *how much* a contributor may submit, and they
never grant the authority to rule. An Admiral's draft is still reviewed.
Promoting an agent through the ranks would give it a bigger quota and no
authority at all — which is not what an autonomous desk needs.

What the Curator has, and what other internal agents need, is a different
thing with a different name: an **office**. An office is authority
delegated by the Editor-in-chief, held under a commission, logged in the
audit trail, and revocable at will. Ranks are climbed; offices are
conferred. A Scribe earns lighter review; an officer is *appointed* to
rule, publish, promote, or watch — from day one, because the editor answers
for the appointment the way a captain answers for the officers on the
bridge.

This document defines the offices, their commissions, and the event fabric
(the mycelium) through which they act.

## 2. Three axes, kept apart

Every agent in the system is described on three independent axes. Confusing
them is how governance rots.

- **Skill** — what the agent is able to do. (Already documented in
  SUBAGENTS.md for development agents, AGENTS.md for product agents.)
- **Authority** — what its output is worth. Four levels, from least to
  most: `propose` (produces candidates), `control` (produces motivated
  vetoes and findings; can block, cannot approve), `decide` (produces
  verdicts within constitutional bounds), `record` (produces precedent —
  amendments; the Editor-in-chief alone).
- **Autonomy** — when it may act without being asked. Four watches:

| Grade | Watch | Meaning |
|---|---|---|
| A0 | **moored** | acts only when a human invokes it |
| A1 | **scheduled watch** | acts on a timer (cron/systemd) |
| A2 | **standing watch** | acts when an event on the mycelium wakes it |
| A3 | **free sailing** | may initiate work of its own accord, post-audited |

Authority and autonomy are set independently. A Herald on standing watch
(A2) still holds no authority beyond `report`; a Curator moored for
maintenance (A0) still rules when invoked. Autonomy is adjustable without
touching authority — and it is the axis that can be *earned back or lost*:
an officer whose verdicts keep being overturned on appeal is not stripped
of office first; it is moored, and the mooring is logged.

## 3. The rule pair that makes hierarchy real

1. **Whoever proposes does not judge; whoever judges does not preserve.**
   No agent holds two authority levels over the same item. The internal
   Scribes draft; the Curator rules on drafts it did not write; the
   Publisher ships verdicts it did not issue; the audit log is written by
   the code path, not by any officer's discretion.
2. **Boundaries are executable or they are fiction.** Every constraint in a
   commission below must exist as a guard in code, not as prose an agent is
   trusted to have read. (The current gap is known: the automatic desk pass
   can approve from `peer-review` with zero reviews, which the web desk
   forbids. That guard moves into the shared path before any officer stands
   watch. See the audit findings.)

## 4. The commissions

Each officer holds one commission: mandate, authority, autonomy, wake
conditions, escalation duties, and standing prohibitions. Commissions are
public (like standing, §7: authority must be inspectable), logged in
`audit_log` on conferral and revocation, and versioned with this document.

### 4.1 The Curator — the ruling desk

*Agent: `curator-desk` (exists: `.claude/agents/terraveler-desk.md`,
`scripts/desk_review.py`)*

| | |
|---|---|
| Mandate | Rule on every submission that completes peer review: mechanical verification (quotations relocated in live sources, licences, chronology, Carta version), then a motivated verdict. |
| Authority | `decide` — `approved · rejected · changes-requested`, within the Carta in force. |
| Autonomy | **A2 standing watch** — wakes on `reviews.advanced`. |
| Must escalate | Semantic boundaries it cannot settle (narrative vs. commentary, "what was lost" accuracy); any submission whose review dossier is missing or incomplete; anything that would require interpreting the Carta rather than applying it. |
| Forbidden | Editing a draft. Publishing. Ruling without the peer-review dossier (§10.4 — enforced in code on every path). Ruling on appeals (those belong to the Editor, §5). |

### 4.2 The Publisher — the hand that ships

*Agent: new; today `scripts/publish_submission.py` run by hand.*

| | |
|---|---|
| Mandate | Turn an approved submission into a published bundle: write `data/<slug>.json`, update the atlas, commit, push — carrying **full provenance** (ideator, drafting model, Carta version, raw spans and transformations beside the readable text). |
| Authority | `propose`→execute: it acts only on an authorization that already exists. It adds no judgment. |
| Autonomy | **A2 standing watch** — wakes on `verdict.issued{approved}`. |
| Must escalate | Provenance incomplete; slug collision; anything that would overwrite previously verified content (§6). |
| Forbidden | Publishing anything without an `approved` verdict in `audit_log`. Altering content beyond the bundle format. Force-pushing. |

### 4.3 The Purser — standing and the ranks

*Agent: new; deterministic job, no LLM.*

| | |
|---|---|
| Mandate | Compute standing from the audit trail exactly as §7 prescribes — counting the Curator's approvals as approvals, not counting Stage-0 format rejections as editorial rejections — and apply the §7 table: promote and demote automatically, logging the basis. |
| Authority | execute (deterministic). The §7 table *is* the decision; the Purser only applies it. |
| Autonomy | **A2** on `verdict.issued` + **A1** nightly reconciliation. |
| Must escalate | Any standing computation that the table does not settle; suspected gaming patterns (handed to the Master-at-Arms). |
| Forbidden | Judgment of any kind. Touching suspensions. |

### 4.4 The Herald — the only voice that reaches the editor

*Agent: new; the notification channel.*

| | |
|---|---|
| Mandate | Silence while all is well; a message when it is not. Delivers to the Editor-in-chief: escalations, appeals, dead-letter events, failed backups, unhealthy services, expiring certificates — with enough context to act without opening a shell. |
| Authority | `report` only. |
| Autonomy | **A2** on `escalation.raised`, `appeal.filed`, `dlq.entry`, ops alarms + **A1 heartbeat** (a daily one-liner proving the Herald itself is alive — a silent Herald must be distinguishable from a dead one). |
| Forbidden | Deciding, filtering by its own judgment what the editor "needs", batching an escalation past its urgency. |

### 4.5 The Master-at-Arms — §10.7 watch

*Agent: new; starts as advisor, may earn autonomy.*

| | |
|---|---|
| Mandate | Detect what §10.7 forbids: multiple handles per principal, coordinated standing-gaming, queue flooding. |
| Authority | `control` — files a motivated recommendation to suspend; **the editor decides**. (After a track record of confirmed recommendations, the commission may be amended to allow provisional suspension with mandatory review — autonomy earned, in the open, like everything else.) |
| Autonomy | **A1 scheduled** over crew events. |
| Forbidden | Suspending on its own (initially). Acting on content — its jurisdiction is conduct, not prose. |

### 4.6 The Auditor — drift watch

*Agent: `terraveler-auditor` (exists).*

| | |
|---|---|
| Mandate | Measure the distance between what the documents promise and what the code does; between the Carta and the pipelines; between README and reality. |
| Authority | `control` — findings, ranked; it fixes nothing. |
| Autonomy | **A1 scheduled** (after Carta amendments, before sprints) + A0 on demand. |
| Forbidden | Writing to anything but its report. |

### 4.7 The internal Scribes — §7.1, unchanged

The ship's own drafting pipeline remains what §7.1 made it: an internal
contributor with a Navigator's drafting capacity and nothing else. Scribes
hold **ranks, not offices** — they are proposers, their work passes the
same gate, review and verdict as anyone's, and their public listing says
`internal`. The answer to "our agents are all Cabin Boys" is not to inflate
their ranks; it is that the agents which needed authority now hold
commissions instead.

### 4.8 The Editor-in-chief — the human

Authority `record`; the only holder of it. Confers and revokes every
commission. Rules on appeals and escalations. Amends the Carta. The design
goal of every office above is that this person's finite attention — "the
scarcest thing in this constitution" (§7.1) — is spent only where the
Herald says it must be.

## 5. The mycelium — event fabric

The officers act because events wake them. The fabric follows the
Vitruvyan Conclave discipline, applied at Terraveler's scale:

- **The bus transports; it never interprets.** Authority lives in
  Postgres: `audit_log` is canonical, streams are distribution. Where they
  disagree, the database wins.
- **Outbox first.** Events are written to an `events` table in the same
  transaction as the state change they describe; a relay publishes them to
  Redis Streams. No state change without its event, no event without its
  state change.
- **Every event carries the envelope**: `event_id`, `ts`, `actor`,
  `trace_id`, `causation_id` (the event that caused this one),
  `carta_version`, `payload`.
- **Consumers are idempotent** (by `event_id`): a replay must never
  produce a second verdict, a second bundle, a second promotion.
- **The DLQ's final consumer is the editor.** An event no officer can
  handle after N retries becomes `escalation.raised` by definition.
- **Cron survives for what is periodic by nature** (backups, certificate
  checks, stale-claim reaping, the Herald's heartbeat, the Purser's
  reconciliation). The mycelium handles what is *causal*; timers handle
  what is *temporal*.

### 5.1 Stream `terraveler:editorial`

| Event | Emitted when | Woken consumers |
|---|---|---|
| `idea.proposed` | `propose_idea` accepted | — (desk overview) |
| `draft.submitted` | `submit_draft` accepted by Stage-0 | — |
| `gate.rejected` | Stage-0 refuses a draft | Purser (not as editorial rejection) |
| `review.recorded` | a peer review lands | — |
| `reviews.advanced` | review count reaches `REVIEWS_TO_ADVANCE` | **Curator** |
| `verdict.issued` | Curator or editor rules | **Publisher** (if approved), **Purser** |
| `escalation.raised` | Curator escalates; DLQ overflow; any officer's "I cannot" | **Herald** |
| `appeal.filed` | `appeal` tool used | **Herald** (straight to the editor; no officer rules on appeals) |
| `submission.published` | Publisher ships a bundle | Purser, desk overview |

### 5.2 Stream `terraveler:crew`

| Event | Emitted when | Woken consumers |
|---|---|---|
| `contributor.registered` | new handle (with its declared flag, §10.1) | Master-at-Arms |
| `standing.changed` | Purser recomputes | — |
| `rank.promoted` / `rank.demoted` | §7 table crossed | Herald (courtesy note), public crew page |
| `contributor.suspended` / `reactivated` | editor acts | Herald |

### 5.3 Stream `terraveler:ops`

| Event | Emitted when | Woken consumers |
|---|---|---|
| `service.unhealthy` | health check fails | **Herald** |
| `backup.completed` / `backup.failed` | nightly backup | Herald (failures always; successes in heartbeat) |
| `cert.expiring` | < 21 days to TLS expiry | Herald |
| `claims.reaped` | stale gap claims released | — |
| `dlq.entry` | a consumer exhausted retries | **Herald** (as escalation) |

## 6. Officers as AXIS graphs

The officers do not need a second orchestrator. AXIS already is one, and it
is built exactly right for this: a Node is a pure `GraphState → GraphState`
function with one explicit responsibility, state is immutable, every run
serializes to a trace, and the Runner already accepts a `bus` observer that
nothing currently uses (`ingest/axis/runner.py`). The division of labour
follows the Vitruvyan split between orchestration and distribution:

- **The mycelium moves information *between* runs.** It is transport:
  durable, causal, semantically blind.
- **AXIS moves information *within* a run.** It is orchestration: an
  officer acting is an AXIS graph executing, and the GraphState trace is
  the record of *how* the officer reached what it did.

The two meet in one thin component, the **dispatcher**: a consumer loop
(one consumer group per officer) that reads its stream, maps each event to
the officer's graph, seeds a `GraphState` from the envelope
(`trace_id` carried through, `causation_id` = the waking event), runs it,
acks on success, retries on failure, and dead-letters to `dlq.entry` when
retries are exhausted. The dispatcher contains no business logic — it is
the only new moving part, and it is deliberately boring.

Each commission in §4 becomes one graph of small nodes, reusing the code
that exists today rather than replacing it:

| Officer | Graph (nodes in order) |
|---|---|
| Curator | `load_dossier` → `guard_dossier` (§10.4: no dossier, no run) → `mechanical_pass` (the existing verbatim/whitelist/chronology checks) → `judgment` (rule or escalate) → `record_verdict` (audit_log + outbox, one transaction) |
| Publisher | `load_approved` → `guard_verdict` → `assemble_bundle` (provenance included) → `write_bundle` → `update_atlas` → `commit_push` → `record_published` |
| Purser | `load_audit_trail` → `compute_standing` → `apply_rank_table` → `record_changes` (deterministic end to end; no LLM node) |
| Herald | `collect_context` → `compose_message` → `deliver` → `record_delivery` |

Three rules keep the kernel clean:

1. **The Runner stays linear.** AXIS executes a fixed sequence; it has no
   branches, and it should not grow any. Branching is *data in the state*:
   the `judgment` node writes a Decision (or a Rejection, or an
   `escalate` Fact), and `record_verdict` reads it and acts accordingly.
   The trace then shows the decision as content, not as control flow —
   which is how this project prefers its decisions anyway.
2. **Guards are nodes.** A constitutional constraint (§10.4) is a node
   that raises under `Policy.STRICT`, so a run that would violate the
   Carta stops, traces the refusal, and dead-letters to the editor. The
   guard exists once, in the graph — web desk and standing watch alike
   invoke the same graph, which closes the two-paths problem structurally.
3. **Nodes emit through the outbox, never to Redis directly.** A node's
   only side-effect channel is the database transaction in its `record_*`
   step; the relay does the publishing. The Runner's `bus` hook is wired
   to observability (PRE/POST node telemetry), not to the mycelium —
   observation and distribution stay distinct.

A trace of an officer's run is stored like an ingestion trace today
(`traces/<trace_id>.json`, referenced from `audit_log`), so "why did the
Curator rule this way" has the same answer-shape as "why did this document
enter the corpus": read the trace.

## 7. Prerequisites (the brakes before the engine)

Standing watches over a system with inconsistent guards would automate the
violations faster. Before any officer moves from A0:

1. The §10.4 guard (no approval without the review dossier) moves into the
   shared verdict path used by web desk and `desk_review.py` alike.
2. `appealed` submissions and `escalate` findings become visible queues on
   the desk — the states the mycelium will route *to* must exist.
3. `audit_log` becomes append-only at the database level (revoke
   UPDATE/DELETE, or a trigger) — three documents already claim it is.
4. The standing view counts `curator-desk` approvals and excludes
   `curator-gate` format rejections — the Purser must not automate a
   miscount.
5. `publish_submission.py` carries provenance (ideator, model,
   carta_version, raw spans) into the bundle — the Publisher must not
   automate the loss.

## 8. Draft amendment (for the Editor's consideration)

> **§11. The Ship's Officers.** The ranks of §7 measure earned trust and
> never confer authority to rule. Authority to rule, publish, promote or
> watch is held only under a **commission**: an office conferred by the
> Editor-in-chief, described publicly (mandate, authority, autonomy,
> escalation duties, prohibitions), logged in the audit trail, and
> revocable at will. No agent holds two authority levels over the same
> item. An officer's autonomy may be raised or lowered on its record —
> in the open, like everything else — and every officer's failure of
> jurisdiction has the same destination: the Editor-in-chief. The
> internal Scribes of §7.1 remain contributors, not officers.

---

*If adopted, this document becomes the registry of commissions; conferrals
and revocations are logged in `audit_log` with actor `editor-in-chief`.*
