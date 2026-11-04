// Card 315 (data/authored/quests/pack_g_card315.py): the card past the last page.
//
//   node --test tests/quest-g-card315.test.js
//
// Covers: the quest ships (shipped.txt + web/quests.json), the Girl hands it out in Zhu Que City (s501) and its one
// objective is three card-duel wins, the hand-in scene shows the card's shard glow beside her and asks the one question
// the verdict answers, the verdict has exactly two endings with real pays from the game's own item table (giving the
// card back pays more than keeping it), the catalogue's own 315 is Calumon and 316 Impmon while the album module still
// addresses only 1..314, no card data / album / deck-rule file is in the diff, the words never claim a streak or that
// the album gained a card, every scene compiles with no errors, the builder's draft build is exactly the committed
// quests.json with the one new quest and every existing quest unchanged, and the quest checker says OK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileScene } from "../web/quest-scenes.js";

const ROOT = new URL("..", import.meta.url).pathname;
const load = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const quests = load("web/quests.json").quests;
const q = quests.find((x) => x.id === "g_card_315");
const itemNames = new Set(
    Object.values(load("web/assets/data/battlecmd/esitmnam.json"))
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .filter((v) => typeof v === "string"),
);

/** Every word the quest puts on screen, one blob, so the wording rules are checked in one place. */
function allWords(d) {
    const out = [d?.title, d?.text, d?.short];
    const o = d?.offer ?? {};
    out.push(...(o.lines ?? []), ...(o.remindLines ?? []), ...(o.doneLines ?? []));
    for (const sc of [d?.offer?.scene, d?.doneScene, ...(d?.objectives ?? []).map((x) => x.scene)]) {
        for (const step of sc ?? []) if (typeof step?.text === "string") out.push(step.text);
    }
    out.push(d?.verdict?.ask, ...(d?.verdict?.options ?? []), ...(d?.verdict?.after ?? []).flat());
    return out.filter((t) => typeof t === "string").join("\n");
}

/** The files this branch changes, committed or not, against the merge base with integration/all. */
function changedFiles() {
    const files = new Set();
    const base = spawnSync("git", ["merge-base", "integration/all", "HEAD"], { cwd: ROOT, encoding: "utf8" });
    const from = base.status === 0 ? base.stdout.trim() : "";
    if (from) {
        const d = spawnSync("git", ["diff", "--name-only", from], { cwd: ROOT, encoding: "utf8" });
        if (d.status === 0) for (const f of d.stdout.split("\n")) if (f.trim()) files.add(f.trim());
    }
    const st = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" });
    if (st.status === 0) {
        for (const line of st.stdout.split("\n")) {
            if (!line.trim()) continue;
            files.add(line.slice(3).replace(/^.* -> /, "").trim());
        }
    }
    return [...files];
}

