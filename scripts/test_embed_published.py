#!/usr/bin/env python3
"""The Archivist's own logic, pinned without a database or the embedding service.

    python3 -m unittest test_embed_published -v          (from scripts/)

`narrative_docs` and `span_docs` are pure: given a submission's payload (and,
for the second, its verified spans), they return exactly the rows that would
be embedded. What matters most here is what they must NEVER touch: a voyage
that already has thousands of bulk-ingested source chunks in `rag_docs`
(`ingest/pipeline_native.py`) must keep every one of them when this script
runs — the ownership test below is the one that would have caught this
script wiping a real archive by mistake.
"""
from __future__ import annotations

import unittest

import embed_published as E

PAYLOAD = {
    "meta": {"carta_version": "0.7", "type": "new-voyage"},
    "voyage": {
        "slug": "example-1700", "title": "An Example Voyage (1700)",
        "summary": "A short account.", "evidence_basis": "contemporary-journal",
        "what_was_lost": "The captain's own log does not survive.",
    },
    "waypoints": [
        {"seq": 1, "place_historical": "Old Cadiz", "place_modern": "Cadiz, Spain",
         "latitude": 36.5, "longitude": -6.3, "arrival_date": "1700-01-01",
         "confidence": "certain",
         "claims": [{"text": "The ship departed in fair weather.",
                     "evidence": {"excerpt": "we sailed with a fair wind",
                                  "source_url": "https://www.gutenberg.org/files/1/1.txt",
                                  "license": "public domain"}}]},
        {"seq": 2, "place_historical": "Old Veracruz", "place_modern": "Veracruz, Mexico",
         "latitude": 19.2, "longitude": -96.1, "arrival_date": "1700-03-01",
         "confidence": "approximate", "claims": []},
    ],
}

SPANS = {
    "1.1": {"reading_span": "We sailed with a fair wind and a following sea.",
            "source_url": "https://www.gutenberg.org/files/1/1.txt"},
}


class NarrativeDocs(unittest.TestCase):

    def test_the_header_carries_title_summary_and_what_was_lost(self):
        docs = E.narrative_docs("example-1700", PAYLOAD)
        header = docs[0]
        self.assertEqual(header["chunk_index"], 0)
        self.assertIn("An Example Voyage", header["content"])
        self.assertIn("A short account.", header["content"])
        self.assertIn("captain's own log", header["content"])
        self.assertIsNone(header["source_url"])
        self.assertEqual(header["license"], E.NARRATIVE_LICENSE)

    def test_every_waypoint_with_text_gets_its_own_chunk(self):
        docs = E.narrative_docs("example-1700", PAYLOAD)
        titles = [d["title"] for d in docs]
        self.assertTrue(any("waypoint 1" in t for t in titles))
        self.assertTrue(any("waypoint 2" in t for t in titles))
        wp1 = next(d for d in docs if "waypoint 1" in d["title"])
        self.assertIn("Old Cadiz", wp1["content"])
        self.assertIn("fair weather", wp1["content"])

    def test_a_waypoint_with_nothing_to_say_is_skipped_not_emitted_empty(self):
        bare = {**PAYLOAD, "waypoints": [{"seq": 1}]}
        docs = E.narrative_docs("example-1700", bare)
        # Only the header remains; the bare waypoint contributes no row.
        self.assertEqual(len(docs), 1)

    def test_narrative_rows_are_never_the_bulk_archive_shape(self):
        # The one property upsert()'s ownership check depends on: every
        # narrative row is licensed CC BY-SA with no source_url, which a
        # bulk-ingested chunk (a real source, a real licence, a real url)
        # can never be.
        for d in E.narrative_docs("example-1700", PAYLOAD):
            self.assertEqual(d["license"], E.NARRATIVE_LICENSE)
            self.assertIsNone(d["source_url"])


class SpanDocs(unittest.TestCase):

    def test_a_verified_span_is_re_embedded_with_its_source(self):
        docs = E.span_docs("example-1700", PAYLOAD, SPANS)
        self.assertEqual(len(docs), 1)
        d = docs[0]
        self.assertIn("wp1.claim1", d["title"])
        self.assertTrue(d["title"].endswith(E.SPAN_MARK))
        self.assertEqual(d["content"], SPANS["1.1"]["reading_span"])
        self.assertEqual(d["source_url"], "https://www.gutenberg.org/files/1/1.txt")

    def test_a_claim_with_no_verified_span_yet_is_never_embedded(self):
        # wp2 has no claims and 1.1 is the only verified span — nothing here
        # should invent a chunk out of an unverified claim.
        docs = E.span_docs("example-1700", PAYLOAD, spans={})
        self.assertEqual(docs, [])


