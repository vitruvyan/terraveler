import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { parseEditorialStart, readEditorialWork, startEditorialWork } from "@/lib/editorialWorkflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});
function positiveId(raw: string | null): number | null {
  if (raw === null) return null;
  return /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : NaN;
}

export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return reply({ error: auth.error }, 401);
  const url = new URL(req.url);
  const topicId = positiveId(url.searchParams.get("topic_id"));
  const before = positiveId(url.searchParams.get("before"));
  if (Number.isNaN(topicId) || Number.isNaN(before)) return reply({ error: "invalid-id" }, 400);
  try {
    const result = await readEditorialWork(topicId, before);
    if ("topic" in result && !result.topic) return reply({ error: "not-found" }, 404);
    return reply(result);
  } catch {
    return reply({ error: "Editorial workflow is unavailable. Verify the canonical database migration.", code: "workflow-unavailable" }, 503);
  }
}

export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return reply({ error: auth.error }, 401);
  if (process.env.EDITORIAL_WORKFLOW_ENABLED !== "1") return reply({ error: "workflow-disabled" }, 503);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return reply({ error: "invalid-origin" }, 403);
  if (Number(req.headers.get("content-length")) > 16000) return reply({ error: "request-too-large" }, 413);
  const raw = await req.text();
  if (raw.length > 16000) return reply({ error: "request-too-large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: "invalid-json" }, 400); }
  const input = parseEditorialStart(body);
  if (!input) return reply({ error: "An approved submission, explicit topic key, title and objective are required." }, 400);
  try {
    const result = await startEditorialWork(input);
    if (result?.error) return reply(result, result.error === "not-found" ? 404 : result.error.includes("conflict") ? 409 : 400);
    return reply({ ok: true, result, publication: "human-authorization-required" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("idempotency conflict") || message.includes("already linked")) return reply({ error: "topic-conflict" }, 409);
    if (message.includes("approved submission required")) return reply({ error: "approved-submission-required" }, 409);
    return reply({ error: "Could not start editorial work. Retry the same topic and submission after checking the workflow migration.", code: "workflow-unavailable" }, 503);
  }
}
