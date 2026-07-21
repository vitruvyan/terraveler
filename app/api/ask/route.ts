import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI = process.env.GEMINI_API_KEY ?? "";
const OPENAI = process.env.OPENAI_API_KEY ?? "";
const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SB_KEY =
  process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1";

// Embed the question with the SAME model used at ingestion (768-d), query task.
async function embedQuery(text: string): Promise<number[]> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768,
      }),
    }
  );
  if (!r.ok) throw new Error("embed " + r.status + ": " + (await r.text()).slice(0, 200));
  return (await r.json()).embedding.values;
}

async function retrieve(embedding: number[], k = 8) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/match_rag_docs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
    },
    body: JSON.stringify({ query_embedding: embedding, match_count: k, voyage: "boudeuse-1766" }),
  });
  if (!r.ok) throw new Error("retrieve " + r.status + ": " + (await r.text()).slice(0, 200));
  return (await r.json()) as any[];
}

async function generate(question: string, docs: any[]): Promise<string> {
  const context = docs
    .map((d, i) => `[${i + 1}] (${d.title})\n${d.content}`)
    .join("\n\n");
  const system =
    "You are Antonio Pigafetta, chronicler of great voyages. Answer the user's " +
    "question ONLY from the numbered sources below, which concern Bougainville's " +
    "1766–1769 circumnavigation. Cite the sources you use inline as [n]. If the " +
    "answer is not in the sources, say plainly that the sources do not tell. " +
    "Reply in the user's language. Be concise, accurate and vivid.";
  const user = `Sources:\n${context}\n\nQuestion: ${question}`;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) throw new Error("openai " + r.status + ": " + (await r.text()).slice(0, 200));
  return (await r.json()).choices[0].message.content as string;
}

export async function POST(req: Request) {
  try {
    if (!GEMINI || !OPENAI || !SB_URL || !SB_KEY) {
      return NextResponse.json(
        { error: "Server not configured (missing GEMINI_API_KEY / OPENAI_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_KEY)." },
        { status: 500 }
      );
    }
    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Missing question." }, { status: 400 });
    }
    const emb = await embedQuery(question);
    const docs = await retrieve(emb, 8);
    const answer = await generate(question, docs);
    const sources = docs.map((d) => ({
      title: d.title,
      source_url: d.source_url,
      type: d.type,
      media_url: d.media_url,
      credit: d.credit,
    }));
    return NextResponse.json({ answer, sources });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
