import test from "node:test";
import assert from "node:assert/strict";
import { askEditorialCoordinator, parseCoordinatorAnswer } from "../lib/editorialCoordinator";
const agent = { role: "coordinator", model: "frozen-model", instructions: "Help the editor." };
const env = { EDITOR_LIMEN_BASE_URL: "http://limen:8000", EDITOR_LIMEN_API_KEY: "scoped-key", EDITOR_LIMEN_DATA_CLASS: "editorial" };
test("coordinator accepts only reply or bounded pipeline brief", () => {
  assert.deepEqual(parseCoordinatorAnswer('{"action":"reply","reply":"Hello"}'), { action: "reply", reply: "Hello" });
  assert.equal(parseCoordinatorAnswer('{"action":"start_pipeline","reply":"Queued","brief":"Study the voyage"}').brief, "Study the voyage");
  for (const v of ["plain text", '{"action":"publish","reply":"Done"}', '{"action":"start_pipeline","reply":"OK"}', '{"action":"reply","reply":"OK","tool":"x"}', '{"action":"reply","reply":"OK","brief":"hidden"}'])
    assert.throws(() => parseCoordinatorAnswer(v));
});
test("coordinator uses frozen model through scoped Limen only", async () => {
  let calls = 0;
  const fetcher = async (url: any, init: any) => {
    calls++;
    assert.equal(url, "http://limen:8000/v1/chat/completions");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, "Bearer scoped-key");
    assert.equal(init.headers["X-Limen-Data-Class"], "editorial");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "frozen-model");
    assert.equal(body.tools, undefined);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"reply","reply":"Ready"}' } }] }));
  };
  assert.equal((await askEditorialCoordinator("Status?", { title: "Voyage" }, [], agent, env, fetcher as typeof fetch)).reply, "Ready");
  assert.equal(calls, 1);
});
test("missing gateway and failed gateway never fall back", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response("denied", { status: 503 }); };
  await assert.rejects(askEditorialCoordinator("Hi", {}, [], agent, {}, fetcher as typeof fetch));
  assert.equal(calls, 0);
  await assert.rejects(askEditorialCoordinator("Hi", {}, [], agent, env, fetcher as typeof fetch));
  assert.equal(calls, 1);
});
test("long dossier context preserves newest complete turns and valid JSON", async () => {
 const { coordinatorContext } = await import("../lib/editorialCoordinator");
 const latest = { role: "assistant", content: "The archive date is 1767." };
 const context = coordinatorContext({ title: "Voyage", latest_draft: { title: "Draft", body: "x".repeat(50000) } },
  [{ role: "user", content: "old".repeat(6000) }, { role: "user", content: "What was the date?" }, latest]);
 assert.deepEqual(context.history.at(-1), latest);
 assert.equal(context.project.latest_draft?.truncated, true);
 assert.ok(JSON.stringify(context).length < 48000);
 assert.equal(JSON.parse(JSON.stringify(context)).history.at(-1).content, latest.content);
});
