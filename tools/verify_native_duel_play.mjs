// Focused production-route verifier: the native card duel entered the way a
// player meets it — talk to a roaming Tamer in the field, accept the challenge,
// play the board, win, and return to the field with the result persisted.
//
// Phase 6.3 group 2 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md. The plan
// requires every in-scope route to be entered from ordinary web/game.js
// gameplay, not a debug entry point, and to return to its real consumer.
//
// The fixture is tools/verify_tamer_charisma_duel.mjs's: map s335, story
// ordinal 20, the Folder Bag item 402 so the duelling Tamer variant spawns, and
// party Charisma driven to Mitch's rung so his challenge line (whose on_close is
// the bank-0x76 duel launcher 0x7606) is the one presented. Talking is a real
// space-bar press against the NPC's own dialogue state machine.
//
//   .opencode/autonomy/check-browser tools/verify_native_duel_play.mjs
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const origin = process.env.DUEL_ORIGIN || `${baseUrl(8742)}`;
const OUT = process.env.DUEL_SHOT || "/tmp/opencode/native-duel-play";
mkdirSync(OUT, { recursive: true });

const RUNG_FLAG = 0x7209;
const RUNG = 1218;
const DUEL_CB = 0x800a2f00;
const MODE = 0x2f8;
const OPPONENT_DECK = 0x66c;

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    storageState: {
        cookies: [],
        origins: [{
            origin,
            localStorage: [
                { name: "engineSchema", value: "2" },
                { name: "assetMode", value: "authentic" },
                // Mitch's duelling variant exists while the story ordinal is in [4,23].
                { name: "progressOrdinal", value: "20" },
                { name: "charId", value: "p003pken" },
                { name: "party", value: JSON.stringify(["p003pken", "p005koet", "p004kogu"]) },
            ],
        }],
    },
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(`pageerror: ${e.message}`); });
page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (text.includes("Failed to load resource")) return;
    pageErrors.push(`console: ${text}`);
});

const tapKey = (k) => page.evaluate((kk) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);

