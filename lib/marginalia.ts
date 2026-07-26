import { evidenceBasisOf, evidenceCopy } from "./evidence";
import type { Navigator, SpaceWaypoint, Voyage, Waypoint } from "./types";

/**
 * The questions a stage asks about itself, answered from the atlas's own
 * verified fields — with no model in the loop.
 *
 * A blank chat box asks the reader to invent a question, but their curiosity was
 * created by something specific they just read. The fix is not a more visible
 * chatbot; it is for a stage to carry the questions its own data implies, so the
 * reader recognises one instead of composing one.
 *
 * Everything here is assembled, never generated. That matters more than it
 * sounds: Terraveler's whole claim is that quotations are verbatim and every
 * statement carries a source (Magna Carta §3), and one invented sentence in a
 * screenshot would cost more than this feature is worth. These notes are built
 * from `evidence_basis`, `what_was_lost` and `confidence` — fields a human
 * already verified — so they are sourced by construction and cannot
 * hallucinate. Free-text questions still go to the RAG; these do not need it.
 *
 * Two rules were learned by building it and reading the output, and both cost
 * more questions than they kept:
 *
 * 1. **Do not re-ask what the page already says.** The first version also
 *    generated "Is this date certain?", "Who else called here?" and "What is
 *    missing from this voyage's record?" — and every one of those merely
 *    re-surfaced text already rendered on the same page (the meta line, the
 *    also-called-at line, the evidence cartouche). A question that reveals
 *    something the reader is already looking at is not a question.
 *
 * 2. **A question repeated is a question ignored.** "Why is this position
 *    reconstructed?" fired on 23 of Cook's stages with an identical answer each
 *    time. Explanations that hold for the whole voyage are asked once, at the
 *    first stage that raises them.
 *
 * What survives is narrow on purpose: the reason a stage has no quotation, and
 * the reason a position is not certain. Both are things the page states without
 * explaining, which is exactly the gap worth filling.
 */

export type MarginKind = "answered" | "gap";

export interface MarginNote {
  /** Stable per stage, so a note can be linked and a kept item deduplicated. */
  id: string;
  question: string;
  answer: string;
  citation: string;
  citationUrl?: string;
  /** "gap" notes render in the contribution colour, not the answer colour. */
  kind: MarginKind;
  /** Present only where the reader could actually close the gap. */
  contribute?: string;
}

/** At most this many per stage. A question beside every line is noise, and it
 *  fragments attention exactly when someone is trying to read continuously. */
const MAX_PER_STAGE = 2;

const CARTA = "https://www.terraveler.com/magna-carta";

function field(w: Waypoint | SpaceWaypoint, k: string): unknown {
  return (w as unknown as Record<string, unknown>)[k];
}

function placeName(w: Waypoint | SpaceWaypoint): string {
  return (
    (field(w, "place_historical") as string) ??
    (field(w, "body") as string) ??
    `stage ${w.seq}`
  );
}

/** A probe or a lunar traverse has no diary and no coastline, so the wording
 *  that fits an Age-of-Sail landfall is simply false there: nobody is going to
 *  find "the passage for this stage" in Voyager 2's telemetry, and a heliocentric
 *  cruise point is not a place a source failed to fix closely enough. */
function isCrewedEarthVoyage(voyage: Voyage): boolean {
  const kind = voyage.kind ?? "earth";
  return kind === "earth" || kind === "surface";
}

/** The stage carries no verified quotation. What that *means* depends entirely
 *  on what survives, and the two cases deserve opposite treatment: where a
 *  record exists the gap is ours and a reader can close it; where the sources
 *  were destroyed there is nothing to find, and inviting the search would be a
 *  small falsehood repeated down the page. */
