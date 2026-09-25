#!/usr/bin/env python3
"""The waypoint-enrichment merge logic, pinned without a database.

    python3 -m unittest test_publish_submission -v          (from scripts/)

Mirrors test_embed_published.py's approach: the functions under test here
(find_existing_match_index, merge_enrichment_waypoint,
new_enrichment_waypoint, apply_waypoint_enrichment, resolve_data_file) are
either pure or read-only against the checked-out repo, so none of this needs
Postgres or the git-writing half of main() (fetch_submission,
record_publication, run_embed) that scripts/test_publisher.py-style
database-backed tests would exist for instead.

What matters most here is the bug this suite exists to pin: submission #97
(Aotourou's own itinerary, grafted onto boudeuse-1766) numbers its own
waypoints 1..8, which collide by pure coincidence with the target bundle's
existing seq 1..15 while describing almost entirely different stops — seq 1
is Tahiti in the submission and Brest in the bundle. A matcher that trusted
seq equality would silently overwrite Brest with Tahiti. The one this module
ships trusts place + date instead, and an earlier version of it had its own
near-miss: "Paris, France" and "Saint-Malo, France" share nothing but a
country, and briefly matched on that alone until place_modern's trailing
region got stripped before tokenizing — TestPlaceMatching pins that fix too.
"""
from __future__ import annotations

import unittest
from pathlib import Path

import publish_submission as P


class DateBounds(unittest.TestCase):

    def test_a_full_date_is_its_own_lower_and_upper_bound(self):
        lo, hi = P._date_bounds("1768-04-06")
        self.assertEqual((str(lo), str(hi)), ("1768-04-06", "1768-04-06"))

    def test_month_only_spans_the_whole_month(self):
        lo, hi = P._date_bounds("1769-03")
        self.assertEqual((str(lo), str(hi)), ("1769-03-01", "1769-03-31"))

    def test_garbage_does_not_parse(self):
        self.assertIsNone(P._date_bounds("not a date"))
        self.assertIsNone(P._date_bounds(None))
        self.assertIsNone(P._date_bounds(""))


class DatesClose(unittest.TestCase):

    def test_within_the_existing_stay_matches(self):
        # boudeuse-1766 seq 6: arrived Tahiti 1768-04-06, sailed 1768-04-16.
        # Submission #97's own seq 1 places the Aotourou episode at
        # 1768-04-15 — inside that window, with room to spare.
        self.assertTrue(P._dates_close("1768-04-15", "1768-04-06", "1768-04-16"))

    def test_a_different_year_is_never_close(self):
        # boudeuse-1766 seq 13 (Isle de France, arrived 1768-11-08) versus
        # submission #97 seq 7 (also "Isle de France" historically, but
        # 1770-10-23) — same name, two years apart. This is the pairing that
        # would falsely merge Aotourou's 1770 return stop into the ship's own
        # 1768 layover if date alone were trusted without the place check,
        # or vice versa if place alone were trusted without this one.
        self.assertFalse(P._dates_close("1770-10-23", "1768-11-08", "1768-12-22"))

    def test_no_departure_still_gets_a_small_buffer(self):
        self.assertTrue(P._dates_close("1769-03-18", "1769-03-16", None))
        self.assertFalse(P._dates_close("1769-04-01", "1769-03-16", None))

    def test_unparseable_dates_never_match(self):
        self.assertFalse(P._dates_close(None, "1768-04-06", "1768-04-16"))
        self.assertFalse(P._dates_close("1768-04-15", None, None))


class PlaceMatching(unittest.TestCase):

    def test_shared_city_overlaps(self):
        self.assertTrue(P._modern_tokens("Jakarta, Indonesia") & P._modern_tokens("Jakarta, Indonesia"))

    def test_shared_country_alone_does_not_overlap(self):
        # The bug this test pins: two different French waypoints must not
        # match on "France" alone once the trailing region is stripped.
        self.assertFalse(P._modern_tokens("Paris, France") & P._modern_tokens("Saint-Malo, France"))

    def test_historical_names_are_not_region_stripped(self):
        # place_historical has no "<place>, <region>" convention (free-form
        # names like "Isle de France"), so it is tokenized whole.
        self.assertTrue(P._historical_tokens("Isle de France") & P._historical_tokens("Isle de France"))

    def test_generic_geography_words_are_stopped_but_a_shared_proper_name_is_not(self):
        # "Port" alone is filtered — but "Louis" is a specific enough token
        # to survive, so "Port Louis" (Falklands) and "Port-Louis"
        # (Mauritius) DO share a token on place alone. This is exactly why
        # find_existing_match_index requires place AND date to agree: see
        # DatesClose.test_a_different_year_is_never_close, which is what
        # actually keeps these two apart in boudeuse-1766 (Falklands 1767 vs
        # Mauritius 1770) — not the place heuristic by itself.
        self.assertTrue(P._historical_tokens("Port Louis") & P._historical_tokens("Port-Louis"))
        self.assertNotIn("port", P._historical_tokens("Port Louis"))


