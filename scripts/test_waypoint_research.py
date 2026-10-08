"""Offline tests of tool, durable budget and independent editorial boundaries."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waypoint_research as W


def pack():
    return {'protocol': W.PROTOCOL, 'waypoint_id': 'motux', 'task': 'Describe the source and its limits.',
            'seeds': [{'id': 'chronicle', 'url': 'https://www.gutenberg.org/ebooks/1', 'kind': 'gutenberg', 'title': 'Motux account', 'license': 'Public domain',
                       'text': 'They rested\n\n at Motux for four days. No exact arrival date is supplied.',
                       'provenance': {'semantic_role': 'participant-account', 'retrieved_at': '2026-10-08', 'locator': 'Fixture paragraph', 'access_status': 'saved-local', 'rights_basis': 'Fixture public domain'}}],
            'studies': [{'id': 'study', 'title': 'Regional context', 'authors': ['Author'], 'year': 2000, 'url': 'https://publisher.example/article', 'locator': 'Bibliography only', 'scope': 'Regional later context', 'verified_basis': 'Bibliographic metadata; no full text ingested'}],
            'gaps': [{'id': 'camp-gap', 'text': 'The exact historical camp coordinates remain unresolved.', 'category': 'place'}]}


def fact(evidence_id):
    return {'id': 'rest', 'subject': 'Spaniards in Xerez account', 'property': 'duration of rest', 'statement': 'Xerez describes a four-day rest at Motux.',
            'evidence_ids': [evidence_id], 'category': 'history', 'time': {'label': 'four days', 'precision': 'source-relative'},
            'place': {'label': 'Motux in the account', 'precision': 'historical-name'}, 'population': {'label': 'unknown', 'scope': 'unknown'}}


def output(value):
    return {'output': [{'type': 'message', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': json.dumps(value)}]}]}


def tool(name, args, call_id='call1'):
    return {'type': 'function_call', 'name': name, 'arguments': json.dumps(args), 'call_id': call_id}


class Context:
    def __init__(self): self.effects = []
    def record_effect(self, effect): self.effects.append(effect)


class FakeProvider:
    def __init__(self, pilot, failures=False): self.pilot, self.bodies, self.failures = pilot, [], failures
    def step(self, body):
        self.bodies.append(copy.deepcopy(body))
        reservation = self.pilot.ledger.reserve(W.C.MODEL, 100, 2000)
        if self.failures: raise W.O.RemoteError('simulated ambiguity secret-should-not-print')
        self.pilot.ledger.settle(reservation, 20, 30)
        instructions = body['input'][0]['content']
        if instructions.startswith(W.DISCOVERY):
            if any(x.get('type') == 'function_call_output' for x in body['input']): return output({'done': True})
            return {'output': [tool('source_read', {'candidate_id': 'chronicle', 'query': 'Motux'})]}
        if instructions.startswith(W.EXTRACT):
            payload = json.loads(body['input'][1]['content'])
            evidence = next(e for e in payload['evidence'] if e['kind'] == 'source-text')
            return output({'facts': [fact(evidence['id'])], 'limitations': ['camp-gap']})
        return output({'sections': {c: ['rest'] if c == 'history' else [] for c in W.SECTIONS}, 'media_ids': [], 'study_ids': [], 'gap_ids': ['camp-gap']})


class WaypointTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.pack_path = self.root / 'pack.json'
        self.data = pack(); self.pack_path.write_text(json.dumps(self.data))
        self.ctx = Context()

    def pilot(self, phase='research', review=None, provider=True, transport=None):
        pilot = W.WaypointPilot(self.pack_path, phase, review, directory=self.root / 'out', transport=transport)
        if provider: pilot.client = FakeProvider(pilot)
        return pilot

    def research(self):
        pilot = self.pilot(); W.run(pilot); return pilot

    def gate(self, pilot):
        report = pilot.research
        result = {'protocol': W.PROTOCOL, 'waypoint_id': 'motux', 'sourcepack_sha': report['sourcepack_sha'], 'facts_sha': report['facts_sha'], 'approved_content_sha': '',
                  'human_approved': False, 'approved_facts': copy.deepcopy(report['proposals']['facts']), 'allowed_fact_ids': ['rest'], 'allowed_media_ids': [], 'allowed_study_ids': [],
                  'reviewer': {'id': 'independent-test-reviewer', 'kind': 'independent-development-review'}, 'findings': []}
        result['approved_content_sha'] = W.C.digest(W.approved_content(self.data, result))
        path = self.root / 'review.json'; path.write_text(json.dumps(result)); return path, result

    def test_real_fixture_and_free_preview_use_no_credentials_network_or_output_writes(self):
        fixture = W.C.ROOT / 'scripts/fixtures/waypoint-motux-v1.json'
        self.assertEqual(W.load_pack(fixture)['waypoint_id'], 'motux')
        with patch.object(W.O, 'request_json', side_effect=AssertionError('network')), patch.object(W.O, '_request', side_effect=AssertionError('paid')):
            self.assertEqual(W.main(['--sourcepack', str(self.pack_path), '--research']), 0)
        self.assertFalse((self.root / 'out').exists())

    def test_research_is_pending_and_copies_exact_source_spans_with_offsets(self):
        pilot = self.research(); report = pilot.research
        self.assertEqual(report['status'], 'pending-independent-review')
        self.assertFalse(report['human_approved']); self.assertEqual(report['mechanical_checks']['findings'], [])
        self.assertEqual(report['facts_sha'], W.C.digest(report['proposals']))
        span = next(e for e in report['effective_pack']['evidence'] if e['kind'] == 'source-text')
        raw = self.data['seeds'][0]['text']
        self.assertEqual(span['quote_raw'], raw[span['start']:span['end']])
        self.assertEqual(span['source_sha256'], hashlib.sha256(raw.encode()).hexdigest())
        self.assertIn('\n\n', span['quote_raw'])
        self.assertTrue(all(len(e['quote_raw'].split()) <= 60 for e in report['effective_pack']['evidence'] if e['kind'] == 'source-text'))
        self.assertEqual(len(pilot.client.bodies), 3)

    def test_compose_requires_gate_before_purchase_and_never_researches_or_fetches(self):
        original = self.research(); spent = original.ledger.summary()['spent_microdollars']
        for review in (None, self.root / 'missing.json'):
            pilot = self.pilot('compose', review)
            with self.assertRaises(Exception): W.run(pilot)
            self.assertEqual(pilot.client.bodies, [])
            self.assertEqual(pilot.ledger.summary()['spent_microdollars'], spent)
        path, review = self.gate(original)
        pilot = self.pilot('compose', path, transport=lambda *a, **k: self.fail('composition fetched'))
        W.run(pilot); self.assertEqual(len(pilot.client.bodies), 1)
        self.assertTrue(pilot.client.bodies[0]['input'][0]['content'].startswith(W.COMPOSE))
        dossier = json.loads((pilot.artifacts / 'dossier.json').read_text())
        self.assertFalse(dossier['human_approved']); self.assertEqual(dossier['independent_review']['id'], 'independent-test-reviewer')
        self.assertEqual(dossier['source_outcome'], 'bounded-access-recorded; approved facts independently reviewed; unresolved gaps retained')

    def test_corrected_review_text_is_copied_byte_exact_without_unreviewed_prose(self):
        original = self.research(); path, review = self.gate(original)
        revised = 'Xerez’s translated account describes a four-day rest; the camp remains unlocated.'
        review['approved_facts'][0]['statement'] = revised
        review['approved_content_sha'] = W.C.digest(W.approved_content(self.data, review)); path.write_text(json.dumps(review))
        pilot = self.pilot('compose', path); W.run(pilot)
        markdown = (pilot.artifacts / 'dossier.md').read_text()
        self.assertIn(revised, markdown); self.assertIn(self.data['gaps'][0]['text'], markdown)
        self.assertNotIn(original.research['proposals']['facts'][0]['statement'], markdown)

    def test_stale_gate_changed_relationship_unknown_ids_or_publication_flag_fail_before_purchase(self):
        original = self.research(); path, review = self.gate(original)
        mutations = [lambda r: r.update(facts_sha='0'*64), lambda r: r.update(sourcepack_sha='0'*64), lambda r: r.update(human_approved=True),
                     lambda r: r.update(allowed_fact_ids=['invented']), lambda r: r.update(allowed_media_ids=['fake-photo']), lambda r: r.update(allowed_study_ids=['fake-study']),
                     lambda r: r['approved_facts'][0].update(subject='Governor instead of Spaniards'), lambda r: r['approved_facts'][0].update(property='exact arrival date'),
                     lambda r: r.update(approved_content_sha='0'*64)]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                invalid = copy.deepcopy(review); mutate(invalid); path.write_text(json.dumps(invalid))
                pilot = self.pilot('compose', path)
                with self.assertRaises(Exception): W.run(pilot)
                self.assertEqual(pilot.client.bodies, [])

    def test_selection_cannot_hide_gap_change_category_add_prose_or_leak_media_study_ids(self):
        pilot = self.research(); _, review = self.gate(pilot)
        value = {'sections': {c: ['rest'] if c == 'history' else [] for c in W.SECTIONS}, 'media_ids': [], 'study_ids': [], 'gap_ids': ['camp-gap']}
        W.validate_selection(value, review, self.data)
        for mutate in (lambda v: v.update(gap_ids=[]), lambda v: v.update(study_ids=['other']), lambda v: v.update(media_ids=['other']),
                       lambda v: v.update(caption='invented caption'), lambda v: v['sections'].update(history=[], chronology=['rest'])):
            bad = copy.deepcopy(value); mutate(bad)
            with self.assertRaises(W.C.PilotStopped): W.validate_selection(bad, review, self.data)

    def test_metadata_cannot_support_historical_property_or_encounter_scope(self):
        evidence = {'metadata': {'id': 'metadata', 'source_id': 'study', 'kind': 'study-metadata', 'semantic_role': 'study-metadata'}}
        f = fact('metadata')
        self.assertTrue(W.validate_facts({'facts': [f], 'limitations': []}, evidence, self.data))
        f.update(category='place', time={'label': 'later period', 'precision': 'edition-period'}, place={'label': 'region', 'precision': 'regional'}, population={'label': 'regional context', 'scope': 'regional-context'})
        self.assertEqual(W.validate_facts({'facts': [f], 'limitations': []}, evidence, self.data), [])
        f['place']['precision'] = 'historical-name'
        self.assertTrue(W.validate_facts({'facts': [f], 'limitations': []}, evidence, self.data))

    def test_cache_resume_zero_paid_calls_and_no_source_requests(self):
        first = self.research(); path, _ = self.gate(first)
        composed = self.pilot('compose', path); W.run(composed)
        spend = composed.ledger.summary()['spent_microdollars']
        for phase in ('research', 'compose'):
            resumed = self.pilot(phase, path, transport=lambda *a, **k: self.fail('resume fetched'))
            W.run(resumed); self.assertEqual(resumed.client.bodies, [])
            self.assertEqual(resumed.ledger.summary()['spent_microdollars'], spend)

    def test_global_uncertain_and_orphan_reservations_prevent_every_new_purchase(self):
        pilot = self.pilot(); pilot.client.failures = True
        with self.assertRaises(Exception): W.run(pilot)
        resumed = self.pilot()
        with self.assertRaises(Exception): W.run(resumed)
        self.assertEqual(resumed.client.bodies, [])
        with resumed.db() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM content_attempts WHERE status='uncertain'").fetchone()[0], 1)
        other = W.WaypointPilot(self.pack_path, 'research', directory=self.root / 'other')
        other.client = FakeProvider(other); other.ledger.reserve(W.C.MODEL, 50, 2000)
        with self.assertRaises(Exception): W.run(other)
        self.assertEqual(other.client.bodies, [])

    def test_changed_pack_contract_or_renderer_blocks_before_spec_overwrite(self):
        pilot = self.research(); before = (pilot.artifacts / 'spec-research.json').read_bytes()
        self.data['task'] += ' Changed.'; self.pack_path.write_text(json.dumps(self.data))
        changed = self.pilot()
        with self.assertRaises(Exception): W.run(changed)
        self.assertEqual(changed.client.bodies, []); self.assertEqual((pilot.artifacts / 'spec-research.json').read_bytes(), before)

    def test_approved_gate_is_frozen_for_cached_composition(self):
        pilot = self.research(); path, review = self.gate(pilot)
        first = self.pilot('compose', path); W.run(first)
        review['approved_facts'][0]['statement'] += ' New correction.'
        review['approved_content_sha'] = W.C.digest(W.approved_content(self.data, review)); path.write_text(json.dumps(review))
        second = self.pilot('compose', path)
        with self.assertRaises(Exception): W.run(second)
        self.assertEqual(second.client.bodies, [])

    def test_search_handles_cap_and_fixed_mcp_only(self):
        requests = []
        candidates = [{'kind': 'wikipedia', 'url': 'https://en.wikipedia.org/wiki/Motupe' + str(i), 'source_url': 'https://en.wikipedia.org/wiki/Motupe', 'title': 'Motupe '+str(i), 'license': 'CC BY-SA 4.0', 'lang': 'en'} for i in range(10)]
        def transport(url, **kwargs):
            requests.append((url, kwargs))
            return {'result': {'structuredContent': {'candidates': candidates, 'adapters_failed': []}}}
        pilot = self.pilot(transport=transport)
        found = pilot.source_search({'query': 'no local match', 'lang': 'en'})
        self.assertEqual(len(found['candidates']), 5); self.assertEqual(len(pilot.candidates), 6)
        self.assertEqual(requests[0][0], 'https://www.terraveler.com/api/mcp')
        self.assertEqual(requests[0][1]['payload']['params']['name'], 'search_sources')
        for args in ({'candidate_id': 'https://evil.example', 'query': ''}, {'candidate_id': 'unknown', 'query': ''}):
            with self.assertRaises(W.C.PilotStopped): pilot.source_read(args)

    def test_access_errors_are_cached_bounded_and_not_fabricated_coverage(self):
        pilot = self.pilot(transport=lambda *a, **k: (_ for _ in ()).throw(W.O.RemoteError('redirect refused')))
        call = tool('source_search', {'query': 'Motux', 'lang': 'en'})
        result = pilot.execute_tool(call, 0, self.ctx)
        visible = json.loads(result['output']); self.assertEqual(visible['access_failures'][0]['status'], 'source-search-unavailable')
        resumed = self.pilot(transport=lambda *a, **k: self.fail('retry'))
        cached = resumed.execute_tool(call, 0, self.ctx, cached_only=True)
        self.assertEqual(result, cached)
        with self.assertRaises(W.C.PilotStopped): resumed.execute_tool(tool('shell', {'query': 'anything'}), 1, self.ctx)
        with self.assertRaises(W.C.PilotStopped): resumed.execute_tool(call, 8, self.ctx)

    def test_wire_cap_native_function_calls_usage_and_redirect_errors_hold_budget(self):
        with self.assertRaises(W.C.PilotStopped): W.wire_body(W.DISCOVERY, [{'role': 'user', 'content': 'x' * W.MAX_WIRE}], True)
        ledger = W.O.BudgetLedger(self.root / 'client.sqlite', W.C.CAP)
        client = W.StepClient('private-key', ledger)
        body = W.wire_body(W.DISCOVERY, [{'role': 'user', 'content': 'JSON'}], True)
        response = {'status': 'completed', 'usage': {'input_tokens': 10, 'output_tokens': 20}, 'output': [tool('source_read', {'candidate_id': 'chronicle', 'query': ''})]}
        with patch.object(W.O, '_request', return_value=response) as request:
            result = client.step(body); self.assertEqual(result['output'], response['output'])
            self.assertEqual(request.call_args.args[:3], ('https://api.openai.com', 'private-key', '/v1/responses'))
        with patch.object(W.O, '_request', side_effect=W.O.RemoteError('redirect refused')):
            with self.assertRaises(W.O.RemoteError): client.step(body)
        self.assertEqual(ledger.summary()['pending_requests'], 1)

    def test_private_artifacts_native_trace_contract_hash_only(self):
        pilot = self.research()
        paths = list((pilot.artifacts / 'traces-research').glob('*.jsonl'))
        self.assertTrue(paths)
        for path in paths:
            trace = path.read_text(); self.assertNotIn('They rested', trace); self.assertNotIn('private-key', trace)
            process = subprocess.run([sys.executable, '-m', 'vitruvyan_motus.contract.validate', 'jsonl', str(path), '--spec', str(pilot.artifacts / 'spec-research.json')], capture_output=True, text=True)
            self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        for path in pilot.artifacts.rglob('*'):
            self.assertEqual(path.stat().st_mode & 0o777, 0o700 if path.is_dir() else 0o600)

    def test_full_result_hash_binds_gap_selection_and_approved_hash_binds_renderer(self):
        pilot = self.research(); _, review = self.gate(pilot)
        changed = copy.deepcopy(pilot.research['proposals']); changed['limitations'] = []
        self.assertNotEqual(W.C.digest(changed), pilot.research['facts_sha'])
        original = W.C.digest(W.approved_content(self.data, review))
        with patch.object(W, 'RENDERER_VERSION', 'changed-template'):
            self.assertNotEqual(W.C.digest(W.approved_content(self.data, review)), original)

    def test_seed_host_kind_asset_host_and_negated_rights_are_rejected(self):
        for mutate in (lambda p: p['seeds'][0].update(url='https://copyrighted.example/book'),
                       lambda p: p['seeds'][0].update(url='https://en.wikipedia.org/wiki/Book'),
                       lambda p: p['seeds'][0].update(license='Not public domain'),
                       lambda p: p['seeds'][0].update(license='Public domain, rights unknown')):
            candidate = copy.deepcopy(self.data); mutate(candidate); self.pack_path.write_text(json.dumps(candidate))
            with self.assertRaises(W.C.PilotStopped): W.load_pack(self.pack_path)
        candidate = copy.deepcopy(self.data)
        candidate['seeds'][0]['asset'] = {'id': 'photo', 'url': 'https://private.example/photo.jpg', 'license': 'CC BY-SA 4.0', 'credit': 'Author', 'width': 100, 'height': 100, 'role': 'modern-place-context', 'caption': 'Modern contextual photograph.'}
        self.pack_path.write_text(json.dumps(candidate))
        with self.assertRaises(W.C.PilotStopped): W.load_pack(self.pack_path)
        for label in ('CC BY-NC 4.0', 'CC BY-ND 4.0', 'CC BY-SA-NC 4.0', 'CC BY-SA 4.0 or permission required', 'Public domain not verified'):
            self.assertFalse(W.open_rights(label), label)
        for label in ('Public domain', 'PD-US-expired (historical text; see rights_basis)', 'PDM 1.0', 'CC0 1.0', 'CC BY 4.0', 'CC BY-SA 4.0'):
            self.assertTrue(W.open_rights(label), label)

    def test_operator_snapshot_bootstrap_covers_pack_with_one_native_call_per_round(self):
        requests = []
        def transport(*args, **kwargs):
            requests.append(kwargs['payload']['params']['name'])
            return {'result': {'structuredContent': {'candidates': [], 'adapters_failed': []}}}
        pilot = self.pilot(transport=transport)
        class FourRounds(FakeProvider):
            def step(self, body):
                if body['input'][0]['content'].startswith(W.DISCOVERY):
                    self.bodies.append(copy.deepcopy(body))
                    r = self.pilot.ledger.reserve(W.C.MODEL, 100, 2000); self.pilot.ledger.settle(r, 10, 10)
                    count = len(self.bodies)
                    return {'output': [tool('source_search', {'query': 'query' + str(count), 'lang': 'en'}, 'call' + str(count))]}
                return super().step(body)
        pilot.client = FourRounds(pilot); W.run(pilot)
        self.assertEqual(len(pilot.client.bodies), 5); self.assertEqual(len(requests), 4)
        self.assertTrue(any(e['kind'] == 'source-text' for e in pilot.research['effective_pack']['evidence']))
        self.assertTrue(any(e['kind'] == 'study-metadata' for e in pilot.research['effective_pack']['evidence']))
        self.assertTrue(all(x.get('access') is None for x in pilot.research['effective_pack']['tool_results']))
        path, _ = self.gate(pilot)
        composed = self.pilot('compose', path, transport=lambda *a, **k: self.fail('new read'))
        composed.client = FourRounds(composed); W.run(composed)
        self.assertEqual(len(composed.client.bodies), 1)
        with composed.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM content_attempts').fetchone()[0], 6)
        with self.assertRaises(W.C.PilotStopped): composed.paid_body('seventh', W.wire_body(W.COMPOSE, [{'role': 'user', 'content': '{}'}]), self.ctx)

    def test_population_link_only_study_context_is_valid_but_not_exact_encounter(self):
        evidence = {'study-evidence': {'id': 'study-evidence', 'source_id': 'study', 'kind': 'study-metadata', 'semantic_role': 'study-metadata'}}
        f = fact('study-evidence')
        f.update(category='population', time={'label': 'later bibliography', 'precision': 'edition-period'}, place={'label': 'region', 'precision': 'regional'}, population={'label': 'regional scope', 'scope': 'regional-context'})
        self.assertEqual(W.validate_facts({'facts': [f], 'limitations': []}, evidence, self.data), [])
        f['population']['scope'] = 'named-in-source'
        self.assertTrue(W.validate_facts({'facts': [f], 'limitations': []}, evidence, self.data))

    def test_unclassified_live_text_cannot_pass_historical_role_guard_even_mixed(self):
        evidence = {'unknown': {'id': 'unknown', 'kind': 'source-text', 'semantic_role': 'unclassified'},
                    'known': {'id': 'known', 'kind': 'source-text', 'semantic_role': 'participant-account'}}
        proposed = fact('unknown')
        self.assertIn('rest:source-role-unclassified', W.validate_facts({'facts': [proposed], 'limitations': []}, evidence, self.data))
        proposed['evidence_ids'].append('known')
        self.assertIn('rest:source-role-unclassified', W.validate_facts({'facts': [proposed], 'limitations': []}, evidence, self.data))

    def test_invalid_paid_selection_is_cached_without_repurchase(self):
        original = self.research(); path, review = self.gate(original)
        pilot = self.pilot('compose', path)
        base = pilot.client.step
        def invalid(body):
            base(body)
            return output({'sections': {c: ['rest'] if c == 'history' else [] for c in W.SECTIONS}, 'media_ids': [], 'study_ids': [], 'gap_ids': []})
        pilot.client.step = invalid
        with self.assertRaises(Exception): W.run(pilot)
        resumed = self.pilot('compose', path)
        with self.assertRaises(Exception): W.run(resumed)
        self.assertEqual(resumed.client.bodies, [])

    def test_live_evidence_capacity_is_explicit_and_extraction_remains_bounded(self):
        fixture = W.C.ROOT / 'scripts/fixtures/waypoint-motux-v1.json'
        body_text = ' '.join('word' + str(i) for i in range(3000))
        def transport(*args, **kwargs):
            return {'result': {'structuredContent': {'text': body_text, 'truncated': False, 'total_length': len(body_text)}}}
        pilot = W.WaypointPilot(fixture, 'research', directory=self.root / 'capacity', transport=transport)
        pilot.load(self.ctx)
        pilot.candidates['live'] = {'id': 'live', 'url': 'https://en.wikipedia.org/wiki/Motupe', 'source_url': 'https://en.wikipedia.org/wiki/Motupe', 'kind': 'wikipedia', 'title': 'Motupe', 'license': 'CC BY-SA 4.0', 'lang': 'en'}
        read = pilot.source_read({'candidate_id': 'live', 'query': 'word100'})
        self.assertGreater(read['evidence_capacity_omitted'], 0)
        additions = dict(pilot.evidence)
        for e in read['evidence']: additions[e['id']] = e
        payload = {'waypoint_id': pilot.pack['waypoint_id'], 'task': pilot.pack['task'], 'evidence': list(additions.values()), 'gaps': pilot.pack['gaps']}
        body = W.wire_body(W.EXTRACT, [{'role': 'user', 'content': W.C.canonical(payload)}])
        self.assertLessEqual(len(json.dumps(body, ensure_ascii=False).encode()), W.MAX_WIRE)

    def test_discovery_capacity_stop_avoids_purchase_and_keeps_bootstrapped_fact_extraction(self):
        pilot = self.pilot(); pilot.load(self.ctx)
        original = W.wire_body
        seen = {'discovery': 0}
        def bounded(instructions, items, tools=False):
            if instructions == W.DISCOVERY:
                seen['discovery'] += 1
                if seen['discovery'] > 1: raise W.C.PilotStopped('simulated wire capacity')
            return original(instructions, items, tools)
        with patch.object(W, 'wire_body', side_effect=bounded): pilot.discover(self.ctx)
        self.assertEqual(len(pilot.client.bodies), 1)
        self.assertEqual(pilot.capacity_decisions[0]['reason'], 'discovery-wire-capacity-stop')
        pilot.extract(self.ctx)
        self.assertEqual(pilot.mechanical, [])

    def test_empty_independent_approval_remains_insufficient_in_markdown_and_json(self):
        pilot = self.research(); path, review = self.gate(pilot)
        review.update(approved_facts=[], allowed_fact_ids=[])
        review['approved_content_sha'] = W.C.digest(W.approved_content(self.data, review)); path.write_text(json.dumps(review))
        composed = self.pilot('compose', path)
        base = composed.client.step
        def abstention(body):
            base(body)
            return output({'sections': {c: [] for c in W.SECTIONS}, 'media_ids': [], 'study_ids': [], 'gap_ids': ['camp-gap']})
        composed.client.step = abstention; W.run(composed)
        self.assertEqual(json.loads((composed.artifacts / 'dossier.json').read_text())['status'], 'insufficient-evidence')
        markdown = (composed.artifacts / 'dossier.md').read_text()
        self.assertIn('Status: insufficient-evidence.', markdown)
        self.assertNotIn('Status: awaiting-human.', markdown)
        self.assertIn(self.data['gaps'][0]['text'], markdown)

    def recovery_checkpoint(self):
        pilot = self.pilot()
        step = pilot.client.step
        def rich_completion(body):
            result = step(body)
            if result.get('output', [{}])[0].get('type') == 'message' and body['input'][0]['content'].startswith(W.DISCOVERY):
                return output({'done': True, 'card': {'unsupported': 'DISCARDED unsupported discovery narrative'}})
            return result
        pilot.client.step = rich_completion
        original_wire = W.wire_body
        def old_wire(instructions, items, tools=False, **kwargs):
            return original_wire(instructions, items, tools, historical_discovery=instructions == W.DISCOVERY)
        with patch.object(W, 'wire_body', side_effect=old_wire):
            with self.assertRaises(Exception): W.run(pilot)
        backup = pilot.artifacts / 'recovery/runner-before-recovery.py'
        backup.parent.mkdir(mode=0o700); backup.write_bytes(b'Original frozen fixture implementation')
        old_sha = hashlib.sha256(backup.read_bytes()).hexdigest()
        with pilot.db() as db:
            db.execute('UPDATE waypoint_manifests SET digest=? WHERE id=?', (pilot.manifest_fingerprint(old_sha), pilot.prefix))
        pins = pilot.recovery_pins()
        with pilot.db() as db:
            last = db.execute('SELECT id,result_digest FROM content_attempts WHERE id=?', (pilot.prefix + ':discovery:1',)).fetchone()
        pins.update(completion={'attempt_id': last[0], 'result_sha': last[1]}, reviewer={'id': 'independent-test-reviewer', 'kind': 'independent-development-review'})
        path = self.root / 'recovery.json'; path.write_text(json.dumps(pins))
        return pilot, path, pins

    def test_future_discovery_format_strict_and_historical_replay_body_unchanged(self):
        items = [{'role': 'user', 'content': 'JSON'}]
        body = W.wire_body(W.DISCOVERY, items, True)
        self.assertEqual(body['text']['format']['type'], 'json_schema')
        self.assertTrue(body['text']['format']['strict'])
        self.assertFalse(body['text']['format']['schema']['additionalProperties'])
        self.assertEqual(body['text']['format']['schema']['properties']['done']['enum'], [True])
        self.assertEqual(W.wire_body(W.DISCOVERY, items, True, historical_discovery=True)['text']['format'], {'type': 'json_object'})
        self.assertEqual(W.wire_body(W.EXTRACT, items)['text']['format'], {'type': 'json_object'})

    def test_manual_recovery_uses_exact_cache_no_discovery_purchase_and_discards_prose(self):
        original, path, pins = self.recovery_checkpoint()
        with original.db() as db:
            before_paid = db.execute('SELECT * FROM content_attempts ORDER BY id').fetchall()
            before_tools = db.execute('SELECT * FROM waypoint_tools ORDER BY id').fetchall()
            old_manifest = db.execute('SELECT digest FROM waypoint_manifests WHERE id=?', (original.prefix,)).fetchone()[0]
        resumed = W.WaypointPilot(self.pack_path, 'research', directory=original.directory, recovery_path=path, transport=lambda *a, **k: self.fail('recovery fetched'))
        resumed.client = FakeProvider(resumed); W.run(resumed)
        self.assertEqual(len(resumed.client.bodies), 1)
        self.assertTrue(resumed.client.bodies[0]['input'][0]['content'].startswith(W.EXTRACT))
        self.assertNotIn('DISCARDED unsupported', json.dumps(resumed.client.bodies))
        self.assertNotIn('DISCARDED unsupported', (resumed.artifacts / 'facts.json').read_text())
        self.assertEqual(resumed.research['effective_pack']['capacity_decisions'][0]['reason'], W.RECOVERY_ACTION)
        with self.assertRaises(W.C.PilotStopped):
            resumed.paid_body('discovery:3', W.wire_body(W.DISCOVERY, [{'role': 'user', 'content': 'JSON'}], True, historical_discovery=True), self.ctx)
        self.assertEqual(len(resumed.client.bodies), 1)
        with resumed.db() as db:
            self.assertEqual(db.execute('SELECT * FROM content_attempts WHERE id!=? ORDER BY id', (resumed.prefix + ':facts',)).fetchall(), before_paid)
            self.assertEqual(db.execute('SELECT * FROM waypoint_tools ORDER BY id').fetchall(), before_tools)
            self.assertEqual(db.execute('SELECT digest FROM waypoint_manifests WHERE id=?', (resumed.prefix,)).fetchone()[0], old_manifest)
            self.assertIsNotNone(db.execute('SELECT digest FROM waypoint_manifests WHERE id=?', (resumed.prefix + ':recovery',)).fetchone())
        review_path, _ = self.gate(resumed)
        compose = W.WaypointPilot(self.pack_path, 'compose', review_path, directory=original.directory, recovery_path=path, transport=lambda *a, **k: self.fail('compose fetched'))
        compose.client = FakeProvider(compose); W.run(compose)
        self.assertEqual(len(compose.client.bodies), 1)
        cached = W.WaypointPilot(self.pack_path, 'research', directory=original.directory, recovery_path=path)
        cached.client = FakeProvider(cached); W.run(cached); self.assertEqual(cached.client.bodies, [])
        altered = copy.deepcopy(pins); altered['reviewer']['id'] = 'other-reviewer'; path.write_text(json.dumps(altered))
        changed = W.WaypointPilot(self.pack_path, 'research', directory=original.directory, recovery_path=path); changed.client = FakeProvider(changed)
        with self.assertRaises(Exception): W.run(changed)
        self.assertEqual(changed.client.bodies, [])

    def test_recovery_wrong_pins_stale_artifact_or_action_stop_before_any_purchase(self):
        original, path, pins = self.recovery_checkpoint()
        for mutate in (lambda p: p.update(new_runner_sha='0'*64), lambda p: p.update(original_runner_sha='0'*64),
                       lambda p: p.update(original_manifest_sha='0'*64), lambda p: p.update(paid_rows_sha='0'*64), lambda p: p.update(tool_rows_sha='0'*64),
                       lambda p: p['fingerprints'].update(sourcepack_sha='0'*64), lambda p: p['fingerprints'].update(prompts_sha='0'*64),
                       lambda p: p['completion'].update(result_sha='0'*64), lambda p: p.update(permitted_action='retry-discovery'),
                       lambda p: p.update(paid_ids=[]), lambda p: p['reviewer'].update(kind='model-review')):
            invalid = copy.deepcopy(pins); mutate(invalid); path.write_text(json.dumps(invalid))
            resumed = W.WaypointPilot(self.pack_path, 'research', directory=original.directory, recovery_path=path)
            resumed.client = FakeProvider(resumed)
            with self.assertRaises(Exception): W.run(resumed)
            self.assertEqual(resumed.client.bodies, [])
        plain = self.pilot()
        with self.assertRaises(Exception): W.run(plain)
        self.assertEqual(plain.client.bodies, [])

    def test_recovery_missing_unknown_status_or_tampered_cached_row_never_retries(self):
        original, path, pins = self.recovery_checkpoint()
        for field, value in (('status', 'unknown'), ('result_digest', '0'*64)):
            with original.db() as db:
                prior = db.execute('SELECT ' + field + ' FROM content_attempts WHERE id=?', (pins['completion']['attempt_id'],)).fetchone()[0]
                db.execute('UPDATE content_attempts SET ' + field + '=? WHERE id=?', (value, pins['completion']['attempt_id']))
            resumed = W.WaypointPilot(self.pack_path, 'research', directory=original.directory, recovery_path=path); resumed.client = FakeProvider(resumed)
            with self.assertRaises(Exception): W.run(resumed)
            self.assertEqual(resumed.client.bodies, [])
            with original.db() as db: db.execute('UPDATE content_attempts SET ' + field + '=? WHERE id=?', (prior, pins['completion']['attempt_id']))
        with original.db() as db: db.execute('DELETE FROM waypoint_tools WHERE id=?', (pins['tool_ids'][0],))
        resumed = W.WaypointPilot(self.pack_path, 'research', directory=original.directory, recovery_path=path); resumed.client = FakeProvider(resumed)
        with self.assertRaises(Exception): W.run(resumed)
        self.assertEqual(resumed.client.bodies, [])

    def test_recovery_done_false_even_with_rehashed_row_cannot_authorize(self):
        original, path, pins = self.recovery_checkpoint()
        with original.db() as db:
            changed = output({'done': False, 'card': 'unsupported'})
            db.execute('UPDATE content_attempts SET result=?,result_digest=? WHERE id=?', (W.C.canonical(changed), W.C.digest(changed), pins['completion']['attempt_id']))
        replacement = original.recovery_pins()
        replacement.update(completion={'attempt_id': pins['completion']['attempt_id'], 'result_sha': W.C.digest(changed)}, reviewer=pins['reviewer'])
        path.write_text(json.dumps(replacement))
        resumed = W.WaypointPilot(self.pack_path, 'research', directory=original.directory, recovery_path=path); resumed.client = FakeProvider(resumed)
        with self.assertRaises(Exception): W.run(resumed)
        self.assertEqual(resumed.client.bodies, [])


if __name__ == '__main__': unittest.main()
