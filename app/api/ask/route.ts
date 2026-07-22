import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1";

// Self-hosted RAG backend (nomic embeddings + pgvector on the VPS). The URL is
// not a secret; the bearer token is. Retrieval — embedding + vector search —
// now happens entirely on our own infra (zero embedding tokens).
const RAG_URL = process.env.TERRAVELER_RAG_URL ?? "http://161.97.140.157:6003";
const RAG_TOKEN = process.env.TERRAVELER_RAG_TOKEN ?? "";
const DEFAULT_VOYAGE = "boudeuse-1766";

type Source = {
  title: string;
  content: string;
  source_url: string | null;
  type: string;
  media_url: string | null;
  credit: string | null;
  similarity: number;
};

async function retrieve(question: string, voyage: string, k = 8): Promise<Source[]> {
  const r = await fetch(`${RAG_URL.replace(/\/$/, "")}/rag/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RAG_TOKEN}`,
    },
    body: JSON.stringify({ question, voyage, k }),
  });
  if (!r.ok) throw new Error("rag " + r.status + ": " + (await r.text()).slice(0, 200));
  return ((await r.json()).sources ?? []) as Source[];
}

async function generate(question: string, docs: Source[]): Promise<string> {
  const context = docs
    .map((d, i) => `[${i + 1}] (${d.title})\n${d.content}`)
    .join("\n\n");
  const system =
    "You are Antonio Pigafetta, chronicler of great voyages. Answer the user's " +
    "question ONLY from the numbered sources below, which come from the ship's " +
    "journals and reference works for the voyage in question. Cite the sources " +
    "you use inline as [n]. If the answer is not in the sources, say plainly that " +
    "the sources do not tell. Reply in the user's language. Be concise, accurate and vivid.";
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
    if (!OPENAI || !RAG_TOKEN) {
      return NextResponse.json(
        { error: "Server not configured (missing OPENAI_API_KEY / TERRAVELER_RAG_TOKEN)." },
        { status: 500 }
      );
    }
    const { question, voyage } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Missing question." }, { status: 400 });
    }
    const docs = await retrieve(question, typeof voyage === "string" ? voyage : DEFAULT_VOYAGE, 8);
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
