import test from "node:test";
import assert from "node:assert/strict";
import { parseSpecialistConfiguration, saveSpecialistConfiguration } from "../lib/editorialSpecialistConfig";
const base = { agent_key: "historian-a", name: "Historian", role: "research", model: "local-default", instructions: "Research carefully", enabled: false, expected_version: 0, request_id: "create-history-001" };
test("specialties persist with versioned configs and planned handlers cannot enable", async () => {
 const config = parseSpecialistConfiguration({ ...base, specialty: "history" }); assert.ok(config);
 assert.equal(parseSpecialistConfiguration({ ...base, specialty: "publisher" }), null);
 assert.equal(parseSpecialistConfiguration({ ...base, specialty: "diary" }), null);
 assert.equal(parseSpecialistConfiguration({ ...base, specialty: "iconography", enabled: true })?.specialty, "iconography");
 assert.equal(parseSpecialistConfiguration({ ...base, role: "writer", specialty: "caption", enabled: true })?.specialty, "caption");
 assert.equal(parseSpecialistConfiguration(base)?.specialty, null);
 assert.equal(parseSpecialistConfiguration({ ...base, specialty: "ethnohistory", enabled: true })?.specialty, "ethnohistory");
 await saveSpecialistConfiguration(config, async (name,args) => { assert.equal(name,"desk_save_editorial_specialist_agent"); assert.equal(args.p_specialty,"history"); assert.equal(args.p_expected_version,0); return {}; });
});

test("Managing editor and textual specialists are configurable; role mismatches remain guarded", () => {
 const coordinator = {...base, role: "coordinator", specialty: "managing-editor", enabled: true};
 assert.equal(parseSpecialistConfiguration(coordinator)?.specialty, "managing-editor");
 assert.equal(parseSpecialistConfiguration({...coordinator, role:"research"}), null);
 assert.equal(parseSpecialistConfiguration({...base, specialty:"itinerary", enabled:true})?.specialty, "itinerary");
 assert.equal(parseSpecialistConfiguration({...base, specialty:"copyedit", enabled:true}), null);
});
