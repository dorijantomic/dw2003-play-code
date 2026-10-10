// Which of the 170 opponent card folders can a player actually be dealt?
//
// A roaming tamer starts a duel by writing a flag in bank 0x76 or 0x78 when a dialogue
// state closes; the deck is `index * 2 + mode + 1`, mode 0 for bank 0x76 and 1 for 0x78
// (docs/research/ui/card-folder-editor-2026-08-14.md §10). So "is deck N reachable" is
// "can the player ever be shown the dialogue state that writes N's flag".
//
// That is not the same as "some state writes it". The NPC has to be placed (spawn flags),
// its gate has to pass, AND every earlier state of the same NPC has to fail, because
// pickDialogueState takes the FIRST state whose gate passes. This tool answers it exactly,
// by solving for a flag assignment rather than by sampling one:
//
//   * bank 0x72 is the party-Charisma ladder, and it is MONOTONE — flag 0x7200+n is
//     "total >= ladder[n]", so one integer (how many rungs are cleared, 0..15) fixes all
//     fifteen. The tool sweeps that integer and reports the Charisma window per deck.
//   * every other flag is a free boolean: "some state of a real playthrough sets it".
//     That is the optimistic reading on purpose. A deck unreachable even here is dead in
//     the shipped scene data, not merely behind progression.
//
// Modes:
//   --fresh        no solving at all: every flag reads 0 except flag 0 (the "we have met"
//                  bit), the Charisma ladder answering the swept rung. This is the census
//                  the card-folder-editor document published as 53 -> 98 of 170, and it is
//                  a FLOOR — it is what one brand-new save can see, not what exists.
//   (default)      the progression sweep described above: the ceiling.
//   --gate-only    the same fresh save, but asking only "does the launcher state's own
//                  gate pass", WITHOUT the first-match rule. This is how the 53 -> 98
//                  figure was originally measured, and it overcounts: a launcher whose
//                  gate passes is still never shown if an earlier state of the same NPC
//                  also passes. Kept so the older number is reproducible beside the
//                  corrected one.
//   --json <path>  also write the full per-deck record.
//
// Every assignment the solver finds is replayed through the shipped engine's
// pickDialogueState, so a claim of "reachable" is checked against the real selection
// rule rather than against this file's model of it.
//
// Usage: node tools/deck_reachability_census.mjs [--baseline] [--json out.json]

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pickDialogueState } from "../engine/dw3/npc-manager.ts";
import { CHARISMA_THRESHOLDS } from "../engine/dw3/dw3-config.ts";

const SCENE_DIR = "web/assets/scenes";
const CHARISMA_BANK = 0x72;
const RUNGS = CHARISMA_THRESHOLDS.length; // 15
const args = process.argv.slice(2);
const GATE_ONLY = args.includes("--gate-only");
const FRESH = args.includes("--fresh") || GATE_ONLY;
const jsonAt = args.indexOf("--json");
const JSON_OUT = jsonAt >= 0 ? args[jsonAt + 1] : null;

const bankOf = (id) => (id >> 8) & 0xff;

// ── the launcher census ─────────────────────────────────────────────────────
/** Every dialogue state in the shipped scenes that writes a duel-launch flag. */
function launchers() {
  const out = [];
  for (const file of readdirSync(SCENE_DIR).filter((f) => f.endsWith(".json")).sort()) {
    const scene = file.replace(/\.json$/, "");
    const data = JSON.parse(readFileSync(join(SCENE_DIR, file), "utf8"));
    (data.npcs ?? []).forEach((npc, npcIdx) => {
      (npc.dialogue_states ?? []).forEach((st, stateIdx) => {
        for (const c of st.on_close ?? []) {
          const bank = bankOf(c.id);
          if (bank !== 0x76 && bank !== 0x78) continue;
          if (c.expected !== 1) continue; // a clear is not a launch
          out.push({
            scene, npcIdx, npcId: npc.npc_id, npc, stateIdx,
            tamer: c.id & 0x1ff,
            deck: (c.id & 0x1ff) * 2 + (bank === 0x76 ? 0 : 1) + 1,
            bank,
          });
        }
      });
    });
  }
  return out;
}

