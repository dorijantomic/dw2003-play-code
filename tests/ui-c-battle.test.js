// Look C kit T8 (web/ui-c/battlehud.js): the battle HUD and the battle menus (C8) -- the enemy's HP plate with its name slab, HP numbers and
// bar (the player's plate, party markers and DV gauge are the rings: tests/ui-c-ring.test.js), the close-up bezel that leaves the 3D face open, the command / form / Tag rows with the
// focus taken from the game's own marker copy, the technique / item windows, the message band; the capture hooks the battle uses (plain
// drawText runs, painted parts) and the owners' wiring. Pure: synthetic draw parts and runs in, descriptors out. No browser, no game data.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { composeBattle, BATTLE, joinNumbers } from "../web/ui-c/battlehud.js";
import { ID, N, HUD, ringFrame } from "../web/ui-c/base.js";
import { claimFor } from "../web/ui-c/claims.js";
import { plateShape } from "../web/ui-c/parts.js";
import * as cap from "../web/ui-c/capture.js";

const run = (text, x, y, o = {}) => ({ text, x, y, kind: 1, clut: 0, face: null, right: null, w: text.length * 6, ...o });
const num = (text, right, y) => run(text, right - text.length * 5, y, { kind: 3, right, w: text.length * 5 });
const part = (name, x, y, w, h, o = {}) => ({ part: name, x, y, bx: 0, by: 0, w, h, rel: ID, ...o });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const byPart = (out, p) => out.filter((d) => d.part === p);
const byKey = (out, k) => out.find((d) => d.key === k);
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
// the command row clip 34 at (16, 109 + 19 i): its pixels sit 3 above the draw position, 100 x 19
const cmd = (i) => part("cmdRow", 16, 109 + 19 * i, 100, 19, { by: -3, base: 34 });
const focus = (x, y) => part("focus", x, y, 12, 12);

// ------------------------------------------------------------------------------------------------ claims
test("claims: the battle chrome pack (pgfgc00) -- plates by side, bezel, gauge, markers, rows, windows; page arrows and stat icons are art", () => {
    assert.deepEqual([claimFor("pgfgc00", 0).part, claimFor("pgfgc00", 0).side], ["hudPlate", "enemy"]);
    assert.deepEqual([claimFor("pgfgc00", 1).part, claimFor("pgfgc00", 1).side], ["hudPlate", "player"]);
    assert.equal(claimFor("pgfgc00", 10).part, "bezel");
    assert.equal(claimFor("pgfgc00", 30).part, "dvFrame");
    assert.equal(claimFor("pgfgc00", 11).part, "dvInner");
    for (let id = 51; id <= 58; id++) assert.equal(claimFor("pgfgc00", id).part, "dvFill");
    for (const id of [12, 13, 14, 15, 60, 61, 62, 63]) assert.equal(claimFor("pgfgc00", id).part, "pip");
    for (const id of [34, 36]) assert.deepEqual([claimFor("pgfgc00", id).part, claimFor("pgfgc00", id).layers], ["cmdRow", true]);
    assert.equal(claimFor("pgfgc00", "34#3").part, "cmdRow", "a palette row of the command clip is the same row");
    for (const id of [42, 39]) assert.deepEqual([claimFor("pgfgc00", id).part, claimFor("pgfgc00", id).layers], ["listWin", true]);
    assert.equal(claimFor("pgfgc00", 47).part, "tagRow");
    assert.equal(claimFor("pgfgc00", 41).part, "mpPlate");
    assert.equal(claimFor("pgfgc00", 49).part, "msgPane");
    for (const id of [31, 32]) assert.equal(claimFor("pgfgc00", id).part, "art");
    assert.equal(claimFor("cmfont", 35).part, "art", "the battle stat icon column is a picture, never a flat plate");
});

// ------------------------------------------------------------------------------------------------ HP plates
const plates = () => [part("hudPlate", 8, 15, 149, 44, { side: "enemy" }), part("hudPlate", 161, 15, 150, 44, { side: "player" })];

test("plates: the enemy keeps the game's clip rect, C8 cyan edge + navy body + shadow 6, name slab 7 in, 5 down, 13 tall; the player's plate is the ring", () => {
    const out = composeBattle({ parts: plates(), runs: [] });
    const hp = byPart(out, "hudPlate");
    assert.equal(hp.length, 1, "no player plate");
    const e = hp[0];
    assert.deepEqual(e.rect, { x: 8, y: 15, w: 149, h: 44 });
    assert.deepEqual([e.shape, e.edge, e.body, e.shadow], ["ch", HUD.edge, HUD.body, 6]);
    const slabs = byPart(out, "nameSlab");
    assert.equal(slabs.length, 1);
    assert.deepEqual(slabs[0].rect, { x: 15, y: 20, w: 132, h: 13 });
    assert.equal(slabs[0].shape, "srs");
});

