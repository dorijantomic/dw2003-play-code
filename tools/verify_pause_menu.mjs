// The pause journeys that CHANGE something, driven from the field's START.
//
// Until 2026-10-04 this file drove the UI lab's Status Menu button and then read
// `window.__menu`'s own fields (screen, techCursor, sortPick, detailFocus,
// techInfoSel, demoCursor) — web/menu.js's hand-written copy of the pause, which
// the one-pause-list cutover removed from every route a player reaches. Those
// reads had been reading fields nothing wrote for a while, and the run then died
// on a screenshot timeout. The list a player meets is the translated one
// (engine/dw3/ui/pause-root-session.ts behind web/status-translated.js), opened by
// the field's START, so this file drives THAT and reads the page's own memory the
// way the tick writes it.
//
// What survives here is the part of the old file that was still true and is NOT
// already covered by tools/verify_pause_walk.mjs (every row opens and Back returns
// on it, MAP's hover rule, STATUS backing out of See Equipment) or
// tools/verify_pause_home_buttons.mjs (every key, its sound, the clamp, no wrap,
// each row's page class and the remembered row): the journeys that move the game.
//
//   * TECHNIQUES  — a heal actually heals, costs its own MP, and is refused at
//                   full HP with "No effect." and nothing spent.
//   * SORT        — the card already locked can never be chosen again, and the
//                   two partners really swap places.
//   * STATUS      — the sheet's prompt is TWO rows and Back from See Equipment
//                   lands on the row you left from.
//   * See Digivolve — Battle Digivolve On/Off really turns it on and off, and the
//                   technique list under it skips an empty slot.
//
// Two assertions from the old file are GONE because the disc has no such behaviour:
//
//   * ITEMS -> "Sort Items" on Square. No pad read anywhere in the pause overlay
//     asks for Square (logical bit 0xF). Counting every `li $a1, bit` that feeds
//     the `0x408(port, bit)` remap call in ~/ddw3/asm/dw2003/pro/ststatus.s gives
//     exactly the eight bits the table lists — 4, 5, 6, 7, 0xA, 0xB, 0xD and 0xE, at
//     38/38/24/22/8/8/7/7, 152 lookups in all — the same set
//     docs/research/ui/pause-home-button-table-2026-10-04.md §1 and
//     pause-menu-chrome-decoded-2026-09-04.md §3 tabulate. The "Sort Items" legend
//     and its By Strength / By Name rows are strings the code never reaches
//     (button table §11); web/menu.js stopped binding Square too (web/menu.js:782).
//   * The Digivolve Demo setup screen and its "the row must be absent from the
//     normal menu" check. Nothing in the original can select that screen: the pause
//     row cell D0x8005CCF0 has two writers in the whole corpus, both the list's own
//     cursor field, and the row count is the Card Folder flag plus five, so the
//     Demo Setup factory sits one row past the last row the cursor can reach
//     (ledger UI-DEMO-SETUP-SCREEN-HAS-NO-SELECTOR-WRITE-2026-08-14). It is a
//     developer extra in the UI lab, and the translated home has five or six rows
//     with no such row to be absent from.
//
// Every value below is read out of the page's own RAM while it is on screen, the
// way the tick writes it, and the walker's own state is read back after the page
// folds shut. assets/native/** is denied for the whole run, so no original
// instruction can execute on any route below.
//
// Serve THIS worktree's web/ on your own port, then:
//   VERIFY_PORT=8952 tools/run-playwright.sh tools/verify_pause_menu.mjs [outDir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const PORT = Number(process.env.VERIFY_PORT ?? 8952);
const ROOT = `${baseUrl(PORT)}/`;
const OUT = process.argv[2] ?? ".bunny-scratch/pause-menu";
mkdirSync(OUT, { recursive: true });

// The page object each pause row's factory makes, by the handler the session registers.
const TECHNIQUES = 0x80096380, SORT = 0x800980b0, STATUS = 0x8008e744;
const EQUIPMENT = 0x80088214, DIGIVOLVE = 0x8008b3c8;
// The home list's own rows (button table §3.1).
const ROW = { items: 0, sort: 1, map: 2, techniques: 3, status: 4, cardfolders: 5 };
// The roster record block: base, stride, and the halfwords the pages read and write.
const REC = 0x80049494, STRIDE = 0x3dc;
const REC_FORM = 4, REC_HP = 0x28, REC_MAX_HP = 0x2a, REC_MP = 0x2c;
// The three pedestals' roster slots (PARTY_MAP): the SORT page's whole output.
const PARTY_MAP = 0x80048da4;
// The technique record table, one 0x12-byte record per technique id (id 1 first).
const TECH_TABLE = 0x80042bdc, TECH_STRIDE = 0x12;
// Small Heal, the one single-target healing technique this check uses.
const SMALL_HEAL = 184;
const FORMS = [16, 17, 18];   // three acquired forms, as digimon.json ids
// The one technique slot that is not empty and not the first: the technique list
// must step over the hole at index 1 and land on index 2.
const FILLED = [53, 0, SMALL_HEAL, 0, 0, 0];
const FILLED_LAST = 2;
// web/party.js CHARID_TO_DIGID: the field starter "p003pken" is digimon.json id 1.
const BASE_FORM = 1;

