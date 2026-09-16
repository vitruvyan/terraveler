import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, verifyToken } from "@/lib/deskAuth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

/* The specimen is a working document for whoever builds the site, not a page
 * of the atlas. It stays behind the editor session in production, but on a dev
 * server it remains open so the design system can be inspected while editing.
 *
 * The specimen now carries the same site header and footer as the editorial
 * pages. They frame the working document without changing its private status.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SpecimenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.NODE_ENV === "production") {
    const token = (await cookies()).get(COOKIE)?.value;
    const ok = token ? (await verifyToken(token)).ok : false;
    if (!ok) redirect("/desk");
  }

  return (
    <>
      <SiteHeader />
      {children}
      <SiteFooter />
    </>
  );
}
