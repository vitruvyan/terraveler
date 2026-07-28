"""Carta §3.4: what a quotation may be, and what gets published.

    python3 -m unittest test_verbatim -v      (from ingest/)

Every case below except the last class was demonstrated by an external Scribe
attacking the v0.5 clause. It was right: the matcher had always folded case,
unified dashes and quotation marks, decomposed ligatures and collapsed
whitespace, and the QUOTER's text was what got stored — so "the voyage began."
could be published where the page printed "The Voyage began.", and
`verbatim_exact: true` was asserted over it.

The clause was not the defect. Publishing the quoter's text was. So the span is
now copied out of the source and matching may be as generous as it likes:
nothing a scribe types can reach the atlas.

This file imports the module rather than reading functions out of a source
file, which the earlier version had to do because the logic lived inside
extract.py next to psycopg2. That is also why the Curator's copy drifted four
Carta versions behind — there is one copy now.
"""
import unittest

from verbatim import (UnverifiableSource, locate_in_source, norm,
                      source_text)


def published(quote, source):
    return locate_in_source(quote, source)[1]


class WhatGetsPublishedIsTheSources(unittest.TestCase):
    """The adversarial table, every row. The quotation is altered; the atlas
    prints the page."""

    def test_capitalisation_cannot_be_lowered_by_a_quoter(self):
        self.assertEqual(published("the voyage began.", "The Voyage began."),
                         "The Voyage began.")

    def test_an_em_dash_is_not_flattened_to_a_hyphen(self):
        self.assertEqual(published("north-east", "north—east"), "north—east")

    def test_a_ligature_survives(self):
        self.assertEqual(published("the first voyage", "the ﬁrst voyage"),
                         "the ﬁrst voyage")

    def test_curly_quotes_survive(self):
        self.assertEqual(published("we 'sailed' at dawn", "we ‘sailed’ at dawn"),
                         "we ‘sailed’ at dawn")

    def test_all_of_them_at_once(self):
        self.assertEqual(published("the voyage-began", "The Voyage—began"),
                         "The Voyage—began")


class TheOnePermittedTransformation(unittest.TestCase):
    def test_the_la_perouse_case(self):
        src = "and an-\nchored in the creek of"
        self.assertEqual(published("and anchored in the creek of", src),
                         "and anchored in the creek of")

    def test_a_hyphen_the_printer_meant_keeps_its_hyphen(self):
        # A capital on either side is the signal that the hyphen is lexical.
        self.assertEqual(published("an Xray plate", "an X-\nray plate"), "an X-ray plate")
        self.assertEqual(published("AngloSaxon manners", "Anglo-\nSaxon manners"),
                         "Anglo-Saxon manners")
        # and the line ending goes, because "X- ray" is on no page either
        _, _, t = locate_in_source("an Xray plate", "an X-\nray plate")
        self.assertEqual(t, ["line-break-closed"])

    def test_a_hyphen_with_no_line_ending_is_not_a_margin(self):
        """A space is not a margin. This rejoined "ice- bound" into "icebound"
        until an adversarial probe pointed out that nothing had said the line
        ended there — and La Pérouse's 1799 corpus holds 1,811 hyphens at a
        line ending against 67 followed only by spaces, so the guess bought
        almost nothing and cost real words."""
        self.assertEqual(published("icebound", "ice- bound"), "ice- bound")

    def test_a_quotation_that_copies_the_page_correctly_still_matches(self):
        # Matching ignores hyphenation entirely, so a scribe is not punished
        # for transcribing the hyphen — nor for omitting it.
        self.assertEqual(published("an X-ray plate", "an X-\nray plate"), "an X-ray plate")

    def test_whitespace_the_source_has_is_whitespace_the_atlas_keeps(self):
        """_for_reading treated every isspace() as typographic damage, so it
        deleted paragraph boundaries, form feeds and double spaces — none of
        which Carta 3.4 licenses."""
        self.assertEqual(published("End paragraph. Next paragraph.",
                                   "End paragraph.\n\nNext paragraph."),
                         "End paragraph.\n\nNext paragraph.")
        self.assertEqual(published("word word", "word  word"), "word  word")

    def test_a_gap_wider_than_one_line_keeps_its_hyphen(self):
        """A paragraph break does not divide a word; a page break does, and in
        an OCR they are the same characters. So the match is allowed and the
        hyphen survives into print, which is right either way.

        Refusing the match cost a real quotation from La Pérouse's vol. II —
        "to en-\n\n\ntreat", broken across a page with a running head in the
        gap — and reported it as "fabricated or altered"."""
        self.assertEqual(published("international", "inter-\n\nnational"),
                         "inter-\n\nnational")
        self.assertEqual(published("to entreat us", "to en-\n\n\ntreat us"),
                         "to en-\n\ntreat us")

    def test_the_known_limit_is_a_limit_and_not_a_secret(self):
        """"north-\\neast" and "anchor-\\ned" are indistinguishable without the
        page's geometry. This rejoins. Pinned so the behaviour is a decision on
        the record rather than a surprise."""
        self.assertEqual(published("northeast by east", "north-\neast by east"),
                         "northeast by east")