try {
    await page.goto(`${origin}/?skipTitle=1&map=s335&noEncounters=1`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__state?.started && window.__storyFlags, null, { timeout: 40000 });
    await page.waitForFunction(() => window.__partyCharisma() != null, null, { timeout: 20000 });
    console.log("[verify] game booted on s335");

    // The same prerequisites the tamer fixture uses: the Folder Bag so the duelling
    // variant spawns, and party Charisma at Mitch's rung (the gate the walker reads).
    await page.evaluate(() => {
        const s = window.__state;
        s.inventory = s.inventory ?? [];
        if (!s.inventory.some((it) => it.id === 402)) s.inventory.push({ id: 402, qty: 1 });
    });
    const setCharisma = (v) => page.evaluate((val) => {
        const s = window.__state;
        const put = (rec) => { if (rec) rec.stats = { ...(rec.stats ?? {}), chr: val }; };
        put(s.partnerStats);
        s.partyStats = s.partyStats ?? [];
        for (let i = 0; i < (s.party?.length ?? 0); i++) {
            s.partyStats[i] = s.partyStats[i] ?? {};
            put(s.partyStats[i]);
        }
        return window.__partyCharisma();
    }, v);

    const faceTamer = async () => {
        await page.evaluate(() => window.__teleport(593, 319));
        await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" })));
        await page.waitForTimeout(140);
        await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" })));
        await page.waitForTimeout(250);
    };
    const dismiss = async () => {
        for (let i = 0; i < 40; i++) {
            await page.waitForTimeout(160);
            const open = await page.evaluate(() => window.__textbox?.isOpen?.() ?? false);
            if (!open) break;
            await tapKey(" ");
        }
        await page.waitForTimeout(300);
    };
    const talk = async () => { await faceTamer(); await tapKey(" "); };

    // First meeting, so the tamer's ladder reaches the challenge state.
    await setCharisma(0);
    await talk();
    await dismiss();

    // At the rung: the challenge line, whose on_close writes the duel launcher.
    const total = await setCharisma(RUNG);
    const gate = await page.evaluate((f) => window.__storyFlags.get(f), RUNG_FLAG);
    console.log(`[verify] Charisma ${total} -> gate 0x${RUNG_FLAG.toString(16)} = ${gate}`);
    check("the tamer's rung gate is open", gate === 1, `gate=${gate}`);

    await talk();
    const target = await page.evaluate(() => {
        const t = window.__talkTarget();
        const launch = (t?.state?.on_close ?? []).find((c) => ((c.id >> 8) & 0xfe) === 0x76
            || ((c.id >> 8) & 0xfe) === 0x78);
        return { npc: t?.npc ?? null, dialogue: t?.state?.dialogue ?? null, duelFlag: launch ? `0x${launch.id.toString(16)}` : null };
    });
    console.log("[verify] challenge line:", JSON.stringify(target));
    check("the challenge line carries the duel launcher", target.duelFlag === "0x7606", `flag=${target.duelFlag}`);
    await page.screenshot({ path: `${OUT}/01-challenge.png` });
    await dismiss();
    // The challenge's dialogue can carry more than one page, and the native host
    // preloads on first use, so keep pressing until the adapter reports open
    // rather than sampling once.
    for (let i = 0; i < 20; i++) {
        if (await page.evaluate(() => window.__cardDuelNative?.isOpen?.() === true)) break;
        await page.keyboard.down("Enter");
        await page.waitForTimeout(220);
        await page.keyboard.up("Enter");
        await page.waitForTimeout(130);
    }
    await page.waitForTimeout(600);

    // The launcher's own consumer opened the native duel (pro/cardgame), not the lab.
    const opened = await page.evaluate(() => ({
        native: window.__cardDuelNative?.isOpen?.() === true,
        module: window.__cardDuelNative?.diagnostics?.()?.host?.module ?? null,
        traps: window.__cardDuelNative?.diagnostics?.()?.host?.traps ?? null,
        objects: window.__cardDuelNative?.diagnostics?.()?.host?.objects ?? null,
    }));
    console.log("[verify] duel opened from the field:", JSON.stringify(opened));
    check("the NPC challenge opened the native duel", opened.native === true, `native=${opened.native}`);
    check("the native root is pro/cardgame", opened.module === "pro/cardgame", `module=${opened.module}`);
    check("zero traps on entry", opened.traps === 0, `traps=${opened.traps}`);

    const snap = () => page.evaluate((f) => {
        const rd = (a, s) => window.__nativeScreenRead(a, s) >>> 0;
        const duel = window.__nativeScreenObjects().find((o) => o.cb === f.cb);
        const d = window.__cardDuelNative?.diagnostics?.();
        if (!duel) {
            return {
                closed: true, open: d?.open ?? false, traps: d?.host?.traps ?? 0,
                won: window.__state?.duelWon === true ? 1 : 0,
                counter: window.__state?.duelWinCounts?.[String(f.opponent)] ?? null,
            };
        }
        return {
            closed: false, open: d?.open ?? false, frames: d?.host?.frames ?? 0,
            traps: d?.host?.traps ?? 0, objects: d?.host?.objects ?? 0,
            mode: rd(duel.addr + f.mode, 1), oppDeck: rd(duel.addr + f.oppDeck, 2),
            won: rd(f.won, 4),
        };
    }, { cb: DUEL_CB, mode: MODE, oppDeck: OPPONENT_DECK, won: 0x80048ac0, opponent: 13 });

    // Walk the pre-duel chain to the board, exactly as a player does. The short
    // opponent deck is written the moment the board's first state (mode 3, the
    // coin toss) appears — before the Draw Phase — because the phase's own
    // deck-out test runs in its first steps and anything slower lands after the
    // deal has already resolved.
    let board = await snap();
    let seededShortDeck = false;
    for (let i = 0; i < 40 && board.mode !== 4; i++) {
        await page.keyboard.down("Enter");
        await page.waitForTimeout(220);
        await page.keyboard.up("Enter");
        await page.waitForTimeout(110);
        board = await snap();
        if (!seededShortDeck && board.mode === 3) {
            await page.evaluate((f) => window.__nativeScreenWrite(
                window.__nativeScreenObjects().find((o) => o.cb === f.cb).addr + f.oppDeck, 5, 2), { cb: DUEL_CB, oppDeck: OPPONENT_DECK });
            seededShortDeck = true;
        }
    }
    console.log("[verify] board:", JSON.stringify(board), "short deck seeded:", seededShortDeck);
    check("the board (Draw Phase) is reached from the field entry", board.mode === 4, `mode=${board.mode}`);
    check("zero traps on the board", board.traps === 0, `traps=${board.traps}`);
    const counterBefore = await page.evaluate((o) => window.__state?.duelWinCounts?.[String(o)] ?? 0, 13);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/02-board.png` });

    let lastOpen = await snap();
    let after = lastOpen;
    for (let i = 0; i < 10; i++) {
        await page.keyboard.down("Enter");
        await page.waitForTimeout(220);
        await page.keyboard.up("Enter");
        await page.waitForTimeout(160);
        after = await snap();
        if (!after.closed) lastOpen = after;
        if (after.closed) break;
    }
    await page.waitForTimeout(1500);
    after = await snap();
    console.log("[verify] after the duel:", JSON.stringify(after));
    await page.screenshot({ path: `${OUT}/03-back-on-field.png` });

    check("the duel closed and the field resumed", after.open === false, `open=${after.open}`);
    check("the win was committed by the screen", after.won === 1 || lastOpen.won === 1,
        `state.duelWon=${after.won === 1}`);
    const counterAfter = after.counter ?? lastOpen.counter;
    check("the per-opponent win count persisted", counterAfter === counterBefore + 1,
        `${counterBefore} -> ${counterAfter}`);
    check("the win count is in localStorage", await page.evaluate((o) => {
        const raw = localStorage.getItem("duelWinCounts");
        return !!raw && Number(JSON.parse(raw)[String(o)] ?? 0) >= 1;
    }, 13), "duelWinCounts");
    check("the player is back on the field", await page.evaluate(() =>
        !window.__cardDuelNative?.isOpen?.() && window.__state?.started === true), "field");
    check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

    console.log(`[verify] captures: ${OUT}/01-challenge.png, 02-board.png, 03-back-on-field.png`);
    if (failures) {
        console.error(`FAIL native duel ordinary-play route: ${failures} check(s) failed`);
        process.exitCode = 1;
    } else {
        console.log("PASS native duel ordinary-play route: field challenge -> native duel -> board -> win -> field, result persisted, 0 traps");
    }
} catch (e) {
    console.error("FAIL native duel ordinary-play route: " + e.message);
    if (pageErrors.length) console.error(pageErrors.join("\n"));
    process.exitCode = 1;
} finally {
    await browser.close();
}
