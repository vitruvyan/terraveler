import { NextResponse } from "next/server";
import { sb, rpc, editorEmail } from "@/lib/deskAuth";
import { CARTA_VERSION } from "@/lib/carta";
import { resolveVerdict } from "@/lib/deskVerdict";
import { answerCallbackQuery, closeMessage, telegramConfigured, verifyWebhookSecret } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Answers the Accept / Reject buttons on a source-proposal or escalated-
 * submission notification. The "Review" button on those same messages is a
 * plain Telegram URL button straight to the desk — it never reaches here.
 *
 * Callback data is "<domain>:<action>:<id>" — "src:approve:123" or
 * "sub:reject:47" — kept short because Telegram caps callback_data at 64
 * bytes. The domain lets one webhook answer both queues without guessing
 * which table an id belongs to.
 */

const RIGHTS_FALLBACK = "unknown";

async function editorPrincipalId(): Promise<number | null> {
  const rows = await sb("GET", `human_principals?email=eq.${encodeURIComponent(editorEmail())}&select=id`);
  return rows[0]?.id ?? null;
}

type Outcome = { toast: string; alert: boolean; outcome: string };

async function handleSourceCallback(action: "approve" | "reject", proposalId: number): Promise<Outcome> {
  const rows = await sb("GET",
    `source_proposals?id=eq.${proposalId}&select=id,target_url,status,` +
    `source_proposal_intents(reason,suggested_trust_mode,suggested_rights_class)`);
  const proposal = rows[0];
  if (!proposal) return { toast: "Proposta non trovata.", alert: true, outcome: "not found" };
  if (proposal.status !== "submitted") {
    return { toast: `Già risolta (${proposal.status}).`, alert: true, outcome: `Già risolta (${proposal.status}).` };
  }

  const intent = proposal.source_proposal_intents?.[0];
  const trustMode: string | null = intent?.suggested_trust_mode ?? null;
  const rightsClass: string = intent?.suggested_rights_class ?? RIGHTS_FALLBACK;

  if (action === "approve" && !trustMode) {
    return {
      toast: "L'agente non ha suggerito un trust_mode — serve una scelta manuale sul desk (bottone Rivedi).",
      alert: true, outcome: "needs manual trust_mode",
    };
  }

  const editorId = await editorPrincipalId();
  if (!editorId) return { toast: "Nessun editor registrato in human_principals.", alert: true, outcome: "no editor principal" };

  const reason = action === "approve"
    ? `Approvato via Telegram — classificazione dell'agente proponente accettata: ${trustMode}/${rightsClass}.`
    : "Rifiutato via Telegram.";

  const result = await rpc("mcp_resolve_source_proposal", {
    p_proposal_id: proposalId,
    p_decision: action,
    p_trust_mode: action === "approve" ? trustMode : null,
    p_rights_class: rightsClass,
    p_reason: reason,
    p_decided_by_actor_type: "human",
    p_decided_by_actor_id: editorId,
    p_carta_version: CARTA_VERSION,
  });
  if (result?.error) return { toast: String(result.error).slice(0, 190), alert: true, outcome: `Errore: ${result.error}` };

  return action === "approve"
    ? { toast: "✅ Fonte approvata.", alert: false, outcome: `✅ Approvata via Telegram (${trustMode}/${rightsClass}).` }
    : { toast: "❌ Fonte rifiutata.", alert: false, outcome: "❌ Rifiutata via Telegram." };
}

async function handleSubmissionCallback(action: "approve" | "reject", submissionId: number): Promise<Outcome> {
  const rows = await sb("GET", `submissions?id=eq.${submissionId}&select=status`);
  if (!rows.length) return { toast: "Submission non trovata.", alert: true, outcome: "not found" };
  const from = String(rows[0].status);
  if (["approved", "rejected"].includes(from)) {
    return { toast: `Già decisa (${from}).`, alert: true, outcome: `Già decisa (${from}).` };
  }

  const result = await resolveVerdict(submissionId, action, {
    override: action === "approve"
      ? "Approvato via Telegram in risposta all'escalation del Curatore."
      : undefined,
    origin: "telegram",
  });
  if (!result.ok) return { toast: result.error.slice(0, 190), alert: true, outcome: `Errore: ${result.error}` };

  return action === "approve"
    ? { toast: "✅ Submission approvata.", alert: false, outcome: "✅ Approvata via Telegram." }
    : { toast: "❌ Submission rifiutata.", alert: false, outcome: "❌ Rifiutata via Telegram." };
}

export async function POST(req: Request) {
  if (!verifyWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!telegramConfigured()) {
    return NextResponse.json({ error: "TELEGRAM_TOKEN not configured" }, { status: 500 });
  }

  const update = await req.json().catch(() => null);
  const cq = update?.callback_query;
  // Telegram expects 200 for any update type it isn't told to retry — only
  // callback_query with the shape a button press produces is ours to act on.
  if (!cq?.id || !cq?.data || !cq?.message?.chat?.id || !cq?.message?.message_id) {
    return NextResponse.json({ ok: true });
  }

  const [domain, action, idStr] = String(cq.data).split(":");
  const id = Number(idStr);
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const originalText = String(cq.message.text ?? "");

  if (!["approve", "reject"].includes(action) || !Number.isInteger(id)) {
    await answerCallbackQuery(cq.id, "Azione non riconosciuta.", true);
    return NextResponse.json({ ok: true });
  }

  try {
    const result =
      domain === "src" ? await handleSourceCallback(action as "approve" | "reject", id) :
      domain === "sub" ? await handleSubmissionCallback(action as "approve" | "reject", id) :
      null;

    if (!result) {
      await answerCallbackQuery(cq.id, "Tipo di proposta non riconosciuto.", true);
      return NextResponse.json({ ok: true });
    }

    await answerCallbackQuery(cq.id, result.toast, result.alert);
    if (!result.alert) {
      await closeMessage(chatId, messageId, originalText, result.outcome);
    }
  } catch (e: any) {
    await answerCallbackQuery(cq.id, `Errore: ${String(e?.message || e).slice(0, 150)}`, true);
  }

  return NextResponse.json({ ok: true });
}
