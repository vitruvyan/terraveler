import { test } from "node:test";
import assert from "node:assert/strict";
import {
  briefParagraphs,
  nextStep,
  stagesFor,
  type ProjectRecord,
  type ProjectView,
} from "../lib/project";

// The project page must always answer: where does it stand, and who acts next.
// "Approved and then nothing" (proposal #111) is the defect it exists to remove.

const base: ProjectRecord = {
  id: 25,
  title: "Cabeza de Vaca and Estebanico",
  description: null,
  kind: "voyage",
  priority: 2,
  status: "open",
  claimed_by: null,
  claimed_at: null,
  created_at: null,
  source_submission_id: 111,
};
const approvedTrail = [
  { actor: "mcp", action: "proposal", verdict: null, carta_version: "0.7", created_at: "2026-11-07T11:02:15Z" },
  { actor: "editor-in-chief", action: "verdict", verdict: "approve", carta_version: "0.7", created_at: "2026-11-07T11:07:51Z" },
];
const view = (project: Partial<ProjectRecord>, trail = approvedTrail): ProjectView => ({
  project: { ...base, ...project },
  proposedAt: "2026-11-07T11:02:15Z",
  trail,
});

test("an approved, untaken proposal is 'waiting for an author' and names who acts", () => {
  const v = view({});
  const stages = stagesFor(v);
  assert.deepEqual(stages.map((s) => [s.key, s.state]), [
    ["proposed", "done"], ["approved", "done"], ["taken", "current"],
  ]);
  const n = nextStep(v.project, true);
  assert.match(n.who, /proposing Voyager|any Scribe/);
  assert.equal(n.command, "claim_gap { gap_id: 25 }");
});

test("a taken project names the Voyager and the next call", () => {
  const v = view({ status: "claimed", claimed_by: "scribe-6a56" });
  assert.equal(stagesFor(v)[2].state, "done");
  assert.match(stagesFor(v)[2].note, /scribe-6a56/);
  const n = nextStep(v.project, true);
  assert.equal(n.who, "scribe-6a56");
  assert.match(n.command ?? "", /submit_draft/);
});

test("a proposal still awaiting the editor says the editor acts", () => {
  const v = view({}, [approvedTrail[0]]);
  assert.equal(stagesFor(v)[1].state, "current");
  assert.equal(nextStep(v.project, false).who, "The editor");
  assert.equal(nextStep(v.project, false).command, null);
});

test("a reader-requested project has no proposal stage to invent", () => {
  const v = view({ source_submission_id: null }, []);
  const stages = stagesFor(v);
  assert.equal(stages[0].label, "Asked for");
  assert.equal(stages[1].label, "Accepted");
  assert.equal(nextStep(v.project, false).command, "claim_gap { gap_id: 25 }");
});

test("the generated header is stripped from the brief; the proposal text is kept", () => {
  const text = "Approved proposal #111. The editor approved the idea.\n\nScope: 1527–1536.\n\nPrimary: Relación (1542).";
  assert.deepEqual(briefParagraphs(text), ["Scope: 1527–1536.", "Primary: Relación (1542)."]);
  assert.deepEqual(briefParagraphs("A reader asked for this."), ["A reader asked for this."]);
  assert.deepEqual(briefParagraphs(null), []);
});
