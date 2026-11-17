import test from "node:test";
import assert from "node:assert/strict";
import { parseSpecialistConfiguration, saveSpecialistConfiguration } from "../lib/editorialSpecialistConfig";
const base = { agent_key: "historian-a", name: "Historian", role: "research", model: "local-default", instructions: "Research carefully", enabled: false, expected_version: 0, request_id: "create-history-001" };
test("specialties persist with versioned configs and planned handlers cannot enable", async () => {
 const config = parseSpecialistConfiguration({ ...base, specialty: "history" }); assert.ok(config);
 assert.equal(parseSpecialistConfiguration({ ...base, specialty: "publisher" }), null);
 assert.equal(parseSpecialistConfiguration({ ...base, specialty: "diary" }), null);
 assert.equal(parseSpecialistConfiguration({ ...base, specialty: "ethnohistory", enabled: true }), null);
 assert.equal(parseSpecialistConfiguration(base)?.specialty, null);
 assert.equal(parseSpecialistConfiguration({ ...base, specialty: "ethnohistory" })?.specialty, "ethnohistory");
 await saveSpecialistConfiguration(config, async (name,args) => { assert.equal(name,"desk_save_editorial_specialist_agent"); assert.equal(args.p_specialty,"history"); assert.equal(args.p_expected_version,0); return {}; });
});

test("Managing editor is configurable for preparation; role and planned specialties remain guarded", () => {
 const coordinator = {...base, role: "coordinator", specialty: "managing-editor", enabled: true};
 assert.equal(parseSpecialistConfiguration(coordinator)?.specialty, "managing-editor");
 assert.equal(parseSpecialistConfiguration({...coordinator, role:"research"}), null);
 assert.equal(parseSpecialistConfiguration({...base, specialty:"itinerary", enabled:true}), null);
});
