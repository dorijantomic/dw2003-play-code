// Phase 0 coverage-tool pin: the native screen probe must keep reporting the
// real executed functions and boundary targets per screen root, so the
// generated report for docs/plans/2026-09-14-native-screen-port-plan.md stays
// reproducible. This is a tool regression guard, not an original-game claim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { indexModule, loadSpecs, markdown, runScreen, summarize } from "../tools/native_screen_probe.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Resolve the disc exactly like tools/native_screen_probe.ts so the guard and
// the probe agree on where it is (DW3_DISC, then DDW3_DIR/build/iso, then
// ~/ddw3/build/iso). A disc somewhere else: set DW3_DISC.
const disc = process.env.DW3_DISC ?? join(process.env.DDW3_DIR ?? join(homedir(), "ddw3"), "build/iso/dw2003.bin");
const hasDisc = existsSync(disc);

test("screen census specs list all 20 roots with the shop's decoded constructor", () => {
  const specs = loadSpecs();
  assert.equal(specs.length, 20);
  const shop = specs.find((s) => s.module === "pro/stitshop");
  assert.ok(shop);
  assert.equal(shop.ctor, 0x8008596c);
  assert.equal(shop.tick, 0x80085890);
});

test(
  "item shop executes its list builder and calls the resident text service",
  { skip: hasDisc ? false : "disc image not present (set DW3_DISC)" },
  () => {
    const spec = loadSpecs().find((s) => s.module === "pro/stitshop");
    const run = runScreen(spec, { frames: 5 });
    assert.equal(run.booted, true);
    assert.ok(run.objects >= 30, `objects=${run.objects}`);
    assert.equal(run.traps.length, 0);
    const starts = new Set(run.executed.map((f) => f.address));
    assert.ok(starts.has(0x80087428), "item list builder F0x80087428 must execute");
    assert.ok(starts.has(0x80083970), "furniture draw F0x80083970 must execute");
    const text = run.boundary.find((b) => b.address === 0x8001ae38);
    assert.ok(text, "createTextElement must be an external boundary target");
    assert.equal(text.kind, "resident");
    assert.ok(
      text.callers.some((c) => c.includes("F0x8008360c") || c.includes("shopBuildListLabels")),
      text.callers.join(","),
    );
  },
);

test(
  "the shipped manifest maps every pack directory the wizard intro draws from",
  { skip: hasDisc ? false : "disc image not present (set DW3_DISC)" },
  () => {
    // Regression: the asset plan used a 20-frame window, so pro/stplnmet's first
    // drawSprite (the intro's cmnbgd background + stnmet logo, first reached at
    // ~frame 25) was never measured; the shipped entry had packs={} and the lab
    // renderer skipped every intent. tools/build_native_screens.py now plans 60
    // frames. This pins the mapping the renderer needs.
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "web/assets/native/screens/manifest.json"), "utf8"),
    );
    const spec = loadSpecs().find((s) => s.module === "pro/stplnmet");
    const run = runScreen(spec, { frames: 60 });
    assert.equal(run.traps.length, 0);
    const dirs = new Set(run.drawDirsAll.length ? run.drawDirsAll : Object.values(run.drawDirs));
    assert.ok(dirs.size > 0, "the intro must draw at least one sprite");
    const packs = manifest.screens["pro/stplnmet"].packs ?? {};
    const missing = [];
    for (const d of dirs) {
      const idx = run.packDirIndex[String(d)];
      if (idx === undefined) continue;
      const sub = run.packDirSlot[String(d)] ?? 0;
      if (!(`${idx}:${sub}` in packs) && !(String(idx) in packs)) missing.push(`${idx}:${sub}`);
    }
    assert.deepEqual(missing, [], `unmapped draw directories: ${missing.join(",")}`);
  },
);

test(
  "markdown report carries the reproducing command and per-root rows",
  { skip: hasDisc ? false : "disc image not present (set DW3_DISC)" },
  () => {
    const specs = loadSpecs().filter((s) => s.module === "pro/stgdglab");
    const runs = specs.map((s) => runScreen(s, { frames: 3 }));
    const md = markdown(runs, "node tools/native_screen_probe.ts --all --frames 3", 3);
    assert.match(md, /status: generated/);
    assert.match(md, /node tools\/native_screen_probe\.ts --all --frames 3/);
    assert.match(md, /pro\/stgdglab/);
    assert.equal(summarize(runs).roots_total, 1);
    assert.ok(runs[0].booted);
  },
);

