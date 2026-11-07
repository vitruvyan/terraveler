import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { submissionNextStep, submissionTitle, mayRule, type DeskSubmission } from '../lib/deskPresentation';
import SubmissionQueue from '../components/desk/SubmissionQueue';
const sub:DeskSubmission={id:111,type:'new-voyage',target_voyage:'test-voyage',status:'approved',carta_version:'0.7',created_at:'2026-11-07',payload:{title:'Named voyage'},contributor:null,audit:[],reviews:[],escalated:false};
test('agent approval is not human authorization or proof of publication',()=>{
 assert.match(submissionNextStep(sub),/human authorization not recorded/);assert.equal(mayRule(sub),true);
 const authorized={...sub,audit:[{actor:'editor-in-chief',action:'verdict',verdict:'approve',findings:null,created_at:'2026-11-07'}]};
 assert.match(submissionNextStep(authorized),/awaiting the Publisher/);assert.equal(mayRule(authorized),false);
 assert.match(submissionNextStep({...authorized,audit:[...authorized.audit,{actor:'curator-desk',action:'verdict',verdict:'changes',findings:null,created_at:'2026-11-08'}]}),/human authorization not recorded/);
 assert.match(submissionNextStep({...authorized,audit:[...authorized.audit,{actor:'publisher',action:'publish',verdict:null,findings:null,created_at:'2026-11-08'}]}),/deployment not verified/);
});
test('missing or refuting reviews never read as passed checks',()=>{
 assert.match(submissionNextStep({...sub,status:'peer-review'}),/0 recorded/);
 assert.match(submissionNextStep({...sub,status:'peer-review',reviews:[{reviewer:null,verdict:'refute',findings:null,created_at:''}]}),/1 refuting/);
 assert.equal(submissionTitle(sub),'Named voyage');
});
test('failed queue is distinct from empty queue and cards lead with readable titles',()=>{
 const failed=renderToStaticMarkup(React.createElement(SubmissionQueue,{submissions:[],error:'Could not load contributions'}));assert.match(failed,/role="alert"/);assert.doesNotMatch(failed,/No contributions in this queue/);
 const list=renderToStaticMarkup(React.createElement(SubmissionQueue,{submissions:[sub]}));assert.match(list,/Named voyage/);assert.match(list,/human authorization not recorded/);assert.doesNotMatch(list,/Original submission record/);
});
test('approved agent drafts remain in the human decision queue; forced publication stays visible', async()=>{
 const { decisionQueues, appealReason }=await import('../lib/deskPresentation');
 const queues=decisionQueues({needs_verdict:[],peer_review:[],history:[sub,{...sub,id:112,type:'idea'}]});
 assert.deepEqual(queues.needs_verdict.map(s=>s.id),[111]);assert.deepEqual(queues.history.map(s=>s.id),[112]);
 assert.match(submissionNextStep({...sub,audit:[{action:'publish-forced',actor:'publisher',verdict:null,findings:null,created_at:''}]}),/Forced publication/);
 assert.equal(appealReason({...sub,audit:[{action:'appeal',actor:'scribe',verdict:null,findings:[['APPEAL',0,'Please reconsider the evidence.']],created_at:''}]}),'Please reconsider the evidence.');
});
