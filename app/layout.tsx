import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { LAYOUT_SCRIPT } from "@/lib/layout";
import "./globals.css";

/* The three voices of the atlas. All OFL, self-hosted, subset to latin — the
   same law the Magna Carta puts on sources applies to the type. Six cuts come
   to 240 KB, a fifth of what the three unsubsetted weights cost before.
   globals.css points --font-display / --font-body / --font-mono at these, so
   the 400-odd var() calls already in the stylesheet inherit them for free. */

const cartouche = localFont({
  src: [
    { path: "./fonts/cormorant-var.woff2", weight: "300 700", style: "normal" },
    { path: "./fonts/cormorant-italic-var.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--font-cartouche",
  display: "swap",
});

const text = localFont({
  src: [
    { path: "./fonts/ebgaramond-var.woff2", weight: "400 700", style: "normal" },
    { path: "./fonts/ebgaramond-italic-var.woff2", weight: "400 700", style: "italic" },
  ],
  variable: "--font-text",
  display: "swap",
});

const machine = localFont({
  src: [
    { path: "./fonts/plexmono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/plexmono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-machine",
  display: "swap",
});

const SITE_URL = "https://www.terraveler.com";
const SITE_DESCRIPTION =
  "A curated atlas of geo-history: the great voyages of exploration, told on maps from the navigators' own journals, every claim sourced. Written by AI under human command.";

/* There was no viewport declared at all, so Next served its default and
   `env(safe-area-inset-*)` resolved to zero everywhere — the safe area was not
   ignored, it was unreachable. `cover` is what asks for the whole screen and
   therefore what turns the four --safe-* tokens on; it ships in the same
   commit as their first use, because cover without insets runs the map's
   chrome under the notch and the home indicator and is worse than neither.

   themeColor is the parchment because the page now reaches the browser's own
   bars, so their colour has stopped being the browser's business and become
   the paper's. The dark register is a chosen theme rather than an OS
   preference — the same argument that made `color-scheme` a declaration — so
   there is no prefers-color-scheme pair here. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f2e6cf",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Terraveler — an atlas of geo-history", template: "%s — Terraveler" },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Terraveler",
    title: "Terraveler — an atlas of geo-history",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Terraveler — an atlas of geo-history",
    description: SITE_DESCRIPTION,
  },
};

const WEBSITE_JSONLD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Terraveler",
  url: SITE_URL,
  description: SITE_DESCRIPTION,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${cartouche.variable} ${text.variable} ${machine.variable}`}
      /* The layout script writes data-layout onto this element before React
         sees it — see lib/layout.ts for why the mode is an attribute and not a
         media query. React does not render that attribute, so it is not a
         mismatch; this says so out loud. */
      suppressHydrationWarning
    >
      <body>
        {/* First thing in the body, so it runs before anything paintable has
            been parsed: the stylesheet keys off this attribute, so the page
            must never be laid out without it. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: LAYOUT_SCRIPT }}
        />
        {children}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSONLD) }}
        />
      </body>
    </html>
  );
}