BOUDEUSE = [
    {"id": 101, "seq": 1, "place_historical": "Brest (departure from Nantes)",
     "place_modern": "Brest, France", "arrival_date": "1766-11-21", "departure_date": "1766-12-05",
     "event": "Start of the expedition.", "diary_excerpt": "The 5th at noon we got under sail.",
     "diary_source_citation": "Bougainville (1772)", "diary_source_url": "https://example/1",
     "confidence": "certain"},
    {"id": 106, "seq": 6, "place_historical": "Taïti (New Cythera / Nouvelle-Cythère)",
     "place_modern": "Tahiti, French Polynesia", "arrival_date": "1768-04-06",
     "departure_date": "1768-04-16",
     "event": "Bougainville claimed the island for France.",
     "diary_excerpt": "I thought I was transported into the garden of Eden.",
     "diary_source_citation": "Bougainville (1772)", "diary_source_url": "https://example/2",
     "confidence": "certain"},
    {"id": 115, "seq": 15, "place_historical": "St. Maloes", "place_modern": "Saint-Malo, France",
     "arrival_date": "1769-03-16", "departure_date": None,
     "event": "Bougainville brought the Boudeuse home to Saint-Malo.",
     "diary_excerpt": "I entered it on the 16th in the afternoon.",
     "diary_source_citation": "Bougainville (1772)", "diary_source_url": "https://example/3",
     "confidence": "certain"},
]

BUNDLE = {"navigator": {"name": "Bougainville"},
          "voyage": {"slug": "boudeuse-1766", "title": "Test"},
          "waypoints": [dict(w) for w in BOUDEUSE]}

SUBMISSION_97_LIKE = {
    "waypoints": [
        {"seq": 1, "place_historical": "Taiti (Hitia'a)", "place_modern": "Hitia'a, Tahiti, French Polynesia",
         "arrival_date": "1768-04-15", "confidence": "certain",
         "claims": [{"text": "Ereti asked that Aotourou be allowed to sail with the French.",
                     "evidence": {"quote": "...", "source_title": "Bougainville (1772)",
                                  "source_url": "https://example/2"}}],
         "plates": [{"url": "https://example/plate1.jpg", "caption": "A plate"}]},
        {"seq": 4, "place_historical": "St. Maloes", "place_modern": "Saint-Malo, France",
         "arrival_date": "1769-03-16", "confidence": "certain",
         "claims": [{"text": "Aotourou arrived at Saint-Malo on 16 March 1769.",
                     "evidence": {"quote": "...", "source_title": "Wikipedia",
                                  "source_url": "https://example/wiki"}}]},
        # Paris: same month-ish as seq15's arrival but a different city —
        # must NOT merge into St. Maloes (the bug PlaceMatching pins).
        {"seq": 5, "place_historical": "Paris", "place_modern": "Paris, France",
         "arrival_date": "1769-03", "confidence": "certain",
         "claims": [{"text": "Bougainville spared no expense for Aotourou's stay in Paris.",
                     "evidence": {}}]},
        # Madagascar: nowhere in the bundle at all — must append as new.
        {"seq": 8, "place_historical": "Fort Dauphin", "place_modern": "Tolanaro (Fort Dauphin), Madagascar",
         "arrival_date": "1771-11-06", "confidence": "certain",
         "claims": [{"text": "Aotourou died of smallpox at Fort Dauphin.", "evidence": {}}]},
    ]
}


