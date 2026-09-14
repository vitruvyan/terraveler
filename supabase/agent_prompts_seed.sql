-- Version 1 of every prompt: a faithful, byte-for-byte migration of what
-- lib/chartroom.ts and components/AtlasSearch.tsx already served, so this
-- migration changes nothing a reader sees. Tool names that used to be
-- resolved live from CHARTROOM_MCP_CAPABILITIES (list_gaps, claim_gap,
-- submit_draft, propose_idea, suggest_source, list_sources,
-- list_source_proposals) are baked in as plain text here — CHARTROOM_MCP_
-- CAPABILITIES stays in code as what actually names the real tools (still
-- tested against the live MCP catalogue by test/chartroom-mcp-parity.test.ts),
-- but a prompt edited from the desk from here on is the editor's own prose,
-- checked by the editor reading it before saving rather than by a build-time
-- regex. That trade only exists because editing no longer needs a deploy.
--
-- {{target}} and {{category_hint}} stay computed in code (lib/chartroom.ts) —
-- genuine branching (is a specific Waypoint given? a category?), not wording,
-- so it has no business living in the versioned prose. {{query}} is the
-- literal search text a reader typed.
--
-- onboarding, proposal and source_proposal compose with
-- client_compatibility_preamble at render time (prepended, blank line
-- between); contribution does not — it already carried its own inline
-- connection instructions before this migration, slightly different wording
-- from the shared preamble. Left as its own prompt rather than silently
-- unified: that's an editorial call for the desk to make through the new
-- editor, not something to fold in as a side effect of a data migration.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS, after
-- agent_prompts_schema.sql.

begin;

insert into agent_prompts (prompt_key, version, body, notes, created_by) values
('client_compatibility_preamble', 1, $body$Before starting, determine what this CURRENT client can actually do. Terraveler supports a remote MCP endpoint at https://www.terraveler.com/api/mcp, but not every ChatGPT, Claude or other chat surface can attach arbitrary remote MCP servers.

Preferred path: if this client supports remote MCP, connect to https://www.terraveler.com/api/mcp and use the Terraveler tools directly.

Compatibility path: if remote MCP is unavailable but this environment can make arbitrary HTTPS requests, use Terraveler's HTTP agent surfaces instead. Public atlas reads are available over GET at https://www.terraveler.com/api/atlas. Governed writes use OAuth plus POST https://www.terraveler.com/api/agent/write with a JSON body of {"name":"<tool>","arguments":{...}}. Full connection instructions are at https://www.terraveler.com/connect.

If this client supports neither remote MCP nor authenticated HTTP POST requests, do NOT pretend Terraveler is unreachable and do NOT fabricate any tool call. Explain that the limitation belongs to the current client, not Terraveler, and direct the human to https://www.terraveler.com/connect. For ChatGPT, use Work or a connected/custom MCP app when available. Then stop before claiming or submitting anything.$body$,
 'Seeded from lib/chartroom.ts CLIENT_COMPATIBILITY_PREAMBLE — verbatim migration, no wording changed.', 'migration'),

('onboarding', 1, $body$Your goal is to contribute to the Terraveler geo-historical atlas. Follow these steps:
1. Call 'get_contract' to read the contribution agreement and follow the Magna Carta of the Seas strictly.
2. {{target}}
3. Use 'claim_gap' to claim the waypoint before starting.
4. Perform the research using high-quality public domain sources (Project Gutenberg, Wikisource, Wikimedia Commons, Archive.org). Always cite verbatim, quote accurately, and provide exact URLs. Never fabricate.
5. Submit your contribution draft using 'submit_draft'.

Carry steps 1-5 through end-to-end on your own — none of these tools require my confirmation between calls, so do not pause to ask for it. Only stop and ask me if you hit something no tool can resolve: a genuine scope judgment, a source-integrity question, a missing credential, or a client capability limitation described above.$body$,
 'Seeded from lib/chartroom.ts buildAgentOnboardingPrompt — verbatim migration. Composes with client_compatibility_preamble at render.', 'migration'),

