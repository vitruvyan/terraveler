"""Evidence-bound candidate handlers. Only the editor can publish their output.

Ports are injectable for offline verification. Production entry points are module
functions so the worker's spawned process can import them without closures.
"""
from __future__ import annotations

import copy
from datetime import date
import math
import os
import re
from typing import Callable

from orchestration.editorial_gateway import GatewayConfig, generate_candidate


class EvidenceError(ValueError):
    """A bounded structural or provenance failure, without raw source content.

    `feedback` says, in a sentence, what the candidate got wrong. It is built
    only from the candidate's own validated fields (identifiers, dates) and goes
    back to the same agent for correction; the persisted failure stays the code.
    """

    def __init__(self, code, feedback=None):
        super().__init__(code)
        self.feedback = feedback


# Mechanical defects in a candidate that its author can correct when told
# exactly what is wrong. Retrieval, provenance and context failures are not here:
# they are not the model's to fix.
REPAIRABLE = frozenset({
    "editorial-unknown-source", "editorial-quote-mismatch", "editorial-invalid-text",
    "editorial-invalid-finding", "editorial-findings-required", "editorial-invalid-quotes",
    "editorial-invalid-uncertainties", "editorial-waypoints-required", "editorial-invalid-waypoints",
    "editorial-invalid-waypoint", "editorial-invalid-waypoint-identity", "editorial-invalid-waypoint-date",
    "editorial-invalid-waypoint-coordinate", "editorial-invalid-waypoint-confidence",
    "editorial-waypoint-uncertainty-required", "editorial-waypoint-departure-before-arrival",
    "editorial-unexpected-waypoints", "editorial-draft-required", "editorial-citations-required",
    "editorial-claim-not-in-draft", "editorial-uncited-paragraph",
})
MAX_REPAIR_TURNS = 2


def _text(value, limit=50000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise EvidenceError("editorial-invalid-text")
    return value


def _sources(values):
    # A writer's research joins every item's cited references
    # (editorial_writer_context_bounds.sql allows 160).
    if not isinstance(values, list) or not values or len(values) > 160:
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


WAYPOINT_FIELDS = {"id", "sequence", "place_historical", "place_modern", "latitude", "longitude",
                   "arrival_date", "departure_date", "date_note", "event", "coordinate_note",
                   "source_ids", "confidence", "uncertainty"}


def _partial_date(value, where="date"):
    if value is None:
        return
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}(?:-[0-9]{2}(?:-[0-9]{2})?)?", value):
        raise EvidenceError("editorial-invalid-waypoint-date",
                            f"{where} must be YYYY, YYYY-MM or YYYY-MM-DD (years below 1000 zero-padded, e.g. 0629)")
    parts = [int(part) for part in value.split("-")]
    try:
        if len(parts) > 1 and not 1 <= parts[1] <= 12:
            raise ValueError()
        if len(parts) == 3:
            date(*parts)
    except ValueError:
        raise EvidenceError("editorial-invalid-waypoint-date", f"{where} {value} is not a real calendar date") from None


