// Browser proof for the translated battle boot loader (pro/wfightmn's root task),
// Step G of docs/plans/2026-09-28-translated-game-completion-plan.md.
//
// The loader draws nothing. Its work is asking the cache for the scene packs,
// uploading them to VRAM, releasing them, waiting for the text banks and retiring
// so the first command list can open. Three runs through the real web/game.js and
// web/battle.js:
//   1. reference: `?nativeWfight=1`, the original-code loader (the "before"). It
//      needs the executable files under assets/native/**.
//   2. ordinary route, no flags, every assets/native/** request denied FROM PAGE
//      LOAD. The loader must run, request the same banks as the reference, upload
//      the strip and the scene atlases, retire, and the battle must reach the
//      translated command list and confirm Fight.
//   3. rollback: `?legacyWfight=1` skips the loader; the battle still runs.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_translated_wfight.mjs [outdir]

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = `${baseUrl(8742)}`;
const BASE = `${ROOT}/?skipTitle=1&map=s245&noEncounters=1`;
const OUT = process.argv[2] ?? "captures/step-f-translated-wfight-2026-09-30";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const results = [];
const check = (name, ok, detail = "") => {
    const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(line);
    results.push(line);
    if (!ok) failures++;
};

const SEED = {
    partnerStats: {
        digimonId: 1, level: 12, xp: 0, tp: 30, hp: 60, maxHp: 60, mp: 21, maxMp: 25,
        stats: { str: 40, def: 30, spt: 25, wis: 20, spd: 30, chr: 10 }, elemBonuses: {},
    },
};
/** Resource ids the loader asks for: the five packs, two direct banks, six language families (English = 2). */
const PACKS = [0x456, 0x79e, 0x7ae, 0x7e1, 0x7e3];
const TEXT = [0x286, 0x455, 0x7f + 2, 0x4e + 2, 0xa2 + 2, 0x9b + 2, 0x6a + 2, 0x63 + 2];

const browser = await chromium.launch();

