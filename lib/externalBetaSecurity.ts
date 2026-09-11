import { createHmac, randomUUID } from "node:crypto";
import { rpc, sb } from "@/lib/deskAuth";
import { sha256 } from "@/lib/oauth";

export const MCP_BODY_LIMIT = 384 * 1024;
export const AGENT_WRITE_BODY_LIMIT = 320 * 1024;
export const ENROLLMENT_BODY_LIMIT = 32 * 1024;

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export type RequestSource = {
  requestId: string;
  sourceHash: string;
  networkHash: string;
};

type LimitedText = { ok: true; value: string } | { ok: false; status: 413; error: string };
type LimitedJson = { ok: true; value: any } | { ok: false; status: 400 | 413; error: string };

/** Read a request body while enforcing the byte ceiling before buffering it. */
export async function readLimitedText(req: Request, maxBytes: number): Promise<LimitedText> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes)
    return { ok: false, status: 413, error: `request body exceeds ${maxBytes} bytes` };

  const reader = req.body?.getReader();
  if (!reader) return { ok: true, value: "" };

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, error: `request body exceeds ${maxBytes} bytes` };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return { ok: true, value: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8") };
}

/** Parse JSON on top of the streaming body ceiling. */
export async function readLimitedJson(req: Request, maxBytes: number, allowEmpty = false): Promise<LimitedJson> {
  const read = await readLimitedText(req, maxBytes);
  if (!read.ok) return read;
  const text = read.value;
  if (allowEmpty && !text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "body must be valid JSON" };
  }
}

function sourceAddress(req: Request): string {
  return (req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-forwarded-for") ?? "unknown")
    .split(",")[0].trim().toLowerCase() || "unknown";
}

function networkOf(ip: string): string {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 4).join(":")}::/64`;
  return "unknown";
}

function pepper(): string | null {
  const value = (process.env.MCP_SECURITY_PEPPER ?? "").trim();
  return value.length >= 32 ? value : null;
}

function protectedHash(value: string): string {
  const key = pepper();
  if (!key) throw new Error("MCP_SECURITY_PEPPER is missing or too short");
  return createHmac("sha256", key).update(value).digest("hex").slice(0, 40);
}

function auditHash(value: string): string {
  const key = pepper();
  if (!key) return "unavailable";
  return createHmac("sha256", key).update(value).digest("hex").slice(0, 40);
}

export function requestSource(req: Request): RequestSource {
  const ip = sourceAddress(req);
  const supplied = req.headers.get("mcp-request-id") ?? req.headers.get("x-request-id");
  return {
    requestId: supplied?.trim().slice(0, 160) || randomUUID(),
    sourceHash: auditHash(`ip:${ip}`),
    networkHash: auditHash(`network:${networkOf(ip)}`),
  };
}

/** External mutations are opt-in and fail closed. */
export function mutationsEnabled(): boolean {
  const enabled = /^(1|true|on|enabled)$/i.test(process.env.MCP_EXTERNAL_MUTATIONS_ENABLED ?? "");
  return enabled && pepper() !== null;
}

export function mutationGuardReason(): string | null {
  if (!/^(1|true|on|enabled)$/i.test(process.env.MCP_EXTERNAL_MUTATIONS_ENABLED ?? ""))
    return "external mutation kill switch";
  if (!pepper()) return "security pepper missing or too short";
  return null;
}

type LimitDimension = { dimension: string; subject: string; limit: number };

export async function enforceLimits(
  action: string, windowSeconds: number, dimensions: LimitDimension[],
): Promise<{ allowed: true } | { allowed: false; retryAfter: number; dimension: string }> {
  for (const d of dimensions) {
    if (!d.subject) continue;
    const rows = await rpc("mcp_security_consume_limit", {
      p_dimension: d.dimension,
      p_subject_hash: protectedHash(`${d.dimension}:${d.subject}`),
      p_action: action,
      p_window_seconds: windowSeconds,
      p_limit: d.limit,
    });
    const result = rows?.[0];
    if (!result?.allowed) {
      const reset = new Date(result?.resets_at ?? Date.now() + windowSeconds * 1000).getTime();
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((reset - Date.now()) / 1000)), dimension: d.dimension };
    }
  }
  return { allowed: true };
}

export async function acquireMutationLease(agentAccountId: number, action: string, requestId: string) {
  const leaseKey = protectedHash(`lease:${agentAccountId}:${action}`);
  const rows = await rpc("mcp_security_acquire_lease", {
    p_lease_key: leaseKey, p_request_id: requestId, p_ttl_seconds: 30,
  });
  return { acquired: rows === true || rows?.[0] === true, leaseKey };
}

export async function releaseMutationLease(leaseKey: string, requestId: string) {
  await rpc("mcp_security_release_lease", { p_lease_key: leaseKey, p_request_id: requestId }).catch(() => {});
}

export function idempotencyKey(req: Request, body: any): string | null {
  const key = req.headers.get("idempotency-key") ?? req.headers.get("mcp-request-id") ??
    (typeof body?.arguments?.request_id === "string" ? body.arguments.request_id : null);
  const clean = key?.trim() ?? "";
  return clean.length >= 8 && clean.length <= 200 ? clean : null;
}

export async function beginIdempotent(agentAccountId: number, action: string, key: string, body: any) {
  return rpc("mcp_security_begin_idempotent", {
    p_agent_account_id: agentAccountId,
    p_action: action,
    p_key_hash: protectedHash(`idempotency:${key}`),
    p_request_hash: sha256(JSON.stringify(body)),
  });
}

export async function completeIdempotent(
  agentAccountId: number, action: string, key: string, status: number, body: unknown,
) {
  await rpc("mcp_security_complete_idempotent", {
    p_agent_account_id: agentAccountId,
    p_action: action,
    p_key_hash: protectedHash(`idempotency:${key}`),
    p_response_status: status,
    p_response_body: body,
  });
}

export async function securityAudit(event: {
  source: RequestSource;
  action: string;
  outcome: "accepted" | "rejected" | "failed" | "replayed";
  status: number;
  reason?: string | null;
  agentId?: string | null;
  agentAccountId?: number | null;
  connectionId?: number | null;
  clientId?: string | null;
}) {
  await sb("POST", "mcp_security_audit", {
    request_id: event.source.requestId,
    agent_id: event.agentId ?? null,
    agent_account_id: event.agentAccountId ?? null,
    connection_id: event.connectionId ?? null,
    client_id: event.clientId?.slice(0, 200) ?? null,
    action: event.action.slice(0, 120),
    outcome: event.outcome,
    http_status: event.status,
    rejection_reason: event.reason?.slice(0, 500) ?? null,
    source_hash: event.source.sourceHash,
    network_hash: event.source.networkHash,
  }).catch(() => {});
}