// ── the solver ──────────────────────────────────────────────────────────────
// Constraints for "state k of this NPC is the one the player sees":
//   forced   — the NPC's spawn flags and state k's own gate must all hold;
//   clauses  — for every earlier state j, its gate must NOT hold, i.e. at least one of
//              its conditions is violated.
// Charisma conditions are constants once the cleared-rung count is fixed, so the rest is
// a small boolean satisfiability problem. DPLL with unit propagation settles it exactly.

/** true/false for a bank-0x72 condition when `cleared` rungs are satisfied. */
const charismaHolds = (cond, cleared) => ((cond.id & 0x1ff) < cleared) === (cond.expected === 1);

/** Solve for one cleared-rung count. Returns an assignment (Map id->0|1) or null. */
function solve(forced, clauses, cleared) {
  const assign = new Map();
  for (const c of forced) {
    if (bankOf(c.id) === CHARISMA_BANK) {
      if (!charismaHolds(c, cleared)) return null;
      continue;
    }
    const prev = assign.get(c.id);
    if (prev != null && prev !== c.expected) return null; // gate contradicts itself
    assign.set(c.id, c.expected);
  }
  // A clause is a list of literals {id, value}: "flag id reads value" violates that
  // earlier state's condition, so any one of them falsifies its gate.
  const lits = [];
  for (const gate of clauses) {
    if (!gate.length) return null;            // an ungated earlier state always wins
    const clause = [];
    let already = false;
    for (const c of gate) {
      if (bankOf(c.id) === CHARISMA_BANK) {
        if (!charismaHolds(c, cleared)) { already = true; break; }
        continue;                              // holds: cannot help falsify the gate
      }
      clause.push({ id: c.id, value: c.expected === 1 ? 0 : 1 });
    }
    if (already) continue;
    if (!clause.length) return null;           // every condition holds regardless
    lits.push(clause);
  }
  return dpll(lits, assign);
}

function dpll(clauses, assign) {
  const open = [];
  for (const clause of clauses) {
    let sat = false;
    const rest = [];
    for (const l of clause) {
      const v = assign.get(l.id);
      if (v === l.value) { sat = true; break; }
      if (v == null) rest.push(l);
    }
    if (sat) continue;
    if (!rest.length) return null;             // conflict
    open.push(rest);
  }
  if (!open.length) return assign;
  // unit propagation
  const unit = open.find((c) => c.length === 1);
  if (unit) {
    const next = new Map(assign);
    next.set(unit[0].id, unit[0].value);
    return dpll(open, next);
  }
  const pick = open[0][0];
  for (const value of [pick.value, 1 - pick.value]) {
    const next = new Map(assign);
    next.set(pick.id, value);
    const got = dpll(open, next);
    if (got) return got;
  }
  return null;
}

/** Replay an assignment through the shipped selection rule — the proof, not the model. */
function replaySelects(npc, stateIdx, assign, cleared) {
  const get = (id) => {
    if (bankOf(id) === CHARISMA_BANK) return (id & 0x1ff) < cleared ? 1 : 0;
    return assign.get(id) ?? 0;
  };
  const st = npc.dialogue_states[stateIdx];
  // --gate-only reproduces the older measurement, which asked whether the launcher's gate
  // passes and stopped there — no spawn flags, no first-match rule. Both lines below it
  // are the real rule.
  if (GATE_ONLY) return (st.gate ?? []).every((c) => get(c.id) === c.expected);
  for (const c of npc.spawn_flags ?? []) if (get(c.id) !== c.expected) return false;
  return pickDialogueState(npc, get) === st;
}

// ── the sweep ───────────────────────────────────────────────────────────────
const all = launchers();
const byDeck = new Map();
for (const L of all) {
  if (!byDeck.has(L.deck)) byDeck.set(L.deck, []);
  byDeck.get(L.deck).push(L);
}

