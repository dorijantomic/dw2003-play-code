// Keeps the battle 3-D faithfulness table honest.
//
// The execution-forbidden audit answers "does the ordinary battle route reach
// the interpreter?" — it does not ask whether a mechanism is a PORT of the disc
// or hand-written browser code. This checker encodes that second question for
// the mechanisms of the 3-D layer (docs/research/battle/
// battle-3d-faithfulness-2026-10-06.md) and fails when a row drifts:
//
//   - a row that claims PORTED (or a MIXED row's ported half) must have its
//     named symbols imported by the ordinary route out of ../vendor/engine.js,
//     and the engine module must export them;
//   - a BROWSER-AUTHORED row's named "unconsumed port" symbols must NOT be
//     imported by the route (wiring the port in flips the row honestly);
//   - every cited browser file must exist.
//
// RECONCILIATION with tools/execution_forbidden_audit.mjs: the audit is the
// single AUTHORITY for what the ordinary route imports (it walks the route's
// static import graph and reports a per-PORT consumed column at module level).
// This checker imports that derivation instead of re-parsing the imports, so the
// two can never disagree about the same mechanism: the audit says whether a port
// MODULE is consumed; this checker says whether a named SYMBOL of a row is. Each
// row's module must also be one the audit tracks, so the two cover the same set.
//
// Usage: node tools/check_battle3d_faithfulness.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { routeEngineSymbols as auditRouteEngineSymbols, SURFACES } from "./execution_forbidden_audit.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The engine symbols the ordinary battle route imports, derived by the AUDIT.
 * Returned shape: { syms: Set, files: string[] }.
 */
export async function routeEngineSymbols() {
  // Derive from the SAME route entry the audit's battle-3d surface names, so the
  // two checkers can never walk different route files. Since 2026-10-06 that is
  // three entries (web/battle3d.js plus web/battle.js and battlehud-translated.js,
  // which consume the cel draw, enemy-id and steal-roll ports).
  const surface = SURFACES.find((s) => s.id === "battle-3d");
  return auditRouteEngineSymbols(surface?.routeEntry ?? ["web/battle3d.js"]);
}

/**
 * Rows of the faithfulness table. `port` = the engine module + symbols the
 * ordinary route must import; `browser` = a web file:line that must exist;
 * `unconsumed` = an engine module whose symbols must NOT be imported.
 */
export const ROWS = [
  { id: "display-list-loop", cls: "BROWSER-AUTHORED",
    browser: ["web/battle3d.js:537", "web/battle3d.js:351", "web/fight/proj-layers.js"],
    unconsumed: { module: "engine/dw3/battle-mesh.ts", symbols: ["packLayerPacketA", "packLayerPacketB"] } },
  { id: "layer-building", cls: "BROWSER-AUTHORED",
    browser: ["web/fight/proj-layers.js:280", "web/battle3d.js:211"],
    unconsumed: { module: "engine/dw3/battle-mesh.ts", symbols: ["composeLayer", "createLayerFigure", "layerFrameKind", "layerVisible"] } },
  { id: "projection", cls: "BROWSER-AUTHORED",
    browser: ["web/battle3d.js:76", "web/fight/battle-camera.js:58"],
    unconsumed: { module: "engine/dw3/battle-mesh.ts", symbols: ["projectMeshNode"] } },
  { id: "gte-screen-bounds", cls: "BROWSER-AUTHORED",
    browser: ["web/battle3d.js:2559"],
    unconsumed: { module: "engine/dw3/battle-mesh.ts", symbols: ["onScreenTest"] } },
  { id: "camera-shots-presets", cls: "CAPTURE-FITTED",
    browser: ["web/battle3d.js:122", "web/fight/battle-camera.js:27"],
    unconsumed: { module: "engine/dw3/battle-camera.ts", symbols: ["lookAtView"] } },
  { id: "texture-patches", cls: "PORTED",
    port: { module: "engine/dw3/battle-presentation.ts", symbols: ["eyePatchVariant", "blinkVariant", "patchCopyRect"] },
    browser: ["web/fight/texture-patch-animator.js:15"] },
  { id: "smdldata-placement", cls: "PORTED",
    port: { module: "engine/dw3/battle-presentation.ts", symbols: ["arenaPlacement"] },
    browser: ["web/battle3d.js:948"],
    unconsumed: { module: "engine/dw3/battle-presentation.ts", symbols: ["SmdldataTable"] } },
  { id: "effect-sprites", cls: "PORTED",
    port: { module: "engine/dw3/battle-effects.ts", symbols: ["stepEffectSprite", "effectDrawPlan"] },
    browser: ["web/fight/effect-player.js:180"] },
  { id: "idle-director", cls: "PORTED",
    port: { module: "engine/dw3/battle-idle-director.ts", symbols: ["createIdleDirector", "idleDirectorTick"] },
    browser: ["web/fight/battle-idle-director.js:15"] },
  { id: "actor-slots", cls: "PORTED",
    port: { module: "engine/dw3/battle-actor-animation.ts", symbols: ["animSlotMoveDelta", "resetAnimSlotLiveToHome"] },
    browser: ["web/fight/actor-animator.js:27"] },
  { id: "action-vm-opcode-bodies", cls: "PORTED",
    port: { module: "engine/dw3/battle-action-opcodes.ts", symbols: ["op1Handler", "op2Handler"] },
    browser: ["web/fight/action-vm.js:46"],
    unconsumed: { module: "engine/dw3/battle-action-dispatcher.ts", symbols: ["runDispatch"] } },
  { id: "slot-motion-sampler", cls: "PORTED",
    port: { module: "engine/dw3/battle-slot-motion.ts", symbols: ["rampCurve", "armSlotMotion", "stepSlotMotion"] },
    browser: ["web/fight/action-vm.js:43"] },
  { id: "timeline-sampler", cls: "PORTED",
    port: { module: "engine/dw3/battle-timeline-sampler.ts", symbols: ["frameTableFromEntries", "sampleTick"] },
    browser: ["web/fight/timeline-player.js:16"] },
  { id: "projectile-registry-ctor", cls: "PORTED",
    port: { module: "engine/dw3/battle-projectile.ts", symbols: ["newProjectileFlight", "projectileRegistryFromIds"] },
    browser: ["web/fight/effect-player.js:128"] },
  { id: "hit-face-box", cls: "PORTED",
    port: { module: "engine/dw3/battle-camera.ts", symbols: ["faceBoxLookAt", "faceBoxTick", "faceBoxSpawn"] },
    browser: ["web/fight/battle-camera.js:14"] },
];

