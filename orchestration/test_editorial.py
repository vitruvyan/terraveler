"""No live database, network or model. Real spawned workers and native Motus.

Run: python -m unittest orchestration.test_editorial -v
"""
from __future__ import annotations

import json
import os
import time
import unittest
from unittest.mock import patch

from orchestration.editorial import EditorialWorker, WorkerConfig, PostgresStore, main


def research(task):
    if "lease_token" in task:
        raise AssertionError("lease leaked into handler context")
    return {"kind": "research-notes", "candidate_sources": [], "topic": task["topic"]["title"]}


def slow_research(task):
    time.sleep(2)
    return research(task)


def broken_research(task):
    raise RuntimeError("secret-provider-key-should-not-be-persisted")


def invalid_research(task):
    return ["not-a-result-object"]


class MemoryStore:
    """Fencing oracle; SQL behavior is covered by editorial-workflow-sql tests."""
    def __init__(self):
        self.task = {"id": 1, "topic_id": 2, "role": "research", "input": {},
                     "topic": {"title": "Cabeza de Vaca"}, "sources": [],
                     "lease_token": "attempt-1", "dependency_result": None}
        self.calls = []
        self.renewable = True
        self.saved = []
        self.claimed = False

    def claim(self, worker, roles, lease_seconds):
        self.calls.append(("claim", worker, roles, lease_seconds))
        if self.claimed:
            return None
        self.claimed = True
        return dict(self.task)

    def renew(self, task, lease_seconds):
        self.calls.append(("renew", task["lease_token"]))
        return self.renewable and task["lease_token"] == self.task["lease_token"]

    def complete(self, task, result, trace):
        self.calls.append(("complete", task["lease_token"]))
        if task["lease_token"] != self.task["lease_token"]:
            raise ValueError("stale lease")
        self.saved.append((result, trace))
        return {"result_id": 10, "replayed": False}

    def fail(self, task, error):
        self.calls.append(("fail", error))
        return True

    def recover(self):
        self.task["lease_token"] = "attempt-2"
        self.claimed = False
        return 1


