"""No network/model: validate the request contract and fail-closed responses."""
from io import BytesIO
import json
import unittest
from urllib.error import HTTPError, URLError

from orchestration.editorial_gateway import GatewayConfig, GatewayError, SYSTEM_RULES, generate_candidate


def task():
    return {"id": 1, "role": "research", "topic": {"title": "Cabeza de Vaca"},
            "sources": [{"payload": {"note": "untrusted material"}}], "agent_config": {
                "agent_key": "historian", "version": 2, "name": "Historian", "role": "research",
                "model": "pinned-model", "instructions": "Compare the primary sources."}}


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.config = GatewayConfig("https://gateway.example/v1", "fixture-private-key", "editorial")

    def test_request_uses_pinned_model_and_instructions_and_output_is_candidate(self):
        calls = []

        def transport(request, timeout):
            calls.append((request, timeout))
            return BytesIO(json.dumps({"choices": [{"message": {"content": '{"notes":[]}'}}]}).encode())

        result = generate_candidate(task(), self.config, open_request=transport)
        request, timeout = calls[0]
        body = json.loads(request.data)
        self.assertEqual(request.full_url, "https://gateway.example/v1/chat/completions")
        self.assertEqual(body["model"], "pinned-model")
        self.assertEqual(body["messages"][0]["content"], SYSTEM_RULES)
        self.assertIn("Compare the primary sources.", body["messages"][1]["content"])
        self.assertNotIn("tools", body)
        self.assertEqual(request.get_header("X-limen-data-class"), "editorial")
        self.assertEqual(request.get_header("X-limen-mode"), "documents")
        self.assertEqual(timeout, 30)
        self.assertEqual(body["max_tokens"], 4096)
        self.assertEqual(result["verification"], "not-verified")
        self.assertEqual(result["agent_version"], 2)
        self.assertNotIn("fixture-private-key", json.dumps(result))
        self.assertNotIn("fixture-private-key", repr(self.config))

    def test_repair_prompt_deduplicates_snapshots_without_losing_accepted_evidence(self):
        value = task()
        value["role"] = value["agent_config"]["role"] = "writer"
        references = [{"id": "rag:1", "text": "Historical text. " * 700}]
        raw = {"candidate": {"references": references, "unrelated": "x" * 40000}}
        research = {"kind": "research", "references": references, "findings": [{"text": "Claim", "source_ids": ["rag:1"]}], "uncertainties": [], "candidate": raw}
        draft = {"kind": "draft", "title": "Draft", "body": "Claim", "citations": [{"source_id": "rag:1", "claim": "Claim"}], "references": references, "candidate": raw}
        value["input"] = {"brief": "Revise", "research_result": research, "draft_result": draft,
                          "review_result": {"kind": "review", "verdict": "changes-requested", "issues": ["Clarify"], "candidate": raw}}
        value["dependency_result"] = value["input"]["review_result"]
        calls = []
        def transport(request, timeout):
            calls.append(json.loads(request.data))
            return BytesIO(b'{"choices":[{"message":{"content":"{}"}}]}')
        generate_candidate(value, self.config, open_request=transport)
        record = json.loads(calls[0]["messages"][-1]["content"].split("\n", 1)[1])
        self.assertEqual(record["input"]["research_result"]["references"], references)
        self.assertEqual(record["input"]["draft_result"]["body"], "Claim")
        self.assertEqual(record["input"]["review_result"]["issues"], ["Clarify"])
        self.assertNotIn("dependency_result", record)
        self.assertNotIn("candidate", record["input"]["research_result"])
        self.assertNotIn("references", record["input"]["draft_result"])
        self.assertIn("candidate", value["input"]["research_result"])

    def test_missing_or_wrong_role_binding_never_calls_transport(self):
        for value in [{"id": 1, "role": "research"}, {**task(), "role": "writer"}]:
            with self.assertRaisesRegex(GatewayError, "agent-binding-invalid"):
                generate_candidate(value, self.config, open_request=lambda *_args, **_kw: self.fail("unexpected call"))

    def test_refusals_redirects_and_connection_errors_do_not_fallback_or_leak_bodies(self):
        for error in [HTTPError("https://gateway.example", code, "secret provider body", {}, BytesIO(b"secret")) for code in (302, 403, 429, 500)] + [URLError("secret URL"), TimeoutError("secret")]:
            calls = []

            def transport(*args, **kwargs):
                calls.append(args)
                raise error

            with self.assertRaises(GatewayError) as caught:
                generate_candidate(task(), self.config, open_request=transport)
            self.assertEqual(len(calls), 1)
            self.assertNotIn("secret", str(caught.exception))

    def test_invalid_and_oversized_outputs_never_become_successful_candidates(self):
        for payload in [b"not json", b"x" * 262145, b'{"choices":[]}', b'{"choices":[null]}',
                        b'{"choices":[{"message":{"content":"[]"}}]}',
                        b'{"choices":[{"message":{"content":"{\\"value\\":NaN}"}}]}']:
            with self.assertRaisesRegex(GatewayError, "gateway-invalid-response"):
                generate_candidate(task(), self.config, open_request=lambda *_args, **_kw: BytesIO(payload))

    def test_oversized_input_never_reaches_gateway(self):
        value = task()
        value["sources"] = ["x" * 65537]
        with self.assertRaisesRegex(GatewayError, "gateway-input-invalid"):
            generate_candidate(value, self.config, open_request=lambda *_args, **_kw: self.fail("unexpected call"))

    def test_environment_routes_only_exact_pinned_model_with_separate_key(self):
        env = {"EDITOR_LIMEN_BASE_URL": "https://gateway.example/v1",
               "EDITOR_LIMEN_API_KEY": "fixture-default", "EDITOR_LIMEN_DATA_CLASS": "editorial",
               "EDITOR_LIMEN_MODEL_KEYS": '{"pinned-model":"fixture-pinned"}'}
        config = GatewayConfig.from_environment(env)
        calls = []
        def transport(request, timeout):
            calls.append(request)
            return BytesIO(b'{"model":"reported-model","choices":[{"message":{"content":"{}"}}]}')
        result = generate_candidate(task(), config, open_request=transport)
        self.assertEqual(calls[0].get_header("Authorization"), "Bearer fixture-pinned")
        self.assertEqual(result["requested_model"], "pinned-model")
        self.assertEqual(result["reported_model"], "reported-model")
        self.assertNotIn("fixture-pinned", repr(config))
        value = task()
        value["agent_config"]["model"] = "unconfigured-model"
        with self.assertRaisesRegex(GatewayError, "gateway-model-not-authorized"):
            generate_candidate(value, config, open_request=transport)
        self.assertEqual(len(calls), 1)
        for raw in ['not-json', '{"other":"fixture-default"}', '{"local-default":"other"}']:
            with self.assertRaisesRegex(GatewayError, "gateway-not-configured"):
                GatewayConfig.from_environment({**env, "EDITOR_LIMEN_MODEL_KEYS": raw})

    def test_production_budget_is_bounded_and_routes_keep_model_scoped_credentials(self):
        env = {"EDITOR_LIMEN_BASE_URL": "https://gateway.example/v1",
               "EDITOR_LIMEN_API_KEY": "fixture-default", "EDITOR_LIMEN_DATA_CLASS": "editorial",
               "EDITOR_LIMEN_MODEL_KEYS": '{"pinned-model":"fixture-pinned"}'}
        config = GatewayConfig.from_environment(env)
        self.assertEqual(config.timeout_seconds, 120)
        self.assertEqual(config.max_tokens, 4096)
        config = GatewayConfig.from_environment({**env, "EDITOR_LIMEN_TIMEOUT_SECONDS": "90",
                                                 "EDITOR_LIMEN_MAX_TOKENS": "6144"})
        def transport(request, timeout):
            self.assertEqual(timeout, 90)
            self.assertEqual(request.get_header("Authorization"), "Bearer fixture-pinned")
            self.assertEqual(json.loads(request.data)["max_tokens"], 6144)
            return BytesIO(b'{"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]}')
        self.assertEqual(generate_candidate(task(), config, open_request=transport)["candidate"], {})
        for overrides in [{"EDITOR_LIMEN_TIMEOUT_SECONDS": "nan"},
                          {"EDITOR_LIMEN_TIMEOUT_SECONDS": "inf"},
                          {"EDITOR_LIMEN_TIMEOUT_SECONDS": "121"},
                          {"EDITOR_LIMEN_TIMEOUT_SECONDS": "0"},
                          {"EDITOR_LIMEN_MAX_TOKENS": "8193"},
                          {"EDITOR_LIMEN_MAX_TOKENS": "511"},
                          {"EDITOR_LIMEN_MAX_TOKENS": "4096.5"}]:
            with self.assertRaisesRegex(GatewayError, "gateway-not-configured"):
                GatewayConfig.from_environment({**env, **overrides})
        with self.assertRaisesRegex(GatewayError, "gateway-not-configured"):
            GatewayConfig("https://gateway.example/v1", "fixture", "editorial", max_tokens=True)

    def test_explicit_truncation_cannot_accept_even_valid_json_or_leak_content(self):
        for content in ('{}', '{', '{"private":"secret content"}'):
            body = json.dumps({"choices": [{"finish_reason": "length", "message": {"content": content}}]}).encode()
            with self.assertRaisesRegex(GatewayError, "gateway-output-truncated") as caught:
                generate_candidate(task(), self.config, open_request=lambda *_args, **_kw: BytesIO(body))
            self.assertNotIn("secret", str(caught.exception))

    def test_environment_requires_a_gateway_and_never_uses_provider_credentials(self):
        for env in [{}, {"ANTHROPIC_API_KEY": "fixture"}, {"EDITOR_LIMEN_BASE_URL": "https://api.anthropic.com",
                     "EDITOR_LIMEN_API_KEY": "fixture", "EDITOR_LIMEN_DATA_CLASS": "editorial"}]:
            with self.assertRaises(GatewayError):
                GatewayConfig.from_environment(env)


class AssignmentContextTests(unittest.TestCase):
    def test_prompt_keeps_assignment_metadata_without_lease_credentials(self):
        from orchestration.editorial_gateway import _prompt_material
        value = task()
        value["specialist_assignment"] = {"agent_key": "historian", "specialty": "history"}
        value["lease_token"] = "must-not-reach-model"
        material = _prompt_material(value)
        self.assertEqual(material["specialist_assignment"], value["specialist_assignment"])
        self.assertNotIn("lease_token", material)


if __name__ == "__main__":
    unittest.main()
