// Focused production-route verifier for the native Card Folder editor
// (pro/stcrddek, Phase 6.3 group 2 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// Runs the real web/game.js, opens the folder editor through the lab entry
// point, and drives the shipped pro/stcrddek overlay with real key events. It
// asserts:
//   * the native overlay booted (module pro/stcrddek), 0 traps, bridge active;
//   * the walker's three folders reached the screen's own folder records
//     (0x8004935C + f*0x66: name at +0, 40 u16 card ids at +0x16);
//   * the editor's own input works (Cross opens the submenu);
//   * Back closes it and the records are read back into the walker's collection.
//
//   .opencode/autonomy/check-browser tools/verify_native_deck.mjs
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.DECK_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.DECK_SHOT || "/tmp/opencode/native-deck-verify";
mkdirSync(OUT, { recursive: true });

const FOLDER_BASE = 0x8004935c;
const FOLDER_STRIDE = 0x66;
const CARDS_OFF = 0x16;
// The walker's starter deck: 40 ids, all three folders.
const STARTER = Array.from({ length: 40 }, (_, i) => i + 1);

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

await page.addInitScript((starter) => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p003pken");
    localStorage.setItem("party", JSON.stringify(["p003pken"]));
    localStorage.setItem("bits", "1000");
    localStorage.setItem("cardCollection", JSON.stringify({
        owned: starter.map((id) => [id, 1]),
        seen: [...starter],
        folders: [
            { name: "Alpha", cards: starter.slice() },
            { name: "Beta", cards: starter.slice() },
            { name: "Gamma", cards: starter.slice() },
        ],
        activeFolder: 0,
        packs: [],
    }));
}, STARTER);

await page.goto(`${ROOT}?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 30000 });
await page.waitForFunction(() => window.__state?.started && typeof window.__labOpen === "function", { timeout: 40000 });
console.log("[verify] game booted");

// The native screen samples the pad's held word once per frame.
const hold = async (key, ms = 280) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(180);
};

await page.evaluate(() => window.__labOpen("carddeck"));
await page.waitForFunction(() => window.__cardDeckNative?.isOpen?.() === true, { timeout: 15000 });
await page.waitForFunction(() => {
    const d = window.__cardDeckNative?.diagnostics?.();
    return d?.host?.module === "pro/stcrddek" || (d && !d.pending && d.host);
}, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1200);

let diag = await page.evaluate(() => window.__cardDeckNative?.diagnostics?.() ?? null);
console.log("[verify] editor:", JSON.stringify(diag?.host ? {
    module: diag.host.module, traps: diag.host.traps, objects: diag.host.objects,
    frames: diag.host.frames, bridge: diag.host.bridgeEnabled,
} : diag));
check("folder editor opens through game.js", diag?.open === true, `open=${diag?.open}`);
check("native root booted", diag?.host?.module === "pro/stcrddek", `module=${diag?.host?.module}`);
check("no traps on entry", (diag?.host?.traps ?? -1) === 0, `traps=${diag?.host?.traps}`);
check("bridge active on the editor", !!diag?.host?.bridgeEnabled, `bridge=${diag?.host?.bridgeEnabled}`);
check("screen allocated objects", (diag?.host?.objects ?? 0) > 0, `objects=${diag?.host?.objects}`);

// The walker's folder records reached the screen.
const records = await page.evaluate(([base, stride, off, n]) => {
    const rd = (a, s) => window.__nativeScreenRead(a, s) >>> 0;
    const out = [];
    for (let f = 0; f < 3; f++) {
        const rec = base + f * stride;
        const nameBytes = [];
        for (let i = 0; i < 10; i++) { const b = rd(rec + i, 1); if (b === 0) break; nameBytes.push(b); }
        const cards = [];
        for (let i = 0; i < n; i++) cards.push(rd(rec + off + i * 2, 2));
        out.push({ nameBytes, cards });
    }
    return out;
}, [FOLDER_BASE, FOLDER_STRIDE, CARDS_OFF, 40]);
const names = records.map((r) => r.nameBytes.join(","));
console.log("[verify] folder records:", JSON.stringify(records.map((r) => ({ name: r.nameBytes.length, first: r.cards[0], last: r.cards[39] }))));
check("all three folder records seeded", records.every((r) => r.nameBytes.length > 0 && r.cards.length === 40),
    `names=${JSON.stringify(names)}`);
check("folder card ids seeded in order",
    records.every((r) => r.cards[0] === 1 && r.cards[39] === 40),
    `first/last=${records.map((r) => `${r.cards[0]}/${r.cards[39]}`).join(" ")}`);
check("folder names differ per folder",
    new Set(records.map((r) => r.nameBytes.join(","))).size === 3, JSON.stringify(names));

writeFileSync(`${OUT}/01-editor.png`, await page.screenshot());

// The editor's own input: Cross opens the submenu (state advances).
await hold("Enter");
const stateAfter = await page.evaluate(() => window.__nativeScreenRead(0x800b0000 + 0x10, 4));
check("Cross advances the folder editor", stateAfter !== 4, `state=${stateAfter}`);

// Back out and leave. BACK is word bit 0x4000, which the one pad map reaches
// with Escape or x (engine/systems/input-map.ts `padWordButton`, commit
// 173ebcf0); `c` is the confirm bit, so the old press only re-confirmed a row.
for (let i = 0; i < 6; i++) {
    const stillOpen = await page.evaluate(() => window.__cardDeckNative?.isOpen?.() === true);
    if (!stillOpen) break;
    await hold("x", 300);
    await page.waitForTimeout(400);
}
await page.waitForFunction(() => window.__cardDeckNative?.isOpen?.() === false, { timeout: 15000 })
    .catch(() => {});
await page.waitForTimeout(400);
const closed = await page.evaluate(() => window.__cardDeckNative?.isOpen?.() === false);
check("Back closes the folder editor", closed, `open=${!closed}`);

// The close-time read-back kept the walker's folders intact.
const afterFolders = await page.evaluate(() => {
    const col = window.__cards?.();
    return (col?.folders ?? []).map((f) => ({ name: f.name, n: f.cards?.length ?? 0, first: f.cards?.[0], last: f.cards?.[39] }));
});
console.log("[verify] folders after close:", JSON.stringify(afterFolders));
check("read-back kept three folders with 40 cards each",
    afterFolders.length === 3 && afterFolders.every((f) => f.n === 40), JSON.stringify(afterFolders));
check("read-back kept the names", afterFolders.map((f) => f.name).join(",") === "Alpha,Beta,Gamma",
    afterFolders.map((f) => f.name).join(","));

check("no uncaught page errors during the route", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
if (resourceMisses.length) console.log(`[verify] note: ${resourceMisses.length} resource miss(es), e.g. ${resourceMisses[0]}`);

writeFileSync(`${OUT}/02-after.png`, await page.screenshot());

await browser.close();
console.log(failures === 0 ? "\nverify_native_deck: OK" : `\nverify_native_deck: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
