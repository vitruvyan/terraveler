"""Codex Hunters — Restorer and Binder, pinned against the pattern's canonical
semantics (vitruvyan-core codex_hunters/consumers/{restorer,binder}.py) and
against the real title shapes ingestion actually produces (see sources.py:
"..., Vol. I" / "..., Vol. II", "Author — Title (trans. X, YEAR)").

    python3 -m unittest test_codex -v      (from ingest/)
"""
import unittest

from vitruvyan_motus import GraphSpec, Runtime, State
import codex as C
import pipeline_native as PN


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


class _FakeStaging:
    """Staging held in memory, with the module's own four-call surface.

    The codex nodes read and write the run's payload through `staging`, which
    is Postgres in production. These tests are about what codex DECIDES —
    which text is invalid, which twin is kept, how a drop is worded — so the
    store is swapped for a dict and the assertions stay exactly as they were
    when the logic lived in a node holding a `Corpus`.
    """
    RAW, IMG, DOC = "raw", "img", "doc"

    def __init__(self):
        self.rows = {}

    def ensure(self, cfg):
        pass

    def put(self, cfg, run_id, stage, rows, embeddings=None):
        self.rows[(run_id, stage)] = [dict(r) for r in rows]
        return len(rows)

    def get(self, cfg, run_id, stage):
        return [dict(r) for r in self.rows.get((run_id, stage), ())]

    def clear(self, cfg, run_id):
        self.rows = {k: v for k, v in self.rows.items() if k[0] != run_id}


class _Ctx:
    """The two RunContext calls these nodes make. A real run gets the real
    thing from the runtime; a unit test needs only a clock it can predict."""

    def now(self):
        return "2026-01-01T00:00:00.000000Z"

    def record_effect(self, effect):
        pass


def _rows(*tuples):
    """The old 5-tuple vocabulary these tests were written in, mapped onto the
    staging rows the nodes read now. The shape moved; the cases did not."""
    return [{"title": t, "url": u, "body": b, "license": l, "work_id": w}
            for (t, u, b, l, w) in tuples]


def _run_codex(which, raw_rows, image_rows=()):
    """Run one codex node over `raw_rows`, returning (state, staged_raw).

    The node goes through a real one-node Runtime rather than being called
    directly, because Motus refuses to let anyone read a state's writes before
    the runtime commits them — *attempt-local writes are outputs and cannot be
    scanned before commit*. Calling the function and inspecting what it returns
    raises. So the graph is the smallest one that can exist: this node, and an
    end.
    """
    spec = GraphSpec.from_dict({
        "schema_version": "1.0.0", "name": f"codex-{which}", "version": "1.0.0",
        "entry": which,
        "nodes": [{"name": which, "effect_class": "recorded_effect"}],
        "transitions": {which: {"kind": "terminal"}},
    })
    store = _FakeStaging()
    cfg = PN.IngestConfig(voyage="t")
    store.put(cfg, "t", store.RAW, raw_rows)
    store.put(cfg, "t", store.IMG, list(image_rows))
    original = PN.staging
    PN.staging = store
    try:
        node = PN.make_discovery_nodes(cfg, "t")[which]
        result = Runtime(spec, {which: node}).run(State.empty("t"), run_id="t")
    finally:
        PN.staging = original
    return result.state, store.get(cfg, "t", store.RAW), store.get(cfg, "t", store.IMG)


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
        rows = _rows(("A Thin Pamphlet", "https://www.gutenberg.org/x", body,
                              "Public domain", None))
        state, raw, imgs = _run_codex("codex_restore", rows)
        self.assertEqual(raw, [])
        self.assertEqual(len(state.rejections), 1)
        rej = state.rejections[0]
        self.assertEqual(rej.what, "A Thin Pamphlet")
        self.assertIn("codex: INVALID", rej.reason)
        self.assertIn("quality=0.4", rej.reason)
        self.assertIn("500", rej.reason)
        self.assertIn("*** START OF", rej.reason)
        invalid_fact = [f for f in state.facts if f.key == "codex_invalid"][0]
        self.assertEqual(invalid_fact.value, 1)


class Dedupe(unittest.TestCase):
    def test_an_exact_duplicate_is_dropped_and_names_the_kept_twin(self):
        body = _mk_body("The ship made landfall at dawn, the crew silent at the rail.")
        rows = _rows(
            ("Journal, first copy", "https://www.gutenberg.org/a", body, "Public domain", None),
            ("Journal, second copy", "https://www.gutenberg.org/b", body, "Public domain", None),
        )
        state, raw, imgs = _run_codex("codex_restore", rows)
        self.assertEqual(len(raw), 1)
        self.assertEqual(raw[0]["title"], "Journal, first copy")
        dup_rejections = [r for r in state.rejections if "exact duplicate" in r.reason]
        self.assertEqual(len(dup_rejections), 1)
        self.assertEqual(dup_rejections[0].what, "Journal, second copy")
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
                rows = _rows(*entries)
                state, raw, imgs = _run_codex("codex_restore", rows)
                self.assertEqual(len(raw), 1)
                self.assertEqual(raw[0]["title"], "Archive A scan")
                self.assertEqual(raw[0]["license"], "Public domain")
                near_rejections = [r for r in state.rejections if "near-duplicate" in r.reason]
                self.assertEqual(len(near_rejections), 1)
                self.assertEqual(near_rejections[0].what, "Archive B scan")
                self.assertIn("jaccard=0.9", near_rejections[0].reason)

    def test_two_different_texts_are_both_kept(self):
        body_a = _mk_body("The Endeavour cleared the reef at first light.")
        body_b = _mk_body("Three days inland the porters refused to go further.")
        rows = _rows(
            ("Cook's Journal", "https://www.gutenberg.org/a", body_a, "Public domain", None),
            ("Stanley's Diary", "https://www.gutenberg.org/b", body_b, "Public domain", None),
        )
        state, raw, imgs = _run_codex("codex_restore", rows)
        self.assertEqual(len(raw), 2)
        titles = {r["title"] for r in raw}
        self.assertEqual(titles, {"Cook's Journal", "Stanley's Diary"})
        dup_rejections = [r for r in state.rejections
                           if "duplicate" in r.reason]
        self.assertEqual(dup_rejections, [])
        kept_fact = [f for f in state.facts if f.key == "codex_kept"][0]
        self.assertEqual(kept_fact.value, 2)

    def test_image_docs_dedupe_exactly_by_media_url(self):
        images = [
            {"voyage_slug": "v", "type": "image", "title": "File:A.jpg", "content": "a",
             "source_url": "https://commons/a", "license": "CC BY-SA 4.0", "credit": None,
             "media_url": "https://upload/a.jpg", "chunk_index": None, "work_id": None},
            {"voyage_slug": "v", "type": "image", "title": "File:A-again.jpg", "content": "a2",
             "source_url": "https://commons/a2", "license": "CC BY-SA 4.0", "credit": None,
             "media_url": "https://upload/a.jpg", "chunk_index": None, "work_id": None},
        ]
        state, raw, imgs = _run_codex("codex_restore", _rows(), image_rows=images)
        self.assertEqual(len(imgs), 1)
        media_rejections = [r for r in state.rejections if "media_url" in r.reason]
        self.assertEqual(len(media_rejections), 1)


