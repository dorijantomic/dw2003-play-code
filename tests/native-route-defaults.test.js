// Route check during translation cutover. A converted route must use browser
// code in ordinary play; remaining routes retain their focused reference check.
//
// This is the machine-checked half of that gate: each route's ordinary adapter
// must be a shipped module that runs the translated session (or, for the routes
// that are still the original-code adapter, the shipped overlay), web/game.js and
// web/battle.js must build exactly that adapter, and neither file may read a URL
// switch to pick a screen. The behavioural half — that each route actually drives
// the screen — is the focused verifier named per row (tools/verify_*.mjs).
//
// Plan: docs/plans/2026-09-21-native-screen-production-integration-plan.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSource } from "./helpers/source.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const read = (rel) => readFileSync(join(repo, rel), "utf8");

const NO_HOST = /openNativeScreen|preloadNativeScreens|bootNativeScreen|native-screen\.js|native-screen-host/;

/** The check that an adapter runs its session, `/new ui\.XSession\(/`.
 *  A typed call emits its annotation as blanks: `new (ui as EngineUi).ShopRootSession(`
 *  builds to `new (ui            ).ShopRootSession(`, so the plain `new ui\.` form is gone.
 *  Accept both the plain and the parenthesised form. */
const runsSession = (name) => new RegExp(`new (?:\\(ui\\s*\\)|ui)\\.${name}\\(`);

/** Every in-scope route: module, ordinary adapter, focused proof, the session it runs, and the line
 *  in web/game.js (or web/battle.js) that builds it. */
