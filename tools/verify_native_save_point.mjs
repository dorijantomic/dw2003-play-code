// Focused proof that the save screen carries the decoded SAVE-POINT place
// (engine/dw3/save-points.ts) rather than name-matching the walker's map title.
//
// The original's save-point events end in `HANDOFF 0xC00|slot`; the resident
// launcher loads pro/stgmcard with that slot, and the saved record shows
// `esshpnam[42 + slot]`. web/game.js passes that place index straight into the
// record, so standing on a save-point map and saving must write the exact index
// — the decisive assertion is the stored record's `placeIndex`.
//
// This runs the REFERENCE route (`?nativeSave=1`, the shipped overlay through the
// interpreter) because it reads the overlay's own host and its drawn text
// (`diagnostics().host.traps`, `__nativeScreenTextDump`), neither of which the
// translated MemcardSession publishes. It ran on the ordinary route until
// 2026-10-03, where the host reads came back `undefined` and the slot was still
// empty — the translated screen commits on CLOSE, not on the write.
//
// The place index is not a native-route-only fact: `openMemoryCard` (web/game.js)
// resolves the map's save point and hands `placeIndex` to whichever screen is
// mounted, so this proves the same plumbing the translated screen is given. The
// index table itself is pinned by tests/save-points.test.js.
//
//   tools/run-playwright.sh tools/verify_native_save_point.mjs [outdir]
//
// Setup: `python3 -m http.server 8742 --directory web`, VERIFY_PORT set.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitCardText } from "./memcard-continue.mjs";

const BASE = `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&nativeSave=1`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-save-point-verify";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

async function press(key, waitMs = 900) {
    await page.keyboard.down(key);
    await page.waitForTimeout(80);
    await page.keyboard.up(key);
    await page.waitForTimeout(waitMs);
}

await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
console.log("[verify] game booted");

// Stand on a real save-point map (s235 Asuka Inn, slot 1).
async function standOn(stageId) {
    const idx = await page.evaluate(
        (id) => window.__state.manifest.maps.findIndex((m) => m.id === id),
        stageId,
    );
    if (idx < 0) throw new Error(`manifest has no ${stageId}`);
    await page.evaluate((i) => window.__setMap(i), idx);
    await page.waitForFunction((id) => window.__mapInfo?.().id === id, stageId, { timeout: 30000 });
}
await standOn("s235");
const mapId = await page.evaluate(() => window.__mapInfo().id);
check("the walker is standing on s235", mapId === "s235", `map=${mapId}`);

await page.evaluate(() => {
    const s = window.__state;
    s.playerName = "KAI";
    s.bits = 4242;
    s.party = ["p006agum", "p009rena"];
    s.partyStats = [{ level: 7, xp: 100 }, { level: 5, xp: 50 }];
    s.playSeconds = 300;
    for (const i of [0, 1, 2]) localStorage.removeItem(`mcardSlot${i}`);
    localStorage.removeItem("mcardLastSlot");
});
await page.evaluate(() => window.__labOpen("save"));
// `isOpen()` is true before the overlay's root exists (web/save-native.js
// boots it once the executable assets are in), so wait for the host itself
// rather than for a fixed delay.
await page.waitForFunction(() => window.__saveNative?.diagnostics?.()?.host != null,
    null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);

let diag = await page.evaluate(() => window.__saveNative.diagnostics?.() ?? null);
check("the native save screen opened through the real game", diag?.open === true);
check("no traps on entry", (diag?.host?.traps ?? -1) === 0);
await page.screenshot({ path: `${OUT}/01-slot-chooser.png` });

// slot chooser -> card check -> file card -> overwrite prompt -> write
await press("Enter", 2000);
await page.screenshot({ path: `${OUT}/02-file-card.png` });
await press("Enter", 1500);
await press("Enter", 2500);

const result = await page.evaluate(() => {
    const d = window.__saveNative.diagnostics?.() ?? null;
    const pick = d?.savedSlot ?? 0;
    const raw = localStorage.getItem(`mcardSlot${pick}`);
    let slot = null;
    try { slot = raw ? JSON.parse(raw) : null; } catch { /* keep null */ }
    return { diag: d, slot };
});
// The committed card is drawn a frame or two after the write lands, and the
// overlay route publishes no window id to poll, so read the text at the first
// frame that shows the place name instead of one arbitrary frame.
const asukaText = await waitCardText(page, "Asuka Inn");

check("the save wrote a slot", result.slot?.record != null);
check(
    "the record's place index is the decoded save-point index (43 = Asuka Inn)",
    result.slot?.record?.placeIndex === 43,
    `placeIndex=${result.slot?.record?.placeIndex}`,
);
check(
    "the committed card draws the save-point name",
    asukaText.includes("Asuka Inn"),
    asukaText.slice(0, 200),
);
check("no traps through the write", (result.diag?.host?.traps ?? -1) === 0,
    `traps=${result.diag?.host?.traps}`);
await page.screenshot({ path: `${OUT}/03-saved-place.png` });

// The mapping must be per-map, not a constant: the same flow on s506 (Zhu Que
// Inn, slot 13) writes index 55.
await standOn("s506");
await page.evaluate(() => window.__labOpen("save"));
// `isOpen()` is true before the overlay's root exists (web/save-native.js
// boots it once the executable assets are in), so wait for the host itself
// rather than for a fixed delay.
await page.waitForFunction(() => window.__saveNative?.diagnostics?.()?.host != null,
    null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);
await press("Enter", 2000);        // chooser -> file card
await press("Enter", 1500);        // overwrite prompt
await press("Enter", 2500);        // write
const zhu = await page.evaluate(() => {
    const d = window.__saveNative.diagnostics?.() ?? null;
    const pick = d?.savedSlot ?? 0;
    const raw = localStorage.getItem(`mcardSlot${pick}`);
    let slot = null;
    try { slot = raw ? JSON.parse(raw) : null; } catch { /* keep null */ }
    return { slot, traps: d?.host?.traps ?? -1 };
});
const zhuText = await waitCardText(page, "Zhu Que Inn");
check(
    "s506 writes its own save-point index (55 = Zhu Que Inn)",
    zhu.slot?.record?.placeIndex === 55,
    `placeIndex=${zhu.slot?.record?.placeIndex}`,
);
check("the s506 card draws Zhu Que Inn", zhuText.includes("Zhu Que Inn"),
    zhuText.slice(0, 200));
check("no traps through the s506 write", zhu.traps === 0, `traps=${zhu.traps}`);
await page.screenshot({ path: `${OUT}/04-zhuque-place.png` });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await page.close();
await browser.close();
process.exit(failures === 0 ? 0 : 1);
