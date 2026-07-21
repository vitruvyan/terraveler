# Terraveler — A Chrono-diary of Navigation

A prototype that anticipates [Terraveler](https://terraveler.com). It tells a
historical voyage as a **synchronised map + timeline**: scrub through time and
the route unfolds across the map, while each landfall reveals the navigator's
own words from the ship's journal, with the source cited.

First voyage: **Louis-Antoine de Bougainville**, aboard *La Boudeuse* and
*L'Étoile*, 1766–1769.

## Stack
- **Next.js** (App Router) — deployed on **Vercel**
- **Supabase** (Postgres) — connected via the Vercel integration
- **MapLibre GL** — open-source map rendering
- Bespoke period-nautical styling (no CSS framework)

## Data model
See [`supabase/schema.sql`](supabase/schema.sql). The entities are deliberately
shaped like the future Terraveler ones:

| This prototype | Terraveler / Vitruvyan |
| -------------- | ---------------------- |
| Navigator      | Person                 |
| Voyage         | Route                  |
| Waypoint       | Place + Event          |
| Source         | Evidence Pack          |
| `confidence`   | reasoning confidence   |

Every journal excerpt is a **verbatim** quote from a public-domain source with a
citation — no invented text. Where no verified quote exists, the excerpt is
left empty rather than fabricated.

## Setup
1. Create a Supabase project (via the Vercel integration).
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Run `supabase/seed.sql` to load the Bougainville voyage.
4. Copy `.env.example` to `.env.local` and fill in the Supabase URL + anon key.
5. `npm install && npm run dev`.
