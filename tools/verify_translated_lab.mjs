// Browser proof for the translated Digimon lab (pro/stgdglab), Step F of
// docs/plans/2026-09-28-translated-game-completion-plan.md.
//
// Two runs through the real web/game.js:
//   1. reference: `?nativeLab=1`, the original code through the MIPS interpreter
//      (the "before" pictures). It needs the executable files under assets/native/**.
//   2. ordinary route, no flags, every assets/native/** request denied FROM PAGE
//      LOAD: the translated LabSession runs the whole screen.
// Production scenario: a Kotemon (slot 0) and a Kumamon (slot 1) in the party, a Gaomon (slot 5)
// in the reserve. Kotemon owns four chart forms with technique rows and has two of them equipped.
//   Select Action; Switch Digimon (Gaomon takes Kotemon's place: the party is reordered once the
//   screen closes); the Digivolve Chart (pages, changes nothing); Digivolve > the form grid (the
//   equipped triple changes, nothing else) and > the technique chooser (one ledger entry's loaded
//   flag changes on leaving, nothing else); Back leaves. The walker is untouched while the screen
//   is open and the four save cells are committed once, at close.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_translated_lab.mjs [outdir]

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = `${baseUrl(8742)}`;
const BASE = `${ROOT}/?skipTitle=1&noEncounters=1`;
const OUT = process.argv[2] ?? "captures/step-f-translated-lab-2026-10-01";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const results = [];
const check = (name, ok, detail = "") => {
    const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(line);
    results.push(line);
    if (!ok) failures++;
};

const browser = await chromium.launch();

