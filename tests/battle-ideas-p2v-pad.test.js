// Review focus: Battle ideas must not turn on practice 2 vs 2; old saves are reset once; the pad drives the 2 vs 2 fight.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXTRA_GROUPS, needsPractice2v2Reset } from "../web/options-model.js";

test("the Battle ideas row does not contain practice2v2", () => {
    const g = EXTRA_GROUPS.find((x) => x.id === "battleideas");
    assert.ok(!g.keys.includes("practice2v2"));
    for (const x of EXTRA_GROUPS) assert.ok(!x.keys.includes("practice2v2"), x.id);
});

test("an old save with practice2v2 on is reset once; after the marker it stays as the dev set it", () => {
    assert.equal(needsPractice2v2Reset({ practice2v2: true }, null), true);
    assert.equal(needsPractice2v2Reset({ practice2v2: true }, "1"), false);
    assert.equal(needsPractice2v2Reset({ practice2v2: false }, null), false);
    assert.equal(needsPractice2v2Reset({}, null), false);
});

test("game.js sends pad presses to the 2 vs 2 fight and clears held keys while it is up", () => {
    const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
    assert.match(game, /if \(mpbVisible\(\)\) \{ mpbKey\(button\); return; \}[^\n]*\n\s*dispatchInput\(button, PAD_EVENT, ""\);/);
    assert.match(game, /gamepad\.tick\(dt\);\n\s*if \(mpbVisible\(\)\) state\.keys\.clear\(\);/);
});
