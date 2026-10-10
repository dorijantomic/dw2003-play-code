// Focused production-route verifier: the partner-naming screen (pro/stdgname),
// Phase 6.3 group 3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md.
//
// Runs the real web/game.js and opens the screen the way a player does: the DRI
// desk's rename story flag (bank 0x7C index 1). It asserts:
//   * the naming screen booted as the translated pro/stdgname root (the task
//     tree holds F0x8008645C and its partner chooser), 0 errors;
//   * the keyboard grid seeds its name from the roster record the walker filled;
//   * typing with real keys changes the grid (A..D), and OK (the real cell,
//     row 6 col 13, reached with the pad) exports the name;
//   * the chooser comes back for the next partner, and ONE Back press leaves
//     the screen once the chooser is reading the pad;
//   * the committed name reaches the walker's state (state.digimonNames) and
//     localStorage through the adapter.
//
//   tools/run-playwright.sh tools/verify_native_nameentry.mjs
//
// Setup: `python3 -m http.server <port> --directory web`, VERIFY_PORT=<port>.
//
// The production route is the TRANSLATED naming screen (engine/dw3/ui
// NameRootSession behind web/nameentry-translated.js): no interpreter runs, so
// the probes read the session's own task tree and memory — the same cells the
// original kept (the keyboard object is the port of the object whose handler is
// 0x80085078, the chooser's index cell 0x80087F3C, the roster record at
// 0x80049494 + slot*0x3DC). `?nativeName=1` keeps the original-code screen
// (web/nameentry-native.js) as a research reference.
//
// Contract: research answer stdgname-commit-and-close (accepted 2026-09-22) and
// the measurements in .dw3-research/autonomous-plan/phase6-route-inventory.md.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.NAME_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.NAME_SHOT || "/tmp/opencode/native-nameentry-verify";
mkdirSync(OUT, { recursive: true });

// The naming root (F0x8008645C), its partner chooser (F0x80085DE4) and the
// keyboard object (F0x80085078) keep the original's handler addresses as their
// class ids, so a task found by class id is that screen's own object.
const ROOT_CLASS = 0x8008645c;
const CHOOSER_CLASS = 0x80085de4;
const KEYBOARD_CLASS = 0x80085078;
const CHOOSER_INDEX_CELL = 0x80087f3c;
// The one sub-state of the chooser that reads the pad: slot 4 of the seven-word
// table at 0x80082F58, target F0x8008601C (engine/dw3/ui/native/partner-select.ts
// PARTNER_SELECT_INPUT_SUB).
const CHOOSER_INPUT_SUB = 4;
const RECORD_BASE = 0x80049494;
const RECORD_STRIDE = 0x3dc;
const PARTY_MAP = 0x80048d34 + 0x70;
const LEAD_NAME = "ABC";
const TYPED = "ADC";
const SECOND_MEMBER = process.env.NAME_TARGET === "second";

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(`pageerror: ${e.message}`); });
page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (text.includes("Failed to load resource")) return;
    pageErrors.push(`console: ${text}`);
});

await page.addInitScript((secondMember) => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p003pken");
    localStorage.setItem("party", JSON.stringify(secondMember ? ["p003pken", "p004kogu"] : ["p003pken"]));
    localStorage.setItem("bits", "5000");
}, SECOND_MEMBER);

// Circle = Enter, d-pad = arrows. Right is logical 5, Down logical 6. The naming
// screen reads the pad bits the disc does, so Circle (0x2000) confirms and Cross
// (0x4000) is Back (engine/dw3/ui/native/name-keyboard.ts BTN_OK/BTN_BACK).
const press = async (key, ms = 90) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(110);
};

/** The translated session's task tree, its memory and the adapter's own report. */
const diag = () => page.evaluate(({ rootClass, chooserClass, keyboardClass, indexCell }) => {
    const n = window.__nameEntryNative;
    const session = n?._session ?? null;
    const mem = session?.mem ?? null;
    const rd = (a, size) => (mem ? (size === 1 ? mem.read8(a) : size === 2 ? mem.read16(a) : mem.read32(a)) >>> 0 : null);
    const hex = (base, len) => (mem ? Array.from({ length: len }, (_, i) => mem.read8(base + i).toString(16).padStart(2, "0")).join(" ") : null);
    const tasks = session ? [...session.tree.tasks.values()] : [];
    const find = (cls) => tasks.find((t) => t.classId === cls)?.address ?? null;
    const grid = find(keyboardClass);
    return {
        open: n?.isOpen?.() ?? false,
        adapter: n?.diagnostics?.() ?? null,
        root: find(rootClass),
        chooser: find(chooserClass),
        gridAddr: grid,
        rootLife: (() => { const r = find(rootClass); return r ? rd(r + 0xc, 4) : null; })(),
        grid: grid === null ? null : {
            col: rd(grid + 0x9c, 4), row: rd(grid + 0xa0, 4),
            life: rd(grid + 0xc, 4), sub: rd(grid + 0x10, 4), name: hex(grid + 0x78, 0x10),
        },
        pair: rd(indexCell, 4),
        selected: session?.selectedPosition?.() ?? null,
        names: session?.names?.().map((b) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(" ")) ?? null,
    };
}, { rootClass: ROOT_CLASS, chooserClass: CHOOSER_CLASS, keyboardClass: KEYBOARD_CLASS, indexCell: CHOOSER_INDEX_CELL });