test(
  "every executed function and boundary target carries a host-served/native status",
  { skip: hasDisc ? false : "disc image not present (set DW3_DISC)" },
  () => {
    const spec = loadSpecs().find((s) => s.module === "pro/stitshop");
    const run = runScreen(spec, { frames: 5 });
    // "translated" joins the set in Phase 4: an executed overlay/resident
    // function with an engine/dw3 port and an interpreter-oracle test.
    const valid = new Set(["host-served", "native", "inline", "translated", "replaced"]);
    for (const f of [...run.executed, ...run.residentExecuted]) {
      assert.ok(valid.has(f.status), `${f.name} status=${f.status}`);
    }
    for (const b of run.boundary) {
      assert.ok(b.status === "host-served" || b.status === "native" || b.status === "translated", `boundary 0x${b.address.toString(16)} status=${b.status}`);
    }
    // The shop's picture/text boundary is host-served (draw-context methods, the
    // resident cache transfer, and the text service's line fill are stubs or
    // native code); the account must not collapse to all-native.
    const served = new Set(run.boundary.filter((b) => b.status === "host-served").map((b) => b.address));
    assert.ok(served.size >= 1, "at least one host-served boundary");
    assert.ok(
      [0x80017d2c, 0x80013914, 0x8001ed6c].some((a) => served.has(a)),
      `a core host service boundary among alloc/cache/drawSprite (served ${[...served].map((a) => "0x" + a.toString(16)).join(",")})`,
    );
    const s = summarize([run]);
    // Every executed function is either still in the native queue, already
    // translated, or actively replaced by the bridge; they account for the
    // whole executed set.
    assert.equal(
      s.translation_queue + s.translated_functions + s.replaced_functions,
      run.executed.length + run.residentExecuted.length,
    );
    assert.ok(s.host_served_boundaries >= 1, "at least one host-served boundary");
  },
);

test(
  "translated status is module-scoped (the same address can carry two translations)",
  { skip: hasDisc ? false : "disc image not present (set DW3_DISC)" },
  () => {
    // 0x80085934 is the stitshop band-highlight forwarder AND a pro/stcrdabm
    // fold tick; every screen overlay shares the 0x80082cb0 base, so the
    // registry must keep one entry per module at the same address.
    const registry = JSON.parse(readFileSync(join(repoRoot, "data/translated_functions.json"), "utf8"));
    const at = registry.filter((e) => e.address === "0x80085934");
    const shopEntry = at.find((e) => e.module === "pro/stitshop");
    const albumEntry = at.find((e) => e.module === "pro/stcrdabm");
    assert.ok(shopEntry && albumEntry, "both modules must have an entry at 0x80085934");
    assert.notEqual(shopEntry.port, albumEntry.port, "the two modules must keep their own ports");

    const specs = loadSpecs();
    const albumRun = runScreen(specs.find((s) => s.module === "pro/stcrdabm"), { frames: 20 });
    const albumFn = albumRun.executed.find((f) => f.address === 0x80085934);
    assert.ok(albumFn, "pro/stcrdabm must execute a function at 0x80085934");
    assert.equal(albumFn.module, "pro/stcrdabm");
    assert.equal(albumFn.status, "translated", "the album fold tick has its own translation");
    const shopRun = runScreen(specs.find((s) => s.module === "pro/stitshop"), { frames: 5 });
    assert.equal(shopRun.booted, true);
  },
);

