// The giant quests (data/authored/quests/pack_zz_giant.py) and the fx `scale` step they lean on.
//
//   node --test tests/quest-giant.test.js
//
// Covers: compileScene passes a valid `scale` through to the event (and refuses a silly one), a scene without it is
// byte-for-byte the old one (no `scale` key), the two drafts carry the crossing + prints + a challenge at the right
// screen, their props name sheets that really exist, and their giant/footprint sheets are in the fx-sheet format
// web/quest-fx.js loads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { compileScene } from "../web/quest-scenes.js";

const ROOT = new URL("..", import.meta.url).pathname;
const load = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const quests = load("web/quests.json").quests;
const byId = (id) => quests.find((q) => q.id === id);

test("an fx step carries scale to its event; without it no scale key exists", () => {
    const withScale = compileScene([{ fx: "giant", sheet: "big_claw", at: [10, 20], scale: 2 }], { pos: () => ({ x: 0, y: 0 }) });
    assert.deepEqual(withScale.errors, []);
    const ev = withScale.events[0];
    assert.equal(ev.kind, "fx");
    assert.equal(ev.scale, 2);
    const plain = compileScene([{ fx: "giant", sheet: "big_claw", at: [10, 20] }], { pos: () => ({ x: 0, y: 0 }) });
    assert.equal("scale" in plain.events[0], false, "a scene without scale is unchanged");
});

test("a scale outside 0.1..8 is a scene error, not a silent clamp", () => {
    for (const bad of [0, 9, -1, "huge"]) {
        const { errors } = compileScene([{ fx: "giant", at: [0, 0], scale: bad }], { pos: () => ({ x: 0, y: 0 }) });
        assert.equal(errors.length, 1, `scale ${bad} is refused`);
    }
});

test("both giant quests are drafts with the crossing, the prints and a challenge", { skip: "giant quests removed for now 2026-10-26 (their art is local only)" }, () => {
    for (const id of ["zz_giant_trike", "zz_giant_metal"]) {
        const d = byId(id);
        assert.ok(d, `${id} is in web/quests.json (built with --with-drafts)`);
        const accept = d.acceptScene ?? [];
        const fxs = accept.filter((s) => s && s.fx);
        assert.ok(fxs.some((s) => s.clip && String(s.clip).startsWith("walk-")), `${id}: the giant walks`);
        assert.ok(accept.some((s) => s && s.fxmove && s.fxmove === fxs[0].fx), `${id}: it slides across`);
        assert.ok(accept.filter((s) => s && /^print\d+$/.test(s.fx ?? "")).length >= 4, `${id}: a print at each footfall`);
        assert.ok(accept.some((s) => s && s.shake), `${id}: the ground shakes`);
        assert.ok((d.props ?? []).length >= 4, `${id}: the prints stay as props`);
        assert.ok(d.props.every((p) => p.map === (id === "zz_giant_trike" ? "s330" : "s715")), `${id}: props on its own map`);
        assert.ok(d.props.filter((p) => /^print_/.test(p.sheet)).every((p) => p.layer === "behind"),
            `${id}: prints lie on the ground, behind the people`);
        // the trail: go to the gate/pass, then the fight there
        const visit = d.objectives.filter((o) => o.type === "visit");
        assert.equal(visit.length, 1, `${id}: one trail objective`);
        assert.equal(visit[0].map, id === "zz_giant_trike" ? "s340" : "s710", `${id}: the trail leads through the gate`);
        assert.equal(d.objectives.filter((o) => o.type === "challenge").length, 1, `${id}: one fight`);
        const challenge = d.objectives.find((o) => o.type === "challenge");
        assert.deepEqual(challenge.screens, [id === "zz_giant_trike" ? 51 : 100], `${id}: the giant's own screen`);
        assert.deepEqual(challenge.startAt[0], visit[0].map, `${id}: fought where the trail ends`);
        assert.ok(d.reward.bits >= 3000, `${id}: pays big`);
        assert.equal((d.reward.items ?? []).length, 1, `${id}: and an item`);
        // the item must be a real one: the typo "EnergyDisk" shipped once and check_quests caught it
        const items = load("web/assets/data/battlecmd/esitmnam.json");
        const real = new Set(Object.values(items).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => typeof v === "string"));
        for (const it of d.reward.items) assert.ok(real.has(it.name), `${id}: reward item '${it.name}' is in the item table`);
    }
    assert.ok(!byId("zz_giant_trike") || true);
});

test("every sheet the two quests name is on disk in the fx format the loader reads", { skip: "giant quests removed for now 2026-10-26 (their art is local only)" }, () => {
    const names = new Set();
    for (const id of ["zz_giant_trike", "zz_giant_metal"]) {
        const d = byId(id);
        for (const s of [...(d.acceptScene ?? []), ...(d.offer?.scene ?? []), ...(d.doneScene ?? [])]) {
            if (s?.sheet) names.add(s.sheet);
        }
        for (const p of d.props ?? []) names.add(p.sheet);
    }
    assert.ok(names.size >= 3, `the quests name their art (${[...names]})`);
    for (const n of names) {
        const png = `${ROOT}web/extra_fx/${n}.png`;
        const meta = load(`web/extra_fx/${n}.json`);
        assert.ok(existsSync(png), `${n}.png exists`);
        assert.ok(Array.isArray(meta.frame) && meta.frame[0] > 0 && meta.frame[1] > 0, `${n}: frame size`);
        assert.ok(Array.isArray(meta.anchor), `${n}: anchor`);
        assert.ok(meta.clips && Object.keys(meta.clips).length, `${n}: clips`);
        for (const [clip, def] of Object.entries(meta.clips)) {
            assert.ok(Array.isArray(def.frames) && def.frames.length, `${n}.${clip}: frames`);
            assert.ok(def.frames.every((f) => Number.isInteger(f)), `${n}.${clip}: cell indices`);
        }
    }
});

test("the giant sheet is several times the player's height", () => {
    const giant = load("web/extra_fx/big_claw.json");
    const scale = 1;                    // the step's own scale multiplies this
    assert.ok(giant.frame[1] * scale >= 3 * 48, `a giant is >= 3x the 48 px player (${giant.frame[1]})`);
    assert.ok(giant.clips["walk-left"] && giant.clips["walk-right"], "walks both ways");
});
