import { editorialTitleFromAudit } from "@/lib/editorActions";
import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { readDeskRows } from "@/lib/deskQueue";
import { loadDeskContent } from "@/lib/deskContent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only editorial catalogue. This route never approves or publishes. */
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  try {
    const [content, audit] = await Promise.all([
      loadDeskContent(readDeskRows),
      readDeskRows("audit_log?action=eq.editorial-title&order=id.asc&select=id,action,actor,findings"),
    ]);
    return NextResponse.json({ ...content,
      projects: content.projects.map(p => { const t=editorialTitleFromAudit(audit,"project",p.id);return {...p,title:t.title??p.title,title_version:t.version}; }),
      voyages: content.voyages.map(v => { const t=editorialTitleFromAudit(audit,"voyage",v.slug);return {...v,editorial_title:t.title,title_version:t.version}; }),
    });
  } catch {
    return NextResponse.json({ error: "Could not load the content catalogue. Please retry." }, { status: 500 });
  }
}
