// Player-visible check: the field's sixteen-ordinal scene variant ALSO flips one
// ambient display-slot record, in ORDINARY play.
//
// The map/point-slot setup fieldstg F0x80084B40 walks the field's own 18-byte
// display chain ([0x80099D90] = scene-descriptor 0x80080...) in 0x12 strides and
// writes the FIRST record whose tag byte (+1) is 1: byte 1 on the sixteen variant
// story beats, byte 0 otherwise. The walk is ported once as
// engine/systems/ordinal-scene-variant.ts sceneVariantSlotIndex and consumed by
// web/effects.js (applySceneVariantSlot), which writes the record's live byte at
// stage setup. Decode: docs/research/field/ordinal-scene-variant-decoded-2026-10-06.md.
//
// Boots real stages with NO research flags (no ?nativeStages, so the original
// overlay machine code is NOT running), reads the point-record probe for the slot
// the walk names, and checks its live byte at a non-variant ordinal (must be 0)
// and a variant ordinal (must be 1). s200, with no tag-1 record, must show no
// slot at all. The Cargo Tower (s261) is the screen the variant is about; its
// tag-1 record is drawn with a before/after capture.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_ordinal_scene_variant.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || ".bunny-scratch/ordinal-scene-variant";
const VARIANT = 5;   // a variant beat (the first slot of the 35-entry table)
const OTHER = 6;     // a non-variant ordinal in [5,40)
const STAGES = ["s261", "s305", "s200"];
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];

try {
  for (const stage of STAGES) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const logs = [];
    page.on("console", (c) => logs.push(`${c.type()}: ${c.text()}`));
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`${baseUrl(8964)}/?skipTitle=1&map=${stage}`);
      const style = page.locator("#asset-mode-authentic");
      if (await style.isVisible().catch(() => false)) await style.click();
      await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
      await page.waitForTimeout(1200);

      // The slot the disc's walk names, straight from the browser mirror.
      const slot = await page.evaluate(async (sid) => {
        const ps = await (await fetch("/assets/data/point_sprites.json")).json();
        const m = await import("/ordinal-scene-variant.js");
        const i = m.sceneVariantSlotIndex(ps[sid].records);
        const r = i >= 0 ? ps[sid].records[i] : null;
        return { index: i, romActive: r?.active ?? null, x: r?.x ?? null, y: r?.y ?? null };
      }, stage);

      const setOrdinal = async (o) => {
        await page.evaluate((n) => { window.__state.progressOrdinal = n; }, o);
        // Let a few frames run so prepareEffects re-applies the (stage, ordinal).
        await page.waitForTimeout(500);
        return page.evaluate((sid) => {
          const records = window.__pointRecordActors.records(sid);
          return { records: Array.isArray(records) ? records : [] };
        }, stage);
      };
      const native = await page.evaluate(async (sid) => {
        const ns = await import("/native-stage.js");
        return ns.nativeStage(sid) !== null;
      }, stage);

      const atOther = await setOrdinal(OTHER);
      const atVariant = await setOrdinal(VARIANT);
      const backOther = await setOrdinal(OTHER);

      const liveAt = (probe) => slot.index >= 0 ? (probe.records[slot.index]?.active ?? null) : null;
      const otherActive = liveAt(atOther);
      const variantActive = liveAt(atVariant);
      const backActive = liveAt(backOther);

      // A before/after capture of the slot's box: the Cargo Tower's tag-1 record
      // is a palette-cycling decoration on layer 2, over the floor.
      if (stage === "s261" && slot.index >= 0) {
        await page.evaluate(([x, y]) => { window.__state.x = x; window.__state.y = y; }, [slot.x, slot.y]);
        await page.waitForTimeout(400);
      }
      await setOrdinal(VARIANT);
      await page.screenshot({ path: `${OUT}/${stage}-variant.png` });
      await setOrdinal(OTHER);
      await page.screenshot({ path: `${OUT}/${stage}-default.png` });

      const noSlotStage = slot.index < 0;
      const ok = !native
        && (noSlotStage
          ? otherActive === null && variantActive === null
          : otherActive === 0 && variantActive === 1 && backActive === 0);
      results.push({
        stage, slot: slot.index, romActive: slot.romActive,
        atOther: otherActive, atVariant: variantActive, backOther: backActive,
        nativeRuntime: native, verdict: ok ? "OK" : "FAIL",
      });
      console.log(`--- ${stage} ---`);
      console.log("SLOT", slot.index, "ROM_ACTIVE", slot.romActive, "NATIVE", native);
      console.log("ACTIVE@", OTHER, "=", otherActive, " @" + VARIANT, "=", variantActive,
          " back@" + OTHER, "=", backActive);
      console.log("VERDICT", ok ? "OK" : "FAIL");
      for (const l of logs) if (/error|pageerror/i.test(l)) console.log(`  [${stage}] ${l}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log("=== SUMMARY ===");
for (const r of results) console.log(JSON.stringify(r));
const allOk = results.length === STAGES.length && results.every((r) => r.verdict === "OK");
console.log("ALL_STAGES_OK", allOk);
process.exit(allOk ? 0 : 1);
