import { dataRpc } from "@/lib/deskAuth";
import { CARTA_VERSION } from "@/lib/carta";
import { isVoyageSlug } from "@/lib/voyages";

export type EditorialTarget = "submission" | "project" | "voyage";
export type EditorAction = {
  action: "rename" | "request-revision";
  target_type: EditorialTarget;
  target_id: string;
  value: string;
  expected_version?: number;
  request_id: string;
  agent_account_id?: number;
};
export type TitleAudit = {
  id?: number;
  action: string;
  actor: string;
  findings: unknown;
};

/** The display title is separate from immutable submitted prose and published
 * bundles. The audit row ID is the optimistic concurrency version. */
export function editorialTitleFromAudit(
  audit: readonly TitleAudit[],
  type: EditorialTarget,
  id: string | number,
): { title: string | null; version: number } {
  let current = { title: null as string | null, version: 0 };
  for (const row of audit) {
    if (
      row.action !== "editorial-title" ||
      row.actor !== "editor-in-chief" ||
      !row.findings ||
      typeof row.findings !== "object" ||
      Array.isArray(row.findings)
    )
      continue;
    const f = row.findings as Record<string, unknown>;
    const version = Number(row.id);
    if (
      f.target_type === type &&
      String(f.target_id) === String(id) &&
      typeof f.title === "string" &&
      f.title.trim() &&
      Number.isSafeInteger(version) &&
      version > current.version
    ) {
      current = { title: f.title, version };
    }
  }
  return current;
}

export function parseEditorAction(body: unknown): EditorAction | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (
    !["rename", "request-revision"].includes(String(b.action)) ||
    !["submission", "project", "voyage"].includes(String(b.target_type))
  )
    return null;
  if (
    typeof b.target_id !== "string" ||
    typeof b.value !== "string" ||
    typeof b.request_id !== "string"
  )
    return null;
  const target = b.target_id.trim(),
    value = b.value.trim();
  if (
    !/^[a-zA-Z0-9_-]{16,100}$/.test(b.request_id) ||
    !value ||
    value.includes("\0")
  )
    return null;
  if (
    b.target_type === "voyage"
      ? !isVoyageSlug(target)
      : !/^[1-9]\d{0,14}$/.test(target)
  )
    return null;
  if (value.length > (b.action === "rename" ? 200 : 6000)) return null;
  if (
    b.action === "rename" &&
    (!Number.isSafeInteger(b.expected_version) ||
      Number(b.expected_version) < 0)
  )
    return null;
  if (
    b.agent_account_id != null &&
    (!Number.isSafeInteger(b.agent_account_id) ||
      Number(b.agent_account_id) < 1)
  )
    return null;
  return {
    action: b.action as EditorAction["action"],
    target_type: b.target_type as EditorialTarget,
    target_id: target,
    value,
    expected_version:
      b.expected_version == null ? undefined : Number(b.expected_version),
    request_id: b.request_id,
    agent_account_id:
      b.agent_account_id == null ? undefined : Number(b.agent_account_id),
  };
}

/** One RPC transaction writes both the operation and its audit; no REST fallback
 * can leave an unaudited task or duplicate a timed-out request. */
export async function executeEditorAction(
  action: EditorAction,
  rpc = dataRpc,
): Promise<Record<string, unknown>> {
  return rpc("desk_editorial_action", {
    p_action: action.action,
    p_target_type: action.target_type,
    p_target_id: action.target_id,
    p_value: action.value,
    p_expected_version: action.expected_version ?? null,
    p_request_id: action.request_id,
    p_agent_account_id: action.agent_account_id ?? null,
    p_carta: CARTA_VERSION,
  });
}
export function missingEditorActionMigration(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return (
    /desk_editorial_action/.test(message) &&
    /PGRST202|could not find|does not exist|schema cache/i.test(message)
  );
}
