// Focused production-route verifier for the native Card Album (pro/stcrdabm,
// Phase 6.3 group 2 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// Runs the real web/game.js, opens the album through the lab entry point, and
// drives the shipped pro/stcrdabm overlay with real key events. It asserts:
//   * the native overlay booted (module pro/stcrdabm), 0 traps, bridge active;
//   * the walker's collection reached the screen's own collection table
//     (0x80048d34 + 0x4DF + card);
//   * Triangle leaves and control returns to the game.
//
//   .opencode/autonomy/check-browser tools/verify_native_album.mjs
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.ALBUM_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.ALBUM_SHOT || "/tmp/opencode/native-album-verify";
mkdirSync(OUT, { recursive: true });

const SAVE = 0x80048d34;
const CARD_SEEN = SAVE + 0x4df;
// Three owned cards the album must show as collected.
const OWNED = [1, 5, 42];

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
const resourceMisses = [];
page.on("pageerror", (e) => { pageErrors.push(`pageerror: ${e.message}`); });
page.on("response", (r) => { if (r.status() >= 400) resourceMisses.push(`${r.status()} ${r.url()}`); });
page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (text.includes("Failed to load resource")) return;
    pageErrors.push(`console: ${text}`);
});

await page.addInitScript((owned) => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p003pken");
    localStorage.setItem("party", JSON.stringify(["p003pken"]));
    localStorage.setItem("bits", "1000");
    // The walker's card collection: owned is [id, count] pairs, seen is the
    // ever-obtained list the album's table mirrors.
    localStorage.setItem("cardCollection", JSON.stringify({
        owned: owned.map((id) => [id, 1]),
        seen: [...owned],
        folders: [],
        activeFolder: 0,
        packs: [],
    }));
}, OWNED);

await page.goto(`${ROOT}?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 30000 });
await page.waitForFunction(() => window.__state?.started && typeof window.__labOpen === "function", { timeout: 40000 });
console.log("[verify] game booted");

// The native screen samples the pad's held word once per frame, so a key must
// stay down across at least one game frame.
const hold = async (key, ms = 260) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(160);
};

await page.evaluate(() => window.__labOpen("cardalbum"));
await page.waitForFunction(() => window.__cardAlbumNative?.isOpen?.() === true, { timeout: 15000 });
// Let the overlay preload + boot.
await page.waitForFunction(() => {
    const d = window.__cardAlbumNative?.diagnostics?.();
    return d?.host?.module === "pro/stcrdabm" || (d && !d.pending && d.host);
}, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1200);

let diag = await page.evaluate(() => window.__cardAlbumNative?.diagnostics?.() ?? null);
console.log("[verify] album:", JSON.stringify(diag?.host ? {
    module: diag.host.module, traps: diag.host.traps, objects: diag.host.objects,
    frames: diag.host.frames, bridge: diag.host.bridgeEnabled,
    methods: diag.host.methods,
} : diag));
check("album opens through game.js", diag?.open === true, `open=${diag?.open}`);
check("native root booted", diag?.host?.module === "pro/stcrdabm", `module=${diag?.host?.module}`);
check("no traps on entry", (diag?.host?.traps ?? -1) === 0, `traps=${diag?.host?.traps}`);
check("bridge active on the album", !!diag?.host?.bridgeEnabled, `bridge=${diag?.host?.bridgeEnabled}`);
check("screen allocated objects", (diag?.host?.objects ?? 0) > 0, `objects=${diag?.host?.objects}`);

// The walker's collection reached the screen's own collection table.
const seenBytes = await page.evaluate(([base, ids]) =>
    ids.map((id) => window.__nativeScreenRead(base + id, 1)), [CARD_SEEN, OWNED]);
check("collection table carries the owned cards",
    seenBytes.every((b) => b === 1), `bytes=${JSON.stringify(seenBytes)}`);
const unownedByte = await page.evaluate((base) => window.__nativeScreenRead(base + 200, 1), CARD_SEEN);
check("an unowned card stays clear", unownedByte === 0, `byte=${unownedByte}`);

writeFileSync(`${OUT}/01-album.png`, await page.screenshot());

// Leave. The screen's own cancel check is word bit 0x4000 = BACK, which the
// walker's one pad map reaches with Escape or x (engine/systems/input-map.ts
// `padWordButton`, commit 173ebcf0). `c` is the confirm bit now, so pressing it
// only confirmed rows and the screen stayed up.
for (let i = 0; i < 6; i++) {
    const stillOpen = await page.evaluate(() => window.__cardAlbumNative?.isOpen?.() === true);
    if (!stillOpen) break;
    await hold("x", 320);
    await page.waitForTimeout(500);
}
await page.waitForFunction(() => window.__cardAlbumNative?.isOpen?.() === false, { timeout: 15000 })
    .catch(() => {});
await page.waitForTimeout(400);
const closed = await page.evaluate(() => window.__cardAlbumNative?.isOpen?.() === false);
check("Back closes the album", closed, `open=${!closed}`);
check("no uncaught page errors during the route", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
if (resourceMisses.length) console.log(`[verify] note: ${resourceMisses.length} resource miss(es), e.g. ${resourceMisses[0]}`);

writeFileSync(`${OUT}/02-after.png`, await page.screenshot());

await browser.close();
console.log(failures === 0 ? "\nverify_native_album: OK" : `\nverify_native_album: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
