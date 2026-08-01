import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PHONE_MAX, PHONE_QUERY, LAYOUT_SCRIPT } from "../lib/layout";

/* Two guards on the layout layer.
 *
 * The first says the boundary is written once. It was written three times —
 * twice as a matchMedia string in TypeScript and twenty-seven times in the
 * stylesheet — and the TypeScript half is what this closes now.
 *
 * The second is a ratchet, not a clean bill. Six selectors are still declared
 * in more than one responsive block, which is how `.pig-launch` came to have
 * three competing `bottom` values 1300 lines apart. Cleaning them up is the
 * migration to `[data-layout]`; until then this freezes the count so the debt
 * can only shrink. A test that passes while the number grows is worth nothing.
 */

const ROOT = join(import.meta.dirname, "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

test("the phone boundary is spelled in exactly one file", () => {
  const offenders: string[] = [];
  for (const path of sources(ROOT)) {
    const rel = path.slice(ROOT.length + 1);
    if (rel === "lib/layout.ts" || rel.startsWith("test/")) continue;
    const src = readFileSync(path, "utf8");
    /* A width query written out by hand — the thing lib/layout.ts exists to
       replace. Anything responsive in TypeScript reads PHONE_QUERY or the
       hook; nothing spells the number. */
    for (const m of src.matchAll(/["'`][^"'`]*(?:max|min)-width\s*:[^"'`]*["'`]/g)) {
      offenders.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a viewport width is written by hand outside lib/layout.ts:\n  ${offenders.join("\n  ")}`,
  );
});

test("the layout script carries the one boundary and keeps the attribute true", () => {
  assert.ok(LAYOUT_SCRIPT.includes(String(PHONE_MAX)), "the script must be built from PHONE_MAX");
  assert.ok(LAYOUT_SCRIPT.includes(PHONE_QUERY), "the script must use the shared query");
  /* It sets the attribute AND follows the boundary afterwards: the stylesheet
     depends on it, so a rotation must not leave the page in the other mode. */
  assert.match(LAYOUT_SCRIPT, /addEventListener\("change"/);
  assert.match(LAYOUT_SCRIPT, /"data-layout"/);
});

/* Blank the comments but keep the newlines, so line numbers still identify a
   block. Scanning around them instead cost a wrong answer once already: a
   multi-line comment ran into the selector buffer, and `.transport-bar`'s
   declaration inside the derived-stack block went unseen because the prose
   above it contained a comma. */
function uncommented(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
}

/* The shells that PRESENT the navigation. A page may link to /contribute in
   its prose; a shell may not spell the list, because it will go stale and did:
   the destinations were written four times — the header, the footer and both
   map experiences — and three of the four were behind. The maps still offered
   /search after the reform that removed it and never gained /crew; the footer
   never gained /crew either. Only the header was current, which is why nobody
   saw it. */
const SHELLS = [
  "components/SiteHeader.tsx",
  "components/SiteFooter.tsx",
  "components/map/MapDoors.tsx",
];

test("no shell spells the destinations it presents", async () => {
  const { ALL } = await import("../lib/nav");
  const offenders: string[] = [];
  for (const shell of SHELLS) {
    const src = readFileSync(join(ROOT, shell), "utf8");
    for (const d of ALL) {
      if (src.includes(`"${d.href}"`)) offenders.push(`${shell} spells ${d.href}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a shell holds its own copy of the navigation:\n  ${offenders.join("\n  ")}`,
  );
});

test("the retired door is not offered anywhere", async () => {
  const { ALL } = await import("../lib/nav");
  /* Search stopped being a destination in 20f321a — it is an action that opens
     in the bar and lands in the atlas. The maps kept offering it for weeks. */
  assert.equal(ALL.find((d) => d.href === "/search"), undefined);
  for (const shell of SHELLS) {
    assert.ok(
      !readFileSync(join(ROOT, shell), "utf8").includes('"/search"'),
      `${shell} still offers /search as a destination`,
    );
  }
});

/** Selectors declared inside each responsive block of the stylesheet. */
function blocksOf(source: string) {
  const lines = uncommented(source).split("\n");
  const found: { cond: string; line: number; selectors: string[] }[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith("@media")) continue;
    const cond = lines[i].trim().replace(/\s*\{\s*$/, "");
    if (!/(max|min)-width/.test(cond)) continue;

    let depth = 0;
    let j = i;
    do {
      depth += (lines[j].match(/\{/g) ?? []).length;
      depth -= (lines[j].match(/\}/g) ?? []).length;
      j++;
    } while (j < lines.length && depth > 0);

    /* Selectors may run over several lines, so accumulate until the brace. */
    const selectors: string[] = [];
    let buffer = "";
    for (const text of lines.slice(i + 1, j - 1)) {
      if (text.includes("{")) {
        buffer += text.slice(0, text.indexOf("{"));
        for (const one of buffer.split(",")) {
          const sel = one.trim();
          if (sel.startsWith(".") || sel.startsWith("#")) selectors.push(sel);
        }
        buffer = "";
      } else if (text.includes("}")) {
        buffer = "";
      } else {
        buffer += " " + text;
      }
    }
    found.push({ cond, line: i + 1, selectors });
    i = j - 1;
  }
  return found;
}

/* Frozen on the day the layout layer landed. Every entry is a selector whose
   arrangement is decided by which of two distant blocks comes last in the
   file. The migration to [data-layout] empties this; nothing may be added. */
const KNOWN_SPLIT: Record<string, number> = {
  ".autopause-toggle": 2, //  903, 2445
  ".pig-launch": 4, //        903, 1512, 1517, 2209
  ".transport-bar": 3, //     1512, 2209, 2445
  ".win": 2, //               903, 2445
  ".win-body": 2, //          903, 2445
  ".world-strip": 3, //       1512, 1532, 2209
};

test("no selector is newly split across responsive blocks", () => {
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  const where = new Map<string, Set<number>>();

  for (const block of blocksOf(css)) {
    for (const sel of new Set(block.selectors)) {
      if (!where.has(sel)) where.set(sel, new Set());
      where.get(sel)!.add(block.line);
    }
  }

  const split: Record<string, number> = {};
  for (const [sel, lines] of where) if (lines.size > 1) split[sel] = lines.size;

  for (const [sel, count] of Object.entries(split)) {
    const allowed = KNOWN_SPLIT[sel];
    assert.ok(
      allowed !== undefined,
      `${sel} is now declared in ${count} responsive blocks. Put the compact ` +
        `arrangement beside the base rule under [data-layout="phone"] instead.`,
    );
    assert.ok(
      count <= allowed,
      `${sel} went from ${allowed} responsive blocks to ${count}.`,
    );
  }

  /* And when one is repaid, this list must be trimmed in the same commit —
     a stale debt list tells the next agent the sweep is done when it is not. */
  for (const [sel, allowed] of Object.entries(KNOWN_SPLIT)) {
    assert.equal(
      split[sel] ?? 0,
      allowed,
      `${sel} is down to ${split[sel] ?? 0} blocks — remove it from KNOWN_SPLIT.`,
    );
  }
});
