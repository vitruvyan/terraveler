import type { Metadata } from "next";
import AccountAuth from "@/components/AccountAuth";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return <AccountAuth mode="login" />;
}
