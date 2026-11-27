"""Offline fixtures only: no network, model, source or live DB calls."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import editorial_model_benchmark as bench  # noqa: E402


def envelope(content, finish="stop", model="fixture-alias"):
    if not isinstance(content, str):
        content = json.dumps(content)
    return {"model": model, "choices": [{"finish_reason": finish, "message": {"content": content}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5}}


def config():
    return bench.GatewayConfig("https://limen.fixture", "k-fixture", "editorial",
                               model_keys={"local-default": "k-fixture", "bench-qwen": "k-qwen"})


def transport_with(body, status=200):
    def transport(url, payload, key, data_class, timeout):
        return status, body, json.dumps(body)
    return transport


class ParseTests(unittest.TestCase):
    def test_strict_parse_categories(self):
        parsed, finish, length, digest = bench.parse_envelope(envelope({"a": 1}))
        self.assertEqual(parsed, {"a": 1})
        self.assertEqual(finish, "stop")
        self.assertGreater(length, 0)
        self.assertEqual(len(digest), 64)
        fenced, *_ = bench.parse_envelope(envelope("```json\n{\"a\": 1}\n```"))
        self.assertEqual(fenced, {"a": 1})
        for body, category in [
            (envelope("not json"), "invalid-json"),
            (envelope("  "), "empty-content"),
            (envelope({"a": 1}, finish="length"), "output-truncated"),
            ({"choices": []}, "missing-choice"),
            (envelope("x" * (bench.MAX_CONTENT + 1)), "output-too-large"),
        ]:
            with self.assertRaises(bench.ParseFailure) as ctx:
                bench.parse_envelope(body)
            self.assertEqual(ctx.exception.category, category)

    def test_no_prose_extraction(self):
        with self.assertRaises(bench.ParseFailure) as ctx:
            bench.parse_envelope(envelope('Here is the plan: {"a": 1} hope this helps'))
        self.assertEqual(ctx.exception.category, "invalid-json")


class ValidatorTests(unittest.TestCase):
    def test_valid_fixtures_pass(self):
        self.assertEqual(bench.compose_plan(bench.FIXTURE_RESEARCH_PLAN), bench.FIXTURE_PLAN)
        self.assertEqual(bench.validate_plan_output(bench.FIXTURE_RESEARCH_PLAN), [])
        self.assertEqual(bench.validate_plan(bench.FIXTURE_PLAN), [])
        self.assertEqual(bench.validate_research(bench.FIXTURE_RESEARCH), [])
        self.assertEqual(bench.validate_draft(bench.FIXTURE_DRAFT_CANDIDATE), [])
        self.assertEqual(bench.validate_review({"kind": "review", "verdict": "ready-for-editor", "issues": []}), [])
        self.assertEqual(bench.validate_plan_review({"verdict": "adequate-for-next-stage", "issues": []}), [])

    def test_plan_graph_rules(self):
        bad = json.loads(json.dumps(bench.FIXTURE_PLAN))
        bad["work_items"][0]["specialty"] = "astrology"
        self.assertIn("bad-specialty", bench.validate_plan(bad))
        bad = json.loads(json.dumps(bench.FIXTURE_PLAN))
        bad["work_items"][0]["depends_on"] = ["ghost"]
        self.assertIn("dangling-dependency", bench.validate_plan(bad))
        bad = json.loads(json.dumps(bench.FIXTURE_PLAN))
        bad["work_items"][0]["depends_on"] = ["crossing"]
        bad["work_items"][1]["depends_on"] = ["wreck"]
        self.assertIn("dependency-cycle", bench.validate_plan(bad))
        bad = json.loads(json.dumps(bench.FIXTURE_PLAN))
        bad["work_items"][0]["source_receipt_ids"] = ["mcp:fixture-src-1"]
        self.assertIn("receipt-ids-must-be-empty", bench.validate_plan(bad))
        bad = json.loads(json.dumps(bench.FIXTURE_PLAN))
        bad["work_items"][2]["depends_on"] = ["wreck"]
        self.assertIn("writer-research-coverage", bench.validate_plan(bad))
        bad = json.loads(json.dumps(bench.FIXTURE_PLAN))
        bad["work_items"][4]["depends_on"] = ["editorial"]
        self.assertIn("writer-review-coverage", bench.validate_plan(bad))
        bad = json.loads(json.dumps(bench.FIXTURE_RESEARCH_PLAN))
        bad["research_items"][0]["depends_on"] = []
        self.assertEqual(bench.validate_plan_output(bad), ["invalid-research-plan"])
        bad = json.loads(json.dumps(bench.FIXTURE_RESEARCH_PLAN))
        bad["research_items"][0]["id"] = "diary"
        self.assertIn("bad-or-duplicate-id", bench.validate_plan_output(bad))

    def test_research_is_paraphrase_with_known_sources(self):
        bad = json.loads(json.dumps(bench.FIXTURE_RESEARCH))
        bad["findings"][0]["quotes"] = [{"source_id": "mcp:fixture-src-1", "text": "exact source words"}]
        self.assertIn("quotes-must-be-empty", bench.validate_research(bad))
        bad = json.loads(json.dumps(bench.FIXTURE_RESEARCH))
        bad["findings"][0]["source_ids"] = ["mcp:invented"]
        self.assertIn("unknown-source-id", bench.validate_research(bad))
        bad = json.loads(json.dumps(bench.FIXTURE_RESEARCH))
        bad["findings"][0]["text"] = 'An unnecessary "quotation"'
        self.assertIn("bad-finding-text", bench.validate_research(bad))

    def test_draft_uses_structured_paragraphs(self):
        bad = json.loads(json.dumps(bench.FIXTURE_DRAFT_CANDIDATE))
        bad["paragraphs"][0]["source_id"] = "mcp:invented"
        self.assertIn("unknown-source-id", bench.validate_draft(bad))
        bad = json.loads(json.dumps(bench.FIXTURE_DRAFT_CANDIDATE))
        bad["paragraphs"][0]["claim"] = "duplicate trusted field"
        self.assertIn("bad-paragraph", bench.validate_draft(bad))

    def test_verdict_issue_consistency(self):
        self.assertIn("verdict-issues-mismatch",
                      bench.validate_plan_review({"verdict": "adequate-for-next-stage", "issues": ["x"]}))
        self.assertIn("ready-with-issues",
                      bench.validate_review({"kind": "review", "verdict": "ready-for-editor", "issues": ["x"]}))
        self.assertIn("bad-verdict", bench.validate_review({"kind": "review", "verdict": "publish", "issues": []}))


class RunCellTests(unittest.TestCase):
    def test_ok_cell_records_metadata_only(self):
        cell = bench.run_cell("review", "local-default", config(), 30, True,
                              transport=transport_with(envelope({"kind": "review",
                                                                 "verdict": "ready-for-editor", "issues": []})))
        self.assertEqual(cell["outcome"], "ok")
        self.assertEqual(cell["http_status"], 200)
        self.assertEqual(cell["completion_tokens"], 5)
        self.assertNotIn("ready-for-editor", json.dumps(cell).replace('"verdict"', ''))  # no raw content
        plan = bench.run_cell("plan", "local-default", config(), 30, True,
                              transport=transport_with(envelope(bench.FIXTURE_RESEARCH_PLAN)))
        self.assertEqual(plan["outcome"], "ok")
        self.assertEqual(plan["specialty_counts"]["copyedit"], 2)
        self.assertEqual(plan["specialty_counts"]["factcheck"], 2)
        self.assertNotIn("Narvaez", json.dumps(plan))

    def test_invalid_json_and_transport_categories(self):
        cell = bench.run_cell("plan", "local-default", config(), 30, True,
                              transport=transport_with(envelope("broken")))
        self.assertEqual(cell["outcome"], "invalid-json")
        cell = bench.run_cell("plan", "local-default", config(), 30, True,
                              transport=transport_with({}, status=503))
        self.assertEqual(cell["outcome"], "http-503")
        cell = bench.run_cell("plan", "unauthorized-alias", config(), 30, True,
                              transport=transport_with(envelope({"a": 1})))
        self.assertEqual(cell["outcome"], "model-not-authorized")

    def test_json_mode_uses_the_exact_production_schemas(self):
        seen = []
        def transport(url, payload, key, data_class, timeout):
            seen.append(payload)
            return 200, envelope(bench.FIXTURE_DRAFT_CANDIDATE), "operator-local"
        cell = bench.run_cell("draft", "local-default", config(), 30, True, transport=transport)
        self.assertEqual(cell["outcome"], "ok")
        guided = seen[0]["response_format"]
        self.assertEqual(guided["type"], "json_schema")
        self.assertTrue(guided["json_schema"]["strict"])
        self.assertIs(guided["json_schema"]["schema"], bench.ROLE_OUTPUT_SCHEMAS["writer"])

    def test_schema_invalid_keeps_only_error_kinds(self):
        cell = bench.run_cell("plan-review", "local-default", config(), 30, True,
                              transport=transport_with(envelope({"verdict": "publish-it", "issues": "yes"})))
        self.assertEqual(cell["outcome"], "schema-invalid")
        self.assertIn("bad-verdict", cell["schema_error_kinds"])
        self.assertNotIn("publish-it", json.dumps(cell))

    def test_save_raw_stays_operator_local(self):
        with tempfile.TemporaryDirectory() as folder:
            cell = bench.run_cell("review", "bench-qwen", config(), 30, True, raw_dir=Path(folder),
                                  transport=transport_with(envelope({"kind": "review",
                                                                     "verdict": "SECRET-verdict", "issues": []})))
            self.assertEqual(cell["outcome"], "schema-invalid")
            raw_files = list(Path(folder).glob("*.json"))
            self.assertEqual(len(raw_files), 1)
            self.assertIn("SECRET", raw_files[0].read_text())   # raw stays in the local dir only
            self.assertNotIn("SECRET", json.dumps(cell))        # never in the report cell


class SummaryTests(unittest.TestCase):
    def test_summary_aggregates_outcomes(self):
        cells = [
            {"role": "plan", "alias": "a", "outcome": "ok", "duration_ms": 100},
            {"role": "plan", "alias": "a", "outcome": "invalid-json", "duration_ms": 200},
            {"role": "plan", "alias": "b", "outcome": "ok", "duration_ms": 50},
        ]
        summary = bench.summarize(cells)
        a = next(s for s in summary if s["alias"] == "a")
        self.assertEqual(a["ok_rate"], 0.5)
        self.assertEqual(a["outcomes"], {"invalid-json": 1, "ok": 1})
        self.assertEqual(a["duration_ms_p50"], 150)


if __name__ == "__main__":
    unittest.main()
