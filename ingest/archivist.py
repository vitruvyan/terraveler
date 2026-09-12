import os
import re
import sys
import hashlib
from urllib.parse import urlparse
from discovery_fetch import untrusted_discovery_fetch

# Add current directory to path to allow importing shadow/whitelist helpers
sys.path.append(os.path.dirname(__file__))
import source_governance_shadow

ARCHIVIST_AGENT_ID = 888  # Durable specialist agent ID

def calculate_hash(text: str) -> str:
    """Calculates SHA256 of the fetched text."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def detect_rights_class(text: str) -> tuple[str, str, str, str]:
    """
    Simulates the AI Archivist's analysis of a license page.
    Translates and classifies based on keywords, preserving multilingual constraints.
    Returns (rights_class, rights_identifier, rights_uri, original_excerpt).
    """
    text_lower = text.lower()
    
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
            # 1. Fetch proposal
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

            # 2. Fetch terms page (either live or mock-fixture)
            if mock_fetch_content is not None:
                content = mock_fetch_content
            else:
                content = untrusted_discovery_fetch(target_url)
            
            # 3. Analyze content (LLM Archivist simulator)
            rights_class, rights_identifier, rights_uri, excerpt = detect_rights_class(content)
            statement_hash = calculate_hash(content)
            
            # Determine recommended trust mode (Advisory only)
            if rights_class == "public_domain":
                rec_trust = "domain_trusted"
            elif rights_class == "creative_commons":
                if "collection" in target_url.lower():
                    rec_trust = "collection_trusted"
                else:
                    rec_trust = "domain_trusted"
            elif rights_class == "in_copyright":
                rec_trust = "link_only"
            else:
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
                "rights_scope_type": "collection" if rec_trust == "collection_trusted" else "endpoint",
                "rights_class": rights_class,
                "rights_identifier": rights_identifier,
                "rights_uri": rights_uri,
                "rights_statement_url": target_url,
                "rights_statement_hash": statement_hash,
                "recommended_trust_mode": rec_trust,
                "reasoning_summary": f"Detected rights class '{rights_class}' with identifier '{rights_identifier}' from original text."
            }

            # 4. Insert SourceAssessment record
            cur.execute(
                "INSERT INTO source_assessments "
                "(proposal_id, assessed_by_agent_id, rights_scope_type, rights_scope_identifier, "
                " rights_class, rights_identifier, rights_uri, machine_readable_rights, "
                " rights_statement_url, rights_statement_hash) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "RETURNING id",
                (
                    proposal["id"],
                    ARCHIVIST_AGENT_ID,
                    evidence_contract["rights_scope_type"],
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

            # 5. Update proposal status to 'needs_policy_review' (No auto-activation)
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
