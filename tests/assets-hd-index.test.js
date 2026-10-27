// HD mode asks the HD pack only for files its manifest lists with a 4x file; exact-pixel art
// (recorded `native: true`) and anything the pack never built load the native file directly.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: (k) => (k === "assetMode" ? "hd" : null), setItem() {} };
const A = await import("../web/assets.js");

test("listed AI files go to the HD pack with a native fallback", () => {
  A.setHdIndex(["maps/s300.png"]);
  assert.deepEqual(A.assetRequest("assets/maps/s300.png"),
    { primary: "assets-hd/maps/s300.png", fallback: "assets/maps/s300.png", scale: 4 });
});

test("unlisted or native-only files load the native file, no 404 first", () => {
  A.setHdIndex(["maps/s300.png"]);
  assert.deepEqual(A.assetRequest("assets/sprites/p002plyk.png"),
    { primary: "assets/sprites/p002plyk.png", fallback: null, scale: 1 });
  // a cache-busting query does not hide a listed file
  A.setHdIndex(["ui/fight_ui.png"]);
  assert.equal(A.assetRequest("assets/ui/fight_ui.png?v=2").primary, "assets-hd/ui/fight_ui.png?v=2");
});

test("no manifest known yet: try HD first, as before", () => {
  A.setHdIndex(null);
  assert.equal(A.assetRequest("assets/sprites/p002plyk.png").primary, "assets-hd/sprites/p002plyk.png");
});

test("authentic mode never touches the HD pack", () => {
  A.setHdIndex(["maps/s300.png"]);
  assert.equal(A.assetRequest("assets/maps/s300.png", A.ASSET_MODE_AUTHENTIC).primary, "assets/maps/s300.png");
});