class FindExistingMatchIndex(unittest.TestCase):

    def test_matches_the_right_existing_waypoint_despite_colliding_seq(self):
        # Submission seq 1 ("Tahiti") must match bundle seq 6 ("Tahiti"),
        # never bundle seq 1 ("Brest") even though both are numbered 1.
        sub = SUBMISSION_97_LIKE["waypoints"][0]
        idx = P.find_existing_match_index(sub, BOUDEUSE)
        self.assertEqual(BOUDEUSE[idx]["seq"], 6)

    def test_exact_place_and_date_match(self):
        sub = SUBMISSION_97_LIKE["waypoints"][1]  # Saint-Malo, seq 4
        idx = P.find_existing_match_index(sub, BOUDEUSE)
        self.assertEqual(BOUDEUSE[idx]["seq"], 15)

    def test_paris_does_not_match_saint_malo(self):
        sub = SUBMISSION_97_LIKE["waypoints"][2]  # Paris
        self.assertIsNone(P.find_existing_match_index(sub, BOUDEUSE))

    def test_a_place_absent_from_the_bundle_matches_nothing(self):
        sub = SUBMISSION_97_LIKE["waypoints"][3]  # Fort Dauphin, Madagascar
        self.assertIsNone(P.find_existing_match_index(sub, BOUDEUSE))

    def test_a_shared_place_token_three_years_apart_still_does_not_match(self):
        # "Port Louis" (Falklands) shares a token with "Port-Louis"
        # (Mauritius) — see PlaceMatching above — so the date check is the
        # only thing standing between this and a false merge.
        falklands = [{"seq": 3, "place_historical": "Isles Malouines (Falkland Islands), Port Louis",
                      "place_modern": "Falkland Islands (Port Louis, East Falkland)",
                      "arrival_date": "1767-03-23", "departure_date": "1767-06-02"}]
        sub = {"seq": 7, "place_historical": "Isle de France",
               "place_modern": "Port-Louis, Mauritius", "arrival_date": "1770-10-23"}
        self.assertIsNone(P.find_existing_match_index(sub, falklands))


class MergeEnrichmentWaypoint(unittest.TestCase):

    def test_new_claim_text_is_appended_not_replacing_the_existing_event(self):
        existing = dict(BOUDEUSE[1])  # Tahiti, seq 6
        sub = SUBMISSION_97_LIKE["waypoints"][0]
        notes = []
        out = P.merge_enrichment_waypoint(existing, sub, spans={}, notes=notes)
        self.assertIn("Bougainville claimed the island for France.", out["event"])
        self.assertIn("Ereti asked", out["event"])

    def test_an_existing_diary_excerpt_is_never_overwritten(self):
        existing = dict(BOUDEUSE[1])
        original_excerpt = existing["diary_excerpt"]
        sub = SUBMISSION_97_LIKE["waypoints"][0]
        # A verified span WOULD be available here...
        spans = {"1.1": {"reading_span": "A brand new quotation.", "source_url": "https://example/x"}}
        notes = []
        out = P.merge_enrichment_waypoint(existing, sub, spans, notes)
        # ...but the waypoint already has one, so it is left untouched.
        self.assertEqual(out["diary_excerpt"], original_excerpt)
        self.assertTrue(any("already carries a diary_excerpt" in n for n in notes))

    def test_plates_are_added_to_media_deduped_by_url(self):
        existing = dict(BOUDEUSE[1])
        sub = SUBMISSION_97_LIKE["waypoints"][0]
        notes = []
        out = P.merge_enrichment_waypoint(existing, sub, spans={}, notes=notes)
        self.assertEqual(len(out["media"]), 1)
        self.assertEqual(out["media"][0]["url"], "https://example/plate1.jpg")
        # Re-merging the same plate must not duplicate it.
        out2 = P.merge_enrichment_waypoint(out, sub, spans={}, notes=notes)
        self.assertEqual(len(out2["media"]), 1)

    def test_empty_fields_are_filled_but_populated_ones_are_never_clobbered(self):
        existing = {"seq": 20, "place_historical": None, "place_modern": "Somewhere",
                    "arrival_date": "1700-01-01", "date_note": None, "latitude": None,
                    "longitude": None, "event": None, "diary_excerpt": None,
                    "diary_source_citation": None, "diary_source_url": None}
        sub = {"seq": 20, "place_historical": "New Name", "place_modern": "Elsewhere",
               "arrival_date": "1701-01-01", "date_note": "a note", "latitude": 1.0,
               "longitude": 2.0, "claims": []}
        out = P.merge_enrichment_waypoint(existing, sub, spans={}, notes=[])
        self.assertEqual(out["place_historical"], "New Name")  # filled: was empty
        self.assertEqual(out["place_modern"], "Somewhere")     # kept: was populated
        self.assertEqual(out["date_note"], "a note")


