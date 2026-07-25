import type { Voyage } from "./types";

/**
 * What kind of evidence a voyage rests on.
 *
 * The waypoint already declares how sure we are of a *position*
 * (`confidence`) and the excerpt is already verbatim-or-absent. Neither says
 * what kind of record the voyage as a whole survives through, and without
 * that the atlas cannot tell two very different silences apart:
 *
 *   - Cook has a journal and we simply haven't pulled the passage yet. The
 *     gap is ours, and a reader can close it.
 *   - Dias has no journal and never will: the Portuguese maritime archive
 *     burned in the Lisbon earthquake of 1755. Asking a reader to "help us
 *     find one" is asking them to look for ashes.
 *
 * Before this field the log page printed the same sentence for both. That was
 * a quiet falsehood, and it also pushed the desk toward leaving voyages like
 * Dias out entirely — turning an accident of the archive into an editorial
 * verdict on who mattered in history. Magna Carta §3 promises we never invent
 * a quotation. It has never said a voyage without quotations did not happen.
 *
 * Note that this field corrects a published voyage before it admits a single
 * new one: Columbus's log is lost, and what survives is Las Casas's abstract
 * of it. Presenting those words as Columbus's own is an overstatement the
 * atlas would otherwise keep making.
 */
export type EvidenceBasis =
  /** A first-hand log kept by the traveller survives. Cook, Cartier,
   *  Pigafetta, Darwin, Shackleton — and Apollo 11, whose air-to-ground
   *  transcript is a contemporaneous verbatim record by any other name. */
  | "contemporary-journal"
  /** First-hand, but not the traveller's own log: a companion's account, a
   *  secretary's report, a later memoir by a participant, or an abstract of a
   *  log now lost. Xerez on Pizarro; Bernal Díaz on Cortés; Las Casas on
   *  Columbus. */
  | "contemporary-testimony"
  /** Written later, from sources that no longer exist. Barros on Dias, sixty
   *  years after; Oviedo on Balboa, arriving the year after the crossing. */
  | "later-chronicle"
  /** No narrative source at all. The route is established by modern
   *  scholarship from indirect evidence — other people's letters, cartography,
   *  archaeology, official annals. Cabot; the landfalls of Zheng He. */
  | "reconstructed";

export const EVIDENCE_ORDER: readonly EvidenceBasis[] = [
  "contemporary-journal",
  "contemporary-testimony",
  "later-chronicle",
  "reconstructed",
] as const;

export function isEvidenceBasis(v: unknown): v is EvidenceBasis {
  return typeof v === "string" && (EVIDENCE_ORDER as readonly string[]).includes(v);
}

interface EvidenceCopy {
  /** Shown as the badge on the voyage log. */
  label: string;
  /** One sentence, addressed to a reader, explaining what they are reading. */
  blurb: string;
  /** What to say for a stage that carries no excerpt. */
  noExcerpt: string;
  /** Whether an absent excerpt is a gap a reader could actually close. Only
   *  the journal tier earns the "help us find one" call to action; for the
   *  others there is nothing to find, and inviting the search would be a
   *  small lie repeated on every stage. */
  invitesContribution: boolean;
}

const COPY: Record<EvidenceBasis, EvidenceCopy> = {
  "contemporary-journal": {
    label: "Contemporary journal",
    blurb:
      "A log kept during the voyage survives, so the words below were written at the time, at sea, by someone who was there.",
    noExcerpt: "No verified journal excerpt for this stage yet",
    invitesContribution: true,
  },
  "contemporary-testimony": {
    label: "Contemporary testimony",
    blurb:
      "No log by the traveller survives. What we have was written by someone who was present — a companion, a secretary, or a participant recalling it later — so the voice below is a witness's, not the voyager's own.",
    noExcerpt: "The surviving testimony does not cover this stage",
    invitesContribution: true,
  },
  "later-chronicle": {
    label: "Later chronicle",
    blurb:
      "Nothing written during the voyage survives. The route below is preserved by a chronicler working afterwards, from records that no longer exist — so the dates and landfalls are as good as that chronicler's sources, and no better.",
    noExcerpt: "No contemporary record of this stage survives; the chronicle passes over it",
    invitesContribution: false,
  },
  reconstructed: {
    label: "Reconstructed route",
    blurb:
      "No narrative account of this voyage survives at all. The track below is reconstructed by modern scholarship from indirect evidence — other people's letters, charts, official annals, archaeology — and parts of it remain genuinely disputed.",
    noExcerpt: "No contemporary record of this stage survives; the position is reconstructed",
    invitesContribution: false,
  },
};

/** Voyages published before this field existed carry no value. Treating the
 *  absence as "journal" would reintroduce exactly the overstatement the field
 *  exists to prevent, so an unclassified voyage says nothing rather than
 *  claiming a log it may not have. */
export function evidenceBasisOf(voyage: Voyage): EvidenceBasis | null {
  return isEvidenceBasis(voyage.evidence_basis) ? voyage.evidence_basis : null;
}

export function evidenceCopy(basis: EvidenceBasis): EvidenceCopy {
  return COPY[basis];
}

/** The sentence a stage with no excerpt should carry, and whether it should
 *  invite the reader to go looking. An unclassified voyage keeps the original
 *  wording, so nothing regresses while the atlas is being backfilled. */
export function noExcerptCopy(basis: EvidenceBasis | null): {
  text: string;
  invitesContribution: boolean;
} {
  if (!basis) {
    return { text: "No verified journal excerpt for this stage yet", invitesContribution: true };
  }
  const c = COPY[basis];
  return { text: c.noExcerpt, invitesContribution: c.invitesContribution };
}
