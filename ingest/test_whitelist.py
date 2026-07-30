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



class CanonicalLicence(unittest.TestCase):
    """The gate's answer is a sentence for a human; the corpus stores a label
    that gets filtered on. Conflating them made every archive.org source
    invisible to extract.py, which selects `license ILIKE 'public domain'`."""

    def test_the_archive_reason_becomes_a_filterable_label(self):
        self.assertEqual(W.canonical_license("Public domain (published 1924)"), "Public domain")
        self.assertEqual(W.canonical_license("Public domain (published 1872)"), "Public domain")

    def test_a_plain_label_is_left_alone(self):
        self.assertEqual(W.canonical_license("Public domain"), "Public domain")
        self.assertEqual(W.canonical_license("CC BY-SA 4.0"), "CC BY-SA 4.0")

    def test_a_creative_commons_url_is_not_stored_as_a_url(self):
        self.assertEqual(
            W.canonical_license("http://creativecommons.org/publicdomain/mark/1.0/"),
            "Public domain")

    def test_what_extract_py_filters_on_actually_matches(self):
        """extract.py: WHERE license ILIKE 'public domain'."""
        for reason in ["Public domain", "Public domain (published 1924)",
                       "public domain (published 1829)"]:
            self.assertEqual(W.canonical_license(reason).lower(), "public domain", reason)


class LanguageOfTheSources(unittest.TestCase):
    """Carta §4: sources may be in any language, only the published text is English.

    The wiki hosts were listed one at a time — en and fr Wikisource, en, fr and
    es Wikipedia — which quietly made that clause false. A Chinese, Japanese,
    German, Italian or Portuguese Wikisource text was refused as off-whitelist
    while the identical project in French was admitted, and the refusal fell
    hardest on the voyages whose records were never kept in English at all.
    """

    def test_wikisource_is_admitted_in_every_language(self):
        for lang in ("de", "it", "pt", "es", "zh", "ja", "ru", "nl", "la"):
            url = f"https://{lang}.wikisource.org/wiki/Anything"
            ok, lic = W.verify_source(url)
            self.assertTrue(ok, f"{lang}.wikisource.org refused: {lic}")
            self.assertEqual(lic, "Public domain")

    def test_wikipedia_and_commons_follow_the_same_rule(self):
        self.assertTrue(W.is_allowed("https://ja.wikipedia.org/wiki/X"))
        self.assertEqual(W.license_for("https://ja.wikipedia.org/wiki/X"), "CC BY-SA 4.0")
        self.assertTrue(W.is_allowed("https://upload.wikimedia.org/wikipedia/commons/6/62/P.jpg"))

    def test_a_suffix_rule_is_not_a_substring_rule(self):
        """The whole point of matching on '.wikisource.org' rather than on
        'wikisource.org' anywhere in the host: a lookalike must not pass."""
        for url in ("https://wikisource.org.attacker.example/x",
                    "https://evil-wikisource.org.attacker.example/x",
                    "https://notwikisource.org/x"):
            self.assertFalse(W.is_allowed(url), url)

    def test_an_exact_host_still_outranks_its_family(self):
        self.assertEqual(W.license_for("https://www.gutenberg.org/ebooks/1"), "Public domain")
        self.assertEqual(W.license_for("https://runeberg.org/nordisk/"), "Public domain")

    def test_off_whitelist_is_still_off_whitelist(self):
        ok, why = W.verify_source("https://example.com/a-book")
        self.assertFalse(ok)
        self.assertIn("off-whitelist", why)


if __name__ == "__main__":
    unittest.main()
