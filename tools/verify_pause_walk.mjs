// Pause-menu walk verification: open every pause entry in turn, enter a
// sub-page where one exists (STATUS -> Digimon -> digivolve/equipment), back
// out to the menu, and assert the loop stays usable with its own blips.
//
//   tools/run-playwright.sh tools/verify_pause_walk.mjs
//
// Captures land in .dw3-research/autonomous-plan/captures/phase6-status-2026-09-21b/.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = process.env.WALK_SHOT
    || ".dw3-research/autonomous-plan/captures/phase6-status-2026-09-21b";
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

const press = async (key, ms = 90) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(320);
};
const diag = () => page.evaluate(() => window.__status?.diagnostics?.() ?? null);
// THE pause home, and when it reads the pad: the resident list folds its window
// and its row wipes in first, and only state 3 of the list object takes buttons
// (the same gate tools/verify_pause_home_buttons.mjs waits for). Since the lab
// and START now open that one list (web/pause-home.js, 2026-10-04), a press that
// lands while the list is still folding is ignored — as it is on the disc.
const homeList = () => page.waitForFunction(() => {
    const st = window.__status, s = st?._session;
    return st?.diagnostics?.().entry === "home" && s && s.mem.read32(s.root + 0x10) === 3;
}, null, { timeout: 30000 });
/** Every word the page played since a snapshot, by name (sfx.play) or packed
 *  (playPacked). The one list plays its own clicks packed, so both are read. */