async function openPage({ url, denyFromStart = false, sampleLoader = false }) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1080 } });
    const net = { denied: [], allowed: [], data: [] };
    await page.route("**/assets/native/**", (route) => {
        if (denyFromStart) {
            net.denied.push(route.request().url());
            return route.abort();
        }
        net.allowed.push(route.request().url());
        return route.continue();
    });
    page.on("request", (req) => { if (/assets\/data\/wfight\//.test(req.url())) net.data.push(req.url()); });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    await page.addInitScript((seed) => {
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("playerName", "Junior");
        localStorage.setItem("charId", "p003pken");
        localStorage.setItem("party", JSON.stringify(["p003pken"]));
        localStorage.setItem("partnerStats", JSON.stringify(seed.partnerStats));
        localStorage.setItem("partyStats", JSON.stringify([seed.partnerStats, null, null]));
        localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
        localStorage.setItem("bits", "1000");
        localStorage.setItem("inventory", "[]");
    }, SEED);
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.waitForTimeout(600);
    await page.evaluate(async () => {
        await window.__battle.start({ enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
    });
    return { page, net, errors };
}

const loaderDiag = (page) => page.evaluate(() => window.__battleWfightmn?.diagnostics?.() ?? null);
const battleRead = (page) => page.evaluate(() => {
    const b = window.__battleB?.() ?? { state: -1, menuSel: null, message: "battle over" };
    return { state: b.state, menuSel: b.menuSel, message: b.message,
        cmd: window.__battleCmdNative?.diagnostics?.() ?? null };
});
const waitLoaderDone = (page) => page.waitForFunction(() => window.__battleWfightmn?.isDone?.() === true, null,
    { timeout: 30000 }).catch(() => {});
// The battle's opening line ("Ambush!") holds the command phase until it is read: the original
// arms the menu from the script instruction that first waits on the line's own slot
// (`wfightmn.s:1494-1496`). One shared press reads it, then waits for the list.
const waitList = (page) => waitForCommandMenu(page);

// ── 1. before: the original-code loader ─────────────────────────────────────
let reference = null;
{
    const { page, net, errors } = await openPage({ url: `${BASE}&nativeWfight=1` });
    await page.screenshot({ path: `${OUT}/before-01-reference-battle-start.png` });
    await waitLoaderDone(page);
    reference = await loaderDiag(page);
    await waitList(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/before-02-reference-command-list.png` });
    check("reference: the original-code loader ran and retired", reference?.done === true && (reference?.framesAlive ?? 0) > 0,
        `framesAlive=${reference?.framesAlive} traps=${reference?.traps}`);
    check("reference: it needed executable assets", net.allowed.length > 0, `${net.allowed.length} requests`);
    check("reference: its banks reached the resident cache", reference?.bankIds?.length >= 8,
        JSON.stringify(reference?.bankIds));
    check("reference: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
}

// ── 2. the ordinary route, every executable asset denied from page load ─────
{
    const { page, net, errors } = await openPage({ url: BASE, denyFromStart: true });
    await page.screenshot({ path: `${OUT}/after-01-translated-battle-start.png` });
    await waitLoaderDone(page);
    const d = await loaderDiag(page);
    writeFileSync(`${OUT}/translated-loader-diagnostics.json`, JSON.stringify({ translated: d, reference }, null, 2) + "\n");
    check("ordinary: the loader is the translated session", d?.execution === "translated" && d?.host === null,
        `execution=${d?.execution}`);
    check("ordinary: it ran and retired by itself", d?.done === true && d?.retired === true && d?.failed === false && d?.ticks > 5,
        `done=${d?.done} retired=${d?.retired} failed=${d?.failed} ticks=${d?.ticks} error=${d?.error}`);
    check("ordinary: it asked for the five scene packs, then the eight text banks",
        JSON.stringify(d?.bankIds) === JSON.stringify([...PACKS, ...TEXT]), JSON.stringify(d?.bankIds));
    check("ordinary: it released the five packs", JSON.stringify(d?.released) === JSON.stringify(PACKS), JSON.stringify(d?.released));
    const same = new Set(reference?.bankIds ?? []);
    check("ordinary: it asked for the same banks as the original-code loader",
        [...PACKS, ...TEXT].every((id) => same.has(id)) && same.size === PACKS.length + TEXT.length,
        `reference=${JSON.stringify([...same])}`);
    const uploads = (d?.uploads ?? []).map((u) => `${u.x},${u.y},${u.w}x${u.h}`);
    check("ordinary: it uploaded the strip and the scene atlases to VRAM",
        JSON.stringify(uploads) === JSON.stringify(["512,0,64x256", "0,244,156x12", "320,256,64x256", "384,256,64x256",
            "448,256,64x256", "512,256,64x256", "576,256,64x256"]), uploads.join(" "));
    check("ordinary: its data came from assets/data/wfight", net.data.length >= 6, `${net.data.length} requests`);

    await waitList(page);
    await page.waitForTimeout(500);
    let s = await battleRead(page);
    check("ordinary: the battle reaches the translated command list", s.state === 2 && s.cmd?.execution === "translated" && s.cmd?.ready === true,
        `state=${s.state} execution=${s.cmd?.execution} ready=${s.cmd?.ready}`);
    check("ordinary: the list's marker strip is the loader's own VRAM upload", s.cmd?.stripSource === "loader-vram",
        `stripSource=${s.cmd?.stripSource}`);
    await page.screenshot({ path: `${OUT}/after-02-translated-command-list.png` });
    await page.keyboard.down("Enter");
    await page.waitForTimeout(150);
    await page.keyboard.up("Enter");
    s = await battleRead(page);
    check("ordinary: confirming Fight starts the attack",
        s.menuSel === 0 && s.cmd?.chosen === 0 && (s.state === 5 || /attacks!/.test(String(s.message))),
        `menuSel=${s.menuSel} state=${s.state} message=${s.message}`);
    await page.screenshot({ path: `${OUT}/after-03-translated-fight.png` });
    check("ordinary: zero executable asset requests from page load", net.denied.length === 0 && net.allowed.length === 0,
        `denied=${net.denied.length}: ${net.denied.slice(0, 2).join(", ")}`);
    check("ordinary: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
}

// ── 3. rollback: the loader is skipped and the battle still runs ────────────
{
    const { page, net, errors } = await openPage({ url: `${BASE}&legacyWfight=1`, denyFromStart: true });
    await waitList(page);
    await page.waitForTimeout(400);
    const d = await loaderDiag(page);
    const s = await battleRead(page);
    check("rollback: the loader never opened", d?.open === false && d?.done === false && (d?.ticks ?? 0) === 0,
        `open=${d?.open} done=${d?.done} ticks=${d?.ticks}`);
    check("rollback: the battle still reaches the command list", s.state === 2 && s.cmd?.ready === true && s.cmd?.stripSource === "data",
        `state=${s.state} ready=${s.cmd?.ready} stripSource=${s.cmd?.stripSource}`);
    check("rollback: zero executable asset requests", net.denied.length === 0 && net.allowed.length === 0,
        `denied=${net.denied.length}`);
    check("rollback: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
}

writeFileSync(`${OUT}/verify-output.txt`, results.join("\n") + "\n");
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
