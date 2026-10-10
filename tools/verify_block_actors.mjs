// Player-visible check: the three special block actors (npc 328/351/352) and
// the interaction they carry, in ORDINARY play.
//
// The actors are ordinary cast-list records (scene descriptor +0x4C) gated on a
// route-pair flag plus their own bank-0 completion bit; the interaction is the
// dedicated branch fieldstg F0x8008E2CC plus the two mode bodies (0x4d / 0x4e
// inside F0x8008FED0).  The ledger claim
// world-q006-block-interaction-mechanism-and-timing-2026-10-05 gives the
// mechanism and the tick counts (36 to control back, 41 in total); the live
// capture `block-interaction-depiction-and-its-real-length-2026-10-05` shows
// what it looks like.  engine/systems/block-actor.ts is the port.
//
// This check boots s968 the ordinary way (?skipTitle=1&map=s968, no
// ?nativeStages), proves the block is spawned from the stage's own data and is
// addressable, presses confirm, and reads the decoded tick sequence out of the
// live machine: the block acts on tick 20 (cue + completion bit), the player's
// clip ends on tick 36 (control back, the field lock down), the block is gone
// on tick 41.  It also proves the block is no longer addressable afterwards —
// its completion bit now fails its own spawn gate.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_block_actors.mjs [outdir]
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const DATA = JSON.parse(
    await readFile("web/assets/data/block_actors.json", "utf8"));

const OUT = process.argv[2] || ".bunny-scratch/shots/block-actors";
const PORT = Number(process.env.VERIFY_PORT ?? 8961);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

const fails = [];
const check = (name, ok, detail) => {
    console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
    if (!ok) fails.push(name);
};

const tap = async (k) => {
    await page.evaluate((kk) =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: kk })), k);
    await page.waitForTimeout(50);
    await page.evaluate((kk) =>
        window.dispatchEvent(new KeyboardEvent("keyup", { key: kk })), k);
};

