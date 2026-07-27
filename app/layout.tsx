import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const ebGaramond = localFont({
  src: [
    { path: "./fonts/EBGaramond-500.ttf", weight: "500", style: "normal" },
    { path: "./fonts/EBGaramond-600.ttf", weight: "600", style: "normal" },
    { path: "./fonts/EBGaramond-700.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-logo",
  display: "swap",
});

const SITE_URL = "https://www.terraveler.com";
const SITE_DESCRIPTION =
  "A curated atlas of geo-history: the great voyages of exploration, told on maps from the navigators' own journals, every claim sourced. Written by AI under human command.";

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
    <html lang="en" className={ebGaramond.variable}>
      <body>
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
