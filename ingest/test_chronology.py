"""The chronology guard, pinned against the cases that produced it.

    python3 -m unittest test_chronology -v      (from ingest/)

extract.py imports psycopg2 and axis, neither of which needs to be installed to
test a pure function over dictionaries, so the two functions are read out of the
source rather than imported. That is uglier than an import and it keeps the
check testable on any machine, which matters more: this guard exists because a
defect shipped that nobody could see.
"""
import ast
import re
import unittest
from pathlib import Path

SRC = (Path(__file__).parent / "extract.py").read_text(encoding="utf-8")


def _load():
    tree = ast.parse(SRC)
    wanted = {"_year_of", "chronology_breaks"}
    picked = [n for n in tree.body
              if isinstance(n, ast.FunctionDef) and n.name in wanted]
    assert {n.name for n in picked} == wanted, "extract.py no longer defines both"
    ns = {"re": re}
    exec(compile(ast.Module(body=picked, type_ignores=[]), "<extract>", "exec"), ns)
    return ns["chronology_breaks"], ns["_year_of"]


chronology_breaks, year_of = _load()


def wp(seq, place, date):
    return {"seq": seq, "place_historical": place, "arrival_date": date}


class Chronology(unittest.TestCase):
    def test_a_voyage_that_runs_forwards_is_clean(self):
        self.assertEqual(chronology_breaks([
            wp(1, "Plymouth", "1831-12-27"),
            wp(2, "Bahia", "1832-02"),
            wp(3, "Rio de Janeiro", "1832-04-04"),
        ]), [])

    def test_the_falklands_case_is_caught(self):
        """Berkeley Sound, dated 1833, sitting after an 1834 stage — the real
        defect that shipped with Darwin."""
        breaks = chronology_breaks([
            wp(12, "Santa Cruz", "1834-04-13"),
            wp(13, "Berkeley Sound", "1833-03-01"),
        ])
        self.assertEqual(len(breaks), 1)
        where, why = breaks[0]
        self.assertIn("Berkeley Sound", where)
        self.assertIn("1833", why)
        self.assertIn("1834", why)
        self.assertIn("CHRONOLOGY", why)

    def test_the_bahia_case_is_caught(self):
        """An outbound stop carrying the return visit's date, which throws the
        stage after it backwards."""
        breaks = chronology_breaks([
            wp(4, "Fernando Noronha", "1832-02-20"),
            wp(5, "Bahia", "1836-08-01"),
            wp(6, "Rio de Janeiro", "1832-04-04"),
        ])
        self.assertEqual(len(breaks), 1)
        self.assertIn("Rio de Janeiro", breaks[0][0])

    def test_undated_stages_are_skipped_rather_than_guessed(self):
        """A stage with no date is not evidence of anything, and treating a
        missing date as a break would flag every sparse voyage."""
        self.assertEqual(chronology_breaks([
            wp(1, "A", "1834-01"),
            wp(2, "B", None),
            wp(3, "C", "1835-01"),
        ]), [])

    def test_same_year_is_not_a_break(self):
        """Comparison is by year on purpose: the planner is confident about
        order and vague about days, so a day-level check would flag noise the
        desk cannot act on."""
        self.assertEqual(chronology_breaks([
            wp(1, "A", "1834-11-02"),
            wp(2, "B", "1834-03-15"),
        ]), [])

    def test_every_break_is_reported_not_only_the_first(self):
        breaks = chronology_breaks([
            wp(1, "A", "1835"), wp(2, "B", "1832"),
            wp(3, "C", "1836"), wp(4, "D", "1833"),
        ])
        self.assertEqual(len(breaks), 2)

    def test_it_reports_and_never_repairs(self):
        """Which of two real visits a stage means is an editorial question. A
        script that picked one would be inventing the answer."""
        wps = [wp(1, "A", "1834"), wp(2, "B", "1833")]
        before = [dict(w) for w in wps]
        chronology_breaks(wps)
        self.assertEqual(wps, before)

    def test_year_parsing_handles_the_shapes_the_pipeline_emits(self):
        for value, expected in [("1834-04-13", 1834), ("1832-08", 1832),
                                ("1836", 1836), (None, None), ("", None),
                                ("n.d.", None)]:
            self.assertEqual(year_of(value), expected, repr(value))


if __name__ == "__main__":
    unittest.main()
