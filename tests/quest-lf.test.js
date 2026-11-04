// The Lost and Found (data/authored/quests/pack_lf_lost_found.py): the inn's box of other people's things.
//
//   node --test tests/quest-lf.test.js
//
// Covers: the three jobs ship (shipped.txt + web/quests.json), Tailmon hands them out at the Asuka Inn counter (s235,
// 188,154 -- a real record with no spawn_flags), each owner's real post and its story gate, one talk step per job
// gated through unlock.met, a two-way verdict per job with two real pays and two closing lists, the charm's real bring
// item, the crate prop left in the inn at 188,200 on ground the player can stand on, every scene compiles with no
// errors, no {token} and no partner speaker, the arc's words are plain and touch no story flag, the whole arc lives in
// the quest data behind the F2 Quests switch, the builder's draft build changes no other quest, and the quest checker
// says OK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileScene } from "../web/quest-scenes.js";
import { questGrid, questStandFree } from "../web/quest-walk.js";

const ROOT = new URL("..", import.meta.url).pathname;
const load = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const quests = load("web/quests.json").quests;
const byId = new Map(quests.map((x) => [x.id, x]));
const IDS = ["lf_pass", "lf_charm", "lf_ticket"];
const [pass, charm, ticket] = IDS.map((id) => byId.get(id));
const defs = [pass, charm, ticket].filter(Boolean);
const shipped = readFileSync(ROOT + "data/authored/quests/shipped.txt", "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const itemNames = new Set(
    Object.values(load("web/assets/data/battlecmd/esitmnam.json"))
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .filter((v) => typeof v === "string"),
);

/** Every word the quest puts on screen, one list, so the wording rules are checked in one place. */
function wordsOf(d) {
    const out = [d?.title, d?.text, d?.short, d?.verdict?.ask];
    out.push(...(d?.verdict?.options ?? []), ...(d?.verdict?.after ?? []).flat());
    out.push(...(d?.offer?.lines ?? []), ...(d?.offer?.remindLines ?? []), ...(d?.offer?.doneLines ?? []));
    for (const sc of [d?.offer?.scene, d?.doneScene, ...(d?.objectives ?? []).map((o) => o.scene)]) {
        for (const st of sc ?? []) if (typeof st?.text === "string") out.push(st.text);
    }
    return out.filter((t) => typeof t === "string");
}

/** The scene file's own standing posts: npc id -> the first real point. */
function postsOf(map) {
    const out = new Map();
    for (const n of load(`web/assets/scenes/${map}.json`).npcs) {
        if (!(n.x || n.y)) continue;
        if (!out.has(n.npc_id)) out.set(n.npc_id, { x: n.x, y: n.y });
    }
    return out;
}

test("the three jobs ship: shipped.txt names them and web/quests.json holds them", () => {
    for (const id of IDS) {
        assert.ok(shipped.includes(id), `shipped.txt lists ${id}`);
        assert.ok(byId.get(id), `web/quests.json holds ${id} (rebuild it with tools/build_quests.py --with-drafts)`);
    }
    const pack = readFileSync(ROOT + "data/authored/quests/pack_lf_lost_found.py", "utf8");
    for (const id of IDS) assert.match(pack, new RegExp(`quest\\("${id}"`), `the pack authors ${id}`);
    assert.equal(defs.length, 3, "three quests, no more");
    assert.equal(pass.giver, "Tailmon");
    assert.equal(charm.giver, "Tailmon");
    assert.equal(ticket.giver, "Tailmon");
    assert.equal(pass.title, "The Pass in the Box");
    assert.equal(charm.title, "The Charm in the Box");
    assert.equal(ticket.title, "The Ticket With No Name");
    for (const q of defs) assert.ok(q.short.length <= 14, `${q.id}: the pause list shows 14 characters, not ${q.short.length}`);
    assert.equal(pass.offer.npc, 20, "Tailmon keeps the box");
    assert.ok(pass.offer.maps.includes("s235"), `pass offer maps are ${pass.offer.maps}`);
    assert.ok(charm.offer.maps.includes("s235"), `charm offer maps are ${charm.offer.maps}`);
    assert.ok(ticket.offer.maps.includes("s235"), `ticket offer maps are ${ticket.offer.maps}`);
});

test("the arc runs in order: level 4, then 8, then 16, each waiting on the one before", () => {
    assert.ok(pass && charm && ticket, "all three jobs are in web/quests.json");
    assert.equal(pass.unlock.level, 4);
    assert.equal(charm.unlock.level, 8);
    assert.equal(ticket.unlock.level, 16);
    assert.equal(pass.requires, undefined, "the first job waits on nothing");
    assert.equal(charm.requires.done, "lf_pass");
    assert.equal(charm.unlock.done, "lf_pass");
    assert.equal(ticket.requires.done, "lf_charm");
    assert.equal(ticket.unlock.done, "lf_charm");
});