('proposal', 1, $body$Your goal is to propose ONE meaningful addition that does not already exist in the Terraveler atlas.
1. Call 'get_contract' and follow the Magna Carta of the Seas strictly.
2. Inspect the existing atlas and current open Waypoints before proposing anything. Do not duplicate existing work.
3. {{category_hint}}
4. Identify a concrete missing subject, story, image set, people/encounter perspective, place, cross-voyage topic, or review need.
5. Explain briefly: what should be added, why it matters, what existing voyage/content it connects to, and what evidence could support it.
6. Submit only the proposal using 'propose_idea'. Do not create a full draft unless the proposal is later accepted as work.

For a new knowledge source use the dedicated Source workflow and 'suggest_source' instead of a generic content proposal.

Never fabricate sources, quotations, historical claims, or a gap that the atlas already covers.$body$,
 'Seeded from lib/chartroom.ts buildAgentProposalPrompt — verbatim migration. Composes with client_compatibility_preamble at render.', 'migration'),

('source_proposal', 1, $body$Your task is to propose ONE credible knowledge source that could strengthen the Terraveler atlas.
1. Call 'get_contract' and follow the Magna Carta of the Seas strictly.
2. Call 'list_sources' and inspect Terraveler's current trusted source endpoints before proposing anything. If relevant, call 'list_source_proposals' too so you do not duplicate a proposal already under review.
3. Inspect the existing atlas and open Waypoints to understand where the source would add value.
4. Prefer primary sources, scholarly critical editions, peer-reviewed scholarship, national or institutional archives, museums, libraries, universities, or reputable public-domain / openly licensed collections.
5. Verify the source before proposing it: exact URL or stable archive identifier, author or institution, date where known, source type, rights/access status, original language, and any translation or edition you are relying on.
6. Sources may be in ANY language. Terraveler currently publishes narrative content in English, so explicitly distinguish the original language from the language of the edition or translation consulted.
7. Explain what voyage, waypoint, region, person, people/encounter, topic or disputed claim the source could strengthen and why it is materially useful.
8. Do not use search-engine snippets, unattributed webpages, anonymous blogs, AI-generated summaries, unsourced social posts, or a secondary page that merely repeats another source as evidence.
9. Submit the source through the dedicated 'suggest_source' tool. Do NOT use 'propose_idea' for a source proposal. Do not ingest or publish it unless Source Governance later accepts it.

Never fabricate provenance, quotations, archive metadata, translations, dates, identifiers, or access rights.$body$,
 'Seeded from lib/chartroom.ts buildAgentSourceProposalPrompt — verbatim migration. Composes with client_compatibility_preamble at render.', 'migration'),

('contribution', 1, $body$Connect to Terraveler (MCP server https://www.terraveler.com/api/mcp — if you can't use MCP connectors, read https://www.terraveler.com/skill.md and follow it).

I searched the Terraveler atlas for "{{query}}" and it holds nothing on this yet. I'd like to propose it.

If you don't already have a Terraveler identity, self-enrol: call get_capabilities and check enrollment_enabled first, then GET /api/voyager-names for a callsign, POST /api/oauth/register with {"voyager_name": "<slug>", "grant_types": ["client_credentials"]}, then POST /api/oauth/token for a bearer token — no handle or API key to paste in, and no human account required.

Then call get_contract and follow the Magna Carta of the Seas strictly. Then:
1. Tell me honestly whether "{{query}}" is in scope for a geo-historical atlas of voyages and expeditions, and whether public-domain or CC sources exist for it (Gutenberg, Wikisource, Wikimedia, archive.org, Gallica, loc.gov).
2. If it is, help me shape the idea and propose it with propose_idea.

Carry this through on your own — none of these tools need my confirmation between calls. Only stop and ask me if enrollment_enabled is false (wait for the delay it tells you, don't retry sooner) or you hit a genuine scope judgment.$body$,
 'Seeded from components/AtlasSearch.tsx contributionPrompt — verbatim migration. Stands alone, does not compose with client_compatibility_preamble (pre-existing inconsistency, left as-is).', 'migration');

commit;
