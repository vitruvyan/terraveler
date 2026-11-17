import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LivingNewsroom from "../specimen/living-newsroom/LivingNewsroom";
import "../specimen/living-newsroom/living-newsroom.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Living Newsroom — preview laboratory",
  robots: { index: false, follow: false },
};

// Only static fixtures and client-local interactions are exposed here.
// No editor session is needed to evaluate the prototype. Production stays closed.
export default function LivingNewsroomPreviewPage() {
  if (process.env.VERCEL_ENV !== "preview" && process.env.NODE_ENV !== "development") notFound();
  return <LivingNewsroom />;
}
