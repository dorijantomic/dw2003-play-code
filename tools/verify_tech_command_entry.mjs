// Playtest 2026-10-07 item 11(a) — the TECH command must be enterable even when the
// acting Digimon's current form holds no technique halfwords.
//
// Disc authority: the battle command-flow phase dispatches menu row 1 (Tech) to
// branch 3 (`0x800830F4[3] = 0x80092A28`, pro/fightstg.s:266 / :16282), whose first
// act is `FIGHTSTG_F0x80096e88` (:20777) — it ALLOCATES the 0xD8 technique screen and
// returns, with no test of the list. The screen's own build `FIGHTSTG_F0x800967A0`
// (:20332) reads the acting form's technique words and, when the count is zero, still
// builds the list widget and arms it (:20577-:20591, config 0x800A3554 row count 1).
// So the disc always enters; an empty list is entered and cancelled, never refused.
// The walker used to answer with its own "No techs!" notice and stay on the command
// list, which is what the operator saw as "I can't enter Tech" after a swap or a death.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_tech_command_entry.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { readBattleLine } from "./verify-battle-wait.mjs";

const ROOT = `${baseUrl(8742)}`;
const BASE = `${ROOT}/?skipTitle=1&map=s245&noEncounters=1`;
const OUT = process.argv[2] ?? "captures/playtest-2026-10-07-you";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const results = [];
const check = (name, ok, detail = "") => {
    const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(line); results.push(line); if (!ok) failures++;
};

/** A digivolved form whose ledger entry holds NO learned technique halfwords. */
const EMPTY_FORM = {
    digimonId: 4, level: 12, xp: 0, tp: 30, hp: 300, maxHp: 300, mp: 90, maxMp: 90,
    stats: { str: 120, def: 80, spt: 60, wis: 50, spd: 70, chr: 30 }, bonuses: {}, elemBonuses: {},
    equippedForms: [4, 0, 0],
    formLedger: [{ id: 4, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }],
    tech_signature: 0,
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((lead) => {
    for (const [k, v] of Object.entries({
        assetMode: "authentic", engineSchema: "2", digivolveDemo: "0", playerName: "Junior",
        charId: "p003pken", bits: "1000", party: JSON.stringify(["p003pken"]),
    })) localStorage.setItem(k, v);
    localStorage.setItem("partnerStats", JSON.stringify(lead));
    localStorage.setItem("partyStats", JSON.stringify([lead]));
    localStorage.setItem("equipment", JSON.stringify([{}]));
    localStorage.setItem("inventory", "[]");
}, EMPTY_FORM);

const tap = async (k) => { await page.keyboard.down(k); await page.waitForTimeout(90); await page.keyboard.up(k); await page.waitForTimeout(80); };
const snap = () => page.evaluate(() => {
    const b = window.__battleB?.() ?? null;
    return {
        state: b?.state ?? null, notice: b?.menuNotice ?? null,
        cmdSel: window.__battleCmdNative?.diagnostics?.()?.selection ?? null,
        techOpen: window.__battleTechNative?.isOpen?.() ?? false,
        techActive: window.__battleTechNative?.active?.() ?? false,
        techSeed: window.__battleTechNative?.diagnostics?.()?.seed?.techniques?.length ?? null,
    };
});
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
        await window.__battle.start({ enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
    });
    await page.waitForFunction(() => window.__battleB?.()?.state === 2, null, { timeout: 30000 }).catch(() => {});
    await readBattleLine(page).catch(() => {});
    await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.()?.ready === true, null, { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });
    await page.waitForTimeout(300);
    await shot("tech-entry-before-command-menu");

    // The acting form's technique list resolves to nothing.
    const techs = await page.evaluate(() => window.__battleB().player.statsRecord.formLedger[0].techSlots.slice());
    check("the acting form carries no learned technique halfwords",
        techs.every((w) => w === 0), JSON.stringify(techs));

    // Move to Tech and confirm.
    let s = await snap();
    for (let i = 0; i < 8 && s.cmdSel !== 1; i++) { await tap("ArrowDown"); s = await snap(); }
    check("the command list cursor reaches the Tech row", s.cmdSel === 1, `selection=${s.cmdSel}`);
    await tap("Enter");
    await page.waitForFunction(() => window.__battleB?.()?.state === 3, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    s = await snap();
    await shot("tech-entry-after-enter");
    check("confirming Tech ENTERS the technique screen", s.state === 3, `state=${s.state} notice=${s.notice}`);
    check("the translated TECH screen is open", s.techOpen === true);
    check("no \"No techs!\" refusal notice is shown", s.notice === null, `notice=${s.notice}`);

    // Cross leaves the empty list back to the command list, as on the disc.
    await tap("Escape");
    await page.waitForFunction(() => window.__battleB?.()?.state === 2, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    s = await snap();
    check("Cross leaves the empty list back to the command list", s.state === 2, `state=${s.state}`);
    check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
    check("run completed", false, e.message);
} finally {
    writeFileSync(`${OUT}/tech-command-entry-output.txt`, results.join("\n") + "\n");
    console.log(`[tech-entry] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
    await browser.close();
    process.exit(failures === 0 ? 0 : 1);
}
