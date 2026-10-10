// Focused production-route verifier for the native starter-pack wizard
// (Phase 6.3 group 3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// Runs the real web/game.js opening on map s785 (the registration hand-off). The
// registration wizard runs TRANSLATED code in ordinary play; this check drives the
// original-code overlay, so it asks for it with ?nativePack=1 (web/game.js
// `USE_REFERENCE_PACK`). Its three steps, with real keys:
//   1. the account-name keyboard: navigate to its END cell (row 6, col 13) and
//      confirm -> name panel +0x10 == 0x64
//   2. "Choose a Starter Pack": confirm -> pack panel +0x10 == 0x64
//   3. "Register account?" YES -> the commit (pack id 0x8004B374)
// and asserts the walker consumed the committed pack index. The ordinary
// translated route is proven by tools/verify_opening_pack.mjs.
//
//   tools/run-playwright.sh tools/verify_native_packselect.mjs [outdir]
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = `${baseUrl(8742)}`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-packselect-verify";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch();

const read = (page) => page.evaluate(() => {
    const R = (a, s = 4) => window.__nativeScreenRead(a, s) >>> 0;
    const objs = window.__nativeScreenObjects();
    const root = objs.find((o) => (o.cb >>> 0) === 0x80088138);
    const diag = window.__packSelectNative?.diagnostics?.() ?? null;
    const out = {
        open: !!window.__state.packSelect,
        diag,
        packId: window.__state.packId ?? null,
        pending: window.__state.pendingParty ?? null,
        root: null, panels: null, cursor: null,
    };
    if (!root) return out;
    const arr = R(root.addr + 0x24);
    const panel = (i) => { const p = R(arr + i * 4); return p ? { st: R(p + 0x10), sel: R(p + 0x6c) } : null; };
    out.root = { lc: R(root.addr + 0xc), sub: R(root.addr + 0x10), sel: R(root.addr + 0x14) };
    out.panels = { name: panel(1), pack: panel(2), confirm: panel(3) };
    const ne = R(arr + 4);
    out.cursor = ne ? { col: R(ne + 0x98), row: R(ne + 0x9c) } : null;
    return out;
});

async function press(page, key, ms = 180) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(150);
}

async function openOpening(page, legacy) {
    // Keep the walker's first-run "Choose Visual Style" modal out of the captures.
    await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
    const url = `${ROOT}/?skipTitle=1&map=s785&noEncounters=1${legacy ? "&legacyPack=1" : "&nativePack=1"}`;
    if (!legacy && process.env.OPENING_FULL_BOOT === "1") {
        await page.goto(`${ROOT}/?noEncounters=1&nativeTitle=1&nativePack=1`, { waitUntil: "load", timeout: 60000 });
        await page.waitForFunction(() => window.__cntyselNative?.isOpen?.() === true,
            null, { timeout: 30000 });
        await page.waitForTimeout(1800);
        await press(page, "i", 180);
        await page.waitForFunction(() => window.__titleState?.().diagnostics?.()?.host?.module === "pro/stdwtitl",
            null, { timeout: 30000 });
        await page.waitForFunction(() => (window.__titleState?.().diagnostics?.()?.host?.frames ?? 0) >= 240,
            null, { timeout: 30000 });
        await press(page, "i", 160);
        await page.waitForTimeout(800);
        await press(page, "ArrowUp", 140);
        await press(page, "Enter", 160);
    } else {
        await page.goto(url, { waitUntil: "load", timeout: 60000 });
    }
    await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
    await page.evaluate(() => { window.__gameSpeed = 8; });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        if (await page.evaluate(() => !!window.__state.packSelect)) break;
        await press(page, "Enter", 120);
    }
}

// ── before: the hand-authored wizard under the rollback switch ──────────────
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openOpening(page, true);
    const s = await read(page);
    check("legacy rollback keeps the walker's wizard", s.diag?.host?.module !== "pro/stplnmet",
        `module=${s.diag?.host?.module ?? "walker"}`);
    await page.screenshot({ path: `${OUT}/before-legacy-wizard.png` });
    console.log("[verify] legacy wizard captured");
    await page.close();
}