class NewEnrichmentWaypoint(unittest.TestCase):

    def test_uses_only_the_first_claim_like_to_bundle_does_for_new_voyage(self):
        sub = {"seq": 8, "place_historical": "Fort Dauphin", "place_modern": "Madagascar",
               "arrival_date": "1771-11-06", "confidence": "certain",
               "claims": [{"text": "First claim.", "evidence": {"source_title": "S"}},
                          {"text": "Second claim, never used.", "evidence": {}}]}
        wp = P.new_enrichment_waypoint(sub, spans={}, seq=16, wp_id=116)
        self.assertEqual(wp["seq"], 16)
        self.assertEqual(wp["id"], 116)
        self.assertEqual(wp["event"], "First claim.")
        self.assertIsNone(wp["diary_excerpt"])  # no verified span supplied

    def test_a_verified_span_becomes_the_excerpt_never_the_typed_quote(self):
        sub = {"seq": 8, "claims": [{"text": "x", "evidence": {"quote": "typed by the contributor"}}]}
        spans = {"8.1": {"reading_span": "the actual source text", "raw_span": "raw"}}
        wp = P.new_enrichment_waypoint(sub, spans, seq=16, wp_id=116)
        self.assertEqual(wp["diary_excerpt"], "the actual source text")
        self.assertNotEqual(wp["diary_excerpt"], "typed by the contributor")


class ApplyWaypointEnrichment(unittest.TestCase):

    def test_full_submission_97_shape_matches_appends_and_never_touches_unrelated_waypoints(self):
        bundle = {"navigator": {}, "voyage": {"slug": "boudeuse-1766"},
                  "waypoints": [dict(w) for w in BOUDEUSE]}
        new_bundle, notes, matches = P.apply_waypoint_enrichment(bundle, SUBMISSION_97_LIKE, spans={})
        by_seq = {w["seq"]: w for w in new_bundle["waypoints"]}

        # seq 1 (Brest) is wholly unrelated to submission seq 1 (Tahiti) and
        # must be untouched.
        self.assertEqual(by_seq[1]["event"], "Start of the expedition.")

        # Tahiti (bundle seq 6) picked up the new claim.
        self.assertIn("Ereti asked", by_seq[6]["event"])

        # Saint-Malo (bundle seq 15) picked up its matching claim.
        self.assertIn("16 March 1769", by_seq[15]["event"])

        # Paris and Fort Dauphin matched nothing and were appended with
        # fresh, bundle-scoped seq/id continuing after the existing max (15).
        appended = [w for w in new_bundle["waypoints"] if w["seq"] not in (1, 6, 15)]
        self.assertEqual({w["seq"] for w in appended}, {16, 17})
        self.assertEqual({w["place_historical"] for w in appended}, {"Paris", "Fort Dauphin"})

        # is_new flags line up with what actually got appended vs merged.
        new_flags = {sub["seq"]: is_new for sub, _, is_new in matches}
        self.assertEqual(new_flags, {1: False, 4: False, 5: True, 8: True})

    def test_existing_waypoints_are_never_reordered_or_renumbered(self):
        bundle = {"navigator": {}, "voyage": {"slug": "boudeuse-1766"},
                  "waypoints": [dict(w) for w in BOUDEUSE]}
        new_bundle, _, _ = P.apply_waypoint_enrichment(bundle, SUBMISSION_97_LIKE, spans={})
        original_seqs_and_ids = [(w["seq"], w["id"]) for w in BOUDEUSE]
        kept = [(w["seq"], w["id"]) for w in new_bundle["waypoints"] if w["seq"] in (1, 6, 15)]
        self.assertEqual(kept, original_seqs_and_ids)


class ResolveDataFile(unittest.TestCase):
    """Read-only against the checked-out repo — no writes, just the mapping."""

    def test_boudeuse_resolves_to_bougainville_json_despite_the_name_mismatch(self):
        path = P.resolve_data_file("boudeuse-1766")
        self.assertEqual(path.name, "bougainville.json")
        self.assertTrue(path.exists())

    def test_a_slug_lib_data_ts_and_every_data_file_agree_is_not_needed(self):
        path = P.resolve_data_file("cortes-1519")
        self.assertEqual(path.name, "cortes.json")

    def test_an_unknown_slug_refuses_rather_than_guessing(self):
        with self.assertRaises(SystemExit):
            P.resolve_data_file("no-such-voyage-slug-anywhere")


if __name__ == "__main__":
    unittest.main()
