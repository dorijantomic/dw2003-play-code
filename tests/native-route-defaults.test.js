// Route check during translation cutover. A converted route must use browser
// code in ordinary play; remaining routes retain their focused reference check.
//
// This is the machine-checked half of that gate: each remaining native route's default
// flag must be native (either a constant true or `!GYM_PARAMS.has("legacy…")`), it
// must name a shipped adapter module, and no route may be opt-IN (a
// `has("native…")` switch means ordinary play gets the hand-authored screen). The
// behavioural half — that each route actually drives the overlay — is the focused
// verifier named per row (tools/verify_native_*.mjs).
//
// Plan: docs/plans/2026-09-21-native-screen-production-integration-plan.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const read = (rel) => readFileSync(join(repo, rel), "utf8");

/** Every in-scope route: module, default flag, adapter, rollback, focused proof. */
export const ROUTES = [
    { module: "pro/stitshop", flag: "USE_NATIVE_SHOP", adapter: "web/shop-translated.js", rollback: null, proof: "tools/verify_browser_shop.mjs", execution: "translated" },
    {
        module: "pro/stgtrain", flag: "USE_NATIVE_GYM", adapter: "web/gym-translated.js", rollback: "Gym",
        proof: "tools/verify_translated_gym.mjs", execution: "translated", reference: "web/gym-native.js",
    },
    {
        module: "pro/stgdglab", flag: "USE_NATIVE_DRI", adapter: "web/lab-translated.js", rollback: "Dri",
        proof: "tools/verify_translated_lab.mjs", execution: "translated", reference: "web/dri-native.js",
    },
    { module: "pro/ststatus", flag: "USE_NATIVE_STATUS", adapter: "web/status-native.js", rollback: "Status", proof: "tools/verify_native_status.mjs" },
    {
        module: "pro/stgmcard", flag: "USE_NATIVE_SAVE", adapter: "web/save-translated.js", rollback: "Save",
        proof: "tools/verify_translated_save.mjs", execution: "translated", reference: "web/save-native.js",
    },
    {
        module: "pro/stfgtrep", flag: "USE_NATIVE_REPORT", adapter: "web/fightreport-translated.js",
        rollback: "Report", proof: "tools/verify_translated_report.mjs",
        execution: "translated", reference: "web/fightreport-native.js",
    },
    {
        module: "pro/stcrdabm", flag: "USE_NATIVE_ALBUM", adapter: "web/cardalbum-translated.js", rollback: "Album",
        proof: "tools/verify_translated_album.mjs", execution: "translated", reference: "web/cardalbum-native.js",
    },
    {
        module: "pro/stcrddek", flag: "USE_NATIVE_DECK", adapter: "web/carddeck-translated.js", rollback: "Deck",
        proof: "tools/verify_translated_folder.mjs", execution: "translated", reference: "web/carddeck-native.js",
    },
    { module: "pro/stcrdshp", flag: "USE_NATIVE_CARDSHOP", adapter: "web/cardshop-translated.js", rollback: "CardShop", proof: "tools/verify_translated_cardshop.mjs", execution: "translated", reference: "web/cardshop-native.js" },
    { module: "pro/cardgame", flag: "USE_NATIVE_DUEL", adapter: "web/cardduel-native.js", rollback: "Duel", proof: "tools/verify_native_duel.mjs" },
    { module: "pro/stdwtitl", flag: "USE_NATIVE_TITLE", adapter: "web/titlescreen.js", rollback: null, proof: "tools/verify_translated_title.mjs", execution: "translated" },
    { module: "pro/stdgname", flag: "USE_NATIVE_NAME", adapter: "web/nameentry-native.js", rollback: "Name", proof: "tools/verify_native_nameentry.mjs" },
    { module: "pro/stplnmet", flag: "USE_NATIVE_PACK", adapter: "web/packselect-native.js", rollback: "Pack", proof: "tools/verify_native_packselect.mjs" },
    {
        module: "pro/cnty_sel", flag: "USE_NATIVE_CNTYSEL", adapter: "web/cntysel-native.js",
        rollback: "Cntysel", proof: "tools/verify_translated_language.mjs", execution: "translated",
        // The country/language screen is the game's BOOT screen (the boot main
        // sets code 0x1600 -> CNTY_SEL.PRO), so it has a second, ordinary-play
        // proof: an unadorned page load opens it before the title.
        bootProof: "tools/verify_native_boot_language.mjs",
    },
    {
        module: "pro/fightstg", flag: "USE_NATIVE_COMMAND", adapter: "web/battlecmd-translated.js",
        rollback: "BattleCmd", proof: "tools/verify_translated_battlecmd.mjs", source: "web/battle.js",
        execution: "translated", reference: "web/battlecmd-native.js",
    },
    {
        module: "pro/wfightmn", flag: "USE_NATIVE_WFIGHT", adapter: "web/wfight-translated.js",
        rollback: "Wfight", proof: "tools/verify_translated_wfight.mjs", source: "web/battle.js",
        execution: "translated", reference: "web/wfightmn-native.js",
    },
];

