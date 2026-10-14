// Player-visible check: a collected item box leaves the field at once.
//
// The box family (p126itmb, npc ids 33/77-87/340-344/347) is the set the shared
// talk body's own id test names (fieldstg F0x8008FED0 case 0x4A, file
// 0xde4c-0xde84). On the tick its dialogue reads closed, that body calls the
// box's own remove slot -- `+0x28(3)`, entity+0xC = 3 (file 0xdfa4-0xdfc0) --
// in the same arm that applies the on-close flag table. engine/systems/
// box-actor.ts is the decode; web/game.js's talk onClose is the port.
//
// Before the port the box stayed on the map until the next stage entry (the
// spawn gate alone hid it), so case 1 is the fail-before/pass-after: on master
// the collected box is still in the live cast.
//
// Cases:
//   1. s300's box (npc 33 at 700,283, gate 532=0): collect it; it is gone from
//      the live cast the moment the textbox closes, and 532 reads 1; while the
//      line is up the box runs its talk-start clip 0x41 and the packed cue
//      0x80045DC7 (TRESUREB) has played (the talk body's start arm, fieldstg
//      file 0xdf58-0xdf78);
//   2. re-entering s300: still gone (the spawn gate now fails);
//   3. s315 carries three boxes (npc 33/77/78): collecting one (78 at 768,490)
//      removes only it -- the other two stay, so the removal is the actor's
//      own close arm, not a blanket re-read of every gate;
//   4. the same map's ordinary NPC (306, the self-gate A.O.A. employee whose
//      on_close writes its OWN spawn bit 3092=1): talking to it must NOT
//      remove it -- the live Veemon-s395 constraint. Its actor goes only when
//      the stage is next entered, as the disc's entry gate does.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_box_collect.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || ".bunny-scratch/shots/box-collect";
const BASE = `${process.env.BOX_ROOT || baseUrl(8757)}/`;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
// The packed-sound lookup (web/audio.js player.playPacked) records every sample
// name it resolves; arming the trace before any page script runs makes the
// box's talk-start cue (TRESUREB) a deterministic assertion — it fires before
// any audio playback, so no gesture or audio context is needed.
await page.addInitScript(() => { globalThis.__sfxTrace = new Set(); });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

const fails = [];
const check = (name, ok, detail) => {
    console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
    if (!ok) fails.push(name);
};
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

const mapId = () => page.evaluate(() => window.__state.manifest.maps[window.__state.mapIdx].id);
const npcs = () => page.evaluate(() => window.__npcsHere() || []);
const boxes = async () => (await npcs()).filter((n) => n.sprite === "p126itmb");
const flag = (id) => page.evaluate((i) => window.__storyFlags.get(i), id);
const tbOpen = () => page.evaluate(() => window.__textbox?.isOpen?.() ?? false);
const sfxTrace = () => page.evaluate(() => [...(globalThis.__sfxTrace ?? [])]);
// The "V" overlay's own per-frame rows (window.__lastAnimDebug): which render
// branch each entity took — mode "clip" + clipId 65 is the box's talk clip.
const animRows = () => page.evaluate(() => window.__animReport());
const animRowFor = (label) => animRows().then((rows) => (rows ?? []).find((r) => r.label === label));

async function openMap(id) {
    await page.goto(`${BASE}?skipTitle=1&map=${id}&noEncounters=1`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 25000 });
    await page.waitForTimeout(900);
    // Clear anything the map-enter event put on screen (the player is at the
    // spawn, away from the subjects, so a clear press cannot start a talk).
    for (let i = 0; i < 30; i++) {
        if (!(await tbOpen())) break;
        await page.keyboard.press("Enter");
        await page.waitForTimeout(150);
    }
}

/** Stand one tile under (x,y) facing up, confirm, and close the talk.
 *  `probe` (optional) runs while the line is still open — the window in which
 *  the box's talk-start clip and cue are live — and its result is returned. */
async function collect(x, y, probe) {
    await page.evaluate(([px, py]) => {
        window.__tp(px, py + 24);
        window.__state.dir = "up";
    }, [x, y]);
    await page.waitForTimeout(250);
    const target = await page.evaluate(() => window.__talkTarget());
    await page.keyboard.press("Enter");
    let opened = false;
    for (let i = 0; i < 20; i++) {
        if (await tbOpen()) { opened = true; break; }
        await page.waitForTimeout(100);
    }
    const line = await page.evaluate(() => {
        if (!window.__textbox?.isOpen?.()) return null;
        const d = window.__textbox.dialogue;
        try { return JSON.stringify(d).slice(0, 120); } catch { return String(d); }
    });
    // A beat for the render loop to paint a frame with the talk's clip latched
    // (the anim rows come from the last rendered frame).
    if (probe) await page.waitForTimeout(200);
    const probed = probe ? await probe() : undefined;
    for (let i = 0; i < 12 && (await tbOpen()); i++) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(150);
    }
    await page.waitForTimeout(300);
    return { target, opened, line, probed };
}

