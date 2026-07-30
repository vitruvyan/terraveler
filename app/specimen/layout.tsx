import type { Metadata } from "next";

/* The specimen is a working document for whoever is building the site, not a
   page of the atlas. It stays reachable — you have to be able to open it on a
   phone — and stays out of search. The palette page is a client component and
   cannot declare this itself, so it is declared once for the whole chapter. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SpecimenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