test("the inn counter and every owner's post are the measured ones", () => {
    const inn = load("web/assets/scenes/s235.json").npcs;
    const tail = inn.find((n) => n.npc_id === 20 && n.x === 188 && n.y === 154);
    assert.ok(tail, "Tailmon stands at 188,154 in the Asuka Inn 1F");
    assert.equal(tail.spawn_flags, undefined, "her record carries no spawn_flags: she is always behind the counter");
    assert.ok(!tail.cutsceneOnly, "and it is not a cutscene-only record");
    for (const [map, npc, x, y] of [["s200", 47, 555, 474], ["s200", 57, 1088, 288], ["s330", 58, 1065, 997], ["s501", 46, 432, 249]]) {
        const recs = load(`web/assets/scenes/${map}.json`).npcs.filter((n) => n.npc_id === npc && (n.x || n.y));
        assert.ok(recs.some((n) => n.x === x && n.y === y), `npc ${npc} stands at ${x},${y} on ${map}`);
        for (const n of recs) {
            assert.ok(Array.isArray(n.spawn_flags) && n.spawn_flags.length,
                `${map} record ${n.id} of npc ${npc} is story-gated (spawn_flags), so the met unlock is what opens the job`);
        }
    }
});

test("one talk step per job, gated by having met the owner, and the charm needs a real cord", () => {
    assert.ok(pass && charm && ticket, "all three jobs are in web/quests.json");
    const met = (q) => (q.unlock.met ?? []).map((r) => `${r.npc}@${r.map}`);
    const talks = (q) => q.objectives.filter((o) => o.type === "talk");
    assert.equal(pass.objectives.length, 1, "the pass is one conversation");
    assert.equal(talks(pass).length, 1);
    assert.equal(talks(pass)[0].npc, 47);
    assert.ok(talks(pass)[0].maps.includes("s200"), `talk maps are ${talks(pass)[0].maps}`);
    assert.ok(met(pass).includes("20@s235") && met(pass).includes("47@s200"), `pass unlock.met is ${met(pass)}`);
    assert.equal(charm.objectives.length, 2, "the charm is a conversation and a real errand");
    assert.equal(talks(charm)[0].npc, 57);
    assert.ok(talks(charm)[0].maps.includes("s200"), `talk maps are ${talks(charm)[0].maps}`);
    const bring = charm.objectives.find((o) => o.type === "bring");
    assert.ok(bring, "the charm job asks for something");
    assert.ok(itemNames.has(bring.item), `bring item '${bring.item}' is in the in-game item table`);
    assert.ok(Number.isInteger(bring.count) && bring.count >= 1);
    assert.ok(met(charm).includes("57@s200"), `charm unlock.met is ${met(charm)}`);
    assert.equal(ticket.objectives.length, 1);
    assert.equal(talks(ticket)[0].npc, 46);
    assert.ok(talks(ticket)[0].maps.includes("s501"), `talk maps are ${talks(ticket)[0].maps}`);
    assert.ok(met(ticket).includes("46@s501"), `ticket unlock.met is ${met(ticket)}`);
    for (const q of defs) {
        assert.ok(q.offer.lines.length >= 2, `${q.id}: Tailmon has something to say`);
        assert.ok(q.offer.remindLines.length >= 1, `${q.id}: and something while the job is open`);
        assert.ok(q.offer.doneLines.length >= 1, `${q.id}: and something when it is handed in`);
        assert.equal(q.offer.scene, undefined, `${q.id}: a counter giver is spoken in place (no walking scene)`);
        assert.equal(q.doneScene, undefined, `${q.id}: and so is her hand-in`);
    }
});

