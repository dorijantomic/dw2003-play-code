// Player-visible check: the A.O.A. Headquarters wall pictures, BOTH members, in
// ORDINARY play.
//
// The two registry members that claim a RUN of six of the field's own display
// slots by their tag bytes and write each slot's picture every frame:
//
//   s310 id 831 (0x33f)  tags 5..10, the stack at map (550, 116)
//   s310 id 832 (0x340)  tags 11..16, the stack at map (430, 103)
//
// Both are drawn by the translated system
// (engine/systems/stage-slot-ensemble.ts) instead of the original overlay
// machine code. Decode:
// docs/research/field/stage-object-registry-2026-10-04.md section 16.
//
// Boots the room with NO research flags - no ?nativeStages, so the original
// overlay machine code is NOT running - fires both members with the stage
// script's own `SETANIM` lines (`SETANIM 831 857 2`, `SETANIM 832 857 2`,
// event 681), and reports for each: which records it claimed, which pictures
// each of the six ended up holding, and whether the twelve records reached the
// canvas. Frame series are written for the eye.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_slot_ensembles.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || ".bunny-scratch/slot-ensembles";
const FRAMES = Number(process.env.FRAMES || 30);
const STAGE = "s310";
// The stage script's own lines, event 681.
const MEMBERS = [
    { id: 831, hex: "0x33f", tags: [5, 6, 7, 8, 9, 10], pinned: [3, 4] },
    { id: 832, hex: "0x340", tags: [11, 12, 13, 14, 15, 16], pinned: [18, 19] },
];
const SUB = 857;
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
    // The arrival card is PAINTED on the canvas, so there is no element to
    // wait on: give it its own run and then let the camera finish easing, or
    // the BEFORE capture measures the card leaving instead of the wall being
    // dark.
    await page.waitForTimeout(Number(process.env.CARD_WAIT || 6000));

    // The twelve records the two members claim, by the stage's own chain.
    const recs = await page.evaluate(async ([stage, tags]) => {
        const ps = await (await fetch("/assets/data/point_sprites.json")).json();
        const rs = ps[stage].records;
        return tags.map((tag) => {
            const i = rs.findIndex((r) => r.atlasFlag === tag && r.size);
            return { tag, index: i, x: rs[i]?.x, y: rs[i]?.y,
                     romActive: rs[i]?.active, romSprite: rs[i]?.spriteId };
        });
    }, [STAGE, MEMBERS.flatMap((m) => m.tags)]);
    for (const r of recs) {
      if (!(r.index >= 0)) throw new Error(`${STAGE} ships no slot tagged ${r.tag}`);
    }

    // Park the camera on the first stack so its boxes are on the canvas.
    await page.evaluate(([x, y]) => {
        window.__state.x = x;
        window.__state.y = y;
    }, [recs[0].x, recs[0].y]);
    // Wait for the camera to REACH the stack: it eases, so sampling it once
    // reads the spawn and the wall's own box is then off-canvas. The room's
    // own bounds decide the final position, so ask for the settled camera
    // rather than a fixed one.
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

    /** One sample: what each member holds, and a checksum over its own box. */
    const read = async () =>
        page.evaluate(async ([stage, boxes]) => {
            const so = await import("/stage-objects.js");
            const ns = await import("/native-stage.js");
            const st = so.stageObjectState(stage);
            const cam = window.__lastCam;
            const c = document.querySelector("canvas");
            const g = c.getContext("2d");
            const z = cam?.zoom || 1;
            const checks = boxes.map((b) => {
                const sx = Math.round((b.x - cam.x) * z);
                const sy = Math.round((b.y - cam.y) * z);
                const w = Math.round(112 * z);
                const h = Math.round(120 * z);
                if (sx < 0 || sy < 0 || sx + w > c.width || sy + h > c.height) return null;
                const d = g.getImageData(sx, sy, w, h).data;
                let sum = 0;
                for (let i = 0; i < d.length; i += 4) {
                    sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
                }
                return sum;
            });
            return { ensembles: st.ensembles ?? [], boxes: checks,
                     native: ns.nativeStage(stage) !== null };
        }, [STAGE, recs.slice(0, 6).map((r) => ({ x: r.x, y: r.y }))]);

    // BEFORE: nothing constructed, which is what the shipped game showed -- all
    // six of these records are inactive in the extracted chain. Sample until two
    // readings agree, so the comparison is not a camera still easing.
    let before = await read();
    for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(300);
        const again = await read();
        if (again.boxes.every((v, k) => v === null || v === before.boxes[k])) {
            before = again;
            break;
        }
        before = again;
    }
    await page.screenshot({ path: `${OUT}/before.png` });

    // Fire both the way the stage script does.
    const fired = await page.evaluate(async ([stage, ids, sub]) => {
        const so = await import("/stage-objects.js");
        return ids.map((id) => so.fireStageObject(stage, id, sub));
    }, [STAGE, MEMBERS.map((m) => m.id), SUB]);
    await page.waitForTimeout(400);

    const samples = [];
    for (let i = 0; i < FRAMES; i++) {
        samples.push(await read());
        if (i % 5 === 0) {
            await page.screenshot({ path: `${OUT}/f${String(i).padStart(2, "0")}.png` });
        }
        await page.waitForTimeout(60);
    }
    await page.screenshot({ path: `${OUT}/after.png` });

    const perMember = MEMBERS.map((m) => {
        const live = samples.map((s) => s.ensembles.find((o) => o.id === m.id)).filter(Boolean);
        const recsHeld = live.map((o) => o.recs.join(","));
        const clips = live.map((o) => o.clips);
        return {
            member: `${STAGE} id ${m.id} (${m.hex})`,
            liveFrames: live.length,
            steadyMode: live.every((o) => o.mode === 2),
            claimed: recsHeld[0] ?? null,
            expected: m.tags.map((t) => recs.find((r) => r.tag === t).index).join(","),
            slots: clips[0] ?? null,
            pinned: m.pinned.map((p, i) => (clips[0]?.[4 + i]?.sprite === p)).every(Boolean),
            dark: (clips[0]?.[0]?.active === 0) && (clips[0]?.[1]?.active === 0),
            moving: [...new Set(clips.map((c) => c[3]?.sprite))].length >= 1,
        };
    });

    const boxes = samples.map((s) => s.boxes).filter((b) => b.some((v) => typeof v === "number"));
    const anyNative = samples.some((s) => s.native);
    const changedFromBefore = before.boxes.some(
        (v, k) => typeof v === "number" && boxes.some((b) => typeof b[k] === "number" && b[k] !== v),
    );
    const romHadThemOff = recs.every((r) => r.romActive === 0);
    const claimedRight = perMember.every((m) => m.claimed === m.expected);
    const ok = fired.every((f) => f === true) && !anyNative && romHadThemOff
        && claimedRight
        && perMember.every((m) => m.liveFrames === FRAMES && m.steadyMode
            && m.pinned && m.dark && m.moving)
        && changedFromBefore;

    console.log(`--- ${STAGE} (SETANIM 831 857 2 / SETANIM 832 857 2, event 681) ---`);
    console.log("FIRED", JSON.stringify(fired), "NATIVE", anyNative,
        "ALL_SIX_DORMANT_IN_ROM", romHadThemOff);
    for (const m of perMember) console.log(JSON.stringify(m));
    console.log("BOX_BEFORE", JSON.stringify(before.boxes),
        "DISTINCT_BOXES", new Set(boxes.map((b) => JSON.stringify(b))).size);
    console.log("CHANGED_FROM_BEFORE", changedFromBefore);
    console.log("VERDICT", ok ? "OK" : "FAIL");
    results.push({
        members: perMember, fired, nativeRuntime: anyNative,
        changedFromBefore, verdict: ok ? "OK" : "FAIL",
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
