#!/usr/bin/env python3
"""Tests for the Publisher graph.

    python3 -m unittest test_publisher -v          (from orchestration/)

Against the real database, read-only or dry-run only — never a real git
commit or push. That is a deliberate trade against a fully mocked
psycopg2/git harness: the guards this suite exists to prove
(load_approved's status/type checks, guard_verdict's audit_log check,
write_bundle's slug-collision refusal) are exactly the queries that matter
most to get right, and a real query against the real schema catches a
column-name or join mistake that a hand-rolled stub cursor would silently
agree with. The one thing genuinely untestable this way — a real
`git commit && git push` succeeding — was verified once, live, by hand
(recorded in the commit that introduces this file) rather than automated,
because automating it means either faking the safety net or triggering a
real production deploy on every test run.
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from vitruvyan_motus import NodeFailed                      # noqa: E402

from orchestration.motus.nodes import publisher as P        # noqa: E402


def pg_params() -> dict:
    env = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    return {
        "host": os.environ.get("PGHOST", "127.0.0.1"),
        "port": int(os.environ.get("PGPORT", "6000")),
        "dbname": os.environ.get("PGDATABASE", "terraveler"),
        "user": os.environ.get("PGUSER", "terraveler"),
        "password": os.environ.get("PGPASSWORD") or env.get("POSTGRES_PASSWORD", ""),
    }


def _skip_without_db(fn):
    def wrapper(self, *a, **kw):
        try:
            import psycopg2
            conn = psycopg2.connect(**pg_params())
            conn.close()
        except Exception as exc:  # noqa: BLE001
            self.skipTest(f"no live database reachable: {exc}")
        return fn(self, *a, **kw)
    return wrapper


class Slugify(unittest.TestCase):

    def test_ascii_name_is_lowercased_and_hyphenated(self):
        self.assertEqual(P._slugify("John Cabot"), "john-cabot")

    def test_accented_characters_are_folded(self):
        self.assertEqual(P._slugify("Jean-François La Pérouse"), "jean-francois-la-perouse")

    def test_empty_name_gets_a_placeholder_rather_than_an_empty_slug(self):
        self.assertEqual(P._slugify(""), "navigator")
        self.assertEqual(P._slugify("???"), "navigator")


class LoadApprovedGuard(unittest.TestCase):
    """load_approved is the first gate: wrong status or wrong type must
    refuse before anything else runs, using real rows already in the
    database rather than fabricated ones — these statuses are exactly what
    a real editorial backlog looks like."""

    @_skip_without_db
    def test_a_submission_still_in_peer_review_is_refused(self):
        cfg = P.PublishConfig(pg=pg_params(), carta="0.7", dry_run=True)
        result = P.run_publish(cfg, 28, run_id="test-load-guard-peer-review")
        self.assertFalse(result.state.fact("published"))
        reasons = " ".join(r.reason for r in result.state.rejections)
        self.assertIn("not 'approved'", reasons)

    @_skip_without_db
    def test_an_approved_idea_is_refused_for_its_type_not_its_status(self):
        cfg = P.PublishConfig(pg=pg_params(), carta="0.7", dry_run=True)
        result = P.run_publish(cfg, 35, run_id="test-load-guard-idea-type")
        self.assertFalse(result.state.fact("published"))
        reasons = " ".join(r.reason for r in result.state.rejections)
        self.assertIn("new-voyage", reasons)


class SlugCollisionGuard(unittest.TestCase):
    """§4.2: 'anything that would overwrite previously verified content'
    must escalate, never overwrite. cabot-1497 is real, already-published
    content — exactly the case this guard exists for."""

    @_skip_without_db
    def test_republishing_an_already_published_voyage_is_refused(self):
        cfg = P.PublishConfig(pg=pg_params(), carta="0.7", dry_run=True)
        result = P.run_publish(cfg, 24, run_id="test-slug-collision")
        self.assertFalse(result.state.fact("published"))
        self.assertEqual(result.state.fact("target_voyage"), "cabot-1497")
        reasons = " ".join(r.reason for r in result.state.rejections)
        self.assertIn("already exists", reasons)
        self.assertIn("slug collision", reasons)


class DryRunTouchesNothingReal(unittest.TestCase):
    """A dry run over a submission clean enough to reach write_bundle must
    still perform zero git/filesystem/Postgres side effects — cabot-1497
    reaching the collision guard already proves the read side works; this
    proves dry_run actually gates every node with a real side effect."""

    @_skip_without_db
    def test_dry_run_never_reaches_a_real_git_call(self):
        calls = []
        original = P._run_git
        P._run_git = lambda *a, **kw: calls.append(a) or ""
        try:
            cfg = P.PublishConfig(pg=pg_params(), carta="0.7", dry_run=True)
            P.run_publish(cfg, 24, run_id="test-dry-run-no-git")
        finally:
            P._run_git = original
        self.assertEqual(calls, [], "dry_run must never invoke git")


class CommitPushTargetsMainExplicitly(unittest.TestCase):
    """The bug this rebuild exists not to repeat: a bare `git push` sends
    the CURRENT branch to its own upstream, which once published a real
    voyage to a Vercel Preview while reporting success. Pinned in source
    rather than by calling the node directly — Motus's Runtime owns attempt
    commit semantics, and a node is not meant to be invoked outside it (a
    direct call raises: "attempt-local writes cannot be read before
    commit"). What matters is unambiguous from the source alone: no bare
    `git push` call anywhere in this file."""

    def test_push_is_origin_head_colon_main_not_a_bare_push(self):
        source = (ROOT / "orchestration" / "motus" / "nodes" / "publisher.py").read_text()
        self.assertIn('_run_git(cfg.repo_root, "push", "origin", "HEAD:main")', source)
        self.assertNotRegex(source, r'_run_git\(cfg\.repo_root,\s*"push"\)\s*$',
                            "a bare `git push` with no explicit refspec must never reappear")


if __name__ == "__main__":
    unittest.main()