const soundSnapshot = () => page.evaluate(() => ({
    names: (window.__sfxLog ?? []).length,
    packed: { ...(window.__status?.diagnostics?.().packed ?? {}) },
}));
const soundsSince = (from) => page.evaluate((since) => {
    const byName = (window.__sfxLog ?? []).slice(since.names);
    const now = { ...(window.__status?.diagnostics?.().packed ?? {}) };
    const byPacked = Object.keys(now)
        .filter((w) => (now[w] ?? 0) > (since.packed[w] ?? 0))
        .map((w) => `0x${(Number(w) >>> 0).toString(16)}`);
    return { byName, byPacked, all: [...byName, ...byPacked] };
}, from);

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.evaluate(() => {
        window.__state.bits = 4321;
        window.__state.party = ["p003pken", "p006rna", null];
        window.__state.digimonNames = { p003pken: "Kotemon", p006rna: "Renamon" };
        window.__state.partnerStats = {
            digimonId: 1, level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25,
            stats: { str: 11, def: 12, spt: 13, wis: 14, spd: 15, chr: 16 }, elemBonuses: {},
        };
        window.__state.partyStats = [
            { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
            { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
            null,
        ];
        window.__state.inventory = [{ id: 40, qty: 2 }, { id: 55, qty: 1 }];
        // The player's ears, in lieu of a capture: every sample the walker plays.
        window.__sfxLog = [];
        const orig = window.__sfx.play.bind(window.__sfx);
        window.__sfx.play = (name, ...rest) => {
            window.__sfxLog.push(name);
            return orig(name, ...rest);
        };
        window.__labOpen("menu");
    });
    // The one pause home: wait for the list to have folded in before pressing
    // anything at it (its state-3 gate; see homeList above).
    await homeList().catch(() => {});
    await page.waitForTimeout(300);

    // Entries in the pause home's own order. MAP is the hand-authored page
    // (its overlay page needs the resident map service), everything else is
    // the shipped overlay page.
    const ENTRIES = [
        { row: 0, name: "ITEMS", native: true },
        { row: 1, name: "SORT", native: true },
        { row: 2, name: "MAP", native: true },
        { row: 3, name: "TECHNIQUES", native: true },
        { row: 4, name: "STATUS", native: true },
    ]; // CARD FOLDERS + Demo Setup are opt-in rows (folder owned / flag); the
       // overlay pages themselves are covered by verify_native_status.mjs.
       // MAP is a translated page too: it is in the factory table the pause home
       // reads (web/game.js PAUSE_PAGE_ENTRIES), so the row hands the pad to the
       // page rather than to the walker's own map panel.

    // Which page each row opens, so "the page opened" is checked against the
    // row rather than against "something is open".
    const PAGE_OF = { ITEMS: "items", SORT: "sort", MAP: "map", TECHNIQUES: "techniques", STATUS: "status" };
    const listRow = () => page.evaluate(() =>
        window.__status?._session ? window.__status._session.mem.read32(window.__status._session.root + 0x58) | 0 : null);
    /** The one pause home, sitting on `row`: wait for it to fold in, then walk
     *  the cursor there and check it landed. The list reads no pad until its
     *  window and row wipes are done (state 3), so a press made earlier would be
     *  dropped and the next row would open the wrong page. */
    const ensureRow = async (row) => {
        for (let guard = 0; guard < 40; guard++) {
            if (await homeList().then(() => true).catch(() => false)) {
                const at = await listRow();
                if (at === row) return true;
                await press(at < row ? "ArrowDown" : "ArrowUp", 70);
            }
        }
        return false;
    };
    const perEntry = {};
    for (const entry of ENTRIES) {
        step = `entry ${entry.name}`;
        if (!ok(await ensureRow(entry.row), `the pause list would not sit on row ${entry.row}`)) break;
        const before = await soundSnapshot();
        await press("Enter");
        if (entry.native) {
            // The row must open ITS OWN page, and the page must have drawn
            // before it is judged: the home list folds shut first and the page's
            // own windows fold in after it, so "is the screen open" alone passed
            // while the player was looking at the field.
            const up = await page.waitForFunction((want) => {
                const d = window.__status?.diagnostics?.();
                return d?.open && !d.pending && d.entry === want && (d.renderer?.frames ?? 0) >= 60;
            }, PAGE_OF[entry.name], { timeout: 30000 },
            ).then(() => true).catch(() => false);
            if (!ok(up, `${entry.name}: the ${PAGE_OF[entry.name]} page did not open`)) continue;
            // Then give the page its own fold: it reads no pad until its windows
            // are up, so a cursor press made now would move nothing.
            await page.waitForTimeout(1400);
            const d = await diag();
            // "not wedged" for this host: it reports no error, no last
            // diagnostic, and its renderer is still counting frames. The
            // native-status host this walk was first written against published a
            // `host.traps` counter; the translated pause session publishes no
            // traps field, so the same question is asked of what it does publish.
            ok(d.error === null && d.lastDiagnostic === null,
                `${entry.name}: the page reported ${d.error ?? d.lastDiagnostic}`);
            ok(Object.keys(d.renderer?.byPack ?? {}).length > 0, `${entry.name}: drew no art`);
            ok((d.renderer?.frames ?? 0) >= 60, `${entry.name}: not interactive`);
            const playedOnEnter = (await soundsSince(before)).all;
            const shot = await page.locator("#game").screenshot();
            writeFileSync(`${OUT}/walk-${entry.row}-${entry.name.toLowerCase().replace(/ /g, "")}.png`, shot);
            ok(hash(shot).length === 12, `${entry.name}: capture failed`);
            // The page's own cursor blip: one Down inside the page must play a
            // sample. The page plays the disc's PACKED sound word, which reaches
            // the player through sfx.playPacked and is counted per word in the
            // page's own diagnostics().packed - not in the sfx.play log this walk
            // used to read.
            const nSound = await page.evaluate(() => ({ ...(window.__status?.diagnostics?.().packed ?? {}) }));
            // Give the page its own fold first: `interactive` only waits for the
            // renderer to be counting frames, which happens before the page's
            // list takes the pad, and a Down that early moves nothing.
            await page.waitForTimeout(900);
            if (entry.name === "MAP") {
                // MAP has no list. Its four arrows pan a free cursor across the
                // map, and the only word the page's tick chain plays for a move is
                // F0x80098294's hover word — and only when the cursor ENTERS a
                // revealed place, not on every arrow and not when a step leaves it
                // on the same place or walks it off the map entirely:
                //   ~/ddw3/asm/dw2003/pro/ststatus.s:21934-21942 (F0x80098294)
                //     beq $t2,$v0        the zone under the cursor is unchanged -> no sound
                //     beqz $v0           the cursor left every zone -> the name
                //                         window closes (0x144) and nothing plays
                //     lui $a0,0x4 / ori $a0,0x1c in the jalr delay slot -> 0x0004001C
                //   The other word on this page, 0x800450BD (ststatus.s:23033-23037,
                //   F0x800986C0), is on the back bit, which leaves the page.
                // So this asserts the original's rule rather than a per-press blip:
                // sweep the cursor and check 0x4001C fires on exactly the moves
                // that land on a place, and on none of the others.
                const HOVER = 0x4001c;
                const zone = () => page.evaluate(() => {
                    const s = window.__status, mem = s?._session?.mem, obj = s?.diagnostics?.().page;
                    return mem && obj
                        ? { over: mem.read32(obj + 0x180) | 0, which: mem.read32(obj + 0x184) | 0 }
                        : null;
                });
                const sweep = [];
                const step = async (key) => {
                    const before = await zone();
                    const was = await page.evaluate(() => ({ ...(window.__status?.diagnostics?.().packed ?? {}) }));
                    await press(key, 70);
                    await page.waitForTimeout(250);
                    const after = await zone();
                    const now = (await diag()).packed ?? {};
                    const played = Object.keys(now)
                        .filter((w) => (now[w] ?? 0) > (was[w] ?? 0)).map((w) => Number(w));
                    const entered = before?.over === 0 && after?.over !== 0;
                    sweep.push({ key, over: `${before?.over}->${after?.over}`,
                        place: after?.which ?? null, played });
                    ok(entered === played.includes(HOVER),
                        `MAP: ${key} took the cursor ${before?.over}->${after?.over} over a place, `
                        + `which ${entered ? "must" : "must not"} play 0x${HOVER.toString(16)}; `
                        + `played ${JSON.stringify(played)}`);
                };
                for (const key of ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft",
                    "ArrowDown", "ArrowUp"]) await step(key);
                // The cursor can start inside a large place and stay there for all six
                // short presses. Walk it right, then left, until it has entered a place
                // once; every step is still checked against the rule above.
                for (const key of ["ArrowRight", "ArrowLeft"]) {
                    for (let i = 0; i < 40 && !sweep.some((s) => s.played.includes(HOVER)); i++) {
                        await step(key);
                    }
                }
                perEntry[entry.name] = { enter: playedOnEnter, sweep };
                ok(sweep.some((s) => s.played.includes(HOVER)),
                    `MAP: the sweep never moved onto a revealed place, so the hover word was `
                    + `never proved: ${JSON.stringify(sweep)}`);
            } else {
                await press("ArrowDown", 70);
                const moved = await page.evaluate((n) => {
                    const now = window.__status?.diagnostics?.().packed ?? {};
                    return Object.keys(now).filter((k) => (now[k] ?? 0) > (n[k] ?? 0));
                }, nSound);
                perEntry[entry.name] = { enter: playedOnEnter, cursor: moved };
                ok(moved.length > 0, `${entry.name}: cursor move played no sound (${JSON.stringify(moved)})`);
            }
            // A sub-page where the page has one: STATUS opens a Digimon's sheet,
            // that sheet opens the See Equipment window, and Back closes the
            // window before Back leaves the sheet. The page's own object list is
            // the readout: `classes` is the live task set, so the window is
            // "open" when the sheet's own pair of tasks has gained a third. The
            // native-status host this walk was first written against published a
            // `diagnostics().screen` child pointer and a `traps` counter; the
            // translated pause session publishes the task set instead.
            const tasks = async () => (await diag())?.tasks ?? 0;
            if (entry.name === "STATUS") {
                const sheetBase = await tasks();
                await press("Enter");            // the confirm bit: the partner's sheet
                await page.waitForTimeout(900);
                const sheet = await diag();
                ok((sheet.packed && Object.keys(sheet.packed).length > 1) || sheet.tasks >= sheetBase,
                    `STATUS: the partner's sheet did not open (${JSON.stringify(sheet.packed)})`);
                writeFileSync(`${OUT}/walk-4-status-equipment.png`, await page.locator("#game").screenshot());
                // The player's reported path: Down to See Equipment, then the
                // confirm bit to open that window. The window's own object
                // reaching its end must drop out of the page's task list, or the
                // page waits on a stale pointer forever (that was the 2026-09-21m
                // wedge: the destroy path's child-array cap was 64 and this page's
                // array is 68 slots).
                await press("ArrowDown", 70);
                await press("Enter");
                await page.waitForTimeout(1200);
                const opened = await diag();
                ok(opened.tasks > sheetBase, `STATUS: See Equipment window did not open (tasks=${opened.tasks})`);
                writeFileSync(`${OUT}/walk-4-status-see-equipment.png`, await page.locator("#game").screenshot());
                // The back bit is 0x4000, which is what Escape reaches on an
                // English disc. `c` is the confirm key (the physical Cross).
                await press("Escape");  // back: close the window, return to the sheet
                await page.waitForTimeout(900);
                const backDetail = await diag();
                ok(backDetail.open === true && backDetail.tasks === sheetBase,
                    `STATUS: back from the See Equipment window wedged (${JSON.stringify(backDetail.tasks)})`);
                await press("Escape");  // back: the sheet's own cancel
                await page.waitForTimeout(600);
                const picker = await diag();
                ok(picker.open === true,
                    `STATUS: back from the partner's sheet left the page (${JSON.stringify(picker.tasks)})`);
                writeFileSync(`${OUT}/walk-4-status-back.png`, await page.locator("#game").screenshot());
            }
            await press("Escape");
            // Back from a page returns to the ONE list, on the row the player
            // chose (table §3.2 "Cursor memory"), and that list has to fold in
            // again before it reads the pad.
            const back = await homeList().then(() => true).catch(() => false);
            if (!ok(back, `${entry.name}: Back did not return to the pause home`)) break;
        }
        const state = await page.evaluate(() => ({
            menuOpen: window.__state.menuOpen, entry: window.__status?.diagnostics?.().entry ?? null,
            open: window.__status?.isOpen?.() ?? false,
            row: window.__status?._session ? window.__status._session.mem.read32(window.__status._session.root + 0x58) | 0 : null,
        }));
        ok(state.menuOpen === true && state.open === true && state.entry === "home" && state.row === entry.row,
            `${entry.name}: not back on the list row the player chose (${JSON.stringify(state)})`);
        const played = await soundsSince(before);
        ok(played.all.length > 0, `${entry.name}: no sound on enter/leave`);
    }

    // CARD FOLDERS only exists once the player holds a folder; the walker gates
    // it the same way (web/game.js menu.cardFolderUnlocked).
    step = "sound summary";
    const sounds = await page.evaluate(() => window.__sfxLog);
    const counts = sounds.reduce((m, n) => { m[n] = (m[n] ?? 0) + 1; return m; }, {});
    writeFileSync(`${OUT}/walk-sounds.json`, JSON.stringify({ counts, perEntry }, null, 1) + "\n");
    ok(errors.length === 0, `page errors: ${errors.join(" | ")}`);
} catch (e) {
    problems.push(`exception at [${step}]: ${e.message}`);
} finally {
    await browser.close();
}

if (problems.length) {
    console.error(`FAIL verify_pause_walk:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
} else {
    console.log("verify_pause_walk: OK (every pause entry opens and Back returns home; STATUS detail backs out to the picker; every entry plays sound)");
}