// ── after: the shipped wizard through the ordinary opening ──────────────────
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
});

await openOpening(page, false);
// The overlay is fetched and booted asynchronously after the hand-off raises the
// adapter, so wait for the host before reading its module and trap count. Reading
// them on the first frame after `state.packSelect` appeared saw `module=none`.
await page.waitForFunction(() => window.__packSelectNative?.diagnostics?.()?.host?.module != null,
    null, { timeout: 30000 });
let s = await read(page);
check("the ordinary opening opens the pack wizard", s.open === true);
check("the shipped pro/stplnmet overlay is the wizard", s.diag?.host?.module === "pro/stplnmet",
    `module=${s.diag?.host?.module ?? "none"} pending=${s.diag?.pending}`);
check("no traps on entry", (s.diag?.host?.traps ?? -1) === 0, `traps=${s.diag?.host?.traps}`);

// The intro text pauses on the codec's pause tokens and is advanced with
// confirm; press until the name keyboard is live.
for (let i = 0; i < 120; i++) {
    s = await read(page);
    if (s.root?.sub === 2 && s.panels?.name?.st === 2) break;
    if (s.root?.sub !== 2) await press(page, "Enter", 200);
    else await page.waitForTimeout(250);
}
check("the name keyboard is live (step 1)", s.panels?.name?.st === 2, `name=${s.panels?.name?.st}`);
await page.evaluate(() => { window.__gameSpeed = 1; });
console.log("[verify] keyboard text widgets:", JSON.stringify(await page.evaluate(async () => {
    const ns = await import('/native-screen.js');
    return ns.nativeTextWidgets().filter(w => w.visible).map(w => ({
        font: w.font.toString(16), x: w.penX, y: w.penY, fixed: w.fixedPitch,
        width: w.cellWidth, height: w.lineHeight,
    }));
})));
// Change the default Junior to Aunior with a real keyboard press.
await press(page, "Enter", 90);
await page.screenshot({ path: `${OUT}/01-name-keyboard.png` });
const buttonPalettes = () => page.evaluate(async () => {
    const ns = await import('/native-screen.js');
    const host = window.__packSelectNative._host;
    let row = 0;
    const resets = new Set(host.rt.ctxMarkers);
    return host.rt.drawCalls.flatMap((c, i) => {
        if (resets.has(i)) row = 0;
        if (c.method === 'm_0x88') row = c.args[0];
        return c.method === 'drawSprite' && ns.nativeScreenPackNameForDir(c.args[0]) === 'namedt'
            && [44,45,62,70,78].includes(c.args[1])
            ? [{ clip: c.args[1], row }] : [];
    });
});
console.log('[verify] resting buttons:', JSON.stringify(await buttonPalettes()));
check('the resting button palette artwork is available', await page.evaluate(async () => {
    const j = await (await fetch('/assets/ui/namedt_sheet.json')).json();
    return [44,45,62,70,78].every(id => !!j[`${id}#4`]);
}));

// Step 1: navigate to the END cell (row 6, col 13) and confirm.
for (let i = 0; i < 24 && (await read(page)).cursor?.col !== 13; i++) await press(page, "ArrowRight");
for (let i = 0; i < 12 && (await read(page)).cursor?.row !== 6; i++) await press(page, "ArrowDown");
s = await read(page);
check("the keyboard cursor reached the END cell", s.cursor?.col === 13 && s.cursor?.row === 6,
    `cursor=${JSON.stringify(s.cursor)}`);
console.log('[verify] selected OK:', JSON.stringify(await buttonPalettes()));
await page.screenshot({ path: `${OUT}/selected-ok.png` });
await press(page, "Enter", 250);
await page.waitForTimeout(900);
s = await read(page);
check("step 1 completes (name panel ready)", s.panels?.name?.st === 0x64 || s.root?.sel === 1,
    `name=${s.panels?.name?.st} sel=${s.root?.sel}`);
