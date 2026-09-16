import assert from "node:assert/strict";
import test from "node:test";
import { illustrationForVoyage, illustrationScenes } from "../lib/voyageIllustrations";
import { ATLAS } from "../lib/voyages";

test("the published atlas has deliberate editorial assignments", () => {
  for (const entry of ATLAS) {
    const assignment = illustrationForVoyage({ slug: entry.slug, kind: entry.kind, body: "earth" });
    if (entry.kind === "space" || entry.kind === "surface") {
      assert.equal(assignment, null);
    } else {
      assert.ok(assignment, `missing assignment for ${entry.slug}`);
      if (assignment.opener) assert.ok(illustrationScenes[assignment.opener]);
    }
  }
});

test("Maya is limited to Cortés's documented Cozumel stage, never Pizarro", () => {
  const cortes = illustrationForVoyage({ slug: "cortes-1519", kind: "earth", body: "earth" });
  const pizarro = illustrationForVoyage({ slug: "pizarro-1532", kind: "earth", body: "earth" });
  assert.deepEqual(cortes?.encounter, { stage: 2, scene: "maya" });
  assert.equal(cortes?.opener, "conquistador");
  assert.equal(pizarro?.opener, "andes");
  assert.equal(pizarro?.encounter, undefined);
});

test("unknown voyages and journeys without fitting art stay unillustrated", () => {
  assert.equal(illustrationForVoyage({ slug: "not-published", kind: "earth", body: "earth" }), null);
  assert.equal(illustrationForVoyage({ slug: "shackleton-1914", kind: "earth", body: "earth" })?.opener, null);
  assert.equal(illustrationForVoyage({ slug: "pizarro-1532", kind: "surface", body: "moon" }), null);
});
