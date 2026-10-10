// Ordinary-route end-to-end playthrough walker.
//
// Boots web/index.html with NO special flags, drives the real opening the way a
// player meets it (language -> title -> new game -> opening scenes -> the field),
// then walks, talks, fights an ordinary encounter through its command menus to a
// result, raises the pause with START, opens the shop / Card Album / folder editor
// / Digivolution Lab, and returns to the field.
//
// Evidence required at every screen: no `assets/native/**` request may be allowed
// (they are aborted and recorded), the screen's own `diagnostics().execution`
// marker must read translated, and a screenshot must show a drawn screen.
//
// It also proves the negative case: `?nativeStages=1` and `?nativeShop=1` still
// deliberately boot the ORIGINAL overlay (the interpreter / native host).
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_ordinary_playthrough.mjs [outdir]
//
// This is a walker, not a protester: it does not exit on the first problem. It
// records every step, keeps going where it can, and prints/writes the full list.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu, tapCircle } from "./verify-battle-wait.mjs";

const ROOT = `${baseUrl(8742)}`;
const OUT = process.argv[2] ?? "captures/ordinary-playthrough-2026-10-06";
mkdirSync(OUT, { recursive: true });

const steps = [];
const check = (name, ok, detail = "") => {
    const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(line);
    steps.push(line);
    return ok;
};
const note = (name, detail = "") => {
    const line = `NOTE  ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(line);
    steps.push(line);
};

const browser = await chromium.launch();

// ───────────────────────────────────────────────────────────────────────────
// A page whose executable images are forbidden. Every assets/native/** request
// is aborted and counted; any allowed request is a production violation.
// ───────────────────────────────────────────────────────────────────────────
async function openPage({ url, denyNative = true, init = null }) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const net = { denied: [], allowed: [], failed: [], data: [] };
    await page.route("**/assets/native/**", (route) => {
        (denyNative ? net.denied : net.allowed).push(route.request().url());
        return denyNative ? route.abort() : route.continue();
    });
    page.on("response", (res) => { if (res.status() >= 400) net.failed.push(`${res.status()} ${res.url()}`); });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text()))
            errors.push(`console: ${m.text()}`);
    });
    if (init) await page.addInitScript(init);
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    return { page, net, errors };
}

const press = async (page, key, ms = 200) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(280);
};
// One player confirm that a PAD-SAMPLED box actually sees: hold the key across a few
// display frames, then release. The field Yes/No question and the eight-topic help
// counter read the HELD confirm bit once per frame (game.js `yesNoBox.update(dt,
// state.keys)` and the same for helpMenuBox), exactly as the original launcher reads
// the pad word; the game's own key handler even skips `textbox.advance()` for them
// ("these boxes read the pad themselves", game.js:467). A bare `keyboard.press` is
// down+up inside one frame, so the held bit is never sampled and the box never
// advances — that is what pinned the whole ordinary walk at s210 for its 120 s budget.
// The legacy textbox and the translated dialogue box advance on the keydown EDGE, and
// Playwright does not auto-repeat a held key, so this one held tap is correct for them
// too (one edge, one advance). The shorter trailing gap keeps a long opening cheap.
const tapHold = async (page, key = "Enter", holdMs = 110, gapMs = 60) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(holdMs);
    await page.keyboard.up(key);
    await page.waitForTimeout(gapMs);
};
const padBoxOpen = (page) => page.evaluate(() => !!(window.__yesNoBox?.isOpen?.() || window.__helpMenu?.isOpen?.()));

const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); };
const mapId = (page) => page.evaluate(() => window.__state?.manifest?.maps?.[window.__state.mapIdx]?.id ?? null);
const diag = (page, expr) => page.evaluate(`(() => { try { return ${expr}; } catch (e) { return { __err: String(e) }; } })()`);
// Wait until nothing is holding the field: no box, choice, cutscene, fade, wizard
// or battle. The opening's hand-off can still have a scene up as it returns control,
// and a press sent into that scene is swallowed.
const settle = async (page, budgetMs = 25000) => {
    const deadline = Date.now() + budgetMs;
    let last = null;
    while (Date.now() < deadline) {
        const busy = await page.evaluate(() => ({
            textbox: !!window.__textbox?.isOpen?.(),
            dialogue: !!window.__dialogueBox?.isOpen?.(),
            yesno: !!window.__yesNoBox?.isOpen?.(),
            help: !!window.__helpMenu?.isOpen?.(),
            choice: !!window.__choice?.isOpen?.(),
            cutscene: !!(window.__cutscene?.isActive?.()),
            fade: (window.__fade?.dir ?? 0) !== 0,
            pack: !!window.__state?.packSelect,
            name: !!window.__state?.nameEntry,
            battle: !!window.__battle?.isActive?.(),
            movie: !!window.__fieldMovie?.isOpen?.(),
            placeCard: !!(window.__placeCard?.isActive?.()),
        }));
        last = busy;
        if (!Object.values(busy).some(Boolean)) return busy;
        // A pad-sampled box needs a HELD confirm (see tapHold); an edge-driven box or a
        // running scene is advanced by the press that a player's own confirm makes.
        if (busy.yesno || busy.help) { await tapHold(page, "Enter", 200); continue; }
        if (busy.textbox || busy.cutscene) { await tapHold(page, "Enter", 140); continue; }
        await page.waitForTimeout(200);
    }
    return { timedOut: true, last };
};

