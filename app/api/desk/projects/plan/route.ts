import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { parseEditorialPlanRequest, readEditorialPlans, saveEditorialPlan } from "@/lib/editorialPlans";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return reply({ error: auth.error }, 401);
  const q = new URL(req.url).searchParams, topic = q.get("topic_id"), before = q.get("before");
  if ([...q.keys()].some(k => !["topic_id", "before"].includes(k)) || !topic || !/^[1-9][0-9]*$/.test(topic) ||
      !Number.isSafeInteger(Number(topic)) || (before !== null && (!/^[1-9][0-9]*$/.test(before) || !Number.isSafeInteger(Number(before))))) return reply({ error: "invalid-plan-query" }, 400);
  try { return reply(await readEditorialPlans(Number(topic), before === null ? null : Number(before))); }
  catch { return reply({ error: "Editorial plans are unavailable. Check the MCP plan migration on canonical VPS PostgreSQL." }, 503); }
}
export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return reply({ error: auth.error }, 401);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return reply({ error: "invalid-origin" }, 403);
  if (Number(req.headers.get("content-length")) > 262144) return reply({ error: "request-too-large" }, 413);
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > 262144) return reply({ error: "request-too-large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: "invalid-json" }, 400); }
  const input = parseEditorialPlanRequest(body);
  if (!input) return reply({ error: "invalid-editorial-plan" }, 400);
  try {
    const result = await saveEditorialPlan(input);
    return reply(result, result?.error ? 409 : 200);
  } catch {
    return reply({ error: "The plan could not be recorded. Verify its MCP receipts, completeness, version and database migration; retry unchanged to recover an uncertain response." }, 409);
  }
}
