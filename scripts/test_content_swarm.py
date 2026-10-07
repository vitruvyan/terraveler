"""Offline behavior checks for the private, source-bound $2 content pilot."""
import copy
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import content_swarm as C
from outreach_core import BudgetExceeded, OpenAIClient, RemoteError


def bundle():
    return {'sources': [{'id': 'chronicle', 'url': 'https://www.gutenberg.org/ebooks/26602',
                         'title': 'Fixture chronicle', 'license': 'Public domain',
                         'text': 'Before. They stayed\n\n  four days at Motux. Afterwards.',
                         'provenance': {'edition': '1872 translation, 1970 reprint',
                                        'notes': ['Participant perspective, not neutral fact.']}}],
            'missions': [{'id': 'motux', 'task': 'Describe what the source says about the stop.',
                          'source_ids': ['chronicle']}]}


def research():
    return {'title': 'Attributed stop at Motux', 'summary': 'The chronicle describes a four-day stay.',
            'claims': [{'text': 'The author describes staying four days at Motux.',
                        'source_id': 'chronicle', 'quote': 'They stayed four days at Motux.'}],
            'limitations': ['The passage supplies no exact arrival date.']}


def review(ident='motux', verdict='pass'):
    return {'reviews': [{'mission_id': ident, 'verdict': verdict,
                         'findings': [] if verdict == 'pass' else ['Needs evidence for the summary.']}]}


