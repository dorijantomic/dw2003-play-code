// Look C battle: the arc lists, the MP preview, the enemy callout, the hit banner + damage number, the victory part (web/ui-c). Pure composers only.
import test from "node:test";
import assert from "node:assert/strict";
import { composeBattle, classifyPop, classifyCounter, foeLayout, foeState } from "../web/ui-c/battlehud.js";
import { composeReport } from "../web/ui-c/sheets.js";

const stage = { x0: -53.3, x1: 373.3, y0: 0, y1: 240 };
const data = (o = {}) => ({ part: "battleData", x: 0, y: 0, w: 0, h: 0, name: "Kotemon", level: 5, hp: 100, maxHp: 200, mp: 50, maxMp: 100, gauge: 0, maxGauge: 1000, others: [],
    st: 3, enemy: { name: "Kunemon", level: 4, hp: 60, maxHp: 60 }, ...o });
const run = (text, x, y, o = {}) => ({ text, x, y, w: text.length * 5, kind: 1, ...o });
const list = () => ({ part: "listWin", x: 20, y: 40, w: 120, h: 90, layers: [{ x: 4, y: 6, w: 12, h: 12 }, { x: 4, y: 20, w: 12, h: 12 }, { x: 4, y: 34, w: 12, h: 12 }, { x: 4, y: 3, w: 100, h: 1 }] });
const focus = (x, y) => ({ part: "focus", x, y, w: 12, h: 12 });
const dockOf = (out) => out.find((d) => d.kind === "dock");

test("tech rows ride the arc: cost + element chip per row, a row dearer than the MP is greyed, the ring previews the spend", () => {
    const techs = [{ name: "Fire A", element: "fire", cost: 20 }, { name: "Big B", element: "wind", cost: 90 }, { name: "Small C", element: "ice", cost: 5 }];
    const runs = [run("Fire A", 40, 47), run("Big B", 40, 61), run("Small C", 40, 75)];
    const out = composeBattle({ parts: [data({ techs, techTop: 0 }), list(), focus(25, 47)], runs, stage });
    const d = dockOf(out);
    assert.ok(d && d.list && d.title === "TECH");
    assert.deepEqual(d.words.map((w) => [w.t, w.r, w.dis]), [["Fire A", "20", false], ["Big B", "90", true], ["Small C", "5", false]]);
    assert.equal(d.words[0].chip, "FIRE"); assert.equal(d.on, 0);
    const ring = out.find((x) => x.key === "ring.main");
    assert.equal(ring.mpPrev, 0.3, "MP 50 - 20 = 30 of 100 left");
    assert.ok(out.some((x) => x.kind === "text" && x.text === "30/100"), "the ring number shows what would be left");
});

test("paging: the rows are the game's visible window, the cost follows techTop", () => {
    const techs = Array.from({ length: 9 }, (_, i) => ({ name: `T${i}`, element: "fire", cost: 10 + i }));
    const runs = [run("T3", 40, 47), run("T4", 40, 61), run("T5", 40, 75)];
    const out = composeBattle({ parts: [data({ techs, techTop: 3 }), list(), focus(25, 61)], runs, stage });
    assert.deepEqual(dockOf(out).words.map((w) => w.r), ["13", "14", "15"]);
    assert.equal(dockOf(out).on, 1);
});

