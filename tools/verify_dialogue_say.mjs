// Browser proof that cutscene SAY lines use the translated conversation box with the original ESDMG bytes.
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_dialogue_say.mjs [outdir]
// Case 1: the s200 PRE event (esdmg200 entry 11): three balloon SAY lines, then the cutscene finishes.
// Case 2: the s415 event 01350004 (esdmg400 entry 4): balloons plus one mode-4 plain window, in one cutscene.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = `${baseUrl(8742)}`;
const OUT = process.argv[2] ?? "captures/step-g-dialogue-say-2026-10-01";
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); if (!ok) failures++; };

const browser = await chromium.launch();
const errors = [];

async function playCase(label, map, flagKey, expectPlain, ordinal) {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((ord) => {
        try {
            localStorage.setItem("assetMode", "authentic");
            // Without this the one-time save reset in init() (web/game.js:1358) wipes the
            // story ordinal below before the game reads it.
            localStorage.setItem("engineSchema", "2");
            // s200's PRE is the story beat at master ordinal 3 (web/assets/data/auto_event_gates.json:
            // event 50 is gated 0x6003 == 1, and bank-0x60NN is the ordinal — docs/research/field/
            // rig-stage-anchoring-2026-09-11.md:69). Ordinal 3 is also the stage whose cast list
            // builds the player as charId 1, so the script's actor 1 IS the player and its SAY line
            // is a balloon (wstag-script-decode.md:136). Booting at ordinal 0 would play a beat the
            // original has not reached yet, with the player built as actor 2.
            if (ord != null) localStorage.setItem("progressOrdinal", String(ord));
        } catch { /* blocked */ }
    }, ordinal ?? null);
    await page.goto(`${ROOT}/?skipTitle=1&map=${map}&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    const events = await page.evaluate(async () => (await (await fetch("assets/events/wstag_events.json")).json()));
    const ev = events[map].find((e) => e.flag_key === flagKey);
    const sayOps = ev.disasm.filter((l) => l.startsWith("SAY ")).length;
    const plainOps = ev.disasm.filter((l) => /^SAY \d+ \d+ \d+ 4$/.test(l)).length;
    // s200's PRE already runs on entry; for the other case start the event by hand.
    if (flagKey !== "0112000b") await page.evaluate((e) => { window.__playStoryEvent(e, () => {}); }, ev);
    await page.evaluate(() => { window.__gameSpeed = 4; });
    const kinds = new Set();
    let opens = 0, shot = 0, wasOpen = false, plainShot = false, done = false;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        const st = await page.evaluate(() => {
            const d = window.__dialogueBox.diagnostics();
            return { open: d.open, child: d.state?.child ?? null, ticks: d.ticks, cs: window.__cutscene.isActive(), fails: d.failed, battle: !!window.__battle?.isActive?.(), closes: d.closes };
        });
        if (st.child) kinds.add(st.child);
        if (st.open && !wasOpen) opens++;
        wasOpen = st.open;
        if (st.fails) break;
        if (st.open && st.ticks > 120) {
            if (st.child === "dialogue balloon" && shot < 1) { shot++; await page.locator("canvas").first().screenshot({ path: `${OUT}/${label}-balloon.png` }); }
            if (st.child === "dialogue plain window" && !plainShot) { plainShot = true; await page.locator("canvas").first().screenshot({ path: `${OUT}/${label}-plain.png` }); }
            await page.keyboard.press("Enter");
        }
        if (!st.cs && !st.open && opens > 0) { done = true; break; }
        if (st.battle) { done = true; break; }
        await page.waitForTimeout(60);
    }
    const final = await page.evaluate(() => ({ closes: window.__dialogueBox.diagnostics().closes, failed: window.__dialogueBox.diagnostics().failed, error: window.__dialogueBox.diagnostics().error }));
    check(`${label}: translated balloon drew the SAY lines`, kinds.has("dialogue balloon") && !final.failed, JSON.stringify({ kinds: [...kinds], err: final.error }));
    if (expectPlain) check(`${label}: mode-4 SAY used the plain window`, kinds.has("dialogue plain window") && plainOps > 0, `plainOps=${plainOps}`);
    check(`${label}: every SAY opened and closed one box`, opens === sayOps && final.closes === sayOps, `opens=${opens} closes=${final.closes} SAY ops=${sayOps}`);
    check(`${label}: the cutscene finished`, done);
    await page.close();
}

await playCase("s200-pre", "s200", "0112000b", false, 3);
await playCase("s415-event", "s415", "01350004", true, null);
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);
