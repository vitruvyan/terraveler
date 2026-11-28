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
        self.assertEqual(body["response_format"]["type"], "json_schema")
        self.assertTrue(body["response_format"]["json_schema"]["strict"])
        self.assertFalse(body["response_format"]["json_schema"]["schema"]["additionalProperties"])
        finding = body["response_format"]["json_schema"]["schema"]["properties"]["findings"]["items"]["properties"]
        self.assertEqual(finding["quotes"]["maxItems"], 0)
        self.assertEqual(finding["text"]["pattern"], '^[^"“”«»]*$')
        self.assertEqual(result["verification"], "not-verified")
        self.assertEqual(result["agent_version"], 2)
        self.assertNotIn("fixture-private-key", json.dumps(result))
        self.assertNotIn("fixture-private-key", repr(self.config))

    def test_each_role_requests_its_own_closed_output_schema(self):
        for role, kind in (("research", "research"), ("writer", "draft"), ("reviewer", "review")):
            with self.subTest(role=role):
                value = task()
                value["role"] = value["agent_config"]["role"] = role
                calls = []
                def transport(request, timeout):
                    calls.append(json.loads(request.data))
                    return BytesIO(b'{"choices":[{"message":{"content":"{}"}}]}')
                generate_candidate(value, self.config, open_request=transport)
                contract = calls[0]["response_format"]["json_schema"]
                self.assertEqual(contract["name"], "terraveler_editorial_" + role)
                self.assertEqual(contract["schema"]["properties"]["kind"]["const"], kind)
                self.assertFalse(contract["schema"]["additionalProperties"])
                if role == "writer":
                    properties = contract["schema"]["properties"]
                    paragraph = properties["paragraphs"]["items"]["properties"]
                    self.assertEqual(paragraph["text"]["pattern"], '^[^"“”«»]*$')
                    self.assertEqual(set(paragraph), {"text", "source_id"})
                    self.assertNotIn("body", properties)
                    self.assertNotIn("citations", properties)

    def test_source_ids_are_constrained_to_known_sources(self):
        from orchestration.editorial_gateway import ROLE_OUTPUT_SCHEMAS, ITINERARY_OUTPUT_SCHEMA
        before = json.dumps([ROLE_OUTPUT_SCHEMAS, ITINERARY_OUTPUT_SCHEMA], sort_keys=True)
        def schema_for(value):
            calls = []
            def transport(request, timeout):
                calls.append(json.loads(request.data))
                return BytesIO(b'{"choices":[{"message":{"content":"{}"}}]}')
            generate_candidate(value, self.config, open_request=transport)
            return calls[0]["response_format"]["json_schema"]["schema"]
        ids = ["mcp:a", "mcp:b"]
        value = task()
        value["input"] = {"work_item": {"id": "route", "specialty": "itinerary"},
                          "retrieved_sources": [{"id": i, "text": "t"} for i in ids]}
        schema = schema_for(value)
        self.assertEqual(schema["properties"]["findings"]["items"]["properties"]["source_ids"]["items"], {"enum": ids})
        self.assertEqual(schema["properties"]["waypoints"]["items"]["properties"]["source_ids"]["items"], {"enum": ids})
        self.assertTrue(schema["properties"]["findings"]["items"]["properties"]["source_ids"]["uniqueItems"])
        value = task()
        value["role"] = value["agent_config"]["role"] = "writer"
        value["input"] = {"research_result": {"kind": "research", "references": [{"id": "mcp:a"}]}}
        schema = schema_for(value)
        self.assertEqual(schema["properties"]["paragraphs"]["items"]["properties"]["source_id"], {"enum": ["mcp:a"]})
        value = task()
        self.assertEqual(schema_for(value)["properties"]["findings"]["items"]["properties"]["source_ids"]["items"],
                         {"type": "string", "minLength": 1})
        self.assertEqual(before, json.dumps([ROLE_OUTPUT_SCHEMAS, ITINERARY_OUTPUT_SCHEMA], sort_keys=True))

    def test_reviewer_contract_only_requests_writer_fixable_changes(self):
        value = task()
        value["role"] = value["agent_config"]["role"] = "reviewer"
        calls = []
        def transport(request, timeout):
            calls.append(json.loads(request.data))
            return BytesIO(b'{"choices":[{"message":{"content":"{}"}}]}')
        generate_candidate(value, self.config, open_request=transport)
        contract = calls[0]["messages"][2]["content"]
        self.assertIn("never request direct quotations", contract)
        self.assertNotIn("quote accuracy", contract)
        self.assertIn("Waypoints are fixed by the itinerary researcher", contract)
        self.assertIn("use blocked and name the waypoint ID", contract)
        self.assertIn("changes-requested only for issues the writer can fix", contract)

    def test_itinerary_requires_closed_structured_waypoints(self):
        value = task()
        value["input"] = {"work_item": {"id": "route", "specialty": "itinerary"}}
        calls = []
        def transport(request, timeout):
            calls.append(json.loads(request.data))
            return BytesIO(b'{"choices":[{"message":{"content":"{}"}}]}')
        generate_candidate(value, self.config, open_request=transport)
        contract = calls[0]["response_format"]["json_schema"]
        self.assertEqual(contract["name"], "terraveler_editorial_itinerary")
        self.assertIn("waypoints", contract["schema"]["required"])
        waypoint = contract["schema"]["properties"]["waypoints"]["items"]
        self.assertFalse(waypoint["additionalProperties"])
        self.assertEqual(waypoint["properties"]["latitude"]["minimum"], -90)
        self.assertEqual(waypoint["properties"]["longitude"]["maximum"], 180)
        self.assertIn("coordinate_note", waypoint["required"])
        self.assertIn("uncertainty", waypoint["required"])
        for field in ("date_note", "coordinate_note", "uncertainty"):
            self.assertEqual(waypoint["properties"][field]["maxLength"], 500)
        self.assertIn("candidate", calls[0]["messages"][2]["content"])

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
        config = GatewayConfig.from_environment({**env, "EDITOR_LIMEN_TIMEOUT_SECONDS": "900"})
        self.assertEqual(config.timeout_seconds, 900)
        for overrides in [{"EDITOR_LIMEN_TIMEOUT_SECONDS": "nan"},
                          {"EDITOR_LIMEN_TIMEOUT_SECONDS": "inf"},
                          {"EDITOR_LIMEN_TIMEOUT_SECONDS": "901"},
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


class SubmissionCompactionTests(unittest.TestCase):
    def test_prompt_keeps_where_and_when_but_not_evidence_quotations(self):
        from orchestration.editorial_gateway import _prompt_material
        quote = "Fa-Hian, leaving Chang'an, was five years in arriving at Mid-India. " * 30
        waypoint = {"seq": 1, "place_historical": "Chang'an", "latitude": 34.3, "longitude": 108.9,
                    "arrival_date": "399", "confidence": "medium",
                    "claims": [{"text": "He left Chang'an.", "evidence": {"quote": quote}}]}
        snapshot = {"id": 13, "target_voyage": "faxian-399", "payload": {"voyage": {"title": "Faxian"}, "waypoints": [waypoint] * 38}}
        material = _prompt_material({"id": 1, "sources": [snapshot], "input": {}})
        compact = material["sources"][0]["payload"]["waypoints"][0]
        self.assertEqual(compact["claims"], ["He left Chang'an."])
        self.assertEqual((compact["latitude"], compact["arrival_date"]), (34.3, "399"))
        self.assertNotIn(quote[:40], json.dumps(material))
        self.assertLess(len(json.dumps(material)), len(json.dumps(snapshot)) / 10)
        self.assertIn("evidence", snapshot["payload"]["waypoints"][0]["claims"][0], "the stored snapshot is untouched")
