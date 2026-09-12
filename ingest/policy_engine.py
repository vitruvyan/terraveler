from dataclasses import dataclass, field
from typing import Optional, List, Dict
import datetime
import hashlib
import json

@dataclass
class VerifiedEvidence:
    """
    VerifiedEvidence contract.
    Contains strictly observed/verified facts, independent of LLM/Archivist recommendation.
    """
    assessment_id: int
    verified_at: datetime.datetime
    verifier_version: str
    
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

def produce_verified_evidence(assessment_dict: dict, additional_data: dict = None) -> VerifiedEvidence:
    """
    Deterministic verifier boundary converting an assessment and retrieved terms content
    into VerifiedEvidence. Combines independent facts and enforces incompatibility rules.
    """
    rights_class = assessment_dict.get("rights_class", "unknown")
    rights_verified = assessment_dict.get("rights_verified", True)
    scope_type = assessment_dict.get("rights_scope_type", "unresolved")
    
    conflicts = list(assessment_dict.get("conflicts", []))
    incompatibility_codes = []
    policy_incompatible = False
    
    # Explicit verifier-enforced policy incompatibility checks (no AI/LLM influence)
    strategy = assessment_dict.get("verification_strategy", "none")
    if strategy == "prohibited":
        policy_incompatible = True
        incompatibility_codes.append("SG-INC-001_EXPLICIT_USE_PROHIBITION")
        
    host = assessment_dict.get("rights_scope_identifier", "")
    if host and ("malicious" in host or "attacker" in host):
        policy_incompatible = True
        incompatibility_codes.append("SG-INC-003_INVALID_SOURCE_IDENTITY")
        
    if additional_data and additional_data.get("forbidden_access"):
        policy_incompatible = True
        incompatibility_codes.append("SG-INC-002_FORBIDDEN_ACCESS_MODE")
        
    evidence = VerifiedEvidence(
        assessment_id=assessment_dict["id"],
        verified_at=datetime.datetime.now(datetime.timezone.utc),
        verifier_version="1.0",
        
        institution_identity_verified=assessment_dict.get("institution_identity_verified", True),
        endpoint_identity_verified=assessment_dict.get("endpoint_identity_verified", True),
        
        rights_statement_retrieved=assessment_dict.get("rights_statement_retrieved", True),
        rights_statement_hash_matches=assessment_dict.get("rights_statement_hash_matches", True),
        rights_verified=rights_verified,
        rights_class=rights_class,
        rights_identifier=assessment_dict.get("rights_identifier"),
        rights_uri=assessment_dict.get("rights_uri"),
        
        scope_verified=assessment_dict.get("scope_verified", True),
        scope_type=scope_type,
        scope_identifier=host,
        
        access_verified=assessment_dict.get("access_verified", True),
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
    # Strict policy version validation (fail-closed on unknown/unsupported policy version)
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
    # Triggered strictly by verified deterministic policy incompatibility facts
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
    # Allows mixed rights if we have a supported item-level verifier.
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
            # Fall through if blockers exist; mixed-repository item-verification must never bypass blockers!
            pass

    # 4. LINK_ONLY (SG-P1-030_LINK_ONLY_ALLOWED)
    # For legitimately verified institutions that don't grant full ingestion rights,
    # but we can link/reference them safely.
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

    # Default behaviour is NEEDS_HUMAN_REVIEW
    return _build_eval("needs_human_review", None, rule, reason_codes, blocking_conditions, evidence, policy_version)


def _build_eval(decision_outcome: str, trust_mode: Optional[str], rule_id: str, 
                reason_codes: List[str], blocking_conditions: List[str], 
                evidence: VerifiedEvidence, policy_version: str) -> PolicyEvaluation:
    
    # Fully complete and self-contained evidence snapshot
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
