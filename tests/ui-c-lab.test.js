// The ui-lab "Remaster vs Pixel" view: the screen table and the wiring. Pure: no browser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LAB_SCREENS, SEEDS, needsFor, stepsFor } from "../web/ui-lab-screens.js";

const lab = readFileSync(new URL("../web/ui-lab.html", import.meta.url), "utf8");

test("the screen table: unique ids, every parent exists, every task is T1..T9 or pixel", () => {
    const ids = LAB_SCREENS.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const r of LAB_SCREENS) {
        if (r.parent) assert.ok(ids.includes(r.parent), `${r.id} parent ${r.parent}`);
        assert.match(r.task, /^(T[1-9]|pixel)$/, r.id);
        assert.ok(r.steps === null || (Array.isArray(r.steps) && r.steps.length > 0), r.id);
        for (const s of r.steps ?? []) assert.ok(["eval", "press", "wait"].includes(s[0]), `${r.id} step ${s[0]}`);
        for (const n of r.needs ?? []) assert.ok(n in SEEDS, `${r.id} needs ${n}`);
    }
});

test("T1 screens are scripted: home, items, folders, demo, help, inn, lab, counter", () => {
    for (const id of ["home", "items", "folders", "demo", "help", "inn", "lab", "counter"]) {
        assert.equal(LAB_SCREENS.find((r) => r.id === id).task, "T1", id);
        assert.ok(stepsFor(id), `${id} has a key script`);
    }
    assert.deepEqual(stepsFor("home")[0], ["eval", "__labOpen('menu')"]);
    assert.deepEqual(stepsFor("items").slice(-1)[0], ["press", "Enter", 1]);
    assert.deepEqual(stepsFor("folders").filter((s) => s[0] === "press"), [["press", "ArrowDown", 5], ["press", "Enter", 1]], "home(5): down five times, Enter");
});

test("a row with no script has none, and parents run first", () => {
    assert.equal(stepsFor("gymResult"), null, "gymResult is not scripted");
    assert.deepEqual(stepsFor("deckRename").slice(0, stepsFor("deckActions").length), stepsFor("deckActions"), "deckRename runs deckActions first");
    assert.deepEqual(stepsFor("deckRename").slice(-2), [["press", "ArrowDown", 1], ["press", "Enter", 1]]);
    assert.deepEqual(stepsFor("sellList").slice(0, stepsFor("sellCat").length), stepsFor("sellCat"), "sellList runs its parent sellCat first");
    const bag = stepsFor("bag");
    assert.deepEqual(bag.slice(0, 2), stepsFor("items").slice(0, 2));
    assert.deepEqual(bag.slice(-1)[0], ["press", "Enter", 1]);
    assert.deepEqual(needsFor("album"), ["items"]);
});

test("the view is a button, not a URL flag, and the pixel pane switches look C off through the dev hook", () => {
    assert.match(lab, /id="vRemaster"[^>]*>Remaster vs Pixel</);
    assert.doesNotMatch(lab, /get\("view"\)|view=remaster/);
    assert.match(lab, /w\.__uiC\.setEnabled\(false\)/);
    assert.match(lab, /id="gamePx"/); assert.match(lab, /id="gameRm"/);
    assert.match(lab, /Not covered here/, "the page says what it does not cover");
    assert.match(lab, /new w\.KeyboardEvent\(type, init\)/, "the same key goes to both games");
});
