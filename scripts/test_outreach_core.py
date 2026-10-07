from pathlib import Path
import tempfile
import io
import json
import sqlite3
import urllib.error
from concurrent.futures import ThreadPoolExecutor
import unittest
from unittest.mock import patch
from outreach_core import BudgetLedger, BudgetExceeded, NoRedirect, OpenAIClient, RemoteError, cost_microdollars, load_secrets, _request, request_json, MoltbookClient, error_diagnostic

class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'budget.sqlite'

    def test_budget_survives_crash_and_reopen(self):
        ledger = BudgetLedger(self.path, 100)
        ledger.reserve('gpt-4.1-mini', 100, 25)
        self.assertEqual(BudgetLedger(self.path, 5_000_000).summary()['available_microdollars'], 20)
        with self.assertRaises(BudgetExceeded):
            ledger.reserve('gpt-4.1-mini', 100, 25)

    def test_concurrent_reservations_cannot_overspend(self):
        ledger = BudgetLedger(self.path, 100)
        def attempt(_):
            try:
                ledger.reserve("gpt-4.1-mini", 100, 25)
                return True
            except BudgetExceeded:
                return False
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sum(pool.map(attempt, range(4))), 1)
        self.assertEqual(ledger.summary()["reserved_microdollars"], 80)

    def test_settlement_releases_only_unused_reservation(self):
        ledger = BudgetLedger(self.path, 100)
        ident = ledger.reserve('gpt-4.1-mini', 100, 25)
        ledger.settle(ident, 10, 5)
        self.assertEqual(ledger.summary()['spent_microdollars'], 12)
        self.assertEqual(ledger.summary()['reserved_microdollars'], 0)
        with self.assertRaises(ValueError):
            ledger.settle(ident, 20, 5)

    def test_unsupported_model_no_reservation(self):
        ledger = BudgetLedger(self.path)
        with self.assertRaises(ValueError):
            ledger.reserve('other', 100, 100)
        self.assertEqual(ledger.summary()['pending_requests'], 0)
        self.assertEqual(cost_microdollars('gpt-4.1-mini', 1, 0), 1)

    def test_usage_overrun_blocks_future_spend_after_reopen(self):
        ledger = BudgetLedger(self.path, 2_000_000)
        ident = ledger.reserve('gpt-4.1', 100, 16)
        with self.assertRaises(RemoteError):
            ledger.settle(ident, 1000, 100)
        self.assertEqual(ledger.summary()['spent_microdollars'], 2800)
        self.assertTrue(ledger.summary()['blocked'])
        self.assertEqual(ledger.summary()['available_microdollars'], 0)
        reopened = BudgetLedger(self.path, 5_000_000)
        self.assertEqual(reopened.summary()['cap_microdollars'], 2_000_000)
        with self.assertRaises(BudgetExceeded):
            reopened.reserve('gpt-4.1', 100, 16)
        with self.assertRaises(ValueError):
            reopened.settle(ident, 1001, 100)
        self.assertEqual(reopened.summary()['spent_microdollars'], 2800)

    def test_legacy_budget_policy_migrates_without_resetting_spend_or_cap(self):
        ledger = BudgetLedger(self.path, 100)
        ledger.reserve('gpt-4.1-mini', 100, 25)
        with sqlite3.connect(self.path) as db:
            db.execute('DROP TABLE budget_policy')
            db.execute('CREATE TABLE budget_policy(singleton INTEGER PRIMARY KEY,cap INTEGER NOT NULL)')
            db.execute('INSERT INTO budget_policy VALUES(1,100)')
        reopened = BudgetLedger(self.path, 2_000_000)
        self.assertFalse(reopened.summary()['blocked'])
        self.assertEqual(reopened.summary()['cap_microdollars'], 100)
        self.assertEqual(reopened.summary()['reserved_microdollars'], 80)
        with self.assertRaises(BudgetExceeded):
            reopened.reserve('gpt-4.1-mini', 100, 25)

    def test_ambiguous_error_keeps_reservation_no_retry(self):
        ledger = BudgetLedger(self.path)
        with patch('outreach_core._request', side_effect=RemoteError('network')) as request:
            with self.assertRaises(RemoteError):
                OpenAIClient('secret', ledger).generate_json('gpt-4.1-mini', 'Classify', {'text': 'hello'})
            self.assertEqual(request.call_count, 1)
        self.assertEqual(ledger.summary()['pending_requests'], 1)

    def test_success_settles_usage(self):
        ledger = BudgetLedger(self.path)
        result = {'status': 'completed', 'usage': {'input_tokens': 20, 'output_tokens': 10}, 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '{"ok":true}'}]}]}
        with patch('outreach_core._request', return_value=result):
            self.assertEqual(OpenAIClient('secret', ledger).generate_json('gpt-4.1', 'Classify', {}), {'ok': True})
        self.assertEqual(ledger.summary()['spent_microdollars'], 120)

    def test_redirect_refused(self):
        with self.assertRaises(RemoteError):
            NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.example')

    def test_http_error_hides_secrets(self):
        with patch('urllib.request.build_opener', side_effect=RuntimeError('private-token')):
            with self.assertRaises(RemoteError) as caught:
                _request('https://api.openai.com', 'private-token', '/v1/responses', {})
        self.assertNotIn('private-token', str(caught.exception))

    def test_path_rejected(self):
        for path in ('//evil', 'https://evil', '/x\nfoo', '/x\\y'):
            with self.assertRaises(ValueError):
                _request('https://api.openai.com', 'key', path)

    def test_moltbook_relative_paths(self):
        with patch('outreach_core._request', return_value={}) as request:
            MoltbookClient('key').get('home')
            self.assertEqual(request.call_args.args[2], '/api/v1/home')
        with self.assertRaises(ValueError):
            MoltbookClient('key').get('https://evil.example')

    def test_public_transport_fixed_endpoint_no_auth(self):
        with self.assertRaises(ValueError):
            request_json('https://evil.example/api/mcp')
        with self.assertRaises(ValueError):
            request_json('https://www.terraveler.com/api/mcp', headers={'Authorization': 'secret'})
        with patch('urllib.request.build_opener', side_effect=RuntimeError('secret')):
            with self.assertRaises(RemoteError) as caught:
                request_json('https://www.terraveler.com/api/mcp', payload={})
        self.assertNotIn('secret', str(caught.exception))

    def test_env_not_executed(self):
        path = Path(self.tmp.name) / '.env'
        path.write_text('FOO="$(echo should-not-execute)"\n')
        self.assertEqual(load_secrets([path])['FOO'], '$(echo should-not-execute)')

    def test_http_diagnostic_reports_status_enums_hides_message_headers_key(self):
        body = {'error': {'type': 'invalid_request_error', 'code': 'unsupported_parameter',
                         'message': 'private-token sensitive explanation', 'param': 'text.format'}}
        error = urllib.error.HTTPError('https://api.openai.com/private-token', 400,
            'private-token reason', {'Authorization': 'Bearer private-token'},
            io.BytesIO(json.dumps(body).encode()))
        opener = unittest.mock.Mock()
        opener.open.side_effect = error
        with patch('urllib.request.build_opener', return_value=opener):
            with self.assertRaises(RemoteError) as caught:
                _request('https://api.openai.com', 'private-token', '/v1/responses', {})
        self.assertEqual(error_diagnostic(caught.exception), {'category': 'RemoteError',
            'cause': 'RemoteError', 'http_status': 400, 'provider_type': 'invalid_request_error',
            'provider_code': 'unsupported_parameter', 'provider_param': 'text.format'})
        for secret in ('private-token', 'sensitive', 'Authorization', 'Bearer'):
            self.assertNotIn(secret, str(caught.exception))
        self.assertEqual(opener.open.call_count, 1)

    def test_http_diagnostic_rejects_nonenum_and_credential_fields(self):
        for fields in ({'type': 'mysecret', 'code': 'mysecret'},
                       {'type': 'private-token', 'code': 'Bearer private-token'},
                       {'type': {'private-token': 'secret'}, 'code': ['private-token']}):
            with self.subTest(fields=fields):
                error = urllib.error.HTTPError('https://api.openai.com', 429, 'private-token', {},
                    io.BytesIO(json.dumps({'error': fields}).encode()))
                opener = unittest.mock.Mock()
                opener.open.side_effect = error
                with patch('urllib.request.build_opener', return_value=opener):
                    with self.assertRaises(RemoteError) as caught:
                        _request('https://api.openai.com', 'mysecret', '/v1/responses', {})
                self.assertEqual(error_diagnostic(caught.exception),
                                 {'category': 'RemoteError', 'cause': 'RemoteError', 'http_status': 429})

    def test_http_diagnostic_bounds_body_and_unwraps_motus_without_message(self):
        from outreach_core import http_failure
        from vitruvyan_motus.errors import NodeFailed
        for body in (b'invalid private-token json', b'x' * 4097):
            remote = http_failure(urllib.error.HTTPError('private-token', 503, 'private-token', {}, io.BytesIO(body)))
            wrapped = NodeFailed('plan', None, cause=remote)
            self.assertEqual(error_diagnostic(wrapped),
                             {'category': 'NodeFailed', 'cause': 'RemoteError', 'http_status': 503})
            self.assertNotIn('private-token', str(remote))
        arbitrary = RuntimeError('private-token sensitive explanation')
        self.assertEqual(error_diagnostic(arbitrary), {'category': 'RuntimeError'})

    def test_http_safe_reason_classification_and_parameter_path(self):
        from outreach_core import http_failure
        cases = [('Input messages must contain the word JSON. private-token', 'missing_json_instruction'),
                 ('Unsupported parameter private-token', 'unsupported_parameter'),
                 ('Invalid type private-token', 'invalid_type')]
        for message, reason in cases:
            body = {'error': {'message': message, 'param': 'input[0].content'}}
            remote = http_failure(urllib.error.HTTPError('secret', 400, 'secret', {},
                                  io.BytesIO(json.dumps(body).encode())))
            self.assertEqual(error_diagnostic(remote), {'category': 'RemoteError', 'cause': 'RemoteError',
                'http_status': 400, 'provider_param': 'input[0].content', 'reason': reason})
            self.assertNotIn('private-token', str(remote))
        for param in ('Bearer private-token', 'https://secret', 'private-token', 'secret', {'secret': True}):
            body = {'error': {'message': 'private-token', 'param': param}}
            remote = http_failure(urllib.error.HTTPError('secret', 400, 'secret', {},
                                  io.BytesIO(json.dumps(body).encode())), credential='secret')
            self.assertEqual(error_diagnostic(remote), {'category': 'RemoteError', 'cause': 'RemoteError', 'http_status': 400})

    def test_json_instruction_is_in_actual_responses_conversation(self):
        ledger = BudgetLedger(self.path)
        response = {'status': 'completed', 'usage': {'input_tokens': 20, 'output_tokens': 10},
                    'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '{"ok":true}'}]}]}
        payload = {'text': 'public test without format instruction'}
        with patch('outreach_core._request', return_value=response) as request:
            OpenAIClient('secret', ledger).generate_json('gpt-4.1-mini', 'Classify', payload)
        body = request.call_args.args[3]
        self.assertNotIn('instructions', body)
        self.assertEqual([message['role'] for message in body['input']], ['system', 'user'])
        self.assertIn('JSON', body['input'][0]['content'])
        self.assertEqual(json.loads(body['input'][1]['content']), payload)
        self.assertEqual(body['text']['format']['type'], 'json_object')
        self.assertFalse(body['store'])

if __name__ == '__main__':
    unittest.main()
