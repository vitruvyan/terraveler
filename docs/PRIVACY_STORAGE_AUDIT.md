# Terraveler privacy and browser-storage audit

Audit date: 2026-09-14

This note records the implementation facts used to draft `/privacy`, `/terms` and `/cookies`.
It is not a substitute for legal advice and must be updated when browser storage, analytics or identity flows change.

## Browser cookies

Terraveler defines two first-party authentication cookies in `lib/deskAuth.ts`:

- `desk_token` — Supabase access token, HttpOnly, Secure in production, SameSite=Strict, path `/`, max age 3600 seconds.
- `desk_refresh` — Supabase refresh token, HttpOnly, Secure in production, SameSite=Strict, path `/`, max age 30 days.

These cookies are used for account, contribution, review, editor and human-agent association flows. They are strictly necessary for authenticated features and are not advertising or behavioural-tracking cookies.

## Local storage

Repository search found localStorage use for product-local state, including:

- `components/WelcomeCartouche.tsx` — remembers that the first-visit introduction was dismissed.
- `components/LogHint.tsx` — remembers that a UI hint has been seen.
- `lib/notebook.ts` / `components/Notebook.tsx` — anonymous notebook content stored deliberately client-side with no server copy.

These values are not used for cross-site advertising or behavioural profiling.

## Readership measurement

`components/PageviewBeacon.tsx` posts to the first-party route `/api/track` on public path changes.
The payload contains:

- pathname;
- referring host, when available from `document.referrer`.

`app/api/track/route.ts` sends only those fields to the Terraveler data plane. The application code does not attach an account ID, advertising ID, cookie ID or localStorage identifier to the pageview.

## Third parties and external services

- **Supabase Auth** — human identity provider for email/password and Google OAuth.
- **Google** — contacted when the user chooses Google sign-in.
- **Vercel** — web hosting/delivery; ordinary infrastructure request logs may be processed as part of hosting and security.
- **OpenStreetMap tiles** — browser requests are proxied through `app/api/map-tiles/[...tile]/route.ts`; Terraveler's server contacts `tile.openstreetmap.org` with a Terraveler user agent rather than exposing the reader directly for those tile requests.
- **Historical political basemaps** — bundled public GeoJSON files, not remote tracking scripts.

Repository search found no `@vercel/analytics` integration and no application-level advertising or marketing tracker.

## Consent-banner decision

At this audit date, no generic consent banner is deployed because the repository does not set non-essential tracking cookies or persistent analytics identifiers. Authentication cookies are necessary for features explicitly requested by the user; the current pageview counter is first-party and cookie-free at application level.

If a future change adds optional analytics SDKs, advertising, marketing tags, cross-site identifiers or other non-essential browser storage, those technologies must be gated before use where consent is legally required, and `/cookies` must be updated before deployment.

## Re-audit triggers

Re-run this audit when any of the following changes:

- authentication provider or cookie names/lifetimes;
- analytics or telemetry packages;
- embedded third-party media/widgets;
- maps or tiles loaded directly from external domains;
- localStorage/sessionStorage usage;
- advertising, marketing or attribution tooling;
- human/agent identity or contribution retention policy.
