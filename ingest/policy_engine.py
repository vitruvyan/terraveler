from dataclasses import dataclass
from typing import Optional, List, Dict
import datetime

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

def evaluate_source_policy(evidence: VerifiedEvidence, policy_version: str = POLICY_VERSION) -> PolicyEvaluation:
    """
    Pure deterministic policy evaluator.
    No database writes, no network calls, no LLM inference.
    Maps verified evidence to an authoritative policy decision.
    """
    
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
        
    # Evaluate Rules
    
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
        if evidence.verification_strategy == "archive_org_metadata":
             reason_codes.append("SUPPORTED_VERIFIER_FOUND")
             return _build_eval("approve", "item_verified", "SG-P1-020_SUPPORTED_ITEM_VERIFIER", 
                               reason_codes, blocking_conditions, evidence, policy_version)
        else:
             blocking_conditions.append("UNSUPPORTED_VERIFIER")
             return _build_eval("needs_human_review", None, "SG-P1-021_MIXED_WITHOUT_SUPPORTED_VERIFIER", 
                               reason_codes, blocking_conditions, evidence, policy_version)

    # 4. LINK_ONLY (SG-P1-030_LINK_ONLY_ALLOWED)
    # For legitimately verified institutions that don't grant full ingestion rights,
    # but we can link/reference them safely.
    if not blocking_conditions and evidence.institution_identity_verified and evidence.access_verified and evidence.rights_class in ("in_copyright", "mixed", "unknown"):
        # For Phase 3B.1 we keep it conservative: Link_Only requires verified identity and access.
        # However, if rights are unknown/conflicting, we might want HUMAN_REVIEW instead.
        # If there are no severe blockers like conflicts:
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
    elif evidence.rights_class == "malicious": # Example Reject condition
        rule = "SG-P1-099_POLICY_INCOMPATIBLE"
        return _build_eval("reject", None, rule, reason_codes, blocking_conditions, evidence, policy_version)
    else:
        rule = "SG-P1-000_DEFAULT_NEEDS_REVIEW"

    # Default behaviour is NEEDS_HUMAN_REVIEW
    return _build_eval("needs_human_review", None, rule, reason_codes, blocking_conditions, evidence, policy_version)


def _build_eval(decision_outcome: str, trust_mode: Optional[str], rule_id: str, 
                reason_codes: List[str], blocking_conditions: List[str], 
                evidence: VerifiedEvidence, policy_version: str) -> PolicyEvaluation:
    
    snapshot = {
        "assessment_id": evidence.assessment_id,
        "verified_at": evidence.verified_at.isoformat(),
        "institution_identity_verified": evidence.institution_identity_verified,
        "endpoint_identity_verified": evidence.endpoint_identity_verified,
        "rights_verified": evidence.rights_verified,
        "rights_class": evidence.rights_class,
        "rights_identifier": evidence.rights_identifier,
        "scope_verified": evidence.scope_verified,
        "scope_type": evidence.scope_type,
        "verification_strategy": evidence.verification_strategy,
        "conflicts": evidence.conflicts,
        "evidence_sources": evidence.evidence_sources,
        "rights_statement_hash_matches": evidence.rights_statement_hash_matches
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
