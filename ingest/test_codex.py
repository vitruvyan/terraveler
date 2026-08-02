"""Codex Hunters — Restorer and Binder, pinned against the pattern's canonical
semantics (vitruvyan-core codex_hunters/consumers/{restorer,binder}.py) and
against the real title shapes ingestion actually produces (see sources.py:
"..., Vol. I" / "..., Vol. II", "Author — Title (trans. X, YEAR)").

    python3 -m unittest test_codex -v      (from ingest/)
"""
import unittest

from axis.state import GraphState
import codex as C
from pipeline import Corpus


def _mk_body(sentence, pad_to=520):
    """A body past the 500-char validity floor, padded without touching the
    sentence under test — the quality gate cares about the artifact, not
    what it says."""
    filler = " Meanwhile the watch changed and the log continued as before."
    body = sentence
    while len(body) < pad_to:
        body += filler
    return body


def _long_words_body(prefix, n, changed_at=None, changed_to="CHANGED"):
    """A body of n distinct words, long enough to sit well clear of the
    500-char floor and to carry a stable 8-word-shingle Jaccard score
    against a sibling built the same way."""
    words = [f"word{i}" for i in range(1, n + 1)]
    if changed_at is not None:
        words[changed_at] = changed_to
    return prefix + " ".join(words) + " " + ("Filler padding text for length. " * 3)


def _run(node_factory, corpus, ctx=None):
    state = GraphState.empty("t")
    return node_factory(ctx, corpus)(state)


class Restoration(unittest.TestCase):
    """normalize_text: structural repair, nothing else."""

    def test_idempotent(self):
        raw = "Para one.\n\n\n\nPara two, trailing spaces.   \nA\ttab.\n\n\n\nEnd."
        once = C.normalize_text(raw)
        twice = C.normalize_text(once)
        self.assertEqual(once, twice)

    def test_only_whitespace_and_control_characters_may_change(self):
        raw = "The ship's log — \"Land ho!\" — read aloud,\x07 line by\n\n\n\nline.   "
        norm = C.normalize_text(raw)
        strip_ws = lambda s: "".join(ch for ch in s if not ch.isspace() and ord(ch) >= 0x20)
        self.assertEqual(strip_ws(raw), strip_ws(norm))
        # letters, case and punctuation untouched
        self.assertIn("Land ho!", norm)
        self.assertIn("ship's log", norm)

    def test_three_or_more_blank_lines_collapse_to_two(self):
        norm = C.normalize_text("a\n\n\n\n\nb")
        self.assertEqual(norm, "a\n\nb")

    def test_control_characters_are_stripped_but_newline_and_tab_survive(self):
        norm = C.normalize_text("a\x00\x07b\nc\td")
        self.assertEqual(norm, "ab\nc\td")


class QualityGate(unittest.TestCase):
    def test_a_short_text_is_dropped_invalid_with_score_and_errors_recorded(self):
        """~200 chars, and still carrying its Gutenberg header — two
        structural errors, quality 1.0 - 2*0.3 = 0.4, under the 0.5 threshold."""
        body = ("Short entry. " * 8) + "*** START OF THE PROJECT GUTENBERG EBOOK EXAMPLE ***"
        self.assertLess(len(body), 500)
        corpus = Corpus()
        corpus.raw_texts = [("A Thin Pamphlet", "https://www.gutenberg.org/x", body,
                              "Public domain", None)]
        state = _run(C.codex_restore_node, corpus)
        self.assertEqual(corpus.raw_texts, [])
        self.assertEqual(len(state.rejections), 1)
        rej = state.rejections[0]
        self.assertEqual(rej.description, "A Thin Pamphlet")
        self.assertIn("codex: INVALID", rej.reason)
        self.assertIn("quality=0.4", rej.reason)
        self.assertIn("500", rej.reason)
        self.assertIn("*** START OF", rej.reason)
        invalid_fact = [f for f in state.facts if f.key == "codex_invalid"][0]
        self.assertEqual(invalid_fact.value, 1)