test("plates: the enemy name is the game's run on the slab (Russo 26 / 39), the enemy HP three runs one amber number; the player's own name and HP runs are taken, not written twice", () => {
    const runs = [run("Kunemon", 17, 21), run("Kotemon", 174, 21), num("86", 267, 26), run("/", 268, 26, { kind: 3 }), num("90", 302, 26), num("5", 143, 26)];
    const out = composeBattle({ parts: plates(), runs });
    const e = byKey(out, "hud.enemy.name");
    assert.equal(e.text, "Kunemon");
    near(e.rect.x, 15 + BATTLE.nameIn); assert.equal(e.sizeDp, 26);
    assert.equal(byKey(out, "hud.player.name"), undefined);
    assert.equal(byKey(out, "hud.player.hp"), undefined);
    const hp = byKey(out, "hud.enemy.hp");
    assert.equal(hp.text, "5");
    assert.deepEqual([hp.role, hp.align, hp.color, hp.sizeDp], ["number", "right", "var(--c-num)", 28]);
    assert.ok(!out.some((d) => d.kind === "text" && ["Kotemon", "86", "90"].includes(d.text)), "the player's runs are not in the output");
});

test("hp bar: the enemy's track is the C8 slot on the plate, the fill is the game's length over its full length, the enemy keeps its right end; the player's bar is the ring's arc", () => {
    const parts = [...plates(),
        part("hpBar", 143 - 64, 37, 64, 6, { side: "enemy", full: 128, colors: ["#f00", "#0f0"] }),
        part("hpBar", 175, 37, 128, 6, { side: "player", full: 128, colors: ["#00f", "#0ff"] })];
    const out = composeBattle({ parts, runs: [] });
    const bars = byPart(out, "hpBar");
    assert.equal(bars.length, 1);
    const e = bars[0];
    assert.deepEqual(e.rect, { x: 15, y: 36, w: 132, h: 8 });
    near(e.ratio, 0.5);
    assert.equal(e.dir, "rtl");
    assert.equal(e.color, "linear-gradient(90deg, #f00, #0f0)");
    assert.equal(e.kind, "bar"); assert.equal(e.slant, 12);
    const z = composeBattle({ parts: [...plates(), part("hpBar", 143, 37, 0, 6, { side: "enemy", full: 128, colors: ["#f00", "#f00"] })], runs: [] });
    near(byPart(z, "hpBar")[0].ratio, 0, 1e-9);
});

test("party markers: the enemy's marker is the cel's state colour on the plate; the player's three are the small rings, not pips", () => {
    const out = composeBattle({ parts: [part("pip", 37, 48, 12, 9, { base: 12 }), part("pip", 37, 48, 12, 9, { base: 14 }), part("pip", 270, 49, 12, 7, { base: 60 }), part("pip", 282, 48, 12, 9, { base: 14 }), part("pip", 294, 49, 12, 7, { base: 61 })], runs: [] });
    const pips = byPart(out, "pip");
    assert.equal(pips.length, 2, "only the enemy's pip (x 37)");
    assert.deepEqual(pips.map((p) => p.edge), [HUD.edge, "var(--c-pip-down)"]);
    for (const p of pips) { assert.equal(p.rect.h, 8); assert.equal(p.layer, "over"); }
    near(pips[0].rect.y + 4, 48 + 4.5);
});

test("dv gauge: the player's frame, inner frame and fill produce no flat parts (the ring's DV arc is the gauge)", () => {
    const parts = [part("dvFrame", 260, 61, 52, 10), part("dvFill", 265, 62, 40, 8, { base: 52, drawW: 20 }), part("dvInner", 265, 62, 40, 8)];
    const out = composeBattle({ parts, runs: [] });
    assert.equal(out.length, 0);
});

