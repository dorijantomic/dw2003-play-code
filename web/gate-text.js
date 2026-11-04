// web/gate-text.js
//
// The plain-words renderer for a banked flag predicate — the shared half of the NPC
// dialogue-state explorer and the in-game "why is this locked" explainer.
//
// get_flag (F0x800163b0) dispatches on bank = (id >> 8) & 0xfe with index = id & 0x1ff,
// so one {id, expected} pair can be a stored story bit, a story beat, a beat range, a
// party Charisma rung, one scalar of the route pair, or a command arm (battle, card duel,
// shop, lab, talk launcher, gym). This module says each one out loud and refuses to
// dress up a bank nobody has decoded: those stay "gate 0xNNNN".
//
// DOM-free on purpose: the same words are rendered in a lab page and in the game.
// Read-only on purpose: there is no setter here, and there is no id-to-value logic
// either — liveStateIndex takes a caller-supplied reader, exactly like the engine's
// pickDialogueState. The roster table is the only data file (op-0x30 beat ranges).
import rosterFile from "./assets/data/roster_predicate_table.json" with { type: "json" };

// The party-Charisma ladder D0x80048cf8 (engine/dw3/dw3-config.ts CHARISMA_THRESHOLDS).
// Kept here as well because this module also runs in the browser, where engine/*.ts does
// not exist; the test pins the two copies to each other.
export const CHARISMA_THRESHOLDS = [
  60, 150, 210, 285, 378, 492, 630, 795, 990, 1218, 1482, 1785, 2049, 2277, 2472,
];

// The seven get_flag/set_flag command arms (engine/systems/story-command-banks.ts). Their
// getter falls through to success for EITHER polarity, so their words are never negated.
const COMMAND_BANKS = new Set([0x74, 0x76, 0x78, 0x7a, 0x7c, 0x90, 0x94]);

// The disc's real stored banks (DW3_BANK_SCHEME storedBanks, minus 0x12 — an engine-only
// marker bank the disc does not have). Everything else in the byte range is a predicate
// bank or undecoded; guessing "story flag" for those would be wrong.
const STORED_BANKS = new Set([
  0x00, 0x02, 0x04, 0x06, 0x08, 0x0a, 0x0c, 0x0e, 0x10, 0x18, 0x1a, 0x1c, 0x20, 0x40,
]);

const ROSTER = new Map(rosterFile.records.map((rec) => [rec.key, rec]));

const hex = (id) => `0x${(id >>> 0).toString(16).padStart(4, "0")}`;

function commandWords(bank, index) {
  if (bank === 0x74) return `scripted battle slot ${index}`;
  if (bank === 0x76 || bank === 0x78) return "card duel";
  if (bank === 0x7a) return "shop/inn";      // item shop, card shop or inn — the desk index picks
  if (bank === 0x7c) return "lab/naming";    // Digimon Lab or the name-entry screen
  if (bank === 0x90) return `talk-launch bit ${index}`;
  return "gym";                              // 0x94
}

function bank70Words(id, want) {
  const rec = ROSTER.get(id & 0x1ff);
  if (!rec) return `gate ${hex(id)}`;        // no decoded record: never invent a meaning
  if ((rec.op & 0xf0) === 0x30) {
    // op 0x30, F0x80015b9c: lo <= story ordinal <= hi, both inclusive. The extractor
    // writes null for the disc's open-ended 0x63 upper byte, which is the end of the
    // story — read it as "end" rather than inventing a number.
    const span = `${rec.ordinal_lo}..${rec.ordinal_hi ?? "end"}`;
    return want ? `beat in ${span}` : `not in beat ${span}`;
  }
  // Every other op has its own decoded handler; the extractor's `kind` is the honest
  // description of it (party roster query, money compare, collection check, ...).
  return want ? rec.kind : `not ${rec.kind}`;
}

/**
 * One flag condition in plain words.
 * `expected` defaults to 1 — the game's get_flag default, and what an NPC spawn gate
 * means when the field is absent.
 */
export function gateWords({ id, expected = 1 } = {}) {
  const bank = (id >> 8) & 0xfe;
  const index = id & 0x1ff;
  const want = expected ? 1 : 0;

  if (COMMAND_BANKS.has(bank)) return commandWords(bank, index);
  if (STORED_BANKS.has(bank)) return `story flag ${hex(id)} is ${want ? "set" : "clear"}`;
  if (bank === 0x60) return want ? `beat ${index}` : `not beat ${index}`;
  if (bank === 0x70) return bank70Words(id, want);
  if (bank === 0x72) {
    const rung = CHARISMA_THRESHOLDS[index];
    if (rung === undefined) return `gate ${hex(id)}`;   // off the ladder: never satisfied
    return want ? `party Charisma >= ${rung}` : `party Charisma < ${rung}`;
  }
  if (bank === 0x7e) {
    // One predicate space over two scalars: index < 0x1e is the route key (index+1),
    // index >= 0x1e is the route companion (index-0x1d). F0x800160a8.
    const target = index < 0x1e
      ? `route key = ${index + 1}`
      : `route companion = ${index - 0x1d}`;
    return want ? target : `not ${target}`;
  }
  return `gate ${hex(id)}`;   // undecoded bank — raw hex, never a guess
}

/** A whole gate (an AND list) as one sentence; an empty gate always passes. */
export function gateListWords(list) {
  if (!list || !list.length) return "always";
  return list.map(gateWords).join(" and ");
}

/**
 * The first dialogue state whose gate passes against `getCond` (id -> 0 | 1 | null),
 * or null when none does. Mirrors engine/dw3/npc-manager.ts pickDialogueState exactly:
 * a command bank's condition always passes, and null (an unknown value) passes too —
 * the engine reads "unmodelled" as permissive, so a caller that wants certainty must
 * look at the gate's values itself (that is how the explorer prints "unknown").
 */
export function liveStateIndex(npc, getCond) {
  const states = npc?.dialogue_states;
  if (!states || !states.length) return null;
  for (let i = 0; i < states.length; i++) {
    let ok = true;
    for (const c of states[i].gate ?? []) {
      const value = getCond ? getCond(c.id) : null;
      if (!COMMAND_BANKS.has((c.id >>> 8) & 0xfe) && value !== null && value !== c.expected) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return null;
}
