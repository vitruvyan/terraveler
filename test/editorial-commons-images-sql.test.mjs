import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const [workflow, plans, commons] = await Promise.all(['editorial_workflow', 'editorial_mcp_plans', 'editorial_commons_images']
  .map(n => readFile(new URL(`../supabase/${n}.sql`, import.meta.url), 'utf8')));
const digest = value => createHash('sha256').update(value).digest('hex');
async function scalar(db, sql, args = []) { return Object.values((await db.query(sql, args)).rows[0])[0]; }
async function setup() {
  const db = new PGlite();
  await db.exec(`create role terraveler_service;create role visitor;create role anon;create role authenticated;create role terraveler_editorial_worker;
  create table submissions(id bigint primary key,status text,payload jsonb);
  alter default privileges in schema public grant all on tables to anon,authenticated,terraveler_editorial_worker;
  alter default privileges in schema public grant execute on functions to anon,authenticated,terraveler_editorial_worker;`);
  await db.exec(workflow); await db.exec(plans); await db.exec(commons);
  return db;
}
const title = 'File:Narvaez expedition map.jpg';
function image(patch = {}) {
  return { kind: 'commons-image', title, page_url: 'https://commons.wikimedia.org/wiki/File:Narvaez_expedition_map.jpg',
    page_id: 101, revision_id: 9001, image_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Narvaez_expedition_map.jpg',
    thumb_url: null, mime: 'image/jpeg', width: 3000, height: 2000, sha1: 'a'.repeat(40),
    licence: { usable: true, class: 'public_domain', code: 'pd', short_name: 'Public domain', url: null, attribution_required: false },
    artist: 'Unknown author', credit: null, date_original: '1597', date_year: 1597, description: 'Map of La Florida.',
    object_name: null, restrictions: [], ...patch };
}
const record = (db, body, tool = 'fetch_commons_image', args = { title }) =>
  scalar(db, 'select editorial_record_mcp_consultation($1,$2,$3)', [tool, args, JSON.stringify(body)]);

test('a verified Commons file is recorded with server-owned digests', async () => { const db = await setup(); try {
  await db.exec('set role terraveler_service');
  const body = image();
  const rec = await record(db, body);
  assert.equal(rec.response_sha256, digest(JSON.stringify(body)));
  const row = (await db.query('select tool,response from editorial_mcp_consultations where id=$1', [rec.id])).rows[0];
  assert.equal(row.tool, 'fetch_commons_image'); assert.deepEqual(row.response, body);
  for (const cls of ['cc0', 'cc_by', 'cc_by_sa']) await record(db, image({ licence: { ...body.licence, class: cls } }));
  await record(db, image({ thumb_url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/1280px-X.jpg' }));
} finally { await db.close(); } });

test('unverified, unaccepted or inconsistent Commons responses are refused', async () => { const db = await setup(); try {
  await db.exec('set role terraveler_service');
  const bad = [
    image({ licence: { usable: true, class: 'cc_by_nc' } }),
    image({ licence: { usable: false, class: 'public_domain' } }),
    image({ licence: null }),
    image({ image_url: 'https://example.org/x.jpg' }),
    image({ thumb_url: 'https://example.org/thumb.jpg' }),
    image({ image_url: 'https://thumb.wikimedia.org/wikipedia/commons/a/ab/X.jpg' }),
    image({ page_url: 'https://en.wikipedia.org/wiki/File:X.jpg' }),
    image({ title: 'File:Another.jpg' }),
    image({ mime: 'video/webm' }),
    image({ sha1: 'not-a-sha' }),
    image({ revision_id: '9001' }),
    image({ kind: 'wikipedia-orientation' }),
  ];
  for (const body of bad) await assert.rejects(record(db, body), /invalid Commons image response/, JSON.stringify(body).slice(0, 120));
  await assert.rejects(record(db, image(), 'fetch_commons_image', { title, url: 'https://x' }), /invalid Commons image response/);
  await assert.rejects(record(db, image(), 'fetch_commons_image', { title: 'Narvaez.jpg' }), /invalid Commons image response/);
  await assert.rejects(record(db, image(), 'fetch_image'), /invalid MCP consultation/);
  assert.equal(await scalar(db, 'select count(*)::int from editorial_mcp_consultations'), 0);
} finally { await db.close(); } });

test('text-source receipts keep their exact previous contract', async () => { const db = await setup(); try {
  await db.exec('set role terraveler_service');
  const url = 'https://en.wikipedia.org/wiki/Example';
  const orientation = { kind: 'wikipedia-orientation', purpose: 'planning-only', requested_url: url, revision_id: 123,
    sections: [{ index: '1', title: 'Itinerary' }], text: 'An orientation paragraph.', text_truncated: false,
    sections_truncated: false, external_links_truncated: false };
  assert.ok((await record(db, orientation, 'get_wikipedia_outline', { url })).id);
  const source = { url, kind: 'wikipedia', lang: 'en', text: 'Source text.', truncated: false, total_length: 12 };
  assert.ok((await record(db, source, 'fetch_source_text', { url, kind: 'wikipedia', lang: 'en' })).id);
  await assert.rejects(record(db, { ...source, text: ' ' }, 'fetch_source_text', { url, kind: 'wikipedia', lang: 'en' }), /text and URL required/);
  await assert.rejects(record(db, { ...orientation, kind: 'other' }, 'get_wikipedia_outline', { url }), /invalid orientation response/);
  // A Commons snapshot can never pass as a text source.
  await assert.rejects(record(db, image(), 'fetch_source_text', { url, kind: 'wikipedia' }), /text and URL required/);
} finally { await db.close(); } });

test('only the trusted service role records receipts; the migration re-applies over history', async () => { const db = await setup(); try {
  for (const role of ['visitor', 'anon', 'authenticated', 'terraveler_editorial_worker']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(record(db, image()), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role terraveler_service'); await record(db, image()); await db.exec('reset role');
  await db.exec(commons);
  assert.equal(await scalar(db, 'select count(*)::int from editorial_mcp_consultations'), 1);
  await assert.rejects(db.exec('update editorial_mcp_consultations set tool=tool'), /append-only/);
} finally { await db.close(); } });
