import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Terraveler — A Chrono-diary of Navigation",
  description:
    "Follow the great voyages of exploration, stage by stage, told through the navigators' own journals and mapped in time.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
