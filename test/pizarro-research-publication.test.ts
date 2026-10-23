import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import edition from "../data/research/pizarro-1532.json";
import legacy from "../data/pizarro-1532.json";

test("research publication retains legacy identities and unresolved geography", () => {
  assert.deepEqual(edition.legacy_rows.map((row) => row.id), legacy.waypoints.map((row) => row.id));
  assert.deepEqual(edition.board.units.filter((unit) => unit.kind === "waypoint").map((unit) => unit.legacy_id),
    legacy.waypoints.map((row) => row.id));
  assert.equal(edition.sections.length, 8);
  assert.equal(edition.motux.facts.length, 7);
  assert.equal(edition.motux.gaps.length, 6);
  for (const name of ["the Piura valley", "La Ramada"]) {
    const stage = edition.stages.find((row) => row.historical_name === name);
    assert.ok(stage);
    assert.equal(stage.location, null, `${name} must not acquire unsupported coordinates`);
  }
  assert.ok(edition.stages.some((stage) => /^\d{4}$/.test(stage.date.value)));
  assert.ok(edition.stages.some((stage) => /^\d{4}-\d{2}$/.test(stage.date.value)));
  assert.ok(edition.stages.every((stage) => stage.status.includes("proposal")));
});

test("all public itinerary branches and cultural references remain traceable", () => {
  const studies = new Set(edition.studies.map((study) => study.id));
  const media = new Set(edition.media.map((item) => item.id));
  for (const stage of edition.stages) {
    assert.ok(stage.testimony.text && stage.testimony.citation && stage.testimony.locator);
    assert.ok(new URL(stage.testimony.url).hostname);
    for (const id of stage.study_ids) assert.ok(studies.has(id), `missing study ${id}`);
    for (const id of stage.media_ids) assert.ok(media.has(id), `missing image record ${id}`);
  }
  for (const branch of edition.branches) {
    for (const record of branch.records) {
      assert.ok(record.evidence.length > 0, `${record.name} needs attributed source evidence`);
      for (const evidence of record.evidence) {
        assert.ok(evidence.text && evidence.citation && evidence.locator);
        assert.ok(new URL(evidence.url).hostname);
      }
    }
  }
  for (const context of edition.cultural_contexts) {
    assert.ok(context.period_limits && context.source_limits);
    for (const id of context.source_ids) assert.ok(studies.has(id), `missing study ${id}`);
  }
});

test("public image bytes and research metadata preserve attribution and privacy", () => {
  const photos = edition.media.filter((item) => item.local_url);
  assert.equal(photos.length, 1);
  const photo = photos[0];
  assert.equal(photo.id, "motupe-town");
  for (const field of [photo.caption, photo.credit, photo.license, photo.item_url, photo.date]) assert.ok(field);
  assert.match(photo.date_note, /capture date.*not independently verified/i);
  const bytes = readFileSync(`public${photo.local_url}`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),
    "40c5a6c4a78b05f134a1bb337805b6ce767e979c5f8961952a2eaecc3ae24b82");
  const serialized = JSON.stringify(edition);
  for (const marker of ["/home/", "/tmp/", "out/content-swarm", "out/journey-research", ".env", ".outreach"]) {
    assert.ok(!serialized.includes(marker), `private operational path: ${marker}`);
  }
});
