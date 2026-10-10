// Deep-route end-to-end walker.
//
// THE GAP THIS CLOSES. Every verification this project has is the OPENING ROUTE
// (tools/verify_ordinary_playthrough.mjs): language, title, New Game, the opening
// maps, one scripted arrival fight, a talk, the pause, a shop, the album, the
// folder editor, the lab — and it stops at s200 Asuka City. Nothing past that has
// ever been walked on the ordinary route.
//
// This walker starts from the furthest fixture the repo legitimately offers — the
// `?skipTitle=1&map=<stage>` boot with a seeded party/ordinal (the same fixture
// boot the translated-screen verifiers use; the story spine is
// web/assets/data/debug_spine.json) — walks each later stage, takes a battle in a
// later area, enters a gym and tries the arena, and records what a player meets
// and what breaks. It also re-runs the ORDINARY boot with no flags as a
// regression probe, so a working-tree break shows up beside the deep reach.
//
// Evidence at every step: no `assets/native/**` request may be allowed (aborted
// and counted), the screen's `execution` marker must read translated, and a
// screenshot must show the screen.
//
// HARNESS SHIM (documented, toggle DEEP_ALLOW_MISSING_SPRITE=0 to disable): the
// field render throws on a missing sprite image and, because the throw is inside
// render() before the next requestAnimationFrame, the whole game loop dies on any
// `?skipTitle=1&map=` boot (the player sprite is not set up on that path). The
// shim wraps CanvasRenderingContext2D.drawImage to skip non-image args and count
// them, so the loop survives and the deep content can be walked. It is a verifier
// test double, not a game fix; with it off the field is frozen from frame one.
//
//   python3 -m http.server 8752 --directory web   # or the VERIFY_PORT target
//   VERIFY_PORT=8752 tools/run-playwright.sh tools/verify_deep_playthrough.mjs [outdir]

import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu, tapCircle } from "./verify-battle-wait.mjs";

// The disc's per-stage default spawn (descriptor +0x2C/+0x30, 24.8 fixed >> 8):
// where a stage entered with no warp places the leader (tools/extract_stage_default_spawn.py).
const SPAWN = JSON.parse(readFileSync("web/assets/data/stage_default_spawn.json", "utf8"));

const ROOT = `${baseUrl(Number(process.env.DEEP_PORT ?? 8752))}`;
const OUT = process.argv[2] ?? "captures/deep-playthrough-2026-10-06";
const ALLOW_MISSING_SPRITE = process.env.DEEP_ALLOW_MISSING_SPRITE !== "0";
mkdirSync(OUT, { recursive: true });

const steps = [];
const check = (name, ok, detail = "") => {
    const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(line); steps.push(line); return ok;
};
const note = (name, detail = "") => { const line = `NOTE  ${name}${detail ? ` — ${detail}` : ""}`; console.log(line); steps.push(line); };

// Deeper story-spine beats (web/assets/data/debug_spine.json). ordinal = the
// master story ordinal the stage's own entry handler matches at that beat.
const LADDER = [
    { stage: "s200", ordinal: 4, name: "Central Sector — Asuka City" },
    { stage: "s210", ordinal: 4, name: "Asuka City — Main Lobby" },
    { stage: "s220", ordinal: 4, name: "Asuka City (east)" },
    { stage: "s420", ordinal: 5, name: "East Sector — Seiryu City" },
    { stage: "s480", ordinal: 8, name: "South Sector — Jungle Grave" },
    { stage: "s520", ordinal: 11, name: "Suzaku City — Suzaku Hall" },
    { stage: "s685", ordinal: 16, name: "Byakko City — Underground Cave" },
    { stage: "s750", ordinal: 32, name: "North Sector — Chamber Room", arrivalHandoff: "s805" },
    { stage: "s820", ordinal: 43, name: "Spy Satellite — Control Room" },
    { stage: "s780", ordinal: 45, name: "Kusanagi City — Street Corner" },
];

const browser = await chromium.launch();
const allErrors = [];