await page.screenshot({ path: `${OUT}/02-name-accepted.png` });
// Wait for the live pack list, then capture all three choices before accepting.
await page.waitForFunction(() => {
    const rd = window.__nativeScreenRead;
    const root = window.__nativeScreenObjects().find(o => o.cb === 0x80088138);
    if (!root) return false;
    const arr = rd(root.addr + 0x24, 4);
    const pack = rd(arr + 8, 4);
    return rd(root.addr + 0x14, 4) === 1 && pack && rd(pack + 0x10, 4) !== 0x64;
}, null, { timeout: 15000 });
for (const letter of ["A", "B", "C"]) {
    await page.waitForTimeout(350);
    const figures = await page.evaluate(async () => {
        const host = window.__packSelectNative._host;
        const ns = await import('/native-screen.js');
        return host.rt.drawCalls.filter(c => c.method === "drawSprite" &&
            ns.nativeScreenPackNameForDir(c.args[0]) === "namedt" &&
            c.args[1] >= 0 && c.args[1] <= 28);
    });
    check(`pack ${letter} draws three Digimon figures`, figures.length === 3, `draws=${figures.length}`);
    await page.screenshot({ path: `${OUT}/pack-${letter}.png` });
    if (letter !== "C") await press(page, "ArrowDown", 90);
}

// Step 2: the pack list.
for (let i = 0; i < 3 && (await read(page)).panels?.pack?.st !== 0x64; i++) {
    await press(page, "Enter", 250);
    await page.waitForTimeout(600);
}
s = await read(page);
check("step 2 completes (pack list ready)", s.panels?.pack?.st === 0x64 || s.root?.sel === 2,
    `pack=${s.panels?.pack?.st} sel=${s.root?.sel}`);
await page.screenshot({ path: `${OUT}/03-pack-list.png` });

// Step 3: "Register account?" YES -> the commit and the walker's grant.
const before = await read(page);
for (let i = 0; i < 6; i++) {
    s = await read(page);
    if (!s.open) break;
    await press(page, "Enter", 250);
    await page.waitForTimeout(800);
}
await page.waitForTimeout(1200);
s = await read(page);
check("the wizard closes after the register confirm", s.open === false);
check("the walker consumed the committed pack index", Number.isInteger(s.diag?.sel) && s.diag.sel >= 0 && s.diag.sel <= 2,
    `sel=${s.diag?.sel} packId=${s.packId} before=${before.root?.sel}`);
check("the walker recorded the granted party", s.packId !== null || Array.isArray(s.pending),
    `packId=${s.packId} pending=${JSON.stringify(s.pending)?.slice(0, 60)}`);
check("no traps through all three steps", (s.diag?.traps ?? s.diag?.host?.traps ?? 0) === 0,
    `traps=${s.diag?.traps ?? s.diag?.host?.traps}`);
await page.screenshot({ path: `${OUT}/04-after-register.png` });
check("the entered account name persists", await page.evaluate(() =>
    window.__state.playerName === "Aunior" && localStorage.getItem("playerName") === "Aunior"));
check("registration does not open a Digimon rename screen", await page.evaluate(() => !window.__state.nameEntry));
check("the selected pack C is preserved", s.packId === "C" &&
    JSON.stringify(s.pending) === JSON.stringify(["p004kogu", "p008giru", "p010pata"]));
await page.evaluate(() => { window.__gameSpeed = 8; });
for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => window.__state.manifest.maps[window.__state.mapIdx].id === "s790")) break;
    await press(page, "Enter", 90);
}
check("registration continues to the Chamber Room with the name intact", await page.evaluate(() =>
    window.__state.manifest.maps[window.__state.mapIdx].id === "s790" &&
    window.__state.playerName === "Aunior" && !window.__state.nameEntry));
await page.screenshot({ path: `${OUT}/05-chamber-room.png` });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await page.close();
await browser.close();
process.exit(failures === 0 ? 0 : 1);
