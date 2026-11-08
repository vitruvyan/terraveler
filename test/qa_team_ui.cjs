// Run after npm run build. All identities/data are local fixtures; no live backend.
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

async function main() {
  const auth = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ email: 'editor@example.com' }));
  });
  await new Promise(resolve => auth.listen(0, '127.0.0.1', resolve));
  const port = Number(process.env.TEAM_QA_PORT || 3027);
  const base = `http://127.0.0.1:${port}`;
  const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    stdio: 'ignore', env: { ...process.env, EDITOR_EMAIL: 'editor@example.com',
      SUPABASE_AUTH_URL: `http://127.0.0.1:${auth.address().port}`, SUPABASE_AUTH_KEY: 'fixture',
      POSTGREST_URL: `http://127.0.0.1:${auth.address().port}`, POSTGREST_SERVICE_KEY: 'fixture',
      EDITOR_LIMEN_BASE_URL: '', EDITOR_LIMEN_API_KEY: '' },
  });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (next.exitCode !== null) throw new Error('QA server exited');
      try { await fetch(base); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 150)); }
    }
    assert.ok(ready, 'QA server ready');
    browser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    const anon = await browser.newPage();
    await anon.goto(`${base}/desk/team`);
    assert.equal(new URL(anon.url()).pathname, '/desk');
    await anon.close();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.context().addCookies([{ name: 'desk_token', value: 'fixture', url: base }]);
    let agents = [];
    const posts = [];
    let lostResponse = true;
    let conflict = false;
    await page.route('**/api/desk/team', async route => {
      if (route.request().method() === 'POST') {
        const value = route.request().postDataJSON();
        posts.push(value);
        if (lostResponse) { lostResponse = false; return route.abort(); }
        if (conflict) return route.fulfill({ status: 409, json: { error: 'conflict', current_version: 2 } });
        agents = [{ ...value, version: 1, created_at: '2026-11-08T12:00:00Z' }];
        return route.fulfill({ json: { ok: true, result: { version: 1 } } });
      }
      return route.fulfill({ json: { agents, models: [], gateway: { status: 'not-configured' }, execution: 'not-connected' } });
    });
    await page.goto(`${base}/desk/team`);
    await page.getByText('No agents configured yet.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Create agent', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Historical researcher');
    await page.locator('#team-agent-model').fill('local-default');
    await page.getByLabel('Specific instructions').fill('Compare sources and preserve citations.');
    assert.ok(await page.getByRole('checkbox').isDisabled(), 'cannot enable while gateway unavailable');
    await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
    await page.getByText('Configuration saved as version 1.', { exact: false }).waitFor();
    assert.equal(posts.length, 2);
    assert.equal(posts[0].request_id, posts[1].request_id, 'transport retry retains idempotency key');
    assert.equal(posts[0].agent_key, posts[1].agent_key, 'stable generated agent identity');
    await page.getByRole('button', { name: 'Edit Historical researcher' }).click();
    await page.getByLabel('Specific instructions').fill('Revised source checking instructions.');
    conflict = true;
    await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Specific instructions').inputValue(), 'Revised source checking instructions.');
    assert.notEqual(posts[2].request_id, posts[1].request_id, 'edited draft starts a new request');
    await page.getByRole('heading', { name: 'Agent team', exact: true }).scrollIntoViewIfNeeded();
    const screenshot = process.env.TEAM_QA_SCREENSHOT || '/tmp/terraveler-team-qa.png';
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log('Team browser QA passed: auth gate, paused creation, gateway unavailable, retry identity, edit conflict retains draft.');
  } finally {
    if (browser) await browser.close();
    next.kill('SIGTERM');
    await new Promise(resolve => { if (next.exitCode !== null) resolve(); else next.once('exit', resolve); });
    await new Promise(resolve => auth.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