async function openPage({ query = "", denyNative = false }) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const net = { denied: [], allowed: [], data: [] };
    await page.route("**/assets/native/**", (route) => {
        if (denyNative) { net.denied.push(route.request().url()); return route.abort(); }
        net.allowed.push(route.request().url());
        return route.continue();
    });
    page.on("request", (req) => { if (/assets\/data\/(lab\/|shop_font|shop_catalog|shop_item|shop_desc|wizard\/|pause\/)/.test(req.url())) net.data.push(req.url()); });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    await page.addInitScript(() => { try { localStorage.setItem("assetMode", "authentic"); } catch { /* storage may be blocked */ } });
    await page.goto(`${BASE}${query}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    return { page, net, errors };
}

const press = async (page, key, wait = 500) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(110);
    await page.keyboard.up(key);
    await page.waitForTimeout(wait);
};

/** Kotemon and Kumamon in the party, Gaomon in the reserve; known ledgers. */
async function seedParty(page) {
    await page.evaluate(() => {
        const s = window.__state;
        s.party = ["p003pken", "p004kogu"];
        s.rosterOwned = 0b100011;
        s.partnerStats = {
            digimonId: 1, level: 12, xp: 900, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25,
            core: [11, 12, 13, 14, 15, 16], elements: [1, 2, 3, 4, 5, 6, 7],
            equippedForms: [9, 10, 0],
            formLedger: [
                { id: 1, formLevel: 5, dvexp: 300, techSlots: [0x2001, 0x2002, 0, 0x6003, 0, 0] },
                { id: 9, formLevel: 3, dvexp: 120, techSlots: [0x2004, 0x4005, 0, 0, 0, 0] },
                { id: 10, formLevel: 2, dvexp: 60, techSlots: [0x2006, 0, 0, 0, 0, 0] },
                { id: 11, formLevel: 2, dvexp: 40, techSlots: [0x2007, 0, 0, 0, 0, 0] },
                { id: 12, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
            ],
        };
        s.partyStats = [null, {
            digimonId: 2, level: 10, xp: 400, tp: 20, hp: 40, maxHp: 44, mp: 18, maxMp: 20,
            core: [9, 10, 11, 12, 13, 14], elements: [1, 1, 1, 1, 1, 1, 1], equippedForms: [2, 0, 0],
            formLedger: [{ id: 2, formLevel: 4, dvexp: 100, techSlots: [0x2010, 0, 0, 0, 0, 0] }],
        }];
        s.reserveStats = {
            p008giru: {
                digimonId: 6, level: 8, xp: 200, tp: 10, hp: 30, maxHp: 34, mp: 12, maxMp: 14,
                core: [7, 8, 9, 10, 11, 12], elements: [0, 0, 0, 0, 0, 0, 0], equippedForms: [6, 0, 0],
                formLedger: [{ id: 6, formLevel: 3, dvexp: 50, techSlots: [0x2020, 0, 0, 0, 0, 0] }],
            },
        };
        s.equipment = [{}, {}];
        s.reserveEquipment = {};
        s.digimonNames = {};
    });
}
const snapshot = (page) => page.evaluate(() => JSON.parse(JSON.stringify({
    party: window.__state.party, partner: window.__state.partnerStats, partyStats: window.__state.partyStats,
    reserve: window.__state.reserveStats,
})));

// ── before: the reference route (original code through the interpreter) ────
{
    const { page, errors } = await openPage({ query: "&nativeLab=1" });
    await seedParty(page);
    await page.evaluate(() => window.__dri.open(window.__state, null));
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `${OUT}/before-01-select-action.png` });
    const d = await page.evaluate(() => window.__dri.diagnostics());
    check("reference: the original screen ran (host present)", !!d.host, `traps=${d.host?.traps}`);
    await press(page, "Enter", 3000);
    await page.screenshot({ path: `${OUT}/before-02-pedestals.png` });
    await press(page, "Enter", 4000);
    await page.screenshot({ path: `${OUT}/before-03-switch.png` });
    check("reference: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
}

// ── after: the production route, executables denied ─────────────────────────
const { page, net, errors } = await openPage({ denyNative: true });
const diag = () => page.evaluate(() => window.__dri.diagnostics());
async function waitFor(fn, what, timeout = 40000, arg = null) {
    try { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); return true; } catch {
        check(`wait: ${what}`, false, JSON.stringify((await diag()).screen));
        return false;
    }
}
const screenText = () => page.evaluate(async () => {
    const { drawNativeTextWidgets } = await import("/native-screen-text.js");
    const widgets = window.__dri.textWidgets?.() ?? [];
    return drawNativeTextWidgets({ drawImage() {} }, widgets.filter((w) => w.visible)).texts ?? [];
});
const idle = () => waitFor(() => { const s = window.__dri.diagnostics().screen; return s && s.root === 1 && s.pane === 3 && !s.child; }, "Select Action idle");
const pedestals = () => waitFor(() => { const s = window.__dri.diagnostics().screen; return s && s.pane === 15 && !s.child; }, "the partner list");
/** A screen named `name` is open and idle (for the root's own child, also at `phase`). */
const inChild = (name, phase = null) => waitFor((a) => {
    const s = window.__dri.diagnostics().screen;
    if (!s || !s.names.includes(a.name)) return false;
    if (s.child === a.name) return s.childLifecycle === 1 && (a.phase == null || s.childPhase === a.phase);
    return a.phase == null || window.__dri._session.mem.read32([...window.__dri._session.tree.tasks.values()]
        .find((t) => window.__dri._session.tree.classes.get(t.classId).name === a.name).address + 0x10) === a.phase;
}, `${name} ${phase ?? ""}`.trim(), 40000, { name, phase });

await seedParty(page);
check("production: the translated screen is the default route", (await page.evaluate(() => window.__dri.diagnostics().execution)) === "translated");
const seeded = await snapshot(page);

// 1. Select Action, then Switch Digimon: Gaomon takes Kotemon's place.
await page.evaluate(() => window.__dri.open(window.__state, null));
await idle();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/after-01-select-action.png` });
let d = await diag();
check("production: the screen booted through the recorded display service",
    d.displayCalls.some((c) => c.call === "displayView") && d.tasks >= 3, `calls=${d.displayCalls.length} tasks=${d.tasks}`);