def _waypoints(values, known):
    if not isinstance(values, list) or not 1 <= len(values) <= 40:
        raise EvidenceError("editorial-waypoints-required")
    identities, sequences = set(), set()
    for waypoint in values:
        if not isinstance(waypoint, dict) or set(waypoint) != WAYPOINT_FIELDS:
            raise EvidenceError("editorial-invalid-waypoint")
        identity = waypoint["id"]
        sequence = waypoint["sequence"]
        if (not isinstance(identity, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", identity)
                or identity in identities or type(sequence) is not int or not 1 <= sequence <= 200
                or sequence in sequences):
            raise EvidenceError("editorial-invalid-waypoint-identity")
        identities.add(identity)
        sequences.add(sequence)
        here = f"waypoint {identity}"
        _text(waypoint["place_historical"], 500)
        if waypoint["place_modern"] is not None:
            _text(waypoint["place_modern"], 500)
        for field, minimum, maximum in (("latitude", -90, 90), ("longitude", -180, 180)):
            coordinate = waypoint[field]
            if type(coordinate) not in (int, float) or not math.isfinite(coordinate) or not minimum <= coordinate <= maximum:
                raise EvidenceError("editorial-invalid-waypoint-coordinate",
                                    f"{here}: {field} must be a number between {minimum} and {maximum} "
                                    "(latitude is north-south, longitude east-west)")
        _partial_date(waypoint["arrival_date"], f"{here}: arrival_date")
        _partial_date(waypoint["departure_date"], f"{here}: departure_date")
        if waypoint["arrival_date"] and waypoint["departure_date"]:
            arrival = waypoint["arrival_date"].split("-")
            departure = waypoint["departure_date"].split("-")
            precision = min(len(arrival), len(departure))
            # Compare at the shared precision: "1528" and "1528-05" are compatible.
            if departure[:precision] < arrival[:precision]:
                raise EvidenceError("editorial-waypoint-departure-before-arrival",
                                    f"{here}: departure_date {waypoint['departure_date']} is earlier than arrival_date "
                                    f"{waypoint['arrival_date']}. Correct the dates from the sources, or set departure_date "
                                    "to null and explain the uncertainty in date_note")
        for field, limit in (("date_note", 500), ("coordinate_note", 500), ("uncertainty", 500)):
            if waypoint[field] is not None:
                _quoted_spans(_text(waypoint[field], limit), known)
        _quoted_spans(_text(waypoint["event"], 5000), known)
        ids = waypoint["source_ids"]
        if (not isinstance(ids, list) or not ids
                or any(not isinstance(source, str) or source not in known for source in ids)
                or len(ids) != len(set(ids))):
            raise EvidenceError("editorial-unknown-source",
                                f"{here}: source_ids must be a non-empty list of distinct ids from input.retrieved_sources")
        confidence = waypoint["confidence"]
        if confidence not in ("certain", "approximate", "reconstructed"):
            raise EvidenceError("editorial-invalid-waypoint-confidence")
        if confidence != "certain" and not isinstance(waypoint["uncertainty"], str):
            raise EvidenceError("editorial-waypoint-uncertainty-required",
                                f"{here}: confidence is {confidence}, so uncertainty must explain why")
    return copy.deepcopy(values)


def _research(value):
    if not isinstance(value, dict) or value.get("kind") != "research":
        raise EvidenceError("editorial-research-required")
    references = _sources(value.get("references"))
    known = {s["id"]: s["text"] for s in references}
    findings = value.get("findings")
    if not isinstance(findings, list) or not findings or len(findings) > 200:
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
    if value.get("waypoints"):
        _waypoints(value["waypoints"], known)
    elif "waypoints" in value and not isinstance(value["waypoints"], list):
        raise EvidenceError("editorial-invalid-waypoints")
    return references


def _draft(value, research):
    if not isinstance(value, dict) or value.get("kind") != "draft":
        raise EvidenceError("editorial-draft-required")
    _text(value.get("title"), 500)
    body = _text(value.get("body"))
    known = {s["id"]: s["text"] for s in _research(research)}
    if value.get("waypoints") != research.get("waypoints") and ("waypoints" in value or "waypoints" in research):
        raise EvidenceError("editorial-waypoint-provenance")
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


_DEFAULT_FEEDBACK = {
    "editorial-unknown-source": "a source_id is not one of the ids provided in the input",
    "editorial-quote-mismatch": "a quotation is not a verbatim span of its cited source",
    "editorial-uncited-paragraph": "every paragraph must carry exactly one source_id",
    "editorial-claim-not-in-draft": "every cited claim must appear verbatim in the body",
}


def _with_repair(task, config, generator, build, **context):
    """Generate, validate, and on a mechanical defect tell the same agent exactly
    what was rejected and ask again: at most MAX_REPAIR_TURNS corrections per
    attempt. One wrong date used to discard a whole itinerary and spend an
    attempt without the agent ever learning what it got wrong."""
    repairs = []
    for turn in range(MAX_REPAIR_TURNS + 1):
        extra = dict(context)
        if repairs:
            extra["validation_feedback"] = {
                "instruction": ("Your previous output was rejected by a deterministic check. Correct exactly the "
                                "problem below, keep everything else that was valid, and return the complete output again."),
                "rejected": repairs[-1]["rejected"], "problem": repairs[-1]["problem"], "correction_round": len(repairs)}
        candidate, raw = _generate(task, config, generator, **extra)
        try:
            result = build(candidate, raw)
        except EvidenceError as error:
            code = str(error)
            if code not in REPAIRABLE or turn == MAX_REPAIR_TURNS:
                raise
            repairs.append({"rejected": code,
                            "problem": (error.feedback or _DEFAULT_FEEDBACK.get(code) or code)[:500]})
            continue
        if repairs and isinstance(result.get("candidate"), dict):
            result["candidate"]["validation_repairs"] = repairs
        return result
    raise AssertionError("unreachable")


def research(task, config, *, retrieve: Callable, generator=generate_candidate):
    references = _sources(retrieve(task))
    return _with_repair(task, config, generator, lambda candidate, raw: _research_result(task, candidate, raw, references),
                        retrieved_sources=references)


def _research_result(task, candidate, raw, references):
    result = {**candidate, "kind": "research", "references": references}
    _research(result)
    work_item = task.get("input", {}).get("work_item", {})
    itinerary = isinstance(work_item, dict) and work_item.get("specialty") == "itinerary"
    if itinerary:
        result["waypoints"] = _waypoints(candidate.get("waypoints"), {s["id"]: s["text"] for s in references})
    elif "waypoints" in result:
        raise EvidenceError("editorial-unexpected-waypoints")
    # Carry forward only what the findings and waypoints cite. Each item reads a
    # different, ranked slice of the corpus; the writer receives every item's
    # references joined, and the uncited remainder of three or four reads would
    # overrun its bounded context. The full read stays in the corpus receipt.
    cited = {sid for finding in result["findings"] for sid in finding["source_ids"]}
    cited |= {sid for waypoint in result.get("waypoints", []) for sid in waypoint["source_ids"]}
    result["references"] = [source for source in references if source["id"] in cited]
    _research(result)
    return {**result, "candidate": raw, "verification": "candidate-only"}


def writer(task, config, *, generator=generate_candidate):
    research_result = _context(task, "research")
    references = _research(research_result)
    return _with_repair(task, config, generator,
                        lambda candidate, raw: _draft_result(candidate, raw, research_result, references),
                        research_result=research_result)


def _draft_result(candidate, raw, research_result, references):
    paragraphs = candidate.get("paragraphs")
    if not isinstance(paragraphs, list) or not 1 <= len(paragraphs) <= 200:
        raise EvidenceError("editorial-draft-required")
    texts = []
    for paragraph in paragraphs:
        if not isinstance(paragraph, dict) or set(paragraph) != {"text", "source_id"}:
            raise EvidenceError("editorial-draft-required")
        texts.append(_text(paragraph["text"]))
    result = {"kind": "draft", "title": candidate.get("title"), "body": "\n\n".join(texts),
              "citations": [{"source_id": paragraph["source_id"], "claim": text}
                            for paragraph, text in zip(paragraphs, texts)],
              "references": references}
    if "waypoints" in research_result:
        result["waypoints"] = copy.deepcopy(research_result["waypoints"])
    _draft(result, research_result)
    return {**result, "candidate": raw, "verification": "candidate-only"}


def reviewer(task, config, *, generator=generate_candidate):
    if isinstance(task.get("input", {}).get("image_selection"), dict):
        # Caption review: SQL supplies the verified image selection instead of research.
        from orchestration.editorial_iconography import _selection, validate_captions
        draft_result = _context(task, "draft")
        validate_captions(draft_result, _selection(task))
        candidate, raw = _generate(task, config, generator)
    else:
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
    work_item = task.get("input", {}).get("work_item")
    if isinstance(work_item, dict) and work_item.get("specialty") == "iconography":
        # Images come from governed Commons consultations, not the textual corpus.
        if task.get("input", {}).get("graph_run_id") is None:
            raise EvidenceError("editorial-iconography-requires-plan")
        from orchestration.editorial_iconography import iconography
        return iconography(task, GatewayConfig.from_environment())
    if task.get("input", {}).get("graph_run_id") is not None and os.environ.get("EDITORIAL_MCP_CORPUS_ENABLED") != "1":
        raise EvidenceError("editorial-mcp-corpus-required")
    if os.environ.get("EDITORIAL_MCP_CORPUS_ENABLED") == "1":
        from orchestration.editorial_mcp_corpus import retrieve_mcp_sources
        return research(task, GatewayConfig.from_environment(), retrieve=retrieve_mcp_sources)
    from orchestration.editorial_sources import retrieve_sources
    return research(task, GatewayConfig.from_environment(), retrieve=retrieve_sources)


def production_writer(task):
    work_item = task.get("input", {}).get("work_item")
    if isinstance(work_item, dict) and work_item.get("specialty") == "caption":
        from orchestration.editorial_iconography import captions
        return captions(task, GatewayConfig.from_environment())
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