test("every job ends in a two-way choice with two real pays and two closing lists", () => {
    assert.ok(pass && charm && ticket, "all three jobs are in web/quests.json");
    for (const q of defs) {
        assert.ok(q.verdict, `${q.id} has a verdict`);
        assert.equal(q.verdict.options.length, 2, `${q.id}: exactly two endings`);
        assert.equal(new Set(q.verdict.options).size, 2, `${q.id}: two different endings`);
        assert.equal(q.verdict.pay.length, 2, `${q.id}: one pay per ending`);
        assert.equal(q.verdict.after.length, 2, `${q.id}: one closing per ending`);
        assert.match(q.verdict.ask, /\?$/, `${q.id}: the hand-in asks a question`);
        for (const o of q.verdict.options) assert.ok(o.length <= 28, `${q.id}: option '${o}' fits the menu`);
        for (const p of q.verdict.pay) {
            assert.ok(Number.isInteger(p.bits ?? 0), `${q.id}: bits is a whole number`);
            assert.ok((p.bits ?? 0) <= 20000, `${q.id}: bits ${p.bits} is sane`);
            assert.ok((p.items ?? []).length >= 1, `${q.id}: each ending hands something over`);
            for (const it of p.items ?? []) {
                assert.ok(itemNames.has(it.name), `${q.id}: pay item '${it.name}' is in the in-game item table`);
                assert.ok(Number.isInteger(it.count) && it.count >= 1, `${q.id}: pay item '${it.name}' has a count`);
            }
        }
        for (const lines of q.verdict.after) assert.ok(Array.isArray(lines) && lines.length >= 2, `${q.id}: each ending has its own closing`);
        assert.ok((q.reward.bits ?? 0) <= 20000, `${q.id}: the common fee is sane too`);
    }
    assert.match(pass.verdict.options[1], /box/i, "the pass can stay in the box");
    assert.match(charm.verdict.options[0], /him/i, "the charm can go back to the Old Man");
    assert.match(charm.verdict.options[1], /her/i, "or to the Old Woman who remembers it");
    assert.match(ticket.verdict.options[0], /post/i, "the ticket can be posted");
    assert.match(ticket.verdict.options[1], /box/i, "or kept in the box");
    assert.equal(bringItem(charm), "Ribbon");
});

/** The one item the charm job asks the player to bring. */
function bringItem(q) {
    return q.objectives.find((o) => o.type === "bring")?.item;
}

test("the crate waits in the inn once the last job is done, on ground a player can stand on", () => {
    assert.ok(ticket, "lf_ticket is in web/quests.json");
    assert.deepEqual(ticket.props, [{ map: "s235", sheet: "crate", at: [188, 200], after: "done" }],
        "one prop: the box itself, in the inn, once the job is handed in");
    assert.equal(pass.props, undefined, "the first job leaves nothing behind");
    assert.equal(charm.props, undefined, "nor the second");
    const meta = load("web/extra_fx/crate.json");
    assert.deepEqual(Object.keys(meta.clips).sort(), ["fall", "hit", "idle", "settle"], "the crate sheet carries the four clips");
    assert.deepEqual(meta.frame, [24, 24], "the crate cell is 24 by 24");
    const grid = questGrid(load("web/assets/collision/s235.json"));
    assert.ok(grid, "the inn has collision data");
    assert.equal(grid.cell, 8, "the inn's grid is 8 px cells");
    assert.equal(questStandFree(grid, 188, 200), true, "one tile below the counter is free ground");
    assert.equal(questStandFree(grid, 188, 154), false, "Tailmon's own tile is not, so the prop is not on top of her");
});

test("every scene the arc runs compiles with no errors and no NaN", () => {
    assert.ok(pass && charm && ticket, "all three jobs are in web/quests.json");
    const posts = { s200: postsOf("s200"), s330: postsOf("s330"), s501: postsOf("s501") };
    let scenes = 0;
    for (const q of defs) {
        for (const o of q.objectives) {
            if (!o.scene) continue;
            scenes++;
            const map = o.maps[0];
            const owner = posts[map]?.get(o.npc);
            assert.ok(owner, `${q.id}: npc ${o.npc} has a real post on ${map}`);
            const player = { x: owner.x + 48, y: owner.y };
            const pos = (id) => (id === 2 ? player : (id === o.npc ? owner : null));
            const { opcodes, errors } = compileScene(o.scene, { playerId: 2, pos });
            assert.deepEqual(errors, [], `${q.id}: ${errors.join(" | ")}`);
            assert.ok(opcodes.every((s) => !/NaN/.test(s)), `${q.id}: no opcode may carry a NaN:\n${opcodes.join("\n")}`);
        }
    }
    assert.equal(scenes, 3, "three walking scenes: one per owner");
});

/** Every string value in a quest definition, however deep (labels, paths, names). */
function stringsIn(v, out = []) {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const x of v) stringsIn(x, out);
    else if (v && typeof v === "object") for (const x of Object.values(v)) stringsIn(x, out);
    return out;
}

