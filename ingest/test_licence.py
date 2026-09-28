"""Reading a licence off an item, and the default profile when there is none.

    python3 -m unittest test_licence -v          (from ingest/)

No network. What matters here is the direction of the errors. A wrong "open" is
the dangerous one — a long quotation from a copyrighted text — so every doubtful
signal must land on the quote-only side, and only a narrow, machine-readable
statement about THIS item may open anything.
"""
import os
import sys
import unittest

sys.path.append(os.path.dirname(__file__))
import licence as L

BY_SA = '<html><head><link rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/"></head><body>x</body></html>'


class ReadLicence(unittest.TestCase):
    def test_link_rel_license_is_read(self):
        r = L.read_licence(BY_SA)
        self.assertEqual((r["profile"], r["licence"], r["basis"]), ("open", "CC BY-SA", "page-metadata"))

    def test_the_open_licences_and_only_those(self):
        for href, label in [
            ("https://creativecommons.org/publicdomain/mark/1.0/", "Public domain"),
            ("https://creativecommons.org/publicdomain/zero/1.0/", "Public domain"),
            ("https://creativecommons.org/licenses/by/4.0/", "CC BY"),
            ("https://creativecommons.org/licenses/by-sa/3.0/", "CC BY-SA"),
            ("http://rightsstatements.org/vocab/NoC-US/1.0/", "Public domain"),
        ]:
            r = L.read_licence(f'<head><link rel="license" href="{href}"></head>')
            self.assertEqual((r["profile"], r["licence"]), ("open", label), href)

    def test_nc_nd_and_reserved_rights_are_not_open(self):
        for href in [
            "https://creativecommons.org/licenses/by-nc/4.0/",
            "https://creativecommons.org/licenses/by-nc-sa/4.0/",
            "https://creativecommons.org/licenses/by-nd/4.0/",
            "https://creativecommons.org/licenses/by-nc-nd/4.0/",
            "http://rightsstatements.org/vocab/InC/1.0/",
            "http://rightsstatements.org/vocab/UND/1.0/",
            "http://rightsstatements.org/vocab/NoC-CR/1.0/",
        ]:
            r = L.read_licence(f'<head><link rel="license" href="{href}"></head>')
            self.assertEqual(r["profile"], "quote-only", href)

    def test_meta_rights_tags_are_read_as_url_or_words(self):
        r = L.read_licence('<head><meta name="DC.rights" content="https://creativecommons.org/publicdomain/mark/1.0/"></head>')
        self.assertEqual(r["profile"], "open")
        r = L.read_licence('<head><meta name="dcterms.license" content="CC0 1.0"></head>')
        self.assertEqual(r["licence"], "Public domain")
        r = L.read_licence('<head><meta name="rights" content="© 1960 Publisher. All rights reserved."></head>')
        self.assertEqual(r["profile"], "quote-only")

    def test_json_ld_license_is_read_including_nested_and_object_forms(self):
        for blob in [
            '{"@type":"Book","license":"https://creativecommons.org/licenses/by/4.0/"}',
            '{"@graph":[{"@type":"WebSite"},{"@type":"Book","license":{"@id":"https://creativecommons.org/licenses/by/4.0/"}}]}',
            '{"@type":"Book","license":["https://creativecommons.org/licenses/by/4.0/"]}',
        ]:
            r = L.read_licence(f'<script type="application/ld+json">{blob}</script>')
            self.assertEqual(r["licence"], "CC BY", blob)

    def test_a_body_footer_anchor_is_NOT_a_statement_about_the_item(self):
        # The classic false positive: a site footer's licence covers the site.
        html = '<body><footer><a rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA</a></footer></body>'
        self.assertIsNone(L.read_licence(html))

    def test_prose_alone_reads_as_nothing(self):
        self.assertIsNone(L.read_licence("<body>This text is in the public domain, we think.</body>"))

    def test_conflicting_signals_resolve_to_the_cautious_side(self):
        html = ('<head><link rel="license" href="https://creativecommons.org/licenses/by/4.0/">'
                '<meta name="copyright" content="All rights reserved"></head>')
        self.assertEqual(L.read_licence(html)["profile"], "quote-only")

    def test_broken_or_empty_input_never_raises(self):
        for bad in ["", None, "<<<<", "<link rel=license", '<script type="application/ld+json">{not json</script>',
                    "\x00\x01<meta name='rights'"]:
            L.read_licence(bad or "")


