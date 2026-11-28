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


class QueryEmbeddingTests(unittest.TestCase):
    def setUp(self):
        self.env = {"EDITORIAL_MCP_URL": "https://www.terraveler.com/api/mcp", "EDITORIAL_MCP_CORPUS_KEY": "x" * 40,
                    "EDITORIAL_CORPUS_RELEVANCE": "1", "EDITORIAL_EMBEDDING_URL": "http://127.0.0.1:6002/v1/embeddings/create"}
        self.task = {"id": 12, "attempt": 1, "input": {"work_item": {"question": "Which peoples met the fleet at Cebu?"}}}
        self.vector = [0.01] * 768
        self.result = {"jsonrpc": "2.0", "id": 1, "result": {"structuredContent": {
            "task_id": 12, "attempt": 1, "sources": [{"id": "rag:1", "governance": {"endpoint_id": 2}}],
            "retrieval": {"mode": "relevance", "works": 1},
            "consultation": {"id": "00000000-0000-4000-8000-000000000001", "snapshot_sha256": "a" * 64}}}}

    def embedder(self, vector=None):
        def opener(request, timeout):
            self.assertEqual(json.loads(request.data), {"text": "Which peoples met the fleet at Cebu?"})
            return io.BytesIO(json.dumps({"embedding": self.vector if vector is None else vector}).encode())
        return opener

    def test_question_embedding_travels_with_the_corpus_request(self):
        def corpus(request, timeout):
            arguments = json.loads(request.data)["params"]["arguments"]
            self.assertEqual(arguments["query_embedding"], self.vector)
            return io.BytesIO(json.dumps(self.result).encode())
        data = retrieve_mcp_sources(self.task, env=self.env, open_request=corpus, embed_request=self.embedder())
        self.assertEqual(data[0]["id"], "rag:1")

    def test_disabled_relevance_sends_no_embedding(self):
        env = dict(self.env, EDITORIAL_CORPUS_RELEVANCE="0")
        del self.result["result"]["structuredContent"]["retrieval"]
        def corpus(request, timeout):
            self.assertEqual(json.loads(request.data)["params"]["arguments"], {"task_id": 12, "attempt": 1})
            return io.BytesIO(json.dumps(self.result).encode())
        retrieve_mcp_sources(self.task, env=env, open_request=corpus,
                             embed_request=lambda *a, **k: self.fail("embedding must not be requested"))

    def test_no_silent_fallback_to_an_unranked_read(self):
        never = lambda *a, **k: self.fail("corpus must not be read")
        for vector in ([0.01] * 767, [float("nan")] * 768, ["x"] * 768):
            with self.assertRaisesRegex(EvidenceError, "editorial-embedding-unavailable"):
                retrieve_mcp_sources(self.task, env=self.env, open_request=never, embed_request=self.embedder(vector))
        with self.assertRaisesRegex(EvidenceError, "editorial-research-question-required"):
            retrieve_mcp_sources({"id": 12, "attempt": 1, "input": {}}, env=self.env, open_request=never)
        # A server that ignored the embedding (unranked) is refused, not trusted.
        self.result["result"]["structuredContent"]["retrieval"]["mode"] = "diversity"
        with self.assertRaises(EvidenceError):
            retrieve_mcp_sources(self.task, env=self.env, embed_request=self.embedder(),
                                 open_request=lambda *a, **k: io.BytesIO(json.dumps(self.result).encode()))


class EmbeddingConfigurationTests(unittest.TestCase):
    def test_relevance_without_a_configured_service_fails_closed(self):
        env = {"EDITORIAL_CORPUS_RELEVANCE": "1"}
        task = {"id": 1, "attempt": 1, "input": {"work_item": {"question": "Where?"}}}
        with self.assertRaisesRegex(EvidenceError, "editorial-embedding-not-configured"):
            retrieve_mcp_sources(task, env=env, open_request=lambda *a, **k: self.fail("no read"))
