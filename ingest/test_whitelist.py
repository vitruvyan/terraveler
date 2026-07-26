"""The licence gate, pinned against the editions that actually fooled us.

    python3 -m unittest test_whitelist -v      (from ingest/)

Metadata is stubbed, so this runs offline and cannot go green because
archive.org happened to be reachable. Every fixture below is the real,
observed metadata of a real item.
"""
import unittest

import whitelist as W


def stub(**meta):
    """A fake archive.org metadata endpoint returning one item's fields."""
    return lambda _url: {"metadata": meta}


class LicenceGate(unittest.TestCase):
    # -------------------------------------------------- what must get through
    def test_institutional_scan_of_a_pre_cutoff_edition_is_allowed(self):
        ok, lic = W.verify_source(
            "https://archive.org/download/reportsondiscove00markrich/x_djvu.txt",
            fetch_json=stub(identifier="reportsondiscove00markrich", date="1872",
                            collection=["cdl", "americana"],
                            publisher="London : Printed for the Hakluyt Society"))
        self.assertTrue(ok, lic)
        self.assertIn("1872", lic)

    def test_domain_guaranteed_hosts_need_no_item_lookup(self):
        ok, lic = W.verify_source("https://www.gutenberg.org/cache/epub/74723/pg74723.txt")
        self.assertTrue(ok)
        self.assertEqual(lic, "Public domain")

    # ------------------------------------------------------ the three real traps
    def test_lending_restricted_item_is_refused(self):
        """Columbus's Diario: Univ. of Oklahoma Press 1989, lending only."""
        ok, why = W.verify_source(
            "https://archive.org/details/diarioofchristop00colu",
            fetch_json=stub(identifier="diarioofchristop00colu", date="1989",
                            **{"access-restricted-item": "true"}))
        self.assertFalse(ok)
        self.assertIn("access-restricted-item", why)

    def test_modern_reprint_of_an_old_translation_is_refused(self):
        """Lee's 1829 Ibn Battuta, reprinted by Cambridge UP in 2012. The
        reprint's clock is the one that counts."""
        ok, why = W.verify_source(
            "https://archive.org/details/travelsofibnbatu0000unse",
            fetch_json=stub(identifier="travelsofibnbatu0000unse", date="2012",
                            publisher="Cambridge : Cambridge University Press",
                            collection=["internetarchivebooks", "printdisabled"]))
        self.assertFalse(ok)
        self.assertIn("2012", why)

    def test_self_declared_licence_on_a_user_upload_is_not_evidence(self):
        """Gibb's Ibn Battuta (Hakluyt Society, 1958-1994, in copyright) sits in
        `community` under a self-applied public-domain mark, dated 1354. Both
        the licence and the date are the uploader's assertion."""
        ok, why = W.verify_source(
            "https://archive.org/details/travels-of-ibn-battuta",
            fetch_json=stub(identifier="travels-of-ibn-battuta", date="1354-06-30",
                            licenseurl="http://creativecommons.org/publicdomain/mark/1.0/",
                            collection=["opensource", "community"]))
        self.assertFalse(ok)
        self.assertIn("self-declared", why)

    # ------------------------------------------------------------ other refusals
    def test_work_date_is_not_a_publication_date(self):
        ok, why = W.verify_source(
            "https://archive.org/details/somethingancient",
            fetch_json=stub(identifier="somethingancient", date="1354",
                            collection=["americana"]))
        self.assertFalse(ok)
        self.assertIn("predates printing", why)

    def test_missing_date_cannot_establish_public_domain(self):
        ok, why = W.verify_source(
            "https://archive.org/details/undated",
            fetch_json=stub(identifier="undated", collection=["americana"]))
        self.assertFalse(ok)
        self.assertIn("no publication date", why)

    def test_unreachable_metadata_refuses_rather_than_assumes(self):
        def boom(_url):
            raise OSError("connection reset")
        ok, why = W.verify_source("https://archive.org/details/x", fetch_json=boom)
        self.assertFalse(ok)
        self.assertIn("safe side", why)

    def test_off_whitelist_domain_is_refused(self):
        ok, why = W.verify_source("https://example.com/book.txt")
        self.assertFalse(ok)
        self.assertIn("off-whitelist", why)

    def test_archive_org_is_not_domain_trusted(self):
        """The whole point: knowing the host is archive.org proves nothing."""
        self.assertFalse(W.is_allowed("https://archive.org/details/anything"))

    # ------------------------------------------------------------- identifiers
    def test_identifier_is_read_from_every_url_shape_we_use(self):
        for path, want in [
            ("details/abc", "abc"),
            ("download/abc/abc_djvu.txt", "abc"),
            ("stream/abc/abc_djvu.txt", "abc"),
            ("metadata/abc", "abc"),
        ]:
            self.assertEqual(W.archive_identifier(f"https://archive.org/{path}"), want, path)
        self.assertIsNone(W.archive_identifier("https://archive.org/"))


if __name__ == "__main__":
    unittest.main()
