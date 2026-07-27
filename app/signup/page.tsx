import type { Metadata } from "next";
import AccountAuth from "@/components/AccountAuth";

export const metadata: Metadata = { title: "Create your account" };

export default function SignupPage() {
  return <AccountAuth mode="signup" />;
}
