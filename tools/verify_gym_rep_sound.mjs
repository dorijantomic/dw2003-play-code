// Which sample the training gym's rep cues actually reach in the browser.
//
// The rep that CONNECTED plays packed 0x840001 and the rep that MISSED plays
// 0x840000 (engine/dw3/ui/native/gym-training.ts:275 and :421, from
// pro/stgtrain.s 0x4550/0x4564). Both address archive 33 -- the train bank
// bgm031 -- and the disc's own Sound Test names them TRAIN_OK / TRAIN_NG
// (docs/research/audio/soundtst-categories.json, category 32). The one packed
// lookup in web/packed-sound.js answers them out of the extracted per-bank
// list, so the trace below names the sample the browser fetched, not a stem a
// screen chose.
//
// Both ids are bit-31-CLEAR, so they are PHRASES of bgm031's own score rather
// than one flat sample each (sound-system.md, "An area-bank sound is a PHRASE of
// that bank's own score"): TRAIN_OK is bgm031 slot 1 and TRAIN_NG is slot 0. The
// browser therefore fetches the VAG samples their NOTES are built from, out of
// web/sfx-voice/, and plays one voice per note-on -- which is what this check
// looks for, with the sample names read out of web/sfx-voice/phrases.json rather
// than written here.
//
//   python3 -m http.server 8896 --directory web
//   VERIFY_PORT=8896 tools/run-playwright.sh tools/verify_gym_rep_sound.mjs

import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const TABLE = JSON.parse(readFileSync("web/sfx-voice/phrases.json", "utf8"));
/** The note-sample files a cue is built from, from the generated note table. */
const cueSamples = (bank, name) =>
  [...new Set(TABLE.banks[bank][name].notes.map((n) => TABLE.samples[n.sample].file))];

const BASE = `${baseUrl(8896)}/?skipTitle=1&noEncounters=1`;
let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
const fetched = [];
page.on("request", (r) => {
    if (r.url().includes("/assets/sfx/") || r.url().includes("/sfx-voice/")) fetched.push(r.url());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text()))
        errors.push(`console: ${m.text()}`);
});
// The trace records every sample name the packed lookup resolves to.
await page.addInitScript(() => { globalThis.__sfxTrace = new Set(); });
await page.route("**/assets/native/**", (route) => route.abort());
await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });

const press = async (key, wait = 400) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(110);
    await page.keyboard.up(key);
    await page.waitForTimeout(wait);
};
const diag = () => page.evaluate(() => window.__gym.diagnostics());
const waitFor = async (fn, what, timeout = 40000) => {
    try { await page.waitForFunction(fn, null, { timeout, polling: 100 }); return true; }
    catch { check(`wait: ${what}`, false, JSON.stringify((await diag()).state)); return false; }
};

// A single Kotemon with 30 TP; the greeter's rank group 3.
await page.evaluate(() => {
    const s = window.__state;
    s.bits = 5000;
    s.party = ["p003pken"];
    s.partnerStats = {
        digimonId: 1, level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25,
        stats: { str: 11, def: 12, spt: 13, wis: 14, spd: 15, chr: 16 }, elemBonuses: {},
    };
    s.partyStats = [null];
    s.inventory = [{ id: 40, qty: 1 }];
    localStorage.removeItem("partnerStats");
});

await page.evaluate(() => window.__gym.open(window.__state, null, 3, 573));
await waitFor(() => window.__gym.diagnostics().state?.flow === 5, "the pod select");
await press("Enter", 300);                                  // pick the partner
await waitFor(() => { const s = window.__gym.diagnostics().state; return s && s.picker !== 0; }, "the drill list");
await page.waitForTimeout(1800);
await press("Enter", 300);                                  // first drill (STR)
await waitFor(() => { const s = window.__gym.diagnostics().state; return s && s.confirm !== 0; }, "the confirm panel");
await page.waitForTimeout(2500);
await press("Enter", 300);                                  // TP 1
await page.waitForTimeout(2500);
await press("Enter", 300);                                  // Yes
await waitFor(() => window.__gym.diagnostics().state?.session !== 0, "the training window");
await page.waitForTimeout(6000);
for (let i = 0; i < 180; i++) {
    const step = (await diag()).training?.step;
    if (step === 6) break;
    if (step === 5) await press("Enter", 400); else await page.waitForTimeout(700);
}
const reps = (await diag()).training?.results ?? [];
const trace = await page.evaluate(() => [...(globalThis.__sfxTrace ?? [])]);
console.log("rep results:", JSON.stringify(reps));
console.log("sfx trace:", JSON.stringify(trace.filter((t) => t.includes("train") || t.startsWith("system"))));

check("the workout ran and at least one rep connected", reps.some((r) => r === 1), JSON.stringify(reps));
check("the connected rep played the train bank's own TRAIN_OK sample",
    trace.includes("bgm031:train_ok"), `trace=${JSON.stringify(trace)}`);
// A 2D cue is a score, so the browser fetches the samples its NOTES play, not
// one stream per cue. TRAIN_OK is one note on bgm031's VAG field 14.
check("the browser fetched that cue's own note sample out of the per-note table",
    cueSamples("bgm031", "train_ok").every((f) => fetched.some((u) => u.endsWith(`/sfx-voice/${f}`))),
    `want=${JSON.stringify(cueSamples("bgm031", "train_ok"))} `
    + `sfx requests=${JSON.stringify([...new Set(fetched.map((u) => u.split("/").slice(-2).join("/")))])}`);
// A MISSED rep plays 0x840000 = TRAIN_NG, bgm031 slot 0. It used to fall back to
// a borrowed common-bank row because the shared asset tree had no sample for it;
// as a phrase of its own archive's score it needs no flat sample at all. Say which
// row answered, so nobody reads this as a second gap if the trace ever loses it.
const missed = reps.filter((r) => r === 0).length;
if (missed)
    console.log(`NOTE ${missed} rep(s) missed: 0x840000 answered with `
        + `${trace.includes("bgm031:train_ng") ? "bgm031:train_ng, its own score's slot 0"
          : trace.includes("system02") ? "the borrowed system02" : "?"}`);
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
console.log(failures ? `[verify] ${failures} FAIL` : "[verify] ALL PASS");
process.exit(failures ? 1 : 0);