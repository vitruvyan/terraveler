"use client";
import EditorialWorkspace from "@/components/desk/EditorialWorkspace";
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
export default function EditorialSpecimen() {
  return (
    <EditorialWorkspace
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
    />
  );
}
