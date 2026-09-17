import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { illuminationBackgrounds, illustrationForVoyage, illustrationScenes, visualAssets } from "../lib/voyageIllustrations";
import { ATLAS } from "../lib/voyages";

test("every published entry carries the visual class used for automatic selection", () => {
  for (const entry of ATLAS) {
    assert.ok(entry.visualProfile, `missing visual profile for ${entry.slug}`);
    const assignment = illustrationForVoyage({ slug: entry.slug, kind: entry.kind, body: "earth" }, entry.visualProfile);
    if (entry.kind === "space" || entry.kind === "surface") {
      assert.equal(assignment, null);
    } else {
      assert.ok(assignment, `missing assignment for ${entry.slug}`);
      if (assignment.opener) assert.ok(illustrationScenes[assignment.opener]);
      if (assignment.articleOrnament) assert.ok(illustrationScenes[assignment.articleOrnament]);
    }
  }
});

test("regional ornaments follow the voyage, without treating them as stage evidence", () => {
  const cortes = illustrationForVoyage({ slug: "cortes-1519", kind: "earth", body: "earth" }, "mesoamerica");
  const pizarro = illustrationForVoyage({ slug: "pizarro-1532", kind: "earth", body: "earth" }, "andes");
  assert.equal(cortes?.opener, "maya");
  assert.equal(cortes?.pageComposition, "mesoamerica");
  assert.equal(pizarro?.opener, "andes");
  assert.equal(pizarro?.pageComposition, "andes");
  assert.equal(pizarro?.articleOrnament, "andes");
});

test("same profile reuses matching assets; unknown context stays unillustrated", () => {
  assert.deepEqual(illustrationForVoyage({ slug: "new-1700", kind: "earth", body: "earth" }, "marine-chart"),
    illustrationForVoyage({ slug: "new-1700", kind: "earth", body: "earth" }, "marine-chart"));
  assert.equal(illustrationForVoyage({ slug: "new-1700", kind: "earth", body: "earth" }, "unillustrated")?.opener, null);
  assert.equal(illustrationForVoyage({ slug: "pizarro-1532", kind: "surface", body: "moon" }, "andes"), null);
});

test("the Specimen shows every production page ground from the same curated catalogue", () => {
  const specimen = readFileSync(resolve("app/specimen/illustration/page.tsx"), "utf8");
  assert.match(specimen, /Object\.values\(illuminationBackgrounds\)/);
  for (const family of Object.values(visualAssets)) {
    for (const composition of family.backgrounds) {
      const ground = illuminationBackgrounds[composition];
      assert.ok(existsSync(resolve("public", ground.src.slice(1))), `missing ${ground.src}`);
      assert.ok(ground.context && ground.caution && ground.example.href);
    }
  }
});