const perDeck = [];
let replayFailures = 0;
for (let deck = 1; deck <= 170; deck++) {
  const sites = byDeck.get(deck) ?? [];
  const rec = { deck, launchers: sites.length, reachableAt: [], sites: [], verdict: "" };
  for (const L of sites) {
    const forced = [...(L.npc.spawn_flags ?? []), ...(L.npc.dialogue_states[L.stateIdx].gate ?? [])];
    const clauses = L.npc.dialogue_states.slice(0, L.stateIdx).map((s) => s.gate ?? []);
    const windows = [];
    for (let cleared = 0; cleared <= RUNGS; cleared++) {
      if (FRESH) {
        // No search: one fixed save state, asked directly. Flag 0 is the "we have met"
        // bit every tamer's first line sets, so a census that leaves it clear never gets
        // past anyone's introduction.
        if (replaySelects(L.npc, L.stateIdx, new Map([[0, 1]]), cleared)) windows.push(cleared);
        continue;
      }
      const assign = solve(forced, clauses, cleared);
      if (!assign) continue;
      if (!replaySelects(L.npc, L.stateIdx, assign, cleared)) { replayFailures++; continue; }
      windows.push(cleared);
    }
    rec.sites.push({
      scene: L.scene, npc: L.npcId, state: L.stateIdx, tamer: L.tamer, bank: L.bank,
      clearedRungs: windows,
    });
    for (const w of windows) if (!rec.reachableAt.includes(w)) rec.reachableAt.push(w);
  }
  rec.reachableAt.sort((a, b) => a - b);
  rec.verdict = sites.length === 0 ? "no-launcher"
    : rec.reachableAt.length ? "reachable"
    : FRESH ? "needs-progression" : "shadowed";
  perDeck.push(rec);
}

// ── the report ──────────────────────────────────────────────────────────────
const count = (v) => perDeck.filter((r) => r.verdict === v).length;
const reachable = perDeck.filter((r) => r.verdict === "reachable");
const mode = GATE_ONLY
  ? "gate-only on a fresh save — the OLD measurement, no first-match rule"
  : FRESH ? "fresh save (only the \"we have met\" bit set) — a FLOOR"
  : "progression (every non-Charisma flag freely assignable) — a CEILING";
console.log(`mode: ${mode}`);
console.log(`launcher states in the shipped scenes: ${all.length}`);
console.log(`decks 1..170 — reachable ${count("reachable")}, `
  + (FRESH ? `waiting on story flags this save has not set ${count("needs-progression")}, `
           : `blocked by an earlier dialogue state ${count("shadowed")}, `)
  + `no launcher anywhere ${count("no-launcher")}`);
console.log(`no launcher: ${perDeck.filter((r) => r.verdict === "no-launcher").map((r) => r.deck).join(", ") || "none"}`);
const shadowed = perDeck.filter((r) => r.verdict === "shadowed").map((r) => r.deck);
if (shadowed.length) console.log(`unreachable despite a launcher: ${shadowed.join(", ")}`);

// How many decks are on offer at each point of the Charisma climb.
const curve = [];
for (let cleared = 0; cleared <= RUNGS; cleared++) {
  const n = reachable.filter((r) => r.reachableAt.includes(cleared)).length;
  const floor = cleared === 0 ? 0 : CHARISMA_THRESHOLDS[cleared - 1];
  curve.push({ clearedRungs: cleared, charismaAtLeast: floor, decks: n });
}
console.log("\nCharisma >=   decks on offer");
for (const c of curve) console.log(`${String(c.charismaAtLeast).padStart(9)}   ${c.decks}`);
const peak = curve.reduce((a, b) => (b.decks > a.decks ? b : a));
console.log(`\npeak ${peak.decks} decks at Charisma >= ${peak.charismaAtLeast}; `
  + `${curve[RUNGS].decks} still on offer at the top of the ladder`);
if (replayFailures) console.log(`\nWARNING: ${replayFailures} solved assignments were rejected by pickDialogueState`);

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ mode, launchers: all.length, curve, decks: perDeck }, null, 1));
  console.log(`\nwrote ${JSON_OUT}`);
}
