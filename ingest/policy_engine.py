from dataclasses import dataclass, field
from typing import Optional, List, Dict
import datetime
import hashlib
import json

@dataclass
class VerifierAssertion:
    """
    Formal, typed verifier assertion representing a verified fact or incompatibility.
    A plain caller boolean is never sufficient authority.
    """
    code: str
    verifier_id_version: str
    basis: str
    source_evidence: str
    timestamp: datetime.datetime
    artifact_hash: Optional[str] = None


@dataclass
class VerifiedEvidence:
    """
    VerifiedEvidence contract.
    Contains strictly observed/verified facts, independent of LLM/Archivist recommendation.
    """
    assessment_id: int
    verified_at: datetime.datetime
    verifier_version: str
    
    subject_type: str
    subject_id: int
    
    institution_identity_verified: bool
    endpoint_identity_verified: bool
    
    rights_statement_retrieved: bool
    rights_statement_hash_matches: bool
    
    rights_verified: bool
    rights_class: str
    rights_identifier: Optional[str]
    rights_uri: Optional[str]
    
    scope_verified: bool
    scope_type: str
    scope_identifier: Optional[str]
    
    access_verified: bool
    verification_strategy: str
    
    conflicts: List[str]
    evidence_sources: List[str]
    
    # Explicit deterministic policy facts for REJECT/incompatibility
    policy_incompatible: bool = False
    incompatibility_codes: List[str] = field(default_factory=list)


@dataclass
class PolicyEvaluation:
    """
    The deterministic output of evaluating policy rules against VerifiedEvidence.
    """
    decision_outcome: str
    trust_mode: Optional[str]
    rule_id: str
    reason_codes: List[str]
    blocking_conditions: List[str]
    policy_version: str
    verification_version: str
    evidence_snapshot: Dict

POLICY_VERSION = "SG-P1"
SUPPORTED_POLICY_VERSIONS = {POLICY_VERSION}

def canonicalize_evidence(evidence: VerifiedEvidence) -> str:
    """
    Produces a deterministic, stable, and platform-independent JSON string representation
    of VerifiedEvidence. Timestamps, dynamic fields, and model-dependent formatting are omitted
    to guarantee absolute reproducibility of the hash.
    """
    stable_dict = {
        "subject_type": str(evidence.subject_type),
        "subject_id": int(evidence.subject_id),
        "institution_identity_verified": bool(evidence.institution_identity_verified),
        "endpoint_identity_verified": bool(evidence.endpoint_identity_verified),
        "rights_statement_retrieved": bool(evidence.rights_statement_retrieved),
        "rights_statement_hash_matches": bool(evidence.rights_statement_hash_matches),
        "rights_verified": bool(evidence.rights_verified),
        "rights_class": str(evidence.rights_class),
        "rights_identifier": str(evidence.rights_identifier) if evidence.rights_identifier is not None else None,
        "rights_uri": str(evidence.rights_uri) if evidence.rights_uri is not None else None,
        "scope_verified": bool(evidence.scope_verified),
        "scope_type": str(evidence.scope_type),
        "scope_identifier": str(evidence.scope_identifier) if evidence.scope_identifier is not None else None,
        "access_verified": bool(evidence.access_verified),
        "verification_strategy": str(evidence.verification_strategy),
        "policy_incompatible": bool(evidence.policy_incompatible),
        "incompatibility_codes": sorted(list(evidence.incompatibility_codes)) if evidence.incompatibility_codes else [],
        "conflicts": sorted(list(evidence.conflicts)) if evidence.conflicts else [],
        "evidence_sources": sorted(list(evidence.evidence_sources)) if evidence.evidence_sources else []
    }
    return json.dumps(stable_dict, sort_keys=True, separators=(",", ":"))

def compute_evidence_hash(evidence: VerifiedEvidence) -> str:
    """Computes SHA256 of canonicalized verified evidence facts."""
    canonical = canonicalize_evidence(evidence)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

