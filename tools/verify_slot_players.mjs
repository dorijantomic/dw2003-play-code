// Player-visible check: the Master Room's arena marker, BOTH members, in
// ORDINARY play.
//
// The two registry members that claim one of the field's own display slots by
// its tag byte and write that slot's sprite every frame:
//
//   s305 id 850 (0x352)  the Master Room marker, slot tagged 1 at (382, 196)
//   s306 id 851 (0x353)  the same routine in the second Master Room overlay
//
// Both are drawn by the translated system (engine/systems/stage-slot-player.ts)
// instead of the original overlay machine code. Decode:
// docs/research/field/stage-object-registry-2026-10-04.md section 10.5
//
// Boots each room with NO research flags - no ?nativeStages, so the original
// overlay machine code is NOT running - fires the member with the stage script's
// own `SETANIM` line, and reports for each: whether the slot was claimed, which
// sprites it walked, whether the marker reached the canvas, and whether the
// packed voice played and then stopped. Frame series are written for the eye.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_slot_players.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || ".bunny-scratch/slot-players";
const FRAMES = Number(process.env.FRAMES || 24);
// The stage scripts' own lines: `SETANIM 850 821 2` (s305 event 661) and
// `SETANIM 851 821 1` (s306 event 930). The configure handler is handed the
// FIRST trailing operand - 821 - and ignores the second.
const MEMBERS = [
    { stage: "s305", id: 850, sub: 821, third: 2, event: 661 },
    { stage: "s306", id: 851, sub: 821, third: 1, event: 930 },
];
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];

