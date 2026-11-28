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
DRAFT_CANDIDATE = {"kind": "draft", "title": "A journey",
                   "paragraphs": [{"text": "They departed in 1527.", "source_id": "archive:1"}]}
DRAFT = {"kind": "draft", "title": "A journey", "body": "They departed in 1527.",
         "citations": [{"source_id": "archive:1", "claim": "They departed in 1527."}]}
WAYPOINT = {"id": "sanlucar", "sequence": 1, "place_historical": "Sanlúcar de Barrameda",
            "place_modern": "Sanlúcar de Barrameda, Spain", "latitude": 36.78, "longitude": -6.35,
            "arrival_date": "1527-06-17", "departure_date": "1527-06-17", "date_note": None,
            "event": "Departure", "coordinate_note": "Modern harbour centre; historical landing point is not exact.",
            "source_ids": ["archive:1"], "confidence": "approximate",
            "uncertainty": "The modern coordinate does not identify the exact sixteenth-century anchorage."}
ITINERARY_RESEARCH = {**RESEARCH, "waypoints": [WAYPOINT]}


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

    def test_itinerary_waypoints_flow_unchanged_through_draft_and_review(self):
        self.task["input"] = {"work_item": {"specialty": "itinerary"}}
        result = research(self.task, self.config, retrieve=lambda _: [SOURCE], generator=self.generator(ITINERARY_RESEARCH))
        self.assertEqual(result["waypoints"], [WAYPOINT])
        self.task.update(role="writer", input={"research_result": result})
        draft = writer(self.task, self.config, generator=self.generator(DRAFT_CANDIDATE))
        self.assertEqual(draft["waypoints"], [WAYPOINT])
        self.assertIsNot(draft["waypoints"], result["waypoints"])
        self.task.update(role="reviewer", input={"research_result": result, "draft_result": draft})
        review = reviewer(self.task, self.config, generator=self.generator({"verdict": "ready-for-editor", "issues": []}))
        self.assertEqual(review["verdict"], "ready-for-editor")

    def test_partial_dates_compare_at_shared_precision(self):
        self.task["input"] = {"work_item": {"specialty": "itinerary"}}
        for arrival, departure in (("1528", "1528-05"), ("1528-05", "1528"), ("1528-05-01", "1528-05-01"), (None, "1528")):
            value = copy.deepcopy(ITINERARY_RESEARCH)
            value["waypoints"][0].update(arrival_date=arrival, departure_date=departure)
            with self.subTest(arrival=arrival, departure=departure):
                research(self.task, self.config, retrieve=lambda _: [SOURCE], generator=self.generator(value))
        self.task["input"] = {}

    def test_invalid_waypoints_and_unexpected_route_data_fail_closed(self):
        self.task["input"] = {"work_item": {"specialty": "itinerary"}}
        mutations = (
            lambda value: value["waypoints"][0].update(latitude=91),
            lambda value: value["waypoints"][0].update(longitude=True),
            lambda value: value["waypoints"][0].update(arrival_date="1527-02-30"),
            lambda value: value["waypoints"][0].update(arrival_date="1527-08-15", departure_date="1527-06-17"),
            lambda value: value["waypoints"][0].update(arrival_date="1528", departure_date="1527-12"),
            lambda value: value["waypoints"][0].update(source_ids=["invented"]),
            lambda value: value["waypoints"][0].update(uncertainty=None),
            lambda value: value["waypoints"][0].update(coordinate_note="x" * 501),
            lambda value: value["waypoints"].append({**value["waypoints"][0], "id": "duplicate-sequence"}),
            lambda value: value.pop("waypoints"),
        )
        for mutate in mutations:
            value = copy.deepcopy(ITINERARY_RESEARCH)
            mutate(value)
            with self.subTest(mutate=mutate), self.assertRaises(EvidenceError):
                research(self.task, self.config, retrieve=lambda _: [SOURCE], generator=self.generator(value))
        self.task["input"] = {}
        with self.assertRaisesRegex(EvidenceError, "editorial-unexpected-waypoints"):
            research(self.task, self.config, retrieve=lambda _: [SOURCE], generator=self.generator(ITINERARY_RESEARCH))

    def test_review_rejects_changed_waypoint_provenance_before_generation(self):
        draft = {**DRAFT, "waypoints": [{**WAYPOINT, "latitude": 0}]}
        self.task.update(role="reviewer", input={"research_result": ITINERARY_RESEARCH, "draft_result": draft})
        with self.assertRaisesRegex(EvidenceError, "editorial-waypoint-provenance"):
            reviewer(self.task, self.config, generator=lambda *args: self.fail("changed route sent to model"))

    def test_missing_corpus_fails_before_generation(self):
        def forbidden(*args):
            self.fail("generation called without corpus")
        with self.assertRaises(EvidenceError):
            research(self.task, self.config, retrieve=lambda _: [], generator=forbidden)

    def test_writer_uses_research_snapshot_without_retrieval(self):
        self.task.update(role="writer", input={"research_result": RESEARCH})
        result = writer(self.task, self.config, generator=self.generator(DRAFT_CANDIDATE))
        self.assertEqual(result["kind"], "draft")
        self.assertEqual(result["body"], "They departed in 1527.")
        self.assertEqual(result["citations"], [{"source_id": "archive:1", "claim": "They departed in 1527."}])
        self.assertEqual(result["references"], [SOURCE])
        self.assertEqual(result["verification"], "candidate-only")

    def test_writer_rejects_unknown_citation(self):
        self.task.update(role="writer", input={"research_result": RESEARCH})
        bad = copy.deepcopy(DRAFT_CANDIDATE)
        bad["paragraphs"][0]["source_id"] = "invented"
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

    def test_writer_rejects_duplicate_fields_and_unattributed_quotation(self):
        self.task.update(role="writer", input={"research_result": RESEARCH})
        for mutate in (lambda d: d["paragraphs"][0].update(claim="duplicate"),
                       lambda d: d["paragraphs"][0].update(text=' "A fabricated historical quotation"')):
            bad = copy.deepcopy(DRAFT_CANDIDATE)
            mutate(bad)
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
            return {"candidate": DRAFT_CANDIDATE}
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
        draft = writer(self.task, self.config, generator=self.generator(DRAFT_CANDIDATE))
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