test(
    "a routine's last instruction belongs to it (no off-by-four extent gap)",
    { skip: hasDisc ? false : "disc image not present (set DW3_DISC)" },
    () => {
        // tools/build_recovered_inventory.py writes provisional_end_address as
        // next_start - 4, the *inclusive* last-instruction address, while the
        // coverage probe partitions addresses with an exclusive bound. Adopting
        // the raw value put every routine's final instruction (its delay slot) in
        // the `unmapped` bucket, and the report read all 222 rows as "candidate
        // hidden routines" (audit 2026-09-15:
        // .dw3-research/autonomous-team/researcher/results/executed-unnamed-pcs-audit/).
        // indexModule converts to an exclusive bound, so every executed pc lands
        // in a partition.
        const inventory = JSON.parse(readFileSync(join(repoRoot, "recovered/ddw3/function-inventory.json"), "utf8"));
        for (const moduleId of ["pro/stitshop", "pro/stgdglab", "pro/ststatus"]) {
            const mod = inventory.modules.find((m) => m.id === moduleId);
            assert.ok(mod, `${moduleId} must be in the inventory`);
            const index = indexModule(moduleId);
            let checked = 0;
            for (const f of mod.functions ?? []) {
                const end = Number(f.provisional_end_address);
                if (!Number.isFinite(end) || end === 0) continue;
                const desc = index.find((d) => d.address === Number(f.address));
                assert.ok(desc, `no partition for 0x${Number(f.address).toString(16)}`);
                // Either the last instruction is inside this partition, or a
                // closer known start (a constructor-installed pointer candidate)
                // clamps it and owns the rest.
                assert.ok(
                    desc.end > end || index.some((d) => d.address === desc.end),
                    `${moduleId} 0x${Number(f.address).toString(16)}: partition ends at ` +
                        `0x${desc.end.toString(16)} with last instruction 0x${end.toString(16)} and no start there`,
                );
                checked++;
            }
            assert.ok(checked >= 5, `${moduleId}: only ${checked} functions checked`);
        }
        // Observed consequence: these two roots execute nothing outside a partition.
        for (const [moduleId, frames] of [["pro/stitshop", 5], ["pro/stgdglab", 20]]) {
            const run = runScreen(loadSpecs().find((s) => s.module === moduleId), { frames });
            assert.equal(run.booted, true);
            assert.deepEqual(
                run.unmapped,
                [],
                `${moduleId}: executed pcs outside every partition: ` +
                    run.unmapped.map((u) => "0x" + u.address.toString(16)).join(","),
            );
        }
    },
);

test("resident fragment starts split the home-menu tail without gaps", () => {
    // Existing source tiling: docs/research/infra/static-decoder.md:151-156.
    const starts = [0x80013350, 0x8001345c, 0x800134ac, 0x800134e8,
        0x80013534, 0x8001355c, 0x80013584, 0x800135b8, 0x800135e8,
        0x80013694, 0x800136f4, 0x80013780];
    const index = indexModule("exe/fns");
    const owner = pc => index.find(f => pc >= f.address && pc < f.end);
    for (let i = 0; i < starts.length - 1; i++) {
        const start = starts[i], end = starts[i + 1];
        assert.equal(owner(start)?.address, start, `start 0x${start.toString(16)}`);
        assert.equal(owner(start)?.end, end, `end for 0x${start.toString(16)}`);
        assert.equal(owner(end - 4)?.address, start, "final instruction belongs to this fragment");
        assert.equal(owner(end)?.address, end, "next fragment owns its start");
    }
});

test("home-menu translation does not credit adjacent item helpers", { skip: !hasDisc }, () => {
    const run = runScreen(loadSpecs().find(s => s.module === "pro/stitshop"), { frames: 20 });
    const registry = JSON.parse(readFileSync(join(repoRoot, "data/translated_functions.json"), "utf8"));
    for (const address of [0x8001355c, 0x80013584, 0x800135b8]) {
        const row = run.residentExecuted.find(f => f.address === address);
        assert.ok(row, `own executed row for 0x${address.toString(16)}`);
        const exact = registry.some(r => r.module === "exe/fns" && Number(r.address) === address);
        assert.equal(row.status, exact ? "translated" : "native");
    }
    assert.equal(run.traps.length, 0);
    assert.deepEqual(run.unmapped, []);
});

test("translated-function registry names an existing port and oracle for each address", () => {
    const registry = JSON.parse(readFileSync(join(repoRoot, "data/translated_functions.json"), "utf8"));
    assert.ok(Array.isArray(registry), "registry must be a list of entries");
    assert.ok(registry.length >= 1, "registry must not be empty");
    for (const e of registry) {
        assert.match(e.address, /^0x[0-9a-f]+$/i, `bad address ${e.address}`);
        const portFile = e.port.split("#")[0];
        assert.ok(existsSync(join(repoRoot, portFile)), `missing port file ${portFile}`);
        assert.ok(existsSync(join(repoRoot, e.oracle)), `missing oracle ${e.oracle}`);
        assert.ok(e.name && e.name.length > 0, `missing name for ${e.address}`);
        assert.ok(e.module === undefined || e.module.length > 0, `bad module for ${e.address}`);
    }
    // The same address in two overlays must be representable (every screen
    // overlay shares the 0x80082cb0 base).
    const collide = registry.filter((e) => e.address === "0x80085934");
    assert.ok(collide.length >= 2, "0x80085934 must carry both the shop and album translations");
    assert.deepEqual(
        collide.map((e) => e.module).sort(),
        ["pro/stcrdabm", "pro/stitshop"],
        "colliding entries must name their own modules",
    );
});
