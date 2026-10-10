// Savestate-anchored validation of the fight playback rebuild.
// Drives the REAL fight modules over the REAL anim.json and checks the per-tick frame stream against
// the two mid-attack savestate anchors mined 2026-06-21:
//   sstate1 basic     -> displayed frame 1330 (op2 table 14), FK err 0
//   sstate2 signature -> displayed frame 1164 (op2 table 52)
// The motion must (a) pass through its anchor frame, (b) run far longer than the old ~36-tick cutoff,
// and (c) return to idle (frame <=54) after it ends.
import fs from "fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const BASE = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const { ActorAnimator } = await import(`${BASE}/fight/actor-animator.js`);
const { FightCoordinator } = await import(`${BASE}/fight/fight-coordinator.js`);
const model = JSON.parse(fs.readFileSync(`${BASE}/assets/battle/models/m373rena/anim.json`, "utf8"));
const STEP = 2;                 // GLOBAL_SPEED (savestate-pinned)
const IDLE_MAX = 54;            // idle table = frames 0..54

function run(label, techId, anchor) {
  const player = new ActorAnimator(model), enemy = new ActorAnimator(model);
  const coord = new FightCoordinator(player, enemy);
  coord.attack(player, enemy, techId, {});
  const frames = [];
  let hitTick = -1, endTick = -1;
  for (let t = 1; t <= 600; t++) {
    coord.tick(STEP);
    frames.push(player.currentFrame());
    if (player.vm && player.vm.justHit && hitTick < 0) hitTick = t;
    if (endTick < 0 && !(player.vm && !player.vm.ended)) endTick = t;  // vm ended -> idle takes over
  }
  const reached = frames.some((f) => Math.abs(f - anchor) <= 5);
  const maxF = Math.max(...frames);
  const tailIdle = frames.slice(endTick, endTick + 10).every((f) => f <= IDLE_MAX);
  const actionLen = endTick > 0 ? endTick : 600;
  console.log(`\n=== ${label} (tech ${techId}) ===`);
  console.log(`  anchor frame ${anchor} reached?  ${reached ? "YES" : "NO"}   maxFrame=${maxF}`);
  console.log(`  action length: ${actionLen} ticks  (old cutoff was ~36)`);
  console.log(`  strike (justHit) at tick: ${hitTick}`);
  console.log(`  returns to idle after end? ${tailIdle ? "YES" : "NO"}  (frames after end: ${frames.slice(endTick, endTick+6).join(",")})`);
  // sparse frame trace
  const trace = [];
  let last = null;
  frames.forEach((f, i) => { if (f !== last) { trace.push(`${i+1}:${f}`); last = f; } });
  console.log(`  frame transitions: ${trace.slice(0, 40).join("  ")}${trace.length>40?" …":""}`);
  return reached && tailIdle && actionLen > 36;
}

const okBasic = run("BASIC vs Woodmon", 7, 1330);
const okSig   = run("SIGNATURE Diamond Storm", 59, 1164);
console.log(`\nRESULT: basic ${okBasic ? "PASS" : "FAIL"}, signature ${okSig ? "PASS" : "FAIL"}`);
process.exit(okBasic && okSig ? 0 : 1);