class Binding(unittest.TestCase):
    def test_volumes_of_one_work_bind_to_the_same_work_id(self):
        rows = _rows(
            ("The Memoirs of the Conquistador Bernal Díaz del Castillo, Vol. I",
             "https://www.gutenberg.org/a", "body one", "Public domain", None),
            ("The Memoirs of the Conquistador Bernal Díaz del Castillo, Vol. II",
             "https://www.gutenberg.org/b", "body two", "Public domain", None),
        )
        state, raw, imgs = _run_codex("codex_bind", rows)
        work_ids = {r["work_id"] for r in raw}
        self.assertEqual(len(work_ids), 1)
        self.assertIsNotNone(next(iter(work_ids)))
        multi_edition = [d for d in state.decisions if d.key == "codex_edition_of" and "2 editions" in (d.reason or "")]
        self.assertEqual(len(multi_edition), 1)
        works_fact = [f for f in state.facts if f.key == "codex_works"][0]
        self.assertEqual(works_fact.value, 1)

    def test_two_wikipedia_articles_get_distinct_work_ids(self):
        rows = _rows(
            ("Wikipedia — Louis Antoine de Bougainville",
             "https://en.wikipedia.org/wiki/Louis_Antoine_de_Bougainville",
             "body one", "CC BY-SA 4.0", None),
            ("Wikipedia — Tahiti", "https://en.wikipedia.org/wiki/Tahiti",
             "body two", "CC BY-SA 4.0", None),
        )
        state, raw, imgs = _run_codex("codex_bind", rows)
        work_ids = [r["work_id"] for r in raw]
        self.assertEqual(len(set(work_ids)), 2)
        for wid in work_ids:
            self.assertTrue(wid.startswith("wikipedia-"))
        works_fact = [f for f in state.facts if f.key == "codex_works"][0]
        self.assertEqual(works_fact.value, 2)

    def test_image_docs_get_no_work_id(self):
        """The binder never touches images: they are staged apart from the
        texts precisely because they have no work to be an edition of."""
        images = [{"type": "image", "work_id": None, "media_url": "https://x/a.jpg"}]
        _, _, imgs = _run_codex("codex_bind", _rows(), image_rows=images)
        self.assertIsNone(imgs[0]["work_id"])

    def test_a_commentary_titled_author_dash_title_binds_to_its_own_work(self):
        """Diderot's Supplément is a different book from Bougainville's own
        account — it must not collapse into "bougainville" just because it
        shares the "Author — Title" phrasing. The title segment (almost
        always the longer one) wins over the author segment."""
        rows = _rows(
            ("Diderot — Supplément au Voyage de Bougainville",
             "https://www.gutenberg.org/a", "body one", "Public domain", None),
            ("Bougainville — A Voyage Round the World (trans. Forster, 1772)",
             "https://www.gutenberg.org/b", "body two", "Public domain", None),
        )
        state, raw, imgs = _run_codex("codex_bind", rows)
        wid_diderot, wid_bougainville = (r["work_id"] for r in raw)
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
        rows = _rows(
            ("Bougainville — A Voyage Round the World (trans. Forster, 1772)",
             "https://www.gutenberg.org/en", "body one", "Public domain",
             "voyage-autour-du-monde"),
            ("Bougainville — Voyage autour du monde (French, 1771)",
             "https://www.gutenberg.org/fr", "body two", "Public domain",
             "voyage-autour-du-monde"),
        )
        state, raw, imgs = _run_codex("codex_bind", rows)
        work_ids = {r["work_id"] for r in raw}
        self.assertEqual(work_ids, {"voyage-autour-du-monde"})
        override_decisions = [d for d in state.decisions
                               if d.key == "codex_work_override"]
        self.assertEqual(len(override_decisions), 2)
        works_fact = [f for f in state.facts if f.key == "codex_works"][0]
        self.assertEqual(works_fact.value, 1)
        multi_edition = [d for d in state.decisions if d.key == "codex_edition_of" and "2 editions" in (d.reason or "")]
        self.assertEqual(len(multi_edition), 1)


if __name__ == "__main__":
    unittest.main()