const text = (await screenText()).join("|");
check("production: Select Action prints its five lines", /Select Action/.test(text) && /Switch Digimon/.test(text) && /Digivolve Chart/.test(text), text.slice(0, 160));
await press(page, "Enter", 300);
await pedestals();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/after-02-pedestals.png` });
await press(page, "Enter", 300);
await inChild("lab switch", 4);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/after-03-switch.png` });
check("production: the walker is untouched while the screen is open", JSON.stringify((await snapshot(page)).party) === JSON.stringify(seeded.party));
await press(page, "Enter", 300);
await waitFor(() => { const s = window.__dri.diagnostics().screen; return s && !s.child && s.pane === 15; }, "back at the partner list after the swap");
check("production: the screen's party map holds Gaomon first (still uncommitted)",
    (await diag()).screen.party.join(",") === "5,1,-1" && (await snapshot(page)).party[0] === "p003pken");
await press(page, "Escape", 600); // Back to the rows
await idle();

// 2. The Digivolve Chart: page right, back; nothing changes.
await press(page, "ArrowDown", 250);
await press(page, "ArrowDown", 250);
await press(page, "Enter", 300);
await pedestals();
await press(page, "Enter", 300);
await inChild("lab chart", 3);
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/after-04-chart.png` });
await press(page, "e", 300);
await inChild("lab chart", 3);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/after-05-chart-page2.png` });
await press(page, "Escape", 300);
await waitFor(() => { const s = window.__dri.diagnostics().screen; return s && !s.child && s.pane === 15; }, "back at the partner list after the chart");
await press(page, "Escape", 600);
await idle();

