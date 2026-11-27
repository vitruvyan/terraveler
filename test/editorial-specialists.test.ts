import test from "node:test";
import assert from "node:assert/strict";
import { EDITORIAL_SPECIALISTS, PUBLICATION_AUTHORITY, editorialSpecialist } from "../lib/editorialSpecialists";

test("specialty mapping preserves executable roles and excludes publication authority", () => {
  assert.equal(new Set(EDITORIAL_SPECIALISTS.map(s => s.id)).size, 10);
  const expected = {
    "managing-editor": "coordinator", history: "research", ethnohistory: "research", itinerary: "research",
    iconography: "research", diary: "writer", caption: "writer", editorial: "writer", copyedit: "reviewer", factcheck: "reviewer",
  };
  for (const [id, role] of Object.entries(expected)) assert.equal(editorialSpecialist(id)?.role, role);
  for (const id of [undefined, null, 1, {}, "publisher", "editor-in-chief", "history ", "HISTORY", "__proto__"])
    assert.equal(editorialSpecialist(id), null);
  assert.equal(PUBLICATION_AUTHORITY, "human-editor");
});

test("templates expose seven textual generic handlers and keep media specialists unavailable", () => {
  const wired = EDITORIAL_SPECIALISTS.filter(s => s.implementation === "generic-handler");
  assert.deepEqual(wired.map(s => [s.id, s.handler]), [
    ["history", "research"], ["ethnohistory", "research"], ["itinerary", "research"],
    ["diary", "writer"], ["editorial", "writer"], ["copyedit", "reviewer"], ["factcheck", "reviewer"],
  ]);
  assert.deepEqual(EDITORIAL_SPECIALISTS.filter(s => s.implementation === "planned").map(s => s.id), ["iconography", "caption"]);
  assert.equal(editorialSpecialist("managing-editor")?.implementation, "preparation");
  assert.equal(editorialSpecialist("managing-editor")?.handler, null);
  for (const specialist of EDITORIAL_SPECIALISTS) {
    assert.ok(specialist.instructions.length < 12000);
    assert.ok(specialist.delivery.length > 0);
    if (specialist.implementation === "planned") assert.equal(specialist.handler, null);
    assert.match(specialist.instructions, /source IDs/);
    assert.match(specialist.instructions, /no publication authority/);
    assert.match(specialist.instructions, /Link-only material is not a consulted source/);
  }
});

test("ethnohistory and media prompts preserve evidence distinctions that generative prose can erase", () => {
  const ethno = editorialSpecialist("ethnohistory")!.instructions;
  assert.match(ethno, /modern geography alone/);
  assert.match(ethno, /indigenous voices/);
  assert.match(ethno, /not automatically contemporary eyewitness/);
  assert.match(ethno, /competing interpretations/);
  const photo = editorialSpecialist("iconography")!.instructions;
  assert.match(photo, /creation date separately from the depicted event date/);
  assert.match(photo, /actual image/);
  assert.match(photo, /Uncertain rights block use/);
  assert.match(editorialSpecialist("copyedit")!.instructions, /quotation bytes/);
  assert.match(editorialSpecialist("factcheck")!.instructions, /candidate readiness only/);
});
