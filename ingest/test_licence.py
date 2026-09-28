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

PAGE = "https://repo.example.org/item/42"
BY_SA_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
# The shape a repository emits for the record it serves.
BY_SA = f'<html><head><meta name="DC.rights" content="{BY_SA_URL}"></head><body>x</body></html>'


def meta(value, name="DC.rights"):
    return f'<head><meta name="{name}" content="{value}"></head>'


class ReadLicence(unittest.TestCase):
    def test_a_dublin_core_rights_url_is_read(self):
        r = L.read_licence(BY_SA)
        self.assertEqual((r["profile"], r["licence"], r["basis"]), ("open", "CC BY-SA", "page-metadata"))

    def test_the_open_licences_and_only_those(self):
        for href, label in [
            ("https://creativecommons.org/publicdomain/mark/1.0/", "Public domain"),
            ("https://creativecommons.org/publicdomain/zero/1.0/", "Public domain"),
            ("https://creativecommons.org/licenses/by/4.0/", "CC BY"),
            ("https://creativecommons.org/licenses/by-sa/3.0/", "CC BY-SA"),
        ]:
            r = L.read_licence(meta(href))
            self.assertEqual((r["profile"], r["licence"]), ("open", label), href)

    def test_the_closed_phrases_that_open_by_words(self):
        for text, label in [("Public domain", "Public domain"), ("public domain.", "Public domain"),
                            ("CC0 1.0", "Public domain"), ("CC0", "Public domain"),
                            ("Dominio público", "Public domain"), ("Domaine public", "Public domain"),
                            ("Publiek domein", "Public domain"), ("CC BY 4.0", "CC BY"), ("CC-BY", "CC BY"),
                            ("CC BY-SA 4.0", "CC BY-SA"), ("cc by sa", "CC BY-SA")]:
            self.assertEqual(L.read_licence(meta(text))["licence"], label, text)

    def test_nc_nd_and_reserved_rights_are_not_open(self):
        for href in [
            "https://creativecommons.org/licenses/by-nc/4.0/",
            "https://creativecommons.org/licenses/by-nc-sa/4.0/",
            "https://creativecommons.org/licenses/by-nd/4.0/",
            "https://creativecommons.org/licenses/by-nc-nd/4.0/",
            "http://rightsstatements.org/vocab/InC/1.0/",
            "http://rightsstatements.org/vocab/UND/1.0/",
            "http://rightsstatements.org/vocab/NoC-CR/1.0/",
            "http://rightsstatements.org/vocab/NoC-US/1.0/",     # public domain in the US ONLY
            "http://rightsstatements.org/vocab/NoC-OKLR/1.0/",   # other legal restrictions
            "https://example.org/some-unknown-licence",
        ]:
            self.assertEqual(L.read_licence(meta(href))["profile"], "quote-only", href)

    def test_json_ld_license_is_read_on_the_pages_own_item(self):
        by = "https://creativecommons.org/licenses/by/4.0/"
        for blob in [
            f'{{"@type":"Book","url":"{PAGE}","license":"{by}"}}',
            f'{{"@type":"Book","@id":"{PAGE}/","license":{{"@id":"{by}"}}}}',
            f'{{"@type":"WebPage","mainEntity":{{"@type":"Book","license":["{by}"]}}}}',
            f'{{"@graph":[{{"@type":"WebSite"}},{{"@type":"Book","url":"{PAGE}#x","license":"{by}"}}]}}',
        ]:
            r = L.read_licence(f'<script type="application/ld+json">{blob}</script>', PAGE)
            self.assertEqual(r["licence"], "CC BY", blob)

    def test_a_template_licence_link_is_not_a_statement_about_the_item(self):
        # WordPress/CMS plugins put this on EVERY page of the site.
        for html in [f'<head><link rel="license" href="{BY_SA_URL}"></head><body>copyrighted text</body>',
                     f'<head><meta name="license" content="{BY_SA_URL}"></head>',
                     f'<body><footer><a rel="license" href="{BY_SA_URL}">CC BY-SA</a></footer></body>']:
            self.assertIsNone(L.read_licence(html), html)

    def test_prose_alone_reads_as_nothing(self):
        self.assertIsNone(L.read_licence("<body>This text is in the public domain, we think.</body>"))

    def test_conflicting_signals_resolve_to_the_cautious_side(self):
        html = (f'<head><meta name="DC.rights" content="{BY_SA_URL}">'
                '<meta name="copyright" content="All rights reserved"></head>')
        self.assertEqual(L.read_licence(html)["profile"], "quote-only")
        # even a page-level (template) restriction vetoes an item-level open
        html = (f'<head><meta name="DC.rights" content="{BY_SA_URL}">'
                '<link rel="license" href="https://creativecommons.org/licenses/by-nc/4.0/"></head>')
        self.assertEqual(L.read_licence(html)["profile"], "quote-only")

    def test_broken_or_empty_input_never_raises(self):
        for bad in ["", None, "<<<<", "<link rel=license", '<script type="application/ld+json">{not json</script>',
                    "\x00\x01<meta name='rights'"]:
            L.read_licence(bad or "")


