// Run after npm run build. Fixtures stay in this offline QA process only.
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
async function main() {
  const auth = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({email:'editor@example.com'})); });
  await new Promise(resolve => auth.listen(0, '127.0.0.1', resolve));
  const port = Number(process.env.PROJECTS_QA_PORT || 3028), base = `http://127.0.0.1:${port}`;
  const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {stdio:'inherit',env:{...process.env,EDITOR_EMAIL:'editor@example.com',SUPABASE_AUTH_URL:`http://127.0.0.1:${auth.address().port}`,SUPABASE_AUTH_KEY:'fixture',POSTGREST_URL:`http://127.0.0.1:${auth.address().port}`,POSTGREST_SERVICE_KEY:'fixture'}});
  let browser;
  try {
    let ready=false;
    for(let i=0;i<100;i++){if(next.exitCode!==null)throw Error('QA server exited');try{await fetch(base);ready=true;break;}catch{await new Promise(r=>setTimeout(r,150));}}
    assert.ok(ready);
    browser=await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/root/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell'});
    const anon=await browser.newPage();await anon.goto(`${base}/desk/projects`);assert.equal(new URL(anon.url()).pathname,'/desk');await anon.close();
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.context().addCookies([{name:'desk_token',value:'fixture',url:base}]);
    const projects=[{id:1,topic_key:'boudeuse-1766',title:'Boudeuse voyage',objective:'Combine source contributions into one historical account.',contributions:[{submission_id:33,title:'Boudeuse source notes',type:'content-suggestion',status:'approved'},{submission_id:34,title:'Boudeuse imagery',type:'content-suggestion',status:'approved'}],tasks:[{id:12,role:'researcher',state:'queued',attempt:0}],pipeline:{id:4,state:'researching',revision:1,next_step:'Research task queued; waiting for an available worker.'},latest_draft:{title:'Boudeuse combined draft',body:'A source-grounded draft awaiting review.'}},{id:2,topic_key:'cook-1768',title:'Cook first voyage',objective:'Assess candidate archive material.',contributions:[],tasks:[],pipeline:null,latest_draft:null}];
    const posts=[],chatPosts=[],messages=[];let failChat=true,configured=true;
    await page.route('**/api/desk/projects**',async route=>{
      const req=route.request();const url=new URL(req.url());
      if(url.pathname.endsWith('/chat')){
        const data=req.postDataJSON();chatPosts.push(data);
        if(failChat){failChat=false;messages.push({role:'user',content:data.message,created_at:'2026-11-08T12:00:00Z'});return route.fulfill({status:503,json:{error:'Model unavailable.',recorded:true}});}
        messages.push({role:'assistant',content:'Revision request recorded.',created_at:'2026-11-08T12:01:00Z'});
        return route.fulfill({json:{reply:'Revision request recorded.',action_receipt:{task_id:14,run_id:'run-14'}}});
      }
      if(req.method()==='POST'){const data=req.postDataJSON();posts.push(data);return route.fulfill({json:{action_receipt:{task_id:13,run_id:'run-13'}}});}
      return route.fulfill({json:url.searchParams.has('topic_id')?{project:projects.find(p=>p.id===Number(url.searchParams.get('topic_id'))),messages,execution:{configured}}:{projects,execution:{configured}}});
    });
    await page.goto(`${base}/desk/projects`);
    await page.getByText('2 projects · 0 need your decision').waitFor();
    assert.equal(await page.getByRole('button',{name:'Boudeuse voyage',exact:true}).count(),1,'one grouped project for two contributions');
    await page.getByRole('button',{name:'Boudeuse voyage',exact:true}).click();
    await page.getByText('Boudeuse source notes',{exact:true}).waitFor();
    await page.getByText('A source-grounded draft awaiting review.',{exact:true}).waitFor();
    await page.getByText('· task #12 · queued · attempt 0',{exact:false}).waitFor();
    await page.getByLabel('Brief',{exact:true}).fill('Reconcile the sources and explain geographic uncertainty.');
    await page.getByRole('button',{name:'Start editorial work',exact:true}).click();
    await page.getByRole('status').filter({hasText:'task #13'}).waitFor();
    assert.equal(posts[0].action,'start');assert.ok(posts[0].request_id);
    await page.getByLabel('Message',{exact:true}).fill('Check the archive image dates.');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Your message was saved'}).waitFor();
    await page.screenshot({path:'/tmp/projects-failure.png',fullPage:true});
    assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Check the archive image dates.');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await page.getByText('Revision request recorded.',{exact:true}).waitFor();
    assert.equal(chatPosts[0].request_id,chatPosts[1].request_id,'saved-message retry is idempotent');
    assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'');
    await page.getByRole('button',{name:'Attach approved proposal',exact:true}).click();
    await page.getByLabel('Approved proposal number').fill('111');await page.getByLabel('Topic key',{exact:true}).fill('boudeuse-1766');await page.getByLabel('Project title',{exact:true}).fill('Boudeuse voyage');await page.getByLabel('Editorial objective').fill('Verify primary sources.');
    await page.getByRole('button',{name:'Attach proposal',exact:true}).click();
    await page.getByText('Proposal attached to its project.',{exact:true}).waitFor();
    assert.equal(posts[1].submission_id,111);assert.equal(posts[1].topic_key,'boudeuse-1766');
    await page.getByRole('heading',{name:'Editorial projects',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:'/tmp/terraveler-projects-wide.png',fullPage:true});
    configured=false;await page.getByRole('button',{name:'Refresh status',exact:true}).click();
    await page.getByText('Work requests are disabled.',{exact:false}).waitFor();
    assert.ok(await page.getByRole('button',{name:'Send',exact:true}).isDisabled());
    assert.ok(await page.getByRole('button',{name:'Start editorial work',exact:true}).isDisabled());
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/terraveler-projects-phone.png',fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
    console.log('Projects browser QA passed: auth gate, grouped contributions, task/draft, start receipt, saved chat retry identity, attachment, unavailable execution, compact overflow.');
  } finally {
    if(browser)await browser.close();next.kill('SIGTERM');await new Promise(r=>next.exitCode!==null?r():next.once('exit',r));await new Promise(r=>auth.close(r));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
