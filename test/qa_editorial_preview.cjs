// Production-server QA with in-process offline Auth/PostgREST fixtures only.
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
async function main() {
  let dataReads = 0;
  const backend = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/auth/v1/user')) return res.end(JSON.stringify({email:'editor@example.com'}));
    if (req.url.includes("/editorial_")) dataReads++;
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.endsWith('/editorial_topics')) return res.end(JSON.stringify([{id:1,title:'Cabeza de Vaca research'}]));
    if (url.pathname.endsWith('/editorial_results') && url.searchParams.get('editorial_tasks.role') === 'eq.writer') {
      if (url.searchParams.get('id') && url.searchParams.get('id') !== 'eq.44') return res.end('[]');
      return res.end(JSON.stringify([{id:44,task_id:7,created_at:'2026-11-16T18:00:00Z',result:{kind:'draft',title:'From conquest to survival',body:'Four survivors crossed a changing landscape.\n\nThe surviving accounts leave geographic uncertainties.',citations:[{claim:'Four survivors crossed a changing landscape.',source_id:'naufragios'},{claim:'The surviving accounts leave geographic uncertainties.',source_id:'naufragios'}],references:[{id:'naufragios',title:'Naufragios — source record',url:'https://es.wikisource.org/wiki/Naufragios',rights:'Public domain',text:'PRIVATE SOURCE PASSAGE',governance:{internal:'DO NOT EXPOSE'}}],candidate:{raw:'RAW MODEL ENVELOPE'}}}]));
    }
    if (url.pathname.endsWith('/editorial_results')) {
      assert.equal(url.searchParams.get('editorial_tasks.dependency_id'), 'eq.7');
      return res.end(JSON.stringify([{result:{kind:'review',verdict:'changes-requested',issues:['Clarify uncertainty around the coastal itinerary.']}}]));
    }
    res.statusCode = 500; res.end('{}');
  });
  await new Promise(r => backend.listen(0, '127.0.0.1', r));
  const port = 3030, base = `http://127.0.0.1:${port}`, backendBase = `http://127.0.0.1:${backend.address().port}`;
  const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)], {stdio:'ignore',env:{...process.env,EDITOR_EMAIL:'editor@example.com',SUPABASE_AUTH_URL:backendBase,SUPABASE_AUTH_KEY:'fixture',POSTGREST_URL:backendBase,POSTGREST_SERVICE_KEY:'fixture'}});
  let browser;
  try {
    for(let i=0;i<100;i++){if(next.exitCode!==null)throw Error('QA server exited');try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,150));}}
    browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    await page.goto(`${base}/desk/projects/1/preview?result=44`);
    assert.equal(new URL(page.url()).pathname,'/desk'); assert.equal(dataReads,0,'anonymous request reads no drafts');
    await page.context().addCookies([{name:'desk_token',value:'fixture',url:base}]);
    const response = await page.goto(`${base}/desk/projects/1/preview`);
    assert.equal(new URL(page.url()).searchParams.get('result'),'44','latest link resolves to immutable version');
    await page.getByRole('heading',{name:'From conquest to survival',exact:true}).waitFor();
    assert.match(response.headers()['cache-control'],/no-store/);
    assert.match(response.headers()['x-robots-tag'],/noindex/);
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex, nofollow');
    const body = await page.locator('body').innerText();
    assert.match(body,/Clarify uncertainty/); assert.doesNotMatch(body,/PRIVATE SOURCE PASSAGE|RAW MODEL ENVELOPE|DO NOT EXPOSE/);
    assert.equal(await page.getByRole('link',{name:'Source 1',exact:true}).count(),2);
    await page.screenshot({path:'/tmp/terraveler-preview-reader.png'});
    await page.getByRole('heading',{name:'Request changes to this version'}).scrollIntoViewIfNeeded();
    const posts=[];let fail=true;
    await page.route('**/api/desk/projects/chat',route=>{posts.push(route.request().postDataJSON());if(fail){fail=false;return route.abort();}return route.fulfill({json:{reply:'Please specify which passage.',recorded:true}});});
    await page.getByLabel('Message to the editorial coordinator').fill('Clarify the coastal dates.');
    await page.getByRole('button',{name:'Send request',exact:true}).click(); await page.locator('.preview-revision [role="alert"]').waitFor();
    await page.getByRole('button',{name:'Send request',exact:true}).click(); await page.getByText('No task receipt was returned;', {exact:false}).waitFor();
    assert.equal(posts[0].draft_result_id,44); assert.equal(posts[0].request_id,posts[1].request_id);
    await page.screenshot({path:'/tmp/terraveler-preview-review.png'});
    await page.goto(`${base}/desk/projects/1/preview?result=999`);
    await page.getByRole('heading',{name:'No saved draft available'}).waitFor();
    console.log('Preview browser QA passed: private auth, immutable version redirect, no-store/noindex, sourced reading, matching review, pinned revision request and retry identity.');
  } finally { if(browser)await browser.close();next.kill('SIGTERM');await new Promise(r=>next.exitCode!==null?r():next.once('exit',r));await new Promise(r=>backend.close(r)); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
