// Look C kit: the registration wizard (web/ui-c/fullpages.js composeWizard / composeNet, claims stnmet + cmnbgd). The wizard is ONE
// session in ONE scope ("ui-pack"): message window -> name keyboard -> starter pack list (step 2) -> confirm (step 3). Pure: synthetic
// draw parts and text runs in, part descriptors out.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composeWizard, composeNet } from "../web/ui-c/fullpages.js";
import { ID, FAMILY_C } from "../web/ui-c/base.js";
import { claimFor } from "../web/ui-c/claims.js";

const run = (text, x, y, o = {}) => ({ text, x, y, kind: 1, face: null, w: text.length * 7, ...o });
const part = (name, x, y, w, h, o = {}) => ({ part: name, x, y, bx: 0, by: 0, w, h, rel: ID, row: 0, ...o });
const keys = (out) => out.map((d) => d.key);
const STEP_LAYERS = [{ x: 0, y: 0, w: 16, h: 22 }, { x: 16, y: 0, w: 40, h: 21 }, { x: 176, y: -7, w: 96, h: 28 }];
const steps = (id) => part("wizSteps", 24, 21, 272, 29, { id: String(id), base: id, layers: STEP_LAYERS });
const digits = [run("1", 228, 18), run("2", 256, 18), run("3", 284, 18)];
const src = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");

test("claims: the hex backdrop is the C stripes, the base fill and streams are a part nobody composes, the pages' clips are claimed", () => {
    for (const id of [0, 1, 2]) assert.equal(claimFor("cmnbgd", id).part, "backdrop");
    for (const id of [24, 33, 35, 60, 69, 75]) assert.equal(claimFor("stnmet", id).part, "wizBase");
    assert.deepEqual([12, 13, 14].map((id) => claimFor("stnmet", id).part), ["wizSteps", "wizSteps", "wizSteps"]);
    assert.ok(claimFor("stnmet", 12).layers, "the step clip hands over its sheet pieces");
    assert.equal(claimFor("stnmet", 7).part, "packWin");
    assert.equal(claimFor("stnmet", 50).part, "packSel");
    assert.equal(claimFor("stnmet", 1).part, "netWin", "the Register box is inside the wire band clip");
    assert.equal(claimFor("stnmet", 9).part, "cfPack");
    assert.equal(claimFor("stnmet", 2).part, "cfName");
    assert.equal(claimFor("stnmet", 6).part, "cfPortrait");
});

test("the wizard owner composes with composeWizard (the name keyboard shares its scope)", () => {
    assert.match(src("packselect-translated.js"), /ui: \{ key: "ui-pack", compose: composeWizard \}/);
});

test("message page: the page text and the blinking wait glyph are two parts (the glyph used to replace the text: same key)", () => {
    const win = part("netWin", 56, 47, 320, 58, { layers: [{ x: -56, y: 3, w: 56, h: 58 }, { x: 0, y: 3, w: 16, h: 58 }, { x: 16, y: 3, w: 192, h: 58 }] });
    const out = composeNet({ parts: [win], runs: [run("Welcome to Digimon Online.", 66, 59), run("_", 215, 59)] });
    assert.equal(out.filter((d) => d.kind === "text").length, 1);
    assert.equal(out.find((d) => d.kind === "text").text, "Welcome to Digimon Online.");
    assert.equal(out.filter((d) => d.part === "more").length, 1, "the glyph is the C more arrow");
    assert.equal(new Set(keys(out)).size, out.length, "every part has its own key");
});

test("name keyboard inside the wizard: the stripes, the step chips (step 1 in focus), the keyboard window; digits are chips, not title text", () => {
    const parts = [
        part("backdrop", 0, 0, 320, 240), steps(12),
        part("nameHdr", 24, 21, 272, 29, { bx: 0, by: 0 }), part("keyboard", 29, 84, 266, 139, { layers: [{ x: 18, y: 6, w: 72, h: 54 }] }),
    ];
    const out = composeWizard({ parts, runs: [run("Enter Name", 32, 26), ...digits] });
    assert.ok(out.some((d) => d.kind === "stripes"));
    const chips = out.filter((d) => /^steps0\.\d\.plate$/.test(d.key));
    assert.equal(chips.length, 3);
    assert.equal(chips.filter((d) => d.edge === "var(--c-orange)").length, 1, "one chip is the focus");
    assert.equal(chips[0].edge, "var(--c-orange)", "clip 12 = step 1");
    assert.deepEqual(out.filter((d) => /^steps0\.\d\.ch$/.test(d.key)).map((d) => d.text), ["1", "2", "3"]);
    assert.equal(out.find((d) => d.key === "hdr0.t").text, "Enter Name");
    assert.ok(keys(out).indexOf("hdr0") < keys(out).indexOf("steps0.0.plate"), "the chips stack above the title plate");
});

