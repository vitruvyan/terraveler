import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, verifyToken } from "@/lib/deskAuth";

/* The specimen is a working document for whoever builds the site, not a page
 * of the atlas. It was reachable by anyone who knew the URL and merely kept
 * out of search, which is not the same as private — it carries working notes
 * about what is wrong with the stylesheet.
 *
 * It sits behind the editor session now, the same one the desk uses, and it is
 * declared here once for the whole chapter: /specimen/palette is a client
 * component and could not gate itself.
 *
 * Reading the cookie makes these routes dynamic, which is correct — a page
 * that depends on who is asking must not be prerendered and cached.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SpecimenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /* Open on a dev server. The gate is what makes the specimen private in
     production, but it also locks out the person building the site — a page
     whose whole purpose is to be looked at while you change CSS is useless if
     you have to hold an editor session to load it. NODE_ENV is "production"
     on Vercel, so this cannot open the door where it matters. */
  if (process.env.NODE_ENV !== "production") return <>{children}</>;

  const token = (await cookies()).get(COOKIE)?.value;
  const ok = token ? (await verifyToken(token)).ok : false;
  if (!ok) redirect("/desk");
  return <>{children}</>;
}
