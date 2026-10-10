// Pause/status route verifier: drives the real game with real key events and
// asserts the pause pages are what the player gets, that they draw their own
// art, that input moves the selection, that Back to Menu returns to the field,
// that what the page wrote is read back into the walker's state on close, and
// that the pause menu's own STATUS row hands over to the page. Run through
// tools/run-playwright.sh.
//
//   VERIFY_PORT=8760 tools/run-playwright.sh tools/verify_native_status.mjs
//
// The production route is the TRANSLATED pause (engine/dw3/ui PauseRootSession
// behind web/status-translated.js): the walker's own state is handed to it, and
// the session's snapshot is read back once on close. The original-code overlay
// is still reachable with ?nativeStatus=1 (web/status-native.js), which is a
// research reference, not the route a player gets, so this verifier drives the
// translated one and probes the session's own task tree instead of a native
// screen object's RAM.
//
// Captures land in .dw3-research/autonomous-plan/captures/phase6-status-2026-09-21/.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = process.env.STATUS_SHOT
    || ".dw3-research/autonomous-plan/captures/phase6-status-2026-09-21";
mkdirSync(OUT, { recursive: true });

const problems = [];
let step = "start";
const ok = (cond, msg) => { if (!cond) problems.push(msg); return cond; };
const hash = (buf) => createHash("sha1").update(buf).digest("hex").slice(0, 12);
// The page folds in before it reads the pad (the original's own open animation,
// ~35 frames), so cancel does nothing until it is up. Waiting for frames is the
// page-agnostic form of "the fold-in finished" — and because the renderer counts
// every frame the page has drawn since the page loaded, the wait is a DELTA from
// the frame count at the open, or a second page would sail through on the first
// one's frames and take the press during its own fold.
const drawn = (page) => page.evaluate(() => window.__status?.diagnostics?.().renderer?.frames ?? 0);
const drawnSince = (page, base, frames) => page.waitForFunction(
    ({ base, frames }) => {
        const d = window.__status?.diagnostics?.();
        return d?.open === true && d.pending === false && ((d.renderer?.frames ?? 0) - base) >= frames;
    }, { base, frames }, { timeout: 30000 },
);
/** Open a page the way the pause menu does and wait until it is up and drawing. */
const openEntry = async (page, entry) => {
    await page.evaluate((e) => window.__labOpen("status", e), entry);
    const base = await drawn(page);
    await drawnSince(page, base, 25);
};
const interactive = async (page) => drawnSince(page, await drawn(page), 60);

/**
 * The thirteen numbers the STATUS sheet prints, read out of the roster record
 * the page keeps them in (record +0x30 the six core, +0x3c the seven element
 * halfwords). The page itself rebuilds them through F0x80017174 from that record
 * plus the worn gear, so the record is what the sheet's element value is made of.
 */
const sheetRecord = (page) => page.evaluate(() => {
    const mem = window.__status?._session?.mem;
    if (!mem) return null;
    const REC = 0x80049494, STRIDE = 0x3dc;
    const slot = mem.read32(0x80048d34 + 0x70) | 0;
    const base = REC + slot * STRIDE;
    return {
        slot,
        core: Array.from({ length: 6 }, (_, i) => mem.read16(base + 0x30 + i * 2)),
        elements: Array.from({ length: 7 }, (_, i) => mem.read16(base + 0x3c + i * 2)),
    };
});

/**
 * The "See Digivolve" page's own thirteen numbers, read off the drawn widgets,
 * plus the scratch it copied them from.
 *
 * The original builds them in F0x80088A44 (pro/ststatus, lifted at
 * .bunny-scratch/lift/ststatus/ststatus.promoted.s:6174): it calls
 * `[ctx+0x2734]` — F0x80017174 — with its own stack buffer as the destination
 * (`.L0x00005e1c`/`.L0x00005e28`, and the no-form branch at `.L0x00006160`/
 * `.L0x00006168`), then reads it through the two offset tables 0x8009A7FC (six
 * core, the indices 6..11) and 0x8009A814 (seven elements, 12..18), adds the
 * chosen form's species-record halfwords and caps at 999. So the page has no
 * seed of its own: it reads the same roster record the STATUS sheet does.
 *
 * The thirteen number widgets live in the page object's own child block at +0x34
 * .. +0x7c, six then seven, exactly as `digivolveCtor` writes them
 * (engine/dw3/ui/native/pause-digivolve.ts:114-115); the tree's own record holds
 * that block's address, so nothing here re-derives the layout. A widget's line 0
 * is the game's own glyph string (ASCII minus 0x2C), so the digits decode back.
 */
