import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { parseRetryTaskRequest, retryEditorialTask } from "@/lib/editorialDispatch";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return reply({ error: auth.error }, 401);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return reply({ error: "invalid-origin" }, 403);
  if (process.env.EDITORIAL_PLAN_DISPATCH_ENABLED !== "1" || process.env.EDITORIAL_MCP_CORPUS_ENABLED !== "1") return reply({ error: "retry-disabled" }, 503);
  if (Number(req.headers.get("content-length")) > 8192) return reply({ error: "request-too-large" }, 413);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 8192) return reply({ error: "request-too-large" }, 413);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return reply({ error: "invalid-json" }, 400); }
  const input = parseRetryTaskRequest(value);
  if (!input) return reply({ error: "invalid-retry" }, 400);
  try {
    return reply(await retryEditorialTask(input));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const reasons = ["invalid retry request", "task not found", "planned task required", "task is not retryable", "stale task attempt", "retry budget exhausted", "task already has result", "retry idempotency conflict"];
    const reason = reasons.find(item => message.includes(item));
    return reply({ error: reason ?? "retry-unavailable" }, reason ? 409 : 503);
  }
}
