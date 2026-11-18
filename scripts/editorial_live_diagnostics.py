#!/usr/bin/env python3
"""Read-only metadata collector for a TerraVeler operator on the VPS.

No inference, source fetch, key introspection, configuration mutation or raw log
export. Uses Docker CLI without a shell. Database transactions are READ ONLY.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys

PINNED_LIMEN = "2742e6e4bf21a5b60982df110195e99a9666ff71"
LIMIT = 50
TABLES = ("editorial_topics", "editorial_agents_current", "editorial_plans",
          "editorial_plan_preparations", "editorial_mcp_consultations", "editorial_tasks",
          "editorial_graph_policy", "editorial_topic_submissions", "rag_docs",
          "editorial_topic_sources")


def label(value, limit=200):
    """Only identifier-shaped metadata, never arbitrary text or credentials."""
    if (not isinstance(value, str) or not 1 <= len(value) <= limit
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:/-]*", value)
            or value.lower().startswith(("sk-", "bearer", "eyj"))):
        return None
    return value


def timestamp(value):
    if isinstance(value, str) and re.fullmatch(r"[0-9TtZz+:. -]{1,64}", value):
        return value
    if type(value) is int and value >= 0:
        return value
    return None


def safe_count(value):
    return value if type(value) is int and 0 <= value < 10**15 else None


def database_metadata(value):
    """Second allowlist after SQL projection; bad stored labels are not logs."""
    if isinstance(value, list):
        return [database_metadata(row) for row in value[:100]]
    if not isinstance(value, dict):
        return None
    result = {}
    for key, item in value.items():
        if key in {"id", "version", "work_items", "attempt", "count", "plan_id", "planner_version_id", "reviewer_version_id"}:
            result[key] = safe_count(item)
        elif key in {"created_at", "latest_at"}:
            result[key] = timestamp(item)
        elif key in {"enabled", "mandatory"}:
            result[key] = item if type(item) is bool else None
        elif key in {"topic_key", "agent_key", "role", "model", "state", "verdict", "tool", "target_voyage"}:
            result[key] = label(item)
    return result


def run_command(args, *, data=None, timeout=25):
    """Do not emit stdout/stderr for failed commands; those may contain secrets."""
    try:
        result = subprocess.run(args, input=data, text=True, capture_output=True,
                                timeout=timeout, check=False)
        if result.returncode != 0 or len(result.stdout.encode()) > 2 * 1024 * 1024:
            return None
        return result.stdout
    except (OSError, subprocess.TimeoutExpired):
        return None


def database_report(topic_id, container, user, database):
    def query(sql):
        result = run_command(["docker", "exec", "-i", container, "psql", "-X", "-q", "-A", "-t",
                              "-v", "ON_ERROR_STOP=1", "-U", user, "-d", database, "-c",
                              "begin read only; set local statement_timeout='5s'; " + sql + "; commit;"])
        if result is None:
            return {"state": "unavailable"}
        try:
            return {"state": "read", "data": json.loads(result.strip())}
        except ValueError:
            return {"state": "invalid-response"}
    inventory = query("select coalesce(json_object_agg(table_name, true),'{}'::json) from information_schema.tables "
                      "where table_schema='public' and table_name in (" + ",".join("'" + t + "'" for t in TABLES) + ")")
    if inventory["state"] != "read":
        return {"state": "unavailable", "phases": {}}
    present = inventory["data"]
    if not isinstance(present, dict):
        return {"state": "invalid-response", "phases": {}}
    specs = {
        "topic": ("editorial_topics", f"select coalesce(json_agg(x),'[]'::json) from (select id,topic_key,created_at from public.editorial_topics where id={topic_id}) x"),
        "agents": ("editorial_agents_current", "select coalesce(json_agg(x),'[]'::json) from (select id,agent_key,version,role,model,enabled from public.editorial_agents_current order by agent_key limit 100) x"),
        "plans": ("editorial_plans", f"select coalesce(json_agg(x),'[]'::json) from (select id,version,created_at,jsonb_array_length(plan->'work_items') as work_items from public.editorial_plans where topic_id={topic_id} order by version desc limit 20) x"),
        "reviews": ("editorial_plan_preparations", f"select coalesce(json_agg(x),'[]'::json) from (select plan_id,planner_version_id,reviewer_version_id,review->>'verdict' as verdict,created_at from public.editorial_plan_preparations where topic_id={topic_id} order by created_at desc limit 20) x"),
        "tasks": ("editorial_tasks", f"select coalesce(json_agg(x),'[]'::json) from (select id,role,state,attempt,created_at from public.editorial_tasks where topic_id={topic_id} order by id desc limit 50) x"),
        "gate": ("editorial_graph_policy", "select coalesce(json_agg(x),'[]'::json) from (select mandatory from public.editorial_graph_policy) x"),
        "consultations": ("editorial_mcp_consultations", "select coalesce(json_agg(x),'[]'::json) from (select tool,count(*)::bigint as count,max(created_at) as latest_at from public.editorial_mcp_consultations group by tool) x"),
    }
    phases = {key: query(sql) if table in present else {"state": "migration-absent"}
              for key, (table, sql) in specs.items()}
    if "editorial_topic_submissions" in present:
        phases["voyage_scopes"] = query(f"select coalesce(json_agg(x),'[]'::json) from (select distinct snapshot->>'target_voyage' as target_voyage from public.editorial_topic_submissions where topic_id={topic_id} and snapshot->>'target_voyage' ~ '^[a-z0-9][a-z0-9-]{{0,119}}$') x")
    if "editorial_topic_sources" in present:
        phases["dossier_sources"] = query(f"select json_build_object('count',count(*)) from public.editorial_topic_sources where topic_id={topic_id}")
    # Queries use an explicit metadata projection; there are no payload, plan,
    # result, trace, instructions, source text, credential or lease fields.
    for phase in phases.values():
        if phase.get("state") == "read":
            phase["data"] = database_metadata(phase["data"])
    return {"state": "read", "phases": phases}


def read_trace(path):
    """Pinned Limen JSONL shape: header.run plus records[].writes.facts."""
    header, facts = None, {}
    try:
        if path.is_symlink() or path.stat().st_size > 1024 * 1024:
            return None
        with path.open(encoding="utf8") as stream:
            for number, line in enumerate(stream):
                if number >= 2000:
                    return None
                value = json.loads(line)
                if not isinstance(value, dict):
                    continue
                if header is None and isinstance(value.get("run"), dict):
                    header = value["run"]
                writes = value.get("writes", {})
                if isinstance(writes, dict):
                    for fact in writes.get("facts") or []:
                        if isinstance(fact, dict) and fact.get("key") in {"model", "provider", "locality", "data_class", "mode"}:
                            facts[fact["key"]] = fact.get("value")
    except (OSError, ValueError, TypeError):
        return None
    return (header, facts) if header else None


def project_trace(decision, effect=None):
    header, facts = decision
    metadata = header.get("metadata") if isinstance(header.get("metadata"), dict) else {}
    result = {"request_id": label(header.get("run_id")), "created_ts": timestamp(header.get("created_ts")),
              "decision_model": label(facts.get("model")), "decision_provider": label(facts.get("provider")),
              "decision_locality": label(facts.get("locality")), "data_class": label(facts.get("data_class")),
              "effect": None}
    if effect:
        m = effect[0].get("metadata") or {}
        if isinstance(m, dict):
            result["effect"] = {"request_id": label(m.get("idempotency_key")),
                                "status": m.get("status") if m.get("status") in {"success", "failure"} else None,
                                "provider": label(m.get("provider")),
                                "response_reported_model": label(m.get("model")),
                                "response_id": label(m.get("response_id")),
                                "prompt_tokens": safe_count(m.get("usage_prompt_tokens")),
                                "completion_tokens": safe_count(m.get("usage_completion_tokens")),
                                "duration_ms": safe_count(m.get("duration_ms"))}
    # In the pinned gateway effect.model may be the alias even after routing.
    # Do not relabel it served_model or expose metadata.error/principal/groups.
    return result


def trace_files(directory, limit):
    try:
        return sorted((p for p in directory.iterdir() if p.is_file() and not p.is_symlink()
                       and p.name.endswith(".jsonl") and not p.name.endswith(".partial.jsonl")),
                      key=lambda p: p.stat().st_mtime, reverse=True)[:limit]
    except OSError:
        return []


def limen_report(tenant="terraveler", limit=20):
    root = Path(os.environ.get("LIMEN_EVIDENCE_DIR", "/data/evidence"))
    # Explicit tenant only. Do not scan other tenants or an arbitrary file tree.
    tenant_root = root / tenant
    default_tenant = os.environ.get("LIMEN_DEFAULT_TENANT")
    roots = [tenant_root] + ([root] if tenant == default_tenant else [])
    decisions, effects = [], {}
    for base in roots:
        for file in trace_files(base / "effects", limit * 3):
            trace = read_trace(file)
            if trace:
                metadata = trace[0].get("metadata")
                key = metadata.get("idempotency_key") if isinstance(metadata, dict) else None
                if label(key): effects[key] = trace
        for file in trace_files(base / "decisions", limit):
            trace = read_trace(file)
            if trace: decisions.append(trace)
    decisions.sort(key=lambda d: str(d[0].get("created_ts") or ""), reverse=True)
    events = [project_trace(d, effects.get(label(d[0].get("run_id")))) for d in decisions[:limit]]
    config = Path(os.environ.get("LIMEN_LITELLM_CONFIG", "/app/limen/docker/litellm_config.yaml"))
    aliases = []
    try:
        import yaml
        if not config.is_symlink() and config.stat().st_size < 1024 * 1024:
            value = yaml.safe_load(config.read_text()) or {}
            if not isinstance(value, dict):
                raise ValueError()
            for entry in (value.get("model_list") or [])[:100]:
                if isinstance(entry, dict):
                    params = entry.get("litellm_params") or {}
                    if isinstance(params, dict):
                        aliases.append({"alias": label(entry.get("model_name")), "configured_provider_model": label(params.get("model"))})
    except Exception:
        # YAML parser exceptions can include the original configuration line.
        # Malformed private configuration must never become an exported trace.
        pass
    availability = {kind: any((base / kind).is_dir() for base in roots) for kind in ("decisions", "effects")}
    return {"state": "read" if aliases or any(availability.values()) else "unavailable",
            "trace_directories_available": availability, "configured_routes": aliases, "events": events,
            "limitations": ["Decision facts describe Limen routing; response-reported model alone is not physical Ollama model proof.",
                            "Missing historical traces, provider logs or request correlation remain unknown, not successful inference.",
                            "No prompt, source body, model output, principal or credential is exported."]}


def collect(args):
    containers = run_command(["docker", "ps", "--filter", "label=com.docker.compose.service=terraveler_limen", "--format", "{{.Names}}"])
    names = containers.strip().splitlines() if containers else []
    limen = args.limen_container or (names[0] if len(names) == 1 else None)
    if limen:
        code = Path(__file__).read_text()
        raw = run_command(["docker", "exec", "-i", limen, "/app/.venv/bin/python", "-", "--internal-limen", "--tenant", args.tenant, "--limit", str(args.limit)], data=code)
        try: evidence = json.loads(raw) if raw else {"state": "unavailable"}
        except ValueError: evidence = {"state": "invalid-response"}
    else:
        evidence = {"state": "unavailable", "reason": "select-one-running-limen-container"}
    return {"collected_at": datetime.now(timezone.utc).isoformat(), "topic_id": args.topic_id,
            "mode": "read-only-metadata-no-inference", "limen_schema_reference": PINNED_LIMEN,
            "postgres": database_report(args.topic_id, args.db_container, args.db_user, args.database),
            "limen": evidence}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--topic-id", type=int, default=1)
    parser.add_argument("--db-container", default="terraveler_postgres")
    parser.add_argument("--db-user", default="terraveler")
    parser.add_argument("--database", default="terraveler")
    parser.add_argument("--limen-container")
    parser.add_argument("--tenant", default="terraveler")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--internal-limen", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if (not 0 < args.topic_id < 2**53 or not 1 <= args.limit <= LIMIT
            or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", args.tenant)
            or any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", v) for v in
                   (args.db_container, args.db_user, args.database, args.limen_container or "unused"))):
        parser.error("Invalid bounded selector")
    result = limen_report(args.tenant, args.limit) if args.internal_limen else collect(args)
    print(json.dumps(result, indent=2, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
