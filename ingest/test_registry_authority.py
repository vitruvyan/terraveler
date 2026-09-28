"""The registry as authority: what an approval does, and when it does nothing.

    python3 -m unittest test_registry_authority -v          (from ingest/)

No database and no network: the connection is a fake that answers by SQL
text. What these pin is the part of `resolve_trust_from_db` that decides
whether an editor's approval is in force — which is the difference between a
registry that records decisions and one that enforces them.

Mirrors lib/source-governance.ts::isEffective on the TypeScript side; the two
must not drift, so the same cases appear in test/source-registry-trust.test.ts.
"""
import os
import sys
import unittest
from unittest.mock import patch

sys.path.append(os.path.dirname(__file__))
import source_governance_shadow as G
import whitelist


class FakeCursor:
    def __init__(self, endpoints, rule, decision):
        self.endpoints, self.rule, self.decision = endpoints, rule, decision
        self.sql = []
        self._last = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.sql.append(sql)
        self._last = sql

    def fetchall(self):
        return self.endpoints

    def fetchone(self):
        if "source_access_rules" in self._last:
            return self.rule
        if "source_policy_decisions" in self._last:
            return self.decision
        return None


class FakeConn:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor

    def close(self):
        pass


def resolve(url, *, endpoint, decision, rule=None):
    cur = FakeCursor([endpoint], rule, decision)
    with patch.object(G, "get_db_connection", return_value=FakeConn(cur)):
        return G.resolve_trust_from_db(url), cur


def endpoint(trust_mode, host="pares.cultura.gob.es", status="active"):
    return {"id": 21, "host_pattern": host, "match_type": "exact", "status": status, "trust_mode": trust_mode}


def decision(outcome="approve", rights="mixed"):
    return {"id": 25, "decision_outcome": outcome, "trust_mode": "x", "rights_class": rights}


URL = "https://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/123928"


class ApprovalInForce(unittest.TestCase):
    def test_item_verified_approval_requires_item_verification(self):
        reg, _ = resolve(URL, endpoint=endpoint("item_verified"), decision=decision(),
                         rule={"verification_strategy": "pares_description"})
        self.assertEqual(reg["decision"], "requires_item_verification")
        self.assertEqual(reg["verification_strategy"], "pares_description")

    def test_domain_trusted_with_known_rights_is_allowed(self):
        for rights in ("public_domain", "creative_commons", "mixed"):
            reg, _ = resolve("https://ctext.org/x", endpoint=endpoint("domain_trusted", "ctext.org"),
                             decision=decision(rights=rights))
            self.assertEqual(reg["decision"], "allow", rights)

    def test_domain_trusted_with_unknown_rights_is_recorded_not_in_force(self):
        for rights in ("unknown", "in_copyright", None):
            reg, _ = resolve("https://www.dbnl.org/x", endpoint=endpoint("domain_trusted", "www.dbnl.org"),
                             decision=decision(rights=rights))
            self.assertEqual(reg["decision"], "deny", rights)
            self.assertIn("recorded, not in force", reg["reason"])

    def test_a_newest_decision_that_is_not_an_approval_denies(self):
        reg, _ = resolve(URL, endpoint=endpoint("item_verified"), decision=decision(outcome="reject"))
        self.assertEqual(reg["decision"], "deny")
        self.assertIn("no approval in force", reg["reason"])

    def test_an_endpoint_with_no_decision_at_all_denies(self):
        reg, _ = resolve(URL, endpoint=endpoint("item_verified"), decision=None)
        self.assertEqual(reg["decision"], "deny")

    def test_collection_trusted_and_link_only_are_not_honoured_by_host_alone(self):
        for mode in ("collection_trusted", "link_only", None):
            reg, _ = resolve("https://globalise.huygens.knaw.nl/x",
                             endpoint=endpoint(mode, "globalise.huygens.knaw.nl"), decision=decision())
            self.assertEqual(reg["decision"], "deny", mode)
            self.assertIn("not honoured by host alone", reg["reason"])

    def test_the_decision_read_is_newest_first_and_limited_to_one(self):
        _, cur = resolve(URL, endpoint=endpoint("item_verified"), decision=decision())
        query = next(q for q in cur.sql if "source_policy_decisions" in q)
        self.assertIn("ORDER BY timestamp DESC, id DESC LIMIT 1", query,
                      "an unordered fetchone() lets an arbitrary row of the endpoint's history speak")

    def test_an_inactive_endpoint_is_not_even_matched(self):
        # The endpoint query filters status = 'active' in SQL; a fake that
        # returns no rows models the database honouring it.
        cur = FakeCursor([], None, None)
        with patch.object(G, "get_db_connection", return_value=FakeConn(cur)):
            reg = G.resolve_trust_from_db(URL)
        self.assertFalse(reg["matched"])
        self.assertEqual(reg["decision"], "deny")
        self.assertIn("status = 'active'", cur.sql[0])


