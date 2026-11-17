import io
import json
import unittest
from orchestration.editorial_handlers import EvidenceError
from orchestration.editorial_mcp_corpus import retrieve_mcp_sources


class McpCorpusTests(unittest.TestCase):
    def setUp(self):
        self.env = {"EDITORIAL_MCP_URL": "https://www.terraveler.com/api/mcp", "EDITORIAL_MCP_CORPUS_KEY": "x" * 40}
        self.task = {"id": 12, "attempt": 1}
        self.result = {"jsonrpc": "2.0", "id": 1, "result": {"structuredContent": {
            "task_id": 12, "attempt": 1, "sources": [{"id": "rag:1", "governance": {"endpoint_id": 2}}],
            "consultation": {"id": "00000000-0000-4000-8000-000000000001", "snapshot_sha256": "a"*64}
        }}}

    def test_exact_request_and_receipt(self):
        def opener(request, timeout):
            self.assertEqual(json.loads(request.data)["params"]["arguments"], {"task_id": 12, "attempt": 1})
            self.assertEqual(request.get_header("X-editorial-mcp-key"), self.env["EDITORIAL_MCP_CORPUS_KEY"])
            return io.BytesIO(json.dumps(self.result).encode())
        data = retrieve_mcp_sources(self.task, env=self.env, open_request=opener)
        self.assertEqual(data[0]["governance"]["mcp_snapshot_sha256"], "a"*64)

    def test_receipt_or_configuration_failure_never_falls_back(self):
        with self.assertRaises(EvidenceError):
            retrieve_mcp_sources(self.task, env={}, open_request=lambda *a, **k: self.fail("unexpected call"))
        self.result["result"]["structuredContent"]["attempt"] = 2
        with self.assertRaises(EvidenceError):
            retrieve_mcp_sources(self.task, env=self.env, open_request=lambda *a, **k: io.BytesIO(json.dumps(self.result).encode()))
