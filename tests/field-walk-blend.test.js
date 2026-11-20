// Field walk blend (web/walk-blend.js): the weight maths, and that standing shows a single frame.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { clipFrame, consumeFieldTicks, FIELD_TICK_SECONDS, FIELD_RUN_CLIP, FIELD_WALK_CLIP } from "../web/vendor/engine.js";
import { blendWeight, walkBlendNext, WALK_TICK_RATE, WALK_BLEND_FRACTION } from "../web/walk-blend.js";
import { readSource } from "./helpers/source.js";

const walk = { cols: [10, 11, 12, 13, 14, 15, 16, 17], durations: [4, 4, 4, 4, 4, 4, 4, 4] };
const clips = { 5: { left: walk, down: walk }, 1: { down: { cols: [3], durations: [30] } },
    2: { down: { cols: [3, 4], durations: [10, 10] } } };

test("weight: 0 before the window, linear ramp, 1 at the end, always in [0,1]", () => {
    const d = 10, start = d * (1 - WALK_BLEND_FRACTION);
    assert.equal(blendWeight(0, d), 0);
    assert.equal(blendWeight(start, d), 0);
    assert.ok(Math.abs(blendWeight(start + (d - start) / 2, d) - 0.5) < 1e-12);
    assert.equal(blendWeight(d, d), 1);
    for (let r = 0; r <= d; r += 0.25) { const w = blendWeight(r, d); assert.ok(w >= 0 && w <= 1); }
    assert.equal(blendWeight(1, 0), 0);
});

test("walk: first part of a frame draws no blend; last part fades the next frame in", () => {
    assert.equal(walkBlendNext(clips, 5, "left", 0 / WALK_TICK_RATE), null);          // tick 0 of frame 0
    assert.equal(walkBlendNext(clips, 5, "left", 2 / WALK_TICK_RATE), null);          // 2 of 4: before window (2.4)
    const nb = walkBlendNext(clips, 5, "left", 3.2 / WALK_TICK_RATE);                 // 3.2 of 4: w = 0.5
    assert.equal(nb.col, 11);
    assert.ok(Math.abs(nb.w - 0.5) < 1e-9);
    assert.equal(nb.mirror, false);
});

test("walk: continuous at the frame change (w to 1, next frame starts at 0), and the cycle wraps", () => {
    const justBefore = walkBlendNext(clips, 5, "left", (4 - 1e-6) / WALK_TICK_RATE);
    assert.ok(justBefore.w > 0.9999);
    assert.equal(walkBlendNext(clips, 5, "left", 4 / WALK_TICK_RATE), null);          // now frame 1, weight 0
    const wrap = walkBlendNext(clips, 5, "left", (32 - 1e-6) / WALK_TICK_RATE);       // last frame fades to frame 0
    assert.equal(wrap.col, 10);
});

test("walk: mirrored directions resolve a left source with mirror=true; unknown dir falls back to down", () => {
    assert.equal(walkBlendNext(clips, 5, "right", 3.2 / WALK_TICK_RATE).mirror, true);
    assert.equal(walkBlendNext(clips, 5, "up", 3.2 / WALK_TICK_RATE).col, 11);
});

test("standing: a single-frame clip, a missing clip or a missing time never blends", () => {
    for (const t of [0, 0.3, 7.77, 1234.5]) assert.equal(walkBlendNext(clips, 1, "down", t), null);
    assert.equal(walkBlendNext(clips, 99, "down", 0.1), null);
    assert.equal(walkBlendNext(null, 5, "down", 0.1), null);
    assert.equal(walkBlendNext(clips, null, "down", 0.1), null);
});

test("no allocation: the same scratch object is returned every time", () => {
    const a = walkBlendNext(clips, 5, "left", 3.2 / WALK_TICK_RATE);
    const b = walkBlendNext(clips, 5, "left", 3.6 / WALK_TICK_RATE);
    assert.equal(a, b);
});

// Real-shaped clip data (web/extra_partners.json: run clip 5 = durations 4,2,2,4,4; walk clip 4 = 6,4,4,6,4)
// and the REAL engine clipFrame. The game clock is advanced exactly like game.js: whole 50 Hz ticks from
// consumeFieldTicks, drawn at 60 fps, with the tick accumulator as the sub-tick time.
const real = JSON.parse(fs.readFileSync(new URL("../web/extra_partners.json", import.meta.url), "utf8"));
const findClips = (o) => { if (!o || typeof o !== "object") return null; if (o.clips && o.clips["5"]) return o.clips;
    for (const v of Object.values(o)) { const r = findClips(v); if (r) return r; } return null; };
const realClips = findClips(real);

function timeline(clipId, dir, seconds, useSub) {
    let acc = 0, animTime = 0, draws = 0, frames = 0, bad = 0;
    const distinct = new Set();
    const hist = new Array(10).fill(0);
    for (let f = 0; f < seconds * 60; f++) {
        const k = consumeFieldTicks(acc, 1 / 60);
        acc = k.accumulator; animTime += k.ticks * FIELD_TICK_SECONDS;
        const cur = clipFrame(realClips, clipId, dir, animTime);
        const nb = walkBlendNext(realClips, clipId, dir, animTime, useSub ? acc : 0);
        frames++;
        if (!nb) continue;
        draws++; distinct.add(nb.w.toFixed(3));
        hist[Math.min(9, Math.floor(nb.w * 10))]++;
        const pd = realClips[String(clipId)][dir] ?? realClips[String(clipId)].down;
        const i = pd.cols.indexOf(cur.col), j = (i + 1) % pd.cols.length;
        if (nb.col !== pd.cols[j]) bad++;                                   // blend is always the frame after clipFrame's
    }
    return { frames, draws, hist, bad, distinct: distinct.size };
}