test("pack list: step 2 in focus, the chosen tab (clip 50) is the focus tab, the window and its rules come from the clip's layers", () => {
    const L = [{ x: 0, y: 4, w: 28, h: 20 }, { x: 0, y: 28, w: 28, h: 20 }, { x: 0, y: 52, w: 28, h: 20 }, { x: 33, y: 0, w: 8, h: 182 }, { x: 280, y: 0, w: 8, h: 182 },
        { x: 56, y: 12, w: 44, h: 8 }, { x: 100, y: 12, w: 44, h: 8 }, { x: 42, y: 26, w: 48, h: 32 }];
    const parts = [part("backdrop", 0, 0, 320, 240), steps(13), part("packWin", 16, 44, 288, 182, { layers: L }), part("packSel", 16, 72, 28, 20)];
    const runs = [run("Choose a Starter Pack", 32, 26), ...digits, run("A", 24, 52), run("B", 24, 76), run("C", 24, 100), run("Balanced Pack", 64, 56)];
    const out = composeWizard({ parts, runs });
    assert.equal(out.find((d) => d.key === "steps0.1.plate").edge, "var(--c-orange)", "clip 13 = step 2");
    assert.equal(out.find((d) => d.key === "steps0.0.plate").edge, FAMILY_C.edge);
    assert.equal(out.find((d) => d.key === "pk0.tab1.plate").edge, "var(--c-orange)", "the marker clip sits on tab B");
    assert.equal(out.find((d) => d.key === "pk0.tab0.plate").edge, FAMILY_C.edge);
    assert.deepEqual(["A", "B", "C"].map((t) => out.some((d) => d.kind === "text" && d.text === t)), [true, true, true]);
    assert.ok(out.some((d) => d.key === "pk0.win"), "the C window");
    assert.ok(out.some((d) => d.key === "hdr" + "w0"), "no title clip on this page: the step clip's left pieces carry the title plate");
    assert.equal(new Set(keys(out)).size, out.length);
});

test("confirm page: step 3, the name window with its portrait frame, the pack window, the YES cursor beside its row", () => {
    const box = part("netWin", 0, 162, 320, 58, { id: "1", base: 1, layers: [{ x: 0, y: 0, w: 56, h: 58 }, { x: 56, y: 0, w: 16, h: 58 }, { x: 72, y: 2, w: 8, h: 54 }, { x: 80, y: 2, w: 40, h: 54 }, { x: 240, y: 2, w: 8, h: 54 }] });
    const parts = [part("backdrop", 0, 0, 320, 240), steps(14), part("cfPortrait", 55, 47, 36, 36), part("cfName", 55, 47, 212, 36), part("cfPack", 55, 89, 212, 62), box];
    const runs = [run("Confirmation Screen", 32, 26), ...digits, run("Register account?", 90, 169), run("YES", 107, 185), run("NO", 107, 199), run("[select]", 90, 185)];
    const out = composeWizard({ parts, runs });
    assert.equal(out.find((d) => d.key === "steps0.2.plate").edge, "var(--c-orange)", "clip 14 = step 3");
    assert.deepEqual(["cf0.portrait", "cfn0", "cfp0"].map((k) => out.some((d) => d.key === k)), [true, true, true]);
    const win = out.find((d) => d.key === "net0");
    assert.deepEqual([win.rect.x, win.rect.w], [72, 176], "the box = the 54 tall pieces; the wires and their 16 wide joints stay outside");
    const cur = out.find((d) => d.kind === "chevron");
    assert.ok(cur && cur.rect.x < 107 && cur.rect.y > 180 && cur.rect.y < 190, "the list cursor stands left of YES on its row");
    assert.equal(new Set(keys(out)).size, out.length);
});