def canonicalize_policy_evaluation(evaluation: PolicyEvaluation, subject_type: str, subject_id: int, verified_evidence_id: int) -> str:
    """
    Produces a deterministic, stable, and platform-independent JSON string representation
    of PolicyEvaluation. Timestamps and dynamic fields are omitted to guarantee absolute reproducibility.
    """
    stable_dict = {
        "verified_evidence_id": int(verified_evidence_id),
        "subject_type": str(subject_type),
        "subject_id": int(subject_id),
        "decision_outcome": str(evaluation.decision_outcome),
        "trust_mode": str(evaluation.trust_mode) if evaluation.trust_mode is not None else None,
        "rule_id": str(evaluation.rule_id),
        "reason_codes": sorted(list(evaluation.reason_codes)) if evaluation.reason_codes else [],
        "blocking_conditions": sorted(list(evaluation.blocking_conditions)) if evaluation.blocking_conditions else [],
        "policy_version": str(evaluation.policy_version),
        "verification_version": str(evaluation.verification_version),
        "evidence_snapshot": evaluation.evidence_snapshot
    }
    if isinstance(stable_dict["evidence_snapshot"], dict):
        stable_dict["evidence_snapshot"] = json.loads(json.dumps(stable_dict["evidence_snapshot"], sort_keys=True))
        
    return json.dumps(stable_dict, sort_keys=True, separators=(",", ":"))

def compute_policy_evaluation_hash(evaluation: PolicyEvaluation, subject_type: str, subject_id: int, verified_evidence_id: int) -> str:
    """Computes SHA256 of canonicalized policy evaluation."""
    canonical = canonicalize_policy_evaluation(evaluation, subject_type, subject_id, verified_evidence_id)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

def produce_verified_evidence(assessment_dict: dict, assertions: List[VerifierAssertion] = None) -> VerifiedEvidence:
    """
    Deterministic verifier boundary converting an assessment and formal verifier assertions
    into VerifiedEvidence. Combines independent facts and enforces incompatibility rules.
    """
    rights_class = assessment_dict.get("rights_class", "unknown")
    rights_verified = assessment_dict.get("rights_verified", False) # Default to FALSE for fail-closed security
    scope_type = assessment_dict.get("rights_scope_type", "unresolved")
    
    conflicts = list(assessment_dict.get("conflicts", []))
    incompatibility_codes = []
    policy_incompatible = False
    
    # Process formal, typed verifier assertions
    if assertions:
        for ast in assertions:
            if not isinstance(ast, VerifierAssertion):
                continue
            if ast.code == "SG-INC-001_EXPLICIT_USE_PROHIBITION":
                policy_incompatible = True
                incompatibility_codes.append(ast.code)
            elif ast.code == "SG-INC-002_FORBIDDEN_ACCESS_MODE":
                policy_incompatible = True
                incompatibility_codes.append(ast.code)
            elif ast.code == "SG-INC-003_INVALID_SOURCE_IDENTITY":
                policy_incompatible = True
                incompatibility_codes.append(ast.code)
                
    # Explicit verifier-enforced policy incompatibility checks (fallback on assessment fields)
    strategy = assessment_dict.get("verification_strategy", "none")
    if strategy == "prohibited" and "SG-INC-001_EXPLICIT_USE_PROHIBITION" not in incompatibility_codes:
        policy_incompatible = True
        incompatibility_codes.append("SG-INC-001_EXPLICIT_USE_PROHIBITION")
        
    host = assessment_dict.get("rights_scope_identifier", "")
    
    evidence = VerifiedEvidence(
        assessment_id=assessment_dict.get("id", 0),
        verified_at=datetime.datetime.now(datetime.timezone.utc),
        verifier_version="1.0",
        
        subject_type=assessment_dict.get("subject_type", "proposal"),
        subject_id=assessment_dict.get("subject_id", 0),
        
        # All independent verification facts default to FALSE for fail-closed security
        institution_identity_verified=assessment_dict.get("institution_identity_verified", False),
        endpoint_identity_verified=assessment_dict.get("endpoint_identity_verified", False),
        
        rights_statement_retrieved=assessment_dict.get("rights_statement_retrieved", False),
        rights_statement_hash_matches=assessment_dict.get("rights_statement_hash_matches", False),
        rights_verified=rights_verified,
        rights_class=rights_class,
        rights_identifier=assessment_dict.get("rights_identifier"),
        rights_uri=assessment_dict.get("rights_uri"),
        
        scope_verified=assessment_dict.get("scope_verified", False),
        scope_type=scope_type,
        scope_identifier=host,
        
        access_verified=assessment_dict.get("access_verified", False),
        verification_strategy=strategy,
        
        conflicts=conflicts,
        evidence_sources=list(assessment_dict.get("evidence_sources", [])),
        policy_incompatible=policy_incompatible,
        incompatibility_codes=incompatibility_codes
    )
    return evidence

