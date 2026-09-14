/**
 * Server-side Telegram Bot API calls the webhook route needs to answer a
 * button press: acknowledge the tap and edit the original message so a
 * second tap can't resolve the same proposal or submission twice.
 *
 * Sending the initial notification (with its inline keyboard) is a
 * different concern and stays in the Python cron scripts on the VPS,
 * which already read Postgres directly — this file is only the Vercel
 * side of the conversation, answering back.
 */

const TELEGRAM_TOKEN = (process.env.TELEGRAM_TOKEN ?? "").trim();
const TELEGRAM_WEBHOOK_SECRET = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();

export function telegramConfigured(): boolean {
  return Boolean(TELEGRAM_TOKEN);
}

/** Telegram signs every webhook delivery with the secret_token set at
 *  registration time, echoed back in this header — the one thing standing
 *  between the internet and mcp_resolve_source_proposal / a submission
 *  verdict. Reject anything that doesn't carry it before parsing the body. */
export function verifyWebhookSecret(header: string | null): boolean {
  return Boolean(TELEGRAM_WEBHOOK_SECRET) && header === TELEGRAM_WEBHOOK_SECRET;
}

async function call(method: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) {
    throw new Error(`telegram ${method} failed: ${j?.description ?? r.status}`);
  }
  return j.result;
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text: string,
  showAlert = false,
): Promise<void> {
  await call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text.slice(0, 200),
    show_alert: showAlert,
  });
}

/** Replaces the message text and strips its buttons — the record of what was
 *  decided now lives in source_policy_decisions / audit_log, not in a Telegram
 *  message a second tap could still act on. */
export async function closeMessage(
  chatId: number | string,
  messageId: number,
  originalText: string,
  outcomeLine: string,
): Promise<void> {
  await call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: `${originalText}\n\n${outcomeLine}`,
    reply_markup: { inline_keyboard: [] },
  });
}
