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
        self.assertEqual(result["verification"], "not-verified")
        self.assertEqual(result["agent_version"], 2)
        self.assertNotIn("fixture-private-key", json.dumps(result))
        self.assertNotIn("fixture-private-key", repr(self.config))

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
        for payload in [b"not json", b"x" * 262145, b'{"choices":[]}',
                        b'{"choices":[{"message":{"content":"[]"}}]}',
                        b'{"choices":[{"message":{"content":"{\\"value\\":NaN}"}}]}']:
            with self.assertRaisesRegex(GatewayError, "gateway-invalid-response"):
                generate_candidate(task(), self.config, open_request=lambda *_args, **_kw: BytesIO(payload))

    def test_oversized_input_never_reaches_gateway(self):
        value = task()
        value["sources"] = ["x" * 65537]
        with self.assertRaisesRegex(GatewayError, "gateway-input-invalid"):
            generate_candidate(value, self.config, open_request=lambda *_args, **_kw: self.fail("unexpected call"))

    def test_environment_requires_a_gateway_and_never_uses_provider_credentials(self):
        for env in [{}, {"ANTHROPIC_API_KEY": "fixture"}, {"EDITOR_LIMEN_BASE_URL": "https://api.anthropic.com",
                     "EDITOR_LIMEN_API_KEY": "fixture", "EDITOR_LIMEN_DATA_CLASS": "editorial"}]:
            with self.assertRaises(GatewayError):
                GatewayConfig.from_environment(env)


if __name__ == "__main__":
    unittest.main()
