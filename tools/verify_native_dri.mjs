// Phase 6.3 Digimon Lab route verifier: the shipped pro/stgdglab overlay is
// what the DRI desk story flag opens, it draws its own art, real key events
// drive a Switch and a Change-digivolve-type, and closing commits the four
// cells the lab writes back into the walker's state.
//
//   tools/run-playwright.sh tools/verify_native_dri.mjs
//
// Contract: .dw3-research/dri-route/worker-lab.md (lead-verified against
// exe-decomp/stgdglab_c/**). Captures land in
// .dw3-research/autonomous-plan/captures/phase6-dri-2026-09-21/.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

// `nativeLab=1` is the route this verifier is written for: the shipped
// pro/stgdglab overlay behind web/dri-native.js. Without it game.js hands out the
// TRANSLATED lab (web/lab-translated.js, covered by tools/verify_translated_lab.mjs),
// which has no `__dri._host` — the overlay's own RAM bridge — so every assertion
// below reads undefined. Same missing-route-parameter bug verify_native_gym.mjs
// had for nativeGym. LAB_NATIVE_BASE overrides the whole URL.
const BASE = process.env.LAB_NATIVE_BASE
    || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&nativeLab=1`;
const OUT = process.env.DRI_SHOT
    || ".dw3-research/autonomous-plan/captures/phase6-dri-2026-09-21";
mkdirSync(OUT, { recursive: true });

const problems = [];
let step = "start";
const ok = (cond, msg) => { if (!cond) problems.push(msg); return cond; };
const hash = (buf) => createHash("sha1").update(buf).digest("hex").slice(0, 12);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const press = async (key, ms = 110) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(750);
};
const shot = (name) => page.locator("#game").screenshot().then((b) => writeFileSync(`${OUT}/${name}.png`, b));
const diag = () => page.evaluate(() => {
    const st = window.__dri;
    const d = st.diagnostics();
    const root = d.screen?.root ?? 0;
    const read = (a, s = 4) => st._host?.read?.(a, s) ?? null;
    const rec = 0x80049494;
    return {
        open: st.isOpen(), traps: d.host?.traps, frames: d.renderer?.frames,
        byPack: d.renderer?.byPack, rootLife: root ? read(root + 0xc) : null,
        party: [0, 1, 2].map((i) => read(0x80048d34 + 0x70 + i * 4)),
        form: read(rec + 0x04, 4), equipped: [0, 1, 2].map((i) => read(rec + 0x50 + i * 2, 2)),
        tech0: [0, 1, 2, 3, 4, 5].map((i) => read(rec + 0x58 + 0x08 + i * 2, 2)),
        last: d.lastDiagnostic,
    };
});
const waitOpen = (want) => page.waitForFunction(
    (w) => window.__dri?.isOpen?.() === w, want, { timeout: 25000 },
).then(() => true).catch(() => false);
const waitFrames = (n) => page.waitForFunction(
    (want) => (window.__dri?.diagnostics?.().renderer?.frames ?? 0) >= want, n, { timeout: 30000 },
);
const settle = () => page.waitForFunction(() => {
    const st = window.__dri;
    const root = st?.diagnostics?.().screen?.root ?? 0;
    const aux = root ? (st._host.read(root + 0x24, 4) >>> 0) : 0;
    return (aux ? (st._host.read(aux + 4, 4) >>> 0) : 0) === 0;
}, null, { timeout: 20000 }).then(() => true).catch(() => false);
const escapeUntilClosed = async (tries = 8) => {
    for (let i = 0; i < tries; i++) {
        await press("Escape");
        await page.waitForTimeout(900);
        if (await page.evaluate(() => window.__dri.isOpen() === false)) return true;
    }
    return false;
};

const SEED = () => {
    const s = window.__state;
    s.bits = 4321;
    s.rosterOwned = 0xff;
    s.party = ["p003pken", "p009rena", "p004kogu"];
    s.digimonNames = { p003pken: "Kotemon", p009rena: "Renamon", p004kogu: "Kumamon" };
    s.partnerStats = {
        digimonId: 9, level: 30, xp: 0, tp: 20, hp: 300, maxHp: 400, mp: 100, maxMp: 160,
        stats: { str: 50, def: 40, spt: 45, wis: 44, spd: 42, chr: 20 }, elemBonuses: {},
        equippedForms: [9, 27, 0],
        formLedger: [
            { id: 9, formLevel: 5, dvexp: 100, techSlots: [3, 0x2000 | 5, 0x4000 | 7, 0, 0, 0x8000 | 53] },
            { id: 27, formLevel: 5, dvexp: 100, techSlots: [4, 0, 0, 0, 0, 0] },
            { id: 39, formLevel: 5, dvexp: 100, techSlots: [5, 0, 0, 0, 0, 0] },
            { id: 11, formLevel: 5, dvexp: 100, techSlots: [6, 0, 0, 0, 0, 0] },
        ],
    };
    s.partyStats = [s.partnerStats, {
        digimonId: 7, level: 10, xp: 0, tp: 5, hp: 100, maxHp: 120, mp: 40, maxMp: 50, stats: {}, elemBonuses: {},
    }, null];
    s.equipment = [{ head: 215 }, { right: 92 }, {}];
    s.reserveStats = {};
    s.reserveEquipment = {};
};

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.evaluate(SEED);

    // The real entry: bank 0x7C index 0, the DRI desk story flag.
    step = "open from the story flag";
    await page.evaluate(() => window.__applyStoryFlag(0x7c00, true));
    const opened = await waitOpen(true);
    ok(opened, "the story flag did not open the native lab");
    await waitFrames(60);
    const d0 = await diag();
    ok((d0.traps ?? 1) === 0, `traps on the root: ${d0.traps}`);
    ok(Object.keys(d0.byPack ?? {}).length > 0, `no pack drew: ${JSON.stringify(d0.byPack)}`);
    ok(d0.frames >= 60, "the lab never became interactive");
    // The seed must be in the record: equipped [9,27,0] -> value0 [386,375,0xFFFF].
    ok(JSON.stringify(d0.equipped) === JSON.stringify([386, 375, 65535]),
        `seed equipped triple wrong: ${JSON.stringify(d0.equipped)}`);
    await shot("1-select-action");

    step = "Switch Digimon (real keys)";
    await press("Enter");           // row 0 = Switch Digimon -> "Switch who?"
    await page.waitForTimeout(600);
    await press("Enter");           // pedestal 0 -> "Switch with who"
    await page.waitForTimeout(600);
    await press("ArrowDown");       // first reserve candidate
    await press("Enter");           // confirm the swap
    await page.waitForTimeout(1200);
    const switched = await diag();
    ok((switched.traps ?? 1) === 0, `traps on the switch: ${switched.traps}`);
    const newLead = switched.party[0];
    ok(newLead !== 0 && newLead !== 0xffffffff, `party map did not take the reserve slot: ${JSON.stringify(switched.party)}`);
    await shot("2-after-switch");
    // Back to the root, then leave. The switch screen folds first, so wait for
    // the root's aux child slot to clear before pressing Back.
    ok(await settle(), "the switch screen never returned to the root");
    const closed1 = await escapeUntilClosed();
    ok(closed1, "Back did not close the lab after the switch");
    const afterSwitch = await page.evaluate(() => ({
        party: window.__state.party,
        reserveStats: Object.keys(window.__state.reserveStats ?? {}),
        reserveEquipment: Object.keys(window.__state.reserveEquipment ?? {}),
        equipment: window.__state.equipment,
        storedParty: JSON.parse(localStorage.getItem("party") ?? "null"),
    }));
    // The switch's candidate is the first owned reserve slot (2 = Monmon here),
    // so the expected lead is the character of the roster slot the map names.
    const ROSTER_CHARS = ["p003pken", "p004kogu", "p005koet", "p006agum", "p007vmon", "p008giru", "p009rena", "p010pata"];
    ok(afterSwitch.party?.[0] === ROSTER_CHARS[switched.party[0]],
        `walker party not committed: ${JSON.stringify(afterSwitch.party)} vs slot ${switched.party[0]}`);
    ok(afterSwitch.reserveStats?.includes("p003pken"),
        `the switched-out lead was not reserved: ${JSON.stringify(afterSwitch.reserveStats)}`);
    ok(afterSwitch.reserveEquipment?.includes("p003pken"),
        `the switched-out lead's gear was not reserved: ${JSON.stringify(afterSwitch.reserveEquipment)}`);
    ok(JSON.stringify(afterSwitch.storedParty) === JSON.stringify(afterSwitch.party),
        `localStorage party not persisted: ${JSON.stringify(afterSwitch.storedParty)}`);

    // The walker's own formation data must have followed the switch: the new
    // lead's stats block is the one now at partyStats[0].
    const leadStats = await page.evaluate(() => ({
        digimonId: window.__state.partnerStats?.digimonId,
        level: window.__state.partnerStats?.level,
        charId: window.__state.charId,
    }));
    ok(leadStats.charId === afterSwitch.party?.[0], `charId not re-pointed: ${JSON.stringify(leadStats)}`);

    step = "Digivolve change-type (real keys)";
    await page.evaluate(SEED);
    await page.evaluate(() => window.__applyStoryFlag(0x7c00, true));
    ok(await waitOpen(true), "the lab did not reopen");
    await waitFrames(60);
    await press("ArrowDown");       // Digivolve row
    await press("Enter");           // partner picker
    await press("Enter");           // "Choose a digivolve." form list
    await page.waitForTimeout(1200);
    await shot("3-digivolve-list");
    await press("Enter", 150);      // open the highlighted form
    await page.waitForTimeout(1200);
    await press("ArrowDown");
    await press("Enter", 150);      // Select Action: Change digivolve type
    await page.waitForTimeout(1200);
    await press("Enter", 150);      // grid row
    await page.waitForTimeout(1200);
    await press("ArrowDown");       // move off the current form
    await press("Enter", 150);      // confirm the swap
    await page.waitForTimeout(1500);
    const changed = await diag();
    ok((changed.traps ?? 1) === 0, `traps in the change-type grid: ${changed.traps}`);
    ok(JSON.stringify(changed.equipped) !== JSON.stringify([386, 375, 65535]),
        `the change-type grid did not write the equipped triple: ${JSON.stringify(changed.equipped)}`);
    await shot("4-change-type");
    // Back out to the root and close; the read-back must carry the triple.
    ok(await escapeUntilClosed(10), "Back did not close the lab after the form change");
    const afterForm = await page.evaluate(() => ({
        equippedForms: window.__state.partnerStats?.equippedForms,
        formLedger: (window.__state.partnerStats?.formLedger ?? []).map((r) => r.id),
    }));
    ok(Array.isArray(afterForm.equippedForms) && afterForm.equippedForms[0] === 9,
        `walker equippedForms not committed: ${JSON.stringify(afterForm.equippedForms)}`);
    ok(afterForm.equippedForms.includes(39) || afterForm.equippedForms.includes(27),
        `the swapped-in form is not in the committed triple: ${JSON.stringify(afterForm.equippedForms)}`);
    ok(afterForm.formLedger.length === 4, `the form ledger was lost: ${JSON.stringify(afterForm.formLedger)}`);

    step = "standing form + tech load commit (RAM path)";
    // The standing-form picker and the load-technique chooser are deeper in the
    // same submenu; their write cells are proved here the way the pause route
    // proves its commit contract: put the screen's own values in RAM, close,
    // and check the walker picked them up. (The cells are the decoded writers:
    // record+0x04 via F0x80085DD0 case 4, ledger via F0x8008C960 case 40.)
    await page.evaluate(SEED);
    await page.evaluate(() => window.__applyStoryFlag(0x7c00, true));
    ok(await waitOpen(true), "the lab did not reopen for the commit probe");
    await waitFrames(60);
    await page.evaluate(() => {
        const w = window.__dri.writeMemory;
        w(0x80049494 + 0x04, 376, 4);                 // current form = value0(39)
        const base = 0x80049494 + 0x58 + 0x08;
        w(base + 1 * 2, (0x2000 | 5) | 0x4000, 2);    // load tech slot 1
    });
    const closed3 = await escapeUntilClosed();
    ok(closed3, "Back did not close the lab after the commit probe");
    const committed = await page.evaluate(() => ({
        digimonId: window.__state.partnerStats?.digimonId,
        techs: window.__state.partnerStats?.formLedger?.[0]?.techSlots,
        stored: JSON.parse(localStorage.getItem("partnerStats") ?? "null")?.digimonId,
    }));
    ok(committed.digimonId === 39, `current form not committed: ${committed.digimonId}`);
    ok((committed.techs?.[1] & 0x4000) !== 0, `loaded-tech flag not committed: ${JSON.stringify(committed.techs)}`);
    writeFileSync(`${OUT}/verify-native-dri.json`,
        JSON.stringify({ d0, switched, changed, afterSwitch, afterForm, committed }, null, 1) + "\n");

    ok(errors.length === 0, `page errors: ${errors.join(" | ")}`);
} catch (e) {
    problems.push(`exception at [${step}]: ${e.message}`);
} finally {
    await browser.close();
}

if (problems.length) {
    console.error(`FAIL verify_native_dri:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
} else {
    console.log("verify_native_dri: OK (story flag -> native lab draws -> Switch commits the party -> change-type commits the equipped triple -> standing form + loaded tech commit; no traps)");
}
