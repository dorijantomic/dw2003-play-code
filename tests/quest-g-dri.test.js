// The DDNA Mix-Up (data/authored/quests/pack_g_dri.py): one Monmon DDNA case, two claimants.
//
//   node --test tests/quest-g-dri.test.js
//
// Covers: the quest ships (shipped.txt + web/quests.json), the Researcher hands it out in Central Park and the two steps
// come in order (the Schoolgirl first, then the Armormon fight on Duel Island), the fight is the real screen 270 with the
// real Armormon numbers, the real Monmon DDNA grant in the game data is untouched, the hand-in offers three endings
// (the Schoolgirl, the other tamer, keep it) each with a real pay whose items exist in the game's item table, every scene
// compiles with no errors, and the quest checker says OK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { compileScene } from "../web/quest-scenes.js";

const ROOT = new URL("..", import.meta.url).pathname;
const load = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const quests = load("web/quests.json").quests;
const q = quests.find((x) => x.id === "g_dri_mixup");
const [talkObj, fightObj] = q?.objectives ?? [];
const itemNames = new Set(
    Object.values(load("web/assets/data/battlecmd/esitmnam.json"))
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .filter((v) => typeof v === "string"),
);

test("the quest ships: shipped.txt names it and web/quests.json holds it", () => {
    const shipped = readFileSync(ROOT + "data/authored/quests/shipped.txt", "utf8")
        .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    assert.ok(shipped.includes("g_dri_mixup"), "shipped.txt lists g_dri_mixup");
    assert.ok(q, "web/quests.json holds g_dri_mixup (rebuild it with tools/build_quests.py --with-drafts)");
    assert.equal(q.giver, "Researcher");
    assert.equal(q.title, "The DDNA Mix-Up");
    assert.ok(q.short.length <= 14, `the pause list shows 14 characters, not ${q.short.length}`);
});

test("the Researcher offers it in Central Park and the steps come in order: the Schoolgirl, then Duel Island", () => {
    assert.ok(q, "g_dri_mixup is in web/quests.json");
    assert.equal(q.offer.npc, 43);
    assert.ok(q.offer.maps.includes("s330"), `offer maps are ${q.offer.maps}`);
    assert.equal(q.objectives.length, 2, "two objectives: the talk, then the fight");
    assert.equal(talkObj.type, "talk");
    assert.equal(talkObj.npc, 48);
    assert.equal(talkObj.name, "Schoolgirl");
    assert.ok(talkObj.maps.includes("s330"), `talk maps are ${talkObj.maps}`);
    assert.ok(talkObj.lines.length >= 1, "the plain fallback lines exist too");
    assert.ok(Array.isArray(talkObj.scene) && talkObj.scene.length >= 1, "she walks over and talks");
    assert.equal(fightObj.type, "challenge");
    assert.deepEqual(fightObj.screens, [270], "the real Duel Island screen");
    assert.ok(fightObj.startAt.includes("s385"), `startAt is ${fightObj.startAt}`);
    assert.match(fightObj.label, /Armormon/, "the step says what is waiting on the island");
    assert.equal(q.ordered, true, "the talk comes before the fight");
});

test("the fight is the real Armormon screen, exactly as the game data has it", () => {
    const party = load("web/assets/data/field_encounters.json").screens["270"];
    assert.ok(Array.isArray(party), "screen 270 exists");
    assert.equal(party.length, 1, "exactly one enemy");
    assert.equal(party[0].name, "Armormon");
    assert.equal(party[0].id, 455);
    assert.equal(party[0].level, 28);
    assert.equal(party[0].hp, 1584);
    assert.equal(party[0].stat_scale, 16);
});

test("the real Monmon DDNA grant is untouched", () => {
    const grants = load("web/assets/data/item_grants.json").grants;
    const rows = grants.filter((g) => g.item_id === 360);
    assert.equal(rows.length, 1, "one row grants item 360");
    assert.equal(rows[0].item_name, "MonmonDDNA");
    assert.equal(rows[0].stage, "s385");
    assert.equal(rows[0].event_id, 1276, "the real grant event");
    assert.ok(itemNames.has("Monmon DDNA"), "the item table names the DDNA the player can carry");
});

test("the hand-in offers three endings, each with a real pay", () => {
    assert.ok(q?.verdict, "the quest has a verdict");
    assert.equal(q.verdict.options.length, 3);
    assert.equal(q.verdict.pay.length, 3);
    assert.equal(q.verdict.after.length, 3);
    assert.match(q.verdict.options[0], /Schoolgirl/, "the girl gets her own ending");
    assert.match(q.verdict.options[1], /other tamer/, "so does the other claimant");
    assert.match(q.verdict.options[2], /keeping/, "and keeping it is a real choice");
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
    const itemsOf = (i) => (q.verdict.pay[i].items ?? []).map((it) => it.name);
    assert.ok(itemsOf(0).includes("Booster 12a"), "the Schoolgirl ending pays a real booster");
    assert.ok(itemsOf(1).includes("Booster 13a"), "the other tamer ending pays a different one");
    assert.deepEqual(itemsOf(2), ["Monmon DDNA"], "keeping it pays the real DDNA item");
    assert.equal(q.verdict.pay[2].items[0].count, 1, "one DDNA, of course");
});

test("every scene in the quest compiles with no errors", () => {
    assert.ok(q, "g_dri_mixup is in web/quests.json");
    const scenes = [q.offer?.scene, q.doneScene, ...q.objectives.map((o) => o.scene)].filter(Boolean);
    assert.ok(scenes.length >= 3, "an offer scene, the talk scene and the hand-in scene");
    // The offer, the talk and the hand-in all run in Central Park (s330): compile them where the characters stand.
    const post = {};
    for (const n of load("web/assets/scenes/s330.json").npcs) {
        if ((n.x || n.y) && !post[n.npc_id]) post[n.npc_id] = { x: n.x, y: n.y };
    }
    const player = { x: post[43].x + 60, y: post[43].y };     // the player stands in front of the Researcher
    const pos = (id) => (id === 2 ? player : (post[id] ?? null));
    for (const sc of scenes) {
        const { opcodes, errors } = compileScene(sc, { playerId: 2, pos });
        assert.deepEqual(errors, [], errors.join(" | "));
        assert.ok(opcodes.every((o) => !/NaN/.test(o)), `no opcode may carry a NaN:\n${opcodes.join("\n")}`);
    }
});

test("tools/check_quests.py says OK", () => {
    const r = spawnSync("python3", ["tools/check_quests.py"], { cwd: ROOT, encoding: "utf8", timeout: 180000 });
    assert.equal(r.status, 0, `check_quests failed:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /(^|\n)OK\n?$/, "the last line is OK");
});
