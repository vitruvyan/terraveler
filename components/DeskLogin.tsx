"use client";

import Link from "next/link";
import AuthBackdrop, { GoogleMark } from "@/components/AuthBackdrop";

type DeskLoginProps = {
  email: string;
  password: string;
  error: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
};

export default function DeskLogin({
  email,
  password,
  error,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: DeskLoginProps) {
  return (
    <AuthBackdrop variant="desk">
      <section className="auth-panel auth-desk-panel" aria-labelledby="desk-login-title">
        <Link href="/" className="wordmark auth-wordmark">Terraveler</Link>
        <span className="auth-kicker">Editorial desk</span>
        <h1 id="desk-login-title">Sign in to the desk</h1>
        <p className="auth-intro">For the editor and the crew entrusted with Terraveler&rsquo;s record.</p>

        <a href="/api/desk/google?next=/desk" className="auth-google-button">
          <GoogleMark />
          <span>Continue with Google</span>
        </a>

        <div className="auth-divider">
          <span>or sign in with email</span>
        </div>

        <form onSubmit={onSubmit} className="auth-form">
          <label>
            <span>Email address</span>
            <input value={email} onChange={(event) => onEmailChange(event.target.value)} type="email" autoComplete="username" required />
          </label>
          <label>
            <span>Password</span>
            <input value={password} onChange={(event) => onPasswordChange(event.target.value)} type="password" autoComplete="current-password" required />
          </label>
          <button type="submit" className="auth-submit">Enter the desk</button>
          {error && <div className="desk-login-error">{error}</div>}
        </form>
        <p className="auth-switch">Looking for your Terraveler account? <Link href="/login">Sign in here</Link></p>
      </section>
    </AuthBackdrop>
  );
}
