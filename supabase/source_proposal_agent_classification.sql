-- The agent proposing a source already has to research it to write a
-- credible reason (suggest_source's own tool description asks for exactly
-- that). Asking the human editor to then classify trust_mode and
-- rights_class from a bare URL and a sentence -- work the agent already
-- did and threw away -- is why the Sources tab's Approve button needed
-- typing before it did anything: two required dropdowns defaulting to
-- guesses, plus a reason field the editor had no draft of.
--
-- These are the agent's proposed classification, not the decision. The
-- decision (source_policy_decisions.trust_mode / .rights_class) can differ
-- -- a human may downgrade domain_trusted to item_verified, or reject
-- outright -- and does not lose its own authority by having a starting
-- point to react to instead of a blank form.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS.

begin;

alter table source_proposal_intents
  add column if not exists suggested_trust_mode text
    check (suggested_trust_mode is null or suggested_trust_mode = any(
      array['domain_trusted', 'collection_trusted', 'item_verified', 'link_only'])),
  add column if not exists suggested_rights_class text
    check (suggested_rights_class is null or suggested_rights_class = any(
      array['public_domain', 'creative_commons', 'mixed', 'in_copyright', 'unknown']));

commit;