try {
    await page.goto(`${baseUrl(PORT)}?skipTitle=1&map=s968&noEncounters=1`);
    const style = page.locator("#asset-mode-authentic");
    if (await style.isVisible().catch(() => false)) await style.click();
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 25000 });
    await page.waitForTimeout(1000);

    // Clear anything the map-enter event put on screen (never standing near the
    // block yet, so a clear press cannot start the interaction).
    for (let i = 0; i < 40; i++) {
        const busy = await page.evaluate(() =>
            (window.__textbox?.isOpen?.() ?? false) || (window.__cutscene?.isActive?.() ?? false));
        if (!busy) break;
        await tap(" ");
        await page.waitForTimeout(150);
    }

    // 1. The actor spawns on the stage's own data: the cast list carries the
    //    rows, the scene carries the actors, the pack and its clip ship.
    const data = await page.evaluate(() => {
        const st = window.__state;
        const cast = (st.stageCastLists?.s968 ?? []).filter((r) => [328, 351, 352].includes(r.id));
        const scene = st.scenes?.s968;
        const blocks = (scene?.npcs ?? []).filter((n) => [328, 351, 352].includes(n.npc_id));
        const meta = st.manifest.npcs?.find((n) => n.id === "p188blok");
        return {
            cast: cast.map((r) => [r.id, r.slot, r.x, r.y, r.gate]),
            blocks: blocks.map((n) => [n.npc_id, n.sprite, n.x, n.y]),
            meta: meta ? { clips: Object.keys(meta.clips ?? {}) } : null,
        };
    });
    const cast328 = data.cast.find((r) => r[0] === 328);
    check("s968's own cast list carries the block rows the disc ships",
        data.cast.length === 3 && cast328 && cast328[2] === 368 && cast328[3] === 344,
        `${data.cast.length} rows; 328 at ${cast328 ? cast328.slice(2, 4) : "?"} gate ${JSON.stringify(cast328?.[4])}`);
    check("the block actors are spawned in the scene with the p188blok pack",
        data.blocks.length === 3 && data.blocks.every((b) => b[1] === "p188blok"),
        JSON.stringify(data.blocks));
    check("the pack's break-apart clip 0x54 ships",
        !!data.meta && data.meta.clips.includes("84"),
        `clips ${data.meta ? data.meta.clips.join(",") : "no pack"}`);

    // 2. Stand in front of npc 328 (368,344) and prove the press addresses it.
    await page.evaluate(() => {
        for (const bit of [8, 9, 10]) window.__storyFlags.raw.set(bit, 0);
        window.__teleport(368, 384);
        window.__state.dir = "up";
    });
    await page.waitForTimeout(400);
    const target = await page.evaluate(() => window.__talkTarget());
    check("standing in front, the press addresses the block (npc 328)",
        target?.npc === 328 && target?.sprite === "p188blok",
        JSON.stringify(target));
    await page.screenshot({ path: `${OUT}/s968-block-before.png` });

    // 3. Confirm: the interaction starts, and the field lock is up.
    await page.evaluate(() => {
        window.__packed = [];
        const orig = window.__sfx.playPacked;
        window.__sfx.playPacked = (id, ...rest) => {
            window.__packed.push(id >>> 0);
            return orig(id, ...rest);
        };
    });
    await tap(" ");
    await page.waitForTimeout(80);
    const started = await page.evaluate(() => window.__blockActors());
    check("confirm starts the interaction with npc 328 and its bit 8",
        started.live?.targetId === 328 && started.live?.bit === 8,
        JSON.stringify(started.live));
    check("the field lock is up on the first blank (the latch)",
        started.live?.busy === true && started.live?.engagerSub === 1,
        `busy ${started.live?.busy}, sub ${started.live?.engagerSub}`);

    // 4. Sample the whole scene and read the decoded tick sequence.
    const samples = [];
    for (let i = 0; i < 80; i++) {
        const s = await page.evaluate(() => window.__blockActors());
        samples.push(s);
        if (s.last?.goneTick) break;
        await page.waitForTimeout(25);
    }
    const live = samples.map((s) => s.live).filter(Boolean);
    const last = samples.map((s) => s.last).filter(Boolean).at(-1);
    const busySeen = live.some((l) => l.busy === true);
    const clipSeen = samples.some((s) => s.npcActiveClip === 84);
    check("the block acts on tick 20 (its clip latches, the cue, the bit)",
        last?.actionTick === 20, `actionTick ${last?.actionTick}`);
    check("the player's clip ends on tick 36: control back, the lock down",
        last?.engagerDoneTick === 36, `engagerDoneTick ${last?.engagerDoneTick}`);
    check("the block is gone on tick 41",
        last?.goneTick === 41, `goneTick ${last?.goneTick}`);
    check("the field lock was up during the dive and cleared with it",
        busySeen && last?.busy === false, `busySeen ${busySeen}, end busy ${last?.busy}`);
    check("the block played its own break-apart clip 0x54",
        clipSeen, `clip ${samples.map((s) => s.npcActiveClip).filter(Boolean)[0]}`);
    const packed = await page.evaluate(() => window.__packed ?? []);
    check("the block's cue (COMEX113) played as it started to move",
        packed.includes(0x800446c9),
        `heard ${packed.map((w) => "0x" + w.toString(16)).join(",")}`);
    await page.screenshot({ path: `${OUT}/s968-block-after.png` });

    // 5. The completion bit is set, so the block is done once: its gate now
    //    fails and the press no longer addresses it.
    const after = await page.evaluate(() => ({
        bit: window.__storyFlags.get(8),
        target: window.__talkTarget(),
        live: window.__blockActors().live,
    }));
    check("the completion bit is written (bank 0, bit 8)",
        after.bit === 1, `get_flag(8) = ${after.bit}`);
    check("the block is no longer addressable (its gate now fails)",
        after.target?.npc !== 328 && after.live === null,
        JSON.stringify(after.target));

    // 6. And it stays done: a second press starts nothing.
    await tap(" ");
    await page.waitForTimeout(150);
    const second = await page.evaluate(() => window.__blockActors().live);
    check("a second press starts nothing", second === null, JSON.stringify(second));

    check("s968 is not running the original overlay machine code",
        !(await page.evaluate(async () => {
            const native = await import("/native-stage.js");
            return native.nativeStage("s968") !== null;
        })));
    check("the shipped data file and the machine agree on the tick lengths",
        DATA.engagerTicks === 36 && DATA.targetTicks === 21 && DATA.waitTicks === 20,
        `engager ${DATA.engagerTicks}, target ${DATA.targetTicks}, wait ${DATA.waitTicks}`);
} finally {
    console.log("VERDICT", fails.length === 0 ? "OK" : `FAIL ${fails.join("; ")}`);
    console.log("--- console log ---");
    for (const l of logs.slice(-30)) console.log(l);
    await browser.close();
    if (fails.length) process.exitCode = 1;
}
