/**
 * The versioned prompt registry's shared shape — used by app/api/prompts
 * (public read), app/api/desk/prompts (editor read/write) and every client
 * component that used to hold its own copy of the prompt text.
 *
 * Prompts used to be template literals in lib/chartroom.ts and
 * components/AtlasSearch.tsx. They went stale invisibly at least once (an
 * onboarding prompt missing an autonomy instruction, found only after a
 * real agent got stuck), and every wording change needed a code review and
 * a deploy. agent_prompts (supabase/agent_prompts_schema.sql) is now the
 * source of truth: append-only, versioned, editable from the desk without
 * touching code.
 */

export const PROMPT_KEYS = [
  "client_compatibility_preamble",
  "onboarding",
  "proposal",
  "source_proposal",
  "contribution",
] as const;

export type PromptKey = (typeof PROMPT_KEYS)[number];

export const PROMPT_LABEL: Record<PromptKey, string> = {
  client_compatibility_preamble: "Client compatibility preamble",
  onboarding: "Onboarding (claim & work a Waypoint)",
  proposal: "Proposal (suggest new work)",
  source_proposal: "Source proposal",
  contribution: "Contribution (search dead-end → propose)",
};

/** Which prompts get client_compatibility_preamble prepended at render.
 *  "contribution" stands alone — it already carried its own inline
 *  connection instructions before the registry existed, slightly different
 *  wording from the shared preamble. That's a real inconsistency, left
 *  alone on purpose: unifying it is an editorial call for the desk to make
 *  through the editor, not something a data migration should decide. */
export const COMPOSES_WITH_PREAMBLE: Record<PromptKey, boolean> = {
  client_compatibility_preamble: false,
  onboarding: true,
  proposal: true,
  source_proposal: true,
  contribution: false,
};

export type PromptEntry = { version: number; body: string };
export type PromptMap = Record<PromptKey, PromptEntry>;

export type PromptVersion = {
  id: number;
  prompt_key: PromptKey;
  version: number;
  body: string;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

/** Client-safe fetch of every prompt's current version. Call once (on
 *  mount, or when a "copy prompt" affordance becomes visible) and keep the
 *  result in state — never inside a click handler: clipboard writes must
 *  fire synchronously within the user gesture that triggered them, and an
 *  awaited fetch in between can lose that in browsers that enforce it. */
export async function fetchCurrentPrompts(): Promise<PromptMap | null> {
  try {
    const r = await fetch("/api/prompts");
    if (!r.ok) return null;
    const j = await r.json();
    return (j?.prompts ?? null) as PromptMap | null;
  } catch {
    return null;
  }
}

/** {{name}} substitution — the only templating this needs. Dynamic values
 *  (which Waypoint, which category, what was searched) stay computed in
 *  code, never in the versioned prose: that's branching, not wording. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    template,
  );
}

/** Prepends client_compatibility_preamble for the prompts that compose with
 *  it, then substitutes {{placeholders}}. Returns null if the prompt map
 *  doesn't (yet) have the requested key — e.g. the fetch failed, or hasn't
 *  resolved — so callers can fall back to disabling the action rather than
 *  copying an empty string. */
export function renderPrompt(prompts: PromptMap | null, key: PromptKey, vars: Record<string, string> = {}): string | null {
  const entry = prompts?.[key];
  if (!entry) return null;
  const preamble = COMPOSES_WITH_PREAMBLE[key] ? prompts?.client_compatibility_preamble?.body : null;
  const body = preamble ? `${preamble}\n\n${entry.body}` : entry.body;
  return renderTemplate(body, vars);
}
