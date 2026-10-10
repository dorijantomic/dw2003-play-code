// The See Equipment window as a player drives it: STATUS -> Digimon -> See
// Equipment -> pick a slot -> pick an item -> equip -> remove, then close the
// pause and check the walker's own state and localStorage picked up the swap.
//
//   tools/run-playwright.sh tools/verify_native_equip.mjs
//
// The window is the shipped pro/ststatus sub-screen (equip root F0x80088214,
// tick F0x8008744c; confirm calls the equip service F0x8009a3e8). The record's
// six worn halfwords are seeded from state.equipment and read back on close
// (web/status-native.js), so an item equipped here must leave the walker's bag
// and appear in state.equipment, and removing it must put it back.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

// The See Equipment window is read through the status page's own native host
// (`st._host.read`), and the pause/status route runs translated code in ordinary
// play now, so this check asks for the original-code page with ?nativeStatus=1.
// The translated page's own equipment commit is proven by
// tools/verify_translated_pause.mjs.
// Captures go to this tree's own captures/ directory: the old default wrote into
// the read-only .dw3-research symlink.
const BASE = process.env.DDW3_BASE
    || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&nativeStatus=1`;
const OUT = process.env.EQUIP_SHOT || "captures/phase6-equip-2026-09-21";
mkdirSync(OUT, { recursive: true });

const problems = [];
let step = "start";
const ok = (cond, msg) => { if (!cond) problems.push(msg); return cond; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const state = () => page.evaluate(() => {
    const st = window.__status;
    const walker = {
        walkerEquip: JSON.parse(JSON.stringify(window.__state.equipment ?? null)),
        walkerBag: JSON.parse(JSON.stringify(window.__state.inventory ?? null)),
    };
    if (!st._host?.rt) return { open: st.isOpen(), traps: null, ...walker };
    const read = (a) => st._host.read(a, 4) >>> 0;
    const page_ = st.diagnostics().screen?.child ?? 0;
    const aux = page_ ? read(page_ + 0x24) : 0;
    const win = aux ? read(aux + 0x10c) : 0;
    const rec = 0x80049494;
    return {
        open: st.isOpen(), traps: st.diagnostics().host?.traps,
        pageUnk10: page_ ? read(page_ + 0x10) : null,
        win, winState: win ? read(win + 0x10) : null,
        winCursor: win ? read(win + 0x64) : null,
        winList: win ? Array.from({ length: 8 }, (_, i) => read(win + 0x78 + i * 2) & 0xffff) : null,
        equip: [0x3c8, 0x3ca, 0x3cc, 0x3ce, 0x3d0, 0x3d2].map((o) => read(rec + o) & 0xffff),
        bag215: st._host.read(0x80048d34 + 0x7c + 215, 1) & 0xff,
        walkerEquip: JSON.parse(JSON.stringify(window.__state.equipment ?? null)),
        walkerBag: JSON.parse(JSON.stringify(window.__state.inventory ?? null)),
    };
});
const shot = async (name) => writeFileSync(`${OUT}/${name}.png`, await page.locator("#game").screenshot());
const press = async (key, ms = 100) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(600);
};
const interactive = () => page.waitForFunction(
    () => (window.__status?.diagnostics?.().renderer?.frames ?? 0) >= 60, null, { timeout: 30000 },
);
const waitWinState = (s) => page.waitForFunction(
    (want) => {
        const st = window.__status, read = (a) => st._host.read(a, 4) >>> 0;
        const page_ = st.diagnostics().screen?.child ?? 0;
        const aux = page_ ? read(page_ + 0x24) : 0;
        const win = aux ? read(aux + 0x10c) : 0;
        return win !== 0 && (read(win + 0x10) >>> 0) === want;
    }, s, { timeout: 15000 },
).then(() => true).catch(() => false);

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.evaluate(() => {
        window.__state.bits = 4321;
        window.__state.party = ["p003pken", null, null];
        window.__state.digimonNames = { p003pken: "Kotemon" };
        window.__state.partnerStats = {
            digimonId: 1, level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25,
            stats: {}, elemBonuses: {},
        };
        window.__state.partyStats = [{ level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 }, null, null];
        window.__state.inventory = [{ id: 215, qty: 1 }];
        window.__state.equipment = [];
        window.__labOpen("menu");
    });
    await page.waitForTimeout(500);

    step = "open the See Equipment window";
    for (let i = 0; i < 4; i++) await press("ArrowDown", 70);
    await press("Enter", 90);
    await interactive();
    await press("Enter", 90);            // the Digimon's detail
    await page.waitForTimeout(700);
    await press("ArrowDown", 70);        // See Equipment
    await press("Enter", 90);            // open the window
    const slotList = await waitWinState(3);
    ok(slotList, "the See Equipment window did not reach its slot list");
    const s1 = await state();
    ok((s1.traps ?? 1) === 0, `traps opening the window: ${s1.traps}`);
    ok(s1.equip.every((v) => v === 0), `a fresh seed is not empty: ${JSON.stringify(s1.equip)}`);
    await shot("1-window-slot-list");

    step = "equip the item";
    await press("Enter", 90);            // open the item list
    const grid = await waitWinState(15);
    ok(grid, "the item list did not open");
    const s2 = await state();
    ok(s2.winList?.[0] === 0xffff, `row 0 is not the remove sentinel: ${JSON.stringify(s2.winList)}`);
    ok(s2.winList?.[1] === 215, `the candidate item is not offered: ${JSON.stringify(s2.winList)}`);
    await shot("2-item-list");
    await press("ArrowDown", 70);        // move off the sentinel onto the item
    await press("Enter", 90);            // equip it
    await waitWinState(3);               // folds back to the slot list
    const s3 = await state();
    ok((s3.traps ?? 1) === 0, `traps equipping: ${s3.traps}`);
    ok(s3.equip[0] === 215, `record head slot not written: ${JSON.stringify(s3.equip)}`);
    ok(s3.bag215 === 0, `bag count not decremented: ${s3.bag215}`);
    await shot("3-equipped");

    step = "remove it again";
    await press("Enter", 90);            // reopen the list; cursor 0 = remove
    await waitWinState(15);
    await press("Enter", 90);            // remove
    await waitWinState(3);
    const s4 = await state();
    ok((s4.traps ?? 1) === 0, `traps removing: ${s4.traps}`);
    ok(s4.equip[0] === 0, `record head slot not cleared: ${JSON.stringify(s4.equip)}`);
    ok(s4.bag215 === 1, `bag count not restored: ${s4.bag215}`);
    await shot("4-removed");

    step = "close and read back";
    // Back out of the window, the detail and the picker, then the page.
    // Back is word bit 0x4000, reached with Escape or x (engine/systems/input-map.ts,
    // commit 173ebcf0); Enter, z and c are CONFIRM (bit 0x2000) and this check used
    // to press `c` twice here, which the page reads as "apply this row" (its item
    // list reads mask 0x0D = confirm, ststatus file 0x5294). With the cursor back on
    // the list's first row -- the take-off row, id -1 -- that applied a REMOVE, so the
    // original undid the equip (F0x8009A3E8's displace arm, `sh $zr, 0x3c0($s1)` at
    // ststatus file 0x177EC) before the page folded and the walker had nothing left
    // to read. Cross out with Back, not with Confirm.
    // The page folds one screen per press, so press Back until it is gone
    // rather than assuming a fixed count.
    await press("Escape", 90);
    await page.waitForTimeout(500);
    await press("Escape", 90);
    await page.waitForTimeout(500);
    for (let i = 0; i < 6 && !(await page.evaluate(() => window.__status?.isOpen?.() === false)); i++) {
        await press("Escape");
        await page.waitForTimeout(500);
    }
    const closed = await page.evaluate(() => window.__status?.isOpen?.() === false);
    ok(closed, "Back did not close the pause page");
    // The read-back applies what the record holds NOW: to prove the walker sees
    // the swap, do one more equip cycle and leave with it worn.
    await page.evaluate(() => window.__labOpen("menu"));
    await page.waitForTimeout(400);
    for (let i = 0; i < 4; i++) await press("ArrowDown", 70);
    await press("Enter", 90);
    await interactive();
    await press("Enter", 90);
    await page.waitForTimeout(700);
    await press("ArrowDown", 70);
    await press("Enter", 90);
    await waitWinState(3);
    await press("Enter", 90);
    await waitWinState(15);
    await press("ArrowDown", 70);
    await press("Enter", 90);
    await waitWinState(3);
    const s5 = await state();
    ok((s5.traps ?? 1) === 0, `traps on the second equip: ${s5.traps}`);
    ok(s5.equip[0] === 215, `second equip did not write the record: ${JSON.stringify(s5.equip)}`);
    // Back closes the window, Back again the detail, and Back folds the page away
    // from the picker (the same three presses as above).
    await press("Escape", 90);
    await page.waitForTimeout(500);
    await press("Escape", 90);
    await page.waitForTimeout(500);
    for (let i = 0; i < 6 && !(await page.evaluate(() => window.__status?.isOpen?.() === false)); i++) {
        await press("Escape");
        await page.waitForTimeout(500);
    }
    const closed2 = await page.evaluate(() => window.__status?.isOpen?.() === false);
    ok(closed2, "Back did not close the pause page after the second equip");
    const final = await state();
    ok(final.walkerEquip?.[0]?.head === 215, `walker equipment not committed: ${JSON.stringify(final.walkerEquip)}`);
    ok(!(final.walkerBag ?? []).some((s) => s.id === 215), `walker bag still holds the worn item: ${JSON.stringify(final.walkerBag)}`);
    const stored = await page.evaluate(() => ({
        equipment: localStorage.getItem("equipment"),
        inventory: localStorage.getItem("inventory"),
        bonuses: JSON.parse(localStorage.getItem("partnerStats") ?? "null")?.equipBonuses ?? null,
    }));
    ok(JSON.parse(stored.equipment ?? "[]")?.[0]?.head === 215,
        `localStorage equipment not persisted: ${stored.equipment}`);
    ok(!JSON.parse(stored.inventory ?? "[]").some((s) => s.id === 215),
        `localStorage bag not persisted: ${stored.inventory}`);
    ok(stored.bonuses?.chr === 10,
        `lead equip bonuses not refreshed (Bandanna gives CHR+10): ${JSON.stringify(stored.bonuses)}`);
    await shot("5-after-close");
    writeFileSync(`${OUT}/verify-native-equip.json`,
        JSON.stringify({ s1, s2, s3, s4, final, stored }, null, 1) + "\n");
    ok(errors.length === 0, `page errors: ${errors.join(" | ")}`);
} catch (e) {
    problems.push(`exception at [${step}]: ${e.message}`);
} finally {
    await browser.close();
}

if (problems.length) {
    console.error(`FAIL verify_native_equip:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
} else {
    console.log("verify_native_equip: OK (See Equipment: slot list -> item list -> equip writes the record and bag -> remove restores -> close commits to state.equipment/bag/localStorage)");
}
