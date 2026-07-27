"""The language gate, pinned against the real excerpts that provoked it.

    python3 -m unittest test_language -v      (from ingest/)

Every French sample below is a genuine quotation Cartier's extraction produced:
verbatim, correctly verified against the source, and unpublishable under Carta
§4. Every English sample is a genuine one from the same run — the two languages
alternate page by page in Biggar's edition, so the gate has to separate them
without a chunk range, which cannot separate what alternates.
"""
import ast
import re
import unittest
from pathlib import Path

SRC = (Path(__file__).parent / "extract.py").read_text(encoding="utf-8")


def _load():
    tree = ast.parse(SRC)
    body = [n for n in tree.body
            if (isinstance(n, ast.FunctionDef) and n.name == "reads_as_english")
            or (isinstance(n, ast.Assign)
                and getattr(n.targets[0], "id", "") in {"_EN", "_FR"})]
    assert len(body) == 3, "extract.py no longer defines _EN, _FR and reads_as_english"
    ns = {"re": re}
    exec(compile(ast.Module(body=body, type_ignores=[]), "<extract>", "exec"), ns)
    return ns["reads_as_english"]


reads_as_english = _load()

FRENCH = [
    "gent se peult nonmer sauvaiger, car c'est la plus pouvre gence qu'il puisse estre",
    "et assise ladicte ville de Hochelaga, prés et joignant vne montaigne",
    "Nostre cappitaine, voyant la pitié et maladie ainsi esmue, fict mectre le",
    "et fymes courrir au surouaist quinze lieues, et vynmes trouver trois isles",
]

ENGLISH = [
    "that we reached the harbour of St. Malo whence we had set forth, on Saturday",
    "It is still called cape Bonavista and lies in latitude 48 degrees 42 minutes",
    "The Governor arrived at this town of Caxamalca on Friday, the 15th of "
    "November, 1532, at the hour of vespers.",
    "we only ate old biscuit reduced to powder, and full of grubs, and stinking "
    "from the dirt which the rats had made on it",
]


class LanguageGate(unittest.TestCase):
    def test_the_french_excerpts_cartier_actually_produced_are_refused(self):
        for t in FRENCH:
            self.assertFalse(reads_as_english(t), t[:60])

    def test_the_english_excerpts_from_the_same_run_are_kept(self):
        for t in ENGLISH:
            self.assertTrue(reads_as_english(t), t[:60])

    def test_english_carrying_french_place_names_is_kept(self):
        """The failure that would matter most: discarding a good quotation
        because the coast it describes is French."""
        for t in [
            "we came to the bay of Saint Lawrence, and from there to the river "
            "of Sainte Croix, which the people of the country call Hochelaga",
            "the Sieur de Roberval and the men of Saint-Malo were with us at "
            "Charlesbourg-Royal that winter, and the cold was very great",
        ]:
            self.assertTrue(reads_as_english(t), t[:60])

    def test_a_fragment_too_short_to_judge_is_kept(self):
        """A tie goes to keeping the quote: the cost of a wrong null is a stage
        that says it has no excerpt, and the atlas should not say that when it
        has one."""
        for t in ["Hochelaga", "", "48 42 27", None]:
            self.assertTrue(reads_as_english(t), repr(t))

    def test_it_judges_and_never_edits(self):
        t = FRENCH[0]
        before = t
        reads_as_english(t)
        self.assertEqual(t, before)


if __name__ == "__main__":
    unittest.main()
