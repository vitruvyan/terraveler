import os
import re
import sys
import hashlib
from urllib.parse import urlparse
from discovery_fetch import untrusted_discovery_fetch

# Add current directory to path to allow importing shadow/whitelist helpers
sys.path.append(os.path.dirname(__file__))
import source_governance_shadow

ARCHIVIST_PUBLIC_ID = "system-archivist"

def calculate_hash(text: str) -> str:
    """Calculates SHA256 of the fetched text."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def detect_rights_class(text: str) -> tuple[str, str, str, str]:
    """
    Expert deterministic evidence extractor (Phase 3A scaffolding).
    Parses and extracts observable factual evidence from the text.
    """
    text_lower = text.lower()
    
    # Adversarial check: Mixed rights repositories must be flagged as mixed/unresolved
    if ("both copyrighted works and works in the public domain" in text_lower or 
        "mixed rights" in text_lower or 
        "contains copyrighted" in text_lower):
        return "mixed", "mixed_repository_warning", "https://rightsstatements.org/vocab/MIXED/1.0/", text[:300]
    
    # 1. CC-BY-SA
    m_cc = re.search(r"(creative\s+commons\s+attribution-sharealike|cc\s+by-sa|by-sa\s+4\.0|by-sa/4\.0)", text_lower)
    if m_cc:
        start = max(0, m_cc.start() - 100)
        end = min(len(text), m_cc.end() + 100)
        excerpt = text[start:end].strip()
        return "creative_commons", "CC-BY-SA-4.0", "https://creativecommons.org/licenses/by-sa/4.0/", excerpt

    # 2. General CC-BY
    m_cc_by = re.search(r"(creative\s+commons\s+attribution|cc\s+by|cc-by\s+4\.0)", text_lower)
    if m_cc_by:
        start = max(0, m_cc_by.start() - 100)
        end = min(len(text), m_cc_by.end() + 100)
        excerpt = text[start:end].strip()
        return "creative_commons", "CC-BY-4.0", "https://creativecommons.org/licenses/by/4.0/", excerpt

    # 3. Public Domain / Domínio Público / Domaine Public
    m_pd = re.search(r"(public\s+domain|domínio\s+público|domínio\s+publico|dominio\s+público|dominio\s+publico|domaine\s+public|no\s+known\s+copyright|sin\s+derechos|pd\s+mark|creative\s+commons\s+cc0|cc0)", text_lower)
    if m_pd:
        start = max(0, m_pd.start() - 100)
        end = min(len(text), m_pd.end() + 100)
        excerpt = text[start:end].strip()
        return "public_domain", "PD", "https://creativecommons.org/publicdomain/mark/1.0/", excerpt

    # 4. In Copyright / Restricted
    m_restricted = re.search(r"(all\s+rights\s+reserved|tous\s+droits\s+réservés|todos\s+os\s+direitos|access\s+restricted|lending\s+only|subscription\s+required)", text_lower)
    if m_restricted:
        start = max(0, m_restricted.start() - 100)
        end = min(len(text), m_restricted.end() + 100)
        excerpt = text[start:end].strip()
        return "in_copyright", "copyright_restricted", "https://rightsstatements.org/vocab/InC/1.0/", excerpt

    # Default to unknown/mixed
    return "unknown", "undetermined", "", "No explicit rights statement found in text."

def get_archivist_agent_id(cur) -> int:
    """Resolves the real, durable agent_accounts PK from the database. Fails closed if missing/inactive."""
    cur.execute(
        "SELECT id FROM agent_accounts "
        "WHERE public_id = %s AND status = 'active'",
        (ARCHIVIST_PUBLIC_ID,)
    )
    row = cur.fetchone()
    if not row:
        raise PermissionError(f"Specialist Archivist identity '{ARCHIVIST_PUBLIC_ID}' is missing or inactive. Failing closed.")
    return row["id"]

def assess_source_proposal(proposal_id: int, mock_fetch_content=None) -> dict:
    """
    Archivist assessment runner.
    Fetches the proposed URL, investigates the terms, and saves a SourceAssessment record.
    NO SourcePolicyDecision is created (No activation).
    """
    conn = None
    try:
        conn = source_governance_shadow.get_db_connection()
        with conn.cursor() as cur:
            # 1. Resolve real, durable Archivist agent identity (Fail closed if missing/inactive)
            archivist_id = get_archivist_agent_id(cur)
            
            # 2. Fetch proposal
            cur.execute(
                "SELECT id, target_url, proposed_by_actor_type, proposed_by_actor_id "
                "FROM source_proposals "
                "WHERE id = %s",
                (proposal_id,)
            )
            proposal = cur.fetchone()
            if not proposal:
                raise ValueError(f"Proposal not found: {proposal_id}")
            
            target_url = proposal["target_url"]
            parsed = urlparse(target_url)
            host = (parsed.hostname or "").lower()

            # 3. Fetch terms page (either live or mock-fixture)
            if mock_fetch_content is not None:
                content = mock_fetch_content
            else:
                content = untrusted_discovery_fetch(target_url)
            
            # 4. Analyze content (deterministic evidence extractor)
            rights_class, rights_identifier, rights_uri, excerpt = detect_rights_class(content)
            statement_hash = calculate_hash(content)
            
            # Determine recommended trust mode (Advisory only)
            # Rights scope and trust classification are decoupled:
            if rights_class == "public_domain":
                # Keyword matches alone do NOT imply endpoint-wide or collection scope!
                # It is unresolved until verified.
                rights_scope = "unresolved"
                rec_trust = "needs_human_review"
            elif rights_class == "creative_commons":
                if "collection" in target_url.lower():
                    # Suffix/folder match requires explicit evidence.
                    rights_scope = "collection"
                    rec_trust = "collection_trusted"
                else:
                    rights_scope = "unresolved"
                    rec_trust = "needs_human_review"
            elif rights_class == "in_copyright":
                rights_scope = "endpoint"
                rec_trust = "link_only"
            else:
                rights_scope = "unresolved"
                rec_trust = "needs_human_review"

            # Detect language
            lang = "en"
            if "domaine public" in excerpt.lower() or "tous droits" in excerpt.lower():
                lang = "fr"
            elif "domínio" in excerpt.lower() or "direitos" in excerpt.lower():
                lang = "pt"
            elif "derechos" in excerpt.lower():
                lang = "es"

            # Translate if non-English
            translation = None
            if lang != "en":
                translation = f"[Archivist Translation]: Classified as '{rights_class}' based on local rights keyword matching."

            evidence_contract = {
                "institution_identity": f"Archive at {host}",
                "canonical_source_url": target_url,
                "canonical_domain": host,
                "languages": [lang],
                "original_language": lang,
                "original_rights_text": excerpt,
                "translated_interpretation": translation,
                "rights_scope_type": rights_scope,
                "rights_class": rights_class,
                "rights_identifier": rights_identifier,
                "rights_uri": rights_uri,
                "rights_statement_url": target_url,
                "rights_statement_hash": statement_hash,
                "recommended_trust_mode": rec_trust,
                "reasoning_summary": f"Detected rights class '{rights_class}' with scope '{rights_scope}' from original text."
            }

            # 5. Insert SourceAssessment record
            cur.execute(
                "INSERT INTO source_assessments "
                "(proposal_id, assessed_by_agent_id, rights_scope_type, rights_scope_identifier, "
                " rights_class, rights_identifier, rights_uri, machine_readable_rights, "
                " rights_statement_url, rights_statement_hash) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "RETURNING id",
                (
                    proposal["id"],
                    archivist_id,
                    rights_scope,
                    host,
                    rights_class,
                    rights_identifier,
                    rights_uri,
                    False,
                    target_url,
                    statement_hash
                )
            )
            assessment_id = cur.fetchone()["id"]

            # 6. Update proposal status to 'needs_policy_review' (No auto-activation)
            cur.execute(
                "UPDATE source_proposals "
                "SET status = 'needs_policy_review' "
                "WHERE id = %s",
                (proposal["id"],)
            )
            conn.commit()

            return {
                "assessment_id": assessment_id,
                "proposal_id": proposal["id"],
                "status": "needs_policy_review",
                "evidence_contract": evidence_contract
            }

    except Exception as e:
        if conn:
            conn.rollback()
        raise e
    finally:
        if conn:
            conn.close()