/** Developer-only roots the plan keeps out of ordinary play.
 *  `pro/wfightmn` is NOT here: it is the battle controller reached by ordinary
 *  play, and its boot loader is a translated production step (row above). Its
 *  turn loop is a separate machine whose action semantics live in a vtable built
 *  outside the overlay, so the walker's battle keeps owning turns. */
const DEVELOPER_ONLY = ["pro/stagslct", "pro/soundtst", "pro/shocktst", "pro/wfightts"];

const GAME = read("web/game.js");
const BATTLE = read("web/battle.js");

test("item, armory and pawn shops use translated browser code in ordinary play", () => {
    assert.equal(flagExpression(GAME, "USE_NATIVE_SHOP"),
        'new URLSearchParams(location.search).has("nativeShop")');
    assert.match(GAME, /const shop = USE_NATIVE_SHOP \? createShopNative\([^\n]+\) : shopTranslated;/);
    assert.ok(existsSync(join(repo, "tools/verify_browser_shop.mjs")));
    assert.ok(existsSync(join(repo, "tools/verify_native_shop.mjs")));
});

function flagExpression(source, flag) {
    const m = source.match(new RegExp(`const ${flag}\\s*=\\s*([^;]+);`));
    return m ? m[1].trim() : null;
}

test("every in-scope route has a shipped adapter and a focused proof", () => {
    for (const r of ROUTES) {
        assert.ok(existsSync(join(repo, r.adapter)), `${r.module}: adapter ${r.adapter} missing`);
        assert.ok(existsSync(join(repo, r.proof)), `${r.module}: focused proof ${r.proof} missing`);
    }
});