class HostilePatterns(unittest.TestCase):
    """The same rule as lib/source-governance.ts::isWellFormedPattern: a stored
    pattern that is not a well-formed hostname must never match by suffix."""

    def test_well_formed_patterns(self):
        self.assertTrue(G.is_well_formed_pattern("exact", "pares.cultura.gob.es"))
        self.assertTrue(G.is_well_formed_pattern("suffix", ".wikisource.org"))

    def test_malformed_patterns_are_inert(self):
        for kind, bad in [("suffix", "com"), ("suffix", ".com"), ("suffix", ""), ("suffix", "wikisource.org"),
                          ("suffix", ".org."), ("exact", "a@b.com"), ("exact", "x?y.com"), ("exact", "com"),
                          ("exact", ""), ("exact", "UPPER.com"), ("bogus", "a.example.org")]:
            self.assertFalse(G.is_well_formed_pattern(kind, bad), (kind, bad))

    def test_a_suffix_row_named_com_does_not_trust_evil_dot_com(self):
        hostile = {"id": 99, "host_pattern": "com", "match_type": "suffix", "status": "active", "trust_mode": "domain_trusted"}
        reg, _ = resolve("https://evil.com/x", endpoint=hostile, decision=decision(rights="public_domain"))
        self.assertFalse(reg["matched"])
        self.assertEqual(reg["decision"], "deny")

    def test_an_empty_suffix_row_does_not_trust_everything(self):
        hostile = {"id": 98, "host_pattern": "", "match_type": "suffix", "status": "active", "trust_mode": "domain_trusted"}
        reg, _ = resolve("https://anything.example/x", endpoint=hostile, decision=decision(rights="public_domain"))
        self.assertFalse(reg["matched"])


class ItemVerifiedRights(unittest.TestCase):
    def test_an_in_copyright_item_verified_approval_is_not_in_force(self):
        reg, _ = resolve(URL, endpoint=endpoint("item_verified"), decision=decision(rights="in_copyright"),
                         rule={"verification_strategy": "pares_description"})
        self.assertEqual(reg["decision"], "deny")
        self.assertIn("in_copyright", reg["reason"])

    def test_an_unknown_rights_item_verified_approval_still_verifies_per_item(self):
        reg, _ = resolve(URL, endpoint=endpoint("item_verified"), decision=decision(rights="unknown"),
                         rule={"verification_strategy": "pares_description"})
        self.assertEqual(reg["decision"], "requires_item_verification")


class StrategyDispatch(unittest.TestCase):
    def setUp(self):
        self.mode = os.environ.get("SOURCE_AUTHORITY_MODE")
        os.environ["SOURCE_AUTHORITY_MODE"] = "registry"

    def tearDown(self):
        if self.mode is None:
            os.environ.pop("SOURCE_AUTHORITY_MODE", None)
        else:
            os.environ["SOURCE_AUTHORITY_MODE"] = self.mode

    def test_archive_org_metadata_is_a_registered_strategy(self):
        self.assertIn("archive_org_metadata", whitelist._verification_strategies())

    @patch("source_governance_shadow.resolve_trust_from_db")
    def test_an_item_verified_host_whose_strategy_has_no_code_is_refused(self, mock_resolve):
        mock_resolve.return_value = {
            "matched": True, "decision": "requires_item_verification", "endpoint_id": 99,
            "host_pattern": "x.example", "trust_mode": "item_verified",
            "verification_strategy": "no_such_strategy", "rights_class": "mixed", "policy_decision_id": 1,
        }
        ok, why = whitelist.verify_source("https://x.example/record/1")
        self.assertFalse(ok)
        self.assertIn("unknown verification strategy", why)

    @patch("source_governance_shadow.resolve_trust_from_db")
    def test_a_denial_names_its_cause(self, mock_resolve):
        mock_resolve.return_value = {
            "matched": True, "decision": "deny", "endpoint_id": 11, "host_pattern": "www.dbnl.org",
            "trust_mode": "domain_trusted", "verification_strategy": "none", "rights_class": "unknown",
            "policy_decision_id": 12, "reason": "approved as domain_trusted but rights class is 'unknown': recorded, not in force",
        }
        ok, why = whitelist.verify_source("https://www.dbnl.org/tekst/x")
        self.assertFalse(ok)
        self.assertIn("recorded, not in force", why)


if __name__ == "__main__":
    unittest.main()