class ValidationRepairTest(unittest.TestCase):
    """A mechanical defect goes back to its author with the exact problem named.

    Run 17 (Cabeza de Vaca): one itinerary waypoint with departure before arrival
    discarded the whole result and spent an attempt; the agent never learnt why.
    """

    def setUp(self):
        self.config = GatewayConfig("http://limen:8080", "virtual-key", "editorial")
        self.task = {"id": 1, "role": "research", "input": {"work_item": {"specialty": "itinerary"}},
                     "agent_config": {"agent_key": "itinerary", "version": 2, "name": "Itinerary", "role": "research",
                                      "model": "local-fixture", "instructions": "Preserve uncertainty."}}

    def sequence(self, *values):
        seen = []
        def generate(task, config):
            seen.append(copy.deepcopy(task["input"].get("validation_feedback")))
            return {"candidate": copy.deepcopy(values[min(len(seen), len(values)) - 1])}
        return generate, seen

    def test_departure_before_arrival_is_corrected_on_the_next_round(self):
        wrong = copy.deepcopy(ITINERARY_RESEARCH)
        wrong["waypoints"][0].update(arrival_date="1528-11", departure_date="1528-04")
        generate, seen = self.sequence(wrong, ITINERARY_RESEARCH)
        result = research(self.task, self.config, retrieve=lambda _: [SOURCE], generator=generate)
        self.assertEqual(result["waypoints"], [WAYPOINT])
        self.assertIsNone(seen[0])
        self.assertEqual(seen[1]["rejected"], "editorial-waypoint-departure-before-arrival")
        self.assertIn("waypoint sanlucar", seen[1]["problem"])
        self.assertIn("1528-04", seen[1]["problem"])
        self.assertEqual(result["candidate"]["validation_repairs"][0]["rejected"],
                         "editorial-waypoint-departure-before-arrival", "the correction stays in the record")

    def test_a_persistent_defect_still_fails_after_bounded_corrections(self):
        wrong = copy.deepcopy(ITINERARY_RESEARCH)
        wrong["waypoints"][0].update(latitude=123.9)
        generate, seen = self.sequence(wrong)
        with self.assertRaisesRegex(EvidenceError, "editorial-invalid-waypoint-coordinate"):
            research(self.task, self.config, retrieve=lambda _: [SOURCE], generator=generate)
        self.assertEqual(len(seen), 3, "one generation plus two corrections, never more")
        self.assertIn("latitude", seen[1]["problem"])

    def test_defects_that_are_not_the_model_s_to_fix_are_not_retried(self):
        generate, seen = self.sequence(ITINERARY_RESEARCH)
        with self.assertRaises(EvidenceError):
            research(self.task, self.config, retrieve=lambda _: [], generator=generate)
        self.assertEqual(seen, [], "no generation without governed sources")
        generate, seen = self.sequence("not an object")
        with self.assertRaisesRegex(EvidenceError, "editorial-candidate-required"):
            research(self.task, self.config, retrieve=lambda _: [SOURCE], generator=lambda t, c: {"candidate": None})

    def test_a_writer_told_about_an_unknown_source_can_fix_it(self):
        self.task.update(role="writer", input={"research_result": copy.deepcopy(RESEARCH)})
        wrong = copy.deepcopy(DRAFT_CANDIDATE)
        wrong["paragraphs"][0]["source_id"] = "invented"
        generate, seen = self.sequence(wrong, DRAFT_CANDIDATE)
        draft = writer(self.task, self.config, generator=generate)
        self.assertEqual(draft["citations"][0]["source_id"], "archive:1")
        self.assertEqual(seen[1]["rejected"], "editorial-unknown-source")
