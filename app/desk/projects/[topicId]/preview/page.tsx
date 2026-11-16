import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { COOKIE, verifyToken } from "@/lib/deskAuth";
import { positiveTopic } from "@/lib/editorialProjects";
import { readEditorialPreview } from "@/lib/editorialPreview";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import EditorialPreview from "@/components/desk/EditorialPreview";
import PreviewRevisionRequest from "@/components/desk/PreviewRevisionRequest";

export const metadata: Metadata = { title: "Private editorial preview · Terraveler", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function PreviewPage({ params, searchParams }: { params: Promise<{ topicId: string }>; searchParams: Promise<{ result?: string | string[] }> }) {
  const token = (await cookies()).get(COOKIE)?.value;
  const auth = token ? await verifyToken(token).catch(() => ({ ok: false })) : { ok: false };
  if (!auth.ok) redirect("/desk");
  const { topicId } = await params;
  const { result } = await searchParams;
  if (!/^[1-9][0-9]*$/.test(topicId) || !positiveTopic(Number(topicId)) || (result !== undefined && (typeof result !== "string" || !/^[1-9][0-9]*$/.test(result) || !positiveTopic(Number(result))))) notFound();
  let preview;
  try { preview = await readEditorialPreview(Number(topicId), result === undefined ? null : Number(result)); }
  catch { return <><SiteHeader /><main className="prose"><h1>Preview temporarily unavailable</h1><p>The saved draft could not be read. Return to the project and retry; this does not mean the work was lost.</p><a href={`/desk/projects?topic_id=${topicId}`}>Return to project</a></main></>; }
  if (!preview) return <><SiteHeader /><main className="prose"><h1>No saved draft available</h1><p>No readable draft exists for this project and version. The agents may still be researching or writing.</p><a href={`/desk/projects?topic_id=${topicId}`}>Return to project</a></main></>;
  if (result === undefined) redirect(`/desk/projects/${topicId}/preview?result=${preview.result_id}`);
  return <><SiteHeader /><main><EditorialPreview preview={preview} /><PreviewRevisionRequest topicId={preview.topic.id} resultId={preview.result_id} /></main><SiteFooter /></>;
}
