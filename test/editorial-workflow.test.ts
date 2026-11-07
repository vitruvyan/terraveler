import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { editorialLane, type DeskSubmission } from "../lib/deskPresentation";
import EditorialWorkspace from "../components/desk/EditorialWorkspace";
const base: DeskSubmission = {
  id: 111,
  type: "idea",
  status: "approved",
  target_voyage: null,
  carta_version: "0.7",
  created_at: "2026-11-07",
  payload: { title: "Cabeza de Vaca" },
  contributor: null,
  audit: [],
  reviews: [],
  escalated: false,
};
test("the three workflow lanes keep approved proposals and unreviewed drafts out of publication", () => {
  assert.equal(editorialLane(base), "drafts");
  assert.equal(
    editorialLane({ ...base, type: "new-voyage", status: "peer-review" }),
    "drafts",
  );
  assert.equal(
    editorialLane({ ...base, type: "new-voyage", status: "human-review" }),
    "drafts",
  );
  assert.equal(editorialLane({ ...base, type: "new-voyage" }), "ready");
  assert.equal(
    editorialLane({
      ...base,
      audit: [
        {
          actor: "publisher",
          action: "publish",
          verdict: null,
          findings: null,
          created_at: "",
        },
      ],
    }),
    "published",
  );
});
test("editor front door has three primary sections and secondary administration, with no raw demand queries", () => {
  const html = renderToStaticMarkup(
    React.createElement(EditorialWorkspace, {
      submissions: [base],
      content: { projects: [], voyages: [], proposalLinksAvailable: false },
      loading: false,
      error: "",
      onRetry: async () => {},
      onVerdict: async () => ({}),
      busy: false,
      onAdministration() {},
    }),
  );
  for (const label of [
    "Proposals &amp; drafts",
    "To publish",
    "Published",
    "Administration",
    "Editorial assistant",
  ])
    assert.ok(html.includes(label), label);
  assert.doesNotMatch(
    html,
    /Add to Chartroom|Asked for, not held|Quarterdeck|nettuno/,
  );
});