export function moduleExportsSymbol(rel, symbol) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${symbol}\\b`);
  if (re.test(src)) return true;
  // export { a, b as c } form
  const brace = /export\s*\{([\s\S]*?)\}\s*from/g;
  let m;
  while ((m = brace.exec(src))) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name === symbol) return true;
    }
  }
  return false;
}

export async function check() {
  const { syms, importingFiles } = await routeEngineSymbols();
  const failures = [];
  // Reconciliation: every module a row names must be one the audit's battle-3d
  // port list tracks, so the two checkers cover the same mechanisms and cannot
  // drift apart.
  const tracked = new Set(SURFACES.find((s) => s.id === "battle-3d").entry);
  for (const row of ROWS) {
    for (const named of [row.port, row.unconsumed].filter(Boolean)) {
      if (!tracked.has(named.module))
        failures.push(`${row.id}: ${named.module} is not in the audit's battle-3d port list; the two checkers would disagree`);
    }
    // 1. every cited browser file must exist
    for (const ref of row.browser ?? []) {
      const file = ref.split(":")[0];
      try { readFileSync(join(ROOT, file), "utf8"); }
      catch { failures.push(`${row.id}: browser file missing: ${file}`); }
    }
    // 2. a PORTED / MIXED-ported row must be consumed by the ordinary route
    if (row.port) {
      for (const symbol of row.port.symbols) {
        if (!syms.has(symbol))
          failures.push(`${row.id}: claims PORTED but the route never imports ${symbol} from ../vendor/engine.js (${row.port.module})`);
        if (!moduleExportsSymbol(row.port.module, symbol))
          failures.push(`${row.id}: ${row.port.module} does not export ${symbol}`);
      }
    }
    // 3. an unconsumed port must stay unconsumed (wiring it flips the row)
    if (row.unconsumed) {
      for (const symbol of row.unconsumed.symbols) {
        if (syms.has(symbol))
          failures.push(`${row.id}: row is classed ${row.cls}, but the route now imports ${symbol} from ${row.unconsumed.module} — update the row`);
      }
    }
  }
  return { failures, routeFiles: importingFiles, routeSymbolCount: syms.size };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { failures, routeFiles, routeSymbolCount } = await check();
  if (failures.length) {
    for (const f of failures) console.error(`FAIL ${f}`);
    process.exit(1);
  }
  console.log(
    `battle-3d faithfulness: ${ROWS.length} mechanisms match their class; ` +
    `${routeFiles.length} ordinary-route files import ${routeSymbolCount} engine symbols ` +
    `(derived by the execution-forbidden audit). ` +
    `Every PORTED row is consumed; every browser-authored row's port stays unconsumed.`
  );
}
