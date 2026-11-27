import test from "node:test";
import assert from "node:assert/strict";
process.env.POSTGREST_URL = "https://data.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";

const ext = (licence: Record<string, string>) =>
  Object.fromEntries(Object.entries(licence).map(([k, v]) => [k, { value: v }]));

test("per-file licence: PD, CC0, CC BY and CC BY-SA accepted; NC, ND, non-free and unknown refused", async () => {
  const { classifyLicence } = await import("../lib/commonsImages");
  const accepted: [Record<string, string>, string][] = [
    [{ License: "pd", LicenseShortName: "Public domain" }, "public_domain"],
    [{ License: "pd-old-100", LicenseShortName: "Public domain" }, "public_domain"],
    [{ License: "cc0", LicenseShortName: "CC0" }, "cc0"],
    [{ License: "cc-by-4.0", LicenseShortName: "CC BY 4.0" }, "cc_by"],
    [{ License: "cc-by-sa-3.0-de", LicenseShortName: "CC BY-SA 3.0 de" }, "cc_by_sa"],
    [{ LicenseShortName: "CC BY-SA 4.0" }, "cc_by_sa"],
  ];
  for (const [value, cls] of accepted) {
    const decision = classifyLicence(ext(value));
    assert.equal(decision.usable, true, JSON.stringify(value));
    assert.equal(decision.usable && decision.class, cls);
  }
  const refused: [Record<string, string>, string][] = [
    [{ License: "cc-by-nc-sa-2.0", LicenseShortName: "CC BY-NC-SA 2.0" }, "licence-non-commercial"],
    [{ License: "cc-by-nd-4.0", LicenseShortName: "CC BY-ND 4.0" }, "licence-no-derivatives"],
    [{ License: "pd", LicenseShortName: "Public domain", NonFree: "true" }, "non-free"],
    [{ License: "gfdl", LicenseShortName: "GFDL" }, "licence-not-accepted"],
    [{ LicenseShortName: "Attribution" }, "licence-not-accepted"],
    [{}, "licence-unknown"],
  ];
  for (const [value, reason] of refused) {
    const decision = classifyLicence(ext(value));
    assert.equal(decision.usable, false, JSON.stringify(value));
    assert.equal(!decision.usable && decision.reason, reason);
  }
});

test("dates, titles and metadata text are normalized without inventing values", async () => {
  const { yearOf, normalizeFileTitle, plainText, filePageUrl } = await import("../lib/commonsImages");
  assert.equal(yearOf("circa 1590"), 1590);
  assert.equal(yearOf("2012-05-03 14:00:00"), 2012);
  assert.equal(yearOf("16th century"), null);
  assert.equal(yearOf(null), null);
  assert.equal(normalizeFileTitle("https://commons.wikimedia.org/wiki/File:Cabeza_de_Vaca.jpg"), "File:Cabeza de Vaca.jpg");
  assert.equal(normalizeFileTitle("Cabeza de Vaca.jpg"), "File:Cabeza de Vaca.jpg");
  assert.throws(() => normalizeFileTitle("File:bad|name.jpg"));
  assert.equal(plainText('<a href="x">Theodor de Bry</a>&nbsp;&amp; workshop'), "Theodor de Bry & workshop");
  assert.equal(plainText("   "), null);
  assert.equal(filePageUrl("File:Map of La Florida.jpg"), "https://commons.wikimedia.org/wiki/File:Map_of_La_Florida.jpg");
});

test.before(async () => {
  const { resetRegistryCache, setRegistryRequiredForTest } = await import("../lib/sourceSearch");
  setRegistryRequiredForTest(false); // seed registry: .wikimedia.org active, mixed licensing
  resetRegistryCache();
});

function commonsFixture(pages: unknown[]) {
  const requests: URL[] = [];
  const fetcher = (async (input: any, init: any) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(init?.redirect, "error");
    assert.equal(url.origin + url.pathname, "https://commons.wikimedia.org/w/api.php");
    return new Response(JSON.stringify({ query: { pages } }), { status: 200 });
  }) as typeof fetch;
  return { requests, fetcher };
}

const goodPage = {
  pageid: 101, lastrevid: 9001, title: "File:Narvaez expedition map.jpg", index: 2,
  imageinfo: [{
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Narvaez_expedition_map.jpg",
    thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Narvaez_expedition_map.jpg/1280px-Narvaez_expedition_map.jpg",
    mime: "image/jpeg", width: 3000, height: 2000, sha1: "a".repeat(40),
    extmetadata: ext({ License: "pd", LicenseShortName: "Public domain", Artist: "<span>Unknown author</span>",
      DateTimeOriginal: "1597", ImageDescription: "Map of <i>La Florida</i>.", Restrictions: "" }),
  }],
};

