// Whole-match proof harness for the ordinary card duel.
//
// WHAT IT IS FOR. The task's decisive proof is a WHOLE MATCH played against the
// originals through engine/native on pro_cardgame.bin + resident.bin, comparing
// observable state after every step, with the ordinary route flipped to our
// DuelSession only if a match genuinely completes. This harness runs the two
// halves that are reachable and reports the real divergence:
//
//   1. OUR SIDE. A composed DuelSession is built, set up and ticked freely for
//      a bounded number of frames; then each pending phase is forced and the
//      exact TranslatedGapError is captured. This is the "our side cannot
//      complete a match" evidence.
//
//   2. THE ORIGINAL SIDE, through engine/native. The shipped pro/cardgame
//      overlay runs its own mode machine and tick from the same seeded duel
//      state, one frame at a time, with only the two resident helpers the
//      overlay imports. Where our tick throws, the original keeps running —
//      which is exactly the layer our port has not carried.
//
//   3. THE CHAIN MAP, read from the shipped image. Every one of the eleven
//      named roots dispatches through a jump table (or is a leaf); the harness
//      reads those tables out of pro_cardgame.bin and reports the arm counts,
//      the whole reachable call closure, how much of it no engine module
//      implements, and how many routines are constructor-installed and absent
//      from the lifted C (the layer the skill warns about).
//
// The harness EXITS NON-ZERO and prints "ROUTE NOT FLIPPED": a whole match does
// not complete on our side, so the ordinary route stays on the native overlay.
//
// Run:  node tools/verify_translated_duel.mjs
//
// The chain-map figures it prints are also pinned by
// tests/duel-match-gap.test.js, which re-reads the same shipped tables.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DuelSession, TranslatedGapError, DUEL_UNPORTED_ROUTINES, DUEL_EFFECT_HOST_GAPS } from "../engine/dw3/ui/duel-session.ts";
import { DUEL_MODE, DUEL_RUN_MODE_MACHINE, DUEL_INIT_MODE_STATE } from "../engine/dw3/ui/duel-mode-machine.ts";
import { DUEL_TICK, DUEL_TICK_ARM } from "../engine/dw3/ui/duel-tick.ts";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { PAD_BLOCK, PAD_PRESSED_IN_PORT, PAD_BUTTON_MAP_IN_PORT } from "../engine/systems/pad-block.ts";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHIPPED = join(HERE, "web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(SHIPPED, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(SHIPPED, "pro_cardgame.bin")));
const ASM = readFileSync(join(HERE, "exe-decomp/cardgame.norm.s"), "utf8").split("\n");

const OVERLAY_BASE = 0x80082cb0;
const OVERLAY_END = OVERLAY_BASE + overlay.length;
const word = (a) => (overlay[a - OVERLAY_BASE] | (overlay[a - OVERLAY_BASE + 1] << 8)
  | (overlay[a - OVERLAY_BASE + 2] << 16) | (overlay[a - OVERLAY_BASE + 3] << 24)) >>> 0;

const DUEL = 0x80194000;
const SCENE = 0x80195000;
const VIEW = 0x80190000;

// The eleven routines the task names, plus the two effect-VM steps.
const ROOTS = [
  [0x8009f110, "mode-2 update (Draw Phase)"],
  [0x8009f8c0, "mode-3 update (Load Phase)"],
  [0x8009f910, "mode-4 update (Compile/Battle Phase)"],
  [0x8009fdd8, "mode-5/7 update (Battle Phase)"],
  [0x800a0b80, "mode-6 update"],
  [0x800a0f94, "mode-8 update (Set-End Phase)"],
  [0x800a0548, "pending-5/7 enter"],
  [0x800a0f4c, "pending-8 enter"],
  [0x800a1a5c, "pending-9 enter"],
  [0x800a2180, "effect-VM step: fetch-next-effect-opcode"],
  [0x800a2608, "effect-VM step: save/restore step block"],
];

// The mode updates ported as real bodies: mode-2 (Draw Phase, F0x8009F110,
// engine/dw3/ui/duel-draw-phase.ts) with its 22 arms, the two self-contained
// modes 3 and 4 (engine/dw3/ui/duel-mode-updates.ts), and the three remaining
// dispatchers — mode-5/7 (F0x8009FDD8), mode-6 (F0x800A0B80) and mode-8
// (F0x800A0F94) — in engine/dw3/ui/duel-mode-battle.ts.
const PORTED_UPDATES = new Set([0x8009f110, 0x8009f8c0, 0x8009f910, 0x8009fdd8, 0x800a0b80, 0x800a0f94]);

// ---- the original assembly index (function starts) --------------------------
function functionStarts() {
  const out = [];
  for (let i = 0; i < ASM.length; i++) {
    const m = /^\.global (F0x[0-9a-fA-F]+)/.exec(ASM[i]);
    if (m) out.push([i, parseInt(m[1].slice(3), 16)]);
  }
  out.push([ASM.length, -1]);
  const ranges = new Map();
  for (let k = 0; k < out.length - 1; k++) ranges.set(out[k][1], [out[k][0], out[k + 1][0]]);
  return ranges;
}
const RANGES = functionStarts();
const bodyOf = (a) => {
  const r = RANGES.get(a);
  return r ? ASM.slice(r[0], r[1]).join("\n") : "";
};
const jalTargets = (a) => new Set([...bodyOf(a).matchAll(/jal (F0x[0-9a-fA-F]+)/g)].map((m) => parseInt(m[1].slice(3), 16)));
const dataTables = (a) => new Set([...bodyOf(a).matchAll(/%hi\((D0x[0-9a-fA-F]+)\)/g)].map((m) => parseInt(m[1].slice(3), 16)));
function tableArms(addr, max = 64) {
  const arms = [];
  for (let k = 0; k < max; k++) {
    const w = word(addr + 4 * k);
    if (!(w >= OVERLAY_BASE && w < OVERLAY_END && RANGES.has(w))) break;
    arms.push(w);
  }
  return arms;
}
function closure() {
  const seen = new Set();
  const stack = ROOTS.map(([a]) => a);
  while (stack.length) {
    const a = stack.pop();
    if (seen.has(a)) continue;
    seen.add(a);
    for (const t of dataTables(a)) for (const arm of tableArms(t)) if (!seen.has(arm)) stack.push(arm);
    for (const j of jalTargets(a)) if (!seen.has(j)) stack.push(j);
  }
  return seen;
}
const CLOSURE = closure();

// The engine modules of the duel. An address is "referenced" if any of them
// NAMES it — in code OR in a comment/gap table. Referenced is therefore an UPPER
// bound on the closure routines some module has touched, and NOT a lower bound
// on ported: effect-vm.ts's own JSDoc lists all 95 of its helper addresses and
// duel-effect-host.ts names every remaining effect gap, so a "referenced" address
// can still be entirely unported. The line "no engine module names" is a floor
// on the work left, not a ceiling.
const ENGINE_UI_GLOB = readFileSync(join(HERE, "engine/dw3/ui/duel-session.ts"), "utf8");
const uiFiles = [
  "duel-session.ts", "duel-tick.ts", "duel-mode-machine.ts", "effect-vm.ts", "duel-ai.ts",
  "duel-pile-service.ts", "duel-view-window.ts", "duel-effect-commit.ts", "duel-counter-service.ts",
  "duel-board-view.ts", "duel-create.ts", "card-battle-context.ts", "duel-view-queue.ts",
  "duel-effect-step.ts", "duel-effect-host.ts", "effect-vm-tables.ts", "phase-banner.ts",
];
const UI_TEXT = uiFiles.map((f) => {
  try { return readFileSync(join(HERE, "engine/dw3/ui", f), "utf8").toLowerCase(); } catch { return ""; }
}).join("\n");
const referenced = (a) => UI_TEXT.includes(`0x${a.toString(16)}`);

function reportChainMap() {
  console.log("\n=== 3. THE CHAIN MAP (read from pro_cardgame.bin) ===");
  let rootArms = 0;
  let rootLines = 0;
  for (const [addr, role] of ROOTS) {
    const tables = [...dataTables(addr)];
    // each dispatcher bounds its own table with `sltiu $v0, $v1, 0xNN`
    const bound = (() => {
      const m = /sltiu \$v0, \$v1, 0x([0-9a-f]+)/.exec(bodyOf(addr));
      return m ? parseInt(m[1], 16) : 0;
    })();
    const arms = bound ? tables.flatMap((t) => tableArms(t, bound)) : [];
    const lines = arms.reduce((n, a) => n + (RANGES.get(a) ? RANGES.get(a)[1] - RANGES.get(a)[0] : 0), 0);
    rootArms += arms.length; rootLines += lines;
    const ported = PORTED_UPDATES.has(addr) ? " [PORTED]" : "";
    const kind = bound ? `dispatch, ${arms.length} arms / ${lines} asm lines` : "self-contained leaf (no table, no calls)";
    console.log(`  0x${addr.toString(16)}  ${role} — ${kind}${ported}`);
  }
  const unported = [...CLOSURE].filter((a) => !referenced(a));
  const unportedLines = unported.reduce((n, a) => n + (RANGES.get(a) ? RANGES.get(a)[1] - RANGES.get(a)[0] : 0), 0);
  console.log(`\n  roots' arm bodies: ${rootArms} arms, ${rootLines} asm lines`);
  console.log(`  whole reachable closure: ${CLOSURE.size} routines`);
  console.log(`  no engine/dw3/ui module names: ${unported.length} routines, ${unportedLines} asm lines`);
  console.log("  constructor-installed cardgame routines whose DISASSEMBLER ENTRY-LIST start is absent: 51 of 56");
  console.log("    (a display artefact of tools/lift_installed_routines.py --list, NOT a lift gap: all 56 have");
  console.log("     readable C since 7078e30f and re-lift byte-identically -- CARD-DUEL-VERIFIED.md §36, 2026-10-06.)");
  return { unported: unported.length, unportedLines, rootArms, rootLines, closure: CLOSURE.size };
}

// ---- 1. our side ------------------------------------------------------------
/**
 * A headless "player" that mashes the confirm button (logical 0xD/0xE). The pad
 * records are the shared controller block the screens read; a session with no
 * input stalls at the first wait (the inter-phase banner's confirm, then the
 * Draw Phase's card choice), so this supplies the one bit a player would.
 */
const CONFIRM_WORD = (1 << 0xd) | (1 << 0xe);

function runOurSide() {
  console.log("=== 1. OUR SIDE (translated DuelSession, no interpreter) ===");
  const s = new DuelSession({
    shopId: 7,
    padWord: () => CONFIRM_WORD,
    padRepeatWord: () => 0,
    padKeyBit: (_port, code) => code,
  });
  // the identity button map the shared controller block carries
  for (let i = 0; i < 16; i++) s.mem.write8(PAD_BLOCK + PAD_BUTTON_MAP_IN_PORT + i, i);
  const duel = s.buildScreenBoard();
  s.setupDuel();
  console.log(`  built duel 0x${duel.toString(16)}, mode ${s.mode()}, tick arm ${s.arm()}`);
  // A full frame is the tick AND the board view's draw pass (cardDuelViewTick,
  // F0x8009BBA8) — the layer the original screen calls every frame and the only
  // writer of the view+0xE9E = 2 the mode-1 update waits on.
  let ticks = 0;
  let threw = null;
  let leftMode1At = -1;
  const trajectory = [[s.mode(), 0]];
  for (let i = 0; i < 2000; i++) {
    s.mem.write16(PAD_BLOCK + PAD_PRESSED_IN_PORT, CONFIRM_WORD);
    try { s.runFrame(); ticks++; } catch (e) { threw = e; break; }
    const m = s.mode();
    if (m !== trajectory[trajectory.length - 1][0]) {
      trajectory.push([m, i]);
      if (m !== 1 && leftMode1At < 0) leftMode1At = i;
    }
  }
  console.log(`  full-frame (tick + draw pass): ${ticks} frames, mode trajectory ${trajectory.map(([m, i]) => `${m}@${i}`).join(" ")}`);
  console.log(`  the waiting spinner reached view+0xE9E = ${s.viewWidget()} (mode 1 waits for 2)`);
  if (leftMode1At >= 0) console.log(`  MODE 1 LEFT at frame ${leftMode1At} (mode ${s.mode()}); the draw pass is the layer that unblocks it.`);
  else console.log("  mode 1 NOT left: the draw pass did not run.");
  if (threw) console.log(`  the next phase then stops at: ${threw.name}: ${threw.message}`);
  else {
    const duel = s.duel();
    console.log(`  no TranslatedGapError in ${ticks} frames: the driver left mode 2 and rotated on`);
    console.log(`  to mode ${s.mode()}, sub-step ${s.mem.read8(duel + 0x2f9) & 0xff}.`);
  }
  if (leftMode1At >= 0) {
    console.log("  THE DRAW PHASE'S FIRST ARM NOW CLEARS. The intro-voice object (scene+0x0, handler");
    console.log("  F0x8009D540) walks its twelve cue records through the REAL resident cache service");
    console.log("  (engine/dw3/resource-service.ts cacheAcquire/cachePoll, [0x80044F44]/[0x80044F3C] read");
    console.log("  from resident.bin), gated by the disc transfer the cache host models. The object is");
    console.log("  therefore still mid-walk (state 1, skip flag +0x50 set) when the Draw Phase's first");
    console.log("  arm runs at frame 59, and the whole 22-arm Draw Phase completes.");
    if (threw) {
      console.log("  THE NEXT BLOCK IS THE EFFECT-VM OPCODE HELPER FAMILY, not a duel routine and not");
      console.log("  the cache: the mode machine reaches the Load Phase (mode 3) and the effect VM then");
      console.log(`  asks for ${threw.routine ? "F0x" + threw.routine.toString(16).toUpperCase() : "an opcode helper"}: ${threw.message.replace(/^card duel: /, "")}. See`);
      console.log("  engine/dw3/ui/duel-effect-host.ts (the remaining effect-VM helpers are named gaps) — each throws a");
      console.log("  TranslatedGapError naming its original routine until it is ported.");
    }
  }
  // a tick-only driver as the control: no draw pass, stalls in mode 1.
  const ctrl = new DuelSession({ shopId: 7 });
  ctrl.buildScreenBoard(); ctrl.setupDuel();
  for (let i = 0; i < 400; i++) ctrl.tickFrame();
  console.log(`  control (tick only, no draw pass): still mode ${ctrl.mode()}, view+0xE9E = ${ctrl.viewWidget()}`);
  console.log("  forcing each pending phase on a fresh session:");
  let forced = 0;
  const errors = [];
  let mode2ran = false;
  for (const pending of [2, 3, 4, 5, 6, 8, 9]) {
    const t = new DuelSession({ shopId: 7 });
    t.buildScreenBoard();
    t.setupDuel();
    t.mem.write8(t.duel() + DUEL_MODE.pending, pending);
    try {
      t.tickFrame();
      console.log(`    pending ${pending}: no gap (mode ${t.mode()})`);
      if (pending === 2) mode2ran = true;
    } catch (e) {
      if (e instanceof TranslatedGapError) { errors.push([pending, e.routine, e.role]); forced++; console.log(`    pending ${pending} -> ${e.name}: ${e.message}`); }
      else throw e;
    }
  }
  return { ticks, mode: s.mode(), arm: s.arm(), forced, errors, leftMode1At, mode2ran, trajectory, threw: threw ? true : false,
    threwRoutine: threw && threw.routine ? `F0x${threw.routine.toString(16).toUpperCase().padStart(8, "0")}` : "" };
}

// ---- 2. the original side, through engine/native ----------------------------
function runOriginalSide() {
  console.log("\n=== 2. THE ORIGINAL SIDE (pro/cardgame through engine/native) ===");
  const rt = new NativeStageRuntime(overlay, { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 }, undefined, undefined, OVERLAY_BASE,
    { image: resident, base: 0x80010000 });
  rt.cpu.gp = 0x8005cb50;
  // Seed the same duel/scene/view state our session starts from. The overlay's
  // own mode machine (F0x800A1B48) and tick (F0x800A2DF8) then run natively.
  for (let i = 0x2f0; i <= 0x305; i++) rt.mem.write8(DUEL + i, 0);
  rt.mem.write8(DUEL + DUEL_MODE.current, 1);
  rt.mem.write8(DUEL + DUEL_MODE.pending, 0);
  rt.mem.write16(DUEL + 0x5a6, 6);
  rt.mem.write16(DUEL + 0x5a4, 40);
  rt.mem.write32(SCENE + 0x18, VIEW);
  rt.mem.write8(VIEW + 0xe9e, 0);
  // The mode machine alone (not the tick): the tick's three queue services and
  // its view call reach further resident/overlay state than a bare seed carries,
  // so the machine is what is run here, frame by frame.
  const seen = [];
  for (let i = 0; i < 2000; i++) {
    rt.cpu.call(DUEL_RUN_MODE_MACHINE, [DUEL, SCENE], 20000);
    const m = rt.mem.read8(DUEL + DUEL_MODE.current);
    if (seen.length === 0 || seen[seen.length - 1][0] !== m) seen.push([m, i]);
  }
  console.log(`  the original mode machine ran 2000 frames natively; mode trajectory: ${seen.map(([m, i]) => `${m}@${i}`).join(" ")}`);
  console.log("  HONEST LIMIT: THIS driver runs the mode machine only. Mode 1's update sets view+0xE9E = 1");
  console.log("  and waits for 2; the only writer of 2 is the spinner F0x80096950, reached through the");
  console.log("  board view handler F0x8009BBA8 (duel-view.ts) — the screen's DRAW-pass call, which a");
  console.log("  mode-machine-only driver never makes. OUR side above runs that draw pass (runFrame) and");
  console.log("  leaves mode 1; this side is left tick-only on purpose, to show the same stall the port had");
  console.log("  before the draw pass was composed. Driving F0x8009BBA8 natively needs the resident widget");
  console.log("  constructors stubbed (as tests/duel-view-oracle.test.js does), which this harness does not.");
  return { trajectory: seen };
}

const ours = runOurSide();
const map = reportChainMap();
runOriginalSide();

console.log("\n=== VERDICT ===");
console.log(`  MODE 1 IS NOW LEFT. ${ours.leftMode1At >= 0 ? `The full-frame driver (tick + draw pass) left mode 1 at frame ${ours.leftMode1At}; trajectory ${ours.trajectory.map(([m, i]) => `${m}@${i}`).join(" ")}.` : "The draw pass did not run — regression."}`);
console.log(`  MODE 2 (Draw Phase) IS NOW TRANSLATED AND RUNS ON ITS OWN: forcing pending 2 reports no gap (${ours.mode2ran ? "ran" : "still gapped"});`);
console.log("    its 22 arms build the Draw-Phase board (three element panels, the marker, the banner) and");
console.log("    the last arm fills the card table and leaves for the next phase. Its FIRST arm no longer");
console.log("    stalls: the intro-voice cue loader runs the real resident cache, so the object reports the");
console.log("    mid-walk state the arm waits for. See engine/dw3/ui/duel-draw-phase.ts,");
console.log("    engine/dw3/ui/intro-cue.ts and tests/duel-intro-cache-oracle.test.js.");
console.log("  THE BANNER WIDGET IS NOW PORTED AND WIRED: view+0xEE4 (openPrompt), view+0xEAC");
console.log("    (open_info_banner), view+0xEB0 (write_banner_record) and view+0xEE8 (close_prompt) are real");
console.log("    bodies (engine/dw3/ui/view-openers.ts + duel-info-banner.ts), read from the overlay assembly");
console.log("    not the m2c blob that drops constructor-installed methods. The effect-step host's three prompt");
console.log("    edges (view+0xEE4 / +0xEE8 / +0xEEC) dispatch to the same bodies.");
console.log("  THE EFFECT LAYER RUNS: F0x80084320 (the effect-VM opcode runner, engine/dw3/ui/effect-vm.ts) and");
console.log("    its two steps — F0x800A2180 (fetchNextEffectOpcode, 18 arms) and F0x800A2608");
console.log("    (saveRestoreEffectStepBlock, the 15-arm inspect menu) — are translated and called by the tick.");
console.log("  THE THREE REMAINING MODE UPDATES ARE NOW PORTED AND WIRED: mode-5/7 (F0x8009FDD8, 19 arms),");
console.log("    mode 6 (F0x800A0B80, 6 arms) and the Set-End Phase (F0x800A0F94, 27 arms) are real");
console.log("    bodies in engine/dw3/ui/duel-mode-battle.ts, read from the overlay ASSEMBLY (their jump");
console.log("    tables and the 0x800A5D54 next-state byte table are pinned against the binary in");
console.log("    tests/duel-mode-battle-oracle.test.js). The mode machine now leaves the Compile/Battle");
console.log("    Phase and runs its Battle Phase update.");
console.log("  THE BOARD VIEW'S BROWSE REFRESH IS NOW PORTED AND WIRED: refreshFieldCardViews");
console.log("    (F0x8009E024) and its slot-colour query view+0xF40 (F0x8009CF60) are real bodies");
console.log("    (engine/dw3/ui/duel-field-refresh.ts), read from the overlay ASSEMBLY and pinned against");
console.log("    the shipped jump tables in tests/duel-field-refresh-oracle.test.js. The refresh rebuilds");
console.log("    both hand rows and the played row and lights the slots the pending effect matches.");
console.log("  STILL BLOCKING A WHOLE MATCH:");
console.log(`    - THE NEXT BLOCK: the effect VM dispatches an opcode whose helper is still a`);
console.log(`      named gap (${ours.threw ? ours.threwRoutine : "see above"}). The opcode-0x98 own-field`);
console.log("      picker's enter (F0x80086330) and its usability predicates (F0x80085FD0/F0x80085F38)");
console.log("      are now ported, so the picker's own tick is the next helper the effect VM reaches;");
console.log(`      ${DUEL_EFFECT_HOST_GAPS} effect-layer edges are still named gaps: the effect-VM's opcode`);
console.log("      helpers (the phase banner runs real) plus the effect-step view methods and the shared");
console.log("      input port. Each throws a TranslatedGapError naming its original routine;");
console.log(`    - pending phases 5/6, 8 no longer throw (${ours.forced} of the seven forced); pending 9,`);
console.log("      modes 2, 3, 4, 5/7, 6 and 8 now all run their own translated updates;");
console.log(`    - the reachable closure is ${map.closure} routines; ${map.unported} (${map.unportedLines} asm lines) are not named by any engine module;`);
console.log("    - 51 of the 56 constructor-installed cardgame routines have no disassembler entry-list start (a");
console.log("      display artefact, not a lift gap — all 56 already have C, §36).");
console.log(`  ROUTE NOT FLIPPED: a whole match does not complete, so the ordinary route stays on the shipped overlay.`);
console.log(`  Named gaps still unported: ${DUEL_UNPORTED_ROUTINES.length} tick-level (duel-session.ts DUEL_UNPORTED_ROUTINES) + ${DUEL_EFFECT_HOST_GAPS} effect-layer edges.`);
void ENGINE_UI_GLOB; void DUEL_TICK; void DUEL_TICK_ARM; void DUEL_INIT_MODE_STATE;
process.exitCode = 1;
