// Differential proof for the mixed-mode bridge (docs/plans/2026-09-14-native-
// screen-port-plan.md, Priority 1): every screen root runs twice under the same
// frames/interaction — once with the original MIPS bodies (bridge off), once
// with the engine/dw3 ports replacing them (bridge on). The observable results
// must be identical:
//
//   * same boot result and 0 traps both runs
//   * identical memory hash over the full 2MB address space
//   * identical ordered draw-intent stream and textured-quad hash
//   * each invoked bridge entry reports hits === 0 for its own partition in the
//     bridge run (proof the original body did not execute) and hits > 0 in the
//     native run
//
// This is the safety gate for scaling the bridge: an entry whose port diverges
// (or whose register side-effect contract is incomplete) fails here and must be
// fixed or moved to BRIDGE_BLOCKERS before it stays installed.
//
//   node tools/verify_native_bridge.ts
//   node tools/verify_native_bridge.ts --module pro/stitshop --frames 60
//   node tools/verify_native_bridge.ts --all --frames 240

import { loadSpecs, runScreen, summarize } from "./native_screen_probe.ts";
import type { ScreenRun } from "./native_screen_probe.ts";
import { isBridged } from "../engine/native/bridge.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const frames = Number(flag("--frames") ?? 240) >>> 0;
const moduleFilter = flag("--module");

const specs = loadSpecs().filter((s) => moduleFilter === undefined || s.module === moduleFilter);
if (specs.length === 0) {
  console.error(`no spec for ${moduleFilter}`);
  process.exit(2);
}

interface Failure {
  root: string;
  what: string;
}

function totalTraps(run: ScreenRun): number {
  return run.traps.reduce((n, t) => n + t.count, 0);
}

function findFn(run: ScreenRun, module: string, address: number): { hits: number; status: string } | null {
  const list = module === "exe/fns" ? run.residentExecuted : run.executed;
  const f = list.find((x) => x.address === address);
  return f === undefined ? null : { hits: f.hits, status: f.status };
}

const failures: Failure[] = [];
const rows: string[] = [];
const onRuns: ScreenRun[] = [];
let totalBridged = 0;
let totalInvocations = 0;

for (const spec of specs) {
  const off = runScreen(spec, { frames, interact: true });
  const on = runScreen(spec, { frames, interact: true, bridge: true });
  onRuns.push(on);
  const fail = (what: string): void => {
    failures.push({ root: spec.module, what });
  };

  if (off.booted !== on.booted) fail(`boot differs: native=${off.booted} bridge=${on.booted}`);
  if (off.traps.length !== 0 || on.traps.length !== 0) {
    fail(`traps: native=${totalTraps(off)} bridge=${totalTraps(on)}`);
  }
  if (off.memHash !== on.memHash) fail(`memHash differs: native=${off.memHash} bridge=${on.memHash}`);
  if (off.drawHash !== on.drawHash) fail(`drawHash differs: native=${off.drawHash} bridge=${on.drawHash}`);
  if (off.quadHash !== on.quadHash) fail(`quadHash differs: native=${off.quadHash} bridge=${on.quadHash}`);
  if (JSON.stringify(off.sounds) !== JSON.stringify(on.sounds)) {
    fail(`sound stream differs: native=${JSON.stringify(off.sounds)} bridge=${JSON.stringify(on.sounds)}`);
  }
  if (on.bridged.length === 0) {
    // Nothing to replace on this root's exercised path: no executed function
    // matches a bridge entry for its module. If the native run did execute a
    // bridgeable function, the install/interception itself failed.
    const bridgeableNative = [...off.executed, ...off.residentExecuted].filter((f) =>
      isBridged(f.module, f.address),
    );
    if (bridgeableNative.length > 0) {
      fail(
        `bridgeable functions executed natively but not replaced: ` +
          bridgeableNative.map((f) => `${f.module}:0x${f.address.toString(16)}`).join(", "),
      );
    }
  }

  for (const b of on.bridged) {
    totalBridged += 1;
    totalInvocations += b.invocations;
    const nativeSide = findFn(off, b.module, b.address);
    const bridgeSide = findFn(on, b.module, b.address);
    if (nativeSide === null || nativeSide.hits <= 0) {
      fail(`entry ${b.module}:0x${b.address.toString(16)} has no native hits to replace`);
      continue;
    }
    if (bridgeSide === null) {
      fail(`entry ${b.module}:0x${b.address.toString(16)} missing from the bridge run`);
      continue;
    }
    if (bridgeSide.status !== "replaced") {
      fail(`entry ${b.module}:0x${b.address.toString(16)} status=${bridgeSide.status}, want replaced`);
    }
    if (bridgeSide.hits !== 0) {
      fail(`entry ${b.module}:0x${b.address.toString(16)} still executed ${bridgeSide.hits} MIPS instructions`);
    }
  }

  const s = summarize([on]);
  rows.push(
    `${spec.module.padEnd(16)} bridged=${String(on.bridged.length).padStart(2)}` +
      ` invocations=${String(on.bridged.reduce((n, b) => n + b.invocations, 0)).padStart(7)}` +
      ` replaced=${s.replaced_functions} stillNative=${s.translation_queue}` +
      ` mem=${on.memHash} draw=${on.drawHash}`,
  );
}

for (const row of rows) console.log(row);
const summary = summarize(onRuns);
console.log(
  `\nSUMMARY roots=${specs.length} bridgedEntries=${totalBridged} invocations=${totalInvocations}` +
    ` replacedFunctions=${summary.replaced_functions} translatedNotReplaced=${summary.translated_not_replaced}` +
    ` nativeQueue=${summary.translation_queue} hostServedBoundaries=${summary.host_served_boundaries}`,
);
if (failures.length === 0) {
  console.log("verify_native_bridge: OK");
} else {
  for (const f of failures) console.error(`FAIL ${f.root}: ${f.what}`);
  console.error(`verify_native_bridge: ${failures.length} failure(s)`);
  process.exit(1);
}