test("search returns usable candidates with provenance and lists refused files with their reason", async () => {
  const { searchCommonsImages } = await import("../lib/commonsImages");
  const nc = { ...goodPage, pageid: 102, title: "File:Modern reenactment.jpg", index: 1,
    imageinfo: [{ ...goodPage.imageinfo[0], extmetadata: ext({ License: "cc-by-nc-2.0", LicenseShortName: "CC BY-NC 2.0" }) }] };
  const offsite = { ...goodPage, pageid: 103, title: "File:Offsite.jpg", index: 3,
    imageinfo: [{ ...goodPage.imageinfo[0], url: "https://example.org/x.jpg" }] };
  const { requests, fetcher } = commonsFixture([goodPage, nc, offsite]);
  const results = await searchCommonsImages("Narvaez expedition map", 5, fetcher);
  assert.deepEqual(results.map(r => [r.title, r.usable]), [
    ["File:Modern reenactment.jpg", false], ["File:Narvaez expedition map.jpg", true], ["File:Offsite.jpg", false]]);
  const good = results[1];
  assert.ok(good.usable);
  assert.equal(good.licence.class, "public_domain");
  assert.equal(good.artist, "Unknown author");
  assert.equal(good.date_year, 1597);
  assert.equal(good.description, "Map of La Florida.");
  assert.equal(good.page_url, "https://commons.wikimedia.org/wiki/File:Narvaez_expedition_map.jpg");
  assert.equal(results[0].usable === false && results[0].reason, "licence-non-commercial");
  assert.equal(results[2].usable === false && results[2].reason, "image-host-not-wikimedia-media");
  assert.equal(requests[0].searchParams.get("gsrnamespace"), "6");
  await assert.rejects(searchCommonsImages(" ", 5, fetcher), /2-300/);
});

test("fetch returns one revision-bound file and refuses unusable or missing files", async () => {
  const { fetchCommonsImage } = await import("../lib/commonsImages");
  const image = await fetchCommonsImage("File:Narvaez expedition map.jpg", commonsFixture([goodPage]).fetcher);
  assert.equal(image.kind, "commons-image");
  assert.equal(image.revision_id, 9001);
  assert.equal(image.sha1, "a".repeat(40));
  assert.equal("usable" in image, false);
  const nd = { ...goodPage, imageinfo: [{ ...goodPage.imageinfo[0], extmetadata: ext({ License: "cc-by-nd-4.0", LicenseShortName: "CC BY-ND 4.0" }) }] };
  await assert.rejects(fetchCommonsImage("File:Narvaez expedition map.jpg", commonsFixture([nd]).fetcher), /licence-no-derivatives/);
  await assert.rejects(fetchCommonsImage("File:Missing.jpg", commonsFixture([{ title: "File:Missing.jpg", missing: true }]).fetcher), /not found/);
  const video = { ...goodPage, imageinfo: [{ ...goodPage.imageinfo[0], mime: "video/webm" }] };
  await assert.rejects(fetchCommonsImage("File:Narvaez expedition map.jpg", commonsFixture([video]).fetcher), /not-a-still-image/);
});

test("media URLs: originals only on upload, thumbnails also on thumb.wikimedia.org, tracking parameters removed", async () => {
  const { mediaUrl } = await import("../lib/commonsImages");
  const upload = new Set(["upload.wikimedia.org"]), thumbs = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);
  assert.equal(mediaUrl("https://upload.wikimedia.org/a/b.png?utm_source=commons.wikimedia.org&utm_content=original", upload), "https://upload.wikimedia.org/a/b.png");
  assert.equal(mediaUrl("https://thumb.wikimedia.org/a/1280px-b.png?utm_campaign=imageinfo", upload), null);
  assert.equal(mediaUrl("https://thumb.wikimedia.org/a/1280px-b.png?utm_campaign=imageinfo", thumbs), "https://thumb.wikimedia.org/a/1280px-b.png");
  assert.equal(mediaUrl("http://upload.wikimedia.org/a.png", upload), null);
  assert.equal(mediaUrl("https://user:pw@upload.wikimedia.org/a.png", upload), null);
  assert.equal(mediaUrl("https://upload.wikimedia.org.evil.example/a.png", upload), null);
});
