/**
 * Terraveler has two deliberately separate backends.
 *
 * DATA PLANE
 *   PostgreSQL on the Terraveler VPS, exposed through PostgREST.
 *
 * IDENTITY PLANE
 *   Supabase Auth only. The Supabase project's database is not Terraveler's
 *   canonical application database.
 *
 * Canonical env names are explicit. The SUPABASE_URL / SUPABASE_SERVICE_KEY
 * fallbacks exist only because the VPS cutover originally reused those names
 * for PostgREST. Remove the aliases after the production environment has been
 * migrated and the compatibility window is closed.
 */

function cleanEnv(value?: string): string {
  return (value ?? "")
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, "")
    .replace(/\/+$/, "");
}

/** VPS PostgREST base URL, e.g. https://api.terraveler.com. */
export const POSTGREST_URL = cleanEnv(
  process.env.POSTGREST_URL || process.env.SUPABASE_URL,
);

/** Server-side credential used for privileged PostgREST governance writes. */
export const POSTGREST_SERVICE_KEY = cleanEnv(
  process.env.POSTGREST_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY,
);

/** Supabase project URL used only for /auth/v1 identity operations. */
export const SUPABASE_AUTH_URL = cleanEnv(
  process.env.SUPABASE_AUTH_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
);

/** Supabase Auth public/server key used only with the identity provider. */
export const SUPABASE_AUTH_KEY = cleanEnv(
  process.env.SUPABASE_AUTH_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export function postgrestConfigured(): boolean {
  return Boolean(POSTGREST_URL);
}

export function privilegedPostgrestConfigured(): boolean {
  return Boolean(POSTGREST_URL && POSTGREST_SERVICE_KEY);
}

export function supabaseAuthConfigured(): boolean {
  return Boolean(SUPABASE_AUTH_URL && SUPABASE_AUTH_KEY);
}