test("bezel: two even-odd rings around the close-up window; the window itself is never covered", () => {
    const out = composeBattle({ parts: [part("bezel", 246, 74, 104, 64, { bx: -40 })], runs: [] }, { view: { x: 208, y: 76, w: 100, h: 60 } });
    const [body, edge] = [byPart(out, "ringBody")[0], byPart(out, "ringEdge")[0]];
    assert.deepEqual(body.rect, { x: 206, y: 74, w: 104, h: 64 });
    assert.equal(body.rule, "evenodd"); assert.equal(edge.rule, "evenodd");
    assert.equal(body.d.split("M").length - 1, 2, "inner outline + window");
    // the window's top-left corner point lies on the window chamfer: hx + hy + hc >= 2e + ci (inside the body's inner chamfer)
    const pts = body.d.split("M")[2].replace("Z", "").split("L").map((s) => s.trim().split(" ").map(Number));
    assert.ok(pts[0][0] + pts[0][1] >= 2 * N(4) + N(22), `${pts[0]}`);
    assert.ok(Math.max(...pts.map((p) => p[0])) <= 102 && Math.max(...pts.map((p) => p[1])) <= 62, "the window is the view rect");
    const o = []; ringFrame("r", { x: 0, y: 0, w: 50, h: 40 }, { x: 10, y: 10, w: 30, h: 20 }, ID, o);
    assert.match(o[0].d, /^M\S+ \S+L/, "plain window: no chamfer needed, still a closed polygon");
});

// ------------------------------------------------------------------------------------------------ command rows
test("commands: six rows on the game's 19 px pitch, 17 tall (C8 51 dp); the focused row is the one the marker copy lands in", () => {
    const runs = ["Fight", "Tech", "DV", "Tag", "Item", "Run"].map((t, i) => run(t, 36, 109 + 19 * i));
    const out = composeBattle({ parts: [...[0, 1, 2, 3, 4, 5].map(cmd), focus(17, 129)], runs });
    const rows = byPart(out, "cmdRow");
    assert.equal(rows.length, 6);
    rows.forEach((r, i) => { near(r.rect.y, 106 + 19 * i); near(r.rect.h, N(51)); });
    assert.deepEqual(rows.map((r) => r.shape), ["rowSr", "rowSrSolid", "rowSr", "rowSr", "rowSr", "rowSr"]);
    near(rows[0].rect.x, 32); near(rows[1].rect.x, 40); near(rows[0].rect.w, 82);
    assert.equal(rows[1].edge, "var(--c-orange)");
    const keys = byPart(out, "keyBox");
    assert.deepEqual(keys.map((k) => k.edge), [HUD.edge, "var(--c-orange)", HUD.edge, HUD.edge, HUD.edge, HUD.edge]);
    near(keys[0].rect.x, 16); near(keys[0].rect.w, N(40));
    assert.equal(byPart(out, "rowChevron").length, 1);
    near(byPart(out, "rowChevron")[0].rect.y, 125 + N(16));
    assert.equal(byPart(out, "keyDot").length, 1);
    const labels = out.filter((d) => d.kind === "text");
    assert.deepEqual(labels.map((l) => l.text), ["Fight", "Tech", "DV", "Tag", "Item", "Run"]);
    near(labels[0].rect.x, 40); near(labels[1].rect.x, 40 + N(50));
    assert.equal(labels[1].color, "var(--c-orange-ink)"); assert.equal(labels[0].color, null);
    assert.equal(labels[0].sizeDp, 28);
    assert.equal(byPart(out, "selection").length, 0, "the marker found its row");
});

test("commands with the ring: the six rows become the dock (one part, words in row order, the marker row focused); tests/ui-c-dock.test.js has the slot maths", () => {
    const runs = ["Fight", "Tech", "DV", "Tag", "Item", "Run"].map((t, i) => run(t, 36, 109 + 19 * i));
    const data = { part: "battleData", x: 0, y: 0, w: 0, h: 0, rel: ID, name: "K", level: 1, hp: 1, maxHp: 2, mp: 1, maxMp: 2, gauge: 0, maxGauge: 1000, others: [] };
    const out = composeBattle({ parts: [...[0, 1, 2, 3, 4, 5].map(cmd), focus(17, 129), data], runs });
    const dock = byPart(out, "dock");
    assert.equal(dock.length, 1); assert.equal(dock[0].on, 1);
    assert.deepEqual(dock[0].words.map((w) => w.t), ["Fight", "Tech", "DV", "Tag", "Item", "Run"]);
    assert.equal(byPart(out, "cmdRow").length, 0);
});

test("commands: no marker = no focused row; a marker with no row = focus corners (focus is never lost)", () => {
    const out = composeBattle({ parts: [cmd(0), cmd(1)], runs: [] });
    assert.ok(byPart(out, "cmdRow").every((r) => r.shape === "rowSr"));
    const lost = composeBattle({ parts: [cmd(0), focus(250, 200)], runs: [] });
    assert.equal(byPart(lost, "selection").length, 1);
});

