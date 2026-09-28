"""PARES: the shape of a citable record, its verification, and its TLS.

    python3 -m unittest test_pares -v          (from ingest/)

No network. Runs against a real record saved verbatim
(test/fixtures/pares/123928.html — PATRONATO,128,R.2, the merits and services
of Jerónimo de Aliaga, Puna, Tumbes and the founding of San Miguel).
"""
import hashlib
import json
import os
import ssl
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.append(os.path.dirname(__file__))
import fetch as F
import pares
import tls
import whitelist

ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / "test" / "fixtures" / "pares" / "123928.html").read_text(encoding="utf-8")
URL = "https://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/123928"


class CitableUrl(unittest.TestCase):
    def test_a_record_url_is_citable(self):
        self.assertTrue(pares.is_description_url(URL))
        self.assertTrue(pares.is_description_url(URL + "/"))
        self.assertTrue(pares.is_description_url("https://pares.cultura.gob.es:443/ParesBusquedas20/catalogo/description/1"))

    def test_nothing_else_on_the_host_is_a_citable_item(self):
        for bad in [
            "https://pares.cultura.gob.es/ParesBusquedas20/catalogo/search",          # the search page
            "https://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/",     # no id
            "https://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/12a",
            "https://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/1/../../x",
            "https://pares.cultura.gob.es/other/path",
            "http://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/1",      # not https
            "https://pares.cultura.gob.es:8443/ParesBusquedas20/catalogo/description/1",
            "https://user:pw@pares.cultura.gob.es/ParesBusquedas20/catalogo/description/1",
            "https://pares.cultura.gob.es.evil.example/ParesBusquedas20/catalogo/description/1",
            "https://evilpares.cultura.gob.es/ParesBusquedas20/catalogo/description/1",
            "https://pares.cultura.gob.es@evil.example/ParesBusquedas20/catalogo/description/1",
            "", "not a url",
        ]:
            self.assertFalse(pares.is_description_url(bad), bad)


class RecordText(unittest.TestCase):
    def setUp(self):
        self.text = pares.record_text(HTML)

    def test_keeps_the_archival_description(self):
        self.assertIn("PATRONATO,128,R.2", self.text)
        self.assertIn("ES.41091.AGI/6.6.4.12.45//PATRONATO,128,R.2", self.text)
        self.assertIn("Información de los méritos y servicios de Jerónimo de Aliaga", self.text)
        self.assertIn("Archivo General de Indias", self.text)

    def test_drops_the_site_chrome(self):
        self.assertNotIn("Contacte con PARES", self.text)
        self.assertNotIn("Buscador HTR", self.text)
        self.assertNotIn("Aviso Legal", self.text)

    def test_keeps_the_reuse_terms_it_is_admitted_under(self):
        self.assertIn("pueden reproducirse y utilizarse sin permiso previo", self.text)


class Verification(unittest.TestCase):
    def test_a_genuine_record_is_admitted_with_an_honest_licence_label(self):
        ok, why = pares.verify_pares_item(URL, fetch_html=lambda u: HTML)
        self.assertTrue(ok)
        self.assertIn("descriptive record", why)
        self.assertIn("not the document's images", why)

    def test_a_non_record_url_is_refused_without_fetching_anything(self):
        called = []
        ok, why = pares.verify_pares_item("https://pares.cultura.gob.es/ParesBusquedas20/catalogo/search",
                                          fetch_html=lambda u: called.append(u) or HTML)
        self.assertFalse(ok)
        self.assertEqual(called, [])
        self.assertIn("not a PARES record URL", why)

    def test_a_page_that_is_not_a_description_is_refused(self):
        ok, why = pares.verify_pares_item(URL, fetch_html=lambda u: "<html><body>Please log in</body></html>")
        self.assertFalse(ok)
        self.assertIn("not a PARES description", why)

    def test_a_record_that_does_not_state_the_reuse_terms_is_refused(self):
        stripped = HTML.replace("pueden reproducirse y utilizarse sin permiso previo", "…")
        ok, why = pares.verify_pares_item(URL, fetch_html=lambda u: stripped)
        self.assertFalse(ok)
        self.assertIn("reuse terms", why)

    def test_an_unreachable_record_is_refused_with_the_reason(self):
        def boom(u):
            raise ConnectionError("timed out")
        ok, why = pares.verify_pares_item(URL, fetch_html=boom)
        self.assertFalse(ok)
        self.assertIn("unreachable", why)
        self.assertIn("timed out", why)


