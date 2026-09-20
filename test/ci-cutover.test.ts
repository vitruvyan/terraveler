import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Jenkins owns automatic Terraveler validation", () => {
  const pipeline = read("Jenkinsfile");
  assert.match(pipeline, /checkout scm/);
  assert.match(pipeline, /CHECKED_OUT_SHA/);
  assert.match(pipeline, /npm ci/);
  assert.match(pipeline, /npm test/);
  assert.match(pipeline, /npm run build/);
  assert.match(pipeline, /Modern MCP smoke/);
});

test("GitHub keeps editorial refresh but no automatic CI or OpenRouter review", () => {
  assert.equal(existsSync(".github/workflows/ci.yml"), false);
  assert.equal(existsSync(".github/workflows/openrouter-review.yml"), false);
  assert.equal(existsSync(".github/scripts/openrouter_review.py"), false);
  assert.equal(existsSync(".github/workflows/world-events-refresh.yml"), true);
});