for (const [name, id] of [["run", FIELD_RUN_CLIP], ["walk", FIELD_WALK_CLIP]]) {
    test(`${name} clip at 60 fps: weights cover 0..1 in the last 40% of every frame, blend frame = next of clipFrame`, () => {
        const old = timeline(id, "left", 10, false), t = timeline(id, "left", 10, true);
        console.log(`${name}: blend draws/s without sub-tick ${old.draws / 10}, with sub-tick ${t.draws / 10} (of 60); weight histogram (10 bins 0..1): ${t.hist.join(" ")}`);
        assert.equal(t.bad, 0);
        console.log(`${name}: distinct weights without sub-tick ${old.distinct}, with sub-tick ${t.distinct}`);
        assert.ok(old.distinct <= 6, "whole-tick time only ever sees a handful of weights (the live bug)");
        assert.ok(t.distinct >= 10, "sub-tick time gives a spread of weights");
        for (let b = 0; b < 10; b++) assert.ok(t.hist[b] > 0, `weight bin ${b} is hit`);
        const share = t.draws / t.frames;                                   // about 40% of the time is fading
        assert.ok(share > 0.3 && share < 0.5, `blend share ${share}`);
    });
}

test("game.js wiring: blend only on moving, no scripted clip; leader/ghost/follower pass a sub-tick number; no flags", () => {
    const src = readSource(new URL("../web/game.js", import.meta.url));
    assert.match(src, /walkBlend !== false && isMoving && activeClip == null/);
    assert.match(src, /walkBlendNext\(meta\.clips, clipId, dir, clipTime, walkBlend\)/);
    assert.match(src, /\(state\._inCutscene \|\| playerStopping\) \? 0 : S\.fieldTickAccumulator/);
    assert.match(src, /f\.gathering \? 0 : S\.fieldTickAccumulator/);
    assert.match(src, /FIELD_WALK_CLIP, 0\);/);
    assert.doesNotMatch(src, /walkblend=|__walkBlend/i);
});

// Followers: every manifest character (leader or partner) has the walk/run clips, and each one blends.
test("followers: the follower draw call passes the sub-tick arg after the movement clip; every character clip blends", () => {
    const src = readSource(new URL("../web/game.js", import.meta.url));
    const i = src.indexOf("function drawPartyFollower(");
    const body = src.slice(i, src.indexOf("function drawPartyFollowers(", i));
    assert.match(body, /drawEntitySprite\(\s*pc, ps, state\.clipImgs\[pc\.id\], f\.x, f\.y,[\s\S]*FIELD_RUN_CLIP : FIELD_WALK_CLIP,\s*f\.gathering \? 0 : S\.fieldTickAccumulator,\s*\);/);
    const man = JSON.parse(fs.readFileSync(new URL("../web/assets/manifest.json", import.meta.url), "utf8"));
    for (const c of man.characters) for (const id of [FIELD_RUN_CLIP, FIELD_WALK_CLIP]) {
        const pd = c.clips?.[String(id)]?.left;
        assert.ok(pd && pd.cols.length > 1, `${c.id} clip ${id} has several frames`);
        const t = (pd.durations[0] - 0.5) / WALK_TICK_RATE;                  // late in frame 0
        const nb = walkBlendNext(c.clips, id, "left", t, 0);
        assert.ok(nb && nb.w > 0 && nb.col === pd.cols[1], `${c.id} clip ${id} blends`);
    }
});

// The "followers" seen in s330 with clip strips 396 / 468 px wide (p047leom, p126itmb) are map NPCs (scene npc_id 27 / 33),
// not party followers: they are manifest.npcs records, not characters, so the follower path (followerChar) never draws them.
// A standing NPC runs clip 1 (idle), which has no walk cycle to fade: sx 0..2 (36 px) and 0..3 (26 px) are its idle columns.
test("s330 p047leom / p126itmb are standing NPCs: npcs not characters, idle clip 1 columns, never blend while standing", () => {
    const man = JSON.parse(fs.readFileSync(new URL("../web/assets/manifest.json", import.meta.url), "utf8"));
    const scene = JSON.parse(fs.readFileSync(new URL("../web/assets/scenes/s330.json", import.meta.url), "utf8"));
    for (const [id, w, cols] of [["p047leom", 36, [0, 1, 2]], ["p126itmb", 26, [0, 1, 2, 3]]]) {
        assert.ok(!man.characters.some((c) => c.id === id), id + " is not a party character");
        const n = man.npcs.find((x) => x.id === id);
        assert.equal(n.clipFrameW, w);
        assert.ok(scene.npcs.some((x) => x.sprite === id && !x.path), id + " stands in s330");
        assert.deepEqual([...new Set(n.clips["1"].down.cols)].sort(), cols);
        for (const t of [0, 0.37, 1.9]) assert.equal(walkBlendNext(n.clips, 1, "down", t, 0.01) === null || n.clips["1"].down.cols.length > 1, true);
    }
});
