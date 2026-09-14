import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHARTROOM_MCP_CAPABILITIES } from "../lib/chartroom";

function flattenTools(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(flattenTools);
}

test("every public Chartroom capability exists in the MCP tool catalogue", () => {
  const route = readFileSync(join(__dirname, "../app/api/mcp/route.ts"), "utf8");
  const tools = [...new Set(flattenTools(CHARTROOM_MCP_CAPABILITIES))];

  for (const tool of tools) {
    assert.match(
      route,
      new RegExp(`name:\\s*["']${tool}["']`),
      `Chartroom capability '${tool}' is missing from the MCP tool catalogue`,
    );
  }
});

test("source proposals use Source Governance rather than generic idea proposals", () => {
  const chartroom = readFileSync(join(__dirname, "../lib/chartroom.ts"), "utf8");

  assert.match(chartroom, /buildAgentSourceProposalPrompt[\s\S]*suggest_source/);
  assert.match(chartroom, /Do NOT use[\s\S]*propose_idea/);
});

test("Chartroom source capability remains protected by contribute scope", () => {
  const capabilities = readFileSync(join(__dirname, "../lib/agentCapabilities.ts"), "utf8");
  assert.match(capabilities, /suggest_source:\s*["']contribute["']/);
});