let failures = 0;
const log = [];
const check = (name, ok, detail = "") => {
    const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    log.push(line);
    console.log(line);
    if (!ok) failures++;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [], executableRequests = [];
page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) pageErrors.push(`console: ${m.text()}`); });
// Nothing under assets/native may load: the pages under test are translated code.
await page.route("**/assets/native/**", (route) => { executableRequests.push(route.request().url()); return route.abort(); });
await page.addInitScript(() => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
});

// `i` is START, `c`/Enter are the player's confirm (logical bit 0xD) and Escape/`x`
// are back (0xE) on an English disc (engine/systems/input-map.ts KEYBOARD_BINDINGS;
// button table §0).
const press = async (key, ms = 110, after = 320) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(after);
};
const diag = () => page.evaluate(() => window.__status.diagnostics());
const packedNow = () => page.evaluate(() => ({ ...window.__status.diagnostics().packed }));
const hex = (k) => `0x${(Number(k) >>> 0).toString(16)}`;
const delta = (a, b) => Object.keys(b).filter((k) => (b[k] ?? 0) - (a[k] ?? 0) > 0)
    .map((k) => `${hex(k)}x${b[k] - (a[k] ?? 0)}`).sort();
const until = (promise) => promise.then(() => true).catch(() => false);

/** The one pause home, open and reading the pad (its state-3 gate). */
const homeReady = () => page.waitForFunction(() => {
    const s = window.__status, sess = s?._session;
    return s?.diagnostics?.().entry === "home" && s.diagnostics().pending === false && sess &&
        sess.mem.read32(sess.root + 0x10) === 3;
}, null, { timeout: 40000 });
const closed = () => page.waitForFunction(() => window.__status?.isOpen?.() === false, null, { timeout: 30000 });
/** Field START, on a fixture whose scripted opening has been settled. */
const openHome = async () => {
    await page.evaluate(() => {
        if (window.__cutscene?.isActive?.()) { window.__cutscene.start([], null, null); window.__cutscene.step(1); }
        window.__state.menuOpen = false;
    });
    await page.waitForTimeout(1500);
    await press("i", 140, 500);
    await homeReady();
    await page.waitForTimeout(600);
};
const leaveHome = async () => {
    for (let n = 0; n < 16 && (await diag()).open; n++) await press("Escape", 110, 700);
    await closed();
};
const homeRow = () => page.evaluate(() => {
    const s = window.__status._session;
    return s.mem.read32(s.root + 0x58) | 0;
});
/** The home list, sitting on `row`; walks the cursor there first. */
const ensureRow = async (row) => {
    for (let guard = 0; guard < 30; guard++) {
        if (await until(homeReady())) {
            const at = await homeRow();
            if (at === row) return true;
            await press(at < row ? "ArrowDown" : "ArrowUp", 90, 150);
        }
    }
    return false;
};
/** Open one row's page with the player's confirm key, from the field. */
const openRow = async (name, cls) => {
    await openHome();
    if (!await ensureRow(ROW[name])) { check(`START reaches the ${name} row`, false, "the list would not sit on it"); return false; }
    await press("c");
    const up = await until(page.waitForFunction(([want, handler]) => {
        const d = window.__status?.diagnostics?.();
        return d?.open === true && !d.pending && d.entry === want &&
            d.classes.includes(handler) && (d.renderer?.frames ?? 0) >= 60;
    }, [name, cls], { timeout: 40000 }));
    if (!up) { check(`${name}: CONFIRM opens its page`, false, JSON.stringify(await diag())); return false; }
    await page.waitForTimeout(1200);
    return true;
};
/** Wait until the task of class `cls` holds `want` at `obj + off`. */
const waitTaskWord = (cls, off, want) => page.waitForFunction(([c, o, w]) => {
    const s = window.__status?._session;
    if (!s) return false;
    for (const t of s.tree.tasks.values()) if (t.classId === c) return (s.mem.read32(t.address + o) | 0) === w;
    return false;
}, [cls, off, want], { timeout: 30000 });
const waitTaskPresent = (cls) => page.waitForFunction((c) => {
    const s = window.__status?._session;
    if (!s) return false;
    for (const t of s.tree.tasks.values()) if (t.classId === c) return true;
    return false;
}, cls, { timeout: 30000 });
const waitTaskGone = (cls) => page.waitForFunction((c) => {
    const s = window.__status?._session;
    if (!s) return false;
    for (const t of s.tree.tasks.values()) if (t.classId === c) return false;
    return true;
}, cls, { timeout: 30000 });
/** The live word at `obj + off` of the task of class `cls`, or null. */
const taskWord = (cls, off) => page.evaluate(([c, o]) => {
    const s = window.__status?._session;
    if (!s) return null;
    for (const t of s.tree.tasks.values()) if (t.classId === c) return s.mem.read32(t.address + o) | 0;
    return null;
}, [cls, off]);
/** Press `key` until the task of class `cls` reaches `want` at `obj + off`. */
const pressUntil = async (key, cls, off, want, tries = 4) => {
    if (await until(waitTaskWord(cls, off, want))) return true;
    for (let i = 0; i < tries; i++) {
        await press(key);
        if (await until(waitTaskWord(cls, off, want))) return true;
    }
    return false;
};

