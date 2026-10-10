// Player-visible check: the two rooms whose stage object builds a POOL of
// twelve child objects, in ORDINARY play.
//
//   s460 id 830 (0x33e)  nine children from three makers, command `SETANIM 830 844`
//   s526 id 829 (0x33d)  twelve children from four makers, command `SETANIM 829 843`
//
// Each parent is one object whose state 0 builds its children through the shared
// child allocator and whose state 2 pokes every one of them.  Every child is a
// FOUR-STATE row actor: it claims a row of the field's own 18-byte display chain
// by the tag its maker stamped into it, runs one script while the parent's poke
// counts down, and then either runs a second script (the single and twin rows) or
// re-claims (the walkers).
//
// Drawn by the translated system (engine/systems/point-record-actor.ts, the
// `triple` machine) instead of the original overlay machine code.  Decode:
// docs/research/field/stage-object-registry-2026-10-04.md section 20.
//
// Boots each room with NO research flags - no ?nativeStages, so the original
// overlay machine code is NOT running - replays the stage's own ONE command from
// the census, and reports which rows went live, which pictures they hold, and
// that the children's own words are moving.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_triple_parents.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || ".bunny-scratch/triple-parents";
const CASES = [
    { stage: "s460", id: 830, sub: 844, hold: 20, children: 9,
      tags: [1, 2, 3, 5, 6, 7, 8, 9, 10] },
    { stage: "s526", id: 829, sub: 843, hold: 150, children: 12,
      tags: [1, 2, 3, 4, 5, 6, 7, 8, 9,
        10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] },
];
// Both sides of the stage-load gate, in ONE boot each.  `below` is the ordinary
// order -- the room loads while the story step is under the stage's own bound,
// so the stage builds the parent and the nine/twelve children come up.  `at` is
// the same room with the story step AT the bound, which is where a player is
// after that room's own scene has run: the stage builds nothing, the command
// constructs a parent whose pool is never filled, and NOT ONE row changes.
//
// The bound is read out of the shipped table, never typed here.
const { readFileSync } = await import("node:fs");
const TABLE = JSON.parse(readFileSync(
    new URL("../web/assets/data/child_pool_parents.json", import.meta.url), "utf8"));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];

