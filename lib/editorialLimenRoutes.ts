/** Server-only route credentials. Each alias must have its own Limen policy group
 * and virtual key, restricted to that exact model. No default-key fallback. */
type Env = Record<string, string | undefined>;
const modelId = (v: string) => /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(v);
const secret = (v: unknown): v is string => typeof v === "string" && v.length > 0 &&
  v.length <= 4096 && !/\s/.test(v);

export function editorialModelKeys(env: Env = process.env): Map<string, string> | null {
  const defaultModel = env.EDITOR_LIMEN_MODEL ?? "local-default";
  const key = env.EDITOR_LIMEN_API_KEY?.trim();
  if (!modelId(defaultModel) || !secret(key)) return null;
  const routes = new Map([[defaultModel, key]]);
  const raw = env.EDITOR_LIMEN_MODEL_KEYS;
  if (raw === undefined || raw === "") return routes;
  if (raw.length > 140000) return null;
  try {
    const own: unknown = JSON.parse(raw);
    if (!own || typeof own !== "object" || Array.isArray(own)) return null;
    const entries = Object.entries(own);
    if (entries.length > 31) return null;
    for (const [id, value] of entries) {
      if (!modelId(id) || !secret(value) || routes.has(id) ||
          [...routes.values()].includes(value)) return null;
      routes.set(id, value);
    }
    return routes;
  } catch { return null; }
}

export function editorialModelKey(model: string, env: Env = process.env): string | undefined {
  return editorialModelKeys(env)?.get(model);
}