class Hostile(unittest.TestCase):
    """Each of these is a page a copyrighted item can really be served from, and
    each once read as "open". Every one must land on the quote-only side or on
    nothing at all — never on open."""

    def assertNotOpen(self, html, page=PAGE):
        r = L.read_licence(html, page)
        self.assertTrue(r is None or r["profile"] == "quote-only", (html[:120], r))
        self.assertEqual(L.decide_rights(html, page)["profile"], "quote-only")

    def test_negated_or_qualified_statements_are_never_open(self):
        for text in ["Este documento no es de dominio público", "This edition is not in the public domain",
                     "This work isn't in the public domain", "Cannot be considered public domain",
                     "Hors domaine public", "Geen publiek domein", "Nicht gemeinfrei: kein public domain",
                     "Nie jest w domenie publicznej. Public domain in the US", "Public domain in the United States",
                     "Public domain. Not for commercial reuse", "CC BY 4.0 (NC)",
                     "Gemeinfrei? Nein. Public domain status disputed", "n'est pas dans le domaine public"]:
            self.assertNotOpen(meta(text))

    def test_a_copyright_sign_or_a_statement_about_the_metadata_is_not_the_works_licence(self):
        for text in ["© Museo Naval 2020. Metadata CC0", "Metadata: CC0", "Catalogue data CC0 1.0",
                     "(c) 2020 Biblioteca — CC BY", "Copyright the library; CC BY-SA"]:
            self.assertNotOpen(meta(text))

    def test_dash_variants_of_nc_do_not_hide_the_clause(self):
        for dash in ["–", "—", "‑", "−"]:
            self.assertNotOpen(meta(f"CC BY{dash}NC 4.0"))
            self.assertNotOpen(meta(f"CC BY{dash}SA{dash}ND 4.0"))

    def test_reserved_rights_in_more_languages(self):
        for text in ["tutti i diritti riservati", "Alle Rechte vorbehalten", "todos os direitos reservados",
                     "Todos los derechos reservados", "Alle rechten voorbehouden", "Tous droits réservés"]:
            self.assertNotOpen(meta(text, "rights"))

    def test_the_licence_of_the_site_or_of_another_item_is_not_the_licence_of_this_one(self):
        by = "https://creativecommons.org/licenses/by/4.0/"
        zero = "https://creativecommons.org/publicdomain/zero/1.0/"
        for blob in [f'{{"@type":"WebSite","license":"{zero}"}}',
                     f'{{"@type":"Organization","license":"{by}"}}',
                     f'{{"license":"{by}"}}',
                     f'{{"@type":"WebPage","license":"{by}"}}',
                     # a generic site-level CreativeWork
                     f'{{"@type":"CreativeWork","name":"Site","license":"{zero}"}}',
                     # a list page of several items: their licences are not this page's
                     f'[{{"@type":"Book","url":"https://repo.example.org/item/1","license":"{by}"}},'
                     f'{{"@type":"Book","url":"https://repo.example.org/item/2","license":"{by}"}}]']:
            self.assertNotOpen(f'<script type="application/ld+json">{blob}</script>')

    def test_a_declaration_opens_nothing_however_the_page_echoes_it(self):
        for html in ['<footer>Our metadata is released under CC0.</footer>',
                     '<a href="/login?return=/item/1?x=public-domain">log in</a>',
                     '<body>This edition is not in the public domain.</body>',
                     '<!-- CC BY-SA 4.0 template --><body>text</body>']:
            self.assertEqual(L.decide_rights(html, PAGE)["profile"], "quote-only", html)

    def test_a_hostile_page_cannot_crash_or_stall_the_reader(self):
        import time
        for html in ['<script type="application/ld+json">' + "[" * 50000 + '</script>',
                     '<script type="application/ld+json">' + '{"a":' * 5000 + "1" + "}" * 5000 + '</script>']:
            self.assertEqual(L.decide_rights(html, PAGE)["profile"], "quote-only")
        t = time.monotonic()
        L.read_licence(meta("no " + "x " * 2_500_000))
        self.assertLess(time.monotonic() - t, 2.0, "a megabytes-long value must not run any pattern")


class DecideRights(unittest.TestCase):
    def test_metadata_wins_over_prose(self):
        html = meta("https://creativecommons.org/licenses/by-nc/4.0/") + "<body>public domain</body>"
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
        for text in ["ཀ་ཁ་ག", "ꀀꀁ", "\U00030000\U00030001\U00030002"]:      # Tibetan, Yi, CJK Ext. G
            self.assertGreaterEqual(L.word_count(text), 2, text)

    def test_the_whitespace_set_is_explicit_not_the_runtimes(self):
        self.assertEqual(L.word_count("a\x1fb\x85c"), 1, "control characters are not word breaks")
        self.assertEqual(L.word_count("a　b c d"), 4)

    def test_words_are_whitespace_separated_tokens_however_the_line_breaks_fall(self):
        self.assertEqual(L.word_count("a b\nc\t d  e"), 5)
        self.assertEqual(L.word_count(""), 0)
        self.assertEqual(L.word_count(None), 0)


if __name__ == "__main__":
    unittest.main()
