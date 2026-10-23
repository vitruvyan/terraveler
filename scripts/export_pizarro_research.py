#!/usr/bin/env python3
"""Export a public research edition from pinned local evidence; never fetch or publish."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / 'out/content-swarm'
MOTUX = CONTENT / 'waypoint-pattern-v1/motux'
JOURNEY = ROOT / 'out/journey-research/pizarro-1532-v2'
OUTPUT = ROOT / 'data/research/pizarro-1532.json'
PHOTO = ROOT / 'public/media/research/motupe.jpg'
WITNESS_HASHES = {
    'reports-1872.txt': 'c1990f4e32e40d4b44c51effc872b2e47d148e77574f1cb31b72245346c84c63',
    'sancho-1917.txt': '5fc9c63ba43721c850b75c84e3daec97d048ce9cb9188c593edb7574f43d4817',
}
SECTIONS = ('scope', 'itinerary', 'chronology', 'sources', 'populations', 'images', 'narrative', 'review')
TITLES = dict(zip(SECTIONS, ('Scope', 'Itinerary', 'Chronology', 'Sources', 'People and cultural context',
                            'Images', 'Narrative', 'Review and open questions')))
SUMMARIES = {
    'scope': 'A proposed main march from Tumbez to Cuzco in 1532–1533, with three subsidiary or returning journeys kept separate.',
    'itinerary': 'Ten core events and twenty-three additional source-index entries are available for comparison with all seventeen legacy records, including the duplicated Motux entries. Intermediate historical locations remain unresolved.',
    'chronology': 'Dates retain their supported day, month or year precision. The Motux passage gives four days of rest; its exact arrival date remains unknown. Partial dates do not become invented travel days.',
    'sources': 'Testimony comes from Xerez and Sancho in English translations: Markham’s 1872 edition, consulted in a 1970 reprint, and Means’s 1917 edition. These are translated witnesses; no original Pizarro manuscript has been authenticated here.',
    'populations': 'Fourteen linked studies support six scoped regional context sections. Consultation levels, places and periods remain explicit; they do not establish the identities of people encountered at individual stops.',
    'images': 'Fifteen Commons records include three rejected place matches. One Motupe image has verified local bytes and visual inspection. Other candidates remain item links; all photographs serve modern or regional context.',
    'narrative': 'Seven Motux statements retain their independently reviewed wording. The wider itinerary and cultural contexts remain documented editorial proposals for discussion.',
    'review': 'Two bounded tasks have independent reviews: a documented arrival-date gap and a modern photo candidate. Six tasks await work and two depend on an editorial scope decision. No section or journey is certified complete.',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(files, base=ROOT):
    for relative, expected in files.items():
        path = (base / relative).resolve()
        require(path.is_relative_to(ROOT), 'Source manifest path escapes repository')
        require(path.is_file() and sha(path) == expected, 'Pinned source artifact mismatch: ' + relative)


def url(value):
    if not value:
        return None
    parsed = urlsplit(value)
    require(parsed.scheme in ('http', 'https') and parsed.hostname is not None
            and not parsed.username and not parsed.password, 'Unsafe source URL')
    return value


def locator(value):
    if isinstance(value, str):
        return value
    return '; '.join(str(value[k]) + ' ' + label for k, label in
                     (('printed_page', 'printed page'), ('pdf_page', 'PDF page'),
                      ('line_start', 'first line'), ('line_end', 'last line')) if value.get(k) is not None)


def license_url(source):
    if source.get('license_url'):
        return url(source['license_url'])
    license_name = source.get('license', '').replace(' ', '')
    for label, address in (
            ('CCBY-SA4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'),
            ('CCBY-SA3.0', 'https://creativecommons.org/licenses/by-sa/3.0/'),
            ('CCBY4.0', 'https://creativecommons.org/licenses/by/4.0/')):
        if label in license_name:
            return address
    return None


def check_witness(value):
    path = (ROOT / value['source_file']).resolve()
    allowed = {CONTENT / 'sources/reports-1872.txt', CONTENT / 'sources/sancho-1917.txt'}
    require(path in allowed and path.is_file(), 'Historical quote has no permitted local witness')
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == value.get('source_sha256', WITNESS_HASHES[path.name]),
            'Historical source witness changed')
    text = raw.decode('utf-8')
    # The original route audit read text with Python's universal-newline mode;
    # the supplemental index also retains literal CRLF spans. Preserve both.
    universal_newlines = text.replace('\r\n', '\n').replace('\r', '\n')
    require(value['raw_quote'] in text or value['raw_quote'] in universal_newlines,
            'Historical quote is not an exact source span after declared newline normalization')


def quote(value):
    check_witness(value)
    role = value.get('evidence_role') or (
        'editorial-footnote' if 'editorial' in value.get('author', '').lower() else 'translated-participant-account')
    return {'text': value['raw_quote'], 'url': url(value['source_url']),
            'locator': locator(value.get('locator', '')), 'role': role,
            'citation': ' — '.join(v for v in (value.get('author'), value.get('edition')) if v)}


def project():
    final = read(CONTENT / 'pizarro-final-review.json')
    require(final['status'] == 'pass', 'Missing scoped itinerary review')
    verify(final['inputs'])
    last_card_review = read(MOTUX / 'final-card-review.json')
    verify(last_card_review['artifact_hashes'], MOTUX)
    verify(read(JOURNEY / 'binding-manifest.json')['files'])
    joined = read(CONTENT / 'pizarro-editorial-dossier.json')
    audit = read(CONTENT / 'pizarro-route-audit.json')
    media_audit = read(CONTENT / 'pizarro-media-ethnography-audit.json')
    reviewed = read(MOTUX / 'independent-review.json')
    card = read(MOTUX / 'dossier.json')
    board = read(JOURNEY / 'board.json')
    photo_assignment = read(JOURNEY / 'check-one-motupe-photo/assignment.json')
    image_evidence = read(ROOT / photo_assignment['evidence_path'])
    image_path = (ROOT / photo_assignment['image_path']).resolve()
    require(image_path.is_relative_to(ROOT), 'Photo path escapes repository')
    image_bytes = image_path.read_bytes()
    require(hashlib.sha256(image_bytes).hexdigest() == photo_assignment['binding']['input_sha256']['motupe-photo-bytes'],
            'Photo input bytes mismatch')
    require(hashlib.sha1(image_bytes).hexdigest() == image_evidence['metadata']['commons_sha1'],
            'Photo Commons SHA1 mismatch')
    for task, verdict in [('check-motux-arrival', 'documented_gap'), ('check-one-motupe-photo', 'approved')]:
        result = read(JOURNEY / task / 'result.json')
        review = read(JOURNEY / task / 'review.json')
        require(review['protocol'] == 'journey-task-review-v2' and review['verdict'] == verdict
                and review['result_sha256'] == sha(JOURNEY / task / 'result.json')
                and review['reviewer_id'] != result['producer_id'], 'Missing current independent task review')
    require(card['approved_content_sha'] == reviewed['approved_content_sha'] == last_card_review['approved_content_sha'],
            'Motux approved-content binding mismatch')
    facts = card['approved_content']['facts']
    require(facts == reviewed['approved_facts'], 'Motux reviewed text changed')
    require([f['id'] for f in facts] == reviewed['allowed_fact_ids'], 'Motux fact allowlist mismatch')

    main_stages = []
    for stage in joined['stages']:
        row, evidence = stage['route_record'], stage['historical_evidence']
        proof = evidence['source_proof']
        check_witness(proof)
        point = stage['publishable_map_coordinate']
        gap = [] if point else ['No verified map reference is assigned to this regional stage.']
        photo = stage['photography']
        main_stages.append({
            'id': 'stage-' + str(row['seq']), 'seq': row['seq'],
            'historical_name': row['place_historical'], 'modern_name': row['place_modern'],
            'event': row['event'], 'date': {'value': row['arrival_date'], 'note': row['date_note'],
                'precision': evidence['date_status']},
            'location': {'latitude': point['latitude'], 'longitude': point['longitude'],
                'label': 'Approximate modern reference; exact historical site unverified.'} if point else None,
            'testimony': {'text': proof['raw_quote'], 'citation': row['diary_source_citation'],
                'url': url(proof['source_url']), 'locator': proof['locator']},
            'media_ids': [photo['id']] if photo else [], 'study_ids': stage['related_study_ids'],
            'cultural_context_ids': stage['cultural_context_ids'],
            'status': 'reviewed-proposal', 'gaps': gap})

    intermediate = []
    for entry in joined['intermediate_stage_index']['entries']:
        evidence = entry['quoted_evidence'] + entry.get('editorial_identity_evidence', [])
        notes = [entry['notes']] if isinstance(entry['notes'], str) else entry['notes']
        intermediate.append({'id': entry['id'], 'name': entry['label'],
            'route_relationship': entry['route_relationship'],
            'date_note': entry['date_evidence']['bounds_and_basis'], 'status': 'source-indexed-proposal',
            'notes': notes + [entry['relative_route_position'],
                'Historical coordinates remain unverified; this is not a mapped daily camp.'],
            'quotes': [quote(q) for q in evidence]})

    branches = [{'id': key, 'records': [{'legacy_id': item['record_id'],
        'name': item['corrected_candidate']['place_historical'],
        'event': item['corrected_candidate']['event'],
        'note': item['corrected_candidate']['date_note'],
        'evidence': [quote(proof) for proof in item['evidence']]} for item in rows]}
        for key, rows in joined['subsidiary_branches'].items()]
    cultural = [{'id': item['id'], 'title': item['region'], 'text': item['paragraph'],
        'period_limits': item['period_limits'], 'source_limits': item['source_viewpoint_limits'],
        'source_ids': [s['bibliography_id'] for s in item['sources']],
        'status': 'reviewed-regional-context-proposal'} for item in joined['cultural_context']['sections']]
    consulted = {s['bibliography_id']: s for c in joined['cultural_context']['sections'] for s in c['sources']}
    studies = [{'id': item['id'], 'title': item['title'], 'authors': item['authors'],
        'year': item['year'], 'url': url(item['institutional_or_publisher_url']), 'doi': item.get('doi'),
        'locator': item['page_locator'], 'scope': item['relevance'],
        'consulted_basis': consulted[item['id']]['consulted_section'] if item['id'] in consulted else
            'Bibliographic research record; no page-level encounter claim verified.',
        'status': 'link-only-regional-research'} for item in joined['studies']]
    media = []
    for item in media_audit['media']:
        current = item['id'] == 'motupe-town'
        rejected = item['id'].endswith('-rejected')
        date = item.get('photo_date_metadata') or 'unknown'
        media.append({'id': item['id'], 'title': item['commons_file_title'],
            'item_url': url(item['item_url']), 'license': item['license'],
            'license_url': url(item.get('license_url')), 'credit': item['credit'],
            'width': item['width'], 'height': item['height'], 'caption': item['suggested_caption'],
            'status': 'rejected-wrong-place' if rejected else
                'reviewed-modern-context-candidate' if current else 'metadata-checked-context-candidate',
            'local_url': '/media/research/motupe.jpg' if current else None,
            'date': str(date), 'date_note': 'Commons item date; capture date is not independently verified.',
            'limits': ['Modern context only; no proof of the 1532–1533 event location or appearance.',
                'Credit and licence are Commons item declarations; independent rights-holder confirmation is not established.',
                'This candidate was rejected for the historical place identification.' if rejected else
                'Actual JPEG received and visually inspected in the supervised 23 October trial.' if current else
                'Item metadata inspected; this edition does not claim new image-byte or visual verification.']})

    legacy = [{'id': row['record_id'], 'seq': row['seq'], 'name': row['existing']['place_historical'],
        'status': 'legacy-requires-research', 'findings': row['blocking_findings'],
        'proposed_action': row['corrected_candidate']['action']} for row in audit['waypoints']]
    evidence_by_id = {e['id']: e for e in card['evidence']}
    sources = {s['id']: s for s in card['source_references']}
    source_studies = {s['id']: s for s in card['approved_content']['studies']}
    public_facts = []
    for fact in facts:
        entries = []
        for ident in fact['evidence_ids']:
            ev = evidence_by_id[ident]
            source = sources.get(ev['source_id'], source_studies.get(ev['source_id']))
            require(source is not None, 'Missing reviewed evidence source')
            text = ev.get('quote_raw', ev.get('value'))
            if not isinstance(text, str):
                text = json.dumps(text, ensure_ascii=False)
            entries.append({'id': ident, 'kind': ev['kind'], 'semantic_role': ev['semantic_role'],
                'text': text, 'url': url(source['url']), 'title': source['title'],
                'author': source.get('provenance', {}).get('author', ''),
                'license': source.get('license', 'Bibliographic metadata and original scope note; publisher text remains link-only.'),
                'license_url': license_url(source),
                'locator': source.get('provenance', {}).get('locator', source.get('locator', 'Typed source metadata'))})
        public_facts.append({'id': fact['id'], 'text': fact['statement'], 'evidence': entries})

    board_units = [{'id': u['id'], 'kind': u['kind'], 'label': u['label'], 'legacy_id': u['legacy_id'],
        'sections': [{'id': key, 'state': u['sections'][key]['state'],
            'summary': u['sections'][key]['summary'], 'gaps': [g['text'] for g in u['sections'][key]['gaps']]}
            for key in SECTIONS]} for u in board['units']]
    journey_unit = next(u for u in board_units if u['kind'] == 'journey')
    waypoint_unit = next(u for u in board_units if u['id'] == 'wp-04')
    sections = [{'id': key, 'title': TITLES[key],
        'status': next(c['state'] for c in journey_unit['sections'] if c['id'] == key),
        'summary': SUMMARIES[key],
        'gaps': list(dict.fromkeys(g for u in board_units for c in u['sections'] if c['id'] == key for g in c['gaps']))}
        for key in SECTIONS]
    result = {'schema_version': 1, 'slug': 'pizarro-1532',
        'title': 'Pizarro 1532–1533: research edition', 'as_of': board['as_of'],
        'scope': 'An open research dossier of the main march, subsidiary journeys, source testimony and unresolved questions.',
        'summary': 'Seventeen legacy entries have been audited. A ten-event core, twenty-three additional source-index entries and six regional cultural contexts are presented for discussion. Seven Motux statements have independent editorial review; this is not a complete or historically certified reconstruction.',
        'notice': 'Reviewed facts, source-backed proposals and documented gaps retain different statuses. Modern references and photographs do not identify exact historical camps. Publication for discussion does not upgrade the underlying research findings.',
        'sections': sections, 'stages': main_stages, 'intermediate_stages': intermediate, 'branches': branches,
        'cultural_contexts': cultural, 'studies': studies, 'media': media, 'legacy_rows': legacy,
        'motux': {'facts': public_facts, 'gaps': [g for c in waypoint_unit['sections'] for g in c['gaps']],
            'image_update': {'as_of': '2026-10-23', 'text': image_evidence['reconciliation']['new_wording']},
            'study_ids': ['lambayeque-klaus-2016'], 'media_ids': ['motupe-town']},
        'board': {'sections': list(SECTIONS), 'units': board_units,
            'tasks': [{k: t[k] for k in ('id', 'unit_id', 'section', 'state', 'objective', 'reasons')} for t in board['tasks']],
            'counts': {'tasks': board['progress']['tasks'], 'sections': board['progress']['sections']}},
        'provenance': {'edition_notes': [
            'Xerez and related accounts: Clements R. Markham English translation (1872), consulted through a scan of the 1970 reprint. Historical translated body only; no autograph authentication.',
            'Sancho: Philip Ainsworth Means English translation (1917), via the public-domain Gutenberg witness.',
            'Quotations preserve the saved source witness, including OCR artifacts; exact copying does not certify historical truth.',
            'Some extracted quotation line endings were normalized from CRLF to LF in the original route audit; wording and source spelling are retained.',
            'Scholarly publications are linked bibliography and brief original contextual paraphrases only; publisher full text is not reproduced.'],
            'review_scopes': ['Seven Motux editorial statements: exact reviewed wording and selected evidence retained.',
                'Ten-event core and supplemental source index: independently checked private proposal, now exposed as a research proposal.',
                'Journey v2: a reviewed date gap and a reviewed modern image candidate; task status is not section completeness.',
                'Current user authorization covers publication of this research edition for discussion, not canonical atlas replacement or historical certification.',
                'The original private snapshots and their approval flags are preserved; current visibility authorization is a separate publication decision.'],
            'limits': ['No exact historical camp coordinates are certified.',
                'Piura valley and La Ramada have no map coordinates in this edition; all 23 additional entries remain unmapped.',
                'Months and years are displayed at their supplied precision, with no inferred animation or travel speed.',
                'No encountered population identity is inferred from modern geography or later scholarship.',
                'No original Pizarro autograph or Archivo General de Indias manuscript image has been authenticated in this research.']}}
    require(tuple(len(result[k]) for k in ('stages', 'intermediate_stages', 'cultural_contexts', 'studies', 'media', 'legacy_rows'))
            == (10, 23, 6, 14, 15, 17), 'Unexpected public research coverage')
    require(len(public_facts) == 7 and len(board_units) == 18 and len(result['motux']['gaps']) == 6,
            'Unexpected Motux or board coverage')
    encoded = (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    for private in (b'/home/', b'/tmp/', b'out/content-swarm', b'out/journey-research', b'.env', b'.outreach'):
        require(private not in encoded, 'Private operational value in public projection')
    return encoded, image_bytes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify existing public files without writing')
    args = parser.parse_args()
    try:
        content, photo = project()
        if args.check:
            require(OUTPUT.read_bytes() == content and PHOTO.read_bytes() == photo, 'Public export is stale')
        else:
            OUTPUT.parent.mkdir(parents=True, exist_ok=True)
            PHOTO.parent.mkdir(parents=True, exist_ok=True)
            OUTPUT.write_bytes(content)
            PHOTO.write_bytes(photo)
        print('Public research export verified: 10 proposed events, 23 indexed passages, 7 reviewed Motux statements; no network or publication.')
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print('Pizarro research export refused: ' + str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