def response(result, input_tokens=20, output_tokens=30):
    return {'status': 'completed', 'usage': {'input_tokens': input_tokens, 'output_tokens': output_tokens},
            'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(result)}]}]}


class CorpusTests(unittest.TestCase):
    def checked(self, result):
        data = bundle()
        return C.validate_research(result, data['missions'][0], {s['id']: s for s in data['sources']})

    def test_verbatim_whitespace_match_restores_source_not_model_quote(self):
        checked = self.checked(research())
        self.assertEqual(checked['findings'], [])
        claim = checked['claims'][0]
        self.assertEqual(claim['quote_raw'], 'They stayed\n\n  four days at Motux.')
        self.assertEqual(claim['quote_reading'], 'They stayed\n\nfour days at Motux.')
        text = bundle()['sources'][0]['text']
        self.assertEqual(text[claim['source_span_start']:claim['source_span_end']], claim['quote_raw'])
        self.assertEqual(claim['source_url'], bundle()['sources'][0]['url'])

    def test_case_punctuation_changed_or_fabricated_quotes_are_rejected(self):
        for quote in ('they stayed four days at Motux.', 'They stayed four days at Motux!',
                      'They stayed five days at Motux.', 'the'):
            candidate = research()
            candidate['claims'][0]['quote'] = quote
            with self.subTest(quote=quote):
                checked = self.checked(candidate)
                self.assertTrue(checked['findings'])
                self.assertFalse(checked['claims'])

    def test_quote_cannot_match_inside_a_source_word(self):
        data, candidate = bundle(), research()
        data['sources'][0]['text'] = 'another expedition'
        candidate['claims'][0]['quote'] = 'other'
        checked = C.validate_research(candidate, data['missions'][0], {'chronicle': data['sources'][0]})
        self.assertEqual(checked['findings'], ['claim_0:quotation_not_exact_in_source'])

    def test_unknown_unassigned_sources_and_generated_urls_fail(self):
        for mutation in ('source', 'url', 'extra'):
            candidate = research()
            if mutation == 'source': candidate['claims'][0]['source_id'] = 'unknown'
            if mutation == 'url': candidate['summary'] += ' https://invented.example/'
            if mutation == 'extra': candidate['claims'][0]['url'] = 'https://invented.example/'
            with self.subTest(mutation=mutation):
                self.assertTrue(self.checked(candidate)['findings'])

    def test_review_must_cover_every_mission_once_and_supply_valid_verdicts(self):
        missions = bundle()['missions']
        self.assertIsNotNone(C.validate_reviews(review(), missions))
        for result in ({'reviews': []}, {'reviews': review()['reviews'] * 2}, review('unknown'),
                       {'reviews': [{'mission_id': 'motux', 'verdict': 'publish', 'findings': []}]},
                       {'reviews': [{'mission_id': 'motux', 'verdict': 'revise', 'findings': []}]}):
            with self.subTest(result=result):
                self.assertIsNone(C.validate_reviews(result, missions))

    def test_bundle_limits_license_whitelist_and_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'sources.json'
            data = bundle()
            path.write_text(json.dumps(data))
            self.assertEqual(C.load_bundle(path), data)
            for mutation in ('url', 'license', 'large', 'missing', 'duplicate'):
                candidate = copy.deepcopy(data)
                if mutation == 'url': candidate['sources'][0]['url'] = 'https://copyrighted.example/book'
                if mutation == 'license': candidate['sources'][0]['license'] = 'CC BY-NC 4.0'
                if mutation == 'large': candidate['sources'][0]['text'] = 'x' * 30001
                if mutation == 'missing': candidate['missions'][0]['source_ids'] = ['unknown']
                if mutation == 'duplicate': candidate['missions'][0]['source_ids'] *= 2
                path.write_text(json.dumps(candidate))
                with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                    C.load_bundle(path)

    def test_real_pizarro_fixture_preserves_reprint_and_commons_metadata(self):
        data = C.load_bundle(C.ROOT / 'scripts/fixtures/content-swarm-pizarro.json')
        self.assertEqual(len(data['missions']), 3)
        xerez = next(s for s in data['sources'] if s['id'] == 'xerez-motux')
        self.assertIn('1970', xerez['provenance']['edition'])
        image = next(s for s in data['sources'] if s.get('asset'))
        self.assertEqual(image['license'], 'CC BY-SA 4.0')
        self.assertTrue(C._licensed(image['asset']['license']))

    def test_default_cli_is_free_preview_and_creates_no_runtime_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'sources.json'
            path.write_text(json.dumps(bundle()))
            with patch.object(C, 'OUTPUT', Path(tmp) / 'output'), patch.object(C, 'OpenAIClient') as client, \
                    patch.object(C, 'load_secrets') as secrets, contextlib.redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(C.main(['--sources', str(path)]), 0)
            client.assert_not_called()
            secrets.assert_not_called()
            self.assertEqual(json.loads(stdout.getvalue())['api_calls'], 0)
            self.assertFalse((Path(tmp) / 'output').exists())

    def test_revision_cli_requires_explicit_run(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error, \
                patch.object(C, 'OpenAIClient') as client:
            C.main(['--sources', 'unused.json', '--revise'])
        self.assertEqual(error.exception.code, 2)
        client.assert_not_called()


class PilotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'pilot'
        self.source_path = Path(self.temp.name) / 'sources.json'
        self.source_path.write_text(json.dumps(bundle()))
        self.pilot = C.Pilot(self.source_path, self.directory)
        self.pilot.client = OpenAIClient('fixture-secret-do-not-trace', self.pilot.ledger)
        self.requests = []

    def provider(self, results):
        queue = iter(results)
        def request(base, key, path, payload):
            self.assertEqual(base, 'https://api.openai.com')
            self.assertEqual(path, '/v1/responses')
            self.assertEqual(payload['model'], 'gpt-4.1')
            self.assertEqual(payload['max_output_tokens'], 2000)
            self.assertFalse(payload['store'])
            # The attempt is committed before any paid request crosses the boundary.
            with self.pilot.db() as db:
                self.assertEqual(db.execute("SELECT count(*) FROM content_attempts WHERE status='started'").fetchone()[0], 1)
            self.requests.append(payload)
            value = next(queue)
            if isinstance(value, BaseException): raise value
            return response(value)
        return patch('outreach_core._request', side_effect=request)

    def test_success_exports_private_dossier_then_resumes_without_paid_calls(self):
        with C.run_lock(self.directory), self.provider([research(), review()]):
            C.run_graph(self.pilot)
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(self.pilot.dossier['status'], 'awaiting-human')
        self.assertEqual(self.pilot.dossier['publication_authority'], 'human-editor')
        self.assertEqual(self.pilot.ledger.summary()['cap_microdollars'], 2_000_000)
        self.assertEqual(self.pilot.ledger.summary()['pending_requests'], 0)
        self.assertEqual(self.pilot.ledger.summary()['spent_microdollars'], 560)
        sent = json.loads(self.requests[0]['input'][1]['content'])
        self.assertEqual(sent['sources'][0]['provenance'], bundle()['sources'][0]['provenance'])
        self.assertIn('title and summary', self.requests[1]['input'][0]['content'])
        sources_before = self.source_path.read_bytes()
        reopened = C.Pilot(self.source_path, self.directory)
        reopened.client = OpenAIClient('fixture-secret-do-not-trace', reopened.ledger)
        with C.run_lock(self.directory), patch('outreach_core._request', side_effect=AssertionError('no retries')) as api:
            C.run_graph(reopened)
        api.assert_not_called()
        self.assertEqual(self.source_path.read_bytes(), sources_before)
        self.assertEqual(reopened.dossier, self.pilot.dossier)
        self.assertTrue((self.directory / 'dossier.md').is_file())
        self.assertEqual((self.directory / 'budget.sqlite').stat().st_mode & 0o777, 0o600)

    def test_mechanical_or_reviewer_failure_never_claims_human_ready(self):
        for variant in ('false_quote', 'unsupported_summary', 'missing_review', 'duplicate_review'):
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as tmp:
                pilot = C.Pilot(self.source_path, Path(tmp))
                pilot.client = OpenAIClient('fixture-secret', pilot.ledger)
                candidate, verdict = research(), review()
                if variant == 'false_quote': candidate['claims'][0]['quote'] = 'An invented quotation.'
                if variant == 'unsupported_summary':
                    candidate['summary'] = 'They arrived on an exact invented date.'
                    verdict = review(verdict='revise')
                if variant == 'missing_review': verdict = {'reviews': []}
                if variant == 'duplicate_review': verdict['reviews'] *= 2
                with patch('outreach_core._request', side_effect=[response(candidate), response(verdict)]):
                    C.run_graph(pilot)
                self.assertEqual(pilot.dossier['status'], 'needs-revision')
                if variant in ('missing_review', 'duplicate_review'):
                    self.assertEqual(pilot.dossier['review_validation'], 'invalid-or-incomplete')

    def test_changed_source_or_task_digest_stops_before_cached_reuse(self):
        with self.provider([research(), review()]): C.run_graph(self.pilot)
        for key in ('source', 'task'):
            changed = bundle()
            if key == 'source': changed['sources'][0]['text'] += ' Changed.'
            else: changed['missions'][0]['task'] += ' Changed.'
            self.source_path.write_text(json.dumps(changed))
            reopened = C.Pilot(self.source_path, self.directory)
            reopened.client = self.pilot.client
            with self.subTest(key=key), patch('outreach_core._request') as api, self.assertRaises(Exception):
                C.run_graph(reopened)
            api.assert_not_called()

    def test_uncertain_paid_call_stops_all_future_attempts_and_retains_budget(self):
        with self.provider([RemoteError('network ambiguity')]), self.assertRaises(Exception):
            C.run_graph(self.pilot)
        self.assertGreater(self.pilot.ledger.summary()['reserved_microdollars'], 0)
        reopened = C.Pilot(self.source_path, self.directory)
        reopened.client = OpenAIClient('fixture-secret', reopened.ledger)
        with patch('outreach_core._request') as api, self.assertRaises(Exception): C.run_graph(reopened)
        api.assert_not_called()
        with reopened.db() as db:
            self.assertEqual(db.execute('SELECT status FROM content_attempts').fetchone()[0], 'uncertain')
        traces = '\n'.join(path.read_text() for path in (self.directory / 'traces').iterdir())
        self.assertNotIn('fixture-secret', traces)
        self.assertNotIn('network ambiguity', traces)
        self.assertTrue((self.directory / 'spec.json').is_file())

    def test_crash_started_attempt_is_never_retried(self):
        with self.pilot.db() as db:
            db.execute('INSERT INTO content_attempts VALUES(?,?,?,NULL,NULL,NULL)', ('research:motux', 'x' * 64, 'started'))
        with patch('outreach_core._request') as api, self.assertRaises(Exception): C.run_graph(self.pilot)
        api.assert_not_called()

    def test_usage_overflow_blocks_future_calls_even_after_restart(self):
        with patch('outreach_core._request', return_value=response(research(), input_tokens=2_000_000)), \
                self.assertRaises(Exception):
            C.run_graph(self.pilot)
        self.assertTrue(self.pilot.ledger.summary()['blocked'])
        reopened = C.Pilot(self.source_path, self.directory)
        reopened.client = self.pilot.client
        with patch('outreach_core._request') as api, self.assertRaises(Exception): C.run_graph(reopened)
        api.assert_not_called()

    def test_two_dollar_cap_is_lifetime_not_reset_by_instantiation(self):
        reservation = self.pilot.ledger.reserve(C.MODEL, 990_000, 2000)
        self.pilot.ledger.settle(reservation, 990_000, 2000)
        reopened = C.Pilot(self.source_path, self.directory)
        with self.assertRaises(BudgetExceeded): reopened.ledger.reserve(C.MODEL, 4096, 2000)
        self.assertEqual(reopened.ledger.summary()['cap_microdollars'], 2_000_000)
        self.assertEqual(reopened.ledger.summary()['spent_microdollars'], 1_996_000)

    def test_exclusive_lock_prevents_concurrent_pilots(self):
        with C.run_lock(self.directory):
            with self.assertRaises(C.PilotStopped):
                with C.run_lock(self.directory): pass

    def test_revision_requires_completed_original_calls_and_a_revise_verdict(self):
        revision = C.Pilot(self.source_path, self.directory, revision=True)
        revision.client = self.pilot.client
        with patch('outreach_core._request') as api, self.assertRaises(Exception): C.run_graph(revision)
        api.assert_not_called()
        with self.provider([research(), review()]): C.run_graph(self.pilot)
        with patch('outreach_core._request') as api, self.assertRaises(Exception): C.run_graph(revision)
        api.assert_not_called()

    def test_single_revision_retains_original_artifacts_and_reuses_completed_calls(self):
        with self.provider([research(), review(verdict='revise')]): C.run_graph(self.pilot)
        original_json = (self.directory / 'dossier.json').read_bytes()
        original_md = (self.directory / 'dossier.md').read_bytes()
        revision = C.Pilot(self.source_path, self.directory, revision=True)
        revision.client = OpenAIClient('fixture-secret', revision.ledger)
        with self.provider([research(), review()]): C.run_graph(revision)
        self.assertEqual(len(self.requests), 4)
        self.assertEqual(revision.dossier['status'], 'awaiting-human')
        self.assertEqual(revision.dossier['revision_round'], 1)
        self.assertEqual(revision.ledger.summary()['spent_microdollars'], 1120)
        self.assertEqual(revision.ledger.summary()['cap_microdollars'], 2_000_000)
        sent = json.loads(self.requests[2]['input'][1]['content'])
        self.assertEqual(sent['previous_draft'], research())
        self.assertEqual(sent['reviewer_findings'], review(verdict='revise')['reviews'][0]['findings'])
        self.assertEqual(sent['mechanical_findings'], [])
        self.assertIn('ONLY from source.text', self.requests[2]['input'][0]['content'])
        self.assertIn('do NOT require them to be verbatim', self.requests[3]['input'][0]['content'])
        resumed = C.Pilot(self.source_path, self.directory, revision=True)
        resumed.client = revision.client
        with patch('outreach_core._request', side_effect=AssertionError('no second round')) as api: C.run_graph(resumed)
        api.assert_not_called()
        with resumed.db() as db:
            self.assertEqual(db.execute('SELECT id FROM content_attempts ORDER BY id').fetchall(),
                             [('research:motux',), ('research:motux:revision:1',), ('review',), ('review:revision:1',)])
        self.assertEqual((self.directory / 'dossier.json').read_bytes(), original_json)
        self.assertEqual((self.directory / 'dossier.md').read_bytes(), original_md)
        self.assertTrue((self.directory / 'dossier-revision-1.json').is_file())
        self.assertTrue((self.directory / 'dossier-revision-1.md').is_file())

    def test_uncertain_revision_cannot_retry_or_reset_the_budget(self):
        with self.provider([research(), review(verdict='revise')]): C.run_graph(self.pilot)
        revision = C.Pilot(self.source_path, self.directory, revision=True)
        revision.client = OpenAIClient('fixture-secret', revision.ledger)
        with self.provider([RemoteError('revision uncertain')]), self.assertRaises(Exception): C.run_graph(revision)
        pending = revision.ledger.summary()['reserved_microdollars']
        self.assertGreater(pending, 0)
        reopened = C.Pilot(self.source_path, self.directory, revision=True)
        reopened.client = revision.client
        with patch('outreach_core._request') as api, self.assertRaises(Exception): C.run_graph(reopened)
        api.assert_not_called()
        self.assertEqual(reopened.ledger.summary()['reserved_microdollars'], pending)
        self.assertEqual(reopened.ledger.summary()['spent_microdollars'], 560)

    def test_revision_missing_review_fails_closed_and_is_not_repurchased(self):
        with self.provider([research(), review(verdict='revise')]): C.run_graph(self.pilot)
        revision = C.Pilot(self.source_path, self.directory, revision=True)
        revision.client = OpenAIClient('fixture-secret', revision.ledger)
        with self.provider([research(), {'reviews': []}]): C.run_graph(revision)
        self.assertEqual(revision.dossier['status'], 'needs-revision')
        with patch('outreach_core._request') as api: C.run_graph(C.Pilot(self.source_path, self.directory, revision=True))
        api.assert_not_called()

    def test_native_trace_validates_and_contains_digests_not_text_or_credentials(self):
        with self.provider([research(), review()]): C.run_graph(self.pilot)
        files = list((self.directory / 'traces').glob('*.jsonl'))
        self.assertEqual(len(files), 1)
        trace = files[0].read_text()
        for forbidden in ('fixture-secret-do-not-trace', bundle()['sources'][0]['text'],
                          research()['summary'], research()['claims'][0]['quote']):
            self.assertNotIn(forbidden, trace)
        self.assertIn(C.digest(bundle()), trace)
        self.assertIn(C.digest(research()), trace)
        checked = subprocess.run([sys.executable, '-m', 'vitruvyan_motus.contract.validate',
                                  'jsonl', str(files[0]), '--spec', str(self.directory / 'spec.json')],
                                 capture_output=True, text=True)
        self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)
        header = json.loads(trace.splitlines()[0])
        self.assertIn('none', json.dumps(header))


if __name__ == '__main__':
    unittest.main()
