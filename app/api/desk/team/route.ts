import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { readDeskRows } from "@/lib/deskQueue";
import { parseAgentConfiguration, saveAgentConfiguration, teamModelCatalogue } from "@/lib/editorialTeam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return reply({ error: auth.error }, 401);
  try {
    const [agents, catalogue] = await Promise.all([
      readDeskRows("editorial_agents_current?select=agent_key,version,name,role,model,instructions,enabled,created_at&order=agent_key.asc"),
      teamModelCatalogue(),
    ]);
    return reply({ agents, models: catalogue.models, gateway: { status: catalogue.status }, execution: "not-observed" });
  } catch { return reply({ error: "The team registry is unavailable. Apply the editorial team migration to the canonical VPS database.", code: "team-unavailable" }, 503); }
}
export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return reply({ error: auth.error }, 401);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return reply({ error: "invalid-origin" }, 403);
  if (Number(req.headers.get("content-length")) > 80000) return reply({ error: "request-too-large" }, 413);
  const raw = await req.text();
  if (raw.length > 80000) return reply({ error: "request-too-large" }, 413);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return reply({ error: "invalid-json" }, 400); }
  const config = parseAgentConfiguration(value);
  if (!config) return reply({ error: "invalid-agent" }, 400);
  // Pausing or drafting a configuration must remain possible during a gateway outage.
  if (config.enabled) {
    const catalogue = await teamModelCatalogue();
    if (catalogue.status !== "ready") return reply({ error: "The gateway is unavailable. Save this configuration as paused.", code: "gateway-unavailable" }, 503);
    if (!catalogue.models.some(m => m.id === config.model)) return reply({ error: "Choose a model currently visible through Limen.", code: "model-unavailable" }, 400);
  }
  try {
    const result = await saveAgentConfiguration(config);
    if (result?.error) return reply(result, ["conflict", "idempotency-conflict"].includes(result.error) ? 409 : 400);
    return reply({ ok: true, result, execution: "not-observed" });
  } catch { return reply({ error: "Could not save the configuration. Retry with the same request ID.", code: "team-unavailable" }, 503); }
}
