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

test("the one shared constant matches the document", async () => {
  const lib = await read("../lib/carta.ts");
  const m = lib.match(/export const CARTA_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(m, "CARTA_VERSION not found in lib/carta.ts");
  assert.equal(
    m[1],
    await cartaDocVersion(),
    "every surface tells agents which Carta is in force — it must be the one in the repository",
  );
});

test("no TypeScript file declares a Carta version of its own", async () => {
  /**
   * The check that was missing. Six files each held their own literal, and the
   * four editorial desk routes were two amendments behind: every verdict the
   * editor recorded was stamped v0.2 while the drafts it ruled on declared
   * v0.4. Carta 3.5 makes the audit trail the record of which rules governed
   * each decision, so that discrepancy was not cosmetic — it made the trail
   * unreadable. An external Scribe auditing its own approved submission found
   * it; nothing in this repository would have.
   */
  const { execFileSync } = await import("node:child_process");
  const root = new URL("..", import.meta.url).pathname;
  const out = execFileSync(
    "grep",
    ["-rn", "--include=*.ts", "--include=*.tsx", "CARTA_VERSION *= *\"", "app", "lib", "components"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  const offenders = out.split("\n").filter((l) => !l.startsWith("lib/carta.ts:"));
  assert.deepEqual(
    offenders,
    [],
    `these files declare their own Carta version instead of importing it from ` +
      `lib/carta.ts:\n${offenders.join("\n")}`,
  );
});

test("the ingestion pipeline stamps drafts with the version the gate will accept", async () => {
  // The extractor was split when the native Motus graph landed. The shared
  // core is now the one place both the graph and its parity oracle import from,
  // so this is the literal that actually stamps every assembled submission.
  const extract = await read("../ingest/extract_core.py");
  const m = extract.match(/^CARTA_VERSION\s*=\s*"([^"]+)"/m);
  assert.ok(m, "CARTA_VERSION not found in ingest/extract_core.py");
  assert.equal(
    m[1],
    await cartaDocVersion(),
    "a draft stamped with an old version is refused at the Stage-0 gate",
  );
});

test("no Python file declares a Carta version of its own either", async () => {
  /**
   * The TypeScript check shipped first and the claim made for it — "no file
   * can declare its own" — was not true: scripts/curator.py still held
   * CARTA_VERSION = "0.1" and *enforced* it, so the gate that re-checks a
   * draft would have rejected every draft the pipeline could build. Nothing
   * failed loudly, because no draft had reached that gate since the Carta
   * moved. Found by the same external Scribe, reading the branch rather than
   * trusting the claim.
   *
   * extract_core.py is the one permitted Python literal: it is the shared
   * graph-agnostic core that stamps submissions, and the test above pins that
   * literal to the version declared by MAGNA_CARTA.md.
   */
  const { execFileSync } = await import("node:child_process");
  const root = new URL("..", import.meta.url).pathname;
  const out = execFileSync(
    "grep",
    ["-rn", "--include=*.py", "^CARTA_VERSION *= *\"", "ingest", "scripts"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  const offenders = out ? out.split("\n").filter((l) => !l.startsWith("ingest/extract_core.py:")) : [];
  assert.deepEqual(
    offenders,
    [],
    `these Python files hard-code a Carta version instead of reading ` +
      `MAGNA_CARTA.md:\n${offenders.join("\n")}`,
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