try {
    // ── 1. s300: collect the box; it must leave the field at once ────────────
    await openMap("s300");
    const s300Before = await boxes();
    check("s300 spawns its box (npc 33 at 700,283)", s300Before.length === 1 && s300Before[0].npc_id === 33,
        JSON.stringify(s300Before));
    await shot("s300-box-before");

    const traceBefore = new Set(await sfxTrace());
    const r1 = await collect(700, 283, async () => ({
        box: await animRowFor("p126itmb#33"),
    }));
    check("the press addresses the box", r1.target?.npc === 33 && r1.target?.sprite === "p126itmb",
        JSON.stringify(r1.target));
    check("the box's line opens", r1.opened, r1.line === null ? "no textbox" : JSON.stringify(r1.line.slice(0, 60)));
    check("the box's talk latches clip 0x41 while the line is up",
        r1.probed?.box?.mode === "clip" && Number(r1.probed?.box?.clipId) === 65,
        JSON.stringify(r1.probed?.box));
    const traceAfter = await sfxTrace();
    check("the talk-start cue TRESUREB (0x80045DC7) played",
        traceAfter.includes("tresureb") && !traceBefore.has("tresureb"),
        JSON.stringify(traceAfter.filter((t) => /tresure/i.test(t))));
    const s300After = await boxes();
    await shot("s300-box-after");
    check("the collected box is GONE from the live cast", s300After.length === 0, JSON.stringify(s300After));
    check("its spawn flag 532 was written", (await flag(532)) === 1, `532=${await flag(532)}`);

    // ── 2. re-entry: still gone ──────────────────────────────────────────────
    await page.evaluate(() => window.__setMap(window.__state.mapIdx));
    await page.waitForTimeout(1200);
    check("re-entering s300: the box stays gone", (await boxes()).length === 0,
        JSON.stringify(await boxes()));

    // ── 3. s315: three boxes; collecting one removes only it ─────────────────
    await openMap("s315");
    const s315Before = await boxes();
    check("s315 spawns its three boxes (npc 33/77/78)",
        s315Before.length === 3 && [33, 77, 78].every((id) => s315Before.some((b) => b.npc_id === id)),
        JSON.stringify(s315Before.map((b) => b.npc_id)));
    await shot("s315-boxes-before");

    const r3 = await collect(768, 490, async () => ({
        box: await animRowFor("p126itmb#78"),
    }));
    check("the press addresses box npc 78", r3.target?.npc === 78, JSON.stringify(r3.target));
    check("the box's line opens (s315)", r3.opened, r3.line === null ? "no textbox" : JSON.stringify(r3.line.slice(0, 60)));
    check("box npc 78's talk latches clip 0x41 too",
        r3.probed?.box?.mode === "clip" && Number(r3.probed?.box?.clipId) === 65,
        JSON.stringify(r3.probed?.box));
    const s315After = await boxes();
    await shot("s315-box-after");
    check("collected npc 78 is gone", !s315After.some((b) => b.npc_id === 78),
        JSON.stringify(s315After.map((b) => b.npc_id)));
    check("the other two boxes are untouched",
        s315After.some((b) => b.npc_id === 33) && s315After.some((b) => b.npc_id === 77),
        JSON.stringify(s315After.map((b) => b.npc_id)));
    check("npc 78's spawn flag 531 was written", (await flag(531)) === 1, `531=${await flag(531)}`);

    await page.evaluate(() => window.__setMap(window.__state.mapIdx));
    await page.waitForTimeout(1200);
    const s315Reentry = await boxes();
    check("re-entering s315: 78 still gone, 33/77 still there",
        !s315Reentry.some((b) => b.npc_id === 78) &&
        s315Reentry.some((b) => b.npc_id === 33) && s315Reentry.some((b) => b.npc_id === 77),
        JSON.stringify(s315Reentry.map((b) => b.npc_id)));

    // ── 4. the live Veemon constraint: an ordinary NPC keeps its actor ───────
    // npc 306's own on_close writes its spawn bit 3092=1, exactly the shape of
    // Veemon's s395 state (6693=0). Its gate also wants story ordinal 0x16.
    await page.evaluate(() => { window.__state.progressOrdinal = 0x16; });
    await page.evaluate(() => window.__setMap(window.__state.mapIdx));
    await page.waitForTimeout(1200);
    const withNpc = await npcs();
    check("the ordinary NPC 306 joins the cast once its gate passes",
        withNpc.some((n) => n.npc_id === 306), JSON.stringify(withNpc.map((n) => n.npc_id)));

    const r4 = await collect(236, 720);
    check("the press addresses the ordinary NPC 306", r4.target?.npc === 306, JSON.stringify(r4.target));
    check("npc 306's line opens", r4.opened, r4.line === null ? "no textbox" : JSON.stringify(r4.line.slice(0, 60)));
    check("its on_close wrote its own spawn bit 3092=1", (await flag(3092)) === 1, `3092=${await flag(3092)}`);
    const afterTalk = await npcs();
    check("the ordinary NPC KEEPS its actor through the talk (no blanket removal)",
        afterTalk.some((n) => n.npc_id === 306), JSON.stringify(afterTalk.map((n) => n.npc_id)));

    await page.evaluate(() => window.__setMap(window.__state.mapIdx));
    await page.waitForTimeout(1200);
    const reentry4 = await npcs();
    check("only the next ENTRY drops it (its gate now fails)",
        !reentry4.some((n) => n.npc_id === 306), JSON.stringify(reentry4.map((n) => n.npc_id)));

    if (errors.length) check("no page errors", false, `${errors.length} page error(s)`);
    console.log("RESULT", JSON.stringify({ ok: fails.length === 0, fails }));
} catch (e) {
    check("script completed", false, e.message);
} finally {
    await browser.close();
}
process.exit(fails.length ? 1 : 0);
