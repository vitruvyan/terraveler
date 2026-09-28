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
            # public domain in the US only / other legal restrictions: not publishable here
            "http://rightsstatements.org/vocab/NoC-US/1.0/",
            "http://rightsstatements.org/vocab/NoC-OKLR/1.0/",
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


class Hostile(unittest.TestCase):
    """Each of these is a page a copyrighted item can really be served from, and
    each once read as "open". Every one must land on the quote-only side or on
    nothing at all — never on open."""

    def assertNotOpen(self, html):
        r = L.read_licence(html)
        self.assertTrue(r is None or r["profile"] == "quote-only", (html, r))
        self.assertEqual(L.decide_rights(html)["profile"], "quote-only")

    def test_negated_statements(self):
        for text in ["Este documento no es de dominio público", "This edition is not in the public domain",
                     "Nicht gemeinfrei: kein public domain", "n'est pas dans le domaine public"]:
            self.assertNotOpen(f'<head><meta name="rights" content="{text}"></head>')

    def test_a_copyright_sign_or_a_statement_about_the_metadata_is_not_the_works_licence(self):
        for text in ["© Museo Naval 2020. Metadata CC0", "Metadata: CC0", "Catalogue data CC0 1.0",
                     "(c) 2020 Biblioteca — CC BY", "Copyright the library; CC BY-SA"]:
            self.assertNotOpen(f'<head><meta name="dc.rights" content="{text}"></head>')

    def test_dash_variants_of_nc_do_not_hide_the_clause(self):
        for dash in ["\u2013", "\u2014", "\u2011", "\u2212"]:
            self.assertNotOpen(f'<head><meta name="license" content="CC BY{dash}NC 4.0"></head>')
            self.assertNotOpen(f'<head><meta name="license" content="CC BY{dash}SA{dash}ND 4.0"></head>')

    def test_reserved_rights_in_more_languages(self):
        for text in ["tutti i diritti riservati", "Alle Rechte vorbehalten", "todos os direitos reservados",
                     "Todos los derechos reservados", "Alle rechten voorbehouden", "Tous droits réservés"]:
            self.assertNotOpen(f'<head><meta name="rights" content="{text}"></head>')

    def test_the_licence_of_the_site_node_is_not_the_licence_of_the_item(self):
        for blob in ['{"@type":"WebSite","license":"https://creativecommons.org/publicdomain/zero/1.0/"}',
                     '{"@type":"Organization","license":"https://creativecommons.org/licenses/by/4.0/"}',
                     '{"license":"https://creativecommons.org/licenses/by/4.0/"}',
                     '{"@type":"WebPage","license":"https://creativecommons.org/licenses/by/4.0/"}']:
            self.assertNotOpen(f'<script type="application/ld+json">{blob}</script>')

    def test_a_licence_on_a_creative_work_node_still_reads(self):
        self.assertEqual(L.read_licence('<script type="application/ld+json">'
                                        '{"@type":["Thing","Manuscript"],"license":"https://creativecommons.org/licenses/by/4.0/"}'
                                        '</script>')["licence"], "CC BY")

    def test_a_declaration_opens_nothing_however_the_page_echoes_it(self):
        # decide_rights takes no declaration at all: the page's own machine
        # statement is the only way in. These are the texts that used to
        # "confirm" one: a footer, an echoed URL, a negation, a comment.
        for html in ['<footer>Our metadata is released under CC0.</footer>',
                     '<a href="/login?return=/item/1?x=public-domain">log in</a>',
                     '<body>This edition is not in the public domain.</body>',
                     '<!-- CC BY-SA 4.0 template --><body>text</body>']:
            self.assertEqual(L.decide_rights(html)["profile"], "quote-only", html)

    def test_a_hostile_page_cannot_crash_the_reader(self):
        for html in ['<script type="application/ld+json">' + "[" * 50000 + '</script>',
                     '<script type="application/ld+json">' + '{"a":' * 5000 + "1" + "}" * 5000 + '</script>']:
            self.assertEqual(L.decide_rights(html)["profile"], "quote-only")


class DecideRights(unittest.TestCase):
    def test_metadata_wins_over_prose(self):
        html = '<head><link rel="license" href="https://creativecommons.org/licenses/by-nc/4.0/"></head><body>public domain</body>'
        self.assertEqual(L.decide_rights(html)["profile"], "quote-only")

    def test_order_is_metadata_then_default(self):
        self.assertEqual(L.decide_rights(BY_SA)["basis"], "page-metadata")
        d = L.decide_rights("<body>nothing</body>")
        self.assertEqual(d["profile"], "quote-only")
        self.assertIn("default profile", d["basis"])

    def test_it_always_returns_a_profile_and_never_blocks(self):
        for html in [None, "", "<body>", BY_SA * 3]:
            self.assertIn(L.decide_rights(html)["profile"], ("open", "quote-only"))


class Cap(unittest.TestCase):
    def test_the_cap_is_eighty_words(self):
        self.assertEqual(L.QUOTE_WORD_CAP, 80)

    def test_only_the_default_profile_is_capped(self):
        qo = {"profile": "quote-only"}
        self.assertFalse(L.over_cap(qo, " ".join(["w"] * 80)))
        self.assertTrue(L.over_cap(qo, " ".join(["w"] * 81)))
        self.assertFalse(L.over_cap({"profile": "open"}, " ".join(["w"] * 5000)))

    def test_a_total_cap_stops_many_brief_quotations_adding_up(self):
        self.assertEqual(L.QUOTE_TOTAL_CAP, 240)

    def test_unspaced_scripts_count_each_character(self):
        # A page of Chinese has no spaces: it must not be "one word".
        self.assertEqual(L.word_count("天下大势" * 25), 100)
        self.assertTrue(L.over_cap({"profile": "quote-only"}, "天" * 81))
        self.assertEqual(L.word_count("ประวัติศาสตร์"), 13)
        self.assertEqual(L.word_count("Cook 航海 log"), 4)

    def test_words_are_whitespace_separated_tokens_however_the_line_breaks_fall(self):
        self.assertEqual(L.word_count("a b\nc\t d  e"), 5)
        self.assertEqual(L.word_count(""), 0)
        self.assertEqual(L.word_count(None), 0)


if __name__ == "__main__":
    unittest.main()
