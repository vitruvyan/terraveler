"""Carta §3.4 (v0.5): the one transformation a quotation may undergo.

    python3 -m unittest test_dehyphenation -v      (from ingest/)

Verbatim used to mean "identical to the bytes of whichever OCR we fetched".
On La Pérouse's 1799 edition that cost seven quotations out of sixteen: the
scan breaks words at the right margin, a scribe reading the page naturally
writes "anchored" where the file holds "an- chored", and the gate refused it.
The nine that survived did so because the scribe happened to copy the artefact.

So the clause now names one permitted transformation — rejoining a word divided
only by a line ending — applied identically to both sides of the comparison.
The tests that matter are the ones that fix its edges: this must not become a
licence to tidy text.

Loaded out of the source rather than imported, for the reason test_chronology
gives. The same functions are duplicated in scripts/curator.py and the last
test here checks the two copies have not drifted.
"""
import ast
import re
import unittest
from pathlib import Path

HERE = Path(__file__).parent
EXTRACT = HERE / "extract.py"
CURATOR = HERE.parent / "scripts" / "curator.py"
WANTED = {"LINE_BREAK_HYPHEN", "FLATTENED_HYPHEN", "rejoin_line_breaks"}


def _load(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    picked = [
        n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in WANTED)
        or (isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") in WANTED)
    ]
    names = {getattr(n, "name", None) or n.targets[0].id for n in picked}
    assert names == WANTED, f"{path.name} no longer defines {WANTED - names}"
    ns = {"re": re}
    exec(compile(ast.Module(body=picked, type_ignores=[]), "<src>", "exec"), ns)
    return ns["rejoin_line_breaks"]


rejoin = _load(EXTRACT)


class TheWoundTheMarginMakes(unittest.TestCase):
    def test_a_word_split_by_the_line_ending_is_made_whole(self):
        self.assertEqual(rejoin("an-\nchored"), "anchored")
        self.assertEqual(rejoin("an- chored"), "anchored")          # flattened OCR
        self.assertEqual(rejoin("with- out losing"), "without losing")

    def test_the_la_perouse_case_that_prompted_the_amendment(self):
        scan = ("and an- chored in the-creek of")
        self.assertIn("anchored", rejoin(scan))

    def test_a_soft_hyphen_and_a_unicode_hyphen_count_too(self):
        self.assertEqual(rejoin("an­\nchored"), "anchored")
        self.assertEqual(rejoin("an‐\nchored"), "anchored")


class WhatItMustNeverTouch(unittest.TestCase):
    """The clause permits one transformation. These prove it is only one."""

    def test_a_hyphen_inside_a_line_survives(self):
        for s in ("north-east", "man-of-war", "the-creek", "twenty-two"):
            self.assertEqual(rejoin(s), s)

    def test_a_hyphen_at_a_line_end_followed_by_a_capital_is_left_alone(self):
        # A proper noun starting the next line is far more likely a compound
        # ("Anglo- Saxon") than a divided word, so the flattened rule requires
        # lower case after the break. The newline rule is unambiguous and does
        # not need the restriction.
        self.assertEqual(rejoin("Anglo- Saxon"), "Anglo- Saxon")

    def test_it_does_not_touch_spelling_punctuation_or_case(self):
        s = "We ſailed on the 24th of November ; and, after a ſhort voyage,"
        self.assertEqual(rejoin(s), s)

    def test_a_dash_between_words_is_not_a_hyphen_in_a_word(self):
        self.assertEqual(rejoin("the sea - and the sky"), "the sea - and the sky")


class TheTwoCopiesMustAgree(unittest.TestCase):
    def test_the_curator_gate_uses_the_same_rule_as_the_pipeline(self):
        """A gate that re-checks the pipeline with a different rule than the
        pipeline used is not a gate. They are duplicated because curator.py must
        run without importing the ingestion package; this is the cost of that."""
        other = _load(CURATOR)
        cases = ["an-\nchored", "an- chored", "north-east", "Anglo- Saxon",
                 "with- out losing", "man-of-war", "the sea - and the sky"]
        for c in cases:
            self.assertEqual(rejoin(c), other(c), f"the two copies disagree on {c!r}")


if __name__ == "__main__":
    unittest.main()
