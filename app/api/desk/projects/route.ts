import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { applyProjectAction, editorialExecution, parseProjectAction, positiveTopic, readEditorialMessages, readEditorialProject, readEditorialProjects } from "@/lib/editorialProjects";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return reply({ error: auth.error }, 401);
  const raw = new URL(req.url).searchParams.get("topic_id");
  if (raw !== null && (!/^[1-9][0-9]*$/.test(raw) || !positiveTopic(Number(raw)))) return reply({ error: "invalid-topic" }, 400);
  try {
    const execution = editorialExecution();
    if (raw === null) return reply({ projects: await readEditorialProjects(), execution });
    const project = await readEditorialProject(Number(raw));
    if (!project) return reply({ error: "not-found" }, 404);
    return reply({ project, execution, messages: await readEditorialMessages(Number(raw)) });
  } catch { return reply({ error: "Projects are unavailable. Verify the editorial pipeline and chat migrations on the canonical VPS database.", code: "projects-unavailable" }, 503); }
}
export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return reply({ error: auth.error }, 401);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return reply({ error: "invalid-origin" }, 403);
  if (Number(req.headers.get("content-length")) > 80000) return reply({ error: "request-too-large" }, 413);
  const raw = await req.text();
  if (raw.length > 80000) return reply({ error: "request-too-large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: "invalid-json" }, 400); }
  const action = parseProjectAction(body);
  if (!action) return reply({ error: "invalid-project-action" }, 400);
  if (action.action === "start" && !editorialExecution().configured) return reply({ error: "Agent work is disabled by the operator.", code: "workflow-disabled" }, 503);
  try {
    const result = await applyProjectAction(action);
    if (result?.error) return reply(result, 409);
    return reply(action.action === "start" ? { action_receipt: result } : { result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/conflict|already (active|linked)|approved submission required/.test(message)) return reply({ error: "The proposal or project already has conflicting work. Refresh its current state before proceeding.", code: "project-conflict" }, 409);
    return reply({ error: "Could not record work. Retry with the same request ID after checking the database.", code: "projects-unavailable" }, 503);
  }
}