async function newPage({ seedOrdinal = 0, allowMissingSprite = ALLOW_MISSING_SPRITE } = {}) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const net = { denied: [], allowed: [], failed: [] };
    await page.route("**/assets/native/**", (route) => { net.denied.push(route.request().url()); return route.abort(); });
    page.on("response", (res) => { if (res.status() >= 400) net.failed.push(`${res.status()} ${res.url().split("/").pop()}`); });
    const errors = [];
    const story = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${(e.message || String(e)).split("\n")[0]}`));
    page.on("console", (m) => {
        const t = m.text();
        if (t.includes("[STORY]")) story.push(t.replace(/^%c.*?%c /, ""));
        if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(t)) errors.push(`console: ${t}`);
    });
    await page.addInitScript(({ allowMissingSprite, seedOrdinal }) => {
        if (allowMissingSprite) {
            const proto = CanvasRenderingContext2D.prototype;
            const native = proto.drawImage;
            window.__badDraws = [];
            proto.drawImage = function (image, ...args) {
                const ok = image && image.width !== undefined && typeof image !== "string";
                if (!ok) { window.__badDraws.push(typeof image); return; }
                return native.call(this, image, ...args);
            };
            window.__badDrawsAreShim = true;
        }
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
        localStorage.setItem("packId", "A");
        localStorage.setItem("charId", "p003pken");
        localStorage.setItem("progressOrdinal", String(seedOrdinal));
    }, { allowMissingSprite, seedOrdinal });
    return { page, net, errors, story };
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const mapId = (page) => page.evaluate(() => window.__state?.manifest?.maps?.[window.__state?.mapIdx]?.id ?? null);
const hold = async (page, key, ms = 220) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(260); };
const diag = (page, expr) => page.evaluate(`(() => { try { return ${expr}; } catch (e) { return { __err: String(e) }; } })()`);

async function bootStage(stage, ordinal, { noEncounters = true, timeout = 45000 } = {}) {
    const { page, net, errors, story } = await newPage({ seedOrdinal: ordinal });
    const url = `${ROOT}/index.html?skipTitle=1&map=${stage}${noEncounters ? "&noEncounters=1" : ""}`;
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    const started = await page.waitForFunction(() => window.__state?.started === true, null, { timeout }).then(() => true, () => false);
    await page.waitForTimeout(2500);
    return { page, net, errors, story, started };
}

// ───────────────────────────────────────────────────────────────────────────
try {
    // ═══ PART A — REGRESSION PROBE: the ORDINARY boot, no flags ═══
    // Boots exactly as a player does and watches the opening for 70 s. On a good
    // tree the route leaves s780 and the first page error list is empty. On the
    // 2026-10-06 working tree it stalls at s780 with `storyFlags.getOrdinal is not
    // a function` — the uncommitted web/game.js edit that broke the route.
    {
        const { page, net, errors } = await newPage({ seedOrdinal: 0, allowMissingSprite: false });
        await page.goto(`${ROOT}/index.html`, { waitUntil: "load", timeout: 60000 });
        const lang = await page.waitForFunction(() => window.__cntyselNative?.active?.() === true, null, { timeout: 40000 }).then(() => true, () => false);
        note("ordinary: country/language screen opens", String(lang));
        if (lang) { for (let i = 0; i < 20; i++) { await hold(page, "i"); if (await page.evaluate(() => !!window.__bootLanguage)) break; } }
        const prompt = await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "prompt", null, { timeout: 60000 }).then(() => true, () => false);
        if (prompt) { await hold(page, "i"); await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "menu", null, { timeout: 20000 }).catch(() => {}); await hold(page, "ArrowUp"); await hold(page, "Enter"); }
        await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 40000 }).then(() => true, () => false);
        await page.evaluate(() => { window.__gameSpeed = 4; });
        const seen = new Set();
        const t0 = Date.now();
        while (Date.now() - t0 < 70000) {
            seen.add(await mapId(page));
            const busy = await page.evaluate(() => ({ tb: !!window.__textbox?.isOpen?.(), cut: !!window.__cutscene?.isActive?.(), choice: !!window.__choice?.isOpen?.(), pack: !!window.__state?.packSelect, name: !!window.__state?.nameEntry }));
            if (busy.pack) await hold(page, "Enter", 140);
            else if (busy.name) await page.evaluate(() => { window.__state.nameEntry.press(); window.__state.nameEntry.selectEnd(); window.__state.nameEntryDone(); });
            else if (busy.tb || busy.cut) await page.keyboard.press("Enter");
            await page.waitForTimeout(150);
            if (seen.has("s200")) break;
        }
        await page.evaluate(() => { window.__gameSpeed = 1; });
        const reached = [...seen];
        note("ordinary: maps the opening visited", reached.join(" → "));
        check("ordinary: the opening reaches the field (s200)", seen.has("s200"), `at=${await mapId(page)}`);
        check("ordinary: no page errors on the ordinary route", errors.length === 0, errors.slice(0, 3).join(" | "));
        check("ordinary: no executable asset request", net.denied.length === 0 && net.allowed.length === 0, `denied=${net.denied.length}`);
        await shot(page, "A1-ordinary-field");
        allErrors.push(...errors.map((e) => `ordinary: ${e}`));
        await page.close().catch(() => {});
    }

    // ═══ PART B — DEEP STAGE LADDER via the fixture boot ═══
    // Each later stage is booted the way the translated-screen verifiers boot one,
    // then walked once to prove the field is live.
    const reachedStages = [];
    for (const b of LADDER) {
        let ctx;
        try {
            ctx = await bootStage(b.stage, b.ordinal);
            const { page } = ctx;
            if (!ctx.started) { check(`stage ${b.stage}: boots`, false, "world did not start"); await page.close().catch(() => {}); continue; }
            const id = await mapId(page);
            if (id !== b.stage) note(`stage ${b.stage}: booted as`, String(id));
            const amb = await page.evaluate(() => window.__stageAmbience?.execution ?? null);
            const npcs = await page.evaluate(() => (window.__npcsHere?.() ?? []).map((n) => n.npc_id ?? n.id));
            if (b.arrivalHandoff) {
                // This room's own arrival gate plays a scene that HANDS THE PLAYER ON — the
                // disc's beat continues in the next room — so there is no field to walk, and a
                // movement assertion here is simply wrong. (The old check read the pinned origin
                // as a spawn gap; it is not: the disc agrees with our fixture data, see
                // docs/research/systems/deep-playthrough-2026-10-06.md 2026-10-06c.) Assert the
                // two things that ARE observable instead: the boot placed the player at the
                // stage's own descriptor default, and the room's arrival scene carried them on.
                const def = SPAWN[b.stage];
                const enter = ctx.story.find((l) => l.includes(`ENTER ${b.stage} at `));
                const spawnOk = !!enter && !!def && enter.includes(`${def.x},${def.y}`);
                check(`stage ${b.stage} (${b.name}): boots at its descriptor default (${def?.x},${def?.y})`,
                    spawnOk, enter ? "STORY: " + enter.replace(/^.*ENTER /, "ENTER ") : "no ENTER line captured");
                // Page the room's own arrival scene through until it hands the player on.
                let dest = id;
                const destDeadline = Date.now() + 30_000;
                while (Date.now() < destDeadline && dest === b.stage) {
                    const busy = await page.evaluate(() => ({ cut: !!window.__cutscene?.isActive?.(), tb: !!window.__textbox?.isOpen?.() }));
                    if (busy.cut || busy.tb) await hold(page, "Enter", 140);
                    else await page.waitForTimeout(200);
                    dest = await mapId(page);
                }
                check(`stage ${b.stage} (${b.name}): the room's own arrival scene hands the player to ${b.arrivalHandoff}`,
                    dest === b.arrivalHandoff, `booted as ${id}, landed on ${dest}`);
                check(`stage ${b.stage}: stage ambience runs translated code`, amb === "translated", `execution=${amb} on ${id}`);
                await shot(page, `B-${b.stage}`);
                reachedStages.push({ stage: b.stage, name: b.name, npcs: npcs.length, moved: "handoff" });
                allErrors.push(...ctx.errors.map((e) => `${b.stage}: ${e}`));
                await page.close().catch(() => {});
                continue;
            }
            // Some stages resolve their spawn a beat after `started`; wait for a
            // non-origin position so the move test is not read at 0,0.
            await page.waitForFunction(() => (window.__state?.x ?? 0) + (window.__state?.y ?? 0) > 0, null, { timeout: 6000 }).catch(() => {});
            const before = await page.evaluate(() => [Math.round(window.__state.x), Math.round(window.__state.y)]);
            await hold(page, "ArrowLeft", 600);
            const after = await page.evaluate(() => [Math.round(window.__state.x), Math.round(window.__state.y)]);
            const moved = before[0] !== after[0] || before[1] !== after[1];
            const bad = await page.evaluate(() => window.__badDraws?.length ?? 0);
            check(`stage ${b.stage} (${b.name}): boots and the field is live`, moved, `ambience=${amb} npcs=${npcs.length} moved=${moved} badSpriteDraws=${bad} pos=${before}→${after}`);
            check(`stage ${b.stage}: stage ambience runs translated code`, amb === "translated", `execution=${amb}`);
            await shot(page, `B-${b.stage}`);
            reachedStages.push({ stage: b.stage, name: b.name, npcs: npcs.length, moved });
            allErrors.push(...ctx.errors.map((e) => `${b.stage}: ${e}`));
            await page.close().catch(() => {});
        } catch (e) { check(`stage ${b.stage}: boots`, false, String(e)); ctx?.page?.close?.().catch(() => {}); }
    }

    // ═══ PART C — A BATTLE IN A LATER AREA ═══
    // s480 South Sector — Jungle Grave (story ordinal 8), encounters ON. Its zone
    // pool is non-empty (rate 4 on the west column), so the decoded step counter
    // rolls a real wild encounter (Musyamon, screen 91). The player is put on a
    // rate-bearing tile and walks it. (s420 Seiryu City is a CITY: its rate is 0
    // everywhere — see the report — so no fight can roll there.)
    try {
        const { page, errors } = await bootStage("s480", 8, { noEncounters: false });
        // Give the party survivable HP: the Jungle Grave pool is a Lv-31 Musyamon,
        // and the fixture party is Lv-1, so an unbuffed fight puts the battle into
        // the "Choose the next Digimon." party-swap prompt rather than a result.
        await page.evaluate(() => {
            const b = (id, hp, mp) => ({ digimonId: id, level: 50, xp: 0, tp: 0, hp, maxHp: hp, mp, maxMp: mp, bonuses: {}, elemBonuses: {} });
            window.__state.partyStats = [b(1, 9999, 999), b(7, 9999, 999), b(8, 9999, 999)];
            window.__state.partnerStats = window.__state.partyStats[0];
        });
        const rate = await page.evaluate(() => window.__encounter?.rateLevel?.("s480", 32, 160) ?? null);
        note("later battle (s480 Jungle Grave): zone rate on the walk tile", String(rate));
        await page.evaluate(() => { window.__state.x = 32; window.__state.y = 160; });
        let active = await page.evaluate(() => !!window.__battle?.isActive?.());
        for (let a = 0; a < 60 && !active; a++) {
            await hold(page, "ArrowDown", 300); await hold(page, "ArrowUp", 300);
            active = await page.evaluate(() => !!window.__battle?.isActive?.());
        }
        check("later battle (s480 Jungle Grave): an ordinary wild encounter starts", active);
        await shot(page, "C1-s480-battle-start");
        if (active) {
            await waitForCommandMenu(page, { timeout: 45000 });
            const cmd = await diag(page, `(() => { const d = window.__battleCmdNative?.diagnostics?.(); return d && { execution: d.execution, ready: d.ready, error: d.error }; })()`);
            check("later battle: the command list runs translated code", cmd?.execution === "translated" && cmd?.ready === true, JSON.stringify(cmd));
            await shot(page, "C2-s480-command-menu");
            const t0 = Date.now(); let turns = 0;
            while (Date.now() - t0 < 90000 && turns < 40) {
                const st = await page.evaluate(() => { const b = window.__battleB?.(); const p = window.__battle?.peek?.(); const m = p?.messageLine; const c = window.__battleCmdNative?.diagnostics?.(); if (!b) return { gone: true }; return { state: b.state, holds: !!m?.active && !m.finished && (!!m.holdsTurn || !!p?.waitsForLine), pages: !!b._resultPages?.length, victory: !!b._victoryPhase, cmdReady: c?.ready === true, sel: c?.selection ?? null }; });
                if (st.gone) break;
                if (st.state === 2 && st.cmdReady) { await page.evaluate(() => { const b = window.__battleB?.(); if (b?.enemy) b.enemy.hp = 1; }); await tapCircle(page); turns++; continue; }
                if (st.holds || st.pages || st.state === 7 || st.state === 11 || st.victory) await tapCircle(page);
                else await page.waitForTimeout(150);
            }
            note("later battle: commands chosen", String(turns));
            const back = await page.waitForFunction(() => !window.__battle?.isActive?.() && window.__state?.started === true, null, { timeout: 40000 }).then(() => true, () => false);
            check("later battle: reaches a result and returns to the field", back, `stillActive=${await page.evaluate(() => !!window.__battle?.isActive?.())}`);
            await shot(page, "C3-s480-after-battle");
        }
        allErrors.push(...errors.map((e) => `s480: ${e}`));
        await page.close().catch(() => {});
    } catch (e) { check("later battle (s480): completed without throwing", false, String(e)); }

    // ═══ PART D — ENTER A GYM (in-game greeter, s330 Leomon) ═══
    try {
        const { page, errors } = await bootStage("s330", 30);
        const g = await page.evaluate(() => { const n = (window.__npcsHere?.() ?? []).find((x) => (x.npc_id ?? x.id) === 27); return n ? { x: n.x, y: n.y } : null; });
        if (!g) { check("gym (s330): the Leomon greeter is on the field", false, "npc 27 not present"); }
        else {
            await page.evaluate((g) => { window.__state.x = g.x; window.__state.y = g.y + 20; window.__state.dir = "up"; }, g);
            await page.waitForTimeout(300);
            const tgt = await page.evaluate(() => { const t = window.__talkTarget?.(); return t ? t.npc : null; });
            check("gym (s330): the player faces the greeter", tgt === 27, `talkTarget=${tgt}`);
            await hold(page, "Enter");
            let opened = false;
            for (let i = 0; i < 20 && !opened; i++) {
                const o = await page.evaluate(() => ({ db: !!window.__dialogueBox?.isOpen?.(), gym: !!window.__gym?.isOpen?.() }));
                if (o.gym) { opened = true; break; }
                if (!o.db) { const g2 = await page.evaluate(() => !!window.__gym?.isOpen?.()); if (g2) { opened = true; break; } break; }
                await hold(page, "Enter");
            }
            const gd = await diag(page, `(() => { const d = window.__gym?.diagnostics?.(); return d && { execution: d.execution, open: d.open, state: d.state, error: d.error }; })()`);
            check("gym (s330): the greeter talk opens the translated gym screen", opened && gd?.execution === "translated" && !gd?.error, JSON.stringify(gd));
            await shot(page, "D1-gym-open");
            if (opened) {
                // Walk the gym's own flow: "Train which Digimon?" pedestal → drill
                // grid → "Pick TP amount" (LEFT/RIGHT moves the box, confirm) →
                // "Is this ok?" Yes/No. Confirm the highlighted row at each step,
                // stepping the TP choice with a direction first.
                const states = [];
                const snap = async (tag) => { const d = await diag(page, `(() => { const x = window.__gym?.diagnostics?.(); return x && x.state; })()`); states.push(`${tag}=${JSON.stringify(d)}`); };
                await snap("open");
                await hold(page, "Enter"); await snap("afterPod");
                await hold(page, "Enter"); await snap("afterDrill");
                await hold(page, "ArrowRight"); await hold(page, "Enter"); await snap("afterTP");
                // The flow sits at the drill picker (state 0x0b) until a drill is
                // chosen; keep confirming and record each flow value.
                for (let i = 0; i < 6; i++) { await hold(page, "Enter"); await snap(`confirm${i}`); }
                await page.waitForTimeout(1000);
                note("gym (s330): the flow, step by step", states.join("  "));
                const res = await diag(page, `(() => { const d = window.__gym?.diagnostics?.(); return d && { state: d.state, summary: d.summary, error: d.error }; })()`);
                note("gym (s330): after confirming a drill", JSON.stringify(res));
                await shot(page, "D4-gym-result");
            }
        }
        allErrors.push(...errors.map((e) => `s330: ${e}`));
        await page.close().catch(() => {});
    } catch (e) { check("gym (s330): completed without throwing", false, String(e)); }

    // ═══ PART E — THE ARENA / TOURNAMENT ═══
    // The Digimon Arena finale. One screen, two variants: screen 632 is the ordinary
    // floor s233, or the story variant s927 at master ordinal 0x2d; screen 631 is the
    // front desk s231/s926. Two facts an earlier walk misread
    // (docs/research/systems/arena-finale-gate-2026-10-06.md):
    //
    //  1. The finale is NOT started by a talk on the floor. s927 ships NO static NPCs
    //     and NO exits — Kurt (actor 104) is a cutscene-positioned record at (0,0), and
    //     the exit is the victory event's HANDOFF. That emptiness is the DISC's own
    //     data, not a missing room: on entry the floor's arrival gate (pro/wstag927.s
    //     file 0x218) fires the Kurt challenge (event 1608) while arm flag 0x100c is
    //     clear. (0x100c is written BY the finale, not a gate the player must meet.)
    //  2. The receptionist's talk (s926 npc 32) launches the handoff (event 1606) only
    //     in dialogue state 1, gated on flag 0x7054 — a VIRTUAL bank-0x70 flag true iff
    //     the four endgame tamer challenges' bits 0x100d/0x100e/0x100f/0x1010 are all
    //     set. A bare fixture cannot satisfy it; a walk must not force it.
    try {
        // E1 — the two rooms as the disc ships them.
        for (const st of ["s926", "s927"]) {
            const { page, errors } = await bootStage(st, 45);
            const info = await page.evaluate(() => ({
                map: window.__state?.manifest?.maps?.[window.__state?.mapIdx]?.id,
                npcs: (window.__npcsHere?.() ?? []).map((n) => n.npc_id ?? n.id),
                exits: (window.__state?.scenes?.[window.__state?.manifest?.maps?.[window.__state?.mapIdx]?.id]?.exits ?? []).map((e) => e.to),
            }));
            note(`arena (${st}): field contents`, JSON.stringify(info));
            if (st === "s926") {
                check("arena (s926): the front desk loads the receptionist and the exit",
                    info.npcs.includes(32) && info.exits.length > 0, JSON.stringify(info));
            } else {
                note("arena (s927): ships no static NPCs and no exits (Kurt is cutscene-positioned; the exit is the victory HANDOFF) — the disc's data, not a gap",
                    JSON.stringify(info));
                // The floor's arrival gate starts the challenge (event 1608) on entry, no talk.
                let chain = false;
                for (let i = 0; i < 12 && !chain; i++) {
                    chain = await page.evaluate(() => !!(window.__cutscene?.isActive?.() || window.__battle?.isActive?.()));
                    if (!chain) await page.waitForTimeout(400);
                }
                check("arena (s927): the arrival gate starts the finale chain on entry (no talk)", chain,
                    `cutscene=${await page.evaluate(() => !!window.__cutscene?.isActive?.())}`);
            }
            await shot(page, `E-${st}`);
            allErrors.push(...errors.map((e) => `${st}: ${e}`));
            await page.close().catch(() => {});
        }

        // E2 — the receptionist's talk, with the disc's gate satisfied, hands the player
        // off to the story variant of the floor (s927, the alias of s233). 0x7054 is
        // virtual, so it is set by its four stored bits, not written directly.
        {
            const { page, errors } = await bootStage("s926", 45);
            await page.evaluate(() => { for (const id of [0x100d, 0x100e, 0x100f, 0x1010]) window.__engine.state.flags.set(id, true); });
            const gate = await page.evaluate(() => window.__engine.state.flags.get(0x7054) === true);
            check("arena (s926): the finale gate flag 0x7054 reads true once the four endgame bits are set", gate);
            await page.evaluate(() => { const n = (window.__npcsHere?.() ?? []).find((x) => (x.npc_id ?? x.id) === 32); if (n) { window.__state.x = n.x; window.__state.y = n.y + 20; window.__state.dir = "up"; } });
            await page.waitForTimeout(400);
            await page.evaluate(() => { window.__gameSpeed = 6; });
            let landed = null;
            for (let i = 0; i < 120; i++) {
                await hold(page, "Enter", 120);
                landed = await page.evaluate(() => window.__state?.manifest?.maps?.[window.__state?.mapIdx]?.id ?? null);
                if (landed && landed !== "s926") break;
            }
            await page.evaluate(() => { window.__gameSpeed = 1; });
            check("arena (s926): the receptionist's talk hands the player into the arena floor (s927)", landed === "s927", `landed=${landed}`);
            await shot(page, "E-s927-via-desk");
            allErrors.push(...errors.map((e) => `arena-gate: ${e}`));
            await page.close().catch(() => {});
        }
    } catch (e) { check("arena: completed without throwing", false, String(e)); }

    // ═══ PART F — the fixture-boot render crash (shim ON only) ═══
    // With the harness shim DISABLED, a `?skipTitle=1&map=` boot can throw inside
    // render() on a missing sprite image; because the throw precedes the next
    // requestAnimationFrame, the whole game loop dies and the field never moves.
    // This is a robustness gap in the renderer, but it only fires on a tree whose
    // untracked sprite assets (web/assets/sprites, not in git) are absent — which
    // is what a fresh `git worktree` checkout is. On a normal working tree the
    // sprites are present and there is no crash, so this part only runs when the
    // shim is enabled (i.e. on such a worktree).
    if (ALLOW_MISSING_SPRITE) try {
        const { page, errors } = await newPage({ seedOrdinal: 30, allowMissingSprite: false });
        await page.goto(`${ROOT}/index.html?skipTitle=1&map=s330&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
        await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 40000 }).catch(() => {});
        await page.waitForTimeout(3000);
        const before = await page.evaluate(() => [Math.round(window.__state.x), Math.round(window.__state.y)]);
        await hold(page, "ArrowLeft", 800);
        const after = await page.evaluate(() => [Math.round(window.__state.x), Math.round(window.__state.y)]);
        const died = before[0] === after[0] && before[1] === after[1];
        const renderErr = errors.find((e) => /drawImage/.test(e)) ?? errors[0] ?? "none";
        note("fixture boot (shim off): field frozen and the render error", `moved=${!died} err=${renderErr}`);
        check("fixture boot (shim off): the field loop dies on a missing sprite (a real robustness gap)", died && /drawImage/.test(renderErr), `pos=${before}→${after} err=${renderErr}`);
        await shot(page, "F-shim-off-frozen");
        await page.close().catch(() => {});
    } catch (e) { check("fixture boot (shim off): ran without throwing", false, String(e)); }
} catch (e) {
    check("deep session: ran to completion", false, String(e));
} finally {
    const failures = steps.filter((s) => s.startsWith("FAIL")).length;
    writeFileSync(`${OUT}/report.txt`, steps.join("\n") + `\n\nDEEP PAGE ERRORS (unique):\n` + [...new Set(allErrors)].join("\n") + `\n\n${failures} FAILURE(S)\n`);
    console.log(`\n[deep] ${failures === 0 ? "ALL STEPS PASSED" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
    await browser.close();
    process.exit(failures === 0 ? 0 : 1);
}