def evaluate_source_policy(evidence: VerifiedEvidence, policy_version: str = POLICY_VERSION) -> PolicyEvaluation:
    """
    Pure deterministic policy evaluator.
    No database writes, no network calls, no LLM inference.
    Maps verified evidence to an authoritative policy decision.
    """
    if policy_version not in SUPPORTED_POLICY_VERSIONS:
        raise ValueError(f"Unsupported policy version: {policy_version}")
        
    blocking_conditions = []
    reason_codes = []
    
    # Check absolute invariants (Failure conditions)
    if evidence.rights_class == "unknown":
        blocking_conditions.append("UNKNOWN_RIGHTS")
    
    if not evidence.rights_verified:
        blocking_conditions.append("RIGHTS_NOT_VERIFIED")
        
    if evidence.scope_type == "unresolved":
        blocking_conditions.append("SCOPE_UNRESOLVED")
        
    if evidence.conflicts:
        blocking_conditions.append("CONFLICTING_EVIDENCE")
        
    if not evidence.institution_identity_verified or not evidence.endpoint_identity_verified:
        blocking_conditions.append("IDENTITY_UNVERIFIED")
        
    if evidence.policy_incompatible:
        blocking_conditions.append("POLICY_INCOMPATIBLE")
        
    # Evaluate Rules
    
    # 0. REJECT (SG-P1-099_POLICY_INCOMPATIBLE)
    if "POLICY_INCOMPATIBLE" in blocking_conditions or evidence.policy_incompatible:
        rule = "SG-P1-099_POLICY_INCOMPATIBLE"
        return _build_eval("reject", None, rule, reason_codes, blocking_conditions, evidence, policy_version)
        
    # 1. DOMAIN_TRUSTED (SG-P1-010_ENDPOINT_SCOPE_AND_RIGHTS_VERIFIED)
    if not blocking_conditions and evidence.scope_type == "endpoint" and evidence.scope_verified:
        if evidence.rights_class in ("public_domain", "creative_commons"):
            reason_codes.append("ENDPOINT_WIDE_VERIFIED")
            return _build_eval("approve", "domain_trusted", "SG-P1-010_ENDPOINT_SCOPE_AND_RIGHTS_VERIFIED", 
                               reason_codes, blocking_conditions, evidence, policy_version)

    # 2. COLLECTION_TRUSTED (SG-P1-011_COLLECTION_SCOPE_AND_RIGHTS_VERIFIED)
    if not blocking_conditions and evidence.scope_type == "collection" and evidence.scope_verified:
         if evidence.rights_class in ("public_domain", "creative_commons"):
            reason_codes.append("COLLECTION_WIDE_VERIFIED")
            return _build_eval("approve", "collection_trusted", "SG-P1-011_COLLECTION_SCOPE_AND_RIGHTS_VERIFIED", 
                               reason_codes, blocking_conditions, evidence, policy_version)
                               
    # 3. ITEM_VERIFIED (SG-P1-020_SUPPORTED_ITEM_VERIFIER / SG-P1-021_MIXED_WITHOUT_SUPPORTED_VERIFIER)
    if evidence.rights_class == "mixed" and evidence.institution_identity_verified and evidence.endpoint_identity_verified:
        if not blocking_conditions:
            if evidence.verification_strategy == "archive_org_metadata":
                 reason_codes.append("SUPPORTED_VERIFIER_FOUND")
                 return _build_eval("approve", "item_verified", "SG-P1-020_SUPPORTED_ITEM_VERIFIER", 
                                   reason_codes, blocking_conditions, evidence, policy_version)
            else:
                 blocking_conditions.append("UNSUPPORTED_VERIFIER")
                 return _build_eval("needs_human_review", None, "SG-P1-021_MIXED_WITHOUT_SUPPORTED_VERIFIER", 
                                   reason_codes, blocking_conditions, evidence, policy_version)
        else:
            pass

    # 4. LINK_ONLY (SG-P1-030_LINK_ONLY_ALLOWED)
    if not blocking_conditions and evidence.institution_identity_verified and evidence.access_verified and evidence.rights_class in ("in_copyright", "mixed", "unknown"):
        reason_codes.append("LINK_ONLY_PERMITTED")
        return _build_eval("approve", "link_only", "SG-P1-030_LINK_ONLY_ALLOWED", 
                           reason_codes, blocking_conditions, evidence, policy_version)

    # Fallback / explicit blockers mapping to rules
    if "UNKNOWN_RIGHTS" in blocking_conditions or "RIGHTS_NOT_VERIFIED" in blocking_conditions:
        rule = "SG-P1-001_INSUFFICIENT_RIGHTS_EVIDENCE"
    elif "SCOPE_UNRESOLVED" in blocking_conditions or not evidence.scope_verified:
        rule = "SG-P1-002_SCOPE_UNRESOLVED"
    elif "IDENTITY_UNVERIFIED" in blocking_conditions:
        rule = "SG-P1-003_IDENTITY_UNVERIFIED"
    elif "CONFLICTING_EVIDENCE" in blocking_conditions:
        rule = "SG-P1-090_CONFLICTING_EVIDENCE"
    else:
        rule = "SG-P1-000_DEFAULT_NEEDS_REVIEW"

    return _build_eval("needs_human_review", None, rule, reason_codes, blocking_conditions, evidence, policy_version)


