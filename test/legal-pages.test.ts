import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

test("public legal pages exist and expose canonical metadata", async () => {
  const privacy = await read("../app/privacy/page.tsx");
  const terms = await read("../app/terms/page.tsx");
  const cookies = await read("../app/cookies/page.tsx");

  assert.match(privacy, /canonical:\s*"\/privacy"/);
  assert.match(terms, /canonical:\s*"\/terms"/);
  assert.match(cookies, /canonical:\s*"\/cookies"/);

  assert.match(privacy, /Vitruvyan EOOD/);
  assert.match(terms, /publication authority remains human/);
  assert.match(cookies, /desk_token/);
  assert.match(cookies, /desk_refresh/);
});

test("site footer links the legal surface", async () => {
  const footer = await read("../components/SiteFooter.tsx");
  assert.match(footer, /href="\/privacy"/);
  assert.match(footer, /href="\/terms"/);
  assert.match(footer, /href="\/cookies"/);
});

test("cookie policy does not claim a consent banner while tracking stays cookie-free", async () => {
  const cookies = await read("../app/cookies/page.tsx");
  const beacon = await read("../components/PageviewBeacon.tsx");
  const track = await read("../app/api/track/route.ts");

  assert.match(cookies, /does not show a generic.*accept cookies.*banner/s);
  assert.equal(beacon.includes("localStorage"), false);
  assert.equal(beacon.includes("document.cookie"), false);
  assert.match(track, /p_path:\s*path/);
  assert.match(track, /p_referrer_host:\s*referrer_host/);
});
