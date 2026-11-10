// OPTIONS volumes (web/volume-levels.js) and how they reach the three players. 1 = today's gain, so nothing moves until the
// player moves a slider.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BASE_GAIN, clampLevel, scaleGain } from "../web/volume-levels.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the base gains are the ones the game has always used: music 0.6, effects 0.7, weather 0.55", () => {
    assert.deepEqual({ ...BASE_GAIN }, { music: 0.6, effects: 0.7, weather: 0.55 });
});

test("level 1 leaves each gain exactly as it was; 0 is silence; half is half", () => {
    for (const base of Object.values(BASE_GAIN)) {
        assert.equal(scaleGain(base, 1), base);
        assert.equal(scaleGain(base, 0), 0);
        assert.equal(scaleGain(base, 0.5), base * 0.5);
    }
});

test("a missing, empty or non-numeric level reads as 1 and a stray number is clamped to 0..1", () => {
    for (const bad of [undefined, null, "", "loud", NaN]) assert.equal(clampLevel(bad), 1, String(bad));
    assert.equal(clampLevel(7), 1);
    assert.equal(clampLevel(-3), 0);
    assert.equal(clampLevel("0.3"), 0.3);
});

test("audio.js: both players have setVolume, the starting gains are unchanged, jingles follow the music level", () => {
    const src = read("../web/audio.js");
    assert.match(src, /el\.volume = BASE_GAIN\.music;/);
    assert.match(src, /gain\.gain\.value = BASE_GAIN\.effects;/);
    assert.equal((src.match(/player\.setVolume = /g) || []).length, 2, "one on the music player, one on the effects player");
    assert.match(src, /je\.volume = scaleGain\(BASE_GAIN\.music, musicLevel\)/);
    assert.doesNotMatch(src, /\.volume = 0\.6/, "no hard-coded 0.6 left");
});

test("fxaudio.js: the weather master is 0.55 times the level, at build and on every setSound", () => {
    const src = read("../web/fxaudio.js");
    assert.match(src, /master\.gain\.value = 0\.55 \* level;/);
    assert.match(src, /ease\(master\.gain, on \? 0\.55 \* level : 0, ac, 0\.2\);/);
    assert.match(src, /export function setWeatherVolume\(v\)/);
});

test("ambience.js: both volumes start at 1, setFxMany saves once, and every settings change re-applies the volumes", () => {
    const src = read("../web/ambience.js");
    assert.match(src, /fx\.musicVolume = 1;/);
    assert.match(src, /fx\.soundVolume = 1;/);
    assert.match(src, /export function setFxMany\(values\) \{\s*Object\.assign\(fx, values\);\s*syncLegacyFlags\(\);\s*save\(Object\.keys\(values\)\);/);
    assert.match(src, /window\.__setFxMany = setFxMany;/);
    assert.match(src, /window\.__lightGain = fx\.lightGain;[^\n]*\n\s*applyVolumes\(\);/);
    assert.match(src, /window\.__bgm\?\.setVolume\?\.\(fx\.musicVolume\);/);
    assert.match(src, /window\.__sfx\?\.setVolume\?\.\(fx\.soundVolume\);/);
    const experimental = src.match(/const EXPERIMENTAL = \[([^\]]*)\];/)[1];
    assert.doesNotMatch(experimental, /Volume/, "the volumes are numbers, not switches");
});

test("game.js applies the saved volumes to the players it creates", () => {
    const src = read("../web/game.js");
    assert.match(src, /bgm\.setVolume\(window\.__fx\?\.musicVolume\);[^\n]*\n\s*sfx\.setVolume\(window\.__fx\?\.soundVolume\);/);
});

// ---- real gain code with a fake AudioContext: fxaudio.js music path (musicfx on) and audio.js element path (musicfx off)
const fakeParam = (v = 0) => ({ value: v, target: v, setTargetAtTime(t) { this.target = t; } });
const fakeNode = () => ({ gain: fakeParam(1), frequency: fakeParam(0), Q: fakeParam(0), connect() {}, start() {}, type: "" });
function fakeCtx() {
    const c = { state: "running", currentTime: 0, sampleRate: 8, destination: {}, nodes: [], resume() {},
        createBuffer: () => ({ getChannelData: () => new Float32Array(24) }),
        createBufferSource: () => fakeNode(), createBiquadFilter: () => fakeNode(), createOscillator: () => fakeNode(),
        createMediaElementSource: () => ({ connect() {} }) };
    c.createGain = () => { const n = fakeNode(); c.nodes.push(n); return n; };
    return c;
}
async function freshFx() {
    let wake = null; const ctxs = [];
    globalThis.window = { AudioContext: function () { const c = fakeCtx(); ctxs.push(c); return c; }, addEventListener: (ev, fn) => { wake ||= fn; } };
    const m = await import("../web/fxaudio.js?" + Math.random());
    wake();
    return { m, ctx: ctxs[0] };
}
// the music gain node is the last gain created by setMusic
const musGain = (ctx) => ctx.nodes[ctx.nodes.length - 1].gain;

test("musicfx ON: level 1 = gain 1 (today), level 0 = silence, half = half; element held at 0.6 so it is not doubled", async () => {
    const { m, ctx } = await freshFx();
    const el = { volume: 0.6 };
    m.setMusic(el, true, 0, 0);
    assert.equal(musGain(ctx).target, 1);
    assert.equal(el.routedToGain, true);
    assert.equal(el.volume, 0.6);
    m.setMusicVolume(0); assert.equal(musGain(ctx).target, 0);
    m.setMusicVolume(0.5); assert.equal(musGain(ctx).target, 0.5);
    m.setMusic(el, true, 1, 0); assert.ok(Math.abs(musGain(ctx).target - 0.5 * (1 - 0.42)) < 1e-12, "ducking multiplies the level");
    m.setMusicVolume(1); m.setMusic(el, true, 0, 0); assert.equal(musGain(ctx).target, 1);
});

test("musicfx OFF: the node is never built, the element volume carries the level (audio.js), 1 = 0.6", async () => {
    const { m, ctx } = await freshFx();
    const el = { volume: 0.6 };
    const before = ctx.nodes.length;
    m.setMusic(el, false, 0, 0);
    assert.equal(ctx.nodes.length, before, "no routing when musicfx is off");
    assert.equal(el.routedToGain, undefined);
    globalThis.window.Audio = undefined;
    globalThis.Audio = function () { this.volume = 1; };
    const { createBgmPlayer } = await import("../web/audio.js?" + Math.random());
    const p = createBgmPlayer();
    assert.equal(p.el.volume, 0.6);
    p.setVolume(1); assert.equal(p.el.volume, 0.6);
    p.setVolume(0); assert.equal(p.el.volume, 0);
    p.setVolume(0.5); assert.equal(p.el.volume, 0.3);
    p.el.routedToGain = true;                       // once routed, the element stays at 0.6 whatever the level
    p.setVolume(0.5); assert.equal(p.el.volume, 0.6);
    p.setVolume(0); assert.equal(p.el.volume, 0.6);
});
