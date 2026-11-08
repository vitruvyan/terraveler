import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("Limen preflight refuses absent binds and placeholder credentials without echoing secrets", t => {
  const dir = mkdtempSync(join(tmpdir(), "limen-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const model = join(dir, "litellm_config.yaml");
  const secret = "fixture-never-print-this";
  const config: any = { services: { terraveler_limen: {
    volumes: [{ type: "bind", source: model, target: "/app/limen/docker/litellm_config.yaml", read_only: true }],
    environment: Object.fromEntries(["DATABASE_URL", "LITELLM_MASTER_KEY", "LIMEN_ADMIN_TOKEN", "LIMEN_READ_TOKEN"].map(k => [k, secret])),
  } } };
  const run = () => spawnSync("python3", ["scripts/check_limen_config.py"], { input: JSON.stringify(config), encoding: "utf8" });
  assert.equal(run().status, 2);
  writeFileSync(model, "model_list: [] # REPLACE_ME\n");
  assert.equal(run().status, 2);
  writeFileSync(model, "model_list: []\n");
  assert.equal(run().status, 0); // Structural preflight, not provider validation.
  config.services.terraveler_limen.environment.LIMEN_ADMIN_TOKEN = "REPLACE_ME";
  const rejected = run();
  assert.equal(rejected.status, 2);
  assert.ok(!(rejected.stdout + rejected.stderr).includes(secret));
});

test("stack up selects only Limen and refuses dirty upstream source", t => {
  const temp = mkdtempSync(join(tmpdir(), "limen-wrapper-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, "repo");
  const state = join(temp, "state");
  const bin = join(temp, "bin");
  for (const p of [join(root, "scripts"), join(root, "vendor/limen/docker/wheels"), state, bin]) mkdirSync(p, { recursive: true });
  for (const f of ["limen-stack.sh", "check_limen_config.py"]) copyFileSync(`scripts/${f}`, join(root, "scripts", f));
  writeFileSync(join(root, "vendor/limen/docker/Dockerfile"), "FROM fixture");
  for (const wheel of ["vitruvyan_motus-0.23.0-py3-none-any.whl", "motus_anchor_opentimestamps-0.1.0-py3-none-any.whl"]) writeFileSync(join(root, "vendor/limen/docker/wheels", wheel), "");
  const stack = join(state, "stack.env");
  writeFileSync(stack, "");
  const model = join(state, "litellm_config.yaml");
  writeFileSync(model, "model_list: []\n");
  const config = { services: { terraveler_limen: { environment: { DATABASE_URL: "fixture", LITELLM_MASTER_KEY: "fixture", LIMEN_ADMIN_TOKEN: "fixture", LIMEN_READ_TOKEN: "fixture" }, volumes: [{ type: "bind", source: model, target: "/app/limen/docker/litellm_config.yaml", read_only: true }] } } };
  const calls = join(temp, "calls");
  const json = join(temp, "config.json");
  writeFileSync(json, JSON.stringify(config));
  writeFileSync(join(bin, "git"), '#!/bin/sh\ncase "$*" in *ls-files*) echo "160000 abc 0 vendor/limen";; *rev-parse*) echo abc;; *diff*) exit "${FIXTURE_DIRTY:-0}";; esac\n', { mode: 0o755 });
  writeFileSync(join(bin, "docker"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FIXTURE_CALLS"\ncase "$*" in *"config --format json"*) cat "$FIXTURE_JSON";; esac\n', { mode: 0o755 });
  const run = (dirty = false) => spawnSync("bash", [join(root, "scripts/limen-stack.sh"), "up", stack], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_CALLS: calls, FIXTURE_JSON: json, FIXTURE_DIRTY: dirty ? "1" : "0" } });
  assert.equal(run(true).status, 2);
  assert.equal(run().status, 0);
  const invoked = readFileSync(calls, "utf8");
  assert.match(invoked, /up -d --no-build terraveler_limen\n/);
  assert.doesNotMatch(invoked, /down|--remove-orphans|--volumes/);
});