// ---- reads out of the live page -------------------------------------------------
// Injected once: the game's own text codes (web/status-translated.js encodePauseName,
// button table): 0x04+n a digit, 0x0E+n a capital, 0x28+n a lower-case letter, the
// pair 0x01,0x01 a space, anything else punctuation that prints as nothing.
const READ_PAGE = `
  window.__read = {
    task(cls) {
      const s = window.__status?._session;
      if (!s) return 0;
      for (const t of s.tree.tasks.values()) if (t.classId === cls) return t.address;
      return 0;
    },
    r32(addr) { const s = window.__status?._session; return s ? (s.mem.read32(addr) | 0) : null; },
    r16(addr) { const s = window.__status?._session; return s ? s.mem.read16(addr) : null; },
    r8(addr) { const s = window.__status?._session; return s ? s.mem.read8(addr) : null; },
    rec(slot) {
      const s = window.__status?._session; if (!s) return null;
      const m = s.mem, at = (o) => ${REC} + slot * ${STRIDE} + o;
      return { formValue: m.read32(at(${REC_FORM})) >>> 0, hp: m.read16(at(${REC_HP})),
        maxHp: m.read16(at(${REC_MAX_HP})), mp: m.read16(at(${REC_MP})) };
    },
    partyMap() {
      const s = window.__status?._session; if (!s) return null;
      return [0, 1, 2].map((i) => s.mem.read32(${PARTY_MAP} + i * 4) >>> 0);
    },
    techCost(id) {
      const s = window.__status?._session; if (!s) return null;
      return s.mem.read16(${TECH_TABLE} + (id - 1) * ${TECH_STRIDE});
    },
    /** The text the widget at widget-block offset slot of that class's page shows. */
    text(cls, slot) {
      const s = window.__status?._session; if (!s) return null;
      const mem = s.mem, obj = this.task(cls);
      if (!obj) return null;
      const ui = mem.read32(obj + 0x24) >>> 0;
      const widget = mem.read32(ui + slot) >>> 0;
      if (!widget) return null;
      const rec = widget + 0x5c, buf = mem.read32(rec) >>> 0, len = mem.read16(rec + 6) & 0xff;
      if (!buf) return "";
      let out = "", i = 0;
      for (; i < len; i++) {
        const c = mem.read8(buf + i);
        if (c === 0x01) { if (mem.read8(buf + i + 1) === 0x01) { out += " "; i++; } continue; }
        if (c >= 0x04 && c <= 0x0d) out += String(c - 0x04);
        else if (c >= 0x0e && c <= 0x27) out += String.fromCharCode(0x41 + c - 0x0e);
        else if (c >= 0x28 && c <= 0x47) out += String.fromCharCode(0x61 + c - 0x28);
      }
      return out;
    },
    texts(cls, slots) { return slots.map((s) => this.text(cls, s)); },
    /** A cursor widget's placed position, the way verify_pause_home_buttons reads it. */
    cursorPos(cls, slot) {
      const s = window.__status?._session; if (!s) return null;
      const mem = s.mem, obj = this.task(cls);
      if (!obj) return null;
      const ui = mem.read32(obj + 0x24) >>> 0;
      const w = mem.read32(ui + slot) >>> 0;
      if (!w) return null;
      return { x: mem.read32(w + 0x58) | 0, y: mem.read32(w + 0x5c) | 0, visible: mem.read32(w + 0x64) | 0 };
    },
  };
`;