class RegistryIntegration(unittest.TestCase):
    """The strategy is reachable from the Curator's gate: an item_verified PARES
    approval, in registry mode, admits a genuine record and only that."""

    def setUp(self):
        self.mode = os.environ.get("SOURCE_AUTHORITY_MODE")
        os.environ["SOURCE_AUTHORITY_MODE"] = "registry"

    def tearDown(self):
        if self.mode is None:
            os.environ.pop("SOURCE_AUTHORITY_MODE", None)
        else:
            os.environ["SOURCE_AUTHORITY_MODE"] = self.mode

    REG = {"matched": True, "decision": "requires_item_verification", "endpoint_id": 21,
           "host_pattern": "pares.cultura.gob.es", "trust_mode": "item_verified",
           "verification_strategy": "pares_description", "rights_class": "mixed", "policy_decision_id": 25}

    def test_the_strategy_is_registered(self):
        self.assertIn("pares_description", whitelist._verification_strategies())

    @patch("source_governance_shadow.resolve_trust_from_db")
    def test_a_genuine_record_passes_the_curators_licence_gate(self, mock_resolve):
        mock_resolve.return_value = dict(self.REG)
        with patch.object(pares, "fetch_record_html", return_value=HTML):
            ok, why = whitelist.verify_source(URL)
        self.assertTrue(ok, why)
        self.assertIn("descriptive record", why)

    @patch("source_governance_shadow.resolve_trust_from_db")
    def test_the_search_page_of_the_same_approved_host_does_not(self, mock_resolve):
        mock_resolve.return_value = dict(self.REG)
        ok, why = whitelist.verify_source("https://pares.cultura.gob.es/ParesBusquedas20/catalogo/search")
        self.assertFalse(ok)
        self.assertIn("not a PARES record URL", why)


class FetchKind(unittest.TestCase):
    def test_kind_pares_returns_the_record_text(self):
        with patch.object(pares, "fetch_record_html", return_value=HTML):
            text = F.fetch_by_kind({"kind": "pares", "url": URL})
        self.assertIn("Información de los méritos y servicios", text)
        self.assertNotIn("Contacte con PARES", text)

    def test_an_unknown_kind_still_raises_rather_than_falling_back(self):
        with self.assertRaises(ValueError):
            F.fetch_by_kind({"kind": "pares_typo", "url": URL})


class Tls(unittest.TestCase):
    def test_pares_gets_a_verifying_context_that_trusts_its_listed_intermediate(self):
        ctx = tls.context_for(URL)
        self.assertIsInstance(ctx, ssl.SSLContext)
        self.assertEqual(ctx.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(ctx.check_hostname)

    def test_every_other_host_gets_the_default_context_unchanged(self):
        for u in ["https://example.com/", "https://archive.org/details/x", "https://www.gutenberg.org/x",
                  "https://pares.cultura.gob.es.evil.example/x"]:
            self.assertIsNone(tls.context_for(u), u)

    def test_the_listed_certificate_is_the_one_its_fingerprint_says_and_is_unexpired(self):
        entry = json.loads((ROOT / "vocab" / "tls_intermediates.json").read_text(encoding="utf-8"))["hosts"]["pares.cultura.gob.es"]
        der = ssl.PEM_cert_to_DER_cert(entry["pem"])
        got = ":".join(f"{b:02X}" for b in hashlib.sha256(der).digest())
        self.assertEqual(got, entry["sha256_fingerprint"])
        import datetime
        self.assertGreater(datetime.date.fromisoformat(entry["not_after"]), datetime.date.today(),
                           "the intermediate has expired — refresh vocab/tls_intermediates.json")


if __name__ == "__main__":
    unittest.main()