/** The keyboard is up: its task is in the tree. */
const keyboardUp = () => page.waitForFunction(
    (cls) => {
        const s = window.__nameEntryNative?._session;
        return !!s && [...s.tree.tasks.values()].some((t) => t.classId === cls);
    }, KEYBOARD_CLASS, { timeout: 15000 },
);

try {
    await page.goto(`${ROOT}?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 40000 });
    console.log("[verify] game booted");

    const lead = await page.evaluate((secondMember) => window.__state?.party?.[secondMember ? 1 : 0] ?? null, SECOND_MEMBER);
    check("the walker has the target partner", !!lead, `target=${lead}`);
    // The player's current name for the lead: a real prerequisite, not the
    // asserted value (the assertion is the name typed at the keyboard).
    await page.evaluate(({ id, secondMember }) => {
        window.__state.digimonNames = { ...(window.__state.digimonNames ?? {}), [id]: "ABC" };
        if (secondMember) window.__state.digimonNames[window.__state.party[0]] = "FIRST";
    }, { id: lead, secondMember: SECOND_MEMBER });

    // The DRI desk's rename: bank 0x7C index 1.
    await page.evaluate(() => window.__applyStoryFlag(0x7c01, true));
    await page.waitForFunction(() => window.__nameEntryNative?.isOpen?.() === true, { timeout: 15000 });
    await page.waitForFunction(() => window.__nameEntryNative?.diagnostics?.().pending === false, null, { timeout: 20000 });
    await page.waitForTimeout(1500);

    let s = await diag();
    console.log("[verify] opened:", JSON.stringify({ ...s, adapter: { ...s.adapter, renderer: s.adapter?.renderer?.frames } }));
    check("the DRI rename opened the naming screen", s.open === true, `open=${s.open}`);
    // The naming root is the port of pro/stdgname's F0x8008645C, and the partner
    // chooser that opens in front of the keyboard is F0x80085DE4.
    check("the naming root is pro/stdgname's", s.root !== null && s.chooser !== null,
        `root=${s.root === null ? null : `0x${s.root.toString(16)}`} chooser=${s.chooser === null ? null : `0x${s.chooser.toString(16)}`}`);
    // The translated route runs no interpreter, so "the screen is live" is the
    // session stepping its own tree every frame.
    const framesA = s.adapter?.renderer?.frames ?? 0;
    await page.waitForTimeout(400);
    const framesB = (await diag()).adapter?.renderer?.frames ?? 0;
    check("the translated screen is stepping", (s.adapter?.tasks ?? 0) >= 2 && framesB > framesA,
        `tasks=${s.adapter?.tasks} frames=${framesA}->${framesB}`);
    check("zero errors on entry", s.adapter?.error === null,
        `error=${s.adapter?.error} page=${pageErrors.join(" | ")}`);
    check("the grid has not appeared before the pre-screen is passed", s.grid === null, `grid=${JSON.stringify(s.grid)}`);
    await page.screenshot({ path: `${OUT}/01-pre-screen.png` });

    // The walker's name reaches the roster record the screen seeds from.
    const seeded = await page.evaluate((f) => {
        const s2 = window.__nameEntryNative?._session;
        const mem = s2?.mem;
        const rd = (a, size) => (mem ? (size === 1 ? mem.read8(a) : size === 2 ? mem.read16(a) : mem.read32(a)) >>> 0 : null);
        const hex = (base, len) => Array.from({ length: len }, (_, i) => rd(base + i, 1).toString(16).padStart(2, "0")).join(" ");
        const slot = rd(f.party + (f.secondMember ? 4 : 0), 4);
        return { slot, name: hex(f.rec + slot * f.stride + 8, 8) };
    }, { party: PARTY_MAP, rec: RECORD_BASE, stride: RECORD_STRIDE, secondMember: SECOND_MEMBER });
    console.log("[verify] roster record:", JSON.stringify(seeded));
    check("the roster record carries a seeded name", seeded.name.startsWith("0e 0f 10"), `name=${seeded.name}`);

    // Choose the second partner when checking that the result reaches the
    // selected member rather than the first member.
    if (SECOND_MEMBER) {
        await press("ArrowDown", 140);
        s = await diag();
        check("the second partner is selected", s.pair === 1 && s.selected === 1, `pair=${s.pair} selected=${s.selected}`);
    }
    // Pre-screen confirm -> the keyboard.
    await press("Enter", 140);
    await keyboardUp();
    await page.waitForTimeout(600);
    s = await diag();
    console.log("[verify] keyboard:", JSON.stringify(s.grid));
    check("the keyboard grid appeared", !!s.grid, `grid=${JSON.stringify(s.grid)}`);
    check("the grid seeded the roster name", (s.grid?.name ?? "").startsWith("82 60 82 61 82 62"),
        `keyboard+0x78=${s.grid?.name}`);
    await page.screenshot({ path: `${OUT}/02-keyboard.png` });

    // Type: Circle on (0,0) writes 'A' and advances; Right x3 -> 'D'; Circle.
    await press("Enter", 140);
    for (let i = 0; i < 3; i++) await press("ArrowRight", 90);
    await press("Enter", 140);
    s = await diag();
    console.log("[verify] typed:", JSON.stringify(s.grid?.name));
    check("typing changed the grid name", (s.grid?.name ?? "").startsWith("82 60 82 63 82 62"),
        `keyboard+0x78=${s.grid?.name}`);

    // OK cell = row 6 col 13: Right x10 from col 3, then Down x5.
    for (let i = 0; i < 10; i++) await press("ArrowRight", 90);
    for (let i = 0; i < 5; i++) await press("ArrowDown", 90);
    s = await diag();
    console.log("[verify] at OK:", JSON.stringify(s.grid ? { col: s.grid.col, row: s.grid.row } : null));
    check("the cursor reached the OK cell", s.grid?.col === 13 && s.grid?.row === 6,
        `col=${s.grid?.col} row=${s.grid?.row}`);
    await page.screenshot({ path: `${OUT}/03-at-ok.png` });

    // OK exports the name: the screen writes it into the roster record and
    // records the commit, then the partner chooser comes back for the next one
    // (pro/stdgname's own sequence, name-sequence.ts case 0x3 -> 0x4).
    await press("Enter", 160);
    await page.waitForFunction(() => window.__nameEntryNative?.diagnostics?.().commits === 1, null, { timeout: 15000 })
        .catch(() => { /* the export check below reports it */ });
    await page.waitForTimeout(700);
    s = await diag();
    console.log("[verify] after OK:", JSON.stringify({ commits: s.adapter?.commits, names: s.names, grid: !!s.grid }));
    // The export writes into the roster record, in the game's own byte encoding
    // (web/nameentry-translated.js encodeGameName: 0x0E+n = A-Z).
    const wantRecord = [...TYPED].map((ch) => (0x0e + ch.charCodeAt(0) - 65).toString(16).padStart(2, "0")).join(" ");
    check("OK committed the typed name through the screen's export",
        s.adapter?.commits === 1 && (s.names?.[SECOND_MEMBER ? 1 : 0] ?? "").startsWith(wantRecord),
        `commits=${s.adapter?.commits} names=${JSON.stringify(s.names)} want=${wantRecord}`);
    check("the chooser came back for the next partner", s.grid === null && s.chooser !== null,
        `grid=${JSON.stringify(s.grid)}`);
    await page.screenshot({ path: `${OUT}/04-back-at-chooser.png` });

// Back (Cross) at the chooser is how the player leaves the screen; the
    // screen's own close fade runs and the adapter hands the commits over.
    //
    // The original reads the pad in exactly one sub-state of the chooser:
    // F0x8008601C, jump-table slot 4 of the seven-word table at 0x80082F58,
    // the only branch of F0x80085DE4 that calls F0x80085B70. Slots 0..3 walk
    // the rows forward a step per ready widget and never look at a button, so
    // Back pressed while the chooser is still building its rows is dropped by
    // the screen itself, not by the walker. One Cross there plays 0x800450BD,
    // writes -1 into the root's +0x60 and calls its +0x68 (the close fade); the
    // root's own sequence F0x80086184 case 1 (0x800861F4) sees +0x60 == -1 and
    // jumps straight to its sub-state 5, the exit path.
    //
    // So: wait for the chooser to reach the sub-state that reads the pad, then
    // press Back exactly once. Leaving the screen on the first press is the
    // claim; needing a second press is a failure. Back is word bit 0x4000, which
    // the one pad map reaches with Escape or x (engine/systems/input-map.ts,
    // commit 173ebcf0); `c` reached that bit before 2026-10-03 and confirms now.
    const reading = await page.waitForFunction(
        () => window.__nameEntryNative?.diagnostics?.().chooserReadingPad === true,
        null, { timeout: 15000 }).then(() => true).catch(() => false);
    const subAtPress = await page.evaluate(() => window.__nameEntryNative?.diagnostics?.().chooserSub ?? null);
    check("the chooser reached the sub-state that reads the pad", reading && subAtPress === CHOOSER_INPUT_SUB,
        `chooserSub=${subAtPress}, need ${CHOOSER_INPUT_SUB} (F0x8008601C, slot 4)`);
    await press("Escape", 160);
    const left = await page.waitForFunction(
        () => window.__nameEntryNative?.isOpen?.() === false,
        null, { timeout: 6000 }).then(() => true).catch(() => false);
    console.log(`[verify] left the naming screen on Back press 1 (chooser sub ${subAtPress} when pressed)`);
    check("one Back press at the chooser leaves the screen", left,
        `still open after press 1: chooserSub=${await page.evaluate(() => window.__nameEntryNative?.diagnostics?.().chooserSub ?? null)}`);
    await page.waitForTimeout(800);
    const done = await page.evaluate((leadId) => ({
        open: window.__nameEntryNative?.isOpen?.() ?? null,
        result: window.__nameEntryNative?.result?.() ?? null,
        value: window.__nameEntryNative?.value?.() ?? null,
        stateName: window.__state?.digimonNames?.[leadId] ?? null,
        firstName: window.__state?.digimonNames?.[window.__state?.party?.[0]] ?? null,
        stored: (() => { try { return JSON.parse(localStorage.getItem("digimonNames") ?? "{}")[leadId] ?? null; } catch { return null; } })(),
    }), lead);
    console.log("[verify] committed:", JSON.stringify(done));
    await page.screenshot({ path: `${OUT}/05-back-in-game.png` });

    check("the screen handed the typed name back", done.value === TYPED, `value=${done.value}`);
    check("the name reached the selected partner", done.stateName === TYPED && done.result?.memberId === lead,
        `state.digimonNames=${done.stateName}, result=${JSON.stringify(done.result)}`);
    check("the name persisted", done.stored === TYPED, `localStorage=${done.stored}`);
    if (SECOND_MEMBER) check("the first partner keeps its name", done.firstName === "FIRST", `first=${done.firstName}`);
    check("the screen closed and control returned", left && done.open === false, `open=${done.open}`);
    if (SECOND_MEMBER) {
        await page.evaluate(() => window.__applyStoryFlag(0x7c01, true));
        await page.waitForFunction(() => window.__nameEntryNative?.isOpen?.() === true, { timeout: 15000 });
        await page.waitForTimeout(1500);
        await press("c", 160);
        console.log("[verify] after cancel:", JSON.stringify(await diag()));
        await page.waitForFunction(() => window.__nameEntryNative?.isOpen?.() === false, null, { timeout: 8000 })
            .catch(async () => {
                await press("c", 160);
                await page.waitForFunction(() => window.__nameEntryNative?.isOpen?.() === false, null, { timeout: 8000 })
                    .catch(() => { /* the checks below report it */ });
            });
        const cancelled = await page.evaluate((id) => ({
            result: window.__nameEntryNative?.result?.() ?? null,
            selectedName: window.__state?.digimonNames?.[id] ?? null,
            stored: (() => { try { return JSON.parse(localStorage.getItem("digimonNames") ?? "{}")[id] ?? null; } catch { return null; } })(),
        }), lead);
        check("cancel returns without accepting a name", cancelled.result?.accepted === false,
            JSON.stringify(cancelled.result));
        check("cancel leaves the selected name in state", cancelled.selectedName === TYPED,
            `name=${cancelled.selectedName}`);
        check("cancel leaves the saved name alone", cancelled.stored === TYPED,
            `stored=${cancelled.stored}`);
        await page.screenshot({ path: `${OUT}/06-cancel-back-in-game.png` });
    }
    check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

    console.log(`[verify] captures: ${OUT}/01-pre-screen.png, 02-keyboard.png, 03-at-ok.png, 04-back-at-chooser.png, 05-back-in-game.png${SECOND_MEMBER ? ", 06-cancel-back-in-game.png" : ""}`);
    if (failures) {
        console.error(`FAIL native naming: ${failures} check(s) failed`);
        process.exitCode = 1;
    } else {
        console.log(`PASS native naming: DRI rename -> pro/stdgname -> typed "${TYPED}" -> chooser -> Back -> committed to state and localStorage, 0 errors`);
    }
} catch (e) {
    console.error("FAIL native naming: " + e.message);
    if (pageErrors.length) console.error(pageErrors.join("\n"));
    process.exitCode = 1;
} finally {
    await browser.close();
}
