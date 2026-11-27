"use client";
import Chapters from "../Chapters";
import { AdminShell } from "@/components/desk/AdminNavigation";
import "../specimen.css";
import EditorialWorkspace from "@/components/desk/EditorialWorkspace";
import EditorialPreview from "@/components/desk/EditorialPreview";
import type { EditorialPreview as Preview } from "@/lib/editorialPreview";
import type { DeskSubmission } from "@/lib/deskPresentation";
import "../../desk/editorial.css";
const sample: DeskSubmission = {
  id: 111,
  type: "idea",
  target_voyage: null,
  status: "approved",
  carta_version: "0.7",
  created_at: "2026-11-07T12:02:15Z",
  payload: { title: "Cabeza de Vaca and Estebanico" },
  contributor: { handle: "example-contributor", rank: "deckhand" },
  audit: [],
  reviews: [],
  escalated: false,
};
const preview: Preview = {
  topic: { id: 1, title: "Cabeza de Vaca and Estebanico" },
  result_id: 41,
  task_id: 19,
  created_at: "2026-11-27T12:00:00Z",
  title: "Cabeza de Vaca — candidate itinerary",
  paragraphs: [
    { text: "This specimen uses illustrative editorial copy to demonstrate the private reading edition. It is not a researched account or a publication candidate.", source_ids: ["specimen-source"] },
    { text: "The route below shows how researched waypoint candidates, their chronology and their uncertainty remain attached to a saved writer version.", source_ids: [] },
  ],
  sources: [{ id: "specimen-source", title: "Naufragios — illustrative source link", href: "https://es.wikisource.org/wiki/Naufragios", rights: "Public domain source; specimen metadata" }],
  waypoints: [
    { id: "florida", sequence: 1, place_historical: "Florida coast", place_modern: null,
      latitude: 27.9, longitude: -82.5, arrival_date: "1528", departure_date: "1528",
      date_note: "Year only; no exact landing date is asserted in this fixture.", event: "Illustrative landfall candidate.",
      coordinate_note: "Regional point used to demonstrate a candidate location.", source_ids: ["specimen-source"],
      confidence: "approximate", uncertainty: "Illustrative regional coordinate, not a verified landing site." },
    { id: "malhado", sequence: 2, place_historical: "Malhado", place_modern: "Galveston Island area, Texas",
      latitude: 29.3, longitude: -94.8, arrival_date: "1528-11", departure_date: null,
      date_note: "Partial date demonstrates the chronology display.", event: "Illustrative waypoint event.",
      coordinate_note: "Candidate island-area coordinate.", source_ids: ["specimen-source"],
      confidence: "reconstructed", uncertainty: "Historical identification and precise geography remain unresolved in this specimen." },
    { id: "culiacan", sequence: 3, place_historical: "Culiacán", place_modern: "Culiacán, Sinaloa, Mexico",
      latitude: 24.8, longitude: -107.4, arrival_date: "1536", departure_date: null,
      date_note: null, event: "Illustrative endpoint for the three-point candidate sequence.",
      coordinate_note: "Modern city reference used for layout demonstration.", source_ids: ["specimen-source"],
      confidence: "certain", uncertainty: null },
  ],
  waypoints_omitted: 0,
  review: { verdict: "changes-requested", issues: ["Illustrative review issue: verify the candidate location before any publication decision."] },
  // Real Commons files (public domain); captions are illustrative specimen copy, not agent output.
  images: { result_id: 50, task_id: 31, omitted: 0,
    review: { verdict: "changes-requested", issues: ["Illustrative caption review: state that the 1591 engraving was made decades after the expedition."] },
    plates: [
      { receipt_id: "specimen-plate-1", src: "https://upload.wikimedia.org/wikipedia/commons/2/2a/DeBry_Engraving_of_Timucua%2C_1591.jpg",
        page_url: "https://commons.wikimedia.org/wiki/File:DeBry_Engraving_of_Timucua,_1591.jpg",
        caption: "Engraving of Timucua people by Theodor de Bry, published in 1591 — a later European depiction, not a record made during the Narváez expedition.",
        alt_text: "Engraving of Timucua people, published by Theodor de Bry in 1591.",
        artist: "De Bry", credit: null, licence: "Public domain", licence_url: null, date_original: "1591",
        depiction: "later-artwork", width: 640, height: 458 },
      { receipt_id: "specimen-plate-2", src: "https://upload.wikimedia.org/wikipedia/commons/1/10/Signature_of_%C3%81lvar_N%C3%BA%C3%B1ez_Cabeza_de_Vaca_%28c._1490_%E2%80%93_c._1560%29.png",
        page_url: "https://commons.wikimedia.org/wiki/File:Signature_of_%C3%81lvar_N%C3%BA%C3%B1ez_Cabeza_de_Vaca_(c._1490_%E2%80%93_c._1560).png",
        caption: "Signature of Álvar Núñez Cabeza de Vaca as reproduced in an 1886 publication; Commons records the reproduction's date, not the signature's.",
        alt_text: "Handwritten signature of Álvar Núñez Cabeza de Vaca.",
        artist: "Álvar Núñez Cabeza de Vaca", credit: null, licence: "Public domain", licence_url: null, date_original: "1886-01-01",
        depiction: "modern-reproduction", width: 640, height: 310 },
    ] },
};
export default function EditorialSpecimen() {
  return (
    <><div className="dk-page"><Chapters current="/specimen/editorial" /><p>Illustrative records, read-only review workspace.</p></div><AdminShell active="workspace"><EditorialWorkspace
      readOnly
      submissions={[
        sample,
        {
          ...sample,
          id: 112,
          type: "new-voyage",
          status: "peer-review",
          payload: { title: "A voyage awaiting agent reviews" },
        },
        {
          ...sample,
          id: 113,
          type: "new-voyage",
          payload: { title: "A reviewed draft awaiting publication" },
        },
      ]}
      content={{
        projects: [
          {
            id: 25,
            title: "Cabeza de Vaca and Estebanico",
            description:
              "Approved scope; candidate sources require verification.",
            kind: "voyage",
            status: "open",
            claimed_by: null,
            claimed_at: null,
            created_at: null,
            source_submission_id: 111,
          },
        ],
        voyages: [
          {
            slug: "magellan-1519",
            href: "/voyage/magellan-1519",
            title: "The first circumnavigation",
            navigator: "Magellan and Elcano",
            years: "1519–1522",
          },
        ],
        proposalLinksAvailable: true,
      }}
      loading={false}
      error=""
      busy={false}
      onRetry={async () => {}}
      onVerdict={async () => ({})}
      onAdministration={() => {}}
    /></AdminShell><EditorialPreview preview={preview} /></>
  );
}
