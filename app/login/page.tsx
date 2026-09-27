import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AccountAuth from "@/components/AccountAuth";
import { COOKIE, getUser } from "@/lib/deskAuth";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

function safePath(raw: string): string {
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "";
}

type Params = Record<string, string | string[] | undefined>;

export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const nextRaw = Array.isArray(q.next) ? q.next[0] : q.next;
  const next = safePath(nextRaw ?? "");

  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  const user = token ? await getUser(token) : null;
  if (user) redirect(next || "/account");

  return <AccountAuth mode="login" />;
}