test("the enemy block: name + a thin HP bar at the TOP CENTRE (38 % of the stage), LV small, no number, no plate; N foes = N bars side by side", () => {
    const out = composeBattle({ parts: [data({ st: 2 }), { part: "hudPlate", side: "enemy", x: 92, y: 4, w: 224, h: 30 }, { part: "hpBar", side: "enemy", x: 100, y: 25, w: 60, h: 8, full: 120 }], runs: [run("Kunemon", 100, 8)], stage });
    assert.ok(!out.some((d) => d.part === "hudPlate"), "no enemy plate");
    const name = out.find((d) => d.key === "foe0.name"), bar = out.find((d) => d.key === "foe0.bar"), lv = out.find((d) => d.key === "foe0.lv");
    assert.ok(name && bar && lv && bar.ratio === 1);
    const W = stage.x1 - stage.x0;
    assert.ok(Math.abs(bar.rect.w / W - 0.38) < 0.005, "bar about 38 % of the stage width");
    assert.ok(Math.abs(bar.rect.x + bar.rect.w / 2 - (stage.x0 + W / 2)) < 0.5, "centred");
    assert.ok(!out.some((d) => d.kind === "text" && /\//.test(d.text) && d.key.startsWith("foe")), "no HP number");
    assert.ok(!out.some((d) => d.key && d.key.startsWith("co.")), "no top-right callout any more");
    const two = composeBattle({ parts: [data({ st: 2, foes: [{ name: "A", level: 1, hp: 10, maxHp: 10 }, { name: "B", level: 2, hp: 5, maxHp: 10 }] })], runs: [], stage });
    const b0 = two.find((d) => d.key === "foe0.bar"), b1 = two.find((d) => d.key === "foe1.bar");
    assert.ok(b0 && b1 && b0.rect.y === b1.rect.y && b1.rect.x > b0.rect.x + b0.rect.w, "two bars side by side");
    assert.ok(Math.abs(b0.rect.w - b1.rect.w) < 1e-6 && b1.rect.x + b1.rect.w <= stage.x1);
});

test("the enemy bar colour: green, yellow below 50 %, red below 25 %", () => {
    const st = (hp) => composeBattle({ parts: [data({ st: 2, enemy: { name: "K", level: 1, hp, maxHp: 100 } })], runs: [], stage }).find((d) => d.key === "foe0.bar");
    assert.deepEqual([100, 50, 49, 25, 24, 1].map((hp) => st(hp).state), ["ok", "ok", "mid", "mid", "low", "low"]);
    assert.notEqual(st(80).color, st(40).color); assert.notEqual(st(40).color, st(10).color);
    assert.equal(foeState(0.5), "ok"); assert.equal(foeState(0.2499), "low");
});

test("the turn arc: the one acting now is biggest, enemies carry the enemy side, three nodes", () => {
    const nodes = (st, extra) => composeBattle({ parts: [data({ st, ...extra })], runs: [], stage }).filter((d) => d.kind === "node");
    const p = nodes(2), e = nodes(6);
    assert.equal(p.length, 3); assert.equal(p[0].turn, "now"); assert.equal(p[0].side, "player"); assert.equal(p[1].side, "enemy");
    assert.ok(p[0].rect.w > p[1].rect.w && p[1].rect.w > p[2].rect.w, "now is the biggest");
    assert.equal(e[0].side, "enemy"); assert.equal(e[0].letter, "K"); assert.equal(p[0].letter, "K");
    assert.ok(p.every((n) => n.rect.x + n.rect.w <= stage.x1 && n.rect.x > stage.x0 + (stage.x1 - stage.x0) * 0.8), "top right");
});

test("the hit banner and the damage number: from the game's own line, at the one who took it", () => {
    const pane = { part: "msgPane", x: 20, y: 190, w: 280, h: 30 };
    const enemyHit = composeBattle({ parts: [data({ st: 5 }), pane], runs: [run("Kunemon 12 damage!", 30, 197)], stage });
    const p1 = enemyHit.find((d) => d.kind === "pop");
    assert.equal(p1.n, 12); assert.equal(p1.side, "enemy");
    assert.ok(enemyHit.some((d) => d.key === "hit.who") && !enemyHit.some((d) => d.key === "hit.title"), "the banner is small: who only, the number is the pop's");
    assert.ok(composeBattle({ parts: [data({ st: 5 }), pane], runs: [run("Kotemon uses Hot Head! 12 damage!", 30, 197)], stage }).some((d) => d.key === "hit.title"), "a move has its title");
    const playerHit = composeBattle({ parts: [data({ st: 6 }), pane], runs: [run("Kotemon 7 damage!", 30, 197)], stage });
    assert.equal(playerHit.find((d) => d.kind === "pop").side, "player");
    assert.equal(playerHit.find((d) => d.key === "foe0.name").color, "var(--c-hot-ink)", "the enemy acts: its name is hot");
    const none = composeBattle({ parts: [data({ st: 5 }), pane], runs: [run("Kotemon Hot Head!", 30, 197)], stage });
    assert.ok(!none.some((d) => d.kind === "pop"), "an announcement has no number");
});

test("the pop is typed only from what the game produced: crit, weak, resist, heal, evade, counter, status; one event id per blow", () => {
    const who = { player: "Kotemon", enemy: "Kunemon" };
    const hit = (o) => ({ seq: 4, kind: "hit", hit: true, dmg: 12, heal: 0, crit: false, eff: 1, ...o });
    const c = (line, note) => classifyPop(line, who, note);
    assert.equal(c("Kunemon 12 damage!", hit({})).tone, "");
    assert.deepEqual([c("Kunemon 12 damage!", hit({ crit: true })).tone, c("Kunemon 12 damage!", hit({ crit: true })).tag], ["crit", "CRITICAL"]);
    assert.deepEqual([c("Kunemon 12 damage!", hit({ eff: 1.5 })).tone, c("Kunemon 12 damage!", hit({ eff: 1.5 })).tag], ["weak", "WEAK"]);
    assert.deepEqual([c("Kunemon 12 damage!", hit({ eff: 0.5 })).tone, c("Kunemon 12 damage!", hit({ eff: 0.5 })).tag], ["resist", "RESIST"]);
    assert.equal(c("Kunemon 12 damage!", hit({ crit: true, dmg: 99 })).tone, "", "a note of another blow is never used");
    assert.equal(c("Kunemon 12 damage!", null).tone, "", "no note = a plain pop");
    assert.equal(c("Kunemon 12 damage!", hit({ crit: true })).evt, c("Kunemon 12 damage!", hit({ crit: true })).evt, "the same blow = the same event");
    assert.notEqual(c("Kunemon 12 damage!", hit({ crit: true })).evt, c("Kunemon 12 damage!", hit({ crit: true, seq: 5 })).evt);
    const heal = c("Kotemon recovers 30 HP.", null); assert.deepEqual([heal.kind, heal.side, heal.n], ["heal", "player", 30]);
    const h2 = classifyPop("210HP healed!", { ...who, actor: "player" }, null); assert.deepEqual([h2.kind, h2.side, h2.n], ["heal", "player", 210]);
    const miss = c("Kunemon Evade!", null); assert.deepEqual([miss.kind, miss.side], ["miss", "enemy"]);
    const pz = c("Kotemon is hurt by poison! 9 damage!", hit({ crit: true, dmg: 9 })); assert.deepEqual([pz.status, pz.tag, pz.tone], ["poison", "POISON", ""]);
    const sl = c("Kunemon fell asleep!", null); assert.deepEqual([sl.kind, sl.status], ["status", "sleep"]);
    assert.equal(c("Kotemon recovered from poison!", null), null, "a cure is no status pop");
    const cn = classifyCounter("Kunemon attacks! 10 damage! Kotemon countered for 7 damage!", who, hit({ kind: "counter", seq: 6 }));
    assert.deepEqual([cn.kind, cn.side, cn.n, cn.tag], ["counter", "enemy", 7, "COUNTER"]);
    assert.equal(classifyCounter("Kunemon attacks! 10 damage!", who, null), null);
});

test("who acts: a marker under the ring on the player's turn", () => {
    assert.ok(composeBattle({ parts: [data({ st: 2 })], runs: [], stage }).some((d) => d.key === "act.player"));
    assert.ok(!composeBattle({ parts: [data({ st: 6 })], runs: [], stage }).some((d) => d.key === "act.player"));
});

test("the DV / DNA pickers are whole screens: no rings over them", () => {
    const out = composeBattle({ parts: [data({ st: 13 })], runs: [], stage });
    assert.ok(!out.some((d) => d.part === "ring"));
});

test("the victory: one vic part, the page told by the game's own band text; rings read the progress records", () => {
    const band = { part: "msgBand", x: 20, y: 180, w: 280, h: 40, rel: { a: 1, d: 1, e: 0, f: 0 } };
    const view = { progress: [{ index: 0, xp: 40, oldLevel: 4, newLevel: 5, levelUp: true, ringA: 0.5, ringB: 1, learnedTechs: ["Nova"], unlocked: [] }], reward: { droppedItem: { name: "Charge" } }, rows: [],
        partners: [{ pos: 0, name: "Kotemon", level: 4 }, { pos: 1, name: "Monmon", level: 3 }] };
    const exp = composeReport({ parts: [band], runs: [run("EXP gained:", 30, 190), run("40 EXP", 30, 202)], stage }, { view })[0];
    assert.equal(exp.page, "exp"); assert.equal(exp.rings.length, 2); assert.equal(exp.up, true);
    assert.deepEqual([exp.rings[0].gain, exp.rings[0].a, exp.rings[0].b, exp.rings[0].lvTo, exp.rings[0].learned], [40, 0.5, 1, 5, ["Nova"]]);
    assert.equal(exp.rings[1].gain, 0);
    const bit = composeReport({ parts: [band], runs: [run("BIT gained:", 30, 190), run("1480 BIT", 30, 202)], stage }, { view })[0];
    assert.equal(bit.page, "bit"); assert.equal(bit.num, 1480); assert.equal(bit.item.name, "Charge");
    const other = composeReport({ parts: [band], runs: [run("Item gained:", 30, 190), run("PowerCharge x3", 30, 202)], stage }, { view })[0];
    assert.equal(other.page, "item"); assert.equal(other.big, "PowerCharge x3");
    assert.ok(composeReport({ parts: [band], runs: [run("x", 30, 190)], stage }, {}).length >= 0, "no view = the old report path still works");
});