try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const logs = [];
    page.on("console", (c) => logs.push(`${c.type()}: ${c.text()}`));
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

    for (const c of CASES) {
      const table = TABLE.stages[c.stage][`0x${c.id.toString(16)}`];
      const bound = table.stageLoadGate.below;
      for (const side of [
          { name: "below", ordinal: bound - 1, built: true },
          { name: "at", ordinal: bound, built: false },
      ]) {
        const tag = `${c.stage}-${side.name}`;
        try {
            // Pin the master story ordinal from the FIRST frame, so the stage
            // load sees it.  The stage-object table arrives by fetch, well after
            // this starts, so the pin is always in place before the build.
            await page.addInitScript((ord) => {
                const pin = () => {
                    if (window.__state) window.__state.progressOrdinal = ord;
                    requestAnimationFrame(pin);
                };
                requestAnimationFrame(pin);
            }, side.ordinal);
            await page.goto(`${baseUrl(8963)}/?skipTitle=1&map=${c.stage}`);
            const style = page.locator("#asset-mode-authentic");
            if (await style.isVisible().catch(() => false)) await style.click();
            await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
            await page.waitForTimeout(Number(process.env.CARD_WAIT || 6000));

            // The rows the member claims, by the stage's own chain.
            const rows = await page.evaluate(async ([stage, tags]) => {
                const ps = await (await fetch("/assets/data/point_sprites.json")).json();
                const rs = ps[stage].records;
                return tags.map((tag) => {
                    const i = rs.findIndex((r) => r.atlasFlag === tag);
                    return { tag, index: i, x: rs[i]?.x, y: rs[i]?.y,
                        romActive: rs[i]?.active, romSprite: rs[i]?.spriteId };
                });
            }, [c.stage, c.tags]);
            const missing = rows.filter((r) => r.index < 0).map((r) => r.tag);
            if (missing.length) throw new Error(`${c.stage} ships no row tagged ${missing.join(", ")}`);

            // Park the camera on the MIDDLE of the rows, then WAIT for it to get
            // there: it eases, and a camera on the first row leaves the rest
            // off-canvas.
            const mid = rows.reduce((a, r) => [a[0] + r.x, a[1] + r.y], [0, 0])
                .map((v) => Math.round(v / rows.length));
            await page.evaluate(([x, y]) => {
                window.__state.x = x;
                window.__state.y = y;
            }, mid);
            // Best effort only: the rows are spread across a whole room and the
            // camera is clamped to the room's own bounds, so the midpoint is not
            // always reachable.  The probe below reads the rows, not the pixels.
            await page.waitForFunction(() => {
                const cam = window.__lastCam;
                if (!cam) return null;
                const cv = document.querySelector("canvas");
                const st = window.__state;
                const z = cam.zoom || 1;
                return Math.abs(cam.x + (cv.width / z) / 2 - st.x) < 16
                    && Math.abs(cam.y + (cv.height / z) / 2 - st.y) < 16;
            }, null, { timeout: 6000, polling: 250 }).catch(() => null);

            const before = await page.evaluate(async ([stage]) => {
                const ns = await import("/native-stage.js");
                return (window.__pointRecordActors.records(stage) ?? [])
                    .map((r) => ({ i: r.index, tag: r.atlasFlag, active: r.active,
                        sprite: r.sprite, ctr: r.ctr, x: r.x, y: r.y }));
            }, [c.stage]);
            await page.screenshot({ path: `${OUT}/${tag}-before.png` });

            // The stage's own ONE command, from data/stage_registry_members.json.
            await page.evaluate(async ([stage, id, sub]) => {
                const st = window.__stageObjects ?? null;
                const fire = window.__fireStageEffect
                    ?? (await import("/effects.js")).firePointRecordStageObject;
                window.__verifyFired = fire(stage, id, sub);
            }, [c.stage, c.id, c.sub]);
            // One blank for the parent's own state 2 to poke the pool, then the
            // child's own countdown -- the single row's is 20 blanks.
            await page.waitForTimeout(Number(process.env.BLANKS || 16) * (c.hold + 6));

            const probe = await page.evaluate(async ([stage, id]) => {
                const live = (window.__pointRecordActors.state(stage) ?? [])
                    .find((a) => a.id === id);
                const rows = (window.__pointRecordActors.records(stage) ?? [])
                    .map((r) => ({ i: r.index, tag: r.atlasFlag, active: r.active,
                        sprite: r.sprite, ctr: r.ctr, x: r.x, y: r.y }));
                return {
                    fired: window.__verifyFired,
                    parent: live ? {
                        state: live.state, machine: live.machine, built: live.built,
                        pool: (live.triple?.children ?? []).map((k) => ({
                            tags: k.tags, rec: k.rec, state: k.state, arm: k.arm,
                            speed: k.words?.[116], period: k.words?.[114],
                            fx: k.words?.[100], fy: k.words?.[104],
                        })),
                    } : null,
                    rows,
                };
            }, [c.stage, c.id]);
            await page.screenshot({ path: `${OUT}/${tag}-after.png` });

            // Did the claimed rows change, and did the children's own words?
            const claimed = new Set(rows.map((r) => r.index));
            const probeRows = probe.rows ?? [];
            const changed = probeRows.filter((r) => {
                const b = before[r.i];
                return b && (b.active !== r.active || b.sprite !== r.sprite
                    || b.ctr !== r.ctr || b.x !== r.x || b.y !== r.y);
            });
            const lit = changed.filter((r) => r.active === 1);
            // What THIS member did.  A room can have other stage objects running
            // their own scripts at the same time, so the above-gate arm is about
            // the rows the member's own children claim -- not about every row in
            // the room, some of which belong to a neighbour that is not gated.
            const own = changed.filter((r) => claimed.has(r.i));
            const ownLit = own.filter((r) => r.active === 1);
            const pool = probe.parent?.pool ?? [];
            const failures = [];
            if (probe.fired !== true) failures.push("the command was not routed to this table");
            if (!probe.parent) failures.push("no live member");
            if (side.built) {
                // below the gate: the stage built the parent, its own first tick
                // ran state 0, and the pool is whole
                if (probe.parent.built !== true) failures.push("the pool was never built");
                if (pool.length !== c.children) {
                    failures.push(`the pool holds ${pool.length} children, not ${c.children}`);
                }
                if (!changed.length) failures.push("no claimed row changed");
                if (!lit.length) failures.push("no claimed row went live");
                if (!pool.some((k) => k.rec.some((x) => x !== null))) {
                    failures.push("no child claimed a row");
                }
            } else {
                // at or above the gate: the command built an UNBUILT parent, the
                // draw handler put it straight into state 2, its pool is empty
                // and the room shows nothing at all
                if (probe.parent.built === true) failures.push("the pool was built, which the disc never does here");
                if (pool.length !== 0) failures.push(`the unbuilt parent holds ${pool.length} children`);
                if (own.length) failures.push(`${own.length} of this member's own rows changed, but none should`);
                if (ownLit.length) failures.push(`${ownLit.length} of this member's own rows went live, but none should`);
            }
            const walkers = pool.filter((k) => k.speed !== undefined);
            const movedWalkers = walkers.filter((k) => k.fx !== 0 || k.fy !== 0);
            console.log(`ROW ${tag} claimed=${claimed.size} changed=${changed.length} `
                + `own=${own.length} other=${changed.length - own.length} `
                + `lit=${lit.length} walkers=${walkers.length} moved=${movedWalkers.length}`);
            console.log(`SPRITES ${JSON.stringify(lit.map((r) => [r.tag, r.active, r.sprite, r.ctr]).slice(0, 12))}`);
            results.push({ stage: c.stage, side: side.name, ordinal: side.ordinal,
                id: c.id, sub: c.sub, failures, pool: pool.length,
                claimed: claimed.size, changed: changed.length,
                ownChanged: own.length, otherChanged: changed.length - own.length,
                lit: lit.length, movedWalkers: movedWalkers.length });
        } catch (err) {
            console.log(`ERROR ${tag}: ${err.message}`);
            results.push({ stage: c.stage, side: side.name, id: c.id, sub: c.sub,
                failures: [err.message] });
        }
      }
    }
    if (logs.length) console.log("CONSOLE", logs.slice(0, 12).join(" | "));
} finally {
    await browser.close();
}

const bad = results.filter((r) => r.failures.length);
console.log(bad.length ? `VERDICT FAIL ${JSON.stringify(bad)}`
    : `VERDICT OK ${JSON.stringify(results)}`);
process.exit(bad.length ? 1 : 0);
