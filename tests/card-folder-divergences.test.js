// The two card-folder divergences the 2026-10-05 screen lab measured
// (.dw3-research/rig-sweep-2026-10-05/ui-lab-worker.md item 3; ledger claim
// two-card-folder-divergences-in-our-build-2026-10-05, evidence
// EV-UI-LAB-DIVERGENCES-2026-10-05):
//
//   1. our folders carried default names ("Folder 1", "Folder 2", "Folder 3")
//      where the original's are blank until the player names one — the new
//      game zero-fills the save block and only the naming screen writes a name
//      (CARD-DUEL-VERIFIED.md §8; the lab's fresh original shows blank rows);
//   2. the card shop's Edit Folder opened the hand-authored editor while the
//      pause menu's Card Folders opened the native folder screen. On the disc
//      both routes hand off to launcher code 0x400 = pro/stcrddek
//      (docs/research/ui/stcrdshp-decoded-2026-07-12.md §0).
//
// These pins fail if either divergence comes back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");

test("no folder screen writes a default name (folders are blank until named)", () => {
    for (const file of ["web/carddeck-native.js", "web/cardduel-native.js"]) {
        const src = read(file);
        assert.doesNotMatch(src, /Folder \$\{/, `${file} must not invent a folder name`);
        assert.match(src, /encodeNativeScreenText\(folder\?\.name \?\? ""/,
            `${file} must seed the folder's own stored name`);
    }
    // The engine's starter grant is the third writer: it leaves every folder
    // unnamed, matching the zero-filled records the original starts from.
    assert.doesNotMatch(read("engine/systems/card-battle.ts"), /name: `Folder/,
        "grantStarterDeck must not name the folders");
});

test("the card shop's Edit Folder opens the same folder screen as the pause menu", () => {
    const game = read("web/game.js");
    const fn = game.match(/function openCardShopFolder\(\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(fn, "openCardShopFolder() not found in web/game.js");
    // It opens the module's one `cardDeck` binding — the adapter the pause
    // menu's onCardDeck opens — with no per-route swap to another editor.
    assert.match(fn, /cardDeck\.open\(/);
    assert.doesNotMatch(fn, /cardDeckLegacy|cardDeckNative/);
    assert.doesNotMatch(fn, /cardDeck\s*=[^=]/, "the shop must not rebind which folder editor is opened");
    assert.doesNotMatch(fn, /GYM_PARAMS/);
    // The pause route opens that same binding.
    assert.match(game, /menu\.onCardDeck = \(\) => \{ state\.menuOpen = false; cardDeck\.open\(backToCardFolders\); \};/);
    // Both ordinary card-shop entries hand their Edit Folder off through this
    // one function (the field merchant route and the lab route).
    assert.equal((game.match(/cardShop\.open\(state, null, openCardShopFolder/g) ?? []).length, 2);
});
