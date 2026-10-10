// Browser proof for the translated battle command list (Fight / Tech / DV / Tag /
// Item / Run), Step F of docs/plans/2026-09-28-translated-game-completion-plan.md.
//
// Three runs through the real web/game.js and web/battle.js:
//   1. reference: `?nativeBattleCmd=1`, the original-code list (the "before").
//   2. ordinary route, no flags. The battle's boot loader (pro/wfightmn) is
//      translated too (tools/verify_translated_wfight.mjs), so every
//      assets/native/** request is denied from page load and counted. The command
//      list must open, move Up/Down, confirm every row and hand each row to the
//      battle. Its marker strip must come from the loader's own VRAM upload.
//   3. rollback: the loader's skip switch `?legacyWfight=1`, denied from page
//      load too. The strip then comes from the data build (no loader ran).
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_translated_battlecmd.mjs [outdir]

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = `${baseUrl(8742)}`;
const BASE = `${ROOT}/?skipTitle=1&map=s245&noEncounters=1`;
const OUT = process.argv[2] ?? "captures/step-f-translated-battlecmd-2026-09-30";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const results = [];
const check = (name, ok, detail = "") => {
    const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(line);
    results.push(line);
    if (!ok) failures++;
};

// A battle party of TWO Digimon and one item in the bag.
//
// The second member is not decoration. The Tag row's branch is the original's
// partner list (FIGHTSTG_F0x80097498, pro/fightstg.s:21180), and its state 0
// builds a row per party record that is not the acting one (`:21202-:21245`).
// With only the acting Digimon in the party the scan finds NO candidate
// (`blez $v1`, `:21248`) and the screen opens its "nobody to tag" message pane
// instead (`:21269-:21284`) — a different screen, on which the original reads
// Circle and nothing else (`:21348` is the only pad test between the state-2
// entry `:21343` and the end `:21485`). So a one-Digimon save can never
// exercise the Tag row's Back, and the sweep below used to time out on it and
// blame the game. Section 2b keeps that case, as its own page, asserted the
// way the original behaves.
const member = (digimonId, level, hp, maxHp, mp, maxMp) => ({
    digimonId, level, xp: 0, tp: 30, hp, maxHp, mp, maxMp,
    stats: { str: 40, def: 30, spt: 25, wis: 20, spd: 30, chr: 10 }, bonuses: {}, elemBonuses: {},
});

const SEED = {
    partyIds: ["p003pken", "p006agum"],
    partnerStats: member(1, 12, 60, 60, 21, 25),
    partyStats: [member(1, 12, 60, 60, 21, 25), member(3, 5, 200, 200, 80, 80), null],
    equipment: [{}, {}, {}],
    // Two usable items, so the Item row opens the item list instead of
    // refusing with a "No items!" line (ids 43-46 are the hp/mp heals the battle
    // item path already runs; 66-90 are the decoded FIGHTSTG band).
    inventory: [{ id: 43, qty: 3 }, { id: 66, qty: 1 }],
};

/** The same save with the partner taken away: the Tag row can only be refused. */
const SOLO_SEED = {
    partyIds: ["p003pken"],
    partnerStats: member(1, 12, 60, 60, 21, 25),
    partyStats: [member(1, 12, 60, 60, 21, 25), null, null],
    equipment: [{}],
    inventory: [{ id: 43, qty: 3 }, { id: 66, qty: 1 }],
};

const browser = await chromium.launch();

async function openPage({ url, denyFromStart = false, seed = SEED }) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1080 } });
    const net = { deny: denyFromStart, denied: [], allowed: [], data: [] };
    await page.route("**/assets/native/**", (route) => {
        if (net.deny) {
            net.denied.push(route.request().url());
            return route.abort();
        }
        net.allowed.push(route.request().url());
        return route.continue();
    });
    page.on("request", (req) => { if (/assets\/data\/battlecmd\//.test(req.url())) net.data.push(req.url()); });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    await page.addInitScript((s) => {
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("progressOrdinal", "3");
        localStorage.setItem("playerName", "Junior");
        localStorage.setItem("charId", "p003pken");
        localStorage.setItem("party", JSON.stringify(s.partyIds));
        localStorage.setItem("packId", "B");
        localStorage.setItem("bits", "1000");
        localStorage.setItem("partnerStats", JSON.stringify(s.partnerStats));
        localStorage.setItem("partyStats", JSON.stringify(s.partyStats));
        localStorage.setItem("equipment", JSON.stringify(s.equipment));
        localStorage.setItem("inventory", JSON.stringify(s.inventory));
    }, seed);
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.waitForTimeout(600);
    await page.evaluate(async () => {
        await window.__battle.start({ enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
    });
    await waitForCommandMenu(page);
    return { page, net, errors };
}

const read = (page) => page.evaluate(() => {
    const b = window.__battleB() ?? { state: -1, menuSel: null, message: "battle over", menuNotice: null };
    return {
        state: b.state, menuSel: b.menuSel, message: b.message, notice: b.menuNotice ?? null,
        cmd: window.__battleCmdNative?.diagnostics?.() ?? null,
        tag: window.__battleTagNative?.diagnostics?.() ?? null,
        item: window.__battleItemNative?.diagnostics?.() ?? null,
        loader: { open: window.__battleWfightmn?.isOpen?.() ?? null },
    };
});

async function press(page, key, holdMs = 120) {
    await page.keyboard.down(key);
    await page.waitForTimeout(holdMs);
    await page.keyboard.up(key);
    await page.waitForTimeout(300);
}

/** The command list's region, in page pixels (native 0..160 x 96..236 of the 320x240 view). */
async function listClip(page) {
    const box = await page.evaluate(() => {
        const c = document.querySelector("canvas");
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const s = Math.min(box.w / 320, box.h / 240);
    const ox = box.x + (box.w - 320 * s) / 2, oy = box.y + (box.h - 240 * s) / 2;
    return { x: ox, y: oy + 96 * s, width: 160 * s, height: 140 * s };
}

async function shoot(page, name) {
    await page.screenshot({ path: `${OUT}/${name}.png` });
    await page.screenshot({ path: `${OUT}/${name}-list.png`, clip: await listClip(page) });
}

/** Four frames of the list a sixth of a second apart: the highlight and marker animation. */
async function animation(page, prefix) {
    for (let i = 0; i < 4; i++) {
        await page.screenshot({ path: `${OUT}/${prefix}-anim${i}.png`, clip: await listClip(page) });
        await page.waitForTimeout(160);
    }
}

// ── 1. before: the original-code reference list ─────────────────────────────
{
    const { page, errors } = await openPage({ url: `${BASE}&nativeBattleCmd=1` });
    await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.()?.host?.booted === true,
        null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    const s = await read(page);
    check("reference: the original-code list booted", s.cmd?.host?.booted === true, `module=${s.cmd?.host?.module}`);
    await shoot(page, "before-01-reference-open");
    await press(page, "ArrowDown");
    await press(page, "ArrowDown");
    await page.waitForTimeout(300);
    await shoot(page, "before-02-reference-row2");
    await animation(page, "before-03-reference");
    check("reference: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
}

// ── 2. the ordinary route ───────────────────────────────────────────────────
{
    const { page, net, errors } = await openPage({ url: BASE, denyFromStart: true });
    // The translated boot loader retires on its own before the list opens.
    await page.waitForFunction(() => window.__battleWfightmn?.isOpen?.() === false, null, { timeout: 30000 })
        .catch(() => {});
    await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.()?.ready === true, null, { timeout: 30000 })
        .catch(() => {});
    await page.waitForTimeout(500);
    let s = await read(page);
    check("ordinary: the list runs the translated session", s.cmd?.execution === "translated" && s.cmd?.ready === true,
        `execution=${s.cmd?.execution} ready=${s.cmd?.ready} error=${s.cmd?.error}`);
    check("ordinary: the list opened on the battle's selection", s.cmd?.selection === 0, `selection=${s.cmd?.selection}`);
    check("ordinary: the marker blit is installed and copying", s.cmd?.vsync === true &&
        s.cmd?.moves?.some((m) => m.dstX === 0x11 && m.dstY === 0x6e && m.srcY === 0xf4),
        JSON.stringify(s.cmd?.moves?.[1] ?? null));
    check("ordinary: data came from assets/data/battlecmd", net.data.length >= 10, `${net.data.length} requests`);
    check("ordinary: the marker strip is the boot loader's VRAM upload", s.cmd?.stripSource === "loader-vram",
        `stripSource=${s.cmd?.stripSource}`);
    await shoot(page, "after-01-translated-open");

    await press(page, "ArrowDown");
    await press(page, "ArrowDown");
    await page.waitForTimeout(300);
    s = await read(page);
    check("ordinary: Down twice moves the selection to row 2", s.cmd?.selection === 2, `selection=${s.cmd?.selection}`);
    await shoot(page, "after-02-translated-row2");
    await animation(page, "after-03-translated");
    await press(page, "ArrowUp");
    s = await read(page);
    check("ordinary: Up moves back to row 1", s.cmd?.selection === 1, `selection=${s.cmd?.selection}`);
    await press(page, "ArrowUp");
    await press(page, "ArrowUp");
    s = await read(page);
    check("ordinary: Up stops at the top row", s.cmd?.selection === 0, `selection=${s.cmd?.selection}`);

    /**
     * Leave whichever branch screen is up and come back to the command list.
     *
     * Back (Escape = Cross = word 0x4000) is the cancel of a LIST: the partner list
     * reads it at fightstg.s:21298, the technique list at its own twin, and both
     * answer -2, which the battle's command-flow phase turns back into the command
     * list (fightstg.s:16329 -> :16335, `self+0x2c(self, 2)`).
     *
     * Back is NOT a cancel of the "nobody to tag" pane. That screen's only pad test
     * is `andi $v0, 0x2000` (fightstg.s:21348) — there is no 0x4000 arm anywhere
     * between the state-2 entry at :21343 and the routine's end at :21485 — so with
     * nobody in reserve the pane is left with Circle, which answers -2 there too
     * (:21356-:21363). Pressing Back at it would leave this helper spinning, which is
     * exactly what the sweep used to do and mis-report as a broken Back.
     */
    const backToList = async () => {
        let t = await read(page);
        if (t.state === 2) return t;
        if (t.tag?.message === true) {
            await press(page, "Enter");
        } else {
            await press(page, "Escape");
        }
        const home = await page.waitForFunction(() => window.__battleB?.()?.state === 2, null, { timeout: 15000 })
            .then(() => true).catch(() => false);
        check("ordinary: the branch screen closed and the command list is back", home,
            `state=${t.state} tagMessage=${t.tag?.message ?? null} tagReady=${t.tag?.ready ?? null}`);
        await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.()?.ready === true, null, { timeout: 10000 })
            .catch(() => {});
        await page.waitForTimeout(300);
        return read(page);
    };
    const moveTo = async (row) => {
        // Wait for the reopened list to be live before steering it. Straight after a
        // refusal the branch is still resolving: `selection` reads null and `ready` is
        // false, and returning there left the cursor on the row the previous confirm
        // had chosen, so the next confirm re-ran that row instead of this one.
        for (let wait = 0; wait < 40; wait++) {
            const t = await read(page);
            if (t.cmd?.ready === true && t.cmd?.selection != null) break;
            await page.waitForTimeout(250);
        }
        for (let guard = 0; guard < 8; guard++) {
            const t = await read(page);
            const sel = t.cmd?.selection;
            if (sel === row || sel == null) return;
            await press(page, sel < row ? "ArrowDown" : "ArrowUp");
        }
    };
    // Tech, DV, Tag and Item: the battle takes the row and opens its own branch or notice.
    const expectations = {
        1: (t) => t.state === 3 || /tech/i.test(String(t.message)),
        2: (t) => t.state === 13 || /digivolve/i.test(String(t.notice)),
        3: (t) => t.state === 11 || /tag/i.test(String(t.notice)),
        4: (t) => t.state === 4 || /items/i.test(String(t.message)),
    };
    const names = { 1: "Tech", 2: "DV", 3: "Tag", 4: "Item" };
    for (const row of [1, 2, 3, 4]) {
        await backToList();
        await moveTo(row);
        const before = await read(page);
        await press(page, "Enter");
        // The battle writes the row back after its branch opens, and the Item branch
        // has to load its list first, so wait for the row rather than reading 200 ms
        // later (the shape tools/verify_battle_item_cure.mjs uses).
        await page.waitForFunction((row) => (window.__battleB?.()?.menuSel ?? -1) === row
            || (window.__battleB?.()?.state ?? 0) !== 2, row, { timeout: 5000 }).catch(() => {});
        const t = await read(page);
        // The battle's selection only changes through the row the list hands back
        // (it was the previous row before this confirm). A refusal notice keeps the
        // battle in the command phase, so the list reopens and `chosen` resets.
        check(`ordinary: confirming ${names[row]} hands row ${row} to the battle`, t.menuSel === row && before.menuSel !== row,
            `menuSel ${before.menuSel} -> ${t.menuSel}`);
        check(`ordinary: the battle runs its ${names[row]} branch`, expectations[row](t),
            `state=${t.state} message=${t.message} notice=${t.notice}`);
        await page.screenshot({ path: `${OUT}/after-04-row${row}-${names[row].toLowerCase()}.png` });
    }

    // ── the decoded Back: Tag, Back, and the row the cursor comes back on ──────
    //
    // The battle's command-flow phase is FIGHTSTG_F0x80092684 (pro/fightstg.s:16048,
    // allocated by :16486 with tick 0x80092684). Its command-row answer is written
    // into its own row cell at `:16172` and NOTHING on a cancel path writes that
    // cell, while the cancel hook `self+0x2c(self, 2)` at `:16335` clears the row
    // branch and the sub-screen counter and leaves the tick (`:16340`). F0x80014288,
    // the method at +0x2c, is `self+0x10 = arg; self+0x14 = 0; self+0x18 = 0`
    // (exe/fns.s:4749-4753), so the next tick falls back through `0x800830dc[2] =
    // 0x80092788` (`:16114`) into `0x800830f4[0] = 0x800927b8`, the command-list arm
    // — with the row cell untouched, so the list opens on the row the player just
    // confirmed. Tag is row 3 (the row dispatch table at `:16173` sends row 3 to
    // `+0x30(4)`, the partner-list branch at `:16310`).
    await backToList();
    await moveTo(3);
    await press(page, "Enter");
    await page.waitForFunction(() => window.__battleTagNative?.diagnostics?.()?.ready === true,
        null, { timeout: 10000 }).catch(() => {});
    let tagOpen = await read(page);
    check("Tag: the partner list is up, with a row to pick",
        tagOpen.state === 11 && tagOpen.tag?.ready === true && (tagOpen.tag?.rows ?? 0) >= 1
            && tagOpen.tag?.message === false,
        `state=${tagOpen.state} rows=${tagOpen.tag?.rows} message=${tagOpen.tag?.message}`);
    await page.screenshot({ path: `${OUT}/after-08-tag-partner-list.png` });
    await press(page, "Escape");
    const backHome = await page.waitForFunction(() => window.__battleB?.()?.state === 2, null, { timeout: 10000 })
        .then(() => true).catch(() => false);
    await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.()?.ready === true, null, { timeout: 10000 })
        .catch(() => {});
    await page.waitForTimeout(300);
    let back = await read(page);
    check("Tag: Back returns the battle to the command list", backHome && back.state === 2,
        `state=${back.state} tagChosen=${back.tag?.chosen ?? null}`);
    check("Tag: the cursor comes back on Tag, the row it was taken from",
        back.cmd?.selection === 3 && back.menuSel === 3,
        `selection=${back.cmd?.selection} menuSel=${back.menuSel}`);
    await page.screenshot({ path: `${OUT}/after-09-tag-back-on-tag.png` });
    // One Down and one confirm must reach Item, which is only reachable if Back
    // really handed the turn back rather than leaving the Tag branch up.
    await press(page, "ArrowDown");
    await moveTo(4);
    await press(page, "Enter");
    await page.waitForFunction(() => window.__battleB?.()?.state === 4, null, { timeout: 8000 }).catch(() => {});
    let item = await read(page);
    check("Tag: the next confirm on Item opens the item list",
        item.state === 4 && item.menuSel === 4 && item.item?.ready === true && (item.item?.rows ?? 0) >= 1,
        `state=${item.state} menuSel=${item.menuSel} rows=${item.item?.rows} error=${item.item?.error ?? null}`);
    await page.screenshot({ path: `${OUT}/after-10-item-after-tag-back.png` });

    // Run is the last row; it ends the battle when the escape succeeds.
    s = await backToList();
    check("ordinary: the list reopens after the refusals", s.cmd?.ready === true && s.cmd?.chosen === null,
        `ready=${s.cmd?.ready} state=${s.state}`);
    await moveTo(5);
    await page.keyboard.down("Enter");
    await page.waitForTimeout(150);
    await page.keyboard.up("Enter");
    s = await read(page);
    check("ordinary: confirming Run hands row 5 to the battle", s.menuSel === 5 && s.cmd?.chosen === 5 && s.state !== 2,
        `menuSel=${s.menuSel} state=${s.state} message=${s.message}`);
    await page.screenshot({ path: `${OUT}/after-06-run.png` });
    s = await read(page);
    check("ordinary: zero executable asset requests from page load", net.denied.length === 0 && net.allowed.length === 0,
        `denied=${net.denied.length} allowed=${net.allowed.length}: ${net.denied.slice(0, 2).join(", ")}`);
    check("ordinary: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
}

// ── 2b. the refused Tag: Back is not a cancel there, and must look like it ────────────────
//
// One Digimon in the party, so the partner list's own scan finds no candidate
// (fightstg.s:21246-:21248, `blez $v1`) and the screen opens the "nobody to tag"
// message pane instead (`:21269-:21284`). That screen reads Circle and nothing
// else: the only pad test between its entry at `:21343` and the routine's end at
// `:21485` is `andi $v0, 0x2000` at `:21348`. Back must therefore leave it exactly
// as it is, and Circle must close it with the same -2 the list's cancel answers
// (`:21356-:21363`), which the command-flow phase turns back into the command list.
{
    const { page, errors } = await openPage({ url: BASE, seed: SOLO_SEED });
    await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.()?.ready === true, null, { timeout: 30000 })
        .catch(() => {});
    await page.waitForTimeout(500);
    for (let i = 0; i < 3; i++) await press(page, "ArrowDown");
    await press(page, "Enter");
    await page.waitForFunction(() => window.__battleTagNative?.diagnostics?.()?.message === true,
        null, { timeout: 10000 }).catch(() => {});
    let s = await read(page);
    check("refused Tag: with nobody in reserve the pane is up instead of a partner list",
        s.state === 11 && s.tag?.message === true && (s.tag?.rows ?? 0) === 0,
        `state=${s.state} message=${s.tag?.message} rows=${s.tag?.rows}`);
    await page.screenshot({ path: `${OUT}/after-11-tag-no-partner.png` });
    await press(page, "Escape");
    s = await read(page);
    check("refused Tag: Back does nothing, exactly as in the original",
        s.state === 11 && s.tag?.message === true && s.tag?.open === true,
        `state=${s.state} message=${s.tag?.message} open=${s.tag?.open}`);
    await press(page, "Enter");
    const closed = await page.waitForFunction(() => window.__battleB?.()?.state === 2, null, { timeout: 10000 })
        .then(() => true).catch(() => false);
    await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.()?.ready === true, null, { timeout: 10000 })
        .catch(() => {});
    await page.waitForTimeout(300);
    s = await read(page);
    check("refused Tag: Circle closes it and hands back the command list on row 3",
        closed && s.state === 2 && s.menuSel === 3 && s.cmd?.selection === 3,
        `state=${s.state} menuSel=${s.menuSel} selection=${s.cmd?.selection}`);
    check("refused Tag: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
}

// ── 3. rollback: the loader is skipped, nothing executable may load ───────────────────────────
{
    const { page, net, errors } = await openPage({ url: `${BASE}&legacyWfight=1`, denyFromStart: true });
    await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.()?.ready === true, null, { timeout: 30000 })
        .catch(() => {});
    await page.waitForTimeout(400);
    let s = await read(page);
    check("rollback: the translated list opens with every executable asset denied",
        s.cmd?.execution === "translated" && s.cmd?.ready === true, `error=${s.cmd?.error}`);
    await press(page, "ArrowDown");
    s = await read(page);
    check("rollback: the strip comes from the data build (no loader ran)", s.cmd?.stripSource === "data",
        `stripSource=${s.cmd?.stripSource}`);
    check("rollback: Down moves to row 1", s.cmd?.selection === 1, `selection=${s.cmd?.selection}`);
    await press(page, "ArrowUp");
    await page.keyboard.down("Enter");
    await page.waitForTimeout(150);
    await page.keyboard.up("Enter");
    s = await read(page);
    check("rollback: confirming Fight hands row 0 and starts the attack",
        s.menuSel === 0 && s.cmd?.chosen === 0 && (s.state === 5 || /attacks!/.test(String(s.message))),
        `menuSel=${s.menuSel} state=${s.state} message=${s.message}`);
    check("rollback: zero executable asset requests", net.denied.length === 0 && net.allowed.length === 0,
        `denied=${net.denied.length} allowed=${net.allowed.length}`);
    check("rollback: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.screenshot({ path: `${OUT}/after-07-strict-fight.png` });
    await page.close();
}

writeFileSync(`${OUT}/verify-output.txt`, results.join("\n") + "\n");
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
