// How GLOSSARY > DIGIMON is wired into web/game.js (source checks, the repo style: the real game cannot be imported under node).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");

test("the glossary row opens the Digimon screen, not the blank book; OPTIONS is untouched", () => {
    assert.match(game, /glossary: \(args\) => createGlossaryBook\(/);
    assert.doesNotMatch(game, /createBlankBook\(\{ title: "GLOSSARY" \}\)/);
    assert.match(game, /options: \(args\) => createOptionsBook\(args\)/);
});

test("one species log, installed after the sound players, recording always (no switch)", () => {
    assert.equal((game.match(/createSpeciesLog\(/g) || []).length, 1);
    assert.match(game, /installSpeciesLog\(\{ on: onGameEvent, log: speciesLog \}\)/);
    assert.doesNotMatch(game, /installSpeciesLog\([^)]*enabled/);
    assert.ok(game.indexOf("installSpeciesLog(") > game.indexOf("window.__sfx = sfx;"));
});

test("the party reader gives rookie, form, slot and live level for the first three members", () => {
    const at = game.indexOf("function glossaryPartners()");
    assert.ok(at > 0);
    const block = game.slice(at, game.indexOf("\n}\n", at));
    for (const word of ["rosterSlotOfCharId", "rookie:", "form: row.formName", "level:", "formLedger", "slice(0, 3)"]) assert.ok(block.includes(word), word);
});

test("the stage is made once with the fallback and a transparent renderer, and the book closes it when the host drops the book", () => {
    assert.equal((game.match(/createStage\(/g) || []).length, 1);
    assert.match(game, /createBattle3D\(canvas, null, \{ alpha: true \}\)/);
    assert.match(game, /drawFallback: createPartnerFallback\(\)/);
    const book = readFileSync(new URL("../web/glossary-book.js", import.meta.url), "utf8");
    assert.match(book, /close\(\) \{ stage\?\.close\?\.\(\); \}/);
    const host = readFileSync(new URL("../web/book-host.js", import.meta.url), "utf8");
    assert.match(host, /book\?\.close\?\.\(\);/);
});