export const ROUTES = [
    {
        module: "pro/stitshop", adapter: "web/shop-translated.js", proof: "tools/verify_browser_shop.mjs",
        session: runsSession("ShopRootSession"), built: /const shopTranslated = createShopTranslated\(sfx,[\s\S]*?const shop = shopTranslated;/,
    },
    {
        module: "pro/stgtrain", adapter: "web/gym-translated.js", proof: "tools/verify_translated_gym.mjs",
        session: runsSession("GymSession"), built: /const gym = createGymTranslated\(sfx\);/,
    },
    {
        module: "pro/stgdglab", adapter: "web/lab-translated.js", proof: "tools/verify_translated_lab.mjs",
        session: runsSession("LabSession"), built: /const driMenu = createLabTranslated\(sfx\);/,
    },
    {
        module: "pro/ststatus", adapter: "web/status-translated.js", proof: "tools/verify_native_status.mjs", allowHost: true,
        session: runsSession("PauseRootSession"), built: /const status = createStatusTranslated\(sfx, statusOptions\);/,
    },
    {
        module: "pro/stgmcard", adapter: "web/save-translated.js", proof: "tools/verify_translated_save.mjs",
        session: runsSession("MemcardSession"), built: /const saveScreenNative = createSaveTranslated\(sfx\);\s*(?:export )?const saveScreen = saveScreenNative;/,
    },
    {
        module: "pro/stfgtrep", adapter: "web/fightreport-translated.js", proof: "tools/verify_translated_report.mjs",
        session: runsSession("FightReportSession"), built: /const fightReportNative = createFightReportTranslated\(sfx, \{ getState: \(\) => state \}\);\s*(?:export )?const fightReport = fightReportNative;/,
    },
    {
        module: "pro/stcrdabm", adapter: "web/cardalbum-translated.js", proof: "tools/verify_translated_album.mjs",
        session: runsSession("AlbumSession"), built: /const cardAlbumTranslated = createCardAlbumTranslated\(sfx\);\s*(?:export )?const cardAlbum = cardAlbumTranslated;/,
    },
    {
        module: "pro/stcrddek", adapter: "web/carddeck-translated.js", proof: "tools/verify_translated_folder.mjs",
        session: runsSession("FolderSession"), built: /const cardDeckTranslated = createCardDeckTranslated\(sfx\);\s*(?:export )?const cardDeck = cardDeckTranslated;/,
    },
    {
        module: "pro/stcrdshp", adapter: "web/cardshop-translated.js", proof: "tools/verify_translated_cardshop.mjs",
        session: runsSession("CardShopSession"), built: /const cardShop = cardShopTranslated;/,
    },
    {
        module: "pro/cardgame", adapter: "web/cardduel-native.js", proof: "tools/verify_native_duel.mjs",
        session: null, built: /const cardDuel = cardDuelNative;/,
    },
    {
        module: "pro/stdwtitl", adapter: "web/titlescreen.js", proof: "tools/verify_translated_title.mjs",
        session: runsSession("TitleSession"), built: /let ts = createTitleScreen\(\{ language: state\.languageByte \?\? 2, previousScreenCode \}\);/,
    },
    {
        module: "pro/stdgname", adapter: "web/nameentry-translated.js", proof: "tools/verify_native_nameentry.mjs", allowHost: true,
        session: runsSession("NameRootSession"), built: /const nameEntryNative = createNameEntryTranslated\(sfx,/,
    },
    {
        module: "pro/stplnmet", adapter: "web/packselect-translated.js", proof: "tools/verify_translated_packselect.mjs", allowHost: true,
        session: runsSession("WizardRootSession"), built: /const packSelectNative = createPackSelectTranslated\(sfx\);/,
    },
    {
        module: "pro/cnty_sel", adapter: "web/cntysel-native.js", proof: "tools/verify_translated_language.mjs",
        session: /new CountryScreen\(/, built: /const cntyselNative = createCntyselNative\(sfx, bgm\);/,
        // The country/language screen is the game's BOOT screen (the boot main
        // sets code 0x1600 -> CNTY_SEL.PRO), so it has a second, ordinary-play
        // proof: an unadorned page load opens it before the title.
        bootProof: "tools/verify_native_boot_language.mjs",
    },
    {
        module: "pro/fightstg", adapter: "web/battlecmd-translated.js", proof: "tools/verify_translated_battlecmd.mjs",
        source: "web/battle.js", session: runsSession("FightCommandSession"),
        built: /(?:[A-Za-z_$][\w$]*\.)?commandNative = createBattleCommandTranslated\(sfx, \{ getState \}\);/,
    },
    {
        module: "pro/wfightmn", adapter: "web/wfight-translated.js", proof: "tools/verify_translated_wfight.mjs",
        source: "web/battle.js", session: runsSession("WfightLoaderSession"),
        built: /(?:[A-Za-z_$][\w$]*\.)?wfightNative = createWfightTranslated\(\{ getState \}\);/,
    },
];

/** Developer-only roots the plan keeps out of ordinary play.
 *  `pro/wfightmn` is NOT here: it is the battle controller reached by ordinary
 *  play, and its boot loader is a translated production step (row above). Its
 *  turn loop is a separate machine whose action semantics live in a vtable built
 *  outside the overlay, so the walker's battle keeps owning turns. */
const DEVELOPER_ONLY = ["pro/stagslct", "pro/soundtst", "pro/shocktst", "pro/wfightts"];

const GAME = readSource(join(repo, "web/game.js"));
const BATTLE = readSource(join(repo, "web/battle.js"));

test("every in-scope route has a shipped adapter and a focused proof", () => {
    for (const r of ROUTES) {
        assert.ok(existsSync(join(repo, r.adapter)), `${r.module}: adapter ${r.adapter} missing`);
        assert.ok(existsSync(join(repo, r.proof)), `${r.module}: focused proof ${r.proof} missing`);
        if (r.bootProof) assert.ok(existsSync(join(repo, r.bootProof)), `${r.module}: boot proof ${r.bootProof} missing`);
    }
});

test("every in-scope route is built from its production adapter, with no switch", () => {
    for (const r of ROUTES) {
        const source = r.source ? BATTLE : GAME;
        assert.match(source, r.built, `${r.module}: ${r.source ?? "web/game.js"} does not build ${r.adapter}`);
        const adapter = read(r.adapter);
        if (r.session) assert.match(adapter, r.session, `${r.module}: ${r.adapter} does not run its session`);
        // The translated adapters run no interpreter host (the pause, naming and registration
        // adapters share the screen renderer module and are not held to this).
        if (r.adapter.endsWith("-translated.js") && !r.allowHost) {
            assert.doesNotMatch(adapter, NO_HOST, `${r.module}: ${r.adapter} must not link an interpreter host`);
        }
    }
});

test("no URL switch picks a screen in web/game.js or web/battle.js", () => {
    for (const [file, src] of [["web/game.js", GAME], ["web/battle.js", BATTLE]]) {
        assert.doesNotMatch(src, /(?:has|get)\("(?:native|legacy)[A-Z]/, `${file} reads a native/legacy URL switch`);
        assert.doesNotMatch(src, /const USE_(?:NATIVE|REFERENCE|LEGACY)_[A-Z_]+\s*=/, `${file} still declares a route switch`);
    }
});

test("the plan's developer-only roots are not wired as production routes", () => {
    // No native adapter may claim them as its module id; they stay lab/accounting
    // roots (their overlay files still ship for the lab and the reference sweep).
    const adapters = ["web/cardduel-native.js", "web/cntysel-native.js", "web/dri-native.js"];
    for (const mod of DEVELOPER_ONLY) {
        for (const f of adapters) {
            const src = read(f);
            assert.ok(!src.includes(`"${mod}"`), `${f} must not drive the developer-only root ${mod}`);
        }
    }
    const manifest = JSON.parse(read("web/assets/native/screens/manifest.json"));
    for (const mod of DEVELOPER_ONLY) {
        assert.ok(manifest.screens[mod], `${mod}: the lab/accounting root should still ship in the manifest`);
    }
});
