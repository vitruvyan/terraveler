"""Offline behavior checks for the private, source-bound $2 content pilot."""
import copy
import contextlib
import io
import hashlib
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


def evidence_catalog(data=None):
    data = data or bundle()
    text = data['sources'][0]['text']
    start, end = text.index('They'), text.index(' Afterwards.')
    return {'protocol': 'evidence-v2', 'bundle_sha256': C.digest(data),
            'missions': copy.deepcopy(data['missions']),
            'evidence': [{'id': 'body01', 'source_id': 'chronicle', 'kind': 'source-text',
                          'start': start, 'end': end, 'source_sha256': hashlib.sha256(text.encode()).hexdigest()},
                         {'id': 'meta01', 'source_id': 'chronicle', 'kind': 'provenance-metadata',
                          'field': 'edition', 'value': data['sources'][0]['provenance']['edition']}]}


def evidence_research():
    return {'status': 'supported', 'title': 'Motux in the chronicle', 'title_evidence_ids': ['body01'],
            'summary': 'The author describes a four-day stay at Motux.', 'summary_evidence_ids': ['body01'],
            'claims': [{'text': 'The author reports staying four days.', 'evidence_ids': ['body01']}],
            'limitations': []}


def calibration_fixture():
    negative = evidence_research()
    negative['claims'][0]['text'] = 'They arrived on 1 January 1532.'
    return {'protocol': 'evidence-v2', 'cases': [
        {'id': 'case01', 'mission_id': 'motux', 'draft': evidence_research(),
         'expected': 'pass', 'reason': 'Paraphrase is supported despite line breaks.'},
        {'id': 'case02', 'mission_id': 'motux', 'draft': negative,
         'expected': 'revise', 'reason': 'The passage supplies no exact arrival date.'}]}


def calibration_review():
    return {'reviews': [review('case01')['reviews'][0], review('case02', 'revise')['reviews'][0]]}


