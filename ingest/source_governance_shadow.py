import os
import re
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

_LABEL = r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
_EXACT_HOST_RE = re.compile(rf"^{_LABEL}(?:\.{_LABEL})+$")
_SUFFIX_HOST_RE = re.compile(rf"^\.{_LABEL}(?:\.{_LABEL})+$")


def is_well_formed_pattern(match_type: str, host_pattern: str) -> bool:
    """A registry pattern the resolver may match against — the same rule as
    lib/source-governance.ts::isWellFormedPattern. A suffix must be a dot plus
    at least two labels: `host.endswith("com")` would trust every .com host and
    `endswith("")` every host at all, so a row like that, however it got into
    the table, is inert rather than catastrophic."""
    pattern = host_pattern or ""
    if match_type == "exact":
        return bool(_EXACT_HOST_RE.match(pattern))
    if match_type == "suffix":
        return bool(_SUFFIX_HOST_RE.match(pattern))
    return False


def resolve_trust_from_db(url: str):
    """
    Registry-backed resolver reading the Source Governance registry.
    Returns a structured policy result. Unknown/inactive/quarantined sources fail closed.
    """
    # Use canonical host-normalization helper imported from whitelist
    host = whitelist.normalize_host(url)
    if not host:
        return {
            "matched": False,
            "decision": "deny",
            "trust_mode": "rejected",
            "verification_strategy": "none",
            "rights_class": "unknown",
            "policy_decision_id": None
        }

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
            endpoints = [e for e in cur.fetchall()
                         if is_well_formed_pattern(e["match_type"], e["host_pattern"])]
            
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
                    "decision": "deny",
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

            # The NEWEST decision, whatever its outcome. This used to be a bare
            # fetchone() with no ordering — an arbitrary row of the endpoint's
            # history, so a superseding reject or an older approve could be
            # the one that spoke. The newest decision is the one in force.
            cur.execute(
                "SELECT id, decision_outcome, trust_mode, rights_class FROM source_policy_decisions "
                "WHERE endpoint_id = %s ORDER BY timestamp DESC, id DESC LIMIT 1",
                (endpoint["id"],)
            )
            decision = cur.fetchone()
            rights_class = decision["rights_class"] if decision else "unknown"
            policy_decision_id = decision["id"] if decision else None

            # Resolve decision state (ITEM_VERIFIED is never automatically allowed).
            # Every branch that does not allow says WHY, so a refusal at the
            # Curator names its cause instead of a generic "registry status".
            reason = None
            if decision is None or decision["decision_outcome"] != "approve":
                decision_outcome = "deny"
                reason = "no approval in force on this endpoint (newest decision is not an approve)"
            elif endpoint["trust_mode"] == "domain_trusted":
                # Mirrors lib/source-governance.ts::isEffective: "this whole
                # domain is safe to ingest unattended" cannot rest on rights
                # nobody has established.
                if rights_class in (None, "unknown", "in_copyright"):
                    decision_outcome = "deny"
                    reason = (f"approved as domain_trusted but rights class is "
                              f"{rights_class or 'unrecorded'!r}: recorded, not in force")
                else:
                    decision_outcome = "allow"
            elif rights_class == "in_copyright":
                decision_outcome = "deny"
                reason = "approved, but its rights class is 'in_copyright': recorded, not in force"
            elif endpoint["trust_mode"] == "item_verified":
                decision_outcome = "requires_item_verification"
            else:
                decision_outcome = "deny"
                reason = (f"trust_mode {endpoint['trust_mode']!r} is not honoured by host "
                          f"alone (collection_trusted needs a collection match; link_only never ingests)")

            return {
                "matched": True,
                "decision": decision_outcome,
                "endpoint_id": endpoint["id"],
                "host_pattern": endpoint["host_pattern"],
                "trust_mode": endpoint["trust_mode"],
                "verification_strategy": verification_strategy,
                "rights_class": rights_class,
                "policy_decision_id": policy_decision_id,
                "reason": reason,
            }
            
    except Exception as e:
        # Fail closed on database connection errors
        return {
            "matched": False,
            "decision": "deny",
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

def compare_shadow(url: str, fetch_json=None) -> tuple[bool, str]:
    """
    Compares legacy verify_source with registry-backed resolve_trust_from_db.
    Maintains Shadow Mode contract. Returns (legacy_ok, legacy_why).
    """
    # 1. Run legacy verifier (calling the pure legacy implementation directly to eliminate recursion by construction)
    legacy_ok, legacy_why = whitelist._verify_source_legacy(url, fetch_json=fetch_json)
    
    # 2. Check if Shadow Mode is enabled
    shadow_enabled = os.environ.get("SOURCE_GOVERNANCE_SHADOW_ENABLED", "").lower() == "true"
    if not shadow_enabled:
        return legacy_ok, legacy_why

    # 3. Evaluate new Registry resolver
    reg = resolve_trust_from_db(url)
    
    # 4. Resolve exact behavioral outcome
    registry_allowed = False
    registry_reason = "rejected"

    if reg["decision"] == "allow":
        registry_allowed = True
        registry_reason = reg["rights_class"]
    elif reg["decision"] == "requires_item_verification":
        # True behavioral equivalence: run the configured verifier on the item
        verifier = whitelist._verification_strategies().get(reg["verification_strategy"])
        if verifier is not None:
            registry_allowed, registry_reason = verifier(url, fetch_json=fetch_json)
        else:
            registry_allowed = False
            registry_reason = f"unknown verification strategy: {reg['verification_strategy']}"

    # Normalize outcomes for comparison
    legacy_outcome = {
        "allowed": legacy_ok,
        "why": legacy_why,
    }
    
    registry_outcome = {
        "allowed": registry_allowed,
        "why": registry_reason,
        "trust_mode": reg["trust_mode"],
        "verification_strategy": reg["verification_strategy"]
    }

    # Evaluate semantic equivalence
    equivalent = True
    diff_class = None

    if legacy_outcome["allowed"] != registry_outcome["allowed"]:
        equivalent = False
        diff_class = "ALLOW_DENY_MISMATCH"
    elif reg["matched"]:
        # If both allow, check trust class/licence consistency
        legacy_lic = whitelist.canonical_license(legacy_outcome["why"])
        registry_lic = whitelist.canonical_license(registry_outcome["why"])
        if legacy_lic != registry_lic:
            equivalent = False
            diff_class = "LICENCE_CLASS_MISMATCH"

    # 5. Log disagreements
    if not equivalent:
        redacted_url = canonicalize_url(url)
        record_comparison(redacted_url, legacy_outcome, registry_outcome, equivalent, diff_class)

    # 6. Always return legacy answer (Registry NEVER alters behavior in this phase)
    return legacy_ok, legacy_why
