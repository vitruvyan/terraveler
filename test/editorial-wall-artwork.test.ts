import test from "node:test";
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {wallCoverFor} from "../lib/editorialWallArtwork";
test("curated wall covers are local and always labelled as visual context",()=>{
  for(const title of ["The seven voyages of Zheng He","The lost kingdom of Aksum","The maps of Piri Reis","In the footsteps of Ibn Battuta","Unrelated proposal"]){
    const result=wallCoverFor(title);
    assert.ok(result.src.startsWith("/"));
    assert.ok(existsSync(join(process.cwd(),"public",result.src.slice(1))),result.src+" missing");
    assert.ok(result.alt&&result.credit);
    assert.match(result.label,/not historical evidence|not evidence|not the work|AI-generated/);
  }
});
test("an unknown or ambiguous title gets an explicitly generic motif, not a guessed portrait",()=>{
  const fallback=wallCoverFor("Unknown topic");
  assert.deepEqual(wallCoverFor("Zheng He and Piri Reis"),fallback);
  assert.deepEqual(wallCoverFor("https://untrusted.example/image.jpg"),fallback);
  assert.match(fallback.label,/not historical evidence/);
});
