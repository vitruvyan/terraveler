import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("backend config names data and identity planes explicitly", () => {
  const config = read("lib/backendConfig.ts");
  assert.match(config, /POSTGREST_URL/);
  assert.match(config, /POSTGREST_SERVICE_KEY/);
  assert.match(config, /SUPABASE_AUTH_URL/);
  assert.match(config, /SUPABASE_AUTH_KEY/);
  assert.match(config, /process\.env\.SUPABASE_URL/); // one intentional legacy alias boundary
  assert.match(config, /process\.env\.SUPABASE_SERVICE_KEY/);
});

test("atlas data never uses the Supabase identity project as a content database", () => {
  const data = read("lib/data.ts");
  assert.match(data, /POSTGREST_URL/);
  assert.doesNotMatch(data, /getSupabase|NEXT_PUBLIC_SUPABASE|SUPABASE_AUTH/);
  assert.doesNotMatch(data, /\.\/supabase/);
});

test("desk auth sends auth and data operations to different backends", () => {
  const auth = read("lib/deskAuth.ts");
  assert.match(auth, /SUPABASE_AUTH_URL}\/auth\/v1/);
  assert.match(auth, /POSTGREST_URL}\/rest\/v1/);
  assert.doesNotMatch(auth, /const SB_URL|const SB_KEY/);
});

test("operator and agent documentation states Supabase is auth-only", () => {
  const env = read(".env.example");
  const agents = read("AGENTS.md");
  assert.match(env, /DATA PLANE: PostgreSQL on the Terraveler VPS/);
  assert.match(env, /IDENTITY PLANE: Supabase Auth only/);
  assert.match(agents, /Supabase Auth only/);
  assert.match(agents, /Supabase project's database is\n  \*\*not\*\* Terraveler's canonical application database/);
  assert.match(agents, /historical directory name `supabase\/\*\.sql`/);
});
