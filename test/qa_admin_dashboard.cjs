// Full admin navigation and overview QA against local fixtures, no production writes.
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
async function main() {
  const auth = http.createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({email:'editor@example.com'}));});
  await new Promise(r=>auth.listen(0,'127.0.0.1',r));
  const port=3031, base=`http://127.0.0.1:${port}`;
  const next=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{stdio:'ignore',env:{...process.env,EDITOR_EMAIL:'editor@example.com',SUPABASE_AUTH_URL:`http://127.0.0.1:${auth.address().port}`,SUPABASE_AUTH_KEY:'fixture',POSTGREST_URL:`http://127.0.0.1:${auth.address().port}`,POSTGREST_SERVICE_KEY:'fixture'}});
  let browser;
  try {
    for(let i=0;i<100;i++){if(next.exitCode!==null)throw Error('QA server exited');try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,150));}}
    browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.context().addCookies([{name:'desk_token',value:'fixture',url:base}]);
    const dashboard={checked_at:'2026-11-16T20:30:00Z',execution_configured:true,worker_health:'not-observed',gateway:{status:'ready',models:['local-default','fast-local']},projects:[{id:1,title:'Cabeza de Vaca',state:'reviewing',next_step:'The independent review is queued.',running:0},{id:2,title:'Boudeuse',state:'attention',next_step:'A source record requires inspection.',running:0}],agents:[{name:'Historical reporter',role:'research',model:'local-default',enabled:true,version:2}],drafts:[{result_id:44,topic_id:1,title:'From conquest to survival',created_at:'2026-11-16T20:00:00Z'}],publication:{awaiting_decision:2},atlas:[{title:'Boudeuse public voyage',href:'/voyage/boudeuse-1766'}],errors:[]};
    const legacyReads=[];let partial=false;
    await page.route('**/api/desk/**',route=>{
      const path=new URL(route.request().url()).pathname;
      if(path.endsWith('/me'))return route.fulfill({json:{signed_in:true,is_editor:true,email:'editor@example.com'}});
      if(path.endsWith('/dashboard'))return route.fulfill({json:partial?{...dashboard,agents:null,errors:['Agent registry']}:dashboard});
      if(path.endsWith('/projects'))return route.fulfill({json:{projects:[],execution:{configured:true}}});
      if(path.endsWith('/team'))return route.fulfill({json:{agents:[],models:[{id:'local-default'}],gateway:{status:'ready'}}});
      legacyReads.push(path);return route.fulfill({json:{}});
    });
    await page.goto(`${base}/desk`);
    await page.getByRole('heading',{name:'Editorial desk',exact:true}).waitFor();
    await page.getByRole('heading',{name:'From conquest to survival',exact:true}).waitFor();
    assert.deepEqual(legacyReads,[],'dashboard does not fan out to legacy administration endpoints');
    const nav=page.getByRole('navigation',{name:'Administration',exact:true});
    assert.deepEqual(await nav.locator('.admin-primary a').allTextContents(),['Editorial desk','Projects','Agent team','Review & publish']);
    assert.equal(await nav.getByRole('link',{name:'Editorial desk',exact:true}).getAttribute('aria-current'),'page');
    assert.equal(await nav.getByRole('link',{name:'System prompts',exact:true}).isVisible(),true);
    assert.equal(await page.getByRole('link',{name:'Read private preview',exact:true}).getAttribute('href'),'/desk/projects/1/preview?result=44');
    await page.screenshot({path:'/tmp/admin-dashboard-overview.png'});
    assert.equal(await nav.getByRole('link',{name:'Source registry',exact:true}).getAttribute('href'),'/desk?tab=sources&sub=dossier');
    await nav.getByRole('button',{name:'Collapse sidebar'}).click();
    assert.equal(await page.locator('.admin-shell').getAttribute('data-compact'),'true');
    await nav.getByRole('button',{name:'Expand sidebar'}).click();
    assert.equal(await page.locator('.admin-shell').getAttribute('data-compact'),'false');
    partial=true;await page.getByRole('button',{name:'Refresh overview',exact:true}).click();
    await page.getByText('Could not read: Agent registry.',{exact:false}).waitFor();
    await page.getByRole('heading',{name:'Agent team',exact:true}).scrollIntoViewIfNeeded();
    assert.match(await page.getByRole('region',{name:'Platform overview',exact:true}).innerText(),/State unavailable/);
    await page.screenshot({path:'/tmp/admin-dashboard-partial.png'});
    await page.getByRole('button',{name:'Account',exact:true}).click();
    const shortcuts=page.getByRole('navigation',{name:'Administration shortcuts',exact:true});
    await shortcuts.getByRole('link',{name:'Editorial desk',exact:false}).waitFor();
    assert.deepEqual(await shortcuts.locator('.acct-menu-label').evaluateAll(nodes=>nodes.map(n=>n.childNodes[0].textContent.trim())),['Editorial desk','Projects','Agent team']);
    assert.equal(await page.getByRole('link',{name:'My Waypoints',exact:false}).isVisible(),false);
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await nav.getByRole('link',{name:'Projects',exact:true}).click();
    await page.getByRole('heading',{name:'Editorial projects',exact:true}).waitFor();
    assert.equal(await page.getByRole('navigation',{name:'Administration',exact:true}).getByRole('link',{name:'Projects',exact:true}).getAttribute('aria-current'),'page');
    await page.getByRole('navigation',{name:'Administration',exact:true}).getByRole('link',{name:'Agent team',exact:true}).click();
    await page.getByRole('heading',{name:'Agent team',exact:true}).waitFor();
    assert.equal(await page.getByRole('navigation',{name:'Administration',exact:true}).getByRole('link',{name:'Agent team',exact:true}).getAttribute('aria-current'),'page');
    await page.screenshot({path:'/tmp/admin-team-navigation.png'});
    await page.setViewportSize({width:390,height:844});
    await page.reload();
    const mobileNav=page.getByRole('navigation',{name:'Administration',exact:true});
    await mobileNav.getByRole('button',{name:'Open menu'}).waitFor();
    assert.equal(await mobileNav.getByRole('link',{name:'Projects',exact:true}).isVisible(),false);
    await mobileNav.getByRole('button',{name:'Open menu'}).click();
    assert.equal(await mobileNav.getByRole('link',{name:'Projects',exact:true}).isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal overflow on phone');
    await page.screenshot({path:'/tmp/admin-mobile-navigation.png'});
    console.log('Admin browser QA passed: default dashboard, no legacy fanout, private draft link, shared primary order/currentpage, secondary tools, editor shortcuts, partial failure and cross-page navigation.');
  } finally {if(browser)await browser.close();next.kill('SIGTERM');await new Promise(r=>next.exitCode!==null?r():next.once('exit',r));await new Promise(r=>auth.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