test("form rows (clip 36, 144 wide): same row, the greyed current form keeps the game's face colour", () => {
    const parts = [part("cmdRow", 167, 146, 144, 19, { by: -3, base: 36 }), part("cmdRow", 167, 165, 144, 19, { by: -3, base: 36 }), focus(168, 166)];
    const out = composeBattle({ parts, runs: [run("Agumon", 187, 146, { face: "rgb(90,90,90)" }), run("Greymon", 187, 165)] });
    const rows = byPart(out, "cmdRow");
    near(rows[0].rect.w, 126);
    assert.deepEqual(rows.map((r) => r.shape), ["rowSr", "rowSrSolid"]);
    const t = out.filter((d) => d.kind === "text");
    assert.equal(t[0].color, "rgb(90,90,90)"); assert.equal(t[1].color, "var(--c-orange-ink)");
});

// ------------------------------------------------------------------------------------------------ lists, plates, message
test("tech window: one row per 12 x 12 selector box, as wide as the row line; the marker's row is orange; L1 / R1 are chips", () => {
    const layers = [{ x: 0, y: 0, w: 154, h: 113 }, ...[0, 1, 2].map((i) => ({ x: 6, y: 7 + 14 * i, w: 12, h: 12 })), ...[0, 1, 2].map((i) => ({ x: 6, y: 19 + 14 * i, w: 132, h: 1 }))];
    const parts = [part("listWin", 8, 62, 154, 113, { layers }), focus(14, 83)];
    const runs = [run("Hot Head", 42, 69), run("Blaze", 42, 83), num("20", 150, 83), run("L1", 26, 159, { kind: 3, clut: 2, w: 10 }), run("R1", 128, 159, { kind: 3, clut: 2, w: 10 })];
    const out = composeBattle({ parts, runs });
    assert.deepEqual(byPart(out, "listWindow")[0].rect, { x: 8, y: 62, w: 154, h: 113 });
    const rows = byPart(out, "listRow");
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.shape), ["row", "rowSolid", "row"]);
    near(rows[0].rect.x, 28); near(rows[0].rect.x + rows[0].rect.w, 146); near(rows[1].rect.y, 82);
    const t = Object.fromEntries(out.filter((d) => d.kind === "text").map((d) => [d.text, d]));
    near(t["Hot Head"].rect.x, 42);
    assert.equal(t.Blaze.color, "var(--c-orange-ink)");
    assert.equal(t["20"].color, "var(--c-orange-ink)");
    assert.equal(byPart(out, "pageChip").length, 2);
});

test("mp plate: the plate is the sheet pieces below y 18; MP stays a label, value / slash / maximum are one number", () => {
    const layers = [{ x: 0, y: 0, w: 8, h: 39 }, { x: 8, y: 18, w: 88, h: 21 }];
    const out = composeBattle({ parts: [part("mpPlate", 163, 33, 96, 39, { layers })], runs: [run("MP", 172, 58, { kind: 3 }), num("38", 216, 58), run("/", 217, 58, { kind: 3 }), num("38", 251, 58)] });
    assert.deepEqual(byPart(out, "mpPlate")[0].rect, { x: 171, y: 51, w: 88, h: 21 });
    const t = out.filter((d) => d.kind === "text");
    assert.deepEqual(t.map((d) => [d.text, d.role]), [["MP", "label"], ["38/38", "number"]]);
    near(t[1].rect.x + t[1].rect.w, 251);
    assert.deepEqual(joinNumbers([num("9", 20, 5), run("/", 21, 5, { kind: 3 }), num("10", 40, 5), num("7", 60, 5)]).map((m) => m.text), ["9/10", "7"]);
});

test("message pane: the C9 band with the game's lines in the band face; the more marker is left to the shared pass", () => {
    const out = composeBattle({ parts: [part("msgPane", 11, 188, 296, 38)], runs: [run("Kunemon used Bug!", 20, 194), run("It hit!", 20, 205)] });
    assert.equal(byPart(out, "msgBand").length, 1);
    assert.deepEqual(byPart(out, "msgBand")[0].rect, { x: 11, y: 188, w: 296, h: 38 });
    const t = out.filter((d) => d.kind === "text");
    assert.deepEqual(t.map((d) => [d.text, d.role, d.sizeDp]), [["Kunemon used Bug!", "body", 32], ["It hit!", "body", 32]]);
});

