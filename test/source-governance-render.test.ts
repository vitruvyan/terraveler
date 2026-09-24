import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// No JSX here on purpose: the test runner globs test/*.test.ts, and only
// .tsx/.jsx get esbuild's JSX parsing under tsx's loader — .ts does not,
// regardless of tsconfig's jsx option. React.createElement is the plain-TS
// escape hatch, not a stylistic choice.
import {
  PendingSourceProposals,
  SourceDossier,
  ReverificationStatus,
  type PendingProposal,
  type EndpointContext,
  type EndpointDossierEntry,
  type DossierEndpoint,
} from "../components/desk/SourceGovernance";

const h = React.createElement;

test("PendingSourceProposals — multi-intent proposals", async (t) => {
  const twoIntents: PendingProposal = {
    id: 4,
    target_url: "https://archive.org/",
    proposed_by_actor_type: "agent",
    proposed_by_actor_id: 2,
    endpoint_id: null,
    source_proposal_intents: [
      {
        voyage: "boudeuse-1766", waypoint: 11, region: null, person: null,
        reason: "Port Praslin log entry, cited at stage 11.",
        suggested_trust_mode: "item_verified", suggested_rights_class: "public_domain",
      },
      {
        voyage: "magellan-1519", waypoint: 3, region: null, person: null,
        reason: "Pigafetta's own account, relevant to stage 3.",
        suggested_trust_mode: "domain_trusted", suggested_rights_class: "public_domain",
      },
    ],
  };

  await t.test("shows every intent, not just the first", () => {
    const html = renderToStaticMarkup(h(PendingSourceProposals, { proposals: [twoIntents], busy: false }));
    assert.match(html, /Port Praslin log entry/, "first intent's reason must render");
    assert.match(html, /relevant to stage 3/, "second intent's reason must render too — this was intents[0] only before");
  });

  await t.test("blocks the verdict with an explanation before any click", () => {
    const html = renderToStaticMarkup(h(PendingSourceProposals, { proposals: [twoIntents], busy: false }));
    assert.match(html, /carries 2 distinct requests/i);
    assert.match(html, /can.t be resolved with a single verdict/i);
    // Both verdict buttons must be disabled — the RPC's own refusal,
    // surfaced before the POST rather than discovered from a failed one.
    const approveIdx = html.indexOf("Approve");
    const rejectIdx = html.indexOf("Reject");
    assert.ok(approveIdx > -1 && rejectIdx > -1);
    const approveTagStart = html.lastIndexOf("<button", approveIdx);
    const rejectTagStart = html.lastIndexOf("<button", rejectIdx);
    assert.match(html.slice(approveTagStart, approveIdx), /disabled=""/);
    assert.match(html.slice(rejectTagStart, rejectIdx), /disabled=""/);
  });

  await t.test("a single-intent proposal is unaffected: no refusal banner, verdict usable", () => {
    const oneIntent: PendingProposal = {
      ...twoIntents,
      id: 2,
      source_proposal_intents: [twoIntents.source_proposal_intents[0]],
    };
    const html = renderToStaticMarkup(h(PendingSourceProposals, { proposals: [oneIntent], busy: false }));
    assert.doesNotMatch(html, /can.t be resolved with a single verdict/i);
    assert.doesNotMatch(html, /distinct requests/i);
    const approveIdx = html.indexOf("Approve");
    const approveTagStart = html.lastIndexOf("<button", approveIdx);
    // Not disabled: the single intent's own reason prefills the form
    // (defaultForm, unchanged), so nothing here blocks the verdict.
    assert.doesNotMatch(html.slice(approveTagStart, approveIdx), /disabled=""/);
  });

  await t.test("a single intent with no stated reason still requires one before the verdict (pre-existing behaviour, untouched)", () => {
    const noReason: PendingProposal = {
      ...twoIntents,
      id: 5,
      source_proposal_intents: [{ ...twoIntents.source_proposal_intents[0], reason: null }],
    };
    const html = renderToStaticMarkup(h(PendingSourceProposals, { proposals: [noReason], busy: false }));
    const approveIdx = html.indexOf("Approve");
    const approveTagStart = html.lastIndexOf("<button", approveIdx);
    assert.match(html.slice(approveTagStart, approveIdx), /disabled=""/);
  });
});

test("PendingSourceProposals — endpoint_context (bug S1c)", async (t) => {
  const deduped: PendingProposal = {
    id: 4,
    target_url: "https://archive.org/",
    proposed_by_actor_type: "agent",
    proposed_by_actor_id: 2,
    endpoint_id: 10,
    source_proposal_intents: [{
      voyage: null, waypoint: null, region: null, person: null,
      reason: "A new item on a domain already trusted.",
      suggested_trust_mode: "domain_trusted", suggested_rights_class: "public_domain",
    }],
  };
  const ctx: Record<string, EndpointContext> = {
    "10": {
      host_pattern: "archive.org",
      trust_mode: "item_verified",
      status: "active",
      last_decision: {
        id: 10, decision_outcome: "approve", trust_mode: "item_verified",
        rights_class: "mixed", reason: "verified per item", timestamp: "2026-09-14T09:00:00Z",
      },
    },
  };

  await t.test("shown when endpoint_context has an entry for the proposal's endpoint_id", () => {
    const html = renderToStaticMarkup(h(PendingSourceProposals, {
      proposals: [deduped], busy: false, endpointContext: ctx,
    }));
    assert.match(html, /archive\.org/);
    assert.match(html, /already/);
    assert.match(html, /item_verified/);
    assert.match(html, /entire domain/i);
  });

  await t.test("absent endpoint_context leaves behaviour unchanged (no crash, no notice)", () => {
    const html = renderToStaticMarkup(h(PendingSourceProposals, { proposals: [deduped], busy: false }));
    assert.doesNotMatch(html, /entire domain/i);
  });

  await t.test("a proposal whose endpoint_id has no matching context entry also renders plainly", () => {
    const html = renderToStaticMarkup(h(PendingSourceProposals, {
      proposals: [deduped], busy: false, endpointContext: {},
    }));
    assert.doesNotMatch(html, /entire domain/i);
  });
});