class DeclaredLicence(unittest.TestCase):
    def test_a_declaration_is_confirmed_only_by_the_page_carrying_it(self):
        ok = L.confirm_declared("<body>Licence: CC BY-SA 4.0</body>", "CC BY-SA 4.0")
        self.assertEqual((ok["profile"], ok["licence"]), ("open", "CC BY-SA"))
        self.assertIn("declared by the contributor", ok["basis"])
        self.assertIsNone(L.confirm_declared("<body>nothing about licences</body>", "CC BY-SA 4.0"))

    def test_the_url_form_confirms_too(self):
        html = '<body><a href="https://creativecommons.org/licenses/by/4.0/legalcode">terms</a></body>'
        self.assertEqual(L.confirm_declared(html, "CC BY 4.0")["licence"], "CC BY")

    def test_a_declaration_of_by_does_not_match_a_page_that_says_by_sa_or_nc(self):
        self.assertIsNone(L.confirm_declared("<body>CC BY-NC 4.0</body>", "CC BY 4.0"))

    def test_nc_nd_and_prose_declarations_name_nothing(self):
        for declared in ["CC BY-NC 4.0", "CC BY-ND", "non-commercial use", "free to use", "all rights reserved", "", None]:
            self.assertIsNone(L.confirm_declared("<body>CC BY-NC 4.0 free to use</body>", declared), declared)

    def test_public_domain_is_confirmed_in_several_languages(self):
        for text in ["public domain", "dominio público", "domaine public", "publiek domein", "CC0 1.0"]:
            self.assertEqual(L.confirm_declared(f"<body>{text}</body>", "public domain")["licence"], "Public domain", text)


class DecideRights(unittest.TestCase):
    def test_metadata_wins_over_a_declaration(self):
        html = '<head><link rel="license" href="https://creativecommons.org/licenses/by-nc/4.0/"></head><body>public domain</body>'
        self.assertEqual(L.decide_rights(html, "public domain")["profile"], "quote-only")

    def test_order_is_metadata_then_confirmed_declaration_then_default(self):
        self.assertEqual(L.decide_rights(BY_SA, None)["basis"], "page-metadata")
        self.assertIn("declared", L.decide_rights("<body>CC BY 4.0</body>", "CC BY 4.0")["basis"])
        d = L.decide_rights("<body>nothing</body>", "CC BY 4.0")
        self.assertEqual(d["profile"], "quote-only")
        self.assertIn("default profile", d["basis"])

    def test_it_always_returns_a_profile_and_never_blocks(self):
        for html, declared in [(None, None), ("", ""), ("<body>", "x"), (BY_SA * 3, "public domain")]:
            self.assertIn(L.decide_rights(html, declared)["profile"], ("open", "quote-only"))


class Cap(unittest.TestCase):
    def test_the_cap_is_eighty_words(self):
        self.assertEqual(L.QUOTE_WORD_CAP, 80)

    def test_only_the_default_profile_is_capped(self):
        qo = {"profile": "quote-only"}
        self.assertFalse(L.over_cap(qo, " ".join(["w"] * 80)))
        self.assertTrue(L.over_cap(qo, " ".join(["w"] * 81)))
        self.assertFalse(L.over_cap({"profile": "open"}, " ".join(["w"] * 5000)))

    def test_words_are_whitespace_separated_tokens_however_the_line_breaks_fall(self):
        self.assertEqual(L.word_count("a b\nc\t d  e"), 5)
        self.assertEqual(L.word_count(""), 0)
        self.assertEqual(L.word_count(None), 0)


if __name__ == "__main__":
    unittest.main()
