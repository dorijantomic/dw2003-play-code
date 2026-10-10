// Player-visible check: the Bug Maze Pit's FIVE pads and the row above them, in
// ORDINARY play.
//
// The one registry member that builds CHILD objects: s545 id 848 (0x350). Its
// own state 0 claims one row of the field's own display chain and builds five
// child objects through the shared child allocator; each child claims one more
// row by the tag the parent stamped into it, and the parent's six-arm clip
// machine pokes one child at a time.
//
//   s545 id 848 (0x350)  tags 2 (its own row, map 701,371) and 3..7 (the pads)
//
// Drawn by the translated system (engine/systems/point-record-actor.ts, the
// `parent` machine) instead of the original overlay machine code. Decode:
// docs/research/field/stage-object-registry-2026-10-04.md section 18.
//
// Boots the room with NO research flags - no ?nativeStages, so the original
// overlay machine code is NOT running - and replays the stage script's OWN nine
// `SETANIM 848` lines from event 710, in order, with the blanks the field ticks
// between them, then reports which rows went live and which pictures they hold.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_child_pool_parents.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || ".bunny-scratch/child-pool-parents";
const STAGE = "s545";
const ID = 848;
// Event 710's own nine lines: [sub, blanks the stage script waits after it].
// Every line costs at least one blank, because the field ticks each object once
// per frame and the claim arm wipes the child's selector on its own first frame.
const SCENE = [
    [860, 1], [864, 90], [865, 72], [866, 36], [867, 24], [868, 48],
    [861, 96], [862, 150], [863, 42],
];
// The six rows this member owns: its own row first, then one per child.
const TAGS = [2, 3, 4, 5, 6, 7];
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const logs = [];
  page.on("console", (c) => logs.push(`${c.type()}: ${c.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  try {
    await page.goto(`${baseUrl(8963)}/?skipTitle=1&map=${STAGE}`);
    const style = page.locator("#asset-mode-authentic");
    if (await style.isVisible().catch(() => false)) await style.click();
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
    // The arrival card is PAINTED on the canvas, so there is no element to wait
    // on: give the card its own run before sampling, or BEFORE measures the
    // card leaving instead of the pads being dark.
    await page.waitForTimeout(Number(process.env.CARD_WAIT || 6000));

    // The six rows the member owns, by the stage's own chain.
    const recs = await page.evaluate(async ([stage, tags]) => {
        const ps = await (await fetch("/assets/data/point_sprites.json")).json();
        const rs = ps[stage].records;
        return tags.map((tag) => {
            const i = rs.findIndex((r) => r.atlasFlag === tag);
            return { tag, index: i, x: rs[i]?.x, y: rs[i]?.y,
                     romActive: rs[i]?.active, romSprite: rs[i]?.spriteId };
        });
    }, [STAGE, TAGS]);
    for (const r of recs) {
      if (!(r.index >= 0)) throw new Error(`${STAGE} ships no row tagged ${r.tag}`);
    }

    // Park the camera on the MIDDLE of the six rows, not on the first one: the
    // pads are spread over 250 map pixels, so a camera on the parent's own row
    // leaves four of them off-canvas and the captures show one dot.
    const mid = recs.reduce((a, r) => [a[0] + r.x, a[1] + r.y], [0, 0])
        .map((v) => Math.round(v / recs.length));
    await page.evaluate(([x, y]) => {
        window.__state.x = x;
        window.__state.y = y;
    }, mid);
    // Wait for the camera to REACH them: it eases, so sampling it once reads the
    // spawn and the pads are then off-canvas.
    const cam = await page
        .waitForFunction(
            () => {
                const c = window.__lastCam;
                if (!c) return null;
                const cv = document.querySelector("canvas");
                const st = window.__state;
                const z = c.zoom || 1;
                const done = Math.abs(c.x + (cv.width / z) / 2 - st.x) < 16
                    && Math.abs(c.y + (cv.height / z) / 2 - st.y) < 16;
                return done ? { x: c.x, y: c.y, zoom: z, w: cv.width, h: cv.height } : null;
            },
            null,
            { timeout: 25000, polling: 250 },
        )
        .then((h) => h.jsonValue());
    console.log("CAMERA", JSON.stringify(cam));

    /** One sample: what the parent and its five children hold, and a box sum. */
    const read = async () =>
        page.evaluate(async ([stage, boxes]) => {
            const ns = await import("/native-stage.js");
            const parent = (window.__pointRecordActors.state(stage) ?? [])
                .find((a) => a.id === 848);
            const cam = window.__lastCam;
            const c = document.querySelector("canvas");
            const g = c.getContext("2d");
            const z = cam?.zoom || 1;
            const sums = boxes.map((b) => {
                const sx = Math.round((b.x - cam.x) * z);
                const sy = Math.round((b.y - cam.y) * z);
                const w = Math.round(96 * z);
                const h = Math.round(96 * z);
                if (sx < 0 || sy < 0 || sx + w > c.width || sy + h > c.height) return null;
                const d = g.getImageData(sx, sy, w, h).data;
                let sum = 0;
                for (let i = 0; i < d.length; i += 4) {
                    sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
                }
                return sum;
            });
            return {
                parent: parent
                    ? {
                        machine: parent.machine, state: parent.state, clip: parent.clip,
                        selector: parent.selector,
                        children: parent.children.map((c) => ({
                            atlas: c.atlas, state: c.state, rec: c.rec,
                        })),
                    }
                    : null,
                records: window.__pointRecordActors.records(stage),
                boxes: sums,
                native: ns.nativeStage(stage) !== null,
            };
        }, [STAGE, recs.map((r) => ({ x: r.x, y: r.y }))]);

// BEFORE: nothing has been built, which is what the shipped game showed --
    // all six of these rows are inactive in the extracted chain. Let the camera
    // finish easing first, and take AFTER at the SAME camera, or the two
    // captures differ by the camera and CHANGED_FROM_BEFORE proves nothing.
    const settle = async () => {
      await page.evaluate(([x, y]) => {
        window.__state.x = x;
        window.__state.y = y;
      }, mid);
      return page.waitForFunction(
        () => {
            const c = window.__lastCam;
            if (!c) return null;
            const cv = document.querySelector("canvas");
            const st = window.__state;
            const z = c.zoom || 1;
            const done = Math.abs(c.x + (cv.width / z) / 2 - st.x) < 8
                && Math.abs(c.y + (cv.height / z) / 2 - st.y) < 8;
            return done ? { x: c.x, y: c.y } : null;
        },
        null,
        { timeout: 25000, polling: 250 },
      ).then((h) => h.jsonValue());
    };
    await page.waitForTimeout(1500);
    let before = await read();
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(300);
      const again = await read();
      if (again.boxes.every((v, k) => v === null || v === before.boxes[k])) {
        before = again;
        break;
      }
      before = again;
    }
    await page.screenshot({ path: `${OUT}/before.png` });

    // Replay event 710's own nine lines, the way the stage script does.
    const fired = [];
    for (const [sub, blanks] of SCENE) {
      fired.push(await page.evaluate(async ([stage, id, s]) => {
        const so = await import("/stage-objects.js");
        return so.fireStageObject(stage, id, s);
      }, [STAGE, ID, sub]));
      const per = Number(process.env.PAL_MS || 34);
      for (let i = 0; i < blanks; i++) await page.waitForTimeout(per);
      await page.screenshot({ path: `${OUT}/sub${sub}.png` });
    }
    await page.waitForTimeout(600);
    // Back to the same camera, so AFTER is the same view as BEFORE.
    const camAfter = await settle();

    const samples = [];
    for (let i = 0; i < Number(process.env.FRAMES || 12); i++) {
      samples.push(await read());
      await page.waitForTimeout(70);
    }
    await page.screenshot({ path: `${OUT}/after.png` });

    // What each of the six rows ends up holding.
    const held = (s, tag) => {
      const r = s.records?.[recs.find((x) => x.tag === tag).index] ?? null;
      return r ? { active: r.active, sprite: r.sprite } : null;
    };
    const rows = TAGS.map((tag) => {
      const seen = [...new Set(samples.map((s) => JSON.stringify(held(s, tag))))];
      const last = held(samples[samples.length - 1], tag);
      return {
        tag, index: recs.find((x) => x.tag === tag).index,
        romActive: recs.find((x) => x.tag === tag).romActive,
        distinctStates: seen.length,
        last,
      };
    });
    const parents = samples.map((s) => s.parent).filter(Boolean);
    const kids = parents.map((p) => p.children.map((c) => c.state).join(","));
    const childTags = parents[0]?.children.map((c) => c.atlas) ?? [];
    const anyNative = samples.some((s) => s.native);
    const allRomDark = recs.every((r) => r.romActive === 0);
    const builtOnce = parents.length === samples.length;
    const machineOk = parents.every((p) => p.machine === "parent");
    const fiveKids = childTags.join(",") === "3,4,5,6,7";
    const kidsRunning = kids.length > 0
        && kids.every((k) => k === "2,2,2,2,2" || k === "0,0,0,0,0");
    const ownRowRuns = rows[0].last?.active === 1
        && [9, 10].includes(rows[0].last?.sprite);
    const padsLit = rows.slice(1).every((r) => r.last?.active === 1);
    const padsInRun = rows.slice(1).every((r) => r.last?.sprite >= 11 && r.last.sprite <= 23);
    const boxes = samples.map((s) => s.boxes).filter((b) => b.some((v) => typeof v === "number"));
    const sameCamera = camAfter && Math.abs(camAfter.x - cam.x) < 8
        && Math.abs(camAfter.y - cam.y) < 8;
    const changedFromBefore = sameCamera && before.boxes.some(
        (v, k) => typeof v === "number" && boxes.some((b) => typeof b[k] === "number" && b[k] !== v),
    );
    const ok = fired.every((f) => f === true) && !anyNative && allRomDark
        && builtOnce && machineOk && fiveKids && kidsRunning
        && ownRowRuns && padsLit && padsInRun && changedFromBefore;

    console.log(`--- ${STAGE} id ${ID} (0x350), event 710's nine SETANIM lines ---`);
    console.log("FIRED", JSON.stringify(fired), "NATIVE", anyNative,
        "ALL_SIX_DORMANT_IN_ROM", allRomDark);
    console.log("PARENT", JSON.stringify(parents[0] ?? null));
    console.log("CHILD_STATES", JSON.stringify([...new Set(kids)]));
    for (const r of rows) console.log(JSON.stringify(r));
    console.log("BOX_BEFORE", JSON.stringify(before.boxes),
        "DISTINCT_BOXES", new Set(boxes.map((b) => JSON.stringify(b))).size);
    console.log("CAMERA_BEFORE", JSON.stringify(cam), "CAMERA_AFTER", JSON.stringify(camAfter));
    console.log("CHANGED_FROM_BEFORE", changedFromBefore);
    console.log("VERDICT", ok ? "OK" : "FAIL");
    results.push({
        member: `${STAGE} id ${ID} (0x350)`, rows, fired, nativeRuntime: anyNative,
        childStates: [...new Set(kids)], changedFromBefore, verdict: ok ? "OK" : "FAIL",
    });
    for (const l of logs) {
      if (/error|pageerror/i.test(l)) console.log(`  [${STAGE}] ${l}`);
    }
  } finally {
    await page.close();
  }
} finally {
  await browser.close();
}

console.log("=== SUMMARY ===");
for (const r of results) console.log(JSON.stringify(r));
const allOk = results.length === 1 && results[0].verdict === "OK";
console.log("ALL_MEMBERS_OK", allOk);
process.exit(allOk ? 0 : 1);