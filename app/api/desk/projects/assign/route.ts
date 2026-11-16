import { NextResponse } from "next/server";
import { requireEditor, dataRpc } from "@/lib/deskAuth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return reply({ error: auth.error }, 401);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return reply({ error: "invalid-origin" }, 403);
  if (Number(req.headers.get("content-length")) > 8000) return reply({ error: "request-too-large" }, 413);
  const text = await req.text();
  if (text.length > 8000) return reply({ error: "request-too-large" }, 413);
  let v: any;
  try { v = JSON.parse(text); } catch { return reply({ error: "invalid-json" }, 400); }
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !["task_id", "agent_key", "specialty", "request_id"].includes(k)) ||
      !Number.isSafeInteger(v.task_id) || v.task_id < 1 || typeof v.agent_key !== "string" || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(v.agent_key) ||
      typeof v.specialty !== "string" || !/^[a-z][a-z-]{1,63}$/.test(v.specialty) || typeof v.request_id !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(v.request_id)) return reply({ error: "invalid-assignment" }, 400);
  try {
    const result = await dataRpc("editorial_assign_specialist", { p_task_id: v.task_id, p_agent_key: v.agent_key, p_specialty: v.specialty, p_request_id: v.request_id });
    if (result?.error) return reply(result, 409);
    return reply({ result, execution: "assignment-recorded-only" });
  } catch {
    return reply({ error: "Assignment could not be recorded. Check task state, specialist compatibility and the specialist migration; retry with the same request ID.", code: "assignment-unavailable" }, 409);
  }
}
