import test from "node:test";
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {VISUAL_ALBUM} from "../lib/visualAlbum";
import {availableWallArtwork} from "../lib/editorialWallArtworkGenerated";
test("album uses real local assets, and staged covers never request a missing file",()=>{
 assert.equal(new Set(VISUAL_ALBUM.map(e=>e.id)).size,VISUAL_ALBUM.length);
 for(const e of VISUAL_ALBUM){
  assert.ok(e.credit&&e.date&&e.license&&e.caution);
  if(e.state==="pending"){assert.equal(e.src,null);continue;}
  assert.ok(e.src&&e.src.startsWith("/"));
  assert.ok(existsSync(join(process.cwd(),"public",e.src.slice(1))),e.src);
 }
 assert.equal(VISUAL_ALBUM.filter(e=>e.id.startsWith("wall-")&&e.state==="available").length,availableWallArtwork.length);
});
test("historical cartography retains provenance; research photos without rights remain reference-only",()=>{
 for(const e of VISUAL_ALBUM.filter(e=>e.kind==="cartography"))assert.ok(e.source?.startsWith("https://"));
 for(const e of VISUAL_ALBUM.filter(e=>e.kind==="photography"))assert.equal(e.state,"reference-only");
});
