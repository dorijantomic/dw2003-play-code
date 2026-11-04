// The Bridge at Golden Hour (data/authored/quests/pack_g_bridge.py): the Traveler's photograph of the Asuka Bridge.
//
//   node --test tests/quest-g-bridge.test.js
//
// Covers: the quest ships (shipped.txt + web/quests.json), the offer is the Traveler in Asuka City and the one objective
// is Cipher on the bridge, the bridge scene pins golden hour and clear weather without overriding the player's own
// Effects switches, the camera pans once to a numeric point and asks a three-option question, the hand-in offers three
// endings with real pays, the inn keeps the framed photo afterwards, the scene compiles with no errors, and the
// quest checker says OK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { compileScene } from "../web/quest-scenes.js";

const ROOT = new URL("..", import.meta.url).pathname;
const load = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const quests = load("web/quests.json").quests;
const q = quests.find((x) => x.id === "g_bridge_golden");
const talk = q?.objectives?.[0];
const scene = talk?.scene ?? [];
const steps = (key) => scene.filter((s) => s && key in s);
const itemNames = new Set(
    Object.values(load("web/assets/data/battlecmd/esitmnam.json"))
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .filter((v) => typeof v === "string"),
);

test("the quest ships: shipped.txt names it and web/quests.json holds it", () => {
    const shipped = readFileSync(ROOT + "data/authored/quests/shipped.txt", "utf8")
        .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    assert.ok(shipped.includes("g_bridge_golden"), "shipped.txt lists g_bridge_golden");
    assert.ok(q, "web/quests.json holds g_bridge_golden (rebuild it with tools/build_quests.py --with-drafts)");
    assert.equal(q.giver, "Traveler");
    assert.equal(q.title, "The Bridge at Golden Hour");
    assert.ok(q.short.length <= 14, `the pause list shows 14 characters, not ${q.short.length}`);
});

test("the Traveler offers it in Asuka City and the one objective is Cipher on the bridge", () => {
    assert.ok(q, "g_bridge_golden is in web/quests.json");
    assert.equal(q.offer.npc, 47);
    assert.ok(q.offer.maps.includes("s200"), `offer maps are ${q.offer.maps}`);
    assert.equal(q.objectives.length, 1, "one objective: the photograph");
    assert.equal(talk.type, "talk");
    assert.equal(talk.npc, 1005);
    assert.ok(talk.maps.includes("s205"), `talk maps are ${talk.maps}`);
    assert.ok(talk.lines.length >= 1, "the plain fallback lines exist too");
});

test("the bridge scene pins golden hour and clear weather, respecting the player's own Effects switches", () => {
    assert.ok(q, "g_bridge_golden is in web/quests.json");
    const time = steps("time");
    assert.equal(time.length, 1, "one time step");
    assert.deepEqual(time[0], { time: "golden", frames: 90 });
    const weather = steps("weather");
    assert.equal(weather.length, 1, "one weather step");
    assert.deepEqual(weather[0], { weather: "clear", frames: 30 });
    assert.equal(time[0].force, undefined, "no force: a player's Time switch stays respected");
    assert.equal(weather[0].force, undefined, "no force: a player's Weather switch stays respected");
});

test("Cipher is put at the rail facing the light, the camera pans to one numeric point, and the question has three answers", () => {
    assert.ok(q, "g_bridge_golden is in web/quests.json");
    const put = steps("put");
    assert.equal(put.length, 1, "one put step");
    assert.equal(put[0].put, 1005);
    assert.ok(Array.isArray(put[0].at) && put[0].at.length === 2 && put[0].at.every(Number.isFinite), "put at a world point");
    const face = steps("face");
    assert.ok(face.some((s) => s.face === 1005), "Cipher is turned toward the light");
    const pans = steps("pan").filter((s) => Array.isArray(s.pan) && s.pan.length === 2 && s.pan.every(Number.isFinite));
    assert.equal(pans.length, 1, "one pan to a numeric point");
    const asks = steps("ask");
    assert.equal(asks.length, 1, "one question at the bridge");
    assert.equal(asks[0].options.length, 3, "three answers to what the picture is really of");
    assert.equal(new Set(asks[0].options).size, 3, "and they are three different answers");
});

test("the hand-in offers three endings, each with a real pay", () => {
    assert.ok(q?.verdict, "the quest has a verdict");
    assert.equal(q.verdict.options.length, 3);
    assert.equal(q.verdict.pay.length, 3);
    assert.equal(q.verdict.after.length, 3);
    for (const lines of q.verdict.after) assert.ok(Array.isArray(lines) && lines.length >= 1, "each ending has its lines");
    for (const pay of q.verdict.pay) {
        assert.ok(Number.isInteger(pay.bits ?? 0), "bits is a whole number");
        assert.ok((pay.bits ?? 0) <= 20000, `bits ${pay.bits} is sane`);
        for (const it of pay.items ?? []) {
            assert.ok(itemNames.has(it.name), `pay item '${it.name}' is in the in-game item table`);
            assert.ok(Number.isInteger(it.count) && it.count >= 1, `pay item '${it.name}' has a count`);
        }
    }
    assert.ok((q.reward.bits ?? 0) <= 20000, "the common fee is sane too");
});

test("the inn keeps the framed photo once the quest is done", () => {
    assert.ok(q?.props, "the quest has props");
    assert.equal(q.props.length, 1, "one prop: the photograph");
    const p = q.props[0];
    assert.equal(p.map, "s235", "Asuka Inn 1F");
    assert.equal(p.sheet, "frame");
    assert.equal(p.after, "done");
    assert.ok(Array.isArray(p.at) && p.at.every(Number.isFinite), "it stands at a world point");
    const meta = load("web/extra_fx/frame.json");
    assert.deepEqual(Object.keys(meta.clips).sort(), ["glint", "idle"], "the sheet has the idle and glint clips");
});

test("the bridge scene compiles on the real bridge with no errors", () => {
    assert.ok(q, "g_bridge_golden is in web/quests.json");
    const pos = (id) => (id === 1005 ? { x: 896, y: 296 } : null);
    const { opcodes, errors } = compileScene(scene, { playerId: 2, pos });
    assert.deepEqual(errors, [], errors.join(" | "));
    assert.ok(opcodes.every((o) => !/NaN/.test(o)), `no opcode may carry a NaN:\n${opcodes.join("\n")}`);
});

test("put then face turns the character where they were put: real coordinates, never NaN", () => {
    // compileScene records where `put` set a character and every later position question falls back to it (the BUG-6
    // fix). The record must be a point, not an [x, y] pair: a pair reads as .x/.y = undefined and compiles the turn
    // into WALKTO 1005 NaN NaN.
    const { opcodes, errors } = compileScene([{ put: 1005, at: [912, 304] }, { face: 1005, dir: "right" }], { playerId: 2, pos: () => null });
    assert.deepEqual(errors, []);
    assert.deepEqual(opcodes, ["FN6A 1 2", "SETPOS 1005 912 304", "WALKTO 1005 912 304 6", "END"]);
});

test("tools/check_quests.py says OK", () => {
    const r = spawnSync("python3", ["tools/check_quests.py"], { cwd: ROOT, encoding: "utf8", timeout: 180000 });
    assert.equal(r.status, 0, `check_quests failed:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /(^|\n)OK\n?$/, "the last line is OK");
});