def _build_eval(decision_outcome: str, trust_mode: Optional[str], rule_id: str, 
                reason_codes: List[str], blocking_conditions: List[str], 
                evidence: VerifiedEvidence, policy_version: str) -> PolicyEvaluation:
    
    snapshot = {
        "assessment_id": evidence.assessment_id,
        "verified_at": evidence.verified_at.isoformat(),
        "verifier_version": evidence.verifier_version,
        "policy_version": policy_version,
        "rule_id": rule_id,
        
        "institution_identity_verified": evidence.institution_identity_verified,
        "endpoint_identity_verified": evidence.endpoint_identity_verified,
        
        "rights_statement_retrieved": evidence.rights_statement_retrieved,
        "rights_statement_hash_matches": evidence.rights_statement_hash_matches,
        "rights_verified": evidence.rights_verified,
        "rights_class": evidence.rights_class,
        "rights_identifier": evidence.rights_identifier,
        "rights_uri": evidence.rights_uri,
        
        "scope_verified": evidence.scope_verified,
        "scope_type": evidence.scope_type,
        "scope_identifier": evidence.scope_identifier,
        
        "access_verified": evidence.access_verified,
        "verification_strategy": evidence.verification_strategy,
        
        "conflicts": evidence.conflicts,
        "evidence_sources": evidence.evidence_sources,
        
        "policy_incompatible": evidence.policy_incompatible,
        "incompatibility_codes": evidence.incompatibility_codes
    }
    
    return PolicyEvaluation(
        decision_outcome=decision_outcome,
        trust_mode=trust_mode,
        rule_id=rule_id,
        reason_codes=reason_codes,
        blocking_conditions=blocking_conditions,
        policy_version=policy_version,
        verification_version=evidence.verifier_version,
        evidence_snapshot=snapshot
    )