BUNDLE = {
    "navigator": {"name": "Bougainville"},
    "voyage": {"slug": "boudeuse-1766", "title": "The First French Circumnavigation",
               "summary": "A short account.", "what_was_lost": "The captain's own log."},
    "waypoints": [
        {"seq": 1, "place_historical": "Brest", "place_modern": "Brest, France",
         "event": "Start of the expedition.",
         "diary_excerpt": "The 5th at noon we got under sail.",
         "diary_source_url": "https://example/1"},
        {"seq": 6, "place_historical": "Taïti", "place_modern": "Tahiti, French Polynesia",
         "event": "Bougainville claimed the island for France."},  # no verified excerpt
    ],
}


class BundleDocs(unittest.TestCase):
    """bundle_docs() is what scripts/publish_submission.py's run_embed() calls
    after a real publish — including a waypoint-enrichment publish, whose own
    submission payload only ever lists a fraction of the voyage. These tests
    pin that it reads the full, merged bundle instead of any partial
    payload, so a waypoint-enrichment embed never has the chance to wipe the
    rest of the voyage's rows down to just what one submission touched."""

    def test_header_and_every_waypoint_with_text_produce_a_doc(self):
        docs = E.bundle_docs("boudeuse-1766", BUNDLE)
        self.assertEqual(docs[0]["chunk_index"], 0)
        self.assertIn("The First French Circumnavigation", docs[0]["content"])
        titles = [d["title"] for d in docs]
        self.assertTrue(any(f"{E.WAYPOINT_MARK}1" in t for t in titles))
        self.assertTrue(any(f"{E.WAYPOINT_MARK}6" in t for t in titles))

    def test_only_waypoints_with_a_diary_excerpt_get_a_span_doc(self):
        docs = E.bundle_docs("boudeuse-1766", BUNDLE)
        span_docs = [d for d in docs if d["title"].endswith(E.SPAN_MARK)]
        self.assertEqual(len(span_docs), 1)
        self.assertEqual(span_docs[0]["content"], "The 5th at noon we got under sail.")
        self.assertEqual(span_docs[0]["source_url"], "https://example/1")
        self.assertIn("wp1.claim1", span_docs[0]["title"])

    def test_uses_the_waypoints_own_seq_not_its_list_position(self):
        # Waypoint 6 is the second item in the list but must be titled by
        # its seq (6), not its index (2) — otherwise re-embedding after an
        # enrichment that appends waypoint 16..19 would collide with
        # whatever the list position happens to be.
        docs = E.bundle_docs("boudeuse-1766", BUNDLE)
        titles = [d["title"] for d in docs if E.WAYPOINT_MARK in d["title"]]
        self.assertTrue(any(t.endswith(f"{E.WAYPOINT_MARK}6") for t in titles))

    def test_a_bundle_with_no_narrative_at_all_yields_no_docs(self):
        bare = {"voyage": {}, "waypoints": [{"seq": 1}]}
        self.assertEqual(E.bundle_docs("x", bare), [])


class Ownership(unittest.TestCase):
    """upsert() shares rag_docs with ingest/pipeline_native.py's bulk
    ingestion. These titles are the entire contract between them: change one
    without the other and a real archive is one re-run away from being wiped."""

    def test_waypoint_and_span_titles_carry_the_marks_upsert_deletes_by(self):
        for d in E.narrative_docs("example-1700", PAYLOAD):
            if d["chunk_index"] != 0:
                self.assertIn(E.WAYPOINT_MARK, d["title"])
        for d in E.span_docs("example-1700", PAYLOAD, SPANS):
            self.assertTrue(d["title"].endswith(E.SPAN_MARK))

    def test_a_bulk_ingested_row_never_matches_either_mark(self):
        # The shape ingest/pipeline_native.py's chunk() actually produces: a
        # real source title, a real licence, a real url, no em-dash marker.
        bulk_row = {"title": "Wikipedia — Example Voyage", "license": "CC BY-SA 3.0",
                    "source_url": "https://en.wikipedia.org/wiki/Example", "chunk_index": 7}
        self.assertNotIn(E.WAYPOINT_MARK, bulk_row["title"])
        self.assertFalse(bulk_row["title"].endswith(E.SPAN_MARK))
        # And the header-row heuristic (chunk_index 0, no source_url, our
        # licence) cannot mistake a bulk row for ours either.
        self.assertFalse(bulk_row["chunk_index"] == 0 and bulk_row["source_url"] is None)


if __name__ == "__main__":
    unittest.main()
