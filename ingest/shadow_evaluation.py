import json
import datetime
from policy_engine import VerifiedEvidence, evaluate_source_policy

print("==========================================================================")
print("SHADOW EVALUATION REPORT - DETERMINISTIC POLICY (Phase 3B.1)")
print("WARNING: These are SYNTHETIC / REAL-WORLD-SHAPED SHADOW FIXTURES.")
print("They are synthetic test shapes used to validate deterministic policy outcomes.")
print("Do NOT treat them as verified real-world assessments.")
print("==========================================================================")

reports = []

# 1. Gallica / BnF (Public Domain phrasing, but unresolved scope initially)
evidence_gallica = VerifiedEvidence(
    assessment_id=101,
    verified_at=datetime.datetime.now(datetime.timezone.utc),
    verifier_version="1.0",
    institution_identity_verified=True,
    endpoint_identity_verified=True,
    rights_statement_retrieved=True,
    rights_statement_hash_matches=True,
    rights_verified=True,
    rights_class="public_domain",
    rights_identifier="PD",
    rights_uri=None,
    scope_verified=False,
    scope_type="unresolved",
    scope_identifier=None,
    access_verified=True,
    verification_strategy="none",
    conflicts=[],
    evidence_sources=["https://gallica.bnf.fr/html/und/conditions-dutilisation-des-contenus-de-gallica"]
)
reports.append(("Gallica / BnF (Synthetic Shape)", evidence_gallica))

# 2. BNE (Forbidden / Blocked, unverified access)
evidence_bne = VerifiedEvidence(
    assessment_id=102,
    verified_at=datetime.datetime.now(datetime.timezone.utc),
    verifier_version="1.0",
    institution_identity_verified=True,
    endpoint_identity_verified=False,
    rights_statement_retrieved=False,
    rights_statement_hash_matches=False,
    rights_verified=False,
    rights_class="unknown",
    rights_identifier=None,
    rights_uri=None,
    scope_verified=False,
    scope_type="unresolved",
    scope_identifier=None,
    access_verified=False,
    verification_strategy="none",
    conflicts=["Network access forbidden"],
    evidence_sources=[]
)
reports.append(("Biblioteca Nacional de España (BNE) (Synthetic Shape)", evidence_bne))

# 3. DigiVatLib (All Rights Reserved, legitimate, link only)
evidence_vat = VerifiedEvidence(
    assessment_id=103,
    verified_at=datetime.datetime.now(datetime.timezone.utc),
    verifier_version="1.0",
    institution_identity_verified=True,
    endpoint_identity_verified=True,
    rights_statement_retrieved=True,
    rights_statement_hash_matches=True,
    rights_verified=True,
    rights_class="in_copyright",
    rights_identifier="copyright_restricted",
    rights_uri=None,
    scope_verified=True,
    scope_type="endpoint",
    scope_identifier="digi.vatlib.it",
    access_verified=True,
    verification_strategy="none",
    conflicts=[],
    evidence_sources=["https://digi.vatlib.it/"]
)
reports.append(("DigiVatLib (Vatican) (Synthetic Shape)", evidence_vat))

# 4. Internet Archive (Mixed rights, supported verifier)
evidence_ia = VerifiedEvidence(
    assessment_id=104,
    verified_at=datetime.datetime.now(datetime.timezone.utc),
    verifier_version="1.0",
    institution_identity_verified=True,
    endpoint_identity_verified=True,
    rights_statement_retrieved=True,
    rights_statement_hash_matches=True,
    rights_verified=True,
    rights_class="mixed",
    rights_identifier="mixed",
    rights_uri=None,
    scope_verified=True,
    scope_type="endpoint",
    scope_identifier="archive.org",
    access_verified=True,
    verification_strategy="archive_org_metadata",
    conflicts=[],
    evidence_sources=["https://archive.org/about/terms.php"]
)
reports.append(("Internet Archive (Synthetic Shape)", evidence_ia))

# 5. Wikimedia Commons (Creative Commons, verified collection/endpoint)
evidence_wikimedia = VerifiedEvidence(
    assessment_id=105,
    verified_at=datetime.datetime.now(datetime.timezone.utc),
    verifier_version="1.0",
    institution_identity_verified=True,
    endpoint_identity_verified=True,
    rights_statement_retrieved=True,
    rights_statement_hash_matches=True,
    rights_verified=True,
    rights_class="creative_commons",
    rights_identifier="CC-BY-SA-4.0",
    rights_uri=None,
    scope_verified=True,
    scope_type="endpoint",
    scope_identifier="wikimedia.org",
    access_verified=True,
    verification_strategy="none",
    conflicts=[],
    evidence_sources=["https://wikimediafoundation.org/wiki/Terms_of_Use"]
)
reports.append(("Wikimedia Commons (Synthetic Shape)", evidence_wikimedia))


stats = {"approve": 0, "needs_human_review": 0, "reject": 0}

for name, evidence in reports:
    print(f"\nEvaluating: {name}")
    eval_result = evaluate_source_policy(evidence)
    stats[eval_result.decision_outcome] += 1
    print(f"  Decision Outcome : {eval_result.decision_outcome}")
    print(f"  Trust Mode       : {eval_result.trust_mode}")
    print(f"  Rule ID          : {eval_result.rule_id}")
    print(f"  Blockers         : {eval_result.blocking_conditions}")
    
print("\n==========================================================================")
print("SHADOW SUMMARY COUNTS")
print(f" WOULD_APPROVE: {stats['approve']}")
print(f" WOULD_REQUIRE_HUMAN_REVIEW: {stats['needs_human_review']}")
print(f" WOULD_REJECT: {stats['reject']}")
print("==========================================================================")
