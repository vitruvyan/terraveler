"""Durable editorial worker foundation; no live research or publishing handlers.

PostgreSQL owns leases, accepted results and recovery. Redis may wake a future
worker but is never the source of truth. Handlers are trusted, read-only tool
adapters: their only accepted write is the fenced result committed by this
parent process. Process isolation enforces a deadline, not a security sandbox.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import multiprocessing
import math
import os
import time
from typing import Any, Callable, Protocol
from uuid import uuid4

ROLES = frozenset({"research", "writer", "reviewer"})
RESULT_BYTES = 1024 * 1024
TRACE_BYTES = 8 * 1024 * 1024
Handler = Callable[[dict[str, Any]], dict[str, Any]]
# Intentionally empty. Provider/model selection and evidence-bound production
# handlers are a separate change; never drain a queue with a placeholder.
PRODUCTION_HANDLERS: dict[str, Handler] = {}


class Store(Protocol):
    def claim(self, worker: str, roles: list[str], lease_seconds: int) -> dict | None: ...
    def renew(self, task: dict, lease_seconds: int) -> bool: ...
    def complete(self, task: dict, result: dict, trace: dict) -> dict: ...
    def fail(self, task: dict, error: str) -> bool: ...
    def recover(self) -> int: ...


class PostgresStore:
    """One short transaction per RPC; never hold a DB connection during inference."""
    def __init__(self, pg: dict[str, Any]):
        self.pg = dict(pg)

    def _call(self, function: str, *args):
        import psycopg2
        from psycopg2.extras import Json
        # Function names are constants in the methods below, never user input.
        conn = psycopg2.connect(**{**self.pg, "connect_timeout": 5,
                                 "options": "-c statement_timeout=5000 -c lock_timeout=3000"})
        try:
            with conn, conn.cursor() as cur:
                cur.execute(f"select public.{function}({','.join(['%s'] * len(args))})",
                            tuple(Json(a) if isinstance(a, dict) else a for a in args))
                return cur.fetchone()[0]
        finally:
            conn.close()

    def claim(self, worker, roles, lease_seconds):
        return self._call("editorial_claim", worker, roles, lease_seconds)

    def renew(self, task, lease_seconds):
        return self._call("editorial_renew", task["id"], task["lease_token"], lease_seconds)

    def complete(self, task, result, trace):
        # Exact retry is safe if COMMIT succeeded but the response was lost.
        # Never rerun the handler or manufacture another trace on this path.
        import psycopg2
        try:
            return self._call("editorial_complete", task["id"], task["lease_token"], result, trace)
        except psycopg2.OperationalError:
            return self._call("editorial_complete", task["id"], task["lease_token"], result, trace)

    def fail(self, task, error):
        return self._call("editorial_fail", task["id"], task["lease_token"], error)

    def recover(self):
        return self._call("editorial_recover")


def run_handler_graph(handler: Handler, task: dict) -> tuple[dict, dict]:
    """The real native Motus graph. Recorded effects do not claim pure replay."""
    from vitruvyan_motus import EffectDescriptor, Fact, GraphSpec, Runtime, State
    from vitruvyan_motus.effects import EffectClass

    spec = GraphSpec.from_dict({
        "schema_version": "1.0.0", "name": "terraveler-editorial-task", "version": "1.0.0",
        "entry": "execute", "nodes": [{"name": "execute", "effect_class": "recorded_effect",
        "reads_declared": ["task"], "writes_declared": ["result"]}],
        "transitions": {"execute": {"kind": "terminal"}},
    })

    def execute(state, ctx):
        result = handler(state.fact("task"))
        if not isinstance(result, dict):
            raise ValueError("handler must return a JSON object")
        encoded = json.dumps(result, allow_nan=False)
        if len(encoded.encode()) > RESULT_BYTES:
            raise ValueError("handler result exceeds limit")
        ctx.record_effect(EffectDescriptor(effect_class=EffectClass.RECORDED_EFFECT,
                          description="Executed registered editorial handler; output awaits fenced persistence"))
        return state.with_fact(Fact("result", result, "execute", ctx.now()))

    run_id = f"editorial-{task['id']}-{uuid4()}"
    completed = Runtime(spec, {"execute": execute}).run(
        State.new(f"editorial:{task['id']}", facts=[Fact("task", task, "worker",
                  datetime.now(timezone.utc))]), run_id=run_id)
    trace = {"run_id": run_id, "root": completed.trace.root,
             "status": completed.status, "evidence": completed.evidence,
             "trace_jsonl": completed.trace.to_jsonl()}
    if len(json.dumps(trace).encode()) > TRACE_BYTES:
        raise ValueError("handler trace exceeds limit")
    return completed.state.fact("result"), trace


def _child(sender, handler, task):
    try:
        result, trace = run_handler_graph(handler, task)
        sender.send({"result": result, "trace": trace})
    except Exception:
        # Do not persist exception text (a provider/DB exception can contain a
        # key or URL). Failed attempts remain in PostgreSQL; detailed partial
        # Motus traces are not yet persisted for failed/terminated handlers.
        sender.send({"error": "editorial-handler-failed"})
    finally:
        sender.close()


@dataclass(frozen=True)
class WorkerConfig:
    enabled: bool = False
    worker_id: str = "editorial-worker"
    lease_seconds: int = 120
    heartbeat_seconds: float = 20
    timeout_seconds: float = 300

    def __post_init__(self):
        if not self.worker_id or len(self.worker_id) > 120:
            raise ValueError("invalid worker identity")
        if not 15 <= self.lease_seconds <= 600:
            raise ValueError("invalid lease duration")
        if not math.isfinite(self.heartbeat_seconds) or not 0 < self.heartbeat_seconds < self.lease_seconds / 3:
            raise ValueError("heartbeat must be less than one third of lease")
        if not math.isfinite(self.timeout_seconds) or self.timeout_seconds <= 0:
            raise ValueError("invalid task deadline")


class EditorialWorker:
    def __init__(self, store: Store, handlers: dict[str, Handler], cfg: WorkerConfig):
        if not set(handlers).issubset(ROLES) or not all(callable(h) for h in handlers.values()):
            raise ValueError("unsupported handler registry")
        self.store, self.handlers, self.cfg = store, dict(handlers), cfg

    def run_once(self) -> dict:
        if not self.cfg.enabled:
            return {"status": "disabled"}
        if not self.handlers:
            return {"status": "no-handlers"}
        task = self.store.claim(self.cfg.worker_id, sorted(self.handlers), self.cfg.lease_seconds)
        if task is None:
            return {"status": "idle"}
        # Only the explicit context reaches an agent/model, never its lease token.
        context = {k: task[k] for k in ("id", "topic_id", "role", "input", "topic", "sources",
                   "dependency_result") if k in task}
        if task.get("role") not in self.handlers:
            return {"status": "unsupported-task", "task_id": task["id"]}
        mp = multiprocessing.get_context("spawn")
        receiver, sender = mp.Pipe(duplex=False)
        process = mp.Process(target=_child, args=(sender, self.handlers[task["role"]], context))
        started = time.monotonic()
        heartbeat = started + self.cfg.heartbeat_seconds
        try:
            try:
                process.start()
            except Exception:
                recorded = self.store.fail(task, "editorial-handler-start-failed")
                return {"status": "failed" if recorded else "lease-lost", "task_id": task["id"]}
            sender.close()
            while True:
                now = time.monotonic()
                if now - started >= self.cfg.timeout_seconds:
                    recorded = self.store.fail(task, "editorial-handler-timeout")
                    return {"status": "failed" if recorded else "lease-lost", "task_id": task["id"]}
                if now >= heartbeat:
                    try:
                        renewed = self.store.renew(task, self.cfg.lease_seconds)
                    except Exception:
                        renewed = False
                    if not renewed:
                        # No writes with uncertain authority. DB recovery owns
                        # this attempt; terminate computation and discard output.
                        return {"status": "lease-lost", "task_id": task["id"]}
                    heartbeat = time.monotonic() + self.cfg.heartbeat_seconds
                if receiver.poll(min(0.1, self.cfg.heartbeat_seconds)):
                    try:
                        message = receiver.recv()
                    except EOFError:
                        message = {"error": "editorial-handler-exited"}
                    if "error" in message:
                        recorded = self.store.fail(task, message["error"])
                        return {"status": "failed" if recorded else "lease-lost", "task_id": task["id"]}
                    # A fresh DB check fences completion even if the handler
                    # finished just before expiry. Complete itself also checks.
                    if not self.store.renew(task, self.cfg.lease_seconds):
                        return {"status": "lease-lost", "task_id": task["id"]}
                    accepted = self.store.complete(task, message["result"], message["trace"])
                    return {"status": "completed", "task_id": task["id"], **accepted}
                if not process.is_alive():
                    recorded = self.store.fail(task, "editorial-handler-exited")
                    return {"status": "failed" if recorded else "lease-lost", "task_id": task["id"]}
        finally:
            sender.close()
            receiver.close()
            if process.pid is not None:
                if process.is_alive():
                    process.terminate()
                process.join(timeout=2)
                if process.is_alive():
                    process.kill()
                    process.join(timeout=2)
                process.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="attempt one registered task")
    parser.add_argument("--recover", action="store_true", help="recover expired leases only")
    args = parser.parse_args(argv)
    if os.environ.get("EDITORIAL_WORKER_ENABLED") != "1":
        print(json.dumps({"status": "disabled"}))
        return 0
    if not args.once and not args.recover:
        parser.error("choose --once or --recover; there is no implicit daemon")
    if not args.recover and not PRODUCTION_HANDLERS:
        print(json.dumps({"status": "no-handlers"}))
        return 0
    # libpq PG* environment variables; no fallback credentials or .env parsing.
    store = PostgresStore({})
    if args.recover:
        print(json.dumps({"status": "recovered", "count": store.recover()}))
    else:
        cfg = WorkerConfig(enabled=True, worker_id=os.environ.get("EDITORIAL_WORKER_ID", "editorial-worker"))
        print(json.dumps(EditorialWorker(store, PRODUCTION_HANDLERS, cfg).run_once()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