test("every in-scope route defaults to its current production adapter", () => {
    for (const r of ROUTES) {
        const source = r.source ? BATTLE : GAME;
        if (r.module === "pro/stitshop") {
            assert.equal(flagExpression(source, r.flag), 'new URLSearchParams(location.search).has("nativeShop")');
            assert.match(source, /const shopTranslated = createShopTranslated\(sfx,/);
            const adapter = read(r.adapter);
            assert.match(adapter, /new ui\.ShopRootSession\(/);
            assert.doesNotMatch(adapter, /openNativeScreen|preloadNativeScreens|bootNativeScreen/);
            assert.match(source, /const shop = USE_NATIVE_SHOP \? createShopNative\([^\n]+\) : shopTranslated;/);
            continue;
        }
        if (r.module === "pro/stcrdshp") {
            const adapter = read(r.adapter);
            assert.match(adapter, /new ui\.CardShopSession\(/);
            assert.doesNotMatch(adapter, /openNativeScreen|preloadNativeScreens|bootNativeScreen/);
            assert.match(source, /GYM_PARAMS\.has\("nativeCardShop"\) \? cardShopNative : cardShopTranslated/);
            assert.ok(existsSync(join(repo, r.reference)));
            continue;
        }
        if (r.module === "pro/stcrdabm") {
            // The translated album is the default; the shipped overlay is an
            // explicit research reference (?nativeAlbum=1) and the hand-made
            // screen stays ?legacyAlbum=1.
            const adapter = read(r.adapter);
            assert.match(adapter, /new ui\.AlbumSession\(/);
            assert.doesNotMatch(adapter, /openNativeScreen|preloadNativeScreens|bootNativeScreen/);
            assert.match(source, /GYM_PARAMS\.has\("nativeAlbum"\) \? cardAlbumNative : cardAlbumTranslated/);
            assert.ok(existsSync(join(repo, r.reference)));
            continue;
        }
        if (r.module === "pro/stcrddek") {
            // The translated folder chooser is the default; the shipped overlay
            // is an explicit research reference (?nativeFolder=1) and the
            // hand-made editor stays ?legacyDeck=1.
            const adapter = read(r.adapter);
            assert.match(adapter, /new ui\.FolderSession\(/);
            assert.doesNotMatch(adapter, /openNativeScreen|preloadNativeScreens|bootNativeScreen/);
            assert.match(source, /GYM_PARAMS\.has\("nativeFolder"\) \? cardDeckNative : cardDeckTranslated/);
            assert.ok(existsSync(join(repo, r.reference)));
            continue;
        }
        if (r.module === "pro/stdwtitl") {
            assert.equal(flagExpression(source, r.flag), 'GYM_PARAMS.has("nativeTitle")');
            assert.match(source, /: createTitleScreen\(\{ language: state\.languageByte \?\? 2, previousScreenCode \}\)/);
            const adapter = read(r.adapter);
            assert.match(adapter, /new ui\.TitleSession\(/);
            assert.doesNotMatch(adapter, /openNativeScreen|preloadNativeScreens|bootNativeScreen/);
            continue;
        }
        if (r.module === "pro/fightstg") {
            // The translated list is the default; the original-code list is an
            // explicit research reference (?nativeBattleCmd=1).
            const adapter = read(r.adapter);
            assert.match(adapter, /new ui\.FightCommandSession\(/);
            assert.doesNotMatch(adapter, /openNativeScreen|preloadNativeScreens|bootNativeScreen|native-screen\.js|native-screen-host/);
            assert.match(source, /get\("nativeBattleCmd"\) === "1"/);
            assert.match(source, /USE_REFERENCE_COMMAND\s*\?\s*createBattleCommandNative\(sfx\)\s*:\s*createBattleCommandTranslated\(/);
            assert.ok(existsSync(join(repo, r.reference)));
        } else if (r.module === "pro/wfightmn") {
            // The translated loader is the default; the original-code loader is an
            // explicit research reference (?nativeWfight=1).
            const adapter = read(r.adapter);
            assert.match(adapter, /new ui\.WfightLoaderSession\(/);
            assert.doesNotMatch(adapter, /openNativeScreen|preloadNativeScreens|bootNativeScreen|native-screen\.js|native-screen-host/);
            assert.match(source, /get\("nativeWfight"\) === "1"/);
            assert.match(source, /USE_REFERENCE_WFIGHT\s*\?\s*createWfightNative\(\)\s*:\s*createWfightTranslated\(/);
            assert.ok(existsSync(join(repo, r.reference)));
        } else if (r.module === "pro/stgmcard") {
            // The translated save/load screen is the default; the original-code screen
            // is an explicit research reference (?nativeSave=1).
            const adapter = read(r.adapter);
            assert.match(adapter, /new ui\.MemcardSession\(/);
            assert.doesNotMatch(adapter, /openNativeScreen|preloadNativeScreens|bootNativeScreen|native-screen\.js|native-screen-host/);
            assert.match(source, /get\("nativeSave"\) === "1"/);
            assert.match(source, /USE_REFERENCE_SAVE\s*\?\s*createSaveNative\(sfx\)\s*:\s*createSaveTranslated\(/);
            assert.ok(existsSync(join(repo, r.reference)));
        } else if (r.module === "pro/stgtrain") {
            // The translated gym is the default; the original-code screen is an explicit
            // research reference (?nativeGym=1) and the hand-made screen stays ?legacyGym=1.
            const adapter = read(r.adapter);
            assert.match(adapter, /new ui\.GymSession\(/);
            assert.doesNotMatch(adapter, /openNativeScreen|preloadNativeScreens|bootNativeScreen|native-screen\.js|native-screen-host/);
            assert.match(source, /USE_REFERENCE_GYM = GYM_PARAMS\.has\("nativeGym"\)/);
            assert.match(source, /USE_REFERENCE_GYM \? createGymNative\(sfx\) : createGymTranslated\(sfx\)/);
            assert.ok(existsSync(join(repo, r.reference)));
        } else if (r.module === "pro/stgdglab") {
            // The translated Digimon lab is the default; the original-code screen is an explicit
            // research reference (?nativeLab=1) and the hand-made desk stays ?legacyDri=1.
            const adapter = read(r.adapter);
            assert.match(adapter, /new ui\.LabSession\(/);
            assert.doesNotMatch(adapter, /openNativeScreen|preloadNativeScreens|bootNativeScreen|native-screen\.js|native-screen-host/);
            assert.match(source, /USE_REFERENCE_LAB = GYM_PARAMS\.has\("nativeLab"\)/);
            assert.match(source, /USE_REFERENCE_LAB \? createDriNative\(sfx\) : createLabTranslated\(sfx\)/);
            assert.ok(existsSync(join(repo, r.reference)));
        } else if (r.module === "pro/stfgtrep") {
            // The translated results screen is the default; the original-code screen
            // is an explicit research reference (?nativeReport=1).
            const adapter = read(r.adapter);
            assert.match(adapter, /new ui\.FightReportSession\(/);
            assert.doesNotMatch(adapter, /openNativeScreen|preloadNativeScreens|bootNativeScreen|native-screen\.js|native-screen-host/);
            assert.match(source, /get\("nativeReport"\) === "1"/);
            assert.match(source, /USE_REFERENCE_REPORT\s*\?\s*createFightReportNative\(sfx\)\s*:\s*createFightReportTranslated\(/);
            assert.ok(existsSync(join(repo, r.reference)));
        } else if (r.execution === "translated") {
            const adapter = read(r.adapter);
            assert.match(adapter, /new CountryScreen\(/);
            assert.doesNotMatch(adapter, /openNativeScreen|preloadNativeScreens|nativeScreenRead/);
        }
        const expr = flagExpression(source, r.flag);
        assert.ok(expr, `${r.module}: ${r.flag} is not defined in ${r.source ?? "web/game.js"}`);
        if (expr === "true") {
            // Hard-wired native: the hand-authored module stays only as an
            // unreachable development copy, which is allowed by the plan.
            assert.equal(r.rollback, null, `${r.module}: a hard-wired native route must not claim a rollback switch`);
            continue;
        }
        if (expr.startsWith("(() =>")) {
            // The browser-only form (web/battle.js): an IIFE that guards the
            // node `location` absence and otherwise asks the legacy switch.
            assert.match(
                source,
                new RegExp(`return !new URLSearchParams\\(location\\.search\\)\\.has\\("legacy${r.rollback}"\\)`),
                `${r.module}: ${r.flag} is not native-by-default (got ${expr})`,
            );
            assert.match(source, /typeof location === "undefined"/,
                `${r.module}: ${r.flag} must stay importable under node --test`);
        } else {
            assert.match(
                expr,
                /^!GYM_PARAMS\.has\("legacy[A-Za-z]+"\)$/,
                `${r.module}: ${r.flag} is not native-by-default (got ${expr})`,
            );
        }
        const rollback = expr.startsWith("(() =>") ? r.rollback : /"legacy([A-Za-z]+)"/.exec(expr)?.[1];
        assert.equal(rollback, r.rollback, `${r.module}: rollback switch name drifted (${rollback})`);
    }
});

test("remaining native routes do not require an opt-in switch", () => {
    // Exception list: flags whose ORDINARY default is the translated route and
    // which only select the reference adapter when set. USE_NATIVE_STAGE is the
    // field's stage ambience, converted 2026-10-06 (the ordinary route runs the
    // translated stage-object modules; ?nativeStages=1 boots the overlay).
    const REFERENCE_SWITCHES = ["USE_NATIVE_SHOP", "USE_NATIVE_TITLE", "USE_NATIVE_STAGE"];
    for (const file of ["web/game.js", "web/battle.js"]) {
        const src = read(file);
        const optIn = [...src.matchAll(/const (USE_NATIVE_[A-Z_]+)\s*=\s*([^;]+);/g)]
            .filter(([name, flag, expr]) => !REFERENCE_SWITCHES.includes(flag) &&
                (/has\("native/.test(expr) || /^\s*false\s*$/.test(expr)));
        assert.deepEqual(optIn.map((m) => `${file}:${m[1]}`), [],
            `opt-IN native flags found (ordinary play would use the hand-authored screen): ${optIn.map((m) => m[1])}`);
    }
});

test("every rollback switch is documented as a legacy screen module", () => {
    for (const r of ROUTES) {
        if (!r.rollback) continue;
        // The switch must appear in the source next to its flag (the plan's
        // "rollback switches, if retained, are off by default and tested
        // explicitly" — the per-route verifiers pin them).
        const src = r.source ? BATTLE : GAME;
        assert.ok(src.includes(`"${r.rollback}"`) || src.includes(`legacy${r.rollback.replace(/^legacy/, "")}`),
            `${r.module}: rollback switch ${r.rollback} not found in source`);
    }
});

test("the plan's developer-only roots are not wired as production routes", () => {
    // No native adapter may claim them as its module id; they stay lab/accounting
    // roots (their overlay files still ship for the lab and the reference sweep).
    const adapters = readdirSync(join(repo, "web")).filter((f) => f.endsWith("-native.js"));
    for (const mod of DEVELOPER_ONLY) {
        for (const f of adapters) {
            const src = read(`web/${f}`);
            assert.ok(!src.includes(`"${mod}"`), `web/${f} must not drive the developer-only root ${mod}`);
        }
    }
    const manifest = JSON.parse(read("web/assets/native/screens/manifest.json"));
    for (const mod of DEVELOPER_ONLY) {
        assert.ok(manifest.screens[mod], `${mod}: the lab/accounting root should still ship in the manifest`);
    }
});