def persist_source_policy_evaluation(cur, verified_evidence_id: int) -> int:
    """
    Dedicated trusted evaluation writer boundary.
    Reconstructs VerifiedEvidence from base tables, runs the deterministic policy engine,
    canonicalizes the result, computes the evaluation hash, and inserts the immutable record.
    """
    # 1. Fetch verified evidence facts
    cur.execute(
        "SELECT id, assessment_id, proposal_id, subject_type, subject_id, "
        "       verifier_version, institution_identity_verified, endpoint_identity_verified, "
        "       rights_statement_retrieved, rights_statement_hash_matches, rights_verified, "
        "       rights_class, rights_identifier, rights_uri, scope_verified, scope_type, "
        "       scope_identifier, access_verified, verification_strategy, policy_incompatible, "
        "       incompatibility_codes, conflicts, evidence_sources "
        "FROM source_verified_evidence "
        "WHERE id = %s",
        (verified_evidence_id,)
    )
    row = cur.fetchone()
    if not row:
        raise ValueError(f"VerifiedEvidence record {verified_evidence_id} not found.")
        
    evidence = VerifiedEvidence(
        assessment_id=row["assessment_id"],
        verified_at=datetime.datetime.now(datetime.timezone.utc),
        verifier_version=row["verifier_version"],
        subject_type=row["subject_type"],
        subject_id=row["subject_id"],
        institution_identity_verified=row["institution_identity_verified"],
        endpoint_identity_verified=row["endpoint_identity_verified"],
        rights_statement_retrieved=row["rights_statement_retrieved"],
        rights_statement_hash_matches=row["rights_statement_hash_matches"],
        rights_verified=row["rights_verified"],
        rights_class=row["rights_class"],
        rights_identifier=row["rights_identifier"],
        rights_uri=row["rights_uri"],
        scope_verified=row["scope_verified"],
        scope_type=row["scope_type"],
        scope_identifier=row["scope_identifier"],
        access_verified=row["access_verified"],
        verification_strategy=row["verification_strategy"],
        conflicts=row["conflicts"] if row["conflicts"] else [],
        evidence_sources=row["evidence_sources"] if row["evidence_sources"] else [],
        policy_incompatible=row["policy_incompatible"],
        incompatibility_codes=row["incompatibility_codes"] if row["incompatibility_codes"] else []
    )
    
    # 2. Run deterministic policy engine
    evaluation = evaluate_source_policy(evidence, POLICY_VERSION)
    
    # 3. Compute deterministic evaluation hash
    eval_hash = compute_policy_evaluation_hash(evaluation, evidence.subject_type, evidence.subject_id, verified_evidence_id)
    evidence_hash = compute_evidence_hash(evidence)
    
    # 4. Insert into immutable evaluations table
    cur.execute(
        "INSERT INTO source_policy_evaluations "
        "(verified_evidence_id, subject_type, subject_id, "
        " decision_outcome, trust_mode, rule_id, reason_codes, blocking_conditions, "
        " policy_version, verification_version, evidence_hash, "
        " evaluation_snapshot, evaluation_hash) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        "RETURNING id",
        (
            verified_evidence_id,
            evidence.subject_type,
            evidence.subject_id,
            evaluation.decision_outcome,
            evaluation.trust_mode,
            evaluation.rule_id,
            evaluation.reason_codes,
            evaluation.blocking_conditions,
            evaluation.policy_version,
            evaluation.verification_version,
            evidence_hash,
            json.dumps(evaluation.evidence_snapshot),
            eval_hash
        )
    )
    return cur.fetchone()["id"]
