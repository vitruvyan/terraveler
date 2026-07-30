import { redirect } from "next/navigation";

/* /search was forty-three lines wrapping <AtlasSearch> in a hero. Searching is
 * not a place, and the results were always the atlas — so the tool moved into
 * /voyages and this route stays only to carry people and links across.
 * It was in the sitemap at 0.7, so deleting it would have broken indexed URLs
 * and anything linking to /search?q=… */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = (await searchParams).q?.trim();
  redirect(q ? `/voyages?q=${encodeURIComponent(q)}#find` : "/voyages#find");
}