class EvidenceTests(unittest.TestCase):
    setUp = PilotTests.setUp
    provider = PilotTests.provider

    def configure(self):
        self.catalog_path = Path(self.temp.name) / 'catalog.json'
        self.calibration_path = Path(self.temp.name) / 'calibration.json'
        self.catalog_path.write_text(json.dumps(evidence_catalog()))
        self.calibration_path.write_text(json.dumps(calibration_fixture()))
        patcher = patch.object(C, 'CALIBRATION_FILE', self.calibration_path)
        patcher.start(); self.addCleanup(patcher.stop)

    def v2(self):
        result = C.EvidencePilot(self.source_path, self.catalog_path, self.directory)
        result.client = OpenAIClient('fixture-secret-do-not-trace', result.ledger)
        return result

    def checked(self, candidate, data=None):
        data = data or bundle()
        return C.validate_evidence_research(candidate, data['missions'][0], evidence_catalog(data),
                                            {s['id']: s for s in data['sources']})

    def test_original_prompts_remain_byte_identical_for_paid_cache(self):
        expected = {'RESEARCH': 'd4d86f47be587efcf24d52a00e8d718f19c26b4419331721b6c638d8b7b41e09',
                    'REVIEW': '084b9e72bbd69e77d875ca1c221eb4970f4554b3616b168b1d28940a471913eb',
                    'REVISION_RESEARCH': '4fc2d85e3ceb63fc53835ea1f4ecb77113f13f69b456540d7b16a3fbc5902b0b',
                    'REVISION_REVIEW': '0f691751015b543dbc620edb3ff5e9a2193566d41864e09c075c221c7d4f442a'}
        for key, value in expected.items():
            self.assertEqual(hashlib.sha256(getattr(C, key).encode()).hexdigest(), value)

    def test_selected_body_is_program_copied_and_metadata_never_becomes_quote(self):
        candidate = evidence_research()
        candidate['claims'].append({'text': 'The edition label describes a reprint.', 'evidence_ids': ['meta01']})
        result = self.checked(candidate)
        self.assertFalse(result['findings'])
        body, metadata = result['evidence']
        self.assertEqual(body['quote_raw'], 'They stayed\n\n  four days at Motux.')
        self.assertEqual(bundle()['sources'][0]['text'][body['source_span_start']:body['source_span_end']], body['quote_raw'])
        self.assertNotIn('quote_raw', metadata)
        self.assertEqual(metadata['value'], bundle()['sources'][0]['provenance']['edition'])

    def test_freehand_quote_keys_unknown_and_unassigned_ids_are_rejected(self):
        for mutation in ('quote', 'unknown', 'foreign', 'title', 'summary', 'url', 'empty-supported'):
            candidate, data = evidence_research(), bundle()
            if mutation == 'quote': candidate['claims'][0]['quote'] = 'invented'
            if mutation == 'unknown': candidate['claims'][0]['evidence_ids'] = ['unknown']
            if mutation == 'foreign': data['missions'][0]['source_ids'] = []
            if mutation == 'title': candidate['title_evidence_ids'] = []
            if mutation == 'summary': candidate['summary_evidence_ids'] = ['unknown']
            if mutation == 'url': candidate['limitations'] = ['https://invented.example/']
            if mutation == 'empty-supported': candidate['claims'] = []
            with self.subTest(mutation=mutation):self.assertTrue(self.checked(candidate, data)['findings'])

    def test_exact_abstention_is_valid_but_unsupported_descriptive_abstention_is_not(self):
        result = self.checked(copy.deepcopy(C.ABSTENTION))
        self.assertFalse(result['findings']);self.assertEqual(result['status'], 'insufficient-evidence')
        altered = copy.deepcopy(C.ABSTENTION);altered['summary'] = 'No oral histories survived at Motux.'
        self.assertTrue(self.checked(altered)['findings'])

    def test_catalog_source_offsets_hash_metadata_literal_and_mission_bindings_fail_closed(self):
        self.configure()
        self.assertEqual(C.load_evidence_catalog(self.catalog_path, bundle()), evidence_catalog())
        for mutation in ('offset', 'bool', 'partial', 'hash', 'metadata', 'source', 'task-source', 'bundle'):
            c = evidence_catalog()
            if mutation == 'offset': c['evidence'][0]['end'] = 99999
            if mutation == 'bool': c['evidence'][0]['start'] = True
            if mutation == 'partial': c['evidence'][0]['start'] += 1
            if mutation == 'hash': c['evidence'][0]['source_sha256'] = '0' * 64
            if mutation == 'metadata': c['evidence'][1]['value'] = 'Original eyewitness manuscript'
            if mutation == 'source': c['evidence'][1]['source_id'] = 'unknown'
            if mutation == 'task-source': c['missions'][0]['source_ids'] = ['unknown']
            if mutation == 'bundle': c['bundle_sha256'] = '0' * 64
            self.catalog_path.write_text(json.dumps(c))
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):C.load_evidence_catalog(self.catalog_path, bundle())

    def test_success_preserves_baseline_files_ledger_and_resume_is_free(self):
        self.configure()
        with self.provider([research(), review()]):C.run_graph(self.pilot)
        baseline = {name: (self.directory / name).read_bytes() for name in ('spec.json', 'dossier.json', 'dossier.md')}
        v2 = self.v2()
        with self.provider([calibration_review(), evidence_research(), review()]):C.run_graph(v2)
        self.assertEqual(len(self.requests), 5);self.assertEqual(v2.dossier['status'], 'awaiting-human')
        self.assertEqual(v2.ledger.summary()['spent_microdollars'], 1400)
        self.assertTrue(v2.calibration_passed)
        sent = json.loads(self.requests[2]['input'][1]['content'])
        self.assertNotIn('expected', C.canonical(sent));self.assertNotIn('reason', sent)
        self.assertEqual(self.requests[2]['input'][0]['content'], self.requests[4]['input'][0]['content'])
        for name, raw in baseline.items():self.assertEqual((self.directory / name).read_bytes(), raw)
        with patch('outreach_core._request', side_effect=AssertionError('no new namespace retry')) as api:
            C.run_graph(self.v2())
        api.assert_not_called()
        self.assertTrue((self.directory / 'spec-evidence-v2.json').is_file())
        self.assertTrue((self.directory / 'dossier-evidence-v2.md').is_file())

    def test_bad_incomplete_duplicate_or_wrong_calibration_blocks_research_and_exports(self):
        self.configure()
        for variant in ('wrong', 'missing', 'duplicate', 'extra'):
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as tmp:
                pilot = C.EvidencePilot(self.source_path, self.catalog_path, Path(tmp))
                pilot.client = OpenAIClient('fixture-secret', pilot.ledger)
                result = calibration_review()
                if variant == 'wrong':result['reviews'][1] = review('case02')['reviews'][0]
                if variant == 'missing':result['reviews'].pop()
                if variant == 'duplicate':result['reviews'][1] = result['reviews'][0]
                if variant == 'extra':result['unexpected'] = True
                with patch('outreach_core._request', return_value=response(result)) as api:C.run_graph(pilot)
                self.assertEqual(api.call_count, 1)
                self.assertEqual(pilot.dossier['status'], 'needs-revision');self.assertFalse(pilot.checked)
                self.assertTrue((Path(tmp) / 'calibration-v2.json').is_file())
                with patch('outreach_core._request') as api:C.run_graph(C.EvidencePilot(self.source_path, self.catalog_path, Path(tmp)))
                api.assert_not_called()

    def test_abstention_counts_separately_from_supported_or_completed_missions(self):
        self.configure();pilot = self.v2()
        with self.provider([calibration_review(), copy.deepcopy(C.ABSTENTION), review()]):C.run_graph(pilot)
        self.assertEqual(pilot.dossier['status'], 'insufficient-evidence')
        self.assertEqual(pilot.dossier['outcomes'], {'supported': 0, 'insufficient-evidence': 1,
                                                   'rejected': 0, 'not-reviewed': 0})

    def test_supported_self_declaration_is_not_counted_when_reviewer_rejects(self):
        self.configure();pilot = self.v2()
        with self.provider([calibration_review(), evidence_research(), review(verdict='revise')]):C.run_graph(pilot)
        self.assertEqual(pilot.dossier['outcomes'], {'supported': 0, 'insufficient-evidence': 0,
                                                   'rejected': 1, 'not-reviewed': 0})
        self.assertEqual(pilot.dossier['declared_status_counts']['supported'], 1)
        self.assertEqual(pilot.dossier['status'], 'needs-revision')

    def test_changed_catalog_calibration_or_task_stops_before_any_paid_reuse(self):
        self.configure()
        with self.provider([calibration_review(), evidence_research(), review()]):C.run_graph(self.v2())
        for mutation in ('catalog', 'calibration', 'task'):
            c, cal = evidence_catalog(), calibration_fixture()
            if mutation == 'catalog':c['evidence'][0]['end'] -= 1
            if mutation == 'calibration':cal['cases'][0]['reason'] += ' Changed.'
            if mutation == 'task':c['missions'][0]['task'] += ' Changed.'
            self.catalog_path.write_text(json.dumps(c));self.calibration_path.write_text(json.dumps(cal))
            with self.subTest(mutation=mutation), patch('outreach_core._request') as api, self.assertRaises(Exception):C.run_graph(self.v2())
            api.assert_not_called()

    def test_changed_protocol_spec_stops_before_overwriting_saved_spec(self):
        self.configure()
        with self.provider([calibration_review(), evidence_research(), review()]):C.run_graph(self.v2())
        original = (self.directory / 'spec-evidence-v2.json').read_bytes()
        changed = copy.deepcopy(C.EVIDENCE_SPEC_DICT);changed['version'] = '2.0.1'
        with patch.object(C, 'EVIDENCE_SPEC_DICT', changed), patch('outreach_core._request') as api, self.assertRaises(Exception):
            C.run_graph(self.v2())
        api.assert_not_called()
        self.assertEqual((self.directory / 'spec-evidence-v2.json').read_bytes(), original)

    def test_positive_calibration_paraphrase_is_mechanically_valid_while_critic_must_judge_negative(self):
        cases = calibration_fixture()['cases']
        for case in cases:
            self.assertFalse(self.checked(case['draft'])['findings'])
        # A genuine interpretation error has valid evidence IDs; the critic's
        # rejection is necessary, rather than trusting mechanical membership.
        self.assertEqual(cases[1]['expected'], 'revise')

    def test_invalid_final_review_is_cached_and_cannot_claim_ready(self):
        self.configure();pilot = self.v2()
        with self.provider([calibration_review(), evidence_research(), {'reviews': []}]):C.run_graph(pilot)
        self.assertEqual(pilot.dossier['status'], 'needs-revision')
        self.assertEqual(pilot.dossier['review_validation'], 'invalid-or-skipped')
        self.assertEqual(pilot.dossier['outcomes']['supported'], 0)
        self.assertEqual(pilot.dossier['outcomes']['not-reviewed'], 1)
        with patch('outreach_core._request') as api:C.run_graph(self.v2())
        api.assert_not_called()

    def test_uncertain_call_blocks_all_protocols_without_retry(self):
        self.configure()
        with self.provider([RemoteError('uncertain provider')]), self.assertRaises(Exception):C.run_graph(self.v2())
        for pilot in (self.v2(), C.Pilot(self.source_path, self.directory)):
            with patch('outreach_core._request') as api, self.assertRaises(Exception):C.run_graph(pilot)
            api.assert_not_called()

    def test_insufficient_budget_or_orphan_reservation_creates_no_paid_attempt(self):
        self.configure()
        reservation = self.pilot.ledger.reserve(C.MODEL, 990_000, 2000)
        self.pilot.ledger.settle(reservation, 990_000, 2000)
        with patch('outreach_core._request') as api, self.assertRaises(Exception):C.run_graph(self.v2())
        api.assert_not_called()
        with self.pilot.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM content_attempts').fetchone()[0], 0)
        with tempfile.TemporaryDirectory() as tmp:
            pilot = C.EvidencePilot(self.source_path, self.catalog_path, Path(tmp))
            pilot.ledger.reserve(C.MODEL, 10, 2000)
            with patch('outreach_core._request') as api, self.assertRaises(Exception):C.run_graph(pilot)
            api.assert_not_called()
            with pilot.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM content_attempts').fetchone()[0], 0)

    def test_v2_trace_validates_and_omits_private_text_and_credentials(self):
        self.configure()
        with self.provider([calibration_review(), evidence_research(), review()]):C.run_graph(self.v2())
        files = list((self.directory / 'traces-evidence-v2').glob('*.jsonl'))
        self.assertEqual(len(files), 1)
        trace = files[0].read_text()
        for text in ('fixture-secret-do-not-trace', evidence_research()['summary'], bundle()['sources'][0]['text']):
            self.assertNotIn(text, trace)
        checked = subprocess.run([sys.executable, '-m', 'vitruvyan_motus.contract.validate', 'jsonl', str(files[0]),
                                  '--spec', str(self.directory / 'spec-evidence-v2.json')],capture_output=True,text=True)
        self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)

    def test_real_v2_fixtures_and_free_cli_preview_require_no_credentials_or_runtime_writes(self):
        data = C.load_bundle(C.ROOT / 'scripts/fixtures/content-swarm-pizarro.json')
        cat = C.load_evidence_catalog(C.ROOT / 'scripts/fixtures/content-swarm-pizarro-evidence-v2.json', data)
        cal = C.load_calibration(C.CALIBRATION_FILE, cat)
        self.assertEqual(len(cat['missions']), 3);self.assertEqual({c['expected']for c in cal['cases']}, {'pass', 'revise'})
        with patch.object(C,'OUTPUT',self.directory),patch.object(C,'OpenAIClient')as api,patch.object(C,'load_secrets')as secrets,contextlib.redirect_stdout(io.StringIO()):
            result = C.main(['--sources', str(C.ROOT / 'scripts/fixtures/content-swarm-pizarro.json'),
                             '--evidence-v2', str(C.ROOT / 'scripts/fixtures/content-swarm-pizarro-evidence-v2.json')])
        self.assertEqual(result,0);api.assert_not_called();secrets.assert_not_called()
        self.assertFalse((self.directory/'dossier-evidence-v2.json').exists())


