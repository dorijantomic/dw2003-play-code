// How many of the 174 decoded opcodes the VM dispatches, counted honestly.
// An earlier ad-hoc version missed PHASE_BANNERS because that table is written
// on one line and the key regex was anchored to line starts — it under-reported
// by seven and nearly sent me to implement opcodes that were already done.
import { readFileSync } from "node:fs";
const R = "/home/dorij/ddw3-walker/";
const vm = readFileSync(R + "engine/systems/card-effect-vm.ts", "utf8");
const cb = readFileSync(R + "engine/systems/card-battle.ts", "utf8");
const reg = JSON.parse(readFileSync(R + "docs/research/card/cardgame-opcode-registry.json", "utf8"));
const all = Object.keys(reg.opcodes).map((k) => parseInt(k, 16)).sort((a, b) => a - b);

const ops = new Set();
const body = vm.slice(vm.indexOf("function execute("), vm.indexOf("const family = OPCODE_FAMILY[op];"));
for (const m of body.matchAll(/op === (0x[0-9a-f]+)/g)) ops.add(parseInt(m[1], 16));
for (const m of body.matchAll(/op >= (0x[0-9a-f]+) && op <= (0x[0-9a-f]+)/g))
  for (let o = parseInt(m[1], 16); o <= parseInt(m[2], 16); o++) ops.add(o);
const TABLES = ["PILE_SWEEPS", "BOARD_SWEEPS", "BOARD_SELECTORS", "TARGET_PROMPTS",
  "BOARD_SLOT_PROMPTS", "CARD_PICKERS", "PILE_PICKERS", "STAT_OPS", "ENERGY_OPS",
  "PHASE_BANNERS", "DELEGATED_OPS"];
for (const t of TABLES) {
  const i = vm.indexOf(t + ":") >= 0 ? vm.indexOf(t + ":") : vm.indexOf(t + " ");
  if (i < 0) continue;
  const j = vm.indexOf("= {", i), k = vm.indexOf("\n};", j);
  if (j < 0 || k < 0) continue;
  // NOT anchored to line starts: one-line tables are legal and were being missed.
  for (const m of vm.slice(j, k).matchAll(/(0x[0-9a-f]+)\s*:/g)) ops.add(parseInt(m[1], 16));
}
{
  const j = cb.indexOf("({", cb.indexOf("SUMMON_OPCODE_CARDS")), k = cb.indexOf("});", j);
  for (const m of cb.slice(j, k).matchAll(/(0x[0-9a-f]+)\s*:/g)) ops.add(parseInt(m[1], 16));
}
const hit = all.filter((o) => ops.has(o));
const miss = all.filter((o) => !ops.has(o));
const hex = (n) => "0x" + n.toString(16).toUpperCase().padStart(2, "0");
console.log(`dispatched ${hit.length} of ${all.length}   missing ${miss.length}`);
console.log(miss.map(hex).join(" "));
