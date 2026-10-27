// HD map tiles (web/map-tiles.js, always on in HD): which tiles a view
// asks for, where each lands, the native picture under until every visible tile is in, the cache bound,
// and the layer split. No real images: the loader and the canvas are fakes that record what is drawn.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadTileIndex, tiledMap, setTileEnv, resetTiles, tickTiles, tileStats, retainTiledMaps } from "../web/map-tiles.js";

// 4x HD map of 600x300 native px = 2400x1200 -> 3 cols x 2 rows of 1024 tiles (+4 px gutter each side).
const INDEX = { tile: 1024, gutter: 4, scale: 4, maps: {
  m: { w: 2400, h: 1200, cols: 3, rows: 2, skip: [[2, 1]] },
} };

function fakeCtx() {
  const calls = [];
  const ctx = { imageSmoothingEnabled: false, globalCompositeOperation: "source-over",
    drawImage: (...a) => calls.push({ a, smooth: ctx.imageSmoothingEnabled, op: ctx.globalCompositeOperation }) };
  return { ctx, calls };
}

let loads;
const settle = () => new Promise((r) => setTimeout(r, 0));
beforeEach(async () => {
  resetTiles();
  loads = [];
  setTileEnv({
    load: (url) => { loads.push(url); const tw = url.includes("/2_") ? 352 + 8 : 1032; const th = url.endsWith("_1.webp") ? 176 + 8 : 1032; return Promise.resolve({ url, width: tw, height: th, close() { this.closed = true; } }); },
    canvas: (w, h) => { const c = fakeCtx(); return { width: w, height: h, getContext: () => c.ctx, calls: c.calls }; },
  });
  await loadTileIndex(() => INDEX);
});

test("a map that was not tiled has no tiled copy", () => {
  assert.equal(tiledMap("nope"), null);
  assert.equal(tiledMap("m").w, 600);
  assert.equal(tiledMap("m").h, 300);
});

test("first frame: nothing ready, visible tiles fetched first, then one ring", async () => {
  const t = tiledMap("m");
  const { ctx, calls } = fakeCtx();
  // view 320x240 native at the top-left: tiles are 256 native px -> cols 0..1, rows 0..0
  const done = t.draw(ctx, 0, 0, 0, 0, 320, 240);
  assert.equal(done, false);
  assert.equal(calls.length, 0);
  assert.deepEqual(loads.slice(0, 2), ["assets-hd/map-tiles/m/0_0.webp", "assets-hd/map-tiles/m/1_0.webp"]);
  await settle();
  // ring: 2_0, 0_1, 1_1 (2_1 is empty and never fetched)
  assert.deepEqual([...loads].sort(), ["0_0", "0_1", "1_0", "1_1", "2_0"].map((k) => `assets-hd/map-tiles/m/${k}.webp`));
});

test("once loaded, each visible tile is drawn from inside its gutter to its native place", async () => {
  const t = tiledMap("m");
  const { ctx, calls } = fakeCtx();
  t.draw(ctx, -100, -50, 100, 50, 320, 240);
  await settle(); await settle();
  tickTiles();
  const done = t.draw(ctx, -100, -50, 100, 50, 320, 240);
  assert.equal(done, true);
  // view x 100..420 -> cols 0,1 ; y 50..290 -> rows 0,1
  const got = calls.map((c) => [c.a[0].url.split("/").pop(), ...c.a.slice(1)]);
  assert.deepEqual(got, [
    ["0_0.webp", 4, 4, 1024, 1024, -100, -50, 256, 256],
    ["1_0.webp", 4, 4, 1024, 1024, 156, -50, 256, 256],
    ["0_1.webp", 4, 4, 1024, 176, -100, 206, 256, 44],
    ["1_1.webp", 4, 4, 1024, 176, 156, 206, 256, 44],
  ]);
  assert.ok(calls.every((c) => c.smooth), "HD tiles are drawn smoothed");
  assert.equal(ctx.imageSmoothingEnabled, false, "smoothing restored");
});

test("the empty tile counts as drawn", async () => {
  const t = tiledMap("m");
  const { ctx, calls } = fakeCtx();
  t.draw(ctx, 0, 0, 500, 250, 100, 50);       // cols 1..2, rows 0..1, 2_1 skipped
  await settle(); await settle();
  tickTiles();
  assert.equal(t.draw(ctx, 0, 0, 500, 250, 100, 50), true);
  assert.ok(!calls.some((c) => c.a[0].url.endsWith("2_1.webp")));
  assert.ok(calls.some((c) => c.a[0].url.endsWith("2_0.webp") && c.a[3] === 352 && c.a[7] === 88), "edge tile drawn at its real width");
});

test("split layers wait for the mask, then cut each tile at the mask scaled 4x", async () => {
  const t = tiledMap("m");
  const { ctx } = fakeCtx();
  t.draw(ctx, 0, 0, 0, 0, 100, 100, "ground");
  await settle();
  tickTiles();
  assert.equal(t.draw(ctx, 0, 0, 0, 0, 100, 100, "ground"), false, "no mask yet");
  const mask = { mask: true };
  t.setSplitMask(mask);
  tickTiles();
  const out = fakeCtx();
  assert.equal(t.draw(out.ctx, 0, 0, 0, 0, 100, 100, "ground"), true);
  const cv = out.calls[0].a[0];
  assert.equal(cv.width, 1032);
  const [base, cut] = cv.calls;
  assert.equal(base.a[0].url, "assets-hd/map-tiles/m/0_0.webp");
  assert.equal(cut.op, "destination-out");
  assert.deepEqual(cut.a, [mask, -1, -1, 258, 258, 0, 0, 1032, 1032]);
  assert.equal(cut.smooth, false, "mask is scaled up without smoothing");
  const l2 = fakeCtx();
  t.draw(l2.ctx, 0, 0, 0, 0, 100, 100, "layer2");
  assert.equal(l2.calls[0].a[0].calls[1].op, "destination-in");
});

test("tiles of maps left behind are closed", async () => {
  const t = tiledMap("m");
  const { ctx } = fakeCtx();
  t.draw(ctx, 0, 0, 0, 0, 320, 240);
  await settle(); await settle();
  assert.ok(tileStats().decoded > 0);
  retainTiledMaps(["other"]);
  assert.equal(tileStats().cached, 0);
});

test("the cache stays bounded while walking across a big map", async () => {
  const big = { tile: 1024, gutter: 4, scale: 4, maps: { b: { w: 40960, h: 40960, cols: 40, rows: 40, skip: [] } } };
  resetTiles();
  setTileEnv({ load: (url) => Promise.resolve({ url, width: 1032, height: 1032, close() {} }) });
  await loadTileIndex(() => big);
  const t = tiledMap("b");
  const { ctx } = fakeCtx();
  for (let x = 0; x < 9000; x += 64) {
    tickTiles();
    t.draw(ctx, -x, -x, x, x, 320, 240);
    await settle();
  }
  assert.ok(tileStats().cached <= 40, `cached ${tileStats().cached}`);
});
