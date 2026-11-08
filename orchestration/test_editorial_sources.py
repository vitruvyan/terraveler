"""Corpus retrieval is source-governed and has no web/model ports."""
import copy
import json
import unittest

from orchestration.editorial_handlers import EvidenceError
from orchestration.editorial_sources import SOURCE_BYTES, retrieve_sources


ROW = {"id": 7, "voyage_slug": "boudeuse-1766", "title": "Journal",
       "content": "A stored historical source fragment.", "source_url": "https://www.gutenberg.org/ebooks/1",
       "license": "Public domain"}
POLICY = {"matched": True, "decision": "allow", "trust_mode": "domain_trusted", "rights_class": "public_domain", "endpoint_id": 9, "policy_decision_id": 27}


class CorpusTests(unittest.TestCase):
    def task(self):
        return {"sources": [{"target_voyage": "boudeuse-1766"}]}

    def retrieve(self, rows, policy=POLICY):
        return retrieve_sources(self.task(), read_rows=lambda scopes: rows, resolve=lambda url: policy)

    def test_scoped_approved_corpus_has_stable_id_and_exact_fragment(self):
        def rows(scopes):
            self.assertEqual(scopes, ["boudeuse-1766"])
            return [ROW]
        result = retrieve_sources(self.task(), read_rows=rows, resolve=lambda _: POLICY)
        self.assertEqual(result, [{"id": "rag:7", "text": ROW["content"], "title": ROW["title"],
                                   "url": ROW["source_url"], "rights": "Public domain", "governance": {
                                       key: POLICY[key] for key in ("endpoint_id", "policy_decision_id", "rights_class", "trust_mode")}}])

    def test_missing_scope_never_reads_corpus(self):
        for task in ({}, {"sources": []}, {"sources": [{"payload": {"target_voyage": "guessed"}}]}):
            with self.assertRaises(EvidenceError):
                retrieve_sources(task, read_rows=lambda _: self.fail("unscoped read"))

    def test_requires_current_domain_approval_and_explicit_rights(self):
        for override in ({"matched": False}, {"decision": "deny"}, {"trust_mode": "item_verified"},
                         {"endpoint_id": None}, {"policy_decision_id": 0}, {"rights_class": "unknown"}, {"rights_class": "mixed"}, {}):
            policy = {**POLICY, **override} if override else {}
            with self.assertRaises(EvidenceError):
                self.retrieve([ROW], policy)

    def test_no_inference_from_label_or_cross_voyage_rows(self):
        for override in ({"license": ""}, {"license": "CC (see source)"},
                         {"license": "Copyright"}, {"voyage_slug": "unrelated"},
                         {"source_url": "https://user:password@example.org/book"}):
            with self.assertRaises(EvidenceError):
                self.retrieve([{**ROW, **override}])

    def test_creative_commons_is_supported_with_registry_approval(self):
        result = self.retrieve([{**ROW, "license": "CC BY-SA 4.0"}], {**POLICY, "rights_class": "creative_commons"})
        self.assertEqual(result[0]["rights"], "CC BY-SA 4.0")

    def test_size_and_duplicate_limits(self):
        rows = [{**ROW, "id": n, "content": "Long stored source. " * 500} for n in range(1, 41)]
        result = self.retrieve(rows + rows)
        self.assertLessEqual(len(json.dumps(result).encode()), SOURCE_BYTES)
        self.assertEqual(len(result), len({r["id"] for r in result}))
        self.assertTrue(all(len(r["text"]) <= 2500 for r in result))

    def test_registry_is_rechecked_and_no_result_survives_revocation(self):
        self.assertTrue(self.retrieve([ROW]))
        with self.assertRaises(EvidenceError):
            self.retrieve([ROW], {**POLICY, "decision": "deny"})


if __name__ == "__main__":
    unittest.main()
