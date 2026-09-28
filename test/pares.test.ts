import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  ensureRegistry,
  fetchSourceText,
  isParesDescriptionUrl,
  paresRecordText,
  resetRegistryCache,
  setRegistryRequiredForTest,
} from "../lib/sourceSearch";
import { extraCaFor, getWithExtraCa } from "../lib/tlsFetch";

const FIXTURE = join(__dirname, "fixtures", "pares", "123928.html");
const HTML = readFileSync(FIXTURE, "utf8");
const URL_OK = "https://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/123928";

test("PARES: only a record URL is a citable item", () => {
  assert.equal(isParesDescriptionUrl(URL_OK), true);
  assert.equal(isParesDescriptionUrl(URL_OK + "/"), true);
  assert.equal(isParesDescriptionUrl("https://pares.cultura.gob.es:443/ParesBusquedas20/catalogo/description/1"), true);
  for (const bad of [
    "https://pares.cultura.gob.es/ParesBusquedas20/catalogo/search",
    "https://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/",
    "https://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/12a",
    "https://pares.cultura.gob.es/other/path",
    "http://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/1",
    "https://pares.cultura.gob.es:8443/ParesBusquedas20/catalogo/description/1",
    "https://user:pw@pares.cultura.gob.es/ParesBusquedas20/catalogo/description/1",
    "https://pares.cultura.gob.es.evil.example/ParesBusquedas20/catalogo/description/1",
    "https://evilpares.cultura.gob.es/ParesBusquedas20/catalogo/description/1",
    "https://pares.cultura.gob.es@evil.example/ParesBusquedas20/catalogo/description/1",
    "", "not a url",
  ]) assert.equal(isParesDescriptionUrl(bad), false, bad);
});

test("PARES: the record text keeps the archival description and drops the site chrome", () => {
  const text = paresRecordText(HTML);
  assert.match(text, /PATRONATO,128,R\.2/);
  assert.match(text, /ES\.41091\.AGI\/6\.6\.4\.12\.45\/\/PATRONATO,128,R\.2/);
  assert.match(text, /Información de los méritos y servicios de Jerónimo de Aliaga/);
  assert.match(text, /pueden reproducirse y utilizarse sin permiso previo/, "the reuse terms it is admitted under");
  assert.doesNotMatch(text, /Contacte con PARES/);
  assert.doesNotMatch(text, /Aviso Legal/);
});

test("PARES: the TypeScript and Python extractors read a record the same way", () => {
  // A quotation an agent copies from fetch_source_text is later relocated by
  // the Curator in the page as ingest/pares.py reads it. If the two disagreed
  // on a character, a correct quotation would fail verification.
  const py = execFileSync("python3", ["-c", `
import sys
sys.path.insert(0, "ingest")
import pares
sys.stdout.write(pares.record_text(open(${JSON.stringify(FIXTURE)}, encoding="utf-8").read()))
`], { encoding: "utf8", cwd: join(__dirname, "..") });
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  assert.equal(norm(paresRecordText(HTML)), norm(py));
});

test("PARES: fetch_source_text kind=pares is gated like every other kind", async (t) => {
  const backend = async (path: string) => {
    if (path.startsWith("source_endpoints"))
      return [{ id: 21, institution_id: null, host_pattern: "pares.cultura.gob.es", match_type: "exact", status: "active", trust_mode: "item_verified" }];
    if (path.startsWith("source_policy_decisions"))
      return [{ endpoint_id: 21, decision_outcome: "approve", rights_class: "mixed" }];
    throw new Error(path);
  };

  await t.test("an unapproved registry does not govern the host at all", async () => {
    resetRegistryCache();
    setRegistryRequiredForTest(false);
    await assert.rejects(() => fetchSourceText(URL_OK, "pares"), /not an active Terraveler source endpoint/);
  });

  await t.test("once approved, a non-record URL on the host is refused before any request", async () => {
    resetRegistryCache();
    await ensureRegistry(Date.now(), backend);
    await assert.rejects(
      () => fetchSourceText("https://pares.cultura.gob.es/ParesBusquedas20/catalogo/search", "pares"),
      /takes a record URL/,
    );
  });

  await t.test("kind=pares against another governed host is refused", async () => {
    resetRegistryCache();
    await ensureRegistry(Date.now(), backend);
    await assert.rejects(() => fetchSourceText("https://www.gutenberg.org/x", "pares"), /is not pares\.cultura\.gob\.es/);
  });

  resetRegistryCache();
});