const DIGIVOLVE_HANDLER = 0x8008b3c8;
const digivolvePanel = (page) => page.evaluate((handler) => {
    const s = window.__status?._session;
    const mem = s?.mem;
    if (!s || !mem) return null;
    const task = [...s.tree.tasks.values()].find((t) => t.classId === handler);
    if (!task) return { none: true };
    const ui = task.children;
    const digits = (widget) => {
        const lineRec = widget + 0x5c;
        const buffer = mem.read32(lineRec) >>> 0;
        const length = mem.read16(lineRec + 6) & 0xff;
        let out = "";
        for (let i = 0; i < length; i++) out += String.fromCharCode(mem.read8(buffer + i) + 0x2c);
        return out;
    };
    const slot = mem.read32(0x80048d34 + 0x70) | 0;
    const rec = 0x80049494 + slot * 0x3dc;
    const scratch = s.scratchBlock;
    return {
        slot,
        partyPosition: mem.read32(task.address + 0x70) | 0,
        subState: mem.read32(task.address + 0x10) | 0,
        numbers: Array.from({ length: 13 }, (_, i) => digits(mem.read32(ui + 0x34 + i * 4) >>> 0)),
        // F0x80017174's own 0x2C-byte copy: halfword 6..11 are record +0x30..+0x3a
        // and 12..18 are record +0x3c..+0x48.
        scratchCore: Array.from({ length: 6 }, (_, i) => mem.read16s(scratch + (6 + i) * 2)),
        scratchElements: Array.from({ length: 7 }, (_, i) => mem.read16s(scratch + (12 + i) * 2)),
        recordCore: Array.from({ length: 6 }, (_, i) => mem.read16(rec + 0x30 + i * 2)),
        recordElements: Array.from({ length: 7 }, (_, i) => mem.read16(rec + 0x3c + i * 2)),
    };
}, DIGIVOLVE_HANDLER);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.evaluate(() => {
        window.__state.bits = 4321;
        window.__state.party = ["p003pken", "p006rna", null];
        window.__state.partnerStats = {
            digimonId: 1, level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25,
            stats: { str: 11, def: 12, spt: 13, wis: 14, spd: 15, chr: 16 }, elemBonuses: {},
        };
        window.__state.partyStats = [
            { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
            { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
            { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
        ];
        window.__state.inventory = [{ id: 40, qty: 1 }];
        window.__labOpen("status");
    });

    // The page must boot and draw its own art, with nothing erroring.
    step = "await first boot";
    await page.waitForFunction(() => window.__status?.isOpen?.() === true, null, { timeout: 60000 });
    await drawnSince(page, await drawn(page), 30);
    const first = await page.evaluate(() => window.__status.diagnostics());
    ok(first.open === true, `page is not open: ${JSON.stringify(first)}`);
    ok(first.tasks > 0, `no page task is running (tasks=${first.tasks})`);
    ok(first.error === null && first.lastDiagnostic === null,
        `the translated page reported an error: ${first.error ?? first.lastDiagnostic}`);
    ok((first.renderer?.byPack?.ststat ?? 0) > 0,
        `the pause art pack drew nothing: ${JSON.stringify(first.renderer?.byPack ?? {})}`);
    await page.waitForTimeout(400);
    const shotA = await page.locator("#game").screenshot();
    writeFileSync(`${OUT}/native-status-open.png`, shotA);

    // Input: the list highlight must move (the pad word reaches the page).
    step = "await first fold";
    await interactive(page);
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(80);
    await page.keyboard.up("ArrowDown");
    await page.waitForTimeout(350);
    const shotB = await page.locator("#game").screenshot();
    writeFileSync(`${OUT}/native-status-down.png`, shotB);
    ok(hash(shotA) !== hash(shotB), "ArrowDown did not change the drawn frame");

    // Every pause page the menu can reach must reach its own screen.
    step = "entries loop";
    // The translated factory table's rows (web/game.js PAUSE_PAGE_ENTRIES):
    // ITEMS / SORT / MAP / TECHNIQUES / STATUS / CARD FOLDERS. MAP is in the
    // list now because the translated route ports the resident map service the
    // original-code route could not build; Demo Setup is not a row of the
    // original's table (web/game.js:463) and stays the walker's own panel.
    const ENTRIES = ["items", "sort", "map", "techniques", "status", "cardfolders"];
    for (const entry of ENTRIES) {
        await openEntry(page, entry);
        const d = await page.evaluate(() => window.__status.diagnostics());
        ok(d.entry === entry, `pause entry ${entry} opened ${d.entry} instead`);
        ok(d.error === null && d.lastDiagnostic === null,
            `entry ${entry} errored: ${d.error ?? d.lastDiagnostic}`);
        ok((d.renderer?.byPack?.ststat ?? 0) > 0, `entry ${entry} drew no pause art`);
        await page.waitForTimeout(300);
        writeFileSync(`${OUT}/native-pause-${entry}.png`, await page.locator("#game").screenshot());
        await interactive(page);
        await page.keyboard.down("Escape");
        await page.waitForTimeout(80);
        await page.keyboard.up("Escape");
        await page.waitForFunction(() => window.__status?.isOpen?.() === false, null, { timeout: 20000 })
            .catch(() => problems.push(`entry ${entry}: Back to Menu did not close`));
    }

    // The sheet's seven element numbers must carry the trained points. The
    // original's value is the stored halfword F0x80017174 copies — the species
    // base plus every trained point — plus the worn gear's coded resist, capped
    // at 999; the record the page reads is that stored halfword, so this checks
    // the rule against the species row the page itself resolved rather than a
    // magic number (a level-1 Kotemon reads 85/125/80/80/115/100/95 in the
    // original's own capture, docs/research/ui/captures/original-status-2026-09-03).
    step = "trained element points on the sheet";
    const TRAINED = 30;
    const openSheet = async (trained) => {
        await page.evaluate(({ trained }) => {
            const block = (extra = {}) => ({
                digimonId: 1, level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25,
                stats: { str: 11, def: 12, spt: 13, wis: 14, spd: 15, chr: 16 },
                bonuses: {}, ...extra,
            });
            const elems = {};
            for (const k of ["fire", "water", "ice", "wind", "thunder", "machine", "dark"]) {
                elems[k] = trained;
            }
            window.__state.party = ["p003pken", "p006rna", null];
            window.__state.partnerStats = block({ elemBonuses: elems });
            window.__state.partyStats = [window.__state.partnerStats, block(), block()];
            window.__labOpen("status", "status");
        }, { trained });
        await page.waitForFunction(() => window.__status?.isOpen?.() === true, null, { timeout: 60000 });
        await interactive(page);
        // "Choose Digimon" -> confirm opens the partner's sheet; the page folds it
        // in over ~35 frames after the pick, so wait well past one fold.
        await page.keyboard.down("c");
        await page.waitForTimeout(90);
        await page.keyboard.up("c");
        await drawnSince(page, await drawn(page), 110);
        return { frame: await page.locator("#game").screenshot(), record: await sheetRecord(page) };
    };
    const plain = await openSheet(0);
    const trainedSheet = await openSheet(TRAINED);
    writeFileSync(`${OUT}/native-status-sheet-no-trained-points.png`, plain.frame);
    writeFileSync(`${OUT}/native-status-sheet-trained-points.png`, trainedSheet.frame);
    const speciesBase = await page.evaluate(() => {
        const db = window.__menu?.digimonDB ?? {};
        return ["fire", "water", "ice", "wind", "thunder", "machine", "dark"]
            .map((k) => Number(db?.[1]?.resistances?.[k] ?? 0));
    });
    ok(plain.record !== null && trainedSheet.record !== null,
        `could not read the roster record the sheet prints (${JSON.stringify(plain.record)})`);
    ok(JSON.stringify(trainedSheet.record?.elements)
        === JSON.stringify(plain.record?.elements.map((v, i) => v + TRAINED)),
        `trained points missing from the sheet: ${JSON.stringify(trainedSheet.record?.elements)}`
        + ` vs base+${TRAINED} ${JSON.stringify(plain.record?.elements?.map((v) => v + TRAINED))}`);
    ok(trainedSheet.record?.elements.every((v, i) => v === speciesBase[i] + TRAINED),
        `the sheet's seven are the species row plus the trained points: ${JSON.stringify(speciesBase)}`
        + ` -> ${JSON.stringify(trainedSheet.record?.elements)}`);
    ok(hash(trainedSheet.frame) !== hash(plain.frame),
        "the sheet drew the same frame with and without the trained points");

    // "See Digivolve" on the partner's sheet: the thirteen numbers the original's
    // F0x80088A44 prints, off the widgets it wrote. They come out of the SAME
    // roster record the sheet reads, through the SAME F0x80017174 copy, so they
    // must be the partner's own numbers and never zero — this is the case the
    // page's own child used to draw an all-zero panel for, because the record it
    // copies was never seeded.
    step = "See Digivolve panel numbers";
    await page.keyboard.down("c");
    await page.waitForTimeout(90);
    await page.keyboard.up("c");
    const opened = await page.waitForFunction((h) => [...window.__status?._session?.tree?.tasks?.values?.() ?? []]
        .some((t) => t.classId === h), DIGIVOLVE_HANDLER, { timeout: 20000 })
        .then(() => true).catch(() => false);
    ok(opened, "See Digivolve did not open the DIGIVOLVE page");
    await drawnSince(page, await drawn(page), 150);
    const panel = await digivolvePanel(page);
    writeFileSync(`${OUT}/native-status-see-digivolve.png`, await page.locator("#game").screenshot());
    ok(panel !== null && panel.none !== true,
        `the DIGIVOLVE page was not a live task: ${JSON.stringify(panel)}`);
    ok(panel?.partyPosition === panel?.slot,
        `the page opened the wrong partner: position ${panel?.partyPosition}, roster slot ${panel?.slot}`);
    // No form is chosen here (obj+0x6c is 0), so F0x80088A44 prints the record's
    // own halfwords with nothing added, and the scratch it copied them into must
    // equal the record byte for byte.
    ok(JSON.stringify(panel?.scratchCore) === JSON.stringify(panel?.recordCore)
        && JSON.stringify(panel?.scratchElements) === JSON.stringify(panel?.recordElements),
        `the page's F0x80017174 copy is not the roster record: ${JSON.stringify(panel?.scratchCore)}`
        + ` / ${JSON.stringify(panel?.scratchElements)} vs ${JSON.stringify(panel?.recordCore)}`
        + ` / ${JSON.stringify(panel?.recordElements)}`);
    ok(panel?.numbers.slice(0, 6).join(",") === (panel?.recordCore ?? []).join(",")
        && panel?.numbers.slice(6).join(",") === (panel?.recordElements ?? []).join(","),
        `the panel printed ${JSON.stringify(panel?.numbers)}, not the partner's own`
        + ` ${JSON.stringify([...(panel?.recordCore ?? []), ...(panel?.recordElements ?? [])])}`);
    ok((panel?.numbers ?? []).every((v) => v !== "" && Number(v) > 0),
        `the panel printed a blank or a zero: ${JSON.stringify(panel?.numbers)}`);
    // The partner here is a level-12 Kotemon, so the trained 30 points must be in
    // the seven element numbers the player sees, not just in the record.
    ok(panel?.numbers.slice(6).every((v, i) => Number(v) === speciesBase[i] + TRAINED),
        `the panel's seven are not the species row plus the trained points: ${JSON.stringify(speciesBase)}`
        + ` + ${TRAINED} -> ${JSON.stringify(panel?.numbers?.slice(6))}`);

    // Leave the page closed for the checks below. The sheet's own Back row walks
    // back to the list first, so the page's own close is the deterministic way out.
    await page.evaluate(() => window.__status?.close?.());
    await page.waitForFunction(() => window.__status?.isOpen?.() === false, null, { timeout: 20000 })
        .catch(() => problems.push("sheet probe: the page did not close"));

    step = "cancel from entries";
    // Back to Menu (Triangle = key Escape) again with nothing open: the field
    // takes it and no screen comes up. The entries loop above already closed the
    // last page, so this press is the redundant-path check.
    await page.keyboard.down("Escape");
    await page.waitForTimeout(80);
    await page.keyboard.up("Escape");
    await page.waitForTimeout(400);
    const closed = await page.evaluate(() => ({ open: window.__status.diagnostics().open,
        menuOpen: window.__state.menuOpen, statusOpen: window.__status.isOpen() }));
    ok(closed.open === false && closed.statusOpen === false, `page still open: ${JSON.stringify(closed)}`);
    const shotC = await page.locator("#game").screenshot();
    writeFileSync(`${OUT}/native-status-closed.png`, shotC);
    ok(hash(shotC) !== hash(shotB), "closing did not return to a different frame (field expected)");

    // Commit probe: every field the close-time read-back applies is proved by
    // changing it in the SCREEN's RAM (the page would do the same when the
    // player acts), closing, and checking the walker's state picked it up.
    step = "commit probe open";
    // The card collection the album screens read must be in place, as it is for
    // a player whose starter pack has arrived.
    await page.waitForFunction(() => (window.__cards?.()?.folders?.length ?? 0) > 0, null, { timeout: 30000 })
        .catch(() => problems.push("starter card folders never appeared"));
    // The card collection's own read-back does not apply here — the translated
    // pause writes no card cells (web/status-translated.js readBack) — so the
    // probe covers the fields that route does commit.
    await page.evaluate(() => {
        window.__state.bits = 4321;
        window.__state.party = ["p003pken", "p006rna", null];
        window.__state.partyStats = [
            { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
            { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
            { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
        ];
        window.__state.inventory = [{ id: 40, qty: 1 }];
        window.__state.equipment = [];
        window.__labOpen("status", "items");
    });
    step = "commit probe poke";
    await interactive(page);
    const poked = await page.evaluate(() => {
        // The translated session's own memory, in the walker's RAM addresses the
        // overlay keeps (engine/dw3/ui/pause-root-session.ts): money 0x80048da0,
        // bag 0x80048d34+0x7c, roster record 0x80049494+0x3dc, party map
        // 0x80048d34+0x70.
        const m = window.__status._session?.mem;
        if (!m) return "no translated session memory";
        m.write32(0x80048da0, 4000, 4);                    // BIT spent
        m.write8(0x80048d34 + 0x7c + 40, 0, 1);           // the item was used up
        m.write16(0x80049494 + 0x3dc + 0x28, 30, 2);       // that member's HP changed
        m.write16(0x80049494 + 0x3dc + 0x3c8, 215, 2);     // that member wears a Bandanna
        m.write32(0x80048d34 + 0x70 + 0, 1, 4);            // formation: slot 1 to the lead
        m.write32(0x80048d34 + 0x70 + 4, 0, 4);
        m.write32(0x80048d34 + 0x70 + 8, 2, 4);
        return null;
    });
    ok(poked === null, `commit probe could not reach the screen's RAM: ${poked}`);
    await page.keyboard.down("Escape");
    await page.waitForTimeout(80);
    await page.keyboard.up("Escape");
    await page.waitForFunction(() => window.__status?.isOpen?.() === false, null, { timeout: 20000 })
        .catch(() => problems.push("commit probe: Back to Menu did not close"));
    const committed = await page.evaluate(() => ({
        bits: window.__state.bits,
        inventory: window.__state.inventory,
        hp: window.__state.partyStats?.[0]?.hp,
        partyLead: window.__state.party?.[0],
        partnerHp: window.__state.partnerStats?.hp,
        // The lead pedestal took roster slot 1's record, so its worn head slot
        // and its stat fields must both come from record 1 (the src[] mapping).
        equipHead: window.__state.equipment?.[0]?.head ?? null,
        // The translated route writes the collection from the album screens, not
        // from the pause page, so these must be untouched by the close.
        card5: window.__cards?.()?.owned?.get?.(5) ?? null,
        storedBits: Number(localStorage.getItem("bits")),
    }));
    ok(committed.bits === 4000, `BIT not committed: ${committed.bits}`);
    ok(!(committed.inventory ?? []).some((s) => s.id === 40), `bag not committed: ${JSON.stringify(committed.inventory)}`);
    ok(committed.hp === 30, `roster HP not committed: ${committed.hp}`);
    ok(committed.partyLead === "p006rna", `party order not committed: ${committed.partyLead}`);
    ok(committed.partnerHp === 30, `lead partnerStats not re-pointed: ${committed.partnerHp}`);
    ok(committed.equipHead === 215, `equipment not committed to the moved pedestal: ${committed.equipHead}`);
    ok(committed.card5 === null, `the pause page wrote the card collection: ${committed.card5}`);
    writeFileSync(`${OUT}/native-status-committed.json`, JSON.stringify(committed, null, 1) + "\n");

    step = "pause menu hand-off";
    // Player path: the pause menu's own STATUS row must hand over to the page
    // (the legacy status-list must not be used). ITEMS / SORT / MAP / TECHNIQUES
    // / STATUS, so four steps down the list is STATUS, and the disc confirms a
    // pause row with Cross (web/menu.js:772, UI-PAUSE-CROSS-CONFIRMS-LIVE-2026-09-29).
    await page.evaluate(() => window.__labOpen("menu"));
    // The one pause home (web/pause-home.js) folds its window and its row wipes
    // in before it reads the pad — its state 3 — so the walk down the list waits
    // for that; a step pressed earlier is dropped, exactly as on the disc.
    const listUp = await page.waitForFunction(() => {
        const s = window.__status?._session;
        return window.__status?.diagnostics?.().entry === "home" && s && s.mem.read32(s.root + 0x10) === 3;
    }, null, { timeout: 30000 }).then(() => true).catch(() => false);
    ok(listUp, "the pause home did not finish folding in");
    for (let i = 0; i < 4; i++) {
        await page.keyboard.down("ArrowDown");
        await page.waitForTimeout(70);
        await page.keyboard.up("ArrowDown");
        await page.waitForTimeout(160);
    }
    const statusRow = await page.evaluate(() => {
        const s = window.__status?._session;
        return s ? s.mem.read32(s.root + 0x58) | 0 : null;
    });
    ok(statusRow === 4, `the cursor did not walk down to STATUS (row ${statusRow})`);
    await page.keyboard.down("c");
    await page.waitForTimeout(80);
    await page.keyboard.up("c");
    // The list folds shut and only then does the page open, so the hand-off is
    // judged on the page itself — "something is open" is already true, the list
    // was.
    const handed = await page.waitForFunction(() => window.__status?.diagnostics?.().entry === "status",
        null, { timeout: 20000 }).then(() => true).catch(() => false);
    ok(handed, `pause menu STATUS row did not open the page (entry ${await page.evaluate(() => window.__status?.diagnostics?.().entry ?? null)})`);
    const menuScreen = await page.evaluate(() => window.__menu?.screen ?? null);
    ok(menuScreen !== "status-list", `legacy status-list was used (menu.screen=${menuScreen})`);
    // The page ignores the pad while it folds in; input before that is dropped.
    await interactive(page);
    await page.waitForTimeout(200);
    writeFileSync(`${OUT}/native-status-via-menu.png`, await page.locator("#game").screenshot());
    // Back from a page returns to the pause home on the row the player chose —
    // table §3.2 "Cursor memory" — and Back from there closes the pause. One
    // Escape cannot do both, which is why this used to wait for the page to
    // close and time out.
    await page.keyboard.down("Escape");
    await page.waitForTimeout(80);
    await page.keyboard.up("Escape");
    const backHome = await page.waitForFunction(() => window.__status?.diagnostics?.().entry === "home",
        null, { timeout: 20000 }).then(() => true).catch(() => false);
    ok(backHome, `Back from the page did not return to the pause home (entry ${
        await page.evaluate(() => window.__status?.diagnostics?.().entry ?? null)})`);
    const homeReady = await page.waitForFunction(() => {
        const s = window.__status?._session;
        return window.__status?.diagnostics?.().entry === "home" && s && s.mem.read32(s.root + 0x10) === 3;
    }, null, { timeout: 30000 }).then(() => true).catch(() => false);
    ok(homeReady, "the returned pause home did not fold in");
    const backRow = await page.evaluate(() => {
        const s = window.__status?._session;
        return s ? s.mem.read32(s.root + 0x58) | 0 : null;
    });
    ok(backRow === 4, `the list came back on row ${backRow}, not the STATUS row 4`);
    await page.keyboard.down("Escape");
    await page.waitForTimeout(80);
    await page.keyboard.up("Escape");
    await page.waitForFunction(() => window.__status?.isOpen?.() === false, null, { timeout: 20000 })
        .catch(() => problems.push("Back from the pause home did not close it"));

    if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
    writeFileSync(`${OUT}/native-status-see-digivolve.json`, JSON.stringify({ panel }, null, 1) + "\n");
    writeFileSync(`${OUT}/state.json`,
        JSON.stringify({ first, closed, committed, panel, hashes: { shotA: hash(shotA), shotB: hash(shotB), shotC: hash(shotC) }, errors }, null, 1) + "\n");
} catch (e) {
    problems.push(`exception at [${step}]: ${e.message}`);
} finally {
    await browser.close();
}

if (problems.length) {
    console.error(`FAIL verify_native_status:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
} else {
    console.log("verify_native_status: OK (six pause pages boot -> draw ststat art -> highlight moves -> Back to Menu -> field -> close-time read-back commits BIT/bag/roster/formation/equipment -> pause menu STATUS row hands over)");
}