test("tag rows and the notice: key box, name plate, HP / MP box; the notice is a plate with its line", () => {
    const parts = [part("tagRow", 16, 77, 186, 31, { by: -3 }), part("tagRow", 16, 109, 186, 31, { by: -3 }), focus(17, 78), part("notice", 118, 194, 186, 25)];
    const runs = [run("Kotemon", 36, 77), run("HP", 108, 78, { kind: 3 }), num("86", 152, 78), run("Agumon", 36, 109), run("No reserve", 125, 201)];
    const out = composeBattle({ parts, runs });
    assert.deepEqual(byPart(out, "tagRow").map((r) => r.shape), ["rowSrSolid", "rowSr"]);
    assert.deepEqual(byPart(out, "tagStats")[0].rect, { x: 102, y: 74, w: 100, h: 31 });
    assert.equal(byPart(out, "notice").length, 1);
    const t = Object.fromEntries(out.filter((d) => d.kind === "text").map((d) => [d.text, d]));
    assert.equal(t.Kotemon.color, "var(--c-orange-ink)");
    assert.equal(t["No reserve"].role, "body");
});

// ------------------------------------------------------------------------------------------------ shapes + capture hooks
test("shapes: rowSr slants its right end 20 dp, srs 24 dp; both solid variants have no body", () => {
    const a = plateShape("rowSr", 246, 51, 1, 4, 3);
    assert.match(a.outer, /226px 51px/); assert.equal(a.box.b, 3);
    assert.equal(plateShape("rowSrSolid", 246, 51, 1, 4, 3).inner, null);
    assert.match(plateShape("srs", 396, 39, 1, 4, 3).outer, /372px 39px/);
});

test("capture: a texts scope takes drawText runs and painted parts with the matrix relative to the scope start; others do not", () => {
    let m = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 };
    const ctx = { getTransform: () => m }, other = { getTransform: () => m };
    assert.equal(cap.capturingText(ctx), false);
    cap.begin("k", ctx, { a: 2, d: 2, e: 10, f: 20 }, () => null, { texts: true });
    assert.equal(cap.capturingText(ctx), true);
    assert.equal(cap.capturingText(other), false);
    assert.equal(cap.textRunHook(ctx, { text: "86", x: 1, y: 2 }), true);
    m = { a: 2, b: 0, c: 0, d: 2, e: 14, f: 20 };
    assert.equal(cap.partHook(ctx, { part: "hpBar", x: 1, y: 2, w: 3, h: 4 }), true);
    assert.equal(cap.partHook(other, { part: "hpBar" }), false);
    const s = cap.end();
    assert.equal(s.runs.length, 1);
    assert.deepEqual(s.parts[0].rel, { a: 1, d: 1, e: 2, f: 0 });
    assert.equal(s.parts[0].layer, "under");
    cap.begin("k2", ctx, { a: 2, d: 2, e: 10, f: 20 }, () => null);
    assert.equal(cap.capturingText(ctx), false, "a scope without opts.texts leaves drawText alone");
    cap.end();
});

// ------------------------------------------------------------------------------------------------ owners' wiring
test("wiring: one top scope round the battle chrome; bar / notice / focus handed over as parts; marker copies and trough skipped in capture", () => {
    const b = read("web/battle.js");
    assert.match(b, /uiC\.scope\("ui-battle", ctx, \{[\s\S]{0,200}texts: true, top: true/);
    assert.match(b, /compose: \(sc\) => composeBattle\(sc, \{ view: BATTLE_UI_LAYOUT\.portraitView, stage: sc\.stage \}\)/);
    assert.match(b, /if \(uiC\.capturing\(\)\) \{[\s\S]{0,900}uiCPart\(ctx, \{ part: "battleData"/);
    assert.match(b, /uiCPart\(ctx, \{ part: "hpBar"/);
    assert.match(b, /uiCPart\(ctx, \{ part: "notice", x: 118, y: 194, w: 186, h: 25 \}\)/);
    assert.equal((b.match(/uiC\.hide\("ui-battle"\)/g) ?? []).length, 3, "report, results screen, hosted ending");
    const a = read("web/battle-menu-adapter.js");
    assert.match(a, /if \(uiCCapturing\(\)\) \{\s*for \(const m of target\.moves \?\? \[\]\) if \(m\.dstY < 0x100\) uiCPart\(ctx, \{ part: "focus"/);
    assert.match(a, /\} else paintStripMoves\(ctx, r, target\.moves\);/);
    assert.match(read("web/battlehud-translated.js"), /if \(frame\.backing && !uiCCapturing\(\)\)/);
    const g = read("web/game.js");
    assert.match(g, /uiC\.cover\(skipField\)/);
    assert.match(g, /if \(battle\.isActive\(\)\) battle\.draw\(\);\s*\n\s*uiC\.cover\(false\);/);
    assert.match(read("web/uifont.js"), /if \(fontReady\(\) && capturingText\(ctx\)\)/);
    assert.match(read("web/screenpack.js"), /export function drawClipWidth.*\n\s*if \(clipHook\(ctx, p, id, x, y, .*, width\)\) return true;/);
});
