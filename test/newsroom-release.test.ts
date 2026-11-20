import test from "node:test";
import assert from "node:assert/strict";
import {newsroomReleaseEnabled,newsroomPreviewEnvironment,newsroomReadEnabled,useNewsroomLanding} from "../lib/newsroomRelease";
test("production release is off by default; preview fixtures are never enabled by release flags",()=>{
 const prod={NODE_ENV:"production",VERCEL_ENV:"production"};
 for(const surface of ["desk","chartroom"] as const){assert.equal(newsroomReleaseEnabled(surface,prod),false);assert.equal(newsroomReadEnabled(surface,prod),false);assert.equal(useNewsroomLanding(surface,{},prod),false);}
 const enabled={...prod,TERRAVELER_CHARTROOM_V2:"1",TERRAVELER_NEWSROOM_DESK:"1"};
 assert.equal(newsroomPreviewEnvironment(enabled),false);
 assert.equal(newsroomReadEnabled("desk",enabled),true);
 assert.equal(newsroomReadEnabled("chartroom",enabled),true);
});
test("release switches are independent, opt-in and old query URLs stay on original workflows",()=>{
 const chart={NODE_ENV:"production",VERCEL_ENV:"production",TERRAVELER_CHARTROOM_V2:"1"};
 assert.equal(useNewsroomLanding("chartroom",{},chart),true);
 assert.equal(useNewsroomLanding("desk",{},chart),false);
 for(const params of [{mode:"ongoing"},{mode:"propose"},{mode:"agent-setup"},{mode:"crew"},{voyage:"cortes-1519",waypoint:"2"},{category:"all"}])assert.equal(useNewsroomLanding("chartroom",params,chart),false);
 const desk={NODE_ENV:"production",TERRAVELER_NEWSROOM_DESK:"1"};
 assert.equal(useNewsroomLanding("desk",{},desk),true);
 for(const params of [{tab:"dashboard"},{tab:"workspace"},{tab:"submissions",sub:"needs_verdict"}])assert.equal(useNewsroomLanding("desk",params,desk),false);
 assert.equal(newsroomReleaseEnabled("desk",{TERRAVELER_NEWSROOM_DESK:"true"}),false);
});
test("preview data access is independent of landing activation",()=>{
 const preview={VERCEL_ENV:"preview",NODE_ENV:"production"};
 assert.equal(newsroomReadEnabled("desk",preview),true);
 assert.equal(newsroomReadEnabled("chartroom",preview),true);
 assert.equal(useNewsroomLanding("desk",{},preview),false);
});
