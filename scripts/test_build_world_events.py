#!/usr/bin/env python3
"""merge_scoped_catalogue / merge_scoped_inputs, pinned.

    python3 -m unittest test_build_world_events -v          (from scripts/)

No network, no cache: these are the two pure functions that make
`--voyage` safe. Before they existed, a --voyage run overwrote
data/historical-events.json and data/world-events-voyages.json wholesale
with only what it harvested — discovered live, publishing submission #102,
when a --voyage run wiped every other voyage's world-events coverage. This
pins the fix so it cannot regress quietly.
"""
import unittest

from build_world_events import merge_scoped_catalogue, merge_scoped_inputs


def event(id_, date):
    return {"id": id_, "date": date}


class MergeScopedCatalogue(unittest.TestCase):
    def test_keeps_events_outside_the_harvested_years(self):
        existing = [event("wev:a", "1487-01-01"), event("wev:b", "1524-06-01")]
        harvested = [event("wev:c", "1524-07-01")]
        merged = merge_scoped_catalogue(existing, harvested, harvested_years={"1524"})
        ids = {e["id"] for e in merged}
        self.assertEqual(ids, {"wev:a", "wev:c"})

    def test_a_harvest_that_finds_nothing_still_retires_stale_events_in_scope(self):
        # An event that used to be kept for a harvested year but no longer
        # ranks must not survive just because this run found nothing to
        # replace it with — the whole point is that harvested years are
        # fully replaced by what this run found, even if that is empty.
        existing = [event("wev:a", "1524-01-01")]
        merged = merge_scoped_catalogue(existing, [], harvested_years={"1524"})
        self.assertEqual(merged, [])

    def test_sorted_by_date_then_id(self):
        existing = [event("wev:z", "1524-01-02")]
        harvested = [event("wev:a", "1524-01-01")]
        merged = merge_scoped_catalogue([], existing + harvested, harvested_years=set())
        self.assertEqual([e["id"] for e in merged], ["wev:a", "wev:z"])

    def test_negative_years_are_not_truncated(self):
        # date_year("-1300...") must read as "-1300", not "-130" — this is
        # exactly the bug date_year's own docstring says str[:4] would cause.
        existing = [event("wev:old", "-1300-01-01")]
        merged = merge_scoped_catalogue(existing, [], harvested_years={"-1300"})
        self.assertEqual(merged, [])
        merged = merge_scoped_catalogue(existing, [], harvested_years={"-130"})
        self.assertEqual(merged, existing)


class MergeScopedInputs(unittest.TestCase):
    def test_only_the_harvested_slug_changes(self):
        existing = {"gama-1497": {"start_year": 1497}, "dias-1487": {"start_year": 1487}}
        harvested = {"gama-1497": {"start_year": 1497, "updated": True}}
        merged = merge_scoped_inputs(existing, harvested)
        self.assertEqual(merged["dias-1487"], {"start_year": 1487})
        self.assertEqual(merged["gama-1497"], {"start_year": 1497, "updated": True})

    def test_a_new_slug_is_added_without_touching_the_rest(self):
        existing = {"dias-1487": {"start_year": 1487}}
        harvested = {"verrazzano-1524": {"start_year": 1524}}
        merged = merge_scoped_inputs(existing, harvested)
        self.assertEqual(set(merged.keys()), {"dias-1487", "verrazzano-1524"})


if __name__ == "__main__":
    unittest.main()
