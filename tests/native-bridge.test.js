// Differential proof for the mixed-mode bridge: the same screen root runs with
// the original MIPS bodies and with the engine/dw3 ports replacing them, and the
// observable result must be identical (docs/plans/2026-09-14-native-screen-port-
// plan.md, Priority 1). The instrumentation assertions are the replacement
// proof: each invoked bridge entry reports status `replaced` with hits === 0 in
// the bridge run (the original body never executed) and hits > 0 in the native
// run.
//
// The full-root gate over all 20 roots is tools/verify_native_bridge.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadSpecs, runScreen, summarize } from "../tools/native_screen_probe.ts";
import { isBridged } from "../engine/native/bridge.ts";

const FRAMES = 60;

// The probe reads the resident EXE and the overlays from the disc; resolve it
// exactly like tools/native_screen_probe.ts does (DW3_DISC, then
// DDW3_DIR/build/iso, then ~/ddw3/build/iso) and skip when there is none.
const disc = process.env.DW3_DISC ?? join(process.env.DDW3_DIR ?? join(homedir(), "ddw3"), "build/iso/dw2003.bin");
const hasDisc = existsSync(disc);

function findFn(run, module, address) {
    const list = module === "exe/fns" ? run.residentExecuted : run.executed;
    return list.find((f) => f.address === address);
}

function proveReplacement(module) {
    const spec = loadSpecs().find((s) => s.module === module);
    assert.ok(spec, `${module} is a census root`);
    const off = runScreen(spec, { frames: FRAMES, interact: true });
    const on = runScreen(spec, { frames: FRAMES, interact: true, bridge: true });

    assert.equal(on.booted, true, `${module} boots with the bridge installed`);
    assert.equal(on.traps.length, 0, `${module} raises no traps with the bridge`);
    assert.equal(on.memHash, off.memHash, `${module} memory identical (FNV over 2MB)`);
    assert.equal(on.drawHash, off.drawHash, `${module} ordered draw intents identical`);
    assert.equal(on.quadHash, off.quadHash, `${module} captured quads identical`);
    assert.deepEqual(on.sounds, off.sounds, `${module} ordered packed sounds identical`);
    assert.ok(on.bridged.length > 0, `${module} exercised at least one bridge entry`);

    for (const b of on.bridged) {
        assert.ok(b.invocations > 0, `${b.name} invoked`);
        const inOn = findFn(on, b.module, b.address);
        const inOff = findFn(off, b.module, b.address);
        assert.ok(inOn, `${b.module}:0x${b.address.toString(16)} present in the bridge run`);
        assert.ok(inOff, `${b.module}:0x${b.address.toString(16)} present in the native run`);
        assert.equal(inOn.status, "replaced", `${b.name} is marked replaced`);
        assert.equal(inOn.hits, 0, `${b.name} original MIPS body never executed`);
        assert.ok(inOff.hits > 0, `${b.name} runs as MIPS without the bridge`);
        assert.ok(isBridged(b.module, b.address), `${b.name} is a declared bridge entry`);
    }

    const s = summarize([on]);
    assert.equal(s.replaced_functions, on.bridged.length, `${module} replaced-function count`);
    assert.ok(s.bridge_invocations > 0, `${module} invocation count recorded`);
}

test("bridge replaces item-shop functions with identical observable state", { skip: hasDisc ? false : "disc image not present (set DW3_DISC)" }, () => {
    proveReplacement("pro/stitshop");
});

test("bridge replaces pause/status functions with identical observable state", { skip: hasDisc ? false : "disc image not present (set DW3_DISC)" }, () => {
    proveReplacement("pro/ststatus");
});