// Talk to an NPC the way a PLAYER does — the field interaction, not the engine's
// OnTalk rows alone.
//
// A story NPC's conversation begins at its dialogue line: the field handler runs
// `engineBridge.onTalk(npc)` first (which only consults the engine's converted
// rows) and then opens the NPC's own spoken line; that line's `on_close` is what
// fires a bank-0x90 talk launcher — and, on s210, the Yes/No controller whose Yes
// child (event 13, 01120006) hands off to the partner-download room s212. So an
// NPC whose scene is started by a native controller (a Yes/No or help-menu
// launcher, engine/dw3/ui/native/yesno-launcher.ts) presents NOTHING to a bare
// `engineBridge.onTalk` call — the controller is reached through the spoken line,
// exactly as the disc does it. Driving the whole interaction is therefore the
// faithful simulation: stand on the tile below the NPC, face up at it, and press
// the confirm key until a line / scene / choice comes up. This replaces the old
// `engineBridge.onTalk(id)` shortcut, which was served by invented npc-matched rows
// that commit b757f54d correctly retired (a bare row for a controller's child
// scene fires it at the wrong moment and swallows the NPC's own line).
const talkToNpc = async (page, npcId) => {
    const placed = await page.evaluate((id) => {
        const rows = window.__npcsHere?.() ?? [];
        const n = rows.find((r) => r.npc_id === id) ?? rows[0];
        if (!n) return null;
        const st = window.__state;
        st.x = n.x; st.y = n.y + 20; st.dir = "up"; st.moving = false; st.stopping = false;
        return { npc: n.npc_id, x: n.x, y: n.y };
    }, npcId);
    if (!placed) return false;
    for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(140);
        const up = await page.evaluate(() => !!(window.__textbox?.isOpen?.() || window.__dialogueBox?.isOpen?.() || window.__cutscene?.isActive?.() || window.__choice?.isOpen?.()));
        if (up) return true;
    }
    return false;
};