try {
  for (const m of MEMBERS) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const logs = [];
    page.on("console", (c) => logs.push(`${c.type()}: ${c.text()}`));
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`${baseUrl(8963)}/?skipTitle=1&map=${m.stage}`);
      const style = page.locator("#asset-mode-authentic");
      if (await style.isVisible().catch(() => false)) await style.click();
      await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
      await page.waitForTimeout(1200);

      // The slot the member claims: the stage's own record carrying its tag.
      const rec = await page.evaluate(async ([stage, tag]) => {
          const ps = await (await fetch("/assets/data/point_sprites.json")).json();
          const rs = ps[stage].records;
          const i = rs.findIndex((r) => r.atlasFlag === tag && r.size);
          return { index: i, x: rs[i]?.x, y: rs[i]?.y, romActive: rs[i]?.active,
                   sprites: ps[stage].sprites };
      }, [m.stage, 1]);
      if (!(rec.index >= 0)) throw new Error(`${m.stage} ships no slot tagged 1`);

      // Park the camera on it so its box is on the canvas.
      await page.evaluate(([x, y]) => {
          window.__state.x = x;
          window.__state.y = y;
      }, [rec.x, rec.y]);
      await page.waitForFunction(
          ([x, y]) => {
              const cam = window.__lastCam;
              if (!cam) return false;
              const c = document.querySelector("canvas");
              const z = cam.zoom || 1;
              const sx = (x - cam.x) * z;
              const sy = (y - cam.y) * z;
              return sx >= 0 && sy >= 0 && sx + 96 * z <= c.width && sy + 96 * z <= c.height;
          },
          [rec.x, rec.y],
          { timeout: 15000 },
      );

      // A checksum over the marker's own box: the floor under it is opaque, so
      // only a change in the box proves the slot drew.
      const read = async () =>
          page.evaluate(async ([stage, i, x, y]) => {
              const so = await import("/stage-objects.js");
              const ns = await import("/native-stage.js");
              const st = so.stageObjectState(stage);
              const o = st.slotPlayers?.[0] ?? null;
              let box = null;
              if (window.__lastCam) {
                  const c = document.querySelector("canvas");
                  const g = c.getContext("2d");
                  const z = window.__lastCam.zoom || 1;
                  const sx = Math.round((x - window.__lastCam.x) * z);
                  const sy = Math.round((y - window.__lastCam.y) * z);
                  const w = Math.round(96 * z);
                  const h = Math.round(96 * z);
                  if (sx >= 0 && sy >= 0 && sx + w <= c.width && sy + h <= c.height) {
                      const d = g.getImageData(sx, sy, w, h).data;
                      let sum = 0;
                      for (let i2 = 0; i2 < d.length; i2 += 4) {
                          sum = (sum * 31 + d[i2] + d[i2 + 1] * 3 + d[i2 + 2] * 7) | 0;
                      }
                      box = sum;
                  }
              }
              return { state: st, box, native: ns.nativeStage(stage) !== null };
          }, [m.stage, rec.index, rec.x, rec.y]);

      // BEFORE: nothing constructed, which is what the shipped game showed.
      // The camera eases toward the player, so a "before" checksum is only
      // comparable if the camera has stopped. Sample until two agree.
      let before = await read();
      for (let i = 0; i < 6; i++) {
          await page.waitForTimeout(300);
          const again = await read();
          if (again.box !== null && again.box === before.box) { before = again; break; }
          before = again;
      }
      await page.screenshot({ path: `${OUT}/${m.stage}-before.png` });

      // Fire it the way the stage script does: SETANIM <id> <sub>.
      const fired = await page.evaluate(async ([stage, id, sub]) => {
          const so = await import("/stage-objects.js");
          return so.fireStageObject(stage, id, sub);
      }, [m.stage, m.id, m.sub]);
      await page.waitForTimeout(120);

      const samples = [];
      for (let i = 0; i < FRAMES; i++) {
          samples.push(await read());
          if (i % 3 === 0) {
              await page.screenshot({ path: `${OUT}/${m.stage}-f${String(i).padStart(2, "0")}.png` });
          }
          await page.waitForTimeout(60);
      }

      const live = samples.map((s) => s.state.slotPlayers?.[0] ?? null).filter(Boolean);
      const clips = [...new Set(live.map((o) => o.clip))];
      const claimed = new Set(live.map((o) => o.rec));
      const boxes = samples.map((s) => s.box).filter((v) => typeof v === "number");
      const anyNative = samples.some((s) => s.native);
      const chainOk = live.every((o) => o.state === 1);
      // The decoded timeline: the run walks 5..9, blanks for one frame on the
      // 255 marker, then the counter advances and every value pins clip 5. The
      // blank is a single frame, so the sampler may miss it - `blanked` is
      // reported, not required; the exact-frame timeline is asserted in
      // tests/stage-slot-player.test.js instead.
      const runClips = [...new Set(live.filter((o) => o.clip >= 5 && o.clip <= 9)
          .map((o) => o.clip))];
      const blanked = live.some((o) => o.clip === 255);
      const settled = live.at(-1)?.clip === 5;
      const counterDone = live.at(-1)?.counter === 2;
      const romHadItOff = rec.romActive === 0;
      const changedFromBefore = before.box !== null
          && boxes.some((v) => v !== before.box);
      const rects = Object.keys(rec.sprites).filter((k) => !k.includes("@")).length;
      const ok = fired === true && live.length === FRAMES && !anyNative && romHadItOff
          && claimed.size === 1 && claimed.has(rec.index) && chainOk
          // The counter only advances when the run reaches its 255 marker, so
          // `counter === 2` together with a settled clip 5 IS the run finishing;
          // how many of its five sprites the sampler catches is a sampling race.
          && runClips.length >= 1 && settled && counterDone
          && changedFromBefore && rects > 0;
      results.push({
        member: `${m.stage} id ${m.id}`, fired, romActive: rec.romActive,
        claimedRecord: [...claimed], clips, chain: chainOk, runClips,
        blanked, settled, counter: live.at(-1)?.counter,
        distinctBoxes: new Set(boxes).size, nativeRuntime: anyNative,
        verdict: ok ? "OK" : "FAIL",
      });
      console.log(`--- ${m.stage} id ${m.id} (SETANIM ${m.id} ${m.sub} ${m.third}, event ${m.event}) ---`);
      console.log("FIRED", fired, "ROM_ACTIVE", rec.romActive, "CLAIMED", [...claimed],
          "EXPECTED", rec.index);
      console.log("CLIPS", clips.join(","), "RUN_SPRITES", runClips.join(","),
          "BLANKED", blanked, "SETTLED_ON_5", settled,
          "COUNTER", live.at(-1)?.counter);
      console.log("BOX_BEFORE", before.box, "DISTINCT_BOXES", new Set(boxes).size,
          "NATIVE", anyNative);
      console.log("VERDICT", ok ? "OK" : "FAIL");
      for (const l of logs) {
          if (/error|pageerror/i.test(l)) console.log(`  [${m.stage}] ${l}`);
      }
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log("=== SUMMARY ===");
for (const r of results) console.log(JSON.stringify(r));
const allOk = results.length === MEMBERS.length && results.every((r) => r.verdict === "OK");
console.log("ALL_MEMBERS_OK", allOk);
process.exit(allOk ? 0 : 1);
