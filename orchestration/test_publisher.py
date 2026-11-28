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
        self.assertIn('_run_git(root, "push", "origin", "HEAD:main")', source)
        self.assertNotRegex(source, r'_run_git\(root,\s*"push"\)\s*$',
                            "a bare `git push` with no explicit refspec must never reappear")

class ExcerptOf(unittest.TestCase):
    """What a waypoint's quotation is, and is not, allowed to be when published
    (Carta 3.2). Pure: no database."""
    EV = {"source_title": "Some Book", "excerpt": "contributor excerpt", "quote": "contributor quote"}

    def test_a_verified_span_is_the_excerpt(self):
        r, raw, rights, cit = P._excerpt_of({"reading_span": "R", "raw_span": "W"}, self.EV)
        self.assertEqual((r, raw, rights, cit), ("R", "W", None, "Some Book"))

    def test_a_claim_with_no_span_prints_nothing_of_the_contributors(self):
        # Not even when no spans row exists at all: an approved-anyway draft
        # whose every quotation was capped or fabricated must not be printed.
        r, raw, rights, _ = P._excerpt_of({}, self.EV)
        self.assertEqual((r, raw, rights), (None, None, None))

    def test_a_quote_only_span_carries_its_rights_and_says_so_in_the_citation(self):
        span = {"reading_span": "R", "raw_span": "W", "rights": {"profile": "quote-only"}}
        _, _, rights, cit = P._excerpt_of(span, self.EV)
        self.assertEqual(rights, {"profile": "quote-only"})
        self.assertEqual(cit, f"Some Book ({P.RIGHTS_NOTE})")

    def test_the_note_is_the_same_words_as_the_other_publish_path(self):
        import publish_submission as PS
        self.assertEqual(P.RIGHTS_NOTE, PS.RIGHTS_NOTE)


# --------------------------------------------------------------------------
# PR 1 — node safety. No database, no network, no real git: a scripted
# psycopg2 stand-in, a recording _run_git, and a throwaway checkout in a temp
# dir. A refused submission must end the run: no file, no git call.
# --------------------------------------------------------------------------
import contextlib                                           # noqa: E402
import re                                                   # noqa: E402
import tempfile                                             # noqa: E402


class _Cur:
    def __init__(self, db):
        self.db, self.row = db, None

    def __enter__(self): return self
    def __exit__(self, *a): return False

    def execute(self, sql, params=None):
        self.db.sql.append(sql)
        if "from submissions" in sql:
            self.row = self.db.submission
        elif "from audit_log" in sql:
            rows = sorted(self.db.verdicts, key=lambda r: r[0], reverse="order by id desc" in sql)
            self.row = rows[0][1:] if rows else None
        elif "from verified_spans" in sql:
            self.row = None
        elif "returning id" in sql:
            self.row = (1,)
        else:
            self.row = None

    def fetchone(self): return self.row


class _Conn:
    def __init__(self, db): self.db = db
    def cursor(self, cursor_factory=None): return _Cur(self.db)
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def close(self): pass


class FakeDb:
    """submission is a dict (RealDictCursor row) or None; latest_verdict is
    (actor, verdict) or None."""
    def __init__(self, submission, latest_verdict=("editor-in-chief", "approve"), verdicts=None):
        # verdicts: [(id, actor, verdict), ...]; the cursor answers by the
        # ORDER BY the query actually asks for.
        self.submission, self.sql = submission, []
        self.verdicts = verdicts if verdicts is not None else (
            [(1,) + tuple(latest_verdict)] if latest_verdict else [])


def _submission(**kw):
    row = {"type": "new-voyage", "status": "approved", "target_voyage": "test-voyage-1500",
           "payload": {"voyage": {"title": "T", "navigator": "Test Navigator", "summary": "S"},
                       "waypoints": [{"seq": 1, "place_historical": "A", "latitude": 1.0,
                                      "longitude": 2.0, "arrival_date": "1500-01-01",
                                      "claims": [{"text": "He sailed."}]}]}}
    row.update(kw)
    return row


def _scratch_repo(parent: Path) -> Path:
    """A throwaway checkout holding the real lib/ files the writer edits."""
    repo = parent / "repo"
    (repo / "data").mkdir(parents=True)
    (repo / "lib").mkdir()
    (repo / ".git").mkdir()
    for f in ("data.ts", "voyages.ts"):
        (repo / "lib" / f).write_text((ROOT / "lib" / f).read_text(encoding="utf-8"), encoding="utf-8")
    return repo


def _tree(repo: Path) -> dict:
    return {str(p.relative_to(repo)): p.read_bytes()
            for p in sorted(repo.rglob("*")) if p.is_file() and ".git" not in p.parts}


