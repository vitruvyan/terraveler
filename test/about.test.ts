import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * The README is the /about page, so the split between what a reader sees and
 * what only a developer needs lives in one comment in one file. If that comment
 * is ever renamed or deleted, the About page silently starts publishing docker
 * commands and migration order to visitors — a failure with no error and no
 * crash, which is exactly the kind worth a test.
 */

const SENTINEL = "<!-- ABOUT-PAGE-ENDS";

async function readme() {
  return readFile(new URL("../README.md", import.meta.url), "utf8");
}

test("the README carries the sentinel the About page splits on", async () => {
  const md = await readme();
  assert.equal(
    md.split(SENTINEL).length,
    2,
    "expected exactly one sentinel — /about renders everything before it",
  );
});

test("the About page's sentinel matches the README's", async () => {
  const page = await readFile(new URL("../app/about/page.tsx", import.meta.url), "utf8");
  assert.ok(
    page.includes(`"${SENTINEL}`),
    "app/about/page.tsx must split on the same sentinel string",
  );
});

test("the reader's half explains what Terraveler is, and does not leak the developer half", async () => {
  const [reader, dev] = (await readme()).split(SENTINEL);

  // The things a visitor came for.
  for (const claim of [
    "verbatim or absent",
    "evidence basis",
    "what was lost",
    "CC BY-SA",
    "Magna Carta",
  ]) {
    assert.match(reader, new RegExp(claim, "i"), `missing from the reader's half: ${claim}`);
  }

  // The things they did not.
  for (const leak of ["npm install", "docker exec", "PostgREST caches", "cp .env.example"]) {
    assert.doesNotMatch(reader, new RegExp(leak), `developer detail above the sentinel: ${leak}`);
    assert.match(dev, new RegExp(leak), `expected below the sentinel: ${leak}`);
  }
});

test("the four evidence tiers are all named in the About text", async () => {
  const [reader] = (await readme()).split(SENTINEL);
  for (const tier of [
    "contemporary-journal",
    "contemporary-testimony",
    "later-chronicle",
    "reconstructed",
  ]) {
    assert.match(reader, new RegExp(tier), tier);
  }
});
