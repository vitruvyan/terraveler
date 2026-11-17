import { dataRpc } from "@/lib/deskAuth";
import { sourceTextRetentionAllowed } from "@/lib/sourceSearch";
export type MCPConsultationReceipt = { id: string; response_sha256: string; arguments_sha256: string; created_at: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Trusted MCP dispatcher only: source bytes and hashes are never accepted from a public receipt-write API. */
export async function recordMCPConsultation(
  tool: "get_wikipedia_outline" | "fetch_source_text", args: Record<string, unknown>, response: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env, rpc = dataRpc, mayRetain = sourceTextRetentionAllowed,
): Promise<MCPConsultationReceipt | null> {
  if (env.EDITORIAL_MCP_RECEIPTS_ENABLED !== "1") return null;
  const url = tool === "get_wikipedia_outline" ? response.requested_url : response.url;
  if (typeof url !== "string" || !await mayRetain(url))
    throw Error("This source is not authorized for raw-text receipt storage. Per-item verification or link-only handling is required.");
  const responseText = JSON.stringify(response);
  if (Buffer.byteLength(responseText, "utf8") > 1048576) throw Error("MCP consultation snapshot exceeds the storage limit.");
  try {
    const value = await rpc("editorial_record_mcp_consultation", { p_tool: tool, p_arguments: args, p_response_text: responseText });
    if (!value || typeof value.id !== "string" || !UUID.test(value.id) ||
        !/^[0-9a-f]{64}$/.test(value.response_sha256 ?? "") || !/^[0-9a-f]{64}$/.test(value.arguments_sha256 ?? "") ||
        typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))) throw Error("Invalid receipt");
    return { id: value.id, response_sha256: value.response_sha256, arguments_sha256: value.arguments_sha256, created_at: value.created_at };
  } catch {
    throw Error("The MCP consultation could not be recorded. Retry after checking the receipt service.");
  }
}