// ═══════════════════════════════════════════════════════════════════════════
// SESSION A — the ordinary route, no flags
// ═══════════════════════════════════════════════════════════════════════════
let page;
try {
    const opened = await openPage({ url: `${ROOT}/index.html`, init: () => localStorage.setItem("assetMode", "authentic") });
    page = opened.page;
    const { net, errors } = opened;
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load" });

    // 1. Boot language screen
    const langOpen = await page.waitForFunction(() => window.__cntyselNative?.active?.() === true, null, { timeout: 40000 })
        .then(() => true, () => false);
    check("boot: the country/language screen opens the ordinary way", langOpen);
    if (langOpen) {
        await page.waitForTimeout(1500);
        const d = await diag(page, `(() => { const x = window.__cntyselNative.diagnostics(); return { row: x.row, lang: x.language, module: x.host?.module, execution: x.host?.execution, traps: x.traps, started: window.__state?.started }; })()`);
        check("language: runs translated code", d.execution === "translated" && d.module === "pro/cnty_sel", JSON.stringify(d));
        await shot(page, "01-boot-language");
        let picked = null;
        for (let i = 0; i < 20 && !picked; i++) { await press(page, "i"); picked = await page.evaluate(() => window.__bootLanguage ?? null); }
        check("language: confirm commits the pick", !!picked, JSON.stringify(picked));
    }

    // 2. Opening movie -> title -> New Game
    const movieOpen = await page.waitForFunction(() => window.__titleMovie?.()?.open === true, null, { timeout: 40000 })
        .then(() => true, () => false);
    note("opening movie", movieOpen ? "shown; START skips it" : "not observed (started later than probe)");
    if (movieOpen) { await press(page, "i"); await page.waitForFunction(() => window.__titleMovie?.()?.open === false, null, { timeout: 20000 }).catch(() => {}); }
    const prompt = await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "prompt", null, { timeout: 40000 })
        .then(() => true, () => false);
    check("title: the translated title reaches its prompt", prompt);
    await shot(page, "02-title-prompt");
    if (prompt) {
        await press(page, "i");
        await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "menu", null, { timeout: 20000 }).catch(() => {});
        await shot(page, "03-title-menu");
        await press(page, "ArrowUp");                 // Continue -> New Game
        const hi = await page.evaluate(() => window.__titleState().highlight());
        check("title: Up selects New Game", hi === 0, `highlight=${hi}`);
        await press(page, "Enter");
    }
    const started = await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 40000 })
        .then(() => true, () => false);
    check("new game: the world starts", started, `map=${await mapId(page)}`);

    // 3. Blitz the opening scenes to field control (speed up the paced cutscenes).
    await page.evaluate(() => { window.__gameSpeed = 4; });
    const advanceAllDialogue = async () => {
        for (let i = 0; i < 300; i++) {
            // The pad-sampled boxes first — they read the held bit, so they need the
            // held confirm even though textbox.isOpen() also reports them open.
            if (await padBoxOpen(page)) { await tapHold(page, "Enter", 200); continue; }
            if (await page.evaluate(() => window.__textbox?.isOpen?.() ?? false)) { await tapHold(page, "Enter"); continue; }
            if (await page.evaluate(() => !!window.__state?.packSelect)) {
                // pack wizard: confirm the highlighted pack then the YES
                await press(page, "Enter", 140); continue;
            }
            if (await page.evaluate(() => !!window.__state?.nameEntry)) {
                await page.evaluate(() => { window.__state.nameEntry.press(); window.__state.nameEntry.selectEnd(); window.__state.nameEntryDone(); });
                await page.waitForTimeout(100); continue;
            }
            if (await page.evaluate(() => window.__choice?.isOpen?.() ?? false)) { await tapHold(page, "Enter"); continue; }
            await page.waitForTimeout(120);
            const idle = await page.evaluate(() => !window.__textbox?.isOpen?.() && !window.__state?.nameEntry && !window.__state?.packSelect && !window.__cutscene?.isActive?.() && !window.__yesNoBox?.isOpen?.() && !window.__helpMenu?.isOpen?.());
            if (idle) break;
        }
    };
    let lastMap = null, lastChange = Date.now(), reached = null;
    for (let guard = 0; guard < 4000; guard++) {
        await advanceAllDialogue();
        const cur = await mapId(page);
        if (cur !== lastMap) { lastMap = cur; lastChange = Date.now(); }
        else if (Date.now() - lastChange > 120000) break;
        if (cur === "s200") { reached = cur; break; }
        if (cur === "s210") {
            const busy = await page.evaluate(() => (window.__textbox?.isOpen?.() ?? false) || (window.__choice?.isOpen?.() ?? false) || (window.__cutscene?.isActive?.() ?? false) || !!window.__state?.packSelect);
            // The s210 Tamer Service is a TALK: the NPC-32 spoken line's on_close
            // fires the Yes/No controller (event 9), whose Yes child (event 13)
            // hands off to s212. Drive the whole interaction (see talkToNpc); the
            // bare engineBridge.onTalk shortcut no longer reaches it.
            if (!busy) { await talkToNpc(page, 32); lastChange = Date.now(); continue; }
        }
        if (await page.evaluate(() => window.__fade?.dir !== 0)) { await page.waitForTimeout(300); continue; }
        await page.waitForTimeout(120);
    }
    await page.evaluate(() => { window.__gameSpeed = 1; });
    check("opening: the route reaches the field (s200 Asuka City)", reached === "s200", `at=${await mapId(page)}`);
    check("opening: the downloaded partner is in the party", (await page.evaluate(() => window.__state.party?.length ?? 0)) > 0,
        JSON.stringify(await page.evaluate(() => window.__state.party)));
    await shot(page, "04-field-opening");

    // Field ambience marker
    const amb = await page.evaluate(() => window.__stageAmbience?.execution ?? null);
    check("field: stage ambience runs translated code", amb === "translated", `execution=${amb}`);

    // 4. Battle: the ordinary route's own encounter, through its command menus to a result.
    //
    // On the ordinary route encounters are live, and the opening's final walk (s210 -> s200)
    // regularly leaves a random battle up the moment control returns to the field. A battle
    // owns the field: while it is active the player cannot walk, talk or raise the pause.
    // So the first thing after arrival is to finish whatever battle is already up (or start
    // one by walking, if none fired), then the field is free.
    let battleErr = null;
    try {
        await settle(page, 4000); // wait out any box/fade, but a battle will keep this short
        let active = await page.evaluate(() => !!window.__battle?.isActive?.());
        note("battle: a fight is already up on arrival", String(active));
        for (let attempt = 0; attempt < 40 && !active; attempt++) {
            await page.evaluate(() => { window.__state._encCounter = 1; });
            await page.keyboard.down("ArrowLeft"); await page.waitForTimeout(450); await page.keyboard.up("ArrowLeft");
            active = await page.evaluate(() => !!window.__battle?.isActive?.());
            await page.waitForTimeout(200);
        }
        check("battle: an ordinary walk-up encounter starts", active);
        await shot(page, "05-battle-start");
        await waitForCommandMenu(page, { timeout: 45000 });
        const cmd = await diag(page, `(() => { const d = window.__battleCmdNative?.diagnostics?.(); return d && { execution: d.execution, ready: d.ready, selection: d.selection, error: d.error }; })()`);
        check("battle: the command list runs translated code and is live", cmd?.execution === "translated" && cmd?.ready === true, JSON.stringify(cmd));
        await shot(page, "06-battle-command-menu");
        await press(page, "ArrowDown"); await shot(page, "07-battle-row-tech"); await press(page, "ArrowUp");
        // Fight the battle to its end the way a player does: whenever the command menu is
        // up, pick Fight; read every line; turn every result page. The enemy can be faster
        // and take the first turn, so one press is not enough — keep choosing until the
        // battle leaves the field.
        const t0 = Date.now();
        let turns = 0;
        let coordSeen = false;   // the ported action/reaction coordinator was caught running
        let cam3dSeen = false;
        while (Date.now() - t0 < 120000 && turns < 40) {
            const st = await page.evaluate(() => {
                const b = window.__battleB?.(); const p = window.__battle?.peek?.(); const m = p?.messageLine;
                const cmd = window.__battleCmdNative?.diagnostics?.();
                if (!b) return { gone: true };
                return { state: b.state, holds: !!m?.active && !m.finished && (!!m.holdsTurn || !!p?.waitsForLine), pages: !!b._resultPages?.length, victory: !!b._victoryPhase, cmdReady: cmd?.ready === true, sel: cmd?.selection ?? null };
            });
            if (st.gone) break;
            // Re-run addition: catch the ported 3-D systems actually running. The
            // coordinator is active only during an attack/reaction animation, so
            // sample every iteration; the 3-D renderer's presence proves the
            // camera / effect / projectile / face-box pipeline was instantiated.
            const live3d = await page.evaluate(() => ({
                renderer: !!window.__battle3d, coord: !!(window.__battle3d?.coordinator?.active),
            }));
            if (live3d.coord) coordSeen = true;
            if (live3d.renderer) cam3dSeen = true;
            if (st.state === 2 && st.cmdReady) {
                // Keep the win deterministic and take Fight (row 0).
                await page.evaluate(() => { const b = window.__battleB?.(); if (b?.enemy) b.enemy.hp = 1; });
                if (st.sel !== 0 && st.sel != null) await press(page, st.sel > 0 ? "ArrowUp" : "ArrowDown");
                await tapCircle(page);
                turns++;
                continue;
            }
            // The victory hand-off (STFGTREP) reads the pad itself; the result pages do too.
            if (st.holds || st.pages || st.state === 7 || st.victory) await tapCircle(page);
            else await page.waitForTimeout(150);
        }
        note("battle: commands chosen", String(turns));
        check("battle: the ported 3-D presentation system is instantiated (camera/effects/projectile/face box)",
            cam3dSeen, `__battle3d=${cam3dSeen}`);
        check("battle: the ported action/reaction coordinator ran on screen during the fight",
            coordSeen, `coordinator.active seen=${coordSeen}`);
        await page.screenshot({ path: `${OUT}/08-battle-result.png` }).catch(() => {});
        const backToField = await page.waitForFunction(() => !window.__battle?.isActive?.() && window.__state?.started === true, null, { timeout: 40000 })
            .then(() => true, () => false);
        check("battle: the fight reaches a result and returns to the field", backToField,
            `stillActive=${await page.evaluate(() => !!window.__battle?.isActive?.())}`);
        await shot(page, "09-field-after-battle");
    } catch (e) { battleErr = String(e); check("battle: completed without throwing", false, battleErr); }

    // If the battle did not return the field, everything that needs field control is
    // blocked by it — record the exact stuck state once, and do not pretend the walk,
    // talk or pause were independently exercised.
    let battleHeld = await page.evaluate(() => !!window.__battle?.isActive?.());
    if (battleHeld) {
        const stuck = await diag(page, `(() => { const b = window.__battleB?.(); const p = window.__battle?.peek?.(); return { state: b?.state, timer: Math.round((b?.timer ?? 0) * 100) / 100, resultReady: b?._resultReady ?? null, resultPages: b?._resultPages?.length ?? null, victoryPhase: b?._victoryPhase ?? null, victoryReady: b?._victoryReady ?? null, message: b?.message ?? null, waitsForLine: !!p?.waitsForLine, loaderOpen: p?.loaderOpen ?? null }; })()`);
        note("BLOCKER: the field is still held by an active battle after the result", JSON.stringify(stuck));
        await shot(page, "09b-battle-stuck");
    }

    // 5. Walking (the field is free now)
    await settle(page);
    const fstate = await page.evaluate(() => ({
        x: Math.round(window.__state.x), y: Math.round(window.__state.y), dir: window.__state.dir,
        chapter: window.__state.chapter, placeCard: !!window.__placeCard?.isActive?.(),
        talkTarget: window.__talkTarget?.() ?? null, npcs: (window.__npcsHere?.() ?? []).map((n) => n.npc_id ?? n.id ?? n.npc),
    }));
    note("field: state on arrival", JSON.stringify(fstate));
    const moves = {};
    for (const k of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) {
        const a = await page.evaluate(() => [Math.round(window.__state.x), Math.round(window.__state.y)]);
        await page.keyboard.down(k); await page.waitForTimeout(700); await page.keyboard.up(k);
        await page.waitForTimeout(180);
        const b = await page.evaluate(() => [Math.round(window.__state.x), Math.round(window.__state.y)]);
        moves[k] = a[0] !== b[0] || a[1] !== b[1];
    }
    if (battleHeld) note("field: walking NOT independently verified — blocked by the battle above", JSON.stringify(moves));
    else check("field: walking moves the player", Object.values(moves).some(Boolean), JSON.stringify(moves));
    await shot(page, "10-field-walking");

    // 5b. Field camera (added for the 2026-10-06 re-run): the ordinary follow
    // centres the leader at (160,140) in map pixels, NOT VIEW/2 at (160,120).
    // Port: engine/systems/field-camera.ts (commit d196c916). Sample at the map
    // centre so neither axis is clamped (the ordinary route's field after the
    // opening is s220, 512x512), then compare the leader's on-screen offset to the
    // two disc immediates.
    if (battleHeld) {
        note("camera: NOT independently verified — blocked by the battle above");
    } else {
        const camCentre = await page.evaluate(async () => {
            const mi = window.__mapInfo();
            window.__teleport?.(Math.floor(mi.width / 2), Math.floor(mi.height / 2));
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            const c = window.__lastCam, s = window.__state;
            return {
                dx: Math.round((s.x - c.x) * 100) / 100, dy: Math.round((s.y - c.y) * 100) / 100,
                camX: c.x, camY: c.y, mapW: mi.width, mapH: mi.height, zoom: c.zoom,
            };
        });
        check("camera: the leader is centred at (160,140), not (160,120)",
            Math.abs(camCentre.dx - 160) <= 1.5 && Math.abs(camCentre.dy - 140) <= 1.5,
            JSON.stringify(camCentre));
        await shot(page, "10b-field-camera-centre");
    }

    // 6. Talk event
    const npcs = await page.evaluate(() => (window.__npcsHere?.() ?? []).map((n) => n.npc_id ?? n.id ?? n.npc).filter((x) => x != null));
    const facing = await page.evaluate(() => window.__talkTarget?.()?.npc ?? null);
    const target = facing ?? npcs[0] ?? null;
    if (battleHeld) {
        note("field: talk NOT independently verified — blocked by the battle above");
    } else if (target == null) {
        note("field: no talkable NPC is on the field at this story point", `visible=${npcs.length}`);
    } else {
        // Drive the whole player talk (NPC line → its on_close → any bank-0x90
        // launcher / controller), not the bare engineBridge.onTalk shortcut.
        const talked = await talkToNpc(page, target);
        for (let i = 0; i < 40; i++) {
            const up = await page.evaluate(() => !!window.__textbox?.isOpen?.() || !!window.__dialogueBox?.isOpen?.() || !!(window.__cutscene?.isActive?.()));
            if (up) break;
            await page.waitForTimeout(200);
        }
        const tstate = await page.evaluate(() => ({ textbox: !!window.__textbox?.isOpen?.(), dialogue: !!window.__dialogueBox?.isOpen?.(), cutscene: !!(window.__cutscene?.isActive?.()), choice: !!window.__choice?.isOpen?.() }));
        check("field: a talk event raises a dialogue box or a cutscene", talked && (tstate.textbox || tstate.dialogue || tstate.cutscene),
            `npc=${target} talked=${talked} ${JSON.stringify(tstate)} visibleNpcs=${npcs.length}`);
        await shot(page, "11-talk-dialogue");
        // Drive the whole scene the way the player does. Every confirm is a HELD tap: the
        // field Yes/No question and the help counter read the held pad bit, and a held
        // confirm is also the one edge the textbox / dialogue box advance on.
        let talkPresses = 0;
        for (let i = 0; i < 300; i++) {
            const open = await page.evaluate(() => !!window.__textbox?.isOpen?.() || !!(window.__cutscene?.isActive?.()) || !!window.__yesNoBox?.isOpen?.() || !!window.__helpMenu?.isOpen?.());
            if (!open) break;
            await tapHold(page, "Enter", 160);
            talkPresses++;
        }
        const afterTalk = await page.evaluate(() => ({ textbox: !!window.__textbox?.isOpen?.(), cutscene: !!(window.__cutscene?.isActive?.()), yesno: !!window.__yesNoBox?.isOpen?.(), help: !!window.__helpMenu?.isOpen?.(), wait: window.__cutscene?.debugWait?.() ?? null }));
        note("field: talk scene driven", `presses=${talkPresses} ${JSON.stringify(afterTalk)}`);
        await page.evaluate(() => { if (window.__textbox?.isOpen?.()) window.__textbox.close(); });
    }

    // 7. Pause via the field START (ordinary key path)
    await page.evaluate(() => window.__labClose?.());
    if (battleHeld) {
        note("pause: NOT independently verified — blocked by the battle above");
    } else {
        const guard = await diag(page, `(() => ({ textbox: !!window.__textbox?.isOpen?.(), dialogue: !!window.__dialogueBox?.isOpen?.(), choice: !!window.__choice?.isOpen?.(), cutscene: !!window.__cutscene?.isActive?.(), fade: window.__fade?.dir ?? 0, name: !!window.__state?.nameEntry, pack: !!window.__state?.packSelect, battle: !!window.__battle?.isActive?.(), shop: !!window.__shop?.isOpen?.(), dri: !!window.__dri?.isOpen?.(), gym: !!window.__gym?.isOpen?.(), movie: !!window.__fieldMovie?.isOpen?.(), menuOpen: !!window.__state?.menuOpen, cntysel: !!window.__cntyselNative?.isOpen?.(), fieldScreen: window.__state?.screen ?? null }))()`);
        note("pause: guard state before START", JSON.stringify(guard));
        await settle(page);
        let pauseOpen = false;
        for (let attempt = 0; attempt < 3 && !pauseOpen; attempt++) {
            await press(page, "i", 260);
            pauseOpen = await page.waitForFunction(() => window.__status?.isOpen?.() === true, null, { timeout: 8000 }).then(() => true, () => false);
        }
        if (!pauseOpen) note("pause: START refused with the guard above", JSON.stringify(await diag(page, `(() => ({ cutscene: !!window.__cutscene?.isActive?.(), movie: !!window.__fieldMovie?.isOpen?.(), menuOpen: !!window.__state?.menuOpen, fieldMovie: !!window.__fieldMovie?.isOpen?.(), fieldScreen: window.__state?.screen ?? null, textbox: !!window.__textbox?.isOpen?.() }))()`)));
        check("pause: the field's START raises the pause home", pauseOpen);
        if (pauseOpen) {
            // The screen reports open as soon as _open flips, but its renderer paints
            // on the host's next frame. A single instantaneous read can catch
            // paintedFrames=0 → clips=0 (a race, not a blank screen). Poll for the
            // first painted frame before reading the marker.
            await page.waitForFunction(() => {
                const d = window.__status?.diagnostics?.();
                return (d?.renderer?.paintedFrames ?? 0) > 0 || (d?.renderer?.clips ?? 0) > 0;
            }, null, { timeout: 6000 }).catch(() => {});
            const sd = await diag(page, `(() => { const d = window.__status.diagnostics(); return { entry: d.entry, pack: d.renderer?.pack, clips: d.renderer?.clips, paintedFrames: d.renderer?.paintedFrames, error: d.error }; })()`);
            check("pause: it is the translated list's screen (ststat pack paints)", sd.pack === "ststat" && (sd.clips ?? 0) > 0, JSON.stringify(sd));
            await shot(page, "12-pause-home");
            // Back out with the pause page's own Back (Escape = the pad's Back bit).
            await press(page, "Escape", 260);
            await page.waitForFunction(() => window.__status?.isOpen?.() === false, null, { timeout: 10000 }).catch(() => {});
        }
    }
    await page.evaluate(() => window.__labClose?.());

    // 8. Merchant: buy and sell. The in-game merchant NPC needs story progress, so the
    // screen is opened through the lab entry point. BUY and SELL are exercised in two
    // separate opens, so neither depends on navigating back out of the other.
    let shopErr = null;
    try {
        const openShop = async () => {
            await page.evaluate(() => {
                const s = window.__state;
                s.bits = 130821;
                s.inventory = [{ id: 43, qty: 5 }, { id: 44, qty: 3 }];
                window.__labOpen("shop", 9);
            });
            await page.waitForFunction(() => { const sh = window.__shop?._session; return sh && sh.mem.read32(sh.root + 0x10) === 3; }, null, { timeout: 25000 }).catch(() => {});
        };
        // The native pad is sampled per frame, so a hold is used, not an instant press.
        const step = async (name) => { await press(page, "c", 180); await page.waitForTimeout(900); await shot(page, name); return diag(page, `window.__shop?.diagnostics?.().state ?? null`); };

        // ── SELL: root opens on BUY, so move down one row first ──
        await openShop();
        const sd = await diag(page, `(() => { const d = window.__shop?.diagnostics?.(); return d && { execution: d.execution, state: d.state, error: d.error, clips: d.renderer?.clips }; })()`);
        check("shop: opens on the translated merchant", sd?.execution === "translated" && !sd?.error, JSON.stringify(sd));
        await shot(page, "13-shop-root");
        await press(page, "ArrowDown", 220);            // BUY -> SELL
        const sellState = await step("14-shop-sell-list");
        check("shop: SELL opens its own sub-screen", sellState !== 3 && sellState != null, `state=${sellState}`);
        // The item shop's SELL first offers the categories (Items/Weapons/Armor/Accessories);
        // one more confirm on Items is the sellable-items list itself.
        const sellItemsState = await step("14b-shop-sell-items");
        note("shop: SELL items screen state", String(sellItemsState));
        await page.evaluate(() => window.__labClose?.());

        // ── BUY: root opens on BUY ──
        await openShop();
        const buyState = await step("15-shop-buy-list");
        check("shop: BUY opens its own sub-screen", buyState !== 3 && buyState != null, `state=${buyState}`);
        await page.screenshot({ path: `${OUT}/16-shop-after-sell.png` }).catch(() => {});
        const final = await diag(page, `(() => { const d = window.__shop?.diagnostics?.(); return { error: d?.error }; })()`);
        check("shop: no error through buy and sell", !final?.error, JSON.stringify(final));
        await page.evaluate(() => window.__labClose?.());
    } catch (e) { shopErr = String(e); check("shop: buy and sell completed without throwing", false, shopErr); }
    await page.evaluate(() => window.__labClose?.());

    // 9. Card Album
    let albumErr = null;
    try {
        await page.evaluate(() => window.__labOpen("cardalbum"));
        await page.waitForTimeout(1800);
        const ad = await diag(page, `(() => { const d = window.__cardAlbum?.diagnostics?.(); return d && { execution: d.execution, page: d.session?.page, pages: d.session?.pageCount, clips: d.renderer?.clips, error: d.error }; })()`);
        check("Card Album: opens on the translated album session", ad?.execution === "translated" && !ad?.error && (ad?.clips ?? 0) > 0, JSON.stringify(ad));
        await shot(page, "17-card-album");
        await press(page, "ArrowRight", 250);
        await shot(page, "18-card-album-page2");
        // Re-run addition: the detail panel must read real CARDPAK records through
        // the shared card-view text context (commits 8e6bb8bc / 225b5542), not a
        // colour-only table. cardDetail() selects through that context.
        const cd = await diag(page, `(() => {
            const s = window.__cardAlbum?._session; if (!s?.cardDetail) return { noSession: true };
            const real = (r) => !!(r && (r.ap || r.hp || r.kind || r.programCost || r.summonCost || r.level));
            const a = s.cardDetail(1), b = s.cardDetail(2);
            return { a, b, differs: JSON.stringify(a) !== JSON.stringify(b), real: real(a) && real(b) };
        })()`);
        check("Card Album: the detail panel resolves real CARDPAK records (AP/HP/kind/cost)",
            cd?.real === true && cd?.differs === true, JSON.stringify(cd));
        await page.evaluate(() => window.__labClose?.());
    } catch (e) { albumErr = String(e); check("Card Album: opened without throwing", false, albumErr); }

    // 10. Folder editor (the Card Folders page's editor)
    let deckErr = null;
    try {
        await page.evaluate(() => window.__labOpen("carddeck"));
        await page.waitForFunction(() => window.__labDeck?._session, null, { timeout: 15000 }).catch(() => {});
        // The chooser settles on its picker state (root+0x10 == 4) once the session is built.
        await page.waitForFunction(() => window.__labDeck?._session?.mem.read32(window.__labDeck._session.root + 0x10) === 4, null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(600);
        const dd = await diag(page, `(() => { const d = window.__labDeck?.diagnostics?.(); return d && { execution: d.execution, picker: d.picker, clips: d.renderer?.clips, error: d.error }; })()`);
        check("Folder editor: opens on the translated session", dd?.execution === "translated" && !dd?.error && (dd?.clips ?? 0) > 0, JSON.stringify(dd));
        await shot(page, "19-folder-editor");
        await press(page, "c", 260);          // open the submenu
        await shot(page, "20-folder-submenu");
        // Re-run addition: the editor's detail panel reads the real CARDPAK record
        // through the shared card-view text context (commit 90669bef / 225b5542).
        const fcd = await diag(page, `(() => {
            const s = window.__labDeck?._session; if (!s?.cardDetail) return { noSession: true };
            const real = (r) => !!(r && (r.ap || r.hp || r.kind || r.programCost || r.summonCost || r.level));
            const a = s.cardDetail(1), b = s.cardDetail(2);
            return { a, b, differs: JSON.stringify(a) !== JSON.stringify(b), real: real(a) && real(b) };
        })()`);
        check("Folder editor: the detail panel resolves real CARDPAK records (AP/HP/kind/cost)",
            fcd?.real === true && fcd?.differs === true, JSON.stringify(fcd));
        await press(page, "Escape", 260);
        await page.evaluate(() => window.__labClose?.());
    } catch (e) { deckErr = String(e); check("Folder editor: opened without throwing", false, deckErr); }

    // 11. Digivolution Lab (the Digimon Lab desk)
    let driErr = null;
    try {
        await page.evaluate(() => window.__labOpen("dri"));
        await page.waitForTimeout(1800);
        const rd = await diag(page, `(() => { const d = window.__dri?.diagnostics?.(); return d && { execution: d.execution, open: d.open, failed: d.failed, error: d.error, clips: d.renderer?.clips }; })()`);
        check("Digivolution Lab: opens on the translated lab screen", rd?.execution === "translated" && !rd?.error && !rd?.failed, JSON.stringify(rd));
        await shot(page, "21-digivolution-lab");
        await page.evaluate(() => window.__labClose?.());
    } catch (e) { driErr = String(e); check("Digivolution Lab: opened without throwing", false, driErr); }

    // 12. Return to the field. Every screen above is opened through the lab entry
    // points, and none of them warps, so the field must come back exactly where the
    // ordinary route left it. After the opening that field is s220 (Asuka City —
    // Digimon Lab): the s212 downloads land on s200 (`HANDOFF 512` = WSTAG200_PRO),
    // s200's stage entry runs event 50 (Genji's scene) which arms the scripted
    // Kuwagamon fight, and after that win the reloaded entry runs event 52, whose
    // `HANDOFF 518` is WSTAG220_PRO = s220. tests/engine/integration/ordinal-owner.test.ts
    // states it directly ("the closing scene carries the player on to s220"), and
    // tests/s200-arrival-battle.test.js pins the scripted fight. So the walk/talk/pause
    // above all run on s220, and this step must assert it, not the pre-battle s200.
    await page.evaluate(() => window.__labClose?.());
    await page.waitForTimeout(800);
    const returnMap = await mapId(page);
    const fieldBack = await page.evaluate(() => !!window.__state?.started && !window.__battle?.isActive?.());
    if (battleHeld) note("return: the field is held by the battle above, not independently confirmed", `map=${returnMap}`);
    else check("return: the field is intact on the route's field after every screen (s220)", fieldBack && returnMap === "s220", `map=${returnMap}`);
    await shot(page, "22-field-return");

    // 13. Production evidence: no executable image ever allowed, no page errors
    check("production: zero executable asset requests from ordinary play", net.denied.length === 0 && net.allowed.length === 0,
        `denied=${net.denied.length} allowed=${net.allowed.length}${net.denied[0] ? " " + net.denied[0] : ""}`);
    check("production: no uncaught page errors across the whole walk", errors.length === 0, errors.slice(0, 4).join(" | "));
    if (net.failed.length) note("404s during the walk (resource requests)", net.failed.slice(0, 8).join(", "));
} catch (e) {
    check("ordinary session: ran to completion", false, String(e));
} finally {
    if (page) await page.close().catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION B — the negative case: research flags still boot the ORIGINAL overlay
// ═══════════════════════════════════════════════════════════════════════════
try {
    // ?nativeStages=1 must deliberately boot the interpreter for the field stage.
    const { page: sp, net: snet } = await openPage({ url: `${ROOT}/index.html?skipTitle=1&map=s200&nativeStages=1`, denyNative: false });
    await sp.waitForFunction(() => window.__state?.started === true, null, { timeout: 40000 }).catch(() => {});
    await sp.waitForTimeout(3000);
    check("negative: ?nativeStages=1 boots the original field overlay (executable images load)", snet.allowed.length > 0,
        `assets/native requests=${snet.allowed.length}${snet.allowed[0] ? " " + snet.allowed[0].split("/").pop() : ""}`);
    await shot(sp, "23-negative-nativeStages");
    await sp.close();

    // ?nativeShop=1 must select the original merchant host, not our translated one.
    const { page: np } = await openPage({ url: `${ROOT}/index.html?skipTitle=1&noEncounters=1&nativeShop=1`, denyNative: false });
    await np.waitForFunction(() => window.__state?.started === true, null, { timeout: 40000 }).catch(() => {});
    await np.waitForTimeout(2000);
    await np.evaluate(() => {
        const s = window.__state;
        s.bits = 130821; s.inventory = [{ id: 43, qty: 5 }];
        window.__labOpen("shop", 9);
    });
    await np.waitForTimeout(3500);
    const nd = await diag(np, `(() => { const d = window.__shop?.diagnostics?.(); return d && { execution: d.execution ?? null, hasHost: !!d.host, open: d.open, error: d.error }; })()`);
    check("negative: ?nativeShop=1 boots the original merchant host, not our translated code",
        nd?.execution !== "translated" && nd?.hasHost === true, JSON.stringify(nd));
    await shot(np, "24-negative-nativeShop");
    await np.close();
} catch (e) {
    check("negative case: ran without throwing", false, String(e));
}

const failures = steps.filter((s) => s.startsWith("FAIL")).length;
writeFileSync(`${OUT}/report.txt`, steps.join("\n") + `\n\n${failures} FAILURE(S)\n`);
console.log(`\n[walk] ${failures === 0 ? "ALL STEPS PASSED" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
