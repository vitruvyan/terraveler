import test from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL="editor@example.com";
process.env.POSTGREST_URL="https://data.invalid";
process.env.POSTGREST_SERVICE_KEY="fixture";
process.env.SUPABASE_AUTH_URL="https://auth.invalid";
process.env.SUPABASE_AUTH_KEY="fixture";
const sample=()=>({topic_id:1,consultation_id:"00000000-0000-4000-8000-000000000001",title:"Historical source",request_id:"dossier-source-request-01"});
test("dossier source intake accepts only receipt identities, not invented source content or rights",async()=>{
 const {parseDossierSourceRequest:parse,attachDossierSource,readDossierSources}=await import("../lib/editorialDossierSources");
 assert.deepEqual(parse(sample()),sample());
 for(const patch of [{topic_id:0},{consultation_id:"invented"},{request_id:"short"},{title:" "},{text:"Invented source"},{url:"https://evil.invalid"},{rights:"public_domain"},{target_voyage:"fake-voyage"}])assert.equal(parse({...sample(),...patch}),null);
 const r=await attachDossierSource(sample(),async(name,args)=>{assert.equal(name,"editorial_attach_source");assert.deepEqual(args,{p_topic_id:1,p_consultation_id:sample().consultation_id,p_title:sample().title,p_request_id:sample().request_id});return{id:1,topic_id:1,consultation_id:sample().consultation_id,replayed:false};});assert.equal(r.id,1);
 await readDossierSources(1,async(_method,path)=>{assert.match(path,/topic_id=eq.1/);assert.match(path,/limit=40/);assert.doesNotMatch(path,/response|text|lease|select=\*/);return[];});
});

test("dossier source API is editor-only and does not return raw source bytes or SQL diagnostics",async()=>{
 const {GET,POST}=await import("../app/api/desk/projects/sources/route");
 const old=globalThis.fetch;let writes=0,failed=false;
 globalThis.fetch=async input=>{
  const url=String(input);
  if(url.includes('/auth/v1/user'))return Response.json({email:'editor@example.com'});
  if(url.endsWith('/rpc/editorial_attach_source')){writes++;if(failed)throw Error('PRIVATE SQL CREDENTIALS');return Response.json({id:1,topic_id:1,consultation_id:sample().consultation_id,replayed:false});}
  if(url.includes('/editorial_topic_sources?'))return Response.json([]);
  throw Error('Unexpected request');
 };
 const request=(body:unknown,origin='https://site.invalid')=>new Request('https://site.invalid/api/desk/projects/sources',{method:'POST',headers:{cookie:'desk_token=fixture',origin},body:JSON.stringify(body)});
 try{
  assert.equal((await GET(new Request('https://site.invalid/api/desk/projects/sources?topic_id=1'))).status,401);
  assert.equal((await POST(new Request('https://site.invalid/api/desk/projects/sources',{method:'POST',body:JSON.stringify(sample())}))).status,401);
  assert.equal((await POST(request(sample(),'https://evil.invalid'))).status,403);
  assert.equal((await POST(request({...sample(),text:'invented'}))).status,400);assert.equal(writes,0);
  const response=await POST(request(sample()));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  failed=true;const rejected=await POST(request(sample()));assert.equal(rejected.status,409);assert.doesNotMatch(await rejected.text(),/PRIVATE/);
  const list=await GET(new Request('https://site.invalid/api/desk/projects/sources?topic_id=1',{headers:{cookie:'desk_token=fixture'}}));assert.equal(list.status,200);assert.equal(list.headers.get('Cache-Control'),'private, no-store');
 }finally{globalThis.fetch=old;}
});
