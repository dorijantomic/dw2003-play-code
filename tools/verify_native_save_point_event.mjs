// Focused proof of the DECODED save-point trigger: the Guardromon save NPC's
// dialogue write opens the memory-card screen in SAVE mode.
//
// The original chain (engine/dw3/save-points.ts):
//   NPC on_close sets flag bank 0x90 -> resident set_flag dispatcher
//   F0x800165ac routes bank 0x90 to start_event (the value word is NOT read)
//   -> the "PREPARE TO SAVE." event -> `HANDOFF 0xC00|slot` -> the resident
//   launcher loads pro/stgmcard in save mode with that slot.
//
// This runs the walker's real route: the wire `__applyStoryFlag(36865, 0)` is
// the exact on_close write s235's Guardromon dialogue state carries
// (web/assets/scenes/s235.json npc 21 state 2: id 36865 = 0x9001, value 0), and
// everything after it — the event bytecode and the handoff — is the real engine.
// The physical dialogue box is the only step not driven here; it is the same
// write. The screen itself is the REFERENCE route (`?nativeSave=1`), because the
// assertions read the overlay's own host and drawn text; it ran on the ordinary
// route until 2026-10-03, where they read `undefined`. The event and the handoff
// are route-independent (the handoff calls `openMemoryCard`, which hands
// `placeIndex` to whichever screen is mounted), so this also covers the
// translated screen's trigger.
//
//   tools/run-playwright.sh tools/verify_native_save_point_event.mjs [outdir]
//
// Setup: `python3 -m http.server 8742 --directory web`, VERIFY_PORT set.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitCardText } from "./memcard-continue.mjs";

const BASE = `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&nativeSave=1`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-save-point-event";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
const story = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
    if (m.text().includes("[STORY]")) story.push(m.text());
});

async function press(key, waitMs = 400) {
    await page.keyboard.down(key);
    await page.waitForTimeout(60);
    await page.keyboard.up(key);
    await page.waitForTimeout(waitMs);
}

await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
console.log("[verify] game booted");

// The skipTitle boot has no downloaded party; the save-point event puppets the
// partner, so seed the same party the lab entries use — a real prerequisite,
// never the assertion's value.
await page.evaluate(() => { window.__labOpen("menu"); window.__labClose(); });
const idx = await page.evaluate(
    () => window.__state.manifest.maps.findIndex((m) => m.id === "s235"),
);
await page.evaluate((i) => window.__setMap(i), idx);
await page.waitForFunction(() => window.__mapInfo?.().id === "s235", null, { timeout: 30000 });
await page.evaluate(() => { window.__gameSpeed = 8; });

// The Guardromon's own on_close write: set_flag(0x9001, 0).
await page.evaluate(() => window.__applyStoryFlag(36865, 0));

// Advance the event's textbox; the handoff at its end must open the screen.
let opened = false;
for (let i = 0; i < 40 && !opened; i++) {
    await press("Enter", 300);
    opened = await page.evaluate(() => window.__saveNative?.isOpen?.() ?? false);
}
const fired = story.find((s) => s.includes("EVENT FIRED") && s.includes("s235")) ?? "";
check("the bank-0x90 write started the s235 save-point event", fired.includes("0112002a"),
    `fired=${story.filter((x) => x.includes("EVENT FIRED")).length} lines=${story.length}`);
check("the event's HANDOFF opened the native save screen", opened);
if (!opened) {
    console.log("[verify] story tail:", story.slice(-4).join(" || "));
    console.log(errors.slice(-5).join("\n"));
    await browser.close();
    process.exit(1);
}
// Fast-forward belongs to reaching the event handoff. Observe and operate the
// card at normal speed, as the other card verifiers do.
await page.evaluate(() => { window.__gameSpeed = 1; });

// `isOpen()` goes true the moment the handoff asks for the card; the overlay's
// root object only exists once web/save-native.js has booted it, and it waits for
// the executable assets to load. Reading the diagnostics on the same tick that
// `open` flips therefore measures the loading state — wait for the host.
await page.waitForFunction(() => window.__saveNative?.diagnostics?.()?.host != null,
    null, { timeout: 60000 }).catch(() => {});
const diag = await page.evaluate(() => window.__saveNative.diagnostics?.() ?? null);
check("the screen booted the shipped pro/stgmcard overlay",
    diag?.host?.booted === true && diag?.host?.module === "pro/stgmcard",
    `module=${diag?.host?.module}`);
check("no traps on the event-opened screen", (diag?.host?.traps ?? -1) === 0,
    `traps=${diag?.host?.traps}`);
await page.screenshot({ path: `${OUT}/01-event-opened.png` });

// Complete the save on the slot chooser -> card check -> file card -> prompt.
await waitCardText(page, "Choose MEMORY CARD slot.");
await press("Enter", 200);
await waitCardText(page, "Save here?");
await page.screenshot({ path: `${OUT}/02-file-card.png` });
await press("Enter", 200);
await waitCardText(page, "Saved.");
await press("Enter", 200);
const saved = await page.evaluate(() => {
    const d = window.__saveNative.diagnostics?.() ?? null;
    const pick = d?.savedSlot ?? 0;
    const raw = localStorage.getItem(`mcardSlot${pick}`);
    let slot = null;
    try { slot = raw ? JSON.parse(raw) : null; } catch { /* keep null */ }
    return { slot, traps: d?.host?.traps ?? -1 };
});
// The committed card is drawn a frame or two after the write lands, and the
// overlay route publishes no window id to poll, so read the text at the first
// frame that shows the place name instead of one arbitrary frame.
const savedText = await waitCardText(page, "Asuka Inn");
check("the event-opened screen wrote the walker's slot", saved.slot?.record != null);
check("the record carries the save point's place index (43 = Asuka Inn)",
    saved.slot?.record?.placeIndex === 43, `placeIndex=${saved.slot?.record?.placeIndex}`);
check("the card draws the save-point name", savedText.includes("Asuka Inn"),
    savedText.slice(0, 200));
check("no traps through the write", saved.traps === 0, `traps=${saved.traps}`);
await page.screenshot({ path: `${OUT}/03-saved.png` });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await page.close();
await browser.close();
process.exit(failures === 0 ? 0 : 1);
