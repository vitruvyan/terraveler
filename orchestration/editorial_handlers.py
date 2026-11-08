"""Evidence-bound candidate handlers. Only the editor can publish their output.

Ports are injectable for offline verification. Production entry points are module
functions so the worker's spawned process can import them without closures.
"""
from __future__ import annotations

import copy
import os
import re
from typing import Callable

from orchestration.editorial_gateway import GatewayConfig, generate_candidate


class EvidenceError(ValueError):
    """A bounded structural or provenance failure, without raw source content."""


def _text(value, limit=50000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise EvidenceError("editorial-invalid-text")
    return value


def _sources(values):
    if not isinstance(values, list) or not values or len(values) > 40:
        raise EvidenceError("editorial-sources-required")
    result = []
    for value in values:
        if not isinstance(value, dict):
            raise EvidenceError("editorial-invalid-source")
        source = {key: _text(value.get(key), 12000 if key == "text" else 2000)
                  for key in ("id", "text", "title", "url", "rights")}
        if "governance" in value:
            policy = value["governance"]
            if (not isinstance(policy, dict)
                    or type(policy.get("endpoint_id")) is not int or policy["endpoint_id"] < 1
                    or type(policy.get("policy_decision_id")) is not int or policy["policy_decision_id"] < 1
                    or policy.get("rights_class") not in ("public_domain", "creative_commons")
                    or policy.get("trust_mode") != "domain_trusted"):
                raise EvidenceError("editorial-invalid-source-policy")
            source["governance"] = copy.deepcopy(policy)
        result.append(source)
    if len({s["id"] for s in result}) != len(result):
        raise EvidenceError("editorial-duplicate-source")
    return result


def _quoted_spans(text, known):
    # Canonical output uses double/curly quotation delimiters. Apostrophes in
    # names and ordinary prose are not quotation boundaries.
    for quoted in re.findall(r'"([^"\n]+)"|“([^”\n]+)”|«([^»\n]+)»', text):
        span = next(part for part in quoted if part)
        if not any(span in source for source in known.values()):
            raise EvidenceError("editorial-quote-mismatch")


def _research(value):
    if not isinstance(value, dict) or value.get("kind") != "research":
        raise EvidenceError("editorial-research-required")
    references = _sources(value.get("references"))
    known = {s["id"]: s["text"] for s in references}
    findings = value.get("findings")
    if not isinstance(findings, list) or not findings or len(findings) > 100:
        raise EvidenceError("editorial-findings-required")
    for finding in findings:
        if not isinstance(finding, dict):
            raise EvidenceError("editorial-invalid-finding")
        _quoted_spans(_text(finding.get("text")), known)
        ids = finding.get("source_ids")
        if not isinstance(ids, list) or not ids or any(not isinstance(i, str) or i not in known for i in ids):
            raise EvidenceError("editorial-unknown-source")
        quotes = finding.get("quotes", [])
        if not isinstance(quotes, list):
            raise EvidenceError("editorial-invalid-quotes")
        for quote in quotes:
            if (not isinstance(quote, dict) or quote.get("source_id") not in ids
                    or _text(quote.get("text")) not in known[quote["source_id"]]):
                raise EvidenceError("editorial-quote-mismatch")
    uncertainty = value.get("uncertainties")
    if not isinstance(uncertainty, list) or any(not isinstance(i, str) or not i.strip() for i in uncertainty):
        raise EvidenceError("editorial-invalid-uncertainties")
    return references


def _draft(value, research):
    if not isinstance(value, dict) or value.get("kind") != "draft":
        raise EvidenceError("editorial-draft-required")
    _text(value.get("title"), 500)
    body = _text(value.get("body"))
    known = {s["id"]: s["text"] for s in _research(research)}
    citations = value.get("citations")
    if not isinstance(citations, list) or not citations or len(citations) > 200:
        raise EvidenceError("editorial-citations-required")
    claims = []
    _quoted_spans(body, known)
    for citation in citations:
        if not isinstance(citation, dict) or citation.get("source_id") not in known:
            raise EvidenceError("editorial-unknown-source")
        claim = _text(citation.get("claim"))
        claims.append(claim)
        if claim not in body:
            raise EvidenceError("editorial-claim-not-in-draft")
        if "quote" in citation:
            quote = _text(citation["quote"])
            if quote not in known[citation["source_id"]] or quote not in claim:
                raise EvidenceError("editorial-quote-mismatch")
    # Require a source map for the entire body, not an isolated token-level
    # citation in otherwise unsupported prose. This does not prove truth;
    # the reviewer and final human publication gate still apply.
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    if any(paragraph not in claims for paragraph in paragraphs):
        raise EvidenceError("editorial-uncited-paragraph")
    return citations


def _context(task, kind):
    value = task.get("input", {}).get(kind + "_result")
    if value is None and kind == "research" and task.get("role") == "writer":
        value = task.get("dependency_result")
    if value is None and kind == "draft" and task.get("role") == "reviewer":
        value = task.get("dependency_result")
    if not isinstance(value, dict):
        raise EvidenceError("editorial-context-required")
    return value


def _generate(task, config, generator, **context):
    copied = copy.deepcopy(task)
    copied.setdefault("input", {}).update(context)
    generated = generator(copied, config)
    if not isinstance(generated, dict) or not isinstance(generated.get("candidate"), dict):
        raise EvidenceError("editorial-candidate-required")
    return generated["candidate"], generated


def research(task, config, *, retrieve: Callable, generator=generate_candidate):
    references = _sources(retrieve(task))
    candidate, raw = _generate(task, config, generator, retrieved_sources=references)
    result = {**candidate, "kind": "research", "references": references}
    _research(result)
    return {**result, "candidate": raw, "verification": "candidate-only"}


def writer(task, config, *, generator=generate_candidate):
    research_result = _context(task, "research")
    references = _research(research_result)
    candidate, raw = _generate(task, config, generator, research_result=research_result)
    result = {**candidate, "kind": "draft", "references": references}
    _draft(result, research_result)
    return {**result, "candidate": raw, "verification": "candidate-only"}


def reviewer(task, config, *, generator=generate_candidate):
    research_result = _context(task, "research")
    draft_result = _context(task, "draft")
    _draft(draft_result, research_result)
    candidate, raw = _generate(task, config, generator,
                               research_result=research_result, draft_result=draft_result)
    verdict, issues = candidate.get("verdict"), candidate.get("issues")
    if (verdict not in {"ready-for-editor", "changes-requested", "blocked"}
            or not isinstance(issues, list) or any(not isinstance(i, str) or not i.strip() for i in issues)
            or (verdict != "ready-for-editor" and not issues)
            or (verdict == "ready-for-editor" and issues)):
        raise EvidenceError("editorial-invalid-review")
    # Grounding is structural, not a fact-check guarantee. Readiness is only
    # permission to present a candidate to the editor, never to publish it.
    return {"kind": "review", "verdict": verdict, "issues": issues,
            "candidate": raw, "verification": "candidate-only"}


def production_research(task):
    from orchestration.editorial_sources import retrieve_sources
    return research(task, GatewayConfig.from_environment(), retrieve=retrieve_sources)


def production_writer(task):
    return writer(task, GatewayConfig.from_environment())


def production_reviewer(task):
    return reviewer(task, GatewayConfig.from_environment())


def production_handlers(env=None):
    values = os.environ if env is None else env
    if values.get("EDITORIAL_HANDLERS_ENABLED") != "1":
        return {}
    roles = values.get("EDITORIAL_HANDLER_ROLES", "research,writer,reviewer").split(",")
    registry = {"research": production_research, "writer": production_writer, "reviewer": production_reviewer}
    if not roles or any(role not in registry for role in roles):
        raise ValueError("unsupported editorial production role")
    return {role: registry[role] for role in roles}
