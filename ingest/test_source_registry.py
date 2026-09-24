"""The discovery capability registry, pinned against the bug it exists to
close and the security invariant it must never violate.

    python3 -m unittest test_source_registry -v      (from ingest/)

Fully offline: every adapter/registry object is constructed by hand, and any
test that would otherwise reach the network instead asserts it never tries.
"""
import unittest
from unittest.mock import patch

from vitruvyan_motus import GraphSpec, Policy, Runtime, State

import oculus
import fetch as F
import pipeline_native as PN
import source_registry as SR


def _row(**kw):
    base = dict(id=1, adapter="mediawiki_search", config={}, capability="search",
                priority=100, max_candidates=5, endpoint_id=None,
                institution_id=None, notes=None)
    base.update(kw)
    return SR.AdapterRow(**base)


def _snapshot(adapters, gap=None, source="db", note="test"):
    return SR.RegistrySnapshot(adapters=adapters, gap=gap or [], source=source,
                                generated_at="test", note=note)


class OffWhitelistAdapterConfig(unittest.TestCase):
    """The non-negotiable invariant: a misconfigured adapter row can only
    ever shrink discovery, never smuggle a request past the whitelist."""

    def test_off_whitelist_api_base_template_is_rejected_before_any_request(self):
        config = {"api_base_template": "https://evil.example.com/w/api.php",
                  "kind": "evil", "license": "stolen"}
        with patch.object(SR.F, "get_json", side_effect=AssertionError(
                "mediawiki_search must never make an HTTP request for an "
                "off-whitelist host")):
            with self.assertRaises(SR.AdapterRejected) as ctx:
                SR.mediawiki_search("Magellan", "en", config, 5)
        self.assertIn("evil.example.com", str(ctx.exception))

    def test_discover_turns_the_rejection_into_zero_candidates_and_a_named_failure(self):
        evil = _row(id=99, adapter="mediawiki_search", priority=1,
                     config={"api_base_template": "https://evil.example.com/w/api.php",
                             "kind": "evil", "license": "stolen"})
        with patch.object(SR.F, "get_json", side_effect=AssertionError("must not fetch")):
            found = oculus.discover("Magellan", "en", registry=_snapshot([evil]))
        self.assertEqual(found["candidates"], [])
        self.assertEqual(len(found["adapters_failed"]), 1)
        self.assertEqual(found["adapters_failed"][0]["adapter"], "mediawiki_search")
        self.assertIn("evil.example.com", found["adapters_failed"][0]["why"])

    def test_a_subdomain_lookalike_does_not_pass(self):
        """The same trap `whitelist.py` already guards against for a raw URL
        must also hold when the host is assembled from adapter config."""
        config = {"api_base_template": "https://{lang}.wikipedia.org.evil.example/w/api.php",
                  "kind": "wikipedia", "license": "CC BY-SA 4.0"}
        with patch.object(SR.F, "get_json", side_effect=AssertionError("must not fetch")):
            with self.assertRaises(SR.AdapterRejected):
                SR.mediawiki_search("Magellan", "en", config, 5)


class LangSubstitutionIsValidatedNotSanitized(unittest.TestCase):
    def test_path_traversal_lang_is_refused(self):
        config = {"api_base_template": "https://{lang}.wikipedia.org/w/api.php",
                  "kind": "wikipedia", "license": "CC BY-SA 4.0"}
        with patch.object(SR.F, "get_json", side_effect=AssertionError("must not fetch")):
            with self.assertRaises(SR.AdapterRejected) as ctx:
                SR.mediawiki_search("Magellan", "../../evil", config, 5)
        self.assertIn("lang", str(ctx.exception))

    def test_injection_via_at_sign_is_refused(self):
        config = {"api_base_template": "https://{lang}.wikipedia.org/w/api.php",
                  "kind": "wikipedia", "license": "CC BY-SA 4.0"}
        with patch.object(SR.F, "get_json", side_effect=AssertionError("must not fetch")):
            with self.assertRaises(SR.AdapterRejected):
                SR.mediawiki_search("Magellan", "x@evil.com", config, 5)

    def test_ordinary_language_subtags_are_accepted(self):
        for lang in ("en", "it", "pt-br", "zh"):
            self.assertTrue(SR.LANG_RE.match(lang), lang)


class UnimplementedAdapterIsSkippedNotFatal(unittest.TestCase):
    def test_an_adapter_name_with_no_python_function_is_reported_not_run(self):
        row = _row(id=5, adapter="some_future_adapter_not_built_yet")
        found = oculus.discover("Magellan", "en", registry=_snapshot([row]))
        self.assertEqual(found["candidates"], [])
        self.assertEqual(found["adapters_unimplemented"], ["some_future_adapter_not_built_yet"])

    def test_verify_only_capability_is_never_called_for_search(self):
        row = _row(id=6, adapter="archive_org_metadata", capability="verify_only")
        found = oculus.discover("Magellan", "en", registry=_snapshot([row]))
        self.assertEqual(found["candidates"], [])
        self.assertEqual(found["adapters_used"], [])  # not a search adapter at all