// 3. Digivolve (the cursor stayed on the Chart row): look at Kumamon's screen and back out.
await press(page, "ArrowUp", 250);
await press(page, "Enter", 300);
await pedestals();
await press(page, "ArrowRight", 300); // Kumamon
await press(page, "Enter", 300);
await inChild("lab detail", 2);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/after-06-digivolve.png` });
await press(page, "Escape", 300);
await waitFor(() => { const s = window.__dri.diagnostics().screen; return s && !s.child && s.pane === 15; }, "back at the partner list after Digivolve");
await press(page, "Escape", 600);
await idle();
await press(page, "Escape", 300);
await waitFor(() => !window.__dri.isOpen(), "the lab to close", 30000);

const after = await snapshot(page);
const summary = await page.evaluate(() => window.__dri.diagnostics().summary);
check("commit: the screen closed by itself and committed once", summary?.finished === true && (await page.evaluate(() => window.__dri._committed)) === 1);
check("commit: the party now stands Gaomon, Kumamon", JSON.stringify(after.party) === JSON.stringify(["p008giru", "p004kogu"]), JSON.stringify(after.party));
check("commit: Gaomon's own block came along", after.partner?.digimonId === 6 && after.partner?.level === 8);
check("commit: Kotemon waits in the reserve with the block it left with",
    after.reserve?.p003pken?.digimonId === 1 && after.reserve.p003pken.level === 12 && JSON.stringify(after.reserve.p003pken.formLedger) === JSON.stringify(seeded.partner.formLedger));
check("commit: nothing else of Kumamon changed", JSON.stringify(after.partyStats[1]) === JSON.stringify(seeded.partyStats[1]));
check("commit: the exit hands back the saved field", (summary?.transition ?? []).join(",") === "0,0", JSON.stringify(summary?.transition));
check("commit: the partner blocks were persisted", JSON.parse(await page.evaluate(() => localStorage.getItem("party") ?? "null"))?.[0] === "p008giru");
writeFileSync(`${OUT}/translated-diagnostics.json`, JSON.stringify({ seeded, after, summary }, null, 2));

// 4. A second visit: Digivolve > form grid > pick a form; Digivolve > technique chooser > load a technique.
await seedParty(page);
const second = await snapshot(page);
await page.evaluate(() => window.__dri.open(window.__state, null));
await idle();
await press(page, "ArrowDown", 250);
await press(page, "Enter", 300);
await pedestals();
await press(page, "Enter", 300);
await inChild("lab detail", 2);
await press(page, "Enter", 300); // Change digivolve
await waitFor(() => { const s = window.__dri.diagnostics().screen; return s && s.child === "lab detail" && s.childPhase === 0x29; }, "the equipped forms");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/after-07-equipped-forms.png` });
await press(page, "Enter", 300);
await waitFor(() => { const s = window.__dri.diagnostics().screen; return s && s.child === "lab detail" && s.childPhase === 0xc; }, "the form grid", 40000);
await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/after-08-grid.png` });
await press(page, "Enter", 400); // pick the starter form (the first cell) for the first equipped slot
await page.waitForTimeout(2500);
check("production: the walker is untouched while the grid is open", JSON.stringify((await snapshot(page)).partner.equippedForms) === JSON.stringify(second.partner.equippedForms));
await waitFor(() => { const s = window.__dri.diagnostics().screen; return s && s.child === "lab detail" && s.childPhase === 0x29; }, "back at the equipped forms");
await press(page, "Escape", 600);
await waitFor(() => { const s = window.__dri.diagnostics().screen; return s && s.child === "lab detail" && s.childPhase === 2 && s.childLifecycle === 1; }, "back at the Digivolve menu");
// The technique chooser for the first equipped form.
await press(page, "ArrowDown", 250);
await press(page, "Enter", 300);
await waitFor(() => { const s = window.__dri.diagnostics().screen; return s && s.child === "lab detail" && s.childPhase === 0x29; }, "the equipped forms (chooser run)");
await page.waitForTimeout(1500);
await press(page, "Enter", 400);
await inChild("lab chooser", 1);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/after-09-chooser.png` });
await press(page, "Enter", 400);
await inChild("lab chooser", 21);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/after-10-load-question.png` });
await press(page, "Enter", 400);
await inChild("lab chooser", 1);
check("production: the walker's ledger is untouched while the chooser is open", JSON.stringify((await snapshot(page)).partner.formLedger) === JSON.stringify(second.partner.formLedger));
await press(page, "Escape", 300);
await waitFor(() => { const s = window.__dri.diagnostics().screen; return s && s.child !== "lab chooser"; }, "the chooser to close");
// Leave: Back out of every level.
for (let i = 0; i < 8 && (await page.evaluate(() => window.__dri.isOpen())); i++) await press(page, "Escape", 1100);
await waitFor(() => !window.__dri.isOpen(), "the second visit to close", 40000);
const third = await snapshot(page);
check("commit: the first equipped slot took the starter form, the second stayed", JSON.stringify(third.partner.equippedForms) === JSON.stringify([1, 10, 0]), JSON.stringify(third.partner.equippedForms));
check("commit: the loaded technique reached exactly one ledger entry",
    third.partner.formLedger.filter((e, i) => JSON.stringify(e.techSlots) !== JSON.stringify(second.partner.formLedger[i].techSlots)).length === 1,
    JSON.stringify(third.partner.formLedger.map((e) => e.techSlots)));
check("commit: party, level and the other partners are unchanged",
    JSON.stringify(third.party) === JSON.stringify(second.party) && third.partner.level === 12 && JSON.stringify(third.partyStats[1]) === JSON.stringify(second.partyStats[1]));

check("no executable asset was requested in production", net.allowed.length === 0 && net.denied.length === 0,
    `denied=${net.denied.length} allowed=${net.allowed.length}`);
check("the screen's data files were fetched", net.data.some((u) => /lab\/tables\.bin/.test(u)) && net.data.some((u) => /lab\/resident\.bin/.test(u)));
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
writeFileSync(`${OUT}/verify-output.txt`, results.join("\n") + "\n");
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