test("the quest ships: shipped.txt names it, the pack is its source, and web/quests.json holds it", () => {
    const shipped = readFileSync(ROOT + "data/authored/quests/shipped.txt", "utf8")
        .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    assert.ok(shipped.includes("g_card_315"), "shipped.txt lists g_card_315");
    assert.match(readFileSync(ROOT + "data/authored/quests/pack_g_card315.py", "utf8"), /quest\("g_card_315"/,
        "the pack authors the quest");
    assert.ok(q, "web/quests.json holds g_card_315 (rebuild it with tools/build_quests.py --with-drafts)");
    assert.equal(q.giver, "Girl");
    assert.equal(q.title, "The Card Past the Last Page");
    assert.ok(q.short.length <= 14, `the pause list shows 14 characters, not ${q.short.length}`);
});

test("the Girl offers it in Zhu Que City and the one objective is three card-duel wins", () => {
    assert.ok(q, "g_card_315 is in web/quests.json");
    assert.equal(q.offer.npc, 46);
    assert.ok(q.offer.maps.includes("s501"), `offer maps are ${q.offer.maps}`);
    assert.equal(q.objectives.length, 1, "one objective: the duels");
    const o = q.objectives[0];
    assert.equal(o.type, "duelWin");
    assert.equal(o.count, 3, "three duels, the global counter the game already keeps");
});

test("the hand-in scene shows the card's shard glow beside her and asks the one question", () => {
    assert.ok(q?.doneScene?.length, "the hand-in has its own scene");
    const glow = q.doneScene.filter((s) => s && (s.sheet === "shard" || s.fx === "shard"));
    assert.equal(glow.length, 1, "one shard glow");
    assert.equal(glow[0].sheet, "shard", "the step names the sheet explicitly");
    assert.ok(glow[0].at && glow[0].at.near === 46, `the glow stands beside the Girl, not at ${JSON.stringify(glow[0].at)}`);
    const asks = q.doneScene.filter((s) => s && "ask" in s);
    assert.equal(asks.length, 1, "one question at the hand-in");
    assert.ok(asks[0].options.length >= 2, "and it has real answers");
    assert.deepEqual(asks[0].options, q.verdict?.options, "the scene's answer is the verdict's choice (quests.js reads r.answer)");
    assert.ok(q.doneScene.indexOf(glow[0]) < q.doneScene.indexOf(asks[0]), "the card glows before the question");
    const meta = load("web/extra_fx/shard.json");
    const clip = glow[0].clip ?? meta.default;
    assert.ok(meta.clips[clip], `sheet clip '${clip}' exists (${Object.keys(meta.clips).join(", ")})`);
});

test("the hand-in offers exactly two endings, each with a real pay", () => {
    assert.ok(q?.verdict, "the quest has a verdict");
    assert.equal(q.verdict.options.length, 2);
    assert.equal(q.verdict.pay.length, 2);
    assert.equal(q.verdict.after.length, 2);
    assert.match(q.verdict.options[0], /back/i, "one ending gives the card back");
    assert.match(q.verdict.options[1], /keep/i, "the other keeps it");
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
    assert.ok(itemsOf(0).includes("Booster 13a"), "giving it back pays a real booster");
    assert.ok(itemsOf(1).includes("Booster 12a"), "keeping it pays a different one");
    assert.ok((q.verdict.pay[0].bits ?? 0) > (q.verdict.pay[1].bits ?? 0), "keeping the card pays fewer bits");
});

test("card 315 is Calumon in the catalogue, and the album still addresses only 1..314", () => {
    const cards = load("web/assets/data/card_catalog.json");
    const list = Array.isArray(cards) ? cards : cards.cards;
    const card = (id) => list.find((c) => c.id === id);
    assert.equal(card(315)?.name, "Calumon", "the catalogue's own 315 is Calumon, the Start Phase's face-down card");
    assert.equal(card(316)?.name, "Impmon", "and 316 is Impmon");
    const engine = readFileSync(ROOT + "engine/systems/card-battle.ts", "utf8");
    assert.match(engine, /CALUMON_CARD_ID = 315/, "the duel rules still name 315 Calumon");
    assert.match(engine, /IMPMON_CARD_ID = 316/, "and 316 Impmon");
    const album = readFileSync(ROOT + "web/cardalbum-native.js", "utf8");
    assert.match(album, /314-card collection/, "the album still covers the 314-card collection");
    assert.match(album, /ids 1\.\.314/, "its grid still addresses 1..314");
    assert.ok(!album.includes("315"), "the album was not taught about card 315");
});

test("no card data, album or deck-rule file is in the branch diff", () => {
    const files = changedFiles();
    for (const f of files) {
        assert.ok(!/^web\/assets\/data\/card_/.test(f), `${f} is card data`);
        assert.ok(!/^web\/assets\//.test(f), `${f} is disc-derived game data`);
        assert.ok(f !== "web/cardalbum-native.js", "the album module is untouched");
        assert.ok(f !== "web/quest-editor.js" && f !== "web/quest-editor-lib.js" && f !== "web/quest-editor.html",
            `${f} is a quest-editor file`);
        assert.ok(f !== "engine/systems/card-battle.ts", "the duel rules are untouched");
    }
});

test("the words never claim a streak and never say the album gained a card", () => {
    assert.ok(q, "g_card_315 is in web/quests.json");
    const words = allWords(q);
    assert.ok(words.length > 100, "the quest has words to check");
    assert.ok(!/\bin a row\b/i.test(words), "the duel counter is global: the text must not promise a streak");
    assert.ok(!/album[^.]{0,60}\b(gained|added|adds|gets|got|holds|has|now shows|filled)\b/i.test(words),
        "the album does not gain anything");
    assert.match(words, /not in my album|never in my album|album ends at 314|album will never show/i,
        "the words say the card is not an album entry");
});

test("every scene in the quest compiles with no errors, and the glow is one host event", () => {
    assert.ok(q, "g_card_315 is in web/quests.json");
    const post = {};
    for (const n of load("web/assets/scenes/s501.json").npcs) {
        if ((n.x || n.y) && !post[n.npc_id]) post[n.npc_id] = { x: n.x, y: n.y };
    }
    assert.deepEqual(post[46], { x: 432, y: 249 }, "the Girl's real post in Zhu Que City");
    const player = { x: post[46].x + 48, y: post[46].y };
    const pos = (id) => (id === 2 ? player : (post[id] ?? null));
    const scenes = [q.offer?.scene, q.doneScene].filter(Boolean);
    assert.equal(scenes.length, 2, "an offer scene and the hand-in scene");
    const glows = [];
    for (const sc of scenes) {
        const { opcodes, errors, events } = compileScene(sc, { playerId: 2, pos });
        assert.deepEqual(errors, [], errors.join(" | "));
        assert.ok(opcodes.every((o) => !/NaN/.test(o)), `no opcode may carry a NaN:\n${opcodes.join("\n")}`);
        glows.push(...(events ?? []).filter((e) => e.kind === "fx" && e.sheet === "shard"));
    }
    assert.equal(glows.length, 1, "exactly one shard event across the quest");
    assert.ok(Math.abs(glows[0].x - 432) <= 24 && glows[0].y > 249 - 40 && glows[0].y < 249 + 16,
        `the glow resolves beside the Girl at (432,249), not at (${glows[0].x},${glows[0].y})`);
});

test("the builder ships the one new quest and changes no existing one", () => {
    const dir = mkdtempSync(join(tmpdir(), "card315-"));
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
        // The lab build: every quest and every draft. It is exactly the committed web/quests.json, so no existing quest
        // moved and the total is the live one the builder just printed.
        const draft = build(["--with-drafts"], "drafts.json");
        assert.equal(draft.text, readFileSync(ROOT + "web/quests.json", "utf8"),
            "web/quests.json is exactly what tools/build_quests.py --with-drafts writes");
        const byId = new Map(quests.map((x) => [x.id, x]));
        for (const now of draft.list) {
            const before = byId.get(now.id);
            if (before) assert.deepEqual(now, before, `${now.id} changed`);
        }
        // The ship build: only shipped.txt's ids (and the legacy quests). g_card_315 must be in it, exactly as authored
        // (it waits on nothing, so the draft filtering has nothing to strip from it).
        const plain = build([], "plain.json");
        assert.ok(plain.list.length < draft.list.length, "the shipped build leaves the drafts out");
        const shippedNew = plain.list.filter((x) => x.id === "g_card_315");
        assert.equal(shippedNew.length, 1, "g_card_315 ships");
        assert.deepEqual(shippedNew[0], byId.get("g_card_315"), "and ships exactly as authored");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("tools/check_quests.py says OK", () => {
    const r = spawnSync("python3", ["tools/check_quests.py"], { cwd: ROOT, encoding: "utf8", timeout: 180000 });
    assert.equal(r.status, 0, `check_quests failed:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /(^|\n)OK\n?$/, "the last line is OK");
});
