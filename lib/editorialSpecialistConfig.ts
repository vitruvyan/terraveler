import { dataRpc } from "@/lib/deskAuth";
import { parseAgentConfiguration } from "@/lib/editorialTeam";
import { editorialSpecialist } from "@/lib/editorialSpecialists";

export function parseSpecialistConfiguration(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { specialty = null, ...legacy } = value as Record<string, unknown>;
  const config = parseAgentConfiguration(legacy);
  if (!config) return null;
  if (specialty === null) return { ...config, specialty: null };
  const template = editorialSpecialist(specialty);
  if (!template || template.role !== config.role || (config.enabled && template.implementation === "planned")) return null;
  return { ...config, specialty: template.id };
}
export function saveSpecialistConfiguration(config: NonNullable<ReturnType<typeof parseSpecialistConfiguration>>, rpc = dataRpc) {
  return rpc("desk_save_editorial_specialist_agent", Object.fromEntries(Object.entries(config).map(([k,v]) => [`p_${k}`, v])));
}
