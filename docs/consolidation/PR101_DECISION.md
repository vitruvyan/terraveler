# PR #101: retain lineage; adapt before production adoption

Issue: [#125](https://github.com/vitruvyan/terraveler/issues/125).
Review baseline: `df7186a8dc28a9a9d09ace5e1f27d344e71d8265` (17 November 2026).
Historical head: `d2a52daf258da80a6ad20a7debf6d624781e319f`,
[PR #101](https://github.com/vitruvyan/terraveler/pull/101).

## Decision

Do not merge the historical branch as a production editorial workflow. Keep the
PR and its original commit available until the adaptations below are implemented
and reviewed. This is an explicit unresolved item, not a claim that the contract
has already been recovered. Do not overwrite current `AGENTS.md` or `SKILLS.md`
with the historical additions.

The useful invariant is fact-first composition: source-backed atomic proposals,
independent fact review, then assembly from reviewed IDs while copying approved
statements unchanged and retaining all required gaps. Mechanical fidelity,
semantic review, completeness and human publication are separate decisions.

The historical runner is a private GPT-4.1 pilot with its own lifetime budget,
operator-supplied source snapshots, local manifests and a reviewer-declared hash
gate. Those checks do not establish a current TerraVeler MCP consultation receipt,
server-bound independent reviewer or reviewed canonical editorial task result.
Installing it unchanged would create another provider and review path alongside
the existing Limen/MCP/PostgreSQL workflow.

## Revalidation performed

The six unique files listed below were overlaid unchanged on the baseline in an
isolated temporary checkout. The baseline's bundled Motus 0.14.0 wheel was
extracted to an isolated import directory; no provider credential was loaded.

```sh
PYTHONPATH=<isolated-wheel-directory> \
  python3 -m unittest discover -s scripts -p test_waypoint_research.py -v
```

Result: **29 tests passed**. Tests exercised the actual runner with temporary
SQLite/files and fake provider/transport ports. Preview reported `api_calls: 0`.
No paid inference, live historical source requests, new pilot namespace, budget
reset, paid retry or historical artifact recovery was performed. Passing this
suite does not explain or supersede the historical failing Jenkins check; full
current CI remains required before adoption.

Unique historical files, preserved at the original commit:

- `contracts/waypoint-research-v1.schema.json`
- `docs/WAYPOINT_RESEARCH_CONTRACT.md`
- `scripts/fixtures/waypoint-motux-v1.json`
- `scripts/fixtures/waypoint-pattern-holdouts.json`
- `scripts/waypoint_research.py`
- `scripts/test_waypoint_research.py`

The private pilot manifest, original paid/tool rows, failed and successor traces,
review and final cards are not in Git. Their documented location is
`out/content-swarm/waypoint-pattern-v1/motux/`; the lifetime ledger is
`out/content-swarm/budget.sqlite`. Do not reconstruct, overwrite or re-run them
merely to consolidate branches. Their historical existence and semantic review
outcomes are reported by the PR, not newly verified here.

## Required integration with the existing architecture

| Historical concept | Canonical integration boundary | Required acceptance check |
|---|---|---|
| Input/effective source packet | MCP consultation receipts and task-scoped corpus | Unknown, wrong-task, stale/revoked or forged receipts cannot authorize facts; listed links remain candidates. |
| Atomic proposals and scope | Versioned research artifact in `editorial_results` | Subject, relationship, time/place/population scope and supporting source IDs are explicit; a copied substring is not proof of entailment. |
| Independent fact review | Pinned agent configuration and canonical reviewer task/result | Self-review and replay against another fact/source version fail; approval must be server-linked, not asserted in model JSON. |
| Composition by allowed IDs | Existing writer artifact contract, extended for reviewed facts | Unknown/duplicate/unapproved IDs, added prose and changed approved bytes fail. No second composer service or approval store. |
| Required gaps | Plan/work-item scope plus immutable reviewed result | A writer cannot silently omit a gap or convert “not established here” into “no evidence exists.” |
| Media and studies | Existing source governance plus future specialist contracts | Per-item asset rights, visual inspection and image relevance stay separate; abstract/bibliography metadata cannot support detailed findings. |
| Publication | Existing Desk decision on the exact assembled result | Agent or mechanical review never supplies human publication authorization. |
| Motus checkpoint | Existing task attempt, result and trace lineage | Resumes preserve exact accepted artifacts; no hidden budget reset or replay claim for effectful source/model nodes. |

Reuse the historical holdout categories when implementing this extension:
material transferred to the wrong subject; territorial scope broadened; invented
intent; modern coordinates presented as a historical camp; later scholarship
presented as encounter identity; wrong-place photography; description/asset
licence mixing; and abstract aims presented as study findings. They are review
regressions, not an automated claim that software detects historical meaning.

No API, migration, runtime handler, production source content, paid pilot or
Living Newsroom UX is changed by this decision record. The production fact-first
extension remains blocked on the receipt/result/reviewer adaptation and its
end-to-end tests above.
