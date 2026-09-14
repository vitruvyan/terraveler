import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import TitlePage from "@/components/TitlePage";

export const metadata: Metadata = {
  title: "Cookie & Storage Policy",
  description: "The cookies and browser storage currently used by Terraveler.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow="Legal"
        title="Cookie & Storage Policy"
        dek="A plain-language inventory of the browser storage Terraveler currently uses."
        meta={["Effective 14 September 2026", "No advertising cookies", "No consent wall"]}
      >
        <article className="prose editorial-prose">
          <p>
            Terraveler currently does <strong>not</strong> use advertising cookies, cross-site tracking pixels or
            third-party analytics cookies. The browser storage listed below is used for authentication, security and
            local product features.
          </p>

          <h2>1. Strictly necessary authentication cookies</h2>
          <table>
            <thead>
              <tr><th>Name</th><th>Purpose</th><th>Typical lifetime</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><code>desk_token</code></td>
                <td>HttpOnly session token used to identify a signed-in Terraveler account.</td>
                <td>About 1 hour</td>
              </tr>
              <tr>
                <td><code>desk_refresh</code></td>
                <td>HttpOnly refresh token used to renew a valid account session without forcing repeated sign-in.</td>
                <td>Up to 30 days</td>
              </tr>
            </tbody>
          </table>
          <p>
            In production these cookies are Secure, HttpOnly, SameSite=Strict and available only to Terraveler paths.
            They are required for account, contribution, review and agent-association features. They are not used for
            advertising or behavioural profiling.
          </p>

          <h2>2. Local storage</h2>
          <p>
            Terraveler uses browser <code>localStorage</code> for small pieces of device-local state that do not need to
            be sent to the server. Current examples include remembering that introductory hints have been seen and the
            anonymous notebook feature. Notebook items remain in the browser unless you remove them or clear site data;
            Terraveler deliberately keeps that notebook client-only.
          </p>

          <h2>3. Readership measurement</h2>
          <p>
            The site sends a minimal first-party pageview event to Terraveler containing the page path and, when
            available, the referring host. The application does not set a tracking cookie or persistent browser
            identifier for this measurement and does not attach an account identifier to the event.
          </p>

          <h2>4. Third-party services</h2>
          <p>
            Google and Supabase are contacted when you actively choose an authentication flow that uses them. Vercel
            provides web hosting and may process ordinary request logs as part of delivering and protecting the service.
            Terraveler proxies OpenStreetMap tile requests through its own server, so the browser does not need to contact
            the OpenStreetMap tile host directly for those map tiles.
          </p>

          <h2>5. Why there is no cookie-consent banner</h2>
          <p>
            At the date of this policy, Terraveler does not deploy non-essential cookies or browser identifiers that are
            blocked pending consent. The authentication cookies are strictly necessary for features you explicitly use,
            while the current first-party readership counter does not use cookies or local-storage identifiers. For that
            reason the site does not show a generic “accept cookies” banner merely for appearance's sake.
          </p>
          <p>
            If Terraveler later introduces optional analytics, marketing technology, advertising or another form of
            non-essential browser storage, those technologies will be disabled by default where consent is legally
            required and this policy will be updated before deployment.
          </p>

          <h2>6. How to control storage</h2>
          <p>
            You can clear cookies and local storage using your browser's site-data controls. Clearing authentication
            cookies signs you out; clearing local storage removes device-local preferences and notebook content stored
            only in that browser.
          </p>

          <h2>7. Contact</h2>
          <p>
            Questions about cookies or storage can be sent to <a href="mailto:dbaldoni@gmail.com">dbaldoni@gmail.com</a>.
          </p>
        </article>
      </TitlePage>
      <SiteFooter />
    </>
  );
}