class GlobalCandidateCap(unittest.TestCase):
    def test_candidates_are_capped_after_merging_by_priority(self):
        def fake_adapter(subject, lang, config, max_candidates):
            n = config["n"]
            return [{"kind": config["kind"], "lang": lang, "title": f"{config['kind']}-{i}",
                     "hint": "x", "license": "x", "url": "x", "source_url": "x"}
                    for i in range(n)]

        with patch.dict(SR.ADAPTERS, {"fake": fake_adapter}):
            low_priority = _row(id=1, adapter="fake", priority=1,
                                 max_candidates=15, config={"n": 15, "kind": "first"})
            high_priority = _row(id=2, adapter="fake", priority=2,
                                  max_candidates=15, config={"n": 15, "kind": "second"})
            found = oculus.discover("X", "en", registry=_snapshot([low_priority, high_priority]),
                                     total_cap=20)
        self.assertEqual(len(found["candidates"]), 20)
        # priority 1 (first) fills before priority 2 (second) is truncated
        self.assertEqual(sum(1 for c in found["candidates"] if c["kind"] == "first"), 15)
        self.assertEqual(sum(1 for c in found["candidates"] if c["kind"] == "second"), 5)
        self.assertEqual(found["dropped_by_cap"], {"fake": 10})

    def test_default_cap_is_the_named_constant_not_a_magic_number(self):
        self.assertEqual(oculus.DEFAULT_CANDIDATE_CAP, 24)


class FetchDispatch(unittest.TestCase):
    """The bug this PR closes: a candidate whose kind wasn't literally
    "gutenberg" fell into an `else` branch and was fetched FROM WIKIPEDIA
    regardless of its real kind, then stored under the OTHER source's
    provenance and licence."""

    def test_wikisource_candidate_is_fetched_from_wikisource_not_wikipedia(self):
        calls = []
        with patch.object(F, "fetch_wikisource", side_effect=lambda lang, title: calls.append(("wikisource", lang, title)) or "WS BODY"), \
             patch.object(F, "fetch_wikipedia", side_effect=lambda lang, title: calls.append(("wikipedia", lang, title)) or "WP BODY"):
            body = F.fetch_by_kind({"kind": "wikisource", "lang": "en", "title": "T"})
        self.assertEqual(body, "WS BODY")
        self.assertEqual(calls, [("wikisource", "en", "T")])

    def test_wikipedia_candidate_still_goes_to_wikipedia(self):
        with patch.object(F, "fetch_wikipedia", return_value="WP BODY") as m:
            body = F.fetch_by_kind({"kind": "wikipedia", "lang": "en", "title": "T"})
        self.assertEqual(body, "WP BODY")
        m.assert_called_once_with("en", "T")

    def test_gutenberg_candidate_still_goes_to_gutenberg(self):
        with patch.object(F, "fetch_gutenberg", return_value="GUT BODY") as m:
            body = F.fetch_by_kind({"kind": "gutenberg", "url": "https://www.gutenberg.org/x.txt"})
        self.assertEqual(body, "GUT BODY")
        m.assert_called_once_with("https://www.gutenberg.org/x.txt")

    def test_an_unknown_kind_raises_instead_of_silently_defaulting_to_wikipedia(self):
        with patch.object(F, "fetch_wikipedia", side_effect=AssertionError(
                "must never be reached for an unknown kind")):
            with self.assertRaises(ValueError) as ctx:
                F.fetch_by_kind({"kind": "wikisource_typo", "lang": "en", "title": "T"})
        self.assertIn("wikisource_typo", str(ctx.exception))


class _FakeStaging:
    """Same in-memory staging double as test_codex.py, so `discover` can run
    through the real Motus Runtime without touching Postgres."""
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