class Dedupe(unittest.TestCase):
    def test_an_exact_duplicate_is_dropped_and_names_the_kept_twin(self):
        body = _mk_body("The ship made landfall at dawn, the crew silent at the rail.")
        corpus = Corpus()
        corpus.raw_texts = [
            ("Journal, first copy", "https://www.gutenberg.org/a", body, "Public domain", None),
            ("Journal, second copy", "https://www.gutenberg.org/b", body, "Public domain", None),
        ]
        state = _run(C.codex_restore_node, corpus)
        self.assertEqual(len(corpus.raw_texts), 1)
        self.assertEqual(corpus.raw_texts[0][0], "Journal, first copy")
        dup_rejections = [r for r in state.rejections if "exact duplicate" in r.reason]
        self.assertEqual(len(dup_rejections), 1)
        self.assertEqual(dup_rejections[0].description, "Journal, second copy")
        self.assertIn("Journal, first copy", dup_rejections[0].reason)
        self.assertIn("https://www.gutenberg.org/a", dup_rejections[0].reason)

    def test_a_near_duplicate_is_dropped_and_public_domain_beats_cc(self):
        """Same edition, transcribed by two archives — one word out of 320
        differs. Jaccard lands ~0.95, comfortably over the 0.90 gate. The
        public-domain copy must survive regardless of which one arrived
        first."""
        body_pd = _long_words_body("Log of the voyage. ", 320, changed_at=None)
        body_cc = _long_words_body("Log of the voyage. ", 320, changed_at=150)
        jaccard = C._jaccard(C._shingles(body_pd), C._shingles(body_cc))
        self.assertGreaterEqual(jaccard, 0.90)
        self.assertLess(jaccard, 1.0)

        for order_name, entries in (
            ("pd_first", [("Archive A scan", "https://www.gutenberg.org/a", body_pd,
                           "Public domain", None),
                          ("Archive B scan", "https://x.wikipedia.org/wiki/B", body_cc,
                           "CC BY-SA 4.0", None)]),
            ("cc_first", [("Archive B scan", "https://x.wikipedia.org/wiki/B", body_cc,
                           "CC BY-SA 4.0", None),
                          ("Archive A scan", "https://www.gutenberg.org/a", body_pd,
                           "Public domain", None)]),
        ):
            with self.subTest(order=order_name):
                corpus = Corpus()
                corpus.raw_texts = list(entries)
                state = _run(C.codex_restore_node, corpus)
                self.assertEqual(len(corpus.raw_texts), 1)
                self.assertEqual(corpus.raw_texts[0][0], "Archive A scan")
                self.assertEqual(corpus.raw_texts[0][3], "Public domain")
                near_rejections = [r for r in state.rejections if "near-duplicate" in r.reason]
                self.assertEqual(len(near_rejections), 1)
                self.assertEqual(near_rejections[0].description, "Archive B scan")
                self.assertIn("jaccard=0.9", near_rejections[0].reason)

    def test_two_different_texts_are_both_kept(self):
        body_a = _mk_body("The Endeavour cleared the reef at first light.")
        body_b = _mk_body("Three days inland the porters refused to go further.")
        corpus = Corpus()
        corpus.raw_texts = [
            ("Cook's Journal", "https://www.gutenberg.org/a", body_a, "Public domain", None),
            ("Stanley's Diary", "https://www.gutenberg.org/b", body_b, "Public domain", None),
        ]
        state = _run(C.codex_restore_node, corpus)
        self.assertEqual(len(corpus.raw_texts), 2)
        titles = {t for t, *_ in corpus.raw_texts}
        self.assertEqual(titles, {"Cook's Journal", "Stanley's Diary"})
        dup_rejections = [r for r in state.rejections
                           if "duplicate" in r.reason]
        self.assertEqual(dup_rejections, [])
        kept_fact = [f for f in state.facts if f.key == "codex_kept"][0]
        self.assertEqual(kept_fact.value, 2)

    def test_image_docs_dedupe_exactly_by_media_url(self):
        corpus = Corpus()
        corpus.raw_texts = []
        corpus.docs = [
            {"voyage_slug": "v", "type": "image", "title": "File:A.jpg", "content": "a",
             "source_url": "https://commons/a", "license": "CC BY-SA 4.0", "credit": None,
             "media_url": "https://upload/a.jpg", "chunk_index": None, "work_id": None},
            {"voyage_slug": "v", "type": "image", "title": "File:A-again.jpg", "content": "a2",
             "source_url": "https://commons/a2", "license": "CC BY-SA 4.0", "credit": None,
             "media_url": "https://upload/a.jpg", "chunk_index": None, "work_id": None},
        ]
        state = _run(C.codex_restore_node, corpus)
        self.assertEqual(len(corpus.docs), 1)
        media_rejections = [r for r in state.rejections if "media_url" in r.reason]
        self.assertEqual(len(media_rejections), 1)