test("TLS: the listed intermediate is read from the shared vocab, and only for its host", () => {
  const pem = extraCaFor("pares.cultura.gob.es");
  assert.ok(pem && pem.includes("BEGIN CERTIFICATE"));
  assert.equal(extraCaFor("PARES.cultura.gob.es."), pem, "case and trailing dot do not matter");
  assert.equal(extraCaFor("example.com"), null);
  assert.equal(extraCaFor("pares.cultura.gob.es.evil.example"), null);
});

test("TLS: getWithExtraCa refuses a host with no listed intermediate — it is not a general escape hatch", async () => {
  await assert.rejects(() => getWithExtraCa("https://example.com/"), /no listed intermediate/);
  await assert.rejects(() => getWithExtraCa("http://pares.cultura.gob.es/x"), /https only/);
});

// The claim the whole remedy rests on: a server that sends an INCOMPLETE chain
// is reachable with verification ON once its intermediate is supplied, and
// supplying the intermediate does not make an unknown root trusted. Proved
// against a throwaway CA -> intermediate -> leaf chain served on localhost, so
// it needs no network and does not depend on PARES's certificate lifetime.
test("TLS: an intermediate completes an incomplete chain — and only a chain that reaches a trusted root", async (t) => {
  let dir: string;
  try {
    dir = mkdtempSync(join(tmpdir(), "tv-chain-"));
    const sh = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "int.ext"), "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n");
    writeFileSync(join(dir, "leaf.ext"), "subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\n");
    sh(`openssl req -x509 -newkey rsa:2048 -nodes -keyout root.key -out root.pem -subj "/CN=Test Root" -days 2 -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign`);
    sh(`openssl req -newkey rsa:2048 -nodes -keyout int.key -out int.csr -subj "/CN=Test Intermediate"`);
    sh(`openssl x509 -req -in int.csr -CA root.pem -CAkey root.key -CAcreateserial -out int.pem -days 2 -extfile int.ext`);
    sh(`openssl req -newkey rsa:2048 -nodes -keyout leaf.key -out leaf.csr -subj "/CN=localhost"`);
    sh(`openssl x509 -req -in leaf.csr -CA int.pem -CAkey int.key -CAcreateserial -out leaf.pem -days 2 -extfile leaf.ext`);
  } catch {
    t.skip("openssl is not available");
    return;
  }
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  // The server sends ONLY the leaf — the PARES misconfiguration.
  const server = https.createServer({ key: read("leaf.key"), cert: read("leaf.pem") }, (_req, res) => res.end("record"));
  await new Promise<void>((r) => server.listen(0, "localhost", r));
  const url = `https://localhost:${(server.address() as AddressInfo).port}/`;

  try {
    await t.test("with only the root, the incomplete chain is refused (this is the failure being fixed)", async () => {
      await assert.rejects(() => getWithExtraCa(url, { ca: [read("root.pem")] }), /unable to verify the first certificate|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i);
    });
    await t.test("with the root AND the missing intermediate, verification succeeds", async () => {
      const r = await getWithExtraCa(url, { ca: [read("root.pem"), read("int.pem")] });
      assert.equal(r.status, 200);
      assert.equal(r.body, "record");
    });
    await t.test("the intermediate alone does not make an unknown root trusted", async () => {
      await assert.rejects(() => getWithExtraCa(url, { ca: [read("int.pem")] }));
    });
  } finally {
    server.close();
  }
});
