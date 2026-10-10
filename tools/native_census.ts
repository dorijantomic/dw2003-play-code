// Census-wide burn-down harness for the wstag native interpreter (P2 of
// docs/specs/2026-07-04-wstag-native-interpreter-design.md).
//
// Boots EVERY stage in web/assets/native/ (built by tools/build_native_overlays.py
// from the ~/ddw3 decomp disassembly) through the production runtime — real root
// ctor, real callbacks, stub boundary — ticks N frames, and reports per stage:
// objects allocated, draw/sfx activity, and every fail-soft trap (the exact
// pc + callback that needs a stub or decode). Exit 0 always; the report IS
// the deliverable.
//
//   node tools/native_census.ts             # human table
//   node tools/native_census.ts --json      # machine-readable
//   node tools/native_census.ts s780 s415   # subset

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import type { StageManifestEntry } from "../engine/native/runtime.ts";
import type { NativeHost } from "../engine/native/stubs.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "web/assets/native");
const FRAMES = 300;

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const only = args.filter((a) => a.startsWith("s"));

const manifest: Record<string, StageManifestEntry> = JSON.parse(
  readFileSync(join(dir, "manifest.json"), "utf8"),
);
const exeTables = JSON.parse(readFileSync(join(dir, "exe_tables.json"), "utf8"));
const fieldstg = new Uint8Array(readFileSync(join(dir, "fieldstg.bin")));

function host(): NativeHost {
  const flags = new Map<number, number>();
  return {
    setFlag: (id, v) => void flags.set(id, v),
    getFlag: (id) => flags.get(id) ?? 0,
    rand16: () => 0x777, // fixed: census wants determinism, not distribution
  };
}

interface Row {
  stage: string;
  boot: boolean;
  bootTrap?: string;
  objects: number;
  live: number;
  draws: number;
  sfx: number;
  traps: { cb: string; pc: string; reason: string }[];
}

const rows: Row[] = [];
const stages = (only.length ? only : Object.keys(manifest)).sort();

for (const stage of stages) {
  const entry = manifest[stage];
  if (!entry || entry.root_ctor < 0) continue;
  const overlay = new Uint8Array(readFileSync(join(dir, `${stage}.bin`)));
  const rt = new NativeStageRuntime(overlay, entry, host(), exeTables, fieldstg);
  const booted = rt.boot();
  if (booted) for (let f = 0; f < FRAMES; f++) rt.tick(1);
  const row: Row = {
    stage,
    boot: booted,
    objects: rt.world.objects.length,
    live: rt.liveObjects.length,
    draws: rt.drawCalls.length,
    sfx: rt.sfx.length,
    traps: dedupe(rt.disabled.map((d) => ({
      cb: `0x${(d.cb >>> 0).toString(16)}`,
      pc: `0x${(d.pc >>> 0).toString(16)}`,
      reason: d.reason.split(" @pc")[0] ?? d.reason,
    }))),
  };
  if (rt.bootTrap) row.bootTrap = `${rt.bootTrap.reason}`;
  rows.push(row);
}

function dedupe<T>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = JSON.stringify(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

if (asJson) {
  console.log(JSON.stringify({ frames: FRAMES, stages: rows }, null, 1));
} else {
  const clean = rows.filter((r) => r.boot && r.traps.length === 0);
  const dirty = rows.filter((r) => !r.boot || r.traps.length > 0);
  console.log(`native census: ${rows.length} stages × ${FRAMES} frames`);
  console.log(`  CLEAN ${clean.length}: boot ok, zero traps`);
  for (const r of clean) {
    console.log(`    ${r.stage}: objects=${r.objects} live=${r.live} draws=${r.draws} sfx=${r.sfx}`);
  }
  console.log(`  DIRTY ${dirty.length}:`);
  for (const r of dirty) {
    const head = r.boot ? `objects=${r.objects} live=${r.live}` : `BOOT TRAP: ${r.bootTrap}`;
    console.log(`    ${r.stage}: ${head}`);
    for (const t of r.traps) console.log(`      trap cb=${t.cb} pc=${t.pc} ${t.reason}`);
  }
}
