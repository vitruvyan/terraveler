import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LivingNewsroom from "./LivingNewsroom";
import "./living-newsroom.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Living Newsroom — preview laboratory",
  robots: { index: false, follow: false },
};

// This route inherits the editor session gate from app/specimen/layout.tsx.
// Do not enable it in production, even if an experimental PR is merged.
export default function LivingNewsroomPage() {
  if (process.env.VERCEL_ENV !== "preview" && process.env.NODE_ENV !== "development") notFound();
  return <LivingNewsroom />;
}