class CalibrationCorrectionTests(unittest.TestCase):
    """One explicit namespace after a completed failed benchmark; no retries."""
    setUp = PilotTests.setUp
    provider = PilotTests.provider
    configure = EvidenceTests.configure
    v2 = EvidenceTests.v2
    def configure_correction(self):
        self.configure()
        self.correction_path = Path(self.temp.name) / 'correction.json'
        fixture = calibration_fixture()
        fixture['cases'][0]['task'] = 'Describe only the source-supported four-day stay.'
        self.correction_path.write_text(json.dumps(fixture))
        patcher = patch.object(C, 'CORRECTION_CALIBRATION_FILE', self.correction_path)
        patcher.start();self.addCleanup(patcher.stop)

    def correction(self):
        pilot = C.EvidencePilot(self.source_path, self.catalog_path, self.directory, calibration_correction=True)
        pilot.client = OpenAIClient('fixture-secret-do-not-trace', pilot.ledger)
        return pilot

    def failed_original(self):
        verdict = calibration_review()
        verdict['reviews'][1] = review('case02')['reviews'][0]
        with self.provider([verdict]):C.run_graph(self.v2())

    def test_correction_requires_verified_completed_failed_original(self):
        self.configure_correction()
        with patch('outreach_core._request') as api,self.assertRaises(Exception):C.run_graph(self.correction())
        api.assert_not_called()
        with self.provider([calibration_review(),evidence_research(),review()]):C.run_graph(self.v2())
        with patch('outreach_core._request') as api,self.assertRaises(Exception):C.run_graph(self.correction())
        api.assert_not_called()
        with self.pilot.db() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM content_attempts WHERE id LIKE '%calibration-correction%'").fetchone()[0],0)

    def test_correction_preserves_failed_artifacts_ledger_and_uses_override_only_in_calibration(self):
        self.configure_correction();self.failed_original()
        names=['spec-evidence-v2.json','calibration-v2.json','calibration-v2.md',
               'dossier-evidence-v2.json','dossier-evidence-v2.md']
        frozen={name:(self.directory/name).read_bytes()for name in names}
        with self.pilot.db()as db:
            manifest=db.execute("SELECT digest FROM content_protocol_manifests WHERE protocol='evidence-v2'").fetchone()
            attempt=db.execute("SELECT * FROM content_attempts WHERE id='evidence-v2:review-calibration'").fetchone()
        pilot=self.correction()
        with self.provider([calibration_review(),evidence_research(),review()]):C.run_graph(pilot)
        self.assertEqual(len(self.requests),4)
        self.assertEqual(pilot.ledger.summary()['cap_microdollars'],C.CAP)
        self.assertEqual(pilot.ledger.summary()['spent_microdollars'],1120)
        self.assertEqual(pilot.dossier['status'],'awaiting-human')
        calibration_payload=json.loads(self.requests[1]['input'][1]['content'])
        research_payload=json.loads(self.requests[2]['input'][1]['content'])
        final_payload=json.loads(self.requests[3]['input'][1]['content'])
        self.assertEqual(calibration_payload['missions'][0]['task'],'Describe only the source-supported four-day stay.')
        self.assertEqual(research_payload['mission'],bundle()['missions'][0])
        self.assertEqual(final_payload['missions'],bundle()['missions'])
        self.assertEqual(self.requests[0]['input'][0]['content'],self.requests[1]['input'][0]['content'])
        for name,body in frozen.items():self.assertEqual((self.directory/name).read_bytes(),body)
        with self.pilot.db()as db:
            self.assertEqual(db.execute("SELECT digest FROM content_protocol_manifests WHERE protocol='evidence-v2'").fetchone(),manifest)
            self.assertEqual(db.execute("SELECT * FROM content_attempts WHERE id='evidence-v2:review-calibration'").fetchone(),attempt)
        with patch('outreach_core._request')as api:C.run_graph(self.correction())
        api.assert_not_called()
        self.assertTrue((self.directory/'dossier-evidence-v2-correction-1.md').is_file())
        trace=next((self.directory/'traces-evidence-v2-correction-1').glob('*.jsonl'))
        checked=subprocess.run([sys.executable,'-m','vitruvyan_motus.contract.validate','jsonl',str(trace),
                                '--spec',str(self.directory/'spec-evidence-v2-correction-1.json')],capture_output=True,text=True)
        self.assertEqual(checked.returncode,0,checked.stdout+checked.stderr)

    def test_failed_correction_is_cached_and_never_auto_loops(self):
        self.configure_correction();self.failed_original()
        bad=calibration_review();bad['reviews'][1]=review('case02')['reviews'][0]
        with self.provider([bad]):C.run_graph(self.correction())
        self.assertEqual(len(self.requests),2)
        with patch('outreach_core._request')as api:C.run_graph(self.correction())
        api.assert_not_called()
        dossier=json.loads((self.directory/'dossier-evidence-v2-correction-1.json').read_text())
        self.assertEqual(dossier['status'],'needs-revision')
        self.assertEqual(dossier['outcomes']['not-reviewed'],1)

    def test_tampered_original_cache_or_digest_cannot_authorize_correction(self):
        self.configure_correction();self.failed_original()
        with self.pilot.db()as db:
            db.execute("UPDATE content_attempts SET result='{}' WHERE id='evidence-v2:review-calibration'")
        with patch('outreach_core._request')as api,self.assertRaises(Exception):C.run_graph(self.correction())
        api.assert_not_called()

    def test_correction_fixture_or_override_change_blocks_before_saved_spec_write(self):
        self.configure_correction();self.failed_original()
        with self.provider([calibration_review(),evidence_research(),review()]):C.run_graph(self.correction())
        spec=(self.directory/'spec-evidence-v2-correction-1.json').read_bytes()
        changed=json.loads(self.correction_path.read_text());changed['cases'][0]['task']+=' Changed.'
        self.correction_path.write_text(json.dumps(changed))
        with patch('outreach_core._request')as api,self.assertRaises(Exception):C.run_graph(self.correction())
        api.assert_not_called();self.assertEqual((self.directory/'spec-evidence-v2-correction-1.json').read_bytes(),spec)

    def test_calibration_task_override_is_bounded_and_cannot_override_sources(self):
        self.configure_correction()
        for field,value in [('task',''),('task','x'*2001),('task',None),('source_ids',['unknown'])]:
            fixture=calibration_fixture();fixture['cases'][0][field]=value
            self.correction_path.write_text(json.dumps(fixture))
            with self.subTest(field=field,value_type=type(value)),self.assertRaises(ValueError):
                C.load_calibration(self.correction_path,evidence_catalog())

    def test_cli_correction_requires_evidence_v2(self):
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
            C.main(['--sources','unused.json','--calibration-correction','--run'])


if __name__ == '__main__':
    unittest.main()