class TheGateStillHolds(unittest.TestCase):
    def test_a_quotation_not_in_the_source_is_refused(self):
        self.assertIsNone(published("we marched at dawn", "we sailed at dawn"))

    def test_a_near_miss_is_refused(self):
        self.assertIsNone(published("we sailed at noon", "we sailed at dawn"))

    def test_an_empty_quotation_is_refused(self):
        self.assertIsNone(published("", "we sailed at dawn"))
        self.assertIsNone(published("   \n  ", "we sailed at dawn"))

    def test_transformations_name_what_actually_happened(self):
        _, _, t = locate_in_source("we sailed at dawn", "we sailed at dawn")
        self.assertEqual(t, [], "nothing was done, so nothing is claimed")
        _, _, t = locate_in_source("and anchored", "and an-\nchored")
        self.assertEqual(t, ["line-break-rejoin"])
        _, _, t = locate_in_source("a b", "a\nb")
        self.assertEqual(t, ["line-wrap-to-space"])

    def test_a_match_may_not_begin_inside_a_word(self):
        """`hay.find` had no boundaries, so "the" matched inside "other" and
        returned a span citing something the source does not say."""
        self.assertIsNone(published("the", "other"))
        self.assertIsNone(published("the voyage", "lathe\f voyage"))

    def test_the_raw_span_is_kept_beside_the_readable_one(self):
        raw, reading, _ = locate_in_source("and anchored in the creek",
                                           "xx and an-\nchored in the creek yy")
        self.assertEqual(raw, "and an-\nchored in the creek")
        self.assertEqual(reading, "and anchored in the creek")


class Matching(unittest.TestCase):
    def test_norm_is_only_for_finding_never_for_printing(self):
        self.assertEqual(norm("The  Voyage—began"), norm("the voyage-began"))


class SourceText(unittest.TestCase):
    """A gate that mistakes a book for a web page accuses people of forgery."""

    def test_a_stray_angle_bracket_in_plain_text_destroys_nothing(self):
        # An OCR'd 1929 volume held eight of these. Stripping "tags" from it
        # deleted 318,658 characters, and four genuine quotations were then
        # reported as "fabricated or altered".
        book = ("I entered Damascus on Thursday 9th Ramadan 726 "
                "< and lodged at the Malikite college, "
                "and the price was 3 < 4 dinars, and we stayed.")
        self.assertEqual(source_text(book, "text/plain"), book)
        self.assertEqual(source_text(book, ""), book,
                         "no Content-Type means no assumption")

    def test_html_is_refused_rather_than_half_parsed(self):
        """Five bypasses were demonstrated against the regex stripper in a
        row — an unclosed <script>, a <template>, a hidden element, a crafted
        comment, a quoted attribute — each putting text a reader cannot see
        into the verifiable body. A regex cannot parse HTML, so it no longer
        pretends to."""
        for page in ("<script>QUOTE", "<template>QUOTE</template>",
                     "<p hidden>QUOTE</p>", "<!-- > QUOTE -->",
                     '<div data-x=">QUOTE">visible</div>'):
            with self.assertRaises(UnverifiableSource):
                source_text(page, "text/html; charset=utf-8")

    def test_a_quotation_survives_a_source_with_brackets_in_it(self):
        book = "we sailed at dawn < and the wind held all day"
        self.assertEqual(
            locate_in_source("the wind held all day", source_text(book, "text/plain"))[1],
            "the wind held all day")


if __name__ == "__main__":
    unittest.main()