@contextlib.contextmanager
def _sandbox(db: FakeDb):
    """Patch the database and git; yield (git_calls, nodes_run)."""
    git_calls, nodes_run = [], []
    real_connect, real_git, real_make = P.psycopg2.connect, P._run_git, P.make_nodes

    def make_nodes(cfg):
        def traced(name, fn):
            def node(state, ctx):
                nodes_run.append(name)
                return fn(state, ctx)
            return node
        return {name: traced(name, fn) for name, fn in real_make(cfg).items()}

    P.psycopg2.connect = lambda **kw: _Conn(db)
    P._run_git = lambda root, *a: git_calls.append((str(root), a)) or "deadbeef"
    P.make_nodes = make_nodes
    try:
        yield git_calls, nodes_run
    finally:
        P.psycopg2.connect, P._run_git, P.make_nodes = real_connect, real_git, real_make


class RefusalsEndTheRun(unittest.TestCase):
    """F1: a refusal used to be a Rejection on a `next` edge, so every later
    node still ran with target_voyage=None. Now the guard records a decision,
    the graph routes on it to a terminal `refuse`, and nothing else runs."""

    def _refused(self, db, expect_in_reason):
        with tempfile.TemporaryDirectory() as tmp:
            repo = _scratch_repo(Path(tmp))
            before = _tree(repo)
            with _sandbox(db) as (git_calls, nodes_run):
                cfg = P.PublishConfig(pg={}, carta="0.7", dry_run=False, repo_root=repo)
                result = P.run_publish(cfg, 1, run_id="test-refusal")
            self.assertEqual(_tree(repo), before, "a refused submission wrote a file")
            self.assertEqual(git_calls, [], "a refused submission performed a git call")
            self.assertEqual(nodes_run[-1], "refuse")
            self.assertNotIn("write_bundle", nodes_run)
            self.assertNotIn("update_atlas", nodes_run)
            self.assertNotIn("commit_push", nodes_run)
            self.assertNotIn("record_published", nodes_run)
            self.assertFalse(result.state.fact("published"))
            self.assertIn(expect_in_reason, " ".join(r.reason for r in result.state.rejections))
            self.assertFalse([q for q in db.sql if q.lstrip().lower().startswith(("insert", "update"))],
                             "a refused submission wrote to the database")

    def test_not_approved(self):
        self._refused(FakeDb(_submission(status="peer-review")), "not 'approved'")

    def test_wrong_type(self):
        self._refused(FakeDb(_submission(type="idea")), "new-voyage")

    def test_missing_target(self):
        self._refused(FakeDb(_submission(target_voyage=None)), "target_voyage")

    def test_unclean_target(self):
        self._refused(FakeDb(_submission(target_voyage="../etc/x")), "target_voyage")

    def test_submission_not_found(self):
        self._refused(FakeDb(None), "not found")

    def test_curator_desk_approve_is_not_an_authorization(self):
        self._refused(FakeDb(_submission(), ("curator-desk", "approve")), "latest verdict")

    def test_an_approve_followed_by_a_reject_is_not_an_authorization(self):
        self._refused(FakeDb(_submission(), ("editor-in-chief", "reject")), "latest verdict")

    def test_the_latest_verdict_query_orders_by_id_desc(self):
        db = FakeDb(_submission())
        self._refused(FakeDb(_submission(), verdicts=[(1, "editor-in-chief", "approve"),
                                                      (2, "curator-desk", "approve")]), "latest verdict")
        self._refused(FakeDb(_submission(), verdicts=[(1, "editor-in-chief", "approve"),
                                                      (2, "curator-desk", "changes")]), "latest verdict")
        with tempfile.TemporaryDirectory() as tmp:
            with _sandbox(db):
                P.run_publish(P.PublishConfig(pg={}, carta="0.7", repo_root=_scratch_repo(Path(tmp))),
                              1, run_id="test-order")
        self.assertTrue(any("order by id desc" in q for q in db.sql if "audit_log" in q))

    def test_leading_digit_slug_is_refused(self):
        self._refused(FakeDb(_submission(target_voyage="1497-cabot")), "target_voyage")

    def test_no_verdict_at_all(self):
        self._refused(FakeDb(_submission(), None), "latest verdict")

    def test_a_slug_collision_in_write_bundle_also_ends_the_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = _scratch_repo(Path(tmp))
            (repo / "data" / "test-voyage-1500.json").write_text("{}")
            before = _tree(repo)
            with _sandbox(FakeDb(_submission())) as (git_calls, nodes_run):
                P.run_publish(P.PublishConfig(pg={}, carta="0.7", repo_root=repo), 1,
                              run_id="test-collision")
            self.assertEqual(_tree(repo), before)
            self.assertEqual(git_calls, [])
            self.assertEqual(nodes_run[-1], "refuse")
            self.assertNotIn("update_atlas", nodes_run)


