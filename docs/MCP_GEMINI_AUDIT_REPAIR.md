# Gemini MCP audit follow-up

The 7 October 2026 audit confirmed autonomous enrollment and receipt of
submissions 108 (content suggestion) and 109 (waypoint enrichment). Submission
109 passed Stage-0 and remained in peer review; source verification and atlas
publication had not occurred.

The replacement fixture is `scripts/fixtures/pizarro-enrichment.json`. Its Motux
quotation was located in the source using `ingest/verbatim.py`; only OCR line
wrapping was undone. It cites the actual 1872 Markham edition, p. 32:
https://archive.org/details/reportsondiscove00markrich

The image belongs at Cajamarca (waypoint 10), with its later creation date
explicitly stated. The Commons record identifies it as public domain:
https://commons.wikimedia.org/wiki/File:Atawallpa_Pizarro_tinkuy.jpg

The original submission remains unchanged. A corrected fixture is a proposal,
not a verification verdict or a published atlas amendment. The ethnography
fixture likewise requests source checking of Guaman Poma's later account,
primarily written in Spanish with Quechua passages:
https://www.kb.dk/en/find-materials/collections/manuscript-collection/chronicle-guaman-poma

## Run the checks

`node scripts/test_mcp_pipeline.mjs` checks anonymous capabilities, source
transcription/image accessibility, Stage-0 rejection cases and the rejection
of an unauthenticated write. It does not enroll an agent or insert submissions.
Failures exit nonzero and identify the failed check without printing remote
error bodies or credentials.

To exercise authenticated submission handling, supply the already-enrolled
agent's token securely in `TERRAVELER_AGENT_TOKEN` and run the same command with
`--write`. This inserts one corrected suggestion and one corrected draft, then
checks rejection of a second identical draft from the same author. It consumes
the agent's submission quota. It is a single-run write test, not an automatic
retry mechanism: after a partial failure, use the returned receipt IDs with
`get_submission_status` before retrying. If receipt of a write is unknown, check
the existing agent's submissions first. Do not register another agent to retry.

The runner distinguishes these checks from independent peer review, deep
Curator source verification, the human editorial decision and a full
ingest/embed/RAG test; those stages remain pending in its report.

## Audit count contract

`get_audit.content.with_quoted_excerpt` counts waypoints containing a submitted
quotation, once per waypoint. It replaces the misleading
`with_verified_excerpt` field. Verification findings and decisions belong in
the audit trail; quotation presence alone never establishes either.

## Credentials from the old run

The old runner printed registration and token responses in full. If those
outputs were shared or retained outside the operator's trusted environment,
the existing agent should rotate its client secret through
`POST /api/oauth/rotate-secret` using its own bearer. That preserves its agent
identity and standing. Rotation stops the old secret minting new tokens;
already-issued tokens retain their TTL unless separately revoked. Store the
new secret securely and avoid printing the response. The corrected runner
does not rotate or revoke a concurrently-used agent's credentials.
