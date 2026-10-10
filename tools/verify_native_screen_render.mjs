// Phase 2 native screen port: the item shop's ORIGINAL overlay must paint its
// recorded picture-service intents through the extracted screen pack in the
// browser, reached from the UI lab's real entry point.
//
// The decoded cross-check is docs/research/ui/screen-rendering-model.md and
// web/shop.js: the shop's full-width BUY window is clip 6 at (0,29) and its
// backdrop is clip 0x14. This script asserts the native stream produces those
// ids through the replay. Text glyphs are not in the intent stream yet (the
// text service writes inline prims; Phase 4), and no original rig capture of
// the bare shop exists in-repo, so this is a picture-layer check.
//
// Server: python3 -m http.server 8742 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_native_screen_render.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
import { bootShopLab, openBuyList } from "./native-screen-shop-lab.mjs";

const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const MODULE = process.env.NATIVE_SCREEN_MODULE || "pro/stitshop";
const OUT = process.env.NATIVE_SCREEN_SHOT || "/tmp/native-screen-render";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

try {
    await page.goto(`${ROOT}ui-lab.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForSelector('button[data-scr="nativescreen"]', { timeout: 10000 });
    await page.click('button[data-scr="nativescreen"]');
    await page.waitForURL(/native-screen-lab\.html/, { timeout: 10000 });
    await page.waitForFunction(() => window.__nativeScreen?.()?.screensLoaded === 20, null, { timeout: 10000 });
    const useBridge = process.env.NATIVE_SCREEN_BRIDGE === "1";
    if (useBridge || MODULE !== "pro/stitshop") {
        await page.evaluate(([m, b]) => window.__nativeScreenBoot(m, { bridge: b }), [MODULE, useBridge]);
    }
    // The card roots draw a face only for a card the save marks as ever
    // obtained (save + id + 0x4DF). Seed the collection the game's own way -
    // through the shipped grant routine F0x80016E2C - so the faces have a
    // prerequisite rather than an injected result.
    // Only the album's grid draw pass reads the ever-obtained flag (its face
    // emit gates on it); the folder and shop reveal passes do not, so they are
    // not card roots here (accepted album-owned-gate answer).
    const CARD_ROOTS = new Set(["pro/stcrdabm"]);
    if (CARD_ROOTS.has(MODULE)) {
        await page.evaluate(() =>
            window.__nativeScreenGrantCards(Array.from({ length: 12 }, (_, i) => i + 1)),
        );
    }
    // The card duel needs its opening ceremony, not the first settled frame:
    // the field fade and the two banner bands run between ~frames 110 and ~200
    // of the port's own clock (accepted cardgame-visual-parity answer), and the
    // 45-frame picture has no bands to compare at all.
    const SETTLE_FRAMES = MODULE === "pro/cardgame" ? 220 : 45;
    // The merchant does NOT open on its item list: its own root state table runs
    // 0-2 as the greeting and 3 as the BUY/SELL menu, and only the confirm press
    // in state 3 reaches the list (pro/stitshop.s:9205 -> :9220 `+0x10 = 0x14`).
    // The clips this check pins (the BUY window 6, the item icons 74/85, the
    // cmfont pack) are the LIST's, so for pro/stitshop the picture under test is
    // the one the player reaches by pressing confirm — driven once, here, through
    // the lab's own pad-input service rather than by assuming a frame count.
    let shopList = false;
    if (MODULE === "pro/stitshop") {
        await bootShopLab(page, ROOT, MODULE);
        shopList = true;
    }
    // waitForFunction hands the whole argument value to the page function, so
    // the tuple travels as one array.
    await page.waitForFunction(
        (args) => {
            const [m, waitForCards, frames] = args;
            const s = window.__nativeScreen?.();
            const r = window.__nativeScreenRender?.();
            if (!s || !r || s.module !== m || !s.booted || r.frames < frames) return false;
            return waitForCards ? r.cards > 0 : true;
        },
        [MODULE, CARD_ROOTS.has(MODULE), SETTLE_FRAMES],
        { timeout: MODULE === "pro/cardgame" ? 30000 : 10000 },
    );
    if (shopList) {
        await openBuyList(page);
        // The list's own plates arrive over its first frames, the info band last
        // (the overlay draws clip 14 only once the selected row's record has been
        // read), so wait for the ids this check pins rather than for a frame
        // count. The renderer counts cumulatively, so anything already drawn
        // before the press still counts.
        await page.waitForFunction(
            () => {
                const seen = window.__nativeScreenRender?.()?.seen ?? [];
                return [6, 14, 17, 49, 74, 85].every((id) => seen.includes(id));
            },
            null,
            { timeout: 20000 },
        );
    }
    const state = await page.evaluate(() => window.__nativeScreen());
    const render = await page.evaluate(() => window.__nativeScreenRender());
    // The duel's two banner bands are the one place the console reference gives
    // exact pixel values: the plate's own fill (8,8,56), border (0,0,136) and
    // its second border row (8,8,88) (measured against
    // web/assets/ref/native/pro_cardgame.png; the plates are semi=0 clips whose
    // visible texels carry no palette STP bit, so the console draws them
    // opaque - see the 2026-09-16 plate fix).
    const bandPixels = MODULE === "pro/cardgame" ? await page.evaluate(() => {
        const el = document.getElementById("c");
        const ctx = el.getContext("2d");
        const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
        return { promptFill: at(150, 100), promptBorder: at(150, 96), titleBorder: at(150, 67) };
    }) : null;
    // Five roots are picture-empty by construction (their overlays never reach
    // the picture-service constructor F0x8001F648): their content is class-A
    // text widgets over a display-view backdrop, so the picture acceptance is
    // "nothing drawn, text present" instead of "clips drawn". See the accepted
    // packless-roots-picture-path answer.
    const pictureEmpty = (render.packs ?? []).length === 0;
    // pro/wfightmn publishes neither pictures nor text: its own path is a
    // file-load/upload state machine (accepted picture-empty-text-expectations).
    const textExempt = MODULE === "pro/wfightmn";
    if (pictureEmpty && !textExempt) {
        await page.waitForFunction(
            () => (window.__nativeTextWidgets?.() ?? []).length > 0 && window.__nativeScreenRender?.()?.frames >= 45,
            null,
            { timeout: 10000 },
        );
    }
    const widgets = pictureEmpty ? await page.evaluate(() => window.__nativeTextWidgets()) : null;
    await page.screenshot({ path: `${OUT}/native-screen-render.png` });
    writeFileSync(`${OUT}/state.json`, JSON.stringify({ state, render, widgets }, null, 1) + "\n");

    const problems = [];
    if (state.module !== MODULE) problems.push(`booted ${state.module}, expected ${MODULE}`);
    if (!state.booted) problems.push("runtime did not boot");
    if (state.traps !== 0) problems.push(`traps=${state.traps}`);
    if (useBridge && (!state.bridgeEnabled || state.bridged.length === 0)) {
        problems.push(`bridge not active (${JSON.stringify(state.bridged)})`);
    }
    if (pictureEmpty) {
        if (render.clips !== 0) problems.push(`picture-empty root drew ${render.clips} clips`);
        const withText = (widgets ?? []).filter((w) => w.lines.some((l) => l.len > 0 && l.bytes));
        if (textExempt) {
            if (render.frames < 45) problems.push(`text-free root only reached ${render.frames} frames`);
        } else if ((widgets ?? []).length === 0) problems.push("picture-empty root has no text widgets");
        else if (withText.length === 0) problems.push("no text widget carries a non-empty line");
    } else if (render.clips <= 0) {
        problems.push("no clips drawn");
    }
    if (CARD_ROOTS.has(MODULE) && render.cards <= 0) {
        problems.push("no card faces painted from VRAM");
    }
    if (bandPixels !== null) {
        const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
        if (!render.seen.includes(25) || !render.seen.includes(26)) {
            problems.push(`the banner plates were not drawn (seen ${render.seen})`);
        }
        if (!eq(bandPixels.promptFill, [8, 8, 56])) {
            problems.push(`prompt band fill ${bandPixels.promptFill} != (8,8,56)`);
        }
        if (!eq(bandPixels.promptBorder, [0, 0, 136])) {
            problems.push(`prompt band border ${bandPixels.promptBorder} != (0,0,136)`);
        }
        if (!eq(bandPixels.titleBorder, [8, 8, 88])) {
            problems.push(`title band border ${bandPixels.titleBorder} != (8,8,88)`);
        }
    }
    if (state.module === "pro/stitshop") {
        for (const id of [6, 14, 17, 49]) {
            if (!render.seen.includes(id)) problems.push(`shop chrome clip ${id} not drawn (seen ${render.seen})`);
        }
        // The shop draws chrome from STSHOPCS (LBA 1026 -> stshop) and item icons
        // from CMFONTCS (LBA 646 -> cmfont); both must route (resolver override).
        if (!render.byPack.stshop) problems.push(`no stshop clips (byPack ${JSON.stringify(render.byPack)})`);
        if (!render.byPack.cmfont) problems.push(`no cmfont clips (byPack ${JSON.stringify(render.byPack)})`);
        for (const id of [74, 85]) {
            if (!render.seen.includes(id)) problems.push(`item icon clip ${id} not drawn (seen ${render.seen})`);
        }
        if (render.clips < 300) problems.push(`clips=${render.clips} (<300)`);
    }
    if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
    if (problems.length) {
        console.error(`FAIL native screen render:\n- ${problems.join("\n- ")}`);
        process.exitCode = 1;
    } else {
        console.log(
            `PASS native screen render: ${state.module} frames=${state.frames} clips=${render.clips} cards=${render.cards} ` +
                `skipped=${render.skipped} byPack=${JSON.stringify(render.byPack)} ` +
                (pictureEmpty ? `picture-empty text widgets=${(widgets ?? []).length} ` : "") +
                `seen=[${render.seen.join(",")}]; shot ${OUT}/native-screen-render.png`,
        );
    }
} finally {
    await browser.close();
}