class DiscoverNodeDeclarationIsComplete(unittest.TestCase):
    """`node-protocol.md` §3.2, enforced by the Motus runtime itself: a node's
    `writes_declared` must be exhaustive, or Policy.STRICT turns the gap into
    a DeclarationViolation that fails the run. It is not merely descriptive —
    an earlier draft of this feature wrote per-adapter Fact keys like
    `dropped_by_cap:{adapter_name}`, which cannot be declared statically
    because adapter names come from the database at runtime. Every path that
    writes a Fact/Decision inside `discover` is exercised here, under STRICT,
    so a future undeclared key fails this test instead of surfacing as a
    silent `"violations"` entry in a production trace (EXPLORATION policy,
    `run.py`'s default, does not raise on a violation at all)."""

    def _run_discover(self, registry_snapshot):
        store = _FakeStaging()
        cfg = PN.IngestConfig(voyage="t", subject="Magellan", lang="en")
        orig_staging = PN.staging
        PN.staging = store
        try:
            with patch.object(SR, "get_registry", return_value=registry_snapshot):
                node = PN.make_discovery_nodes(cfg, "t")["discover"]
                # Reuse the REAL declared writes for "discover" from
                # DISCOVERY_SPEC — the whole point of this test is to catch a
                # drift between what the node actually writes and what the
                # spec says it may write, so the spec must come from the
                # production graph, not be retyped here.
                declared = next(n for n in PN.DISCOVERY_SPEC.nodes
                                 if n.name == "discover")
                spec = GraphSpec.from_dict({
                    "schema_version": "1.0.0", "name": "d", "version": "1.0.0",
                    "entry": "discover",
                    "nodes": [{"name": "discover",
                               "effect_class": declared.effect_class.value,
                               "reads_declared": list(declared.reads_declared),
                               "writes_declared": list(declared.writes_declared)}],
                    "transitions": {"discover": {"kind": "terminal"}},
                })
                return Runtime(spec, {"discover": node}, policy=Policy.STRICT).run(
                    State.empty("t"), run_id="t")
        finally:
            PN.staging = orig_staging

    def test_no_violation_with_a_gap_and_a_capped_adapter(self):
        def fake_adapter(subject, lang, config, max_candidates):
            return [{"kind": "fake", "lang": lang, "title": f"t{i}", "hint": "x",
                     "license": "x", "url": "x", "source_url": "x"}
                    for i in range(config["n"])]

        gap = [{"id": 99, "host_pattern": "ungoverned.example", "match_type": "exact"}]
        row = _row(id=1, adapter="fake", priority=1, max_candidates=30,
                   config={"n": 30})
        snapshot = _snapshot([row], gap=gap, source="db", note="test")

        with patch.dict(SR.ADAPTERS, {"fake": fake_adapter}):
            result = self._run_discover(snapshot)

        self.assertEqual(result.status, "completed")
        # Every transition record must be violation-free under STRICT.
        for record in result.trace.records:
            if record.get("kind") == "transition":
                self.assertFalse(record.get("violations"),
                                  f"undeclared write(s): {record.get('violations')}")

    def test_no_violation_with_an_unimplemented_and_a_failing_adapter(self):
        def boom(subject, lang, config, max_candidates):
            raise RuntimeError("network is down")

        rows = [
            _row(id=1, adapter="totally_unregistered_adapter", priority=1),
            _row(id=2, adapter="boom", priority=2),
        ]
        snapshot = _snapshot(rows, gap=[], source="snapshot", note="test")

        with patch.dict(SR.ADAPTERS, {"boom": boom}):
            result = self._run_discover(snapshot)

        self.assertEqual(result.status, "completed")
        for record in result.trace.records:
            if record.get("kind") == "transition":
                self.assertFalse(record.get("violations"),
                                  f"undeclared write(s): {record.get('violations')}")


class SnapshotFallback(unittest.TestCase):
    def test_missing_db_and_missing_snapshot_fails_loudly(self):
        with patch.object(SR, "get_db_connection", side_effect=OSError("no route to host")), \
             patch.object(SR, "SNAPSHOT_PATH", "/nonexistent/adapters_snapshot.json"):
            with self.assertRaises(RuntimeError) as ctx:
                SR._load_registry()
        msg = str(ctx.exception)
        self.assertIn("no route to host", msg)
        self.assertIn("nonexistent/adapters_snapshot.json", msg)

    def test_missing_db_with_a_snapshot_present_degrades_visibly(self):
        import tempfile, json, os
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"generated_at": "2026-01-01T00:00:00Z",
                       "adapters": [{"id": 1, "adapter": "gutendex", "config": {},
                                     "capability": "search", "priority": 10,
                                     "max_candidates": 3, "endpoint_id": None,
                                     "institution_id": 1, "notes": None}],
                       "gap": []}, f)
            path = f.name
        try:
            with patch.object(SR, "get_db_connection", side_effect=OSError("unreachable")), \
                 patch.object(SR, "SNAPSHOT_PATH", path):
                snap = SR._load_registry()
            self.assertEqual(snap.source, "snapshot")
            self.assertIn("2026-01-01", snap.note)
            self.assertIn("unreachable", snap.note)
            self.assertEqual(len(snap.adapters), 1)
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main()
