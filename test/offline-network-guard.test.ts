import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("offline preload blocks unmocked external fetch before transport", async () => {
  let calls = 0;
  const context = vm.createContext({ URL, fetch: async () => { calls++; return "fixture"; } });
  vm.runInContext(await readFile("test/offline-network-guard.mjs", "utf8"), context);
  await assert.rejects(context.fetch("https://unmocked.invalid/source"), /offline-test-unmocked-fetch/);
  await assert.rejects(context.fetch({ url: "https://unmocked.invalid/api" }), /offline-test-unmocked-fetch/);
  assert.equal(calls, 0);
});

test("offline preload permits local TLS fixture without following redirects", async () => {
  let options: any;
  const context = vm.createContext({ URL, fetch: async (_input: any, init: any) => { options = init; return "fixture"; } });
  vm.runInContext(await readFile("test/offline-network-guard.mjs", "utf8"), context);
  assert.equal(await context.fetch("https://localhost:3000/", { redirect: "follow" }), "fixture");
  assert.equal(options.redirect, "error");
});
