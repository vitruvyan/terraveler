import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * The Magna Carta's version number lives in three places that must agree, and
 * nothing was checking them.
 *
 * When the Carta was amended to v0.3 (§3.6, evidence basis), the document said
 * 0.3, the MCP surface still said 0.2, and the ingestion pipeline still stamped
 * 0.1 into every draft it produced. The MCP gate rejects a draft whose
 * carta_version does not match its own — correctly — so the pipeline was
 * building submissions that could not be submitted, and agents calling
 * get_contract were told they were working under a constitution that had been
 * superseded.
 *
 * None of that raised an error anywhere. It is only visible by comparing three
 * files, which is exactly the kind of drift a test is for.
 */

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

async function cartaDocVersion(): Promise<string> {
  const md = await read("../MAGNA_CARTA.md");
  const m = md.match(/Editorial Constitution — v(\d+\.\d+)/);
  assert.ok(m, "could not find the version line in MAGNA_CARTA.md");
  return m[1];
}

test("the MCP surface serves the Carta version the document actually declares", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const m = route.match(/const CARTA_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(m, "CARTA_VERSION not found in app/api/mcp/route.ts");
  assert.equal(
    m[1],
    await cartaDocVersion(),
    "the MCP tells agents which Carta is in force — it must be the one in the repository",
  );
});

test("the ingestion pipeline stamps drafts with the version the gate will accept", async () => {
  const extract = await read("../ingest/extract.py");
  const m = extract.match(/^CARTA_VERSION\s*=\s*"([^"]+)"/m);
  assert.ok(m, "CARTA_VERSION not found in ingest/extract.py");
  assert.equal(
    m[1],
    await cartaDocVersion(),
    "a draft stamped with an old version is refused at the Stage-0 gate",
  );
});

test("the amendment log records the current version", async () => {
  const md = await read("../MAGNA_CARTA.md");
  const v = await cartaDocVersion();
  assert.match(
    md,
    new RegExp(`Amendments: v${v.replace(".", "\\.")}`),
    `v${v} is declared at the top but has no entry in the amendment log — ` +
      `a constitution that changes without saying what changed is not one`,
  );
});
