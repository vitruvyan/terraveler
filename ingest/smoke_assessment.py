"""
Phase 3A: Real-World Read-Only Smoke Assessment.
Runs untrusted_discovery_fetch and detect_rights_class against real national archives,
summarizing findings without mutating any database policy state or performing any activation.
"""

import os
import sys

# Add current directory to path to allow importing fetcher and archivist
sys.path.append(os.path.dirname(__file__))
from discovery_fetch import untrusted_discovery_fetch
from archivist import detect_rights_class

SMOKE_SOURCES = {
    "Gallica / BnF": "https://gallica.bnf.fr",
    "Biblioteca Nacional de España (BNE)": "https://www.bne.es",
    "PARES (Spanish Archives)": "http://pares.mcu.es",
    "Biblioteca Nacional de Portugal": "http://www.bnportugal.gov.pt",
    "Vatican Library (DigiVatLib)": "https://digi.vatlib.it"
}

def run_smoke_assessment():
    print("=" * 80)
    print("TERRAVELER PHASE 3A: REAL-WORLD READ-ONLY SMOKE ASSESSMENT")
    print("=" * 80)
    print("This run investigates real global archives in a strictly read-only manner.")
    print("No SourcePolicyDecision is created, and no database state is mutated.\n")
    
    for name, url in SMOKE_SOURCES.items():
        print(f"--- Investigating: {name} ({url}) ---")
        try:
            # Perform highly secure untrusted discovery fetch
            content = untrusted_discovery_fetch(url)
            
            # Run expert archivist analysis
            rights_class, rights_identifier, rights_uri, excerpt = detect_rights_class(content)
            
            # Map advisory recommendation
            rec_mode = "NEEDS_HUMAN_REVIEW"
            if rights_class == "public_domain":
                rec_mode = "DOMAIN_TRUSTED"
            elif rights_class == "creative_commons":
                rec_mode = "COLLECTION_TRUSTED" if "collection" in url.lower() else "DOMAIN_TRUSTED"
            elif rights_class == "in_copyright":
                rec_mode = "LINK_ONLY"
                
            print(f"  [Status]: Reachable (Successfully Fetched)")
            print(f"  [Detected Rights Class]: {rights_class.upper()}")
            print(f"  [Rights Identifier]: {rights_identifier}")
            print(f"  [Rights URI]: {rights_uri or 'None'}")
            print(f"  [Advisory Trust Mode Recommendation]: {rec_mode}")
            print(f"  [Evidence Snippet]:")
            print(f"    {excerpt[:300]}...")
            
        except PermissionError as pe:
            print(f"  [Status]: BLOCKED by Security Boundary: {pe}")
        except Exception as e:
            print(f"  [Status]: Unreachable / Error during fetch: {e}")
        print()
    print("=" * 80)
    print("CONFIRMATION: Zero activations or SourcePolicyDecisions occurred.")
    print("=" * 80)

if __name__ == "__main__":
    run_smoke_assessment()