/** The lead's own numbers the walker's state holds, after a page folded shut. */
const walkerStats = (i) => page.evaluate((n) => {
    const s = window.__state;
    const rec = s.partyStats?.[n] ?? null;
    return rec ? { digimonId: rec.digimonId, hp: rec.hp, mp: rec.mp } : null;
}, i);

/**
 * Field START -> the STATUS row -> the lead's sheet -> See Digivolve, waiting until
 * the form list is the state reading the pad.
 */
const openDigivolve = async () => {
    if (!await openRow("status", STATUS)) return false;
    await press("c");                              // the lead's sheet
    await until(waitTaskWord(STATUS, 0x14, 5));    // its two-row prompt
    await press("c");                              // row 0 = See Digivolve
    const up = await until(waitTaskPresent(DIGIVOLVE));
    await until(waitTaskWord(DIGIVOLVE, 0x10, 4));
    return up;
};

/** A party the journeys can move: three partners, the lead holding a heal. */
const seedParty = () => page.evaluate(([forms, filled]) => {
    const s = window.__state;
    s.party = ["p003pken", "p004kogu", "p006rna"];
    const ledger = () => [
        { id: forms[0], formLevel: 12, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
        { id: forms[1], formLevel: 12, dvexp: 0, techSlots: filled },
        { id: forms[2], formLevel: 12, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
    ];
    const block = (digimonId, hp, maxHp, mp, maxMp) => ({
        digimonId, level: 20, xp: 100, tp: 30, hp, maxHp, mp, maxMp,
        stats: { str: 50, def: 40, spt: 30, wis: 20, spd: 10, chr: 5 },
        elemBonuses: {}, formLedger: ledger(), equippedForms: [...forms],
    });
    s.partyStats = [block(forms[0], 45, 500, 200, 200), block(forms[0], 490, 500, 40, 200), block(forms[0], 300, 300, 30, 200)];
    s.partnerStats = s.partyStats[0];
    s.inventory = [{ id: 43, qty: 3 }];
    s.equipment = [];
    s.bits = 4321;
}, [FORMS, FILLED]);

try {
    await page.goto(`${ROOT}?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await seedParty();
    await page.evaluate(READ_PAGE);

    // ── TECHNIQUES: the heal lands, costs its MP, and is refused at full HP ──────
    if (await openRow("techniques", TECHNIQUES)) {
        check("the row's own page is the translated TECHNIQUES page",
            (await diag()).classes.includes(TECHNIQUES), "");
        // "Choose Digimon" -> pick the lead -> the partner's heal list.
        await press("c");
        const listed = await until(waitTaskWord(TECHNIQUES, 0x10, 0x1f));
        check("choosing the lead opens its list of healing techniques", listed,
            JSON.stringify(await page.evaluate(() => window.__read.r32(window.__read.task(0x80096380) + 0x10))));
        // The lead's own heal list, at member 0's block (+0xDC is the count, +0xD0
        // the five technique ids F0x800937A4 filled).
        const heals = await page.evaluate((cls) => {
            const r = window.__read, obj = r.task(cls);
            const count = r.r32(obj + 0xdc) | 0;
            const ids = [];
            for (let i = 0; i < count; i += 1) ids.push(r.r16(obj + 0xd0 + i * 2));
            return { count, ids };
        }, TECHNIQUES);
        check("the lead is offered Small Heal and nothing else it knows",
            heals.count === 1 && heals.ids[0] === SMALL_HEAL, JSON.stringify(heals));
        await page.screenshot({ path: `${OUT}/01-techniques.png` });
        // Confirm the technique -> "Use it on who?"
        const before = await page.evaluate(() => [window.__read.rec(0), window.__read.rec(1)]);
        await press("c");
        const target = await until(waitTaskWord(TECHNIQUES, 0x10, 0x20));
        check("confirming a single-target heal asks who to use it on", target,
            JSON.stringify(await page.evaluate(() => window.__read.r32(window.__read.task(0x80096380) + 0x10))));
        check("the prompt reads Use it on who?",
            (await page.evaluate((cls) => window.__read.text(cls, 0), TECHNIQUES) ?? "").includes("Use it on who"),
            JSON.stringify(await page.evaluate((cls) => window.__read.text(cls, 0), TECHNIQUES)));
        // Aim at the second partner, who is ten HP short.
        await press("ArrowDown");
        const aimed = await page.evaluate(() => window.__read.r32(window.__read.task(0x80096380) + 0x84));
        check("the target cursor moves to the second partner", aimed === 1, `row=${aimed}`);
        const cost = await page.evaluate((id) => window.__read.techCost(id), SMALL_HEAL);
        const sounds = await packedNow();
        await press("c");
        const healed = await until(waitTaskWord(TECHNIQUES, 0x10, 0x24));
        check("confirming the target uses the technique", healed, "");
        const after = await page.evaluate(() => [window.__read.rec(0), window.__read.rec(1)]);
        check("the chosen partner is healed to the top of its HP bar",
            after[1].hp === after[1].maxHp && after[1].hp > before[1].hp,
            `${before[1].hp}/${before[1].maxHp} -> ${after[1].hp}/${after[1].maxHp}`);
        check("the caster pays the technique's own MP cost and nobody else does",
            after[0].mp === before[0].mp - cost && after[1].mp === before[1].mp,
            JSON.stringify({ cost, caster: [before[0].mp, after[0].mp], target: [before[1].mp, after[1].mp] }));
        check("a heal that landed plays the recovery word",
            delta(sounds, await packedNow()).includes("0x40014x1"), JSON.stringify(delta(sounds, await packedNow())));
        check("the window says the HP went back up",
            (await page.evaluate((cls) => window.__read.text(cls, 0x88), TECHNIQUES) ?? "").includes("HP healed"),
            JSON.stringify(await page.evaluate((cls) => window.__read.text(cls, 0x88), TECHNIQUES)));
        await page.screenshot({ path: `${OUT}/02-healed.png` });
        // Use it again on the same, now full, partner. Dismissing the message the
        // disc put up returns to the target picker, not to the technique list.
        await press("c");
        const backToTarget = await until(waitTaskWord(TECHNIQUES, 0x10, 0x20));
        check("dismissing the message leaves the target picker where it was",
            backToTarget && (await taskWord(TECHNIQUES, 0x84)) === 1,
            JSON.stringify({ state: await taskWord(TECHNIQUES, 0x10), target: await taskWord(TECHNIQUES, 0x84) }));
        const refused0 = await page.evaluate(() => [window.__read.rec(0), window.__read.rec(1)]);
        const refusedSounds = await packedNow();
        await press("c");
        await until(waitTaskWord(TECHNIQUES, 0x10, 0x24));
        const refused1 = await page.evaluate(() => [window.__read.rec(0), window.__read.rec(1)]);
        const refusedDelta = delta(refusedSounds, await packedNow());
        check("at full HP the technique does nothing at all",
            refused1[1].hp === refused0[1].hp && refused1[1].hp === refused0[1].maxHp &&
            refused1[0].mp === refused0[0].mp && refused1[1].mp === refused0[1].mp,
            JSON.stringify({ before: refused0, after: refused1 }));
        const refusalText = await page.evaluate((cls) => window.__read.text(cls, 0x88), TECHNIQUES);
        check("the refusal is the No effect line and no recovery word",
            (refusalText ?? "").includes("No effect") && !refusedDelta.includes("0x40014x1"),
            JSON.stringify({ text: refusalText, sounds: refusedDelta }));
        await page.screenshot({ path: `${OUT}/03-no-effect.png` });
        await press("c");                       // dismiss the refusal line
        await leaveHome();
        const committed = [await walkerStats(0), await walkerStats(1)];
        check("leaving the pause keeps the heal the page applied",
            committed[0].hp === after[0].hp && committed[0].mp === after[0].mp &&
            committed[1].hp === after[1].hp && committed[1].mp === after[1].mp,
            JSON.stringify({ page: after, walker: committed }));
    }

    // ── SORT: the locked card is never offered, and the two partners swap ─────────
    await seedParty();
    if (await openRow("sort", SORT)) {
        check("the row's own page is the translated SORT page", (await diag()).classes.includes(SORT), "");
        const order = await page.evaluate(() => window.__state.party.slice());
        await press("c");                       // lock the first partner
        const locked = await until(waitTaskWord(SORT, 0x10, 7));
        check("confirming a card asks which partner to switch it with", locked, "");
        const ring = await page.evaluate(() => {
            const r = window.__read, obj = r.task(0x800980b0);
            return { locked: r.r32(obj + 0x84), cursor: r.r32(obj + 0x88) };
        });
        check("the first card is locked and the second one is offered instead",
            ring.locked === 0 && ring.cursor === 1, JSON.stringify(ring));
        // Walk the whole ring: with three partners the offered cards are the other
        // two, and the cursor must wrap between them without ever resting on the lock.
        const seen = [];
        for (let i = 0; i < 4; i += 1) {
            await press("ArrowDown");
            seen.push(await page.evaluate(() => window.__read.r32(window.__read.task(0x800980b0) + 0x88)));
        }
        check("walking the second cursor never lands on the locked card, and it wraps",
            seen.every((row) => row !== 0) && seen.includes(2) && seen[3] === seen[1],
            JSON.stringify(seen));
        await page.screenshot({ path: `${OUT}/04-sort-who.png` });
        // Confirm on whichever card the walk ended on and read the pedestals back.
        const partner = (await taskWord(SORT, 0x88)) | 0;
        await press("c");
        await until(waitTaskWord(SORT, 0x10, 9));
        const map = await page.evaluate(() => window.__read.partyMap());
        check("the locked partner and the chosen one change places",
            map[0] === partner && map[partner] === 0,
            JSON.stringify({ locked: ring.locked, chosen: partner, map }));
        await leaveHome();
        const swapped = await page.evaluate(() => window.__state.party.slice());
        check("the walker's party order follows the swap",
            swapped[0] === order[partner] && swapped[partner] === order[0] &&
            JSON.stringify(swapped.filter((_, i) => i !== 0 && i !== partner)) ===
            JSON.stringify(order.filter((_, i) => i !== 0 && i !== partner)),
            `${JSON.stringify(order)} -> ${JSON.stringify(swapped)}`);
        await page.screenshot({ path: `${OUT}/05-sort-swapped.png` });
    }

    // ── STATUS: the sheet's prompt has two rows and remembers the row ────────────
    await seedParty();
    if (await openRow("status", STATUS)) {
        check("the row's own page is the translated STATUS page", (await diag()).classes.includes(STATUS), "");
        await press("c");                       // the lead's sheet
        const prompt = await until(waitTaskWord(STATUS, 0x14, 5));
        check("choosing a partner opens the sheet's two-row prompt", prompt, "");
        const rows = [];
        for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp"]) {
            await press(key);
            rows.push(await page.evaluate(() => {
                const r = window.__read, obj = r.task(0x8008e744);
                return { row: r.r32(obj + 0x74), cursor: r.cursorPos(0x8008e744, 0x98) };
            }));
        }
        check("the prompt is two rows: Down stops at See Equipment, Up stops at See Digivolve",
            rows.map((r) => r.row).join(",") === "1,1,0,0", JSON.stringify(rows.map((r) => r.row)));
        check("the prompt's cursor sits on the row it is on, 14 pixels below the other",
            rows.every((r) => r.cursor && r.cursor.y === r.row * 0xe + 0x13 && r.cursor.visible === 1),
            JSON.stringify(rows.map((r) => r.cursor)));
        check("the two prompt rows are See Digivolve and See Equipment",
            (await page.evaluate((cls) => window.__read.text(cls, 0x90), STATUS) ?? "").includes("See Digivolve") &&
            (await page.evaluate((cls) => window.__read.text(cls, 0x94), STATUS) ?? "").includes("See Equipment"),
            JSON.stringify([await page.evaluate((cls) => window.__read.text(cls, 0x90), STATUS),
                await page.evaluate((cls) => window.__read.text(cls, 0x94), STATUS)]));
        await page.screenshot({ path: `${OUT}/06-status-prompt.png` });
        // Down to See Equipment, confirm into it, Back out onto the same row.
        await press("ArrowDown");
        await press("c");
        const equip = await until(waitTaskPresent(EQUIPMENT));
        check("See Equipment opens the equipment window", equip, "");
        // Its six slot rows read the pad only once its own windows are up, and until
        // then a Back is ignored — so wait for the state that takes buttons.
        const slotsReady = await until(waitTaskWord(EQUIPMENT, 0x10, 3));
        await page.screenshot({ path: `${OUT}/07-see-equipment.png` });
        await press("Escape");
        // The equipment window folds shut before the prompt is handed back, so wait
        // for the child to be gone and only then read where the prompt sits.
        const gone = await until(waitTaskGone(EQUIPMENT));
        const back = gone && await until(waitTaskWord(STATUS, 0x14, 5));
        const backRow = await page.evaluate(() => {
            const r = window.__read;
            return { row: r.r32(r.task(0x8008e744) + 0x74), cursor: r.cursorPos(0x8008e744, 0x98),
                equipment: r.task(0x80088214) };
        });
        check("Back from See Equipment lands on the prompt still on See Equipment",
            back && backRow.row === 1 && backRow.equipment === 0 && backRow.cursor?.y === 0x13 + 0xe,
            JSON.stringify({ slotsReady, gone, back, ...backRow }));
        await page.screenshot({ path: `${OUT}/08-back-on-the-row.png` });
        await leaveHome();
    }

    // ── See Digivolve: Battle Digivolve On/Off, and the technique list ───────────
    await seedParty();
    if (await openDigivolve()) {
        check("See Digivolve opens the form list", true, "");
        const listed = true;
        const forms = await page.evaluate(() => {
            const r = window.__read, obj = r.task(0x8008b3c8);
            return { count: r.r32(obj + 0x7c), ids: [0, 1, 2].map((i) => r.r16(obj + 0x74 + i * 2)),
                row: r.r32(obj + 0x5c), current: r.rec(0).formValue };
        });
        check("the form list holds the lead's three acquired forms, the first one the one in the field",
            listed && forms.count === 3 && forms.ids.every((v) => v >= 4) && forms.ids[0] === forms.current,
            JSON.stringify(forms));
        await page.screenshot({ path: `${OUT}/09-form-list.png` });
        // The form list reads only Right, confirm and Back; Right opens the panel
        // beside it and THAT is where the form cursor moves (button table §10).
        await press("ArrowRight");
        const panel = await until(waitTaskWord(DIGIVOLVE, 0x6c, 1));
        check("Right opens the panel beside the form list, and the cursor moves there",
            panel, JSON.stringify({ state: await taskWord(DIGIVOLVE, 0x10), panel: await taskWord(DIGIVOLVE, 0x6c) }));
        // Row 0 is the form the lead already fights as, so step to the second one.
        await press("ArrowDown");
        const chosen = await page.evaluate(() => {
            const r = window.__read, obj = r.task(0x8008b3c8);
            return { row: r.r32(obj + 0x5c), form: r.r16(obj + 0x74 + 1 * 2), current: r.rec(0).formValue };
        });
        check("the cursor steps to the second form, which is not the one in the field",
            chosen.row === 1 && chosen.form !== chosen.current, JSON.stringify(chosen));
        await press("c");                       // the two-row action pair
        const pair = await until(waitTaskWord(DIGIVOLVE, 0x10, 0xd));
        await page.waitForTimeout(400);
        const labels = await page.evaluate((cls) => window.__read.texts(cls, [0x18, 0x1c, 0x80]), DIGIVOLVE);
        check("a form the partner is not fighting as offers Battle Digivolve On",
            pair && (labels[0] ?? "").includes("Battle Digivolve On"), JSON.stringify(labels));
        check("the pair's second row is Techique Explanation",
            (labels[1] ?? "").includes("Techique Explanation"), JSON.stringify(labels[1]));
        await page.screenshot({ path: `${OUT}/10-action-pair.png` });
        await press("c");                       // turn Battle Digivolve on
        // 0x1c folds the message in first; 0x1d is the state that waits for the
        // confirm that dismisses it, so that is the one to read the line in.
        const onMsg = await until(waitTaskWord(DIGIVOLVE, 0x10, 0x1d));
        const onText = await page.evaluate((cls) => window.__read.text(cls, 0x84), DIGIVOLVE);
        check("confirming it says Battle Digivolve is now on",
            onMsg && (onText ?? "").includes("Turned on Battle Digivolve"), JSON.stringify(onText));
        await page.screenshot({ path: `${OUT}/11-turned-on.png` });
        const nowForm = await page.evaluate(() => window.__read.rec(0).formValue);
        check("the chosen form is the one the record now holds", nowForm === chosen.form,
            JSON.stringify({ chosen: chosen.form, record: nowForm }));
        await press("c");                       // dismiss the message
        await until(waitTaskWord(DIGIVOLVE, 0x10, 4));
        await until(waitTaskWord(DIGIVOLVE, 0x6c, 0));
        // The form that is now the standing one must offer Off instead of On. The
        // cursor came back on the row it was left on, so only the panel reopens.
        await press("ArrowRight");
        await until(waitTaskWord(DIGIVOLVE, 0x6c, 1));
        const backOnOwn = await page.evaluate(() => {
            const r = window.__read, obj = r.task(0x8008b3c8);
            return { row: r.r32(obj + 0x5c), form: r.r16(obj + 0x74 + 1 * 2), current: r.rec(0).formValue };
        });
        await press("c");
        await until(waitTaskWord(DIGIVOLVE, 0x10, 0xd));
        await page.waitForTimeout(400);
        const offLabel = await page.evaluate((cls) => window.__read.text(cls, 0x18), DIGIVOLVE);
        check("the form the partner now fights as offers Battle Digivolve Off",
            backOnOwn.row === chosen.row && backOnOwn.form === backOnOwn.current &&
            (offLabel ?? "").includes("Battle Digivolve Off"),
            JSON.stringify({ ...backOnOwn, label: offLabel }));
        await page.screenshot({ path: `${OUT}/12-off-label.png` });
        await press("c");
        const offMsg = await until(waitTaskWord(DIGIVOLVE, 0x10, 0x1d));
        const offText = await page.evaluate((cls) => window.__read.text(cls, 0x84), DIGIVOLVE);
        check("confirming it says Battle Digivolve is now off",
            offMsg && (offText ?? "").includes("Turned off Battle Digivolve"), JSON.stringify(offText));
        await page.screenshot({ path: `${OUT}/13-turned-off.png` });
        await press("c");
        await until(waitTaskWord(DIGIVOLVE, 0x10, 4));
        await leaveHome();
        const afterOff = await walkerStats(0);
        // The record's form word is 0 once the choice is off, and the walker reads 0
        // as the character's starting Digimon (Kotemon, digimon.json id 1).
        check("turning it off puts the lead back on its starting form",
            afterOff.digimonId === BASE_FORM, JSON.stringify({ base: BASE_FORM, now: afterOff.digimonId }));
        await page.screenshot({ path: `${OUT}/14-back-on-the-field.png` });
    }

    // ── See Digivolve: the technique list steps over an empty slot ───────────────
    await seedParty();
    if (await openDigivolve()) {
        await press("ArrowRight");              // the panel the form cursor moves in
        await until(waitTaskWord(DIGIVOLVE, 0x6c, 1));
        await press("ArrowDown");               // the form whose slots are [53, 0, 184, 0, 0, 0]
        const onSecond = await taskWord(DIGIVOLVE, 0x5c);
        await press("c");                       // the action pair
        const pair = await until(waitTaskWord(DIGIVOLVE, 0x10, 0xd));
        await press("ArrowDown");               // Techique Explanation
        const onExplanation = await taskWord(DIGIVOLVE, 0x60);
        await press("c");
        // The list only exists from 0x2b on, and it is the two filled slots that
        // decide whether it is a list at all, so wait on its own count.
        const explained = await until(page.waitForFunction((c) => {
            const s = window.__status?._session;
            if (!s) return false;
            for (const t of s.tree.tasks.values()) if (t.classId === c) return (s.mem.read32(t.address + 0x68) | 0) > 0;
            return false;
        }, DIGIVOLVE, { timeout: 30000 }));
        const slots = await page.evaluate(() => {
            const r = window.__read, obj = r.task(0x8008b3c8);
            return { count: r.r32(obj + 0x68), row: r.r32(obj + 0x64), state: r.r32(obj + 0x10) };
        });
        check("Techique Explanation lists the form's two filled techniques",
            pair && onSecond === 1 && onExplanation === 1 && explained &&
            slots.count === 2 && slots.row === 0,
            JSON.stringify({ ...slots, formRow: onSecond, pair, pairRow: onExplanation }));
        await page.screenshot({ path: `${OUT}/15-technique-list.png` });
        await press("ArrowDown");
        const after1 = await taskWord(DIGIVOLVE, 0x64);
        check("one press down steps over the empty slot instead of resting on it",
            after1 === FILLED_LAST, `row=${after1}, empty slot at 1, filled at ${FILLED_LAST}`);
        await press("ArrowDown");
        const after2 = await taskWord(DIGIVOLVE, 0x64);
        check("the list stops on the last filled slot rather than running off it",
            after2 === FILLED_LAST, `row=${after2}`);
        await page.screenshot({ path: `${OUT}/16-skipped-empty.png` });
        await leaveHome();
    }

    check("no executable asset was requested", executableRequests.length === 0, executableRequests.join(", "));
    check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
    writeFileSync(`${OUT}/proof.json`, JSON.stringify({ execution: "translated", log, executableRequests, errors: pageErrors, failures }, null, 2) + "\n");
    if (failures) { console.error(`FAIL pause journeys: ${failures} check(s) failed`); process.exitCode = 1; }
    else console.log("PASS pause journeys");
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    await browser.close();
}