class Binding(unittest.TestCase):
    def test_volumes_of_one_work_bind_to_the_same_work_id(self):
        corpus = Corpus()
        corpus.raw_texts = [
            ("The Memoirs of the Conquistador Bernal Díaz del Castillo, Vol. I",
             "https://www.gutenberg.org/a", "body one", "Public domain", None),
            ("The Memoirs of the Conquistador Bernal Díaz del Castillo, Vol. II",
             "https://www.gutenberg.org/b", "body two", "Public domain", None),
        ]
        state = _run(C.codex_bind_node, corpus)
        work_ids = {wid for *_rest, wid in corpus.raw_texts}
        self.assertEqual(len(work_ids), 1)
        self.assertIsNotNone(next(iter(work_ids)))
        multi_edition = [d for d in state.decisions if "bound 2 editions" in d.description]
        self.assertEqual(len(multi_edition), 1)
        works_fact = [f for f in state.facts if f.key == "codex_works"][0]
        self.assertEqual(works_fact.value, 1)

    def test_two_wikipedia_articles_get_distinct_work_ids(self):
        corpus = Corpus()
        corpus.raw_texts = [
            ("Wikipedia — Louis Antoine de Bougainville",
             "https://en.wikipedia.org/wiki/Louis_Antoine_de_Bougainville",
             "body one", "CC BY-SA 4.0", None),
            ("Wikipedia — Tahiti", "https://en.wikipedia.org/wiki/Tahiti",
             "body two", "CC BY-SA 4.0", None),
        ]
        state = _run(C.codex_bind_node, corpus)
        work_ids = [wid for *_rest, wid in corpus.raw_texts]
        self.assertEqual(len(set(work_ids)), 2)
        for wid in work_ids:
            self.assertTrue(wid.startswith("wikipedia-"))
        works_fact = [f for f in state.facts if f.key == "codex_works"][0]
        self.assertEqual(works_fact.value, 2)

    def test_image_docs_get_no_work_id(self):
        corpus = Corpus()
        corpus.raw_texts = []
        corpus.docs = [{"type": "image", "work_id": None, "media_url": "https://x/a.jpg"}]
        _run(C.codex_bind_node, corpus)
        self.assertIsNone(corpus.docs[0]["work_id"])

    def test_a_commentary_titled_author_dash_title_binds_to_its_own_work(self):
        """Diderot's Supplément is a different book from Bougainville's own
        account — it must not collapse into "bougainville" just because it
        shares the "Author — Title" phrasing. The title segment (almost
        always the longer one) wins over the author segment."""
        corpus = Corpus()
        corpus.raw_texts = [
            ("Diderot — Supplément au Voyage de Bougainville",
             "https://www.gutenberg.org/a", "body one", "Public domain", None),
            ("Bougainville — A Voyage Round the World (trans. Forster, 1772)",
             "https://www.gutenberg.org/b", "body two", "Public domain", None),
        ]
        state = _run(C.codex_bind_node, corpus)
        wid_diderot, wid_bougainville = (wid for *_rest, wid in corpus.raw_texts)
        self.assertNotEqual(wid_diderot, wid_bougainville)
        self.assertNotIn("diderot", wid_diderot)
        self.assertNotEqual(wid_diderot, "bougainville")
        self.assertIn("supplement", wid_diderot)
        works_fact = [f for f in state.facts if f.key == "codex_works"][0]
        self.assertEqual(works_fact.value, 2)

    def test_explicit_work_override_wins_over_the_heuristic(self):
        """The heuristic cannot bind an English and a French title — no text
        in common, only a subject. sources.py names the work explicitly for
        that case, and the override must be taken verbatim, not re-derived
        from the title."""
        corpus = Corpus()
        corpus.raw_texts = [
            ("Bougainville — A Voyage Round the World (trans. Forster, 1772)",
             "https://www.gutenberg.org/en", "body one", "Public domain",
             "voyage-autour-du-monde"),
            ("Bougainville — Voyage autour du monde (French, 1771)",
             "https://www.gutenberg.org/fr", "body two", "Public domain",
             "voyage-autour-du-monde"),
        ]
        state = _run(C.codex_bind_node, corpus)
        work_ids = {wid for *_rest, wid in corpus.raw_texts}
        self.assertEqual(work_ids, {"voyage-autour-du-monde"})
        override_decisions = [d for d in state.decisions
                               if "explicit work override" in d.description]
        self.assertEqual(len(override_decisions), 2)
        works_fact = [f for f in state.facts if f.key == "codex_works"][0]
        self.assertEqual(works_fact.value, 1)
        multi_edition = [d for d in state.decisions if "bound 2 editions" in d.description]
        self.assertEqual(len(multi_edition), 1)


if __name__ == "__main__":
    unittest.main()
