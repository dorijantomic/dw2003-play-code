// The HD pack grows while the game runs (launcher background job): the game re-reads the manifest
// and starts asking for the new 4x files without a restart.
import test from "node:test";
import assert from "node:assert/strict";

let manifest = { assets: [{ path: "maps/s200.png" }, { path: "sprites/x.png", native: true }] };
let stamp = "Mon, 10 Nov 2026 10:00:00 GMT";
let fetches = 0;
globalThis.localStorage = { getItem: (k) => (k === "assetMode" ? "hd" : null), setItem() {} };
globalThis.fetch = async () => {
  fetches++;
  return { ok: true, headers: { get: () => stamp }, json: async () => manifest };
};
const A = await import("../web/assets.js");

test("first read lists only files with a 4x file", async () => {
  await A.loadHdIndex();
  assert.equal(A.assetRequest("assets/maps/s200.png").scale, 4);
  assert.equal(A.assetRequest("assets/maps/s300.png").scale, 1);
  assert.equal(A.assetRequest("assets/sprites/x.png").scale, 1);
});

test("unchanged manifest is not re-parsed", async () => {
  assert.equal(await A.refreshHdIndex(), false);
});

test("a manifest that grew makes new files HD without a restart", async () => {
  manifest = { assets: [...manifest.assets, { path: "maps/s300.png" }] };
  stamp = "Mon, 10 Nov 2026 10:05:00 GMT";
  assert.equal(await A.refreshHdIndex(), true);
  assert.equal(A.assetRequest("assets/maps/s300.png").primary, "assets-hd/maps/s300.png");
  await A.loadHdIndex();
  assert.equal(A.assetRequest("assets/maps/s300.png").scale, 4);
});

test("a failing fetch keeps the list we have", async () => {
  globalThis.fetch = async () => { throw new Error("down"); };
  assert.equal(await A.refreshHdIndex(), false);
  assert.equal(A.assetRequest("assets/maps/s300.png").scale, 4);
});
