import { dataRpc } from "@/lib/deskAuth";

export const TEAM_ROLES = ["coordinator", "research", "writer", "reviewer"] as const;
export type TeamRole = typeof TEAM_ROLES[number];
export type AgentConfiguration = {
  agent_key: string; name: string; role: TeamRole; model: string;
  instructions: string; enabled: boolean; expected_version: number; request_id: string;
};
export type EditorialAgent = Omit<AgentConfiguration, "expected_version" | "request_id"> & {
  version: number; created_at: string;
};
export function parseAgentConfiguration(value: unknown): AgentConfiguration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const keys = ["agent_key", "name", "role", "model", "instructions", "enabled", "expected_version", "request_id"];
  if (Object.keys(v).some(k => !keys.includes(k))) return null;
  if (typeof v.agent_key !== "string" || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(v.agent_key) ||
      typeof v.name !== "string" || !v.name.trim() || v.name.trim().length > 120 ||
      !TEAM_ROLES.includes(v.role as TeamRole) || typeof v.model !== "string" ||
      !v.model.trim() || v.model.trim().length > 200 || /[\r\n]/.test(v.model) ||
      typeof v.instructions !== "string" || !v.instructions.trim() || v.instructions.trim().length > 12000 ||
      typeof v.enabled !== "boolean" || !Number.isSafeInteger(v.expected_version) || Number(v.expected_version) < 0 || Number(v.expected_version) > 2147483646 ||
      typeof v.request_id !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(v.request_id)) return null;
  return { agent_key: v.agent_key, name: v.name.trim(), role: v.role as TeamRole,
    model: v.model.trim(), instructions: v.instructions.trim(), enabled: v.enabled,
    expected_version: Number(v.expected_version), request_id: v.request_id };
}
export function saveAgentConfiguration(input: AgentConfiguration, rpc = dataRpc) {
  return rpc("desk_save_editorial_agent", Object.fromEntries(Object.entries(input).map(([k, v]) => [`p_${k}`, v])));
}

export type TeamGateway = { status: "ready" | "not-configured" | "unavailable"; models: { id: string }[] };
/** Only model IDs visible to this scoped key; never provider keys, URLs or metadata. */
export async function teamModelCatalogue(env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch): Promise<TeamGateway> {
  const base = env.EDITOR_LIMEN_BASE_URL?.trim();
  const key = env.EDITOR_LIMEN_API_KEY?.trim();
  const dataClass = env.EDITOR_LIMEN_DATA_CLASS?.trim();
  if (!base || !key || key.length > 4096 || /[\r\n]/.test(key) ||
      !dataClass || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(dataClass)) return { status: "not-configured", models: [] };
  let url: URL;
  try {
    url = new URL(base);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    if (["api.openai.com", "api.anthropic.com", "openrouter.ai"].includes(url.hostname.toLowerCase())) throw new Error();
  } catch { return { status: "not-configured", models: [] }; }
  const endpoint = url.toString().replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(`${endpoint.endsWith("/v1") ? endpoint : endpoint + "/v1"}/models`, {
      redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "X-Limen-Data-Class": dataClass, "X-Limen-Mode": "documents" },
    });
    if (!response.ok) throw new Error();
    const raw = await response.text();
    if (raw.length > 262144) throw new Error();
    const body = JSON.parse(raw);
    if (!Array.isArray(body?.data) || body.data.length > 1000) throw new Error();
    const ids = body.data.map((item: any) => item?.id);
    if (ids.some((id: unknown) => typeof id !== "string" || !id.trim() || id.length > 200 || /[\r\n]/.test(id))) throw new Error();
    return { status: "ready", models: [...new Set<string>(ids)].sort().map(id => ({ id })) };
  } catch { return { status: "unavailable", models: [] }; }
  finally { clearTimeout(timer); }
}