class DurableWorkerTests(unittest.TestCase):
    def cfg(self, **kw):
        return WorkerConfig(**{"enabled": True, "timeout_seconds": 10, **kw})

    def test_disabled_or_empty_registry_never_claims(self):
        store = MemoryStore()
        self.assertEqual(EditorialWorker(store, {"research": research}, WorkerConfig()).run_once(),
                         {"status": "disabled"})
        self.assertEqual(EditorialWorker(store, {}, self.cfg()).run_once(), {"status": "no-handlers"})
        self.assertEqual(store.calls, [])

    def test_claim_only_supported_roles_and_persist_native_motus_trace(self):
        store = MemoryStore()
        done = EditorialWorker(store, {"research": research}, self.cfg()).run_once()
        self.assertEqual(done["status"], "completed")
        self.assertEqual(store.calls[0][2], ["research"])
        result, trace = store.saved[0]
        self.assertEqual(result["topic"], "Cabeza de Vaca")
        self.assertTrue(trace["root"])
        records = [json.loads(line) for line in trace["trace_jsonl"].splitlines()]
        self.assertGreater(len(records), 3)
        self.assertNotIn("attempt-1", trace["trace_jsonl"])
        self.assertIn("recorded_effect", trace["trace_jsonl"])
        self.assertIn("Cabeza de Vaca", trace["trace_jsonl"])
        self.assertIn('"sources"', trace["trace_jsonl"])
        self.assertIn('"dependency_result"', trace["trace_jsonl"])
        self.assertEqual(EditorialWorker(store, {"research": research}, self.cfg()).run_once()["status"], "idle")

    def test_lease_loss_terminates_work_and_never_commits_or_fails_stale_attempt(self):
        store = MemoryStore()
        store.renewable = False
        done = EditorialWorker(store, {"research": slow_research}, self.cfg(heartbeat_seconds=0.05)).run_once()
        self.assertEqual(done["status"], "lease-lost")
        self.assertFalse(store.saved)
        self.assertFalse(any(c[0] in {"complete", "fail"} for c in store.calls))

    def test_heartbeat_renews_while_handler_runs(self):
        store = MemoryStore()
        done = EditorialWorker(store, {"research": slow_research}, self.cfg(heartbeat_seconds=0.1)).run_once()
        self.assertEqual(done["status"], "completed")
        self.assertGreater(len([c for c in store.calls if c[0] == "renew"]), 2)

    def test_timeout_records_bounded_failure_and_never_commits_output(self):
        store = MemoryStore()
        done = EditorialWorker(store, {"research": slow_research}, self.cfg(timeout_seconds=0.1)).run_once()
        self.assertEqual(done["status"], "failed")
        self.assertIn(("fail", "editorial-handler-timeout"), store.calls)
        self.assertFalse(store.saved)

    def test_exception_does_not_leak_provider_message(self):
        store = MemoryStore()
        done = EditorialWorker(store, {"research": broken_research}, self.cfg()).run_once()
        self.assertEqual(done["status"], "failed")
        self.assertIn(("fail", "editorial-handler-failed"), store.calls)
        self.assertNotIn("secret-provider", repr(store.calls))
        self.assertFalse(store.saved)

    def test_non_object_result_is_rejected(self):
        store = MemoryStore()
        done = EditorialWorker(store, {"research": invalid_research}, self.cfg()).run_once()
        self.assertEqual(done["status"], "failed")
        self.assertFalse(store.saved)

    def test_new_process_resumes_recovered_task_with_new_token(self):
        store = MemoryStore()
        store.renewable = False
        self.assertEqual(EditorialWorker(store, {"research": slow_research}, self.cfg(heartbeat_seconds=0.05)).run_once()["status"], "lease-lost")
        store.recover()
        store.renewable = True
        self.assertEqual(EditorialWorker(store, {"research": research}, self.cfg()).run_once()["status"], "completed")
        self.assertEqual([c for c in store.calls if c[0] == "complete"], [("complete", "attempt-2")])

    def test_unknown_roles_and_invalid_deadlines_are_refused_before_claim(self):
        with self.assertRaises(ValueError):
            EditorialWorker(MemoryStore(), {"publisher": research}, self.cfg())
        with self.assertRaises(ValueError):
            self.cfg(heartbeat_seconds=50)
        with self.assertRaises(ValueError):
            self.cfg(timeout_seconds=0)
        for kw in ({"lease_seconds": 601}, {"timeout_seconds": float("nan")},
                   {"timeout_seconds": float("inf")}, {"heartbeat_seconds": float("nan")}):
            with self.assertRaises(ValueError):
                self.cfg(**kw)

    def test_completion_retries_exact_payload_after_transport_loss(self):
        import psycopg2
        store = PostgresStore({})
        task = MemoryStore().task
        payload, trace = {"notes": []}, {"root": "fixture"}
        with patch.object(store, "_call", side_effect=[psycopg2.OperationalError("connection lost"),
                                                       {"result_id": 10, "replayed": True}]) as call:
            self.assertTrue(store.complete(task, payload, trace)["replayed"])
            self.assertEqual(call.call_count, 2)
            self.assertEqual(call.call_args_list[0], call.call_args_list[1])

    def test_unpickleable_handler_is_failed_without_waiting_for_expiry(self):
        store = MemoryStore()
        done = EditorialWorker(store, {"research": lambda task: {}}, self.cfg()).run_once()
        self.assertEqual(done["status"], "failed")
        self.assertIn(("fail", "editorial-handler-start-failed"), store.calls)
        self.assertFalse(store.saved)

    def test_cli_never_connects_without_opt_in_or_registered_handler(self):
        with patch.dict(os.environ, {}, clear=True), patch("orchestration.editorial.PostgresStore") as pg:
            self.assertEqual(main(["--once"]), 0)
            pg.assert_not_called()
        with patch.dict(os.environ, {"EDITORIAL_WORKER_ENABLED": "1"}, clear=True), patch("orchestration.editorial.PostgresStore") as pg:
            self.assertEqual(main(["--once"]), 0)
            pg.assert_not_called()


if __name__ == "__main__":
    unittest.main()
