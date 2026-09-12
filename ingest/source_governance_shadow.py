import os
import sys
import json
from urllib.parse import urlparse
import psycopg2
from psycopg2.extras import RealDictCursor

# Add current directory to path to allow importing whitelist
sys.path.append(os.path.dirname(__file__))
import whitelist

def get_db_connection():
    """Establish connection to PostgreSQL using environment variables."""
    host = os.environ.get("PGHOST", "127.0.0.1")
    port = int(os.environ.get("PGPORT", "6000" if host == "127.0.0.1" else "5432"))
    dbname = os.environ.get("PGDATABASE", "terraveler")
    user = os.environ.get("PGUSER", "terraveler")
    password = os.environ.get("PGPASSWORD", "terraveler")
    
    return psycopg2.connect(
        host=host,
        port=port,
        dbname=dbname,
        user=user,
        password=password,
        cursor_factory=RealDictCursor
    )

def resolve_trust_from_db(url: str):
    """
    Registry-backed resolver reading the Source Governance registry.
    Returns a structured policy result. Unknown/inactive sources fail closed.
    """
    try:
        parsed = urlparse(url)
        host = (parsed.netloc or "").lower()
    except Exception:
        return {"matched": False, "allowed": False, "trust_mode": "rejected", "verification_strategy": "none", "rights_class": "unknown"}

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            # 1. Fetch all active endpoints
            cur.execute(
                "SELECT id, host_pattern, match_type, status, trust_mode "
                "FROM source_endpoints "
                "WHERE status = 'active'"
            )
            endpoints = cur.fetchall()
            
            # 2. Match exact first, then suffix
            endpoint = None
            for e in endpoints:
                if e["match_type"] == "exact" and e["host_pattern"] == host:
                    endpoint = e
                    break
            
            if not endpoint:
                for e in endpoints:
                    if e["match_type"] == "suffix" and host.endswith(e["host_pattern"]):
                        endpoint = e
                        break
            
            if not endpoint:
                return {
                    "matched": False,
                    "allowed": False,
                    "trust_mode": "rejected",
                    "verification_strategy": "none",
                    "rights_class": "unknown",
                    "policy_decision_id": None
                }

            # 3. Fetch Access Rules & Decisions
            cur.execute(
                "SELECT verification_strategy FROM source_access_rules WHERE endpoint_id = %s",
                (endpoint["id"],)
            )
            rule = cur.fetchone()
            verification_strategy = rule["verification_strategy"] if rule else "none"

            cur.execute(
                "SELECT id, trust_mode, rights_class FROM source_policy_decisions WHERE endpoint_id = %s",
                (endpoint["id"],)
            )
            decision = cur.fetchone()
            rights_class = decision["rights_class"] if decision else "unknown"
            policy_decision_id = decision["id"] if decision else None

            # Determine semantic allowance
            allowed = endpoint["trust_mode"] in ("domain_trusted", "item_verified")

            return {
                "matched": True,
                "allowed": allowed,
                "endpoint_id": endpoint["id"],
                "host_pattern": endpoint["host_pattern"],
                "trust_mode": endpoint["trust_mode"],
                "verification_strategy": verification_strategy,
                "rights_class": rights_class,
                "policy_decision_id": policy_decision_id
            }
            
    except Exception as e:
        # Fail closed on database connection errors
        return {
            "matched": False,
            "allowed": False,
            "trust_mode": "rejected",
            "verification_strategy": "none",
            "rights_class": "unknown",
            "policy_decision_id": None,
            "error": str(e)
        }
    finally:
        if conn:
            conn.close()

def canonicalize_url(url: str) -> str:
    """Safely redact credentials, tokens, queries, or private fragments before persistence."""
    try:
        parsed = urlparse(url)
        # Reconstruct URL with only scheme, host, and path (redacting query, fragment, auth)
        return f"{parsed.scheme}://{parsed.netloc.split('@')[-1]}{parsed.path}"
    except Exception:
        return "[malformed URL]"

def record_comparison(canonical_url: str, legacy: dict, registry: dict, equivalent: bool, diff_class: str):
    """Write any disagreement or difference class to source_governance_comparisons."""
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO source_governance_comparisons "
                "(canonical_url, legacy_outcome, registry_outcome, equivalent, difference_class) "
                "VALUES (%s, %s, %s, %s, %s)",
                (
                    canonical_url,
                    json.dumps(legacy),
                    json.dumps(registry),
                    equivalent,
                    diff_class
                )
            )
            conn.commit()
    except Exception:
        # Fail silent on audit logging failure to protect ingestion pipeline uptime
        pass
    finally:
        if conn:
            conn.close()

def compare_shadow(url: str) -> tuple[bool, str]:
    """
    Compares legacy verify_source with registry-backed resolve_trust_from_db.
    Maintains Shadow Mode contract. Returns (legacy_ok, legacy_why).
    """
    # 1. Run legacy verifier
    legacy_ok, legacy_why = whitelist.verify_source(url)
    
    # 2. Check if Shadow Mode is enabled
    shadow_enabled = os.environ.get("SOURCE_GOVERNANCE_SHADOW_ENABLED", "").lower() == "true"
    if not shadow_enabled:
        return legacy_ok, legacy_why

    # 3. Evaluate new Registry resolver
    reg = resolve_trust_from_db(url)
    
    # Normalize outcomes for comparison
    legacy_outcome = {
        "allowed": legacy_ok,
        "why": legacy_why,
        "is_archive_org": "archive.org" in (urlparse(url).netloc or "").lower()
    }
    
    registry_outcome = {
        "allowed": reg["allowed"],
        "trust_mode": reg["trust_mode"],
        "verification_strategy": reg["verification_strategy"],
        "rights_class": reg["rights_class"]
    }

    # Evaluate semantic equivalence
    equivalent = True
    diff_class = None

    if legacy_outcome["is_archive_org"]:
        # Special treatment for archive.org:
        # Legacy does deep item checking; registry represents ITEM_VERIFIED.
        # They are equivalent in gating (both require item-level strategy).
        if reg["trust_mode"] != "item_verified" or reg["verification_strategy"] != "archive_org_metadata":
            equivalent = False
            diff_class = "VERIFIER_MISMATCH"
    else:
        # Standard domains
        if legacy_outcome["allowed"] != registry_outcome["allowed"]:
            equivalent = False
            diff_class = "ALLOW_DENY_MISMATCH"
        elif reg["matched"]:
            # If both allow, check trust class consistency
            if legacy_why == "Public domain" and reg["rights_class"] != "public_domain":
                equivalent = False
                diff_class = "LICENCE_CLASS_MISMATCH"
            elif legacy_why == "CC BY-SA 4.0" and reg["rights_class"] != "creative_commons":
                equivalent = False
                diff_class = "LICENCE_CLASS_MISMATCH"

    # 4. Log disagreements
    if not equivalent:
        redacted_url = canonicalize_url(url)
        record_comparison(redacted_url, legacy_outcome, registry_outcome, equivalent, diff_class)

    # 5. Always return legacy answer (Registry NEVER alters behavior in this phase)
    return legacy_ok, legacy_why