function missingExcerptNote(
  w: Waypoint | SpaceWaypoint,
  voyage: Voyage,
  navigator: Navigator,
): MarginNote | null {
  if (field(w, "diary_excerpt")) return null;
  const basis = evidenceBasisOf(voyage);
  const lost = voyage.what_was_lost?.trim();
  const cite = basis
    ? `Terraveler — evidence basis: ${evidenceCopy(basis).label.toLowerCase()}`
    : "Terraveler — no verified excerpt held for this stage";

  // Nothing to search for: the honest answer is what was lost, and why.
  if (basis === "later-chronicle" || basis === "reconstructed") {
    return {
      id: `s${w.seq}-norecord`,
      question: "Why does nothing survive from this stage?",
      answer:
        lost ??
        `No narrative account of this voyage survives, so ${placeName(w)} is placed from indirect evidence rather than from anyone's words.`,
      citation: cite,
      citationUrl: CARTA,
      kind: "gap",
    };
  }

  // Only a journal-tier voyage may have the surviving record attributed to the
  // traveller. On a testimony-tier voyage it belongs to someone else — Cortés is
  // read through Bernal Díaz, Columbus survives only as Las Casas's abstract —
  // and "Columbus's account exists" is precisely the overstatement that
  // evidence_basis was added to prevent.
  const whoseRecord =
    basis === "contemporary-journal"
      ? `${navigator.name}'s own account exists`
      : "The surviving account of this voyage exists";

  const answer = isCrewedEarthVoyage(voyage)
    ? `Because the gap here is ours, not the archive's. ${whoseRecord}, but no one has yet found ` +
      `the passage covering ${placeName(w)}, matched it to this stage and verified it against the ` +
      `source. That is a task a reader can finish — which is why this entry invites you, and a ` +
      `voyage whose records were destroyed does not.`
    : `Because the gap here is ours, not the archive's. The mission record for this stage exists ` +
      `— transcripts, telemetry, the published account — but no one has yet pulled the passage ` +
      `for ${placeName(w)} and verified it. Unlike a lost journal, this is a gap a reader can close.`;

  return {
    id: `s${w.seq}-unpulled`,
    question: "The record survives. Why is this stage empty?",
    answer,
    citation: cite,
    citationUrl: CARTA,
    kind: "gap",
    contribute: "Claim this gap and submit the passage",
  };
}

/** The position is declared as less than certain. The meta line already says
 *  *that*; this says *why*, which the page never does. Asked once per voyage,
 *  because the reason holds for the whole voyage rather than for one stage. */
function confidenceNote(w: Waypoint | SpaceWaypoint, voyage: Voyage): MarginNote | null {
  const c = w.confidence;
  if (!c || c === "certain") return null;

  let answer: string;
  if (!isCrewedEarthVoyage(voyage)) {
    answer =
      `Positions on this voyage are computed, not observed from the ground: they come from ` +
      `trajectory data, and the points between real encounters are interpolated to draw the ` +
      `path. Where a point is marked ${c}, it is a reconstruction of where the craft was, not a ` +
      `reading anyone took at the time.`;
  } else if (c === "reconstructed") {
    answer =
      `No source gives a position for stages marked this way. They are placed by working outward ` +
      `from the stages either side — the recorded headings, the elapsed days, and the landfalls ` +
      `that are certain. The line on the map is an inference, and it is drawn as one rather than ` +
      `hidden.`;
  } else {
    answer =
      `Longitude could not be measured reliably at sea for most of the age of sail — there was no ` +
      `practical method until the marine chronometer. Latitude in these journals is usually good; ` +
      `the east–west position is not, so the atlas records the uncertainty instead of choosing a ` +
      `precise-looking point. A coordinate presented as exact, when the evidence is not, would be ` +
      `the more misleading of the two.`;
  }

  return {
    id: `s${w.seq}-confidence`,
    question: `Why is this position ${c}?`,
    answer,
    citation: "Terraveler — declared confidence, Magna Carta §3.3",
    citationUrl: CARTA,
    kind: "answered",
  };
}

/**
 * Every stage's notes for one voyage, keyed by `seq`.
 *
 * Voyage-wide rather than per-stage because the anti-repetition rule needs to
 * see the whole itinerary: a note whose answer would be identical on forty
 * stages is placed on the first that raises it and suppressed thereafter.
 */
export function notesForVoyage(
  voyage: Voyage,
  navigator: Navigator,
  waypoints: readonly (Waypoint | SpaceWaypoint)[],
): Map<number, MarginNote[]> {
  const out = new Map<number, MarginNote[]>();
  // Explanations that hold for the whole voyage: asked once.
  const spent = new Set<string>();

  for (const w of waypoints) {
    const notes: MarginNote[] = [];

    // Per stage: each empty stage is a different passage someone could find.
    const missing = missingExcerptNote(w, voyage, navigator);
    if (missing) notes.push(missing);

    // Once per voyage, per confidence level — "approximate" and "reconstructed"
    // have genuinely different explanations, so each gets its one airing.
    const c = w.confidence;
    if (c && c !== "certain" && !spent.has(`confidence:${c}`)) {
      const note = confidenceNote(w, voyage);
      if (note) {
        spent.add(`confidence:${c}`);
        notes.push(note);
      }
    }

    if (notes.length > 0) out.set(w.seq, notes.slice(0, MAX_PER_STAGE));
  }
  return out;
}
