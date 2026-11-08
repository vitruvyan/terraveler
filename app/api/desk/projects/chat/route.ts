import { NextResponse } from "next/server";
import { requireEditor, dataRpc } from "@/lib/deskAuth";
import { editorialExecution, readEditorialProject, readEditorialMessages } from "@/lib/editorialProjects";
import { askEditorialCoordinator } from "@/lib/editorialCoordinator";
import { EditorAIError } from "@/lib/editorLocalAI";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return reply({ error: auth.error }, 401);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return reply({ error: "invalid-origin" }, 403);
  if (Number(req.headers.get("content-length")) > 20000) return reply({ error: "request-too-large" }, 413);
  const raw = await req.text();
  if (raw.length > 20000) return reply({ error: "request-too-large" }, 413);
  let body: any;
  try { body = JSON.parse(raw); } catch { return reply({ error: "invalid-json" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(k => !["topic_id", "message", "request_id"].includes(k)) ||
      !Number.isSafeInteger(body.topic_id) || body.topic_id <= 0 ||
      typeof body.message !== "string" || !body.message.trim() || body.message.length > 12000 ||
      typeof body.request_id !== "string" || !/^[A-Za-z0-9_-]{8,160}$/.test(body.request_id))
    return reply({ error: "invalid-message" }, 400);
  if (!editorialExecution().configured) return reply({ error: "Coordinator requests are disabled by the operator.", code: "workflow-disabled" }, 503);
  let turn: any;
  try {
    turn = await dataRpc("editorial_chat_begin", { p_topic_id: body.topic_id,
      p_message: body.message.trim(), p_request_id: body.request_id });
    if (turn?.state === "completed") return reply({ ...turn, recorded: true });
    if (!turn?.lease_token) return reply({ ...turn, error: turn?.error === "coordinator-unavailable" ? "No enabled coordinator is available. Your message was saved." : turn?.error, recorded: !!turn?.state }, turn?.error === "coordinator-unavailable" ? 503 : turn?.error === "request-in-progress" ? 409 : 400);
    const [project, history] = await Promise.all([readEditorialProject(body.topic_id), readEditorialMessages(body.topic_id)]);
    if (!project) throw new Error("project-unavailable");
    const answer = await askEditorialCoordinator(body.message.trim(), project, history, turn.agent_config);
    const completed = await dataRpc("editorial_chat_complete", { p_request_id: body.request_id,
      p_lease_token: turn.lease_token, p_action: answer.action, p_reply: answer.reply, p_brief: answer.brief ?? null });
    return reply({ ...completed, recorded: true }, completed?.error ? 409 : 200);
  } catch (e) {
    const code = e instanceof EditorAIError ? e.code : "unavailable";
    if (turn?.lease_token) {
      try { await dataRpc("editorial_chat_fail", { p_request_id: body.request_id,
        p_lease_token: turn.lease_token, p_reason: code }); } catch { /* The bounded lease permits recovery. */ }
    }
    return reply({ error: "Il coordinatore non è disponibile. Riprova con lo stesso messaggio e identificativo.", code,
      recorded: !!turn?.lease_token, request_id: body.request_id }, 503);
  }
}