class LiveCheckoutIsNeverTouched(unittest.TestCase):
    """F2: no git operation and no file write may target the live checkout."""

    def _assert_refused(self, cfg, expect):
        with _sandbox(FakeDb(_submission())) as (git_calls, nodes_run):
            result = P.run_publish(cfg, 1, run_id="test-live-root")
        self.assertEqual(git_calls, [])
        self.assertEqual(nodes_run, ["load_approved", "refuse"])
        self.assertFalse(result.state.fact("published"))
        self.assertIn(expect, " ".join(r.reason for r in result.state.rejections))

    def test_repo_root_equal_to_the_live_checkout_is_refused(self):
        self._assert_refused(P.PublishConfig(pg={}, carta="0.7", repo_root=P.LIVE_CHECKOUT),
                             "live checkout")

    def test_a_symlink_or_dotdot_path_to_it_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            link = Path(tmp) / "innocent"
            link.symlink_to(P.LIVE_CHECKOUT)
            self._assert_refused(P.PublishConfig(pg={}, carta="0.7", repo_root=link), "live checkout")
        self._assert_refused(
            P.PublishConfig(pg={}, carta="0.7", repo_root=P.LIVE_CHECKOUT / "data" / ".."),
            "live checkout")

    def test_no_configured_root_is_refused_for_a_real_run(self):
        env = os.environ.pop(P.REPO_ROOT_ENV, None)
        try:
            self._assert_refused(P.PublishConfig(pg={}, carta="0.7"), "no repo root configured")
        finally:
            if env is not None:
                os.environ[P.REPO_ROOT_ENV] = env

    def test_a_directory_that_is_not_a_checkout_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._assert_refused(P.PublishConfig(pg={}, carta="0.7", repo_root=Path(tmp)),
                                 "not a git checkout")

    def test_a_git_worktree_of_the_live_repo_is_refused(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            live = Path(tmp) / "live"
            live.mkdir()
            g = lambda *a, cwd=live: subprocess.run(
                ["git", "-c", "user.name=t", "-c", "user.email=t@t", *a], cwd=cwd,
                check=True, capture_output=True)
            g("init", "-q"); g("commit", "-q", "--allow-empty", "-m", "x")
            sibling = Path(tmp) / "wt-sibling"
            g("worktree", "add", "-q", "-b", "b1", str(sibling))
            inside = live / ".worktrees" / "wt"
            g("worktree", "add", "-q", "-b", "b2", str(inside))
            real = P.LIVE_CHECKOUT
            P.LIVE_CHECKOUT = live
            try:
                self._assert_refused(P.PublishConfig(pg={}, carta="0.7", repo_root=sibling), "live checkout")
                self._assert_refused(P.PublishConfig(pg={}, carta="0.7", repo_root=inside), "live checkout")
                with self.assertRaises(RuntimeError):
                    P._run_git(sibling, "status")
            finally:
                P.LIVE_CHECKOUT = real

    def test_run_git_itself_refuses_the_live_checkout(self):
        with self.assertRaises(RuntimeError):
            P._run_git(P.LIVE_CHECKOUT, "status")

    def test_the_guard_follows_whatever_LIVE_CHECKOUT_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = _scratch_repo(Path(tmp))
            real = P.LIVE_CHECKOUT
            P.LIVE_CHECKOUT = repo
            try:
                self._assert_refused(P.PublishConfig(pg={}, carta="0.7", repo_root=repo),
                                     "live checkout")
            finally:
                P.LIVE_CHECKOUT = real


class AtlasEntryIsComplete(unittest.TestCase):
    """F3: the entry the node writes must satisfy `AtlasEntry` or the Vercel
    build breaks on the first real publish."""

    def _required_keys(self):
        ts = (ROOT / "lib" / "voyages.ts").read_text(encoding="utf-8")
        body = re.search(r"export interface AtlasEntry \{(.*?)\n\}", ts, re.S).group(1)
        return re.findall(r"^\s{2}(\w+)(\?)?:", body, re.M)

    def test_a_real_run_writes_every_required_key_with_a_legal_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = _scratch_repo(Path(tmp))
            with _sandbox(FakeDb(_submission())) as (git_calls, nodes_run):
                result = P.run_publish(P.PublishConfig(pg={}, carta="0.7", repo_root=repo), 1,
                                       run_id="test-atlas-entry")
            self.assertTrue(result.state.fact("published"), result.state.rejections)
            ts = (repo / "lib" / "voyages.ts").read_text(encoding="utf-8")
            entry = ts[ts.index('slug: "test-voyage-1500"') - 6:]
            entry = entry[:entry.index("  },\n") + 5]
            for key, optional in self._required_keys():
                if not optional:
                    self.assertRegex(entry, rf"\b{key}:", f"AtlasEntry.{key} missing from the entry")
            profiles = re.search(r"export type VisualProfile = (.*?);",
                                 (ROOT / "lib" / "voyageIllustrations.ts").read_text(), re.S).group(1)
            written = re.search(r'visualProfile: "([^"]+)"', entry).group(1)
            self.assertIn(f'"{written}"', profiles)
            self.assertEqual(git_calls[-1][1], ("push", "origin", "HEAD:main"))
            self.assertTrue(all(root == str(repo) for root, _ in git_calls))


if __name__ == "__main__":
    unittest.main()