test("SourceDossier — intents nobody ruled on stay visible", async (t) => {
  const endpoints: DossierEndpoint[] = [
    { id: 10, host_pattern: "archive.org", match_type: "domain", status: "active", trust_mode: "item_verified", last_verified_at: null },
  ];
  const dossier: Record<string, EndpointDossierEntry> = {
    "10": {
      proposals: [
        {
          id: 3, target_url: "https://archive.org/verrazzano-letter", status: "resolved", endpoint_id: 10,
          source_proposal_intents: [{ voyage: null, waypoint: null, region: null, person: null, reason: "verified item", suggested_trust_mode: "item_verified", suggested_rights_class: "mixed" }],
        },
        {
          // Deduped onto the same endpoint after #3 settled it; never
          // itself resolved. This is the intent that used to disappear.
          id: 4, target_url: "https://archive.org/", status: "submitted", endpoint_id: 10,
          source_proposal_intents: [{ voyage: "boudeuse-1766", waypoint: 11, region: null, person: null, reason: "Port Praslin log", suggested_trust_mode: "item_verified", suggested_rights_class: "public_domain" }],
        },
      ],
      decisions: [
        {
          id: 10, decision_outcome: "approve", trust_mode: "item_verified", rights_class: "mixed",
          reason: "verified item", timestamp: "2026-09-14T09:00:00Z", proposal_id: null, endpoint_id: 10,
          evidence_snapshot: { proposal_id: 3 },
        },
      ],
    },
  };

  await t.test("the ruled proposal is marked ruled; the un-ruled one is marked not evaluated", () => {
    const html = renderToStaticMarkup(h(SourceDossier, { endpoints, dossier, unattachedDecisions: [] }));
    assert.match(html, /ruled approve/i);
    assert.match(html, /not evaluated/i);
    assert.match(html, /Port Praslin log/, "the un-ruled intent's own content must still be shown, not just its status");
  });

  await t.test("a flagged endpoint's status becomes a badge inside the dossier row, not a separate tab", () => {
    const flagged: DossierEndpoint[] = [
      { id: 5, host_pattern: "archive-mirror.example.org", match_type: "suffix", status: "quarantined", trust_mode: "domain_trusted", last_verified_at: null },
    ];
    const html = renderToStaticMarkup(h(SourceDossier, {
      endpoints: flagged, dossier: { "5": { proposals: [], decisions: [] } }, unattachedDecisions: [],
    }));
    assert.match(html, /archive-mirror\.example\.org/);
    assert.match(html, /quarantined/);
  });

  await t.test("decisions that never got an endpoint still appear, filed separately", () => {
    const html = renderToStaticMarkup(h(SourceDossier, {
      endpoints: [], dossier: {},
      unattachedDecisions: [{
        id: 11, decision_outcome: "reject", trust_mode: null, rights_class: "unknown",
        reason: "No stated licence found.", timestamp: "2026-09-13T09:00:00Z",
        proposal_id: 8, endpoint_id: null, source_endpoints: null,
        source_proposals: { target_url: "https://example-unlicensed.org/" },
      }],
    }));
    assert.match(html, /No stated licence found/);
    assert.match(html, /example-unlicensed\.org/);
  });
});

test("ReverificationStatus — a zero says which zero it is", async (t) => {
  const trustedEndpoints: DossierEndpoint[] = [
    { id: 10, host_pattern: "archive.org", match_type: "domain", status: "active", trust_mode: "item_verified", last_verified_at: null },
    { id: 5, host_pattern: "archive-mirror.example.org", match_type: "suffix", status: "quarantined", trust_mode: "domain_trusted", last_verified_at: null },
  ];

  await t.test("states plainly that the pipeline is not running, not 'no drift detected'", () => {
    const html = renderToStaticMarkup(h(ReverificationStatus, {
      endpoints: trustedEndpoints,
      drifts: [],
      evidence: { any_reverifications: false, any_drift_evaluations: false },
    }));
    assert.match(html, /reverification pipeline is not running/i);
    assert.doesNotMatch(html, /no drift detected/i);
    assert.match(html, /source_reverifications/);
    assert.match(html, /nothing has ever checked/i);
  });

  await t.test("once the pipeline has produced any row, it reports what exists instead", () => {
    const html = renderToStaticMarkup(h(ReverificationStatus, {
      endpoints: [
        { id: 10, host_pattern: "archive.org", match_type: "domain", status: "active", trust_mode: "item_verified", last_verified_at: "2026-09-01T00:00:00Z" },
      ],
      drifts: [],
      evidence: { any_reverifications: true, any_drift_evaluations: false },
    }));
    assert.doesNotMatch(html, /pipeline is not running/i);
    assert.match(html, /1 of 1 trusted source/i);
  });

  await t.test("no trusted source at all reads as nothing to reverify, not as a clean pass", () => {
    const html = renderToStaticMarkup(h(ReverificationStatus, {
      endpoints: [],
      drifts: [],
      evidence: { any_reverifications: false, any_drift_evaluations: false },
    }));
    assert.match(html, /No source is trusted yet/i);
  });
});
