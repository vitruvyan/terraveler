"""Offline role contracts: no provider, network or database calls."""
import copy
import unittest

from orchestration.editorial_handlers import EvidenceError, research, writer, reviewer, production_handlers
from orchestration.editorial_gateway import GatewayConfig


SOURCE = {"id": "archive:1", "text": "They departed in 1527. The location is uncertain.",
          "title": "Archive", "url": "https://archive.example/source", "rights": "public-domain"}
RESEARCH = {"kind": "research", "references": [SOURCE], "findings": [
    {"text": "Departure in 1527", "source_ids": ["archive:1"], "quotes": [
        {"source_id": "archive:1", "text": "They departed in 1527."}]}], "uncertainties": ["Location"]}
DRAFT = {"kind": "draft", "title": "A journey", "body": "They departed in 1527.",
         "citations": [{"source_id": "archive:1", "claim": "They departed in 1527.",
                        "quote": "They departed in 1527."}]}


class HandlersTest(unittest.TestCase):
    def setUp(self):
        self.config = GatewayConfig("http://limen:8080", "virtual-key", "editorial")
        self.task = {"id": 1, "role": "research", "input": {}, "agent_config": {
            "agent_key": "research-agent", "version": 3, "name": "Research", "role": "research",
            "model": "local-fixture", "instructions": "Preserve uncertainty."}}

    def generator(self, value):
        def generate(task, config):
            self.assertIs(config, self.config)
            self.assertEqual(task["agent_config"], self.task["agent_config"])
            return {"candidate": copy.deepcopy(value), "requested_model": "local-fixture"}
        return generate

    def test_research_retrieves_once_preserves_snapshot_and_raw_candidate(self):
        calls = []
        def retrieve(task):
            calls.append(task)
            return [SOURCE]
        result = research(self.task, self.config, retrieve=retrieve, generator=self.generator(RESEARCH))
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["references"], [SOURCE])
        self.assertEqual(result["verification"], "candidate-only")
        self.assertEqual(result["candidate"]["candidate"], RESEARCH)
        self.assertEqual(self.task["input"], {})

    def test_unknown_sources_and_fabricated_quotes_fail(self):
        for mutate in (lambda r: r["findings"][0].update(source_ids=["invented"]),
                       lambda r: r["findings"][0]["quotes"][0].update(text="fabricated")):
            value = copy.deepcopy(RESEARCH)
            mutate(value)
            with self.assertRaises(EvidenceError):
                research(self.task, self.config, retrieve=lambda _: [SOURCE], generator=self.generator(value))

    def test_missing_corpus_fails_before_generation(self):
        def forbidden(*args):
            self.fail("generation called without corpus")
        with self.assertRaises(EvidenceError):
            research(self.task, self.config, retrieve=lambda _: [], generator=forbidden)

    def test_writer_uses_research_snapshot_without_retrieval(self):
        self.task.update(role="writer", input={"research_result": RESEARCH})
        result = writer(self.task, self.config, generator=self.generator(DRAFT))
        self.assertEqual(result["kind"], "draft")
        self.assertEqual(result["references"], [SOURCE])
        self.assertEqual(result["verification"], "candidate-only")

    def test_writer_rejects_unknown_citation(self):
        self.task.update(role="writer", input={"research_result": RESEARCH})
        bad = copy.deepcopy(DRAFT)
        bad["citations"][0]["source_id"] = "invented"
        with self.assertRaises(EvidenceError):
            writer(self.task, self.config, generator=self.generator(bad))

    def test_review_validates_draft_before_model_call(self):
        self.task.update(role="reviewer", input={"research_result": RESEARCH, "draft_result": DRAFT})
        result = reviewer(self.task, self.config, generator=self.generator({"verdict": "ready-for-editor", "issues": []}))
        self.assertEqual(result["verdict"], "ready-for-editor")
        self.assertEqual(result["verification"], "candidate-only")
        self.task["input"]["draft_result"] = {**DRAFT, "citations": []}
        with self.assertRaises(EvidenceError):
            reviewer(self.task, self.config, generator=lambda *a: self.fail("invalid draft sent to model"))

    def test_writer_rejects_unmapped_prose_and_unattributed_quotation(self):
        self.task.update(role="writer", input={"research_result": RESEARCH})
        for extra in ("\n\nAn invented additional fact.", ' "A fabricated historical quotation"'):
            bad = copy.deepcopy(DRAFT)
            bad["body"] += extra
            with self.assertRaises(EvidenceError):
                writer(self.task, self.config, generator=self.generator(bad))

    def test_rewrite_receives_original_sources_previous_draft_and_review(self):
        self.task.update(role="writer", input={"research_result": RESEARCH, "draft_result": DRAFT,
                                               "review_result": {"kind": "review", "verdict": "changes-requested",
                                                                 "issues": ["Clarify uncertainty"]}})
        def generate(task, config):
            self.assertEqual(task["input"]["draft_result"], DRAFT)
            self.assertEqual(task["input"]["review_result"]["issues"], ["Clarify uncertainty"])
            self.assertEqual(task["input"]["research_result"]["references"], [SOURCE])
            return {"candidate": DRAFT}
        self.assertEqual(writer(self.task, self.config, generator=generate)["kind"], "draft")

    def test_ready_review_cannot_carry_unresolved_issues(self):
        self.task.update(role="reviewer", input={"research_result": RESEARCH, "draft_result": DRAFT})
        with self.assertRaisesRegex(EvidenceError, "editorial-invalid-review"):
            reviewer(self.task, self.config, generator=self.generator({"verdict": "ready-for-editor", "issues": ["Missing evidence"]}))

    def test_governance_receipt_survives_research_and_writing(self):
        policy = {"endpoint_id": 9, "policy_decision_id": 27, "rights_class": "public_domain", "trust_mode": "domain_trusted"}
        source = {**SOURCE, "governance": policy}
        result = research(self.task, self.config, retrieve=lambda _: [source], generator=self.generator(RESEARCH))
        self.assertEqual(result["references"][0]["governance"], policy)
        self.task.update(role="writer", input={"research_result": result})
        draft = writer(self.task, self.config, generator=self.generator(DRAFT))
        self.assertEqual(draft["references"][0]["governance"], policy)

    def test_review_has_no_publish_verdict(self):
        self.task.update(role="reviewer", input={"research_result": RESEARCH, "draft_result": DRAFT})
        with self.assertRaises(EvidenceError):
            reviewer(self.task, self.config, generator=self.generator({"verdict": "published", "issues": []}))

    def test_registry_is_explicit_and_roles_allowlisted(self):
        self.assertEqual(production_handlers({}), {})
        active = production_handlers({"EDITORIAL_HANDLERS_ENABLED": "1", "EDITORIAL_HANDLER_ROLES": "writer"})
        self.assertEqual(set(active), {"writer"})
        self.assertEqual(active["writer"].__name__, "production_writer")
        with self.assertRaises(ValueError):
            production_handlers({"EDITORIAL_HANDLERS_ENABLED": "1", "EDITORIAL_HANDLER_ROLES": "publisher"})


if __name__ == "__main__":
    unittest.main()
