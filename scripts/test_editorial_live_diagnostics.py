"""Offline fixtures only: no Docker, network, model, source or live DB calls."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import editorial_live_diagnostics as diagnostics


class DiagnosticsTests(unittest.TestCase):
    def test_labels_counts_and_database_projection_never_export_arbitrary_fields(self):
        value = diagnostics.database_metadata([{"id": 1, "model": "sk-SECRET", "enabled": True,
                                               "instructions": "SECRET", "lease_token": "SECRET", "role": "research"}])
        self.assertEqual(value, [{"id": 1, "model": None, "enabled": True, "role": "research"}])
        self.assertIsNone(diagnostics.label("BearerSECRET"))
        self.assertIsNone(diagnostics.label("human@example.org"))
        self.assertIsNone(diagnostics.safe_count(True))

    def test_trace_extracts_only_routing_metadata_and_keeps_alias_caveat(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "decision.jsonl"
            header = {"run": {"run_id": "request-1", "created_ts": 123, "metadata": {"principal": "SECRET"}}}
            record = {"writes": {"facts": [{"key": "model", "value": "gemma4:26b-mlx"},
                                            {"key": "provider", "value": "ollama_chat"},
                                            {"key": "prompt", "value": "SECRET"}]}}
            path.write_text(json.dumps(header) + "\n" + json.dumps(record) + "\n")
            decision = diagnostics.read_trace(path)
            result = diagnostics.project_trace(decision, ({"metadata": {"model": "local-default", "status": "success",
                                                                           "error": "SECRET", "api_key": "SECRET"}}, {}))
            self.assertEqual(result["decision_model"], "gemma4:26b-mlx")
            self.assertEqual(result["effect"]["response_reported_model"], "local-default")
            self.assertNotIn("served_model", result)
            self.assertNotIn("SECRET", json.dumps(result))
            path.write_text('{"private":"SECRET"}\nINVALID')
            self.assertIsNone(diagnostics.read_trace(path))

    def test_database_calls_are_read_only_and_errors_are_bounded(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            if len(calls) == 1:
                return json.dumps({name: True for name in diagnostics.TABLES})
            return json.dumps([{"id": 1, "model": "local-default", "password": "SECRET"}])
        with patch.object(diagnostics, "run_command", side_effect=run):
            report = diagnostics.database_report(1, "terraveler_postgres", "terraveler", "terraveler")
        self.assertEqual(report["state"], "read")
        self.assertNotIn("SECRET", json.dumps(report))
        for args in calls:
            self.assertEqual(args[:3], ["docker", "exec", "-i"])
            self.assertIn("begin read only", args[-1])
            self.assertNotIn("pg_password", args[-1].lower())
        with patch.object(diagnostics, "run_command", return_value=None):
            self.assertEqual(diagnostics.database_report(1, "db", "user", "db")["state"], "unavailable")

    def test_missing_and_corrupt_private_config_are_not_successful_model_proof(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / "broken.yaml"
            config.write_text('api_key: SECRET\nmodel_list: [broken')
            with patch.dict(diagnostics.os.environ, {"LIMEN_EVIDENCE_DIR": folder,
                            "LIMEN_LITELLM_CONFIG": str(config), "LIMEN_DEFAULT_TENANT": "terraveler"}):
                report = diagnostics.limen_report()
            self.assertEqual(report["configured_routes"], [])
            self.assertEqual(report["events"], [])
            self.assertEqual(report["state"], "unavailable")
            self.assertNotIn("SECRET", json.dumps(report))

    def test_non_scalar_trace_ids_and_metadata_are_not_exported_or_used_as_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ("decisions", "effects"):
                (root / name).mkdir()
            (root / "decisions" / "bad.jsonl").write_text(json.dumps({"run": {"run_id": ["SECRET"]}}))
            (root / "effects" / "bad.jsonl").write_text(json.dumps({"run": {"metadata": "SECRET"}}))
            with patch.dict(diagnostics.os.environ, {"LIMEN_EVIDENCE_DIR": folder,
                            "LIMEN_LITELLM_CONFIG": str(root / "missing"), "LIMEN_DEFAULT_TENANT": "terraveler"}):
                report = diagnostics.limen_report()
            self.assertEqual(report["events"][0]["request_id"], None)
            self.assertNotIn("SECRET", json.dumps(report))


if __name__ == "__main__": unittest.main()