test("the words are plain game text, with no token braces and no partner speaker", () => {
    assert.ok(pass && charm && ticket, "all three jobs are in web/quests.json");
    const allowed = /^[A-Za-z0-9 .,'\-:"!?]*$/;
    for (const q of defs) {
        const words = wordsOf(q);
        assert.ok(words.length >= 20, `${q.id}: the quest has words to check`);
        for (const w of words) assert.match(w, allowed, `${q.id}: ${JSON.stringify(w)} uses only the game's own text characters`);
        for (const s of stringsIn(q)) assert.ok(!/[{}]/.test(s), `${q.id}: ${JSON.stringify(s)} carries no {token}`);
        for (const sc of [q.offer?.scene, q.doneScene, ...q.objectives.map((o) => o.scene)]) {
            for (const st of sc ?? []) assert.notEqual(st?.say, "partner", `${q.id}: no scene hands a line to the partner`);
        }
        assert.equal(q.unlock.flag, undefined, `${q.id} reads no story flag`);
        assert.equal(q.requires?.flag, undefined, `${q.id} requires no story flag`);
        assert.equal(q.flag, undefined, `${q.id} writes no story flag`);
    }
    const pack = readFileSync(ROOT + "data/authored/quests/pack_lf_lost_found.py", "utf8");
    assert.ok(!/\bflag\s*=/.test(pack), "the pack never calls flag=: this arc touches no story flag");
});

test("the whole arc lives in the quest data behind the F2 Quests switch, and nowhere else", () => {
    for (const f of readdirSync(ROOT + "web").filter((f) => /\.(js|html)$/.test(f))) {
        const src = readFileSync(ROOT + "web/" + f, "utf8");
        for (const id of IDS) assert.ok(!src.includes(id), `web/${f} must not special-case ${id}`);
    }
    assert.match(readFileSync(ROOT + "web/ambience.js", "utf8"), /\["quests", "Quests/,
        "F2 -> Extras -> Quests is still the switch that owns the layer");
    const questsSrc = readFileSync(ROOT + "web/quests.js", "utf8");
    assert.match(questsSrc, /const enabled = \(\) => !fx \|\| fx\.quests !== false;/,
        "the layer is off when the switch is off");
    assert.match(questsSrc, /questPropsOn\(mapId\) \{\s*\n\s*if \(!enabled\(\)/, "props follow the same switch");
});

test("the builder puts these three jobs in and changes no other quest", () => {
    const dir = mkdtempSync(join(tmpdir(), "lostfound-"));
    try {
        const build = (args, name) => {
            const out = join(dir, name);
            const r = spawnSync("python3", ["tools/build_quests.py", ...args, "--out", out],
                { cwd: ROOT, encoding: "utf8", timeout: 300000 });
            assert.equal(r.status, 0, `build ${name} failed:\n${r.stdout}\n${r.stderr}`);
            const reported = Number((r.stdout.match(/wrote .*: (\d+) quests/) ?? [])[1]);
            const text = readFileSync(out, "utf8");
            const list = JSON.parse(text).quests;
            assert.ok(Number.isInteger(reported), `the builder prints its total:\n${r.stdout}`);
            assert.equal(reported, list.length, "the printed total is the real one");
            return { text, list };
        };
        const draft = build(["--with-drafts"], "drafts.json");
        assert.equal(draft.text, readFileSync(ROOT + "web/quests.json", "utf8"),
            "web/quests.json is exactly what tools/build_quests.py --with-drafts writes");
        // The base this branch starts from: every quest it holds must come through unchanged, and only the three new
        // ids may be added. After a merge the base already holds them, so nothing is added and the deep-equal is the
        // whole check.
        const mb = spawnSync("git", ["merge-base", "integration/all", "HEAD"], { cwd: ROOT, encoding: "utf8" });
        const ref = mb.status === 0 && mb.stdout.trim() ? mb.stdout.trim() : "HEAD";
        const baseShow = spawnSync("git", ["show", `${ref}:web/quests.json`], { cwd: ROOT, encoding: "utf8" });
        assert.equal(baseShow.status, 0, `git show ${ref}:web/quests.json failed:\n${baseShow.stderr}`);
        const before = JSON.parse(baseShow.stdout).quests;
        const beforeById = new Map(before.map((x) => [x.id, x]));
        for (const x of before) {
            const now = draft.list.find((y) => y.id === x.id);
            assert.ok(now, `${x.id} disappeared from the build`);
            assert.deepEqual(now, x, `${x.id} changed`);
        }
        const added = draft.list.filter((x) => !beforeById.has(x.id)).map((x) => x.id);
        if (added.length) {
            assert.deepEqual(added.slice().sort(), IDS.slice().sort(), "exactly the three new jobs were added");
            assert.equal(draft.list.length, before.length + 3, "and nothing else came in with them");
        } else {
            for (const id of IDS) assert.ok(beforeById.has(id), `${id} was already in the merge base`);
        }
        // The shipped build holds the three as authored (they are in shipped.txt and wait on nothing unshipped).
        const plain = build([], "plain.json");
        assert.ok(plain.list.length < draft.list.length, "the shipped build leaves the other drafts out");
        for (const id of IDS) {
            const got = plain.list.filter((x) => x.id === id);
            assert.equal(got.length, 1, `${id} ships`);
            assert.deepEqual(got[0], byId.get(id), `${id} ships exactly as authored`);
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("tools/check_quests.py says OK", () => {
    const r = spawnSync("python3", ["tools/check_quests.py"], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
    assert.equal(r.status, 0, `check_quests failed:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /(^|\n)OK\n?$/, "the last line is OK");
});
