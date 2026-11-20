import { shuffleJokeMenu, RAND_U16 } from "../vendor/engine.js";
import { BATTLE_UI_LAYOUT } from "../battle.js";

// Atlas source rects = PGFGTC00.BIN frame u,v,w,h (LBA 1109/1110). Cel 0xA is
// the 104×64 face bezel (frame 4); cel 0x22 is the command row (frames 1+2).
export const FIGHT_UI_CLIPS = Object.freeze({
  hpFrame: [104, 0, 96, 16],
  hpFrameAlt: [104, 16, 96, 16],
  angledFrame: [104, 32, 82, 16],
  square: [80, 128, 13, 13],
  portraitFrame: [0, 0, 104, 64],
  commandIcon: [24, 164, 16, 16],
  commandPlate: [104, 32, 84, 19],
});

export const BATTLE_COMMANDS = Object.freeze(["Fight", "Tech", "DV", "Tag", "Item", "Run"]);

const MENU_ITEMS = BATTLE_COMMANDS;

/** The shipped pro/fightstg command list's row count (config table 0x800A34CC). */
export const COMMAND_COUNT = 6;

export const COLS = 1;

// The battle TECH list (FIGHTSTG_F0x800967A0 — the TECH command's own six-row
// list; its build at fightstg.s:20332-:20470). A digivolved combatant contributes
// its current form's six learned halfwords with bit 14 (0x4000, "loaded")
// CLEARED (`li $t3, -0x4001` :20368-:20398): a form's own loaded word is not a
// loan. Every OTHER equipped form then lends the halfwords carrying 0x4000 WITH
// their flags (:20412-:20466), deduped by the 13-bit id, so the price rule
// (TL-010) charges the loan premium only for a borrowed technique — and the row
// palette (F0x80096314 :20090-:20100) draws those rows in colour row 4. While
// Blast is active (combatant +0x1a != 0) the current form's signature is marked
// or appended with 0x8000 (:20381-:20400). Rookie mode is the signature halfword
// alone, marked 0x8000.
//
// (FIGHTSTG_F0x80094f08's ctx+0xd4 list is a DIFFERENT list — the Digivolve
// panel's — and it keeps the current form's flags; the TECH menu never reads it.)
export function battleTechWords({
  ledger, currentId = 0, equippedForms, signatureTech = 0, blastSignature = 0,
} = {}) {
  const records = ledger ?? [];
  const current = records.find((record) => Number(record?.id) === Number(currentId));
  const words = current
    ? [...(current.techSlots ?? [])].map((w) => (Number(w) & 0xffff) & ~0x4000)
    : [(Number(signatureTech) & 0x1fff) | 0x8000];
  if (current && blastSignature) {
    const sig = Number(blastSignature) & 0x1fff;
    const at = words.findIndex((word) => (word & 0x1fff) === sig);
    // The mark rewrites the entry as masked|0x8000 (dropping its other flags);
    // an absent signature is appended with the flag.
    if (at >= 0) words[at] = ((words[at] & 0x1fff) | 0x8000) & 0xffff;
    else words.push((sig | 0x8000) & 0xffff);
  }
  const equipped = equippedForms ?? (current ? [currentId] : []);
  for (const formId of equipped) {
    if (Number(formId) === Number(currentId)) continue;
    const source = records.find((record) => Number(record?.id) === Number(formId));
    for (const raw of source?.techSlots ?? []) {
      const word = Number(raw) & 0xffff;
      if ((word & 0x4000) && !words.some((v) => (v & 0x1fff) === (word & 0x1fff)))
        words.push(word);
    }
  }
  return words.filter((word) => word !== 0); // an empty ledger slot is not a menu row
}

// STATUS-C004: when the active Digimon is confused, the command menu is replaced
// by the shuffled joke commands (built once per decision, cached on b.confusedMenu
// and cleared when the pick is committed). The pick affects gag flavor only;
// F0x800a1910 independently rolls whether confirmation becomes Attack or gag.
// The rows themselves are drawn by the shared pro/fightstg list (the joke owner
// F0x8009A898 on the joke config 0x800A3634), so this only decides WHAT the rows
// say and hands the shuffle to it.

/** The six shuffled joke rows for this decision, built once, or null. */
export function jokeMenuRows(b) {
  if (!b?.player?.ailments?.confuse) { b.confusedMenu = null; return null; }
  if (b.confusedMenu?.length !== 6) b.confusedMenu = shuffleJokeMenu(RAND_U16);
  return b.confusedMenu;
}

export function currentMenuItems(b) {
  const joke = jokeMenuRows(b);
  if (joke) return joke.map((j) => j.label);
  return MENU_ITEMS;
}

export const DV_GAUGE_MAX = 1000;

// Tag = message 0x38 ("Go for it!"), then FIGHTSTG_startEntrance(id, 0, weak) (entrance.c, menu.c:382): the
// camera, flash, PLAYER11 and model swap are the entrance program (engine FormChangeProgram.BLAST_REVERT, side 0).
export const TAG_PRESENTATION = Object.freeze({
  sequence: 0x38,
  outgoingSeconds: 0.6,
});

// Split the decoded clip-12 fullScript into single-actor stage chunks. The script never
// shows two of its actors at once (slot 1 = parent A, slot 2 = parent B, slot 3 = result),
// so one model swap per boundary reproduces it. Segment 2 splits at the op2 [2,2] that
// hides parent B: orb flight on the partner model, camera hold / white-out / motion-30
// reveal on the result model (this second half is exactly the previously shipped tail).
//
// A chunk boundary is a segment boundary, NOT the end of the presentation: chunk 4 is segment 3,
// the whole result reveal pose and Desperado volley, and it plays the SAME actor the chunk
// before it staged at the world origin with `op2 [3,3,0,0,0,0]`. So the slot's staged position
// has to survive the boundary — see ActorAnimator._move.
export function dnaClip12Chunks(segs, dna) {
  if (!Array.isArray(segs) || segs.length !== 5) return null;
  const s2 = segs[2];
  const cut = s2.findIndex((r) => r.op === 2 && (r.words?.[0] | 0) === 2 && (r.words?.[1] | 0) === 2);
  if (cut < 0) return null;
  // Runtime replay (2026-07-15, state-9, orbtrace/orb4 frames): each flight segment OPENS
  // with its parent model in close-up (op2 [1,slot] show + mode-3 teleport near the staging
  // camera), which then glides off as the 1005/1006 orb starburst takes over. The earlier
  // "parents stay outside the frustum / noShow" reading is FALSIFIED by those frames.
  return [
    { ops: segs[0],            model: dna.originalProfile.name, slot: 1 },
    { ops: segs[1],            model: dna.originalProfile.name, slot: 1 },
    { ops: s2.slice(0, cut + 1), model: dna.partnerName,        slot: 2 },
    { ops: s2.slice(cut + 1),  model: dna.resultProfile.name,   slot: 3, result: true },
    { ops: segs[3],            model: dna.resultProfile.name,   slot: 3, result: true },
    { ops: segs[4],            model: dna.originalProfile.name, slot: 1, show: true },
  ];
}

// The "L1" / "R1" page hints under an in-battle list window.
//
// `kind` and `clut` are the shared part, and they come off the original's own
// text-element factory. Every one of these hints is built by
// F0x8001AE38(layer 0x1005, 3, x, y) -- kind 3, the number face -- and then has
// its colour row set to 2 through method +0x138 = F0x8001a1f4,
// `sb $a1, 0xc0($a0)` (exe/fns.s:11132-11134, installed by the factory at
// exe/fns.s:12069-12070). The drawer's CLUT word is
// ((+0xC0 + +0xAE + glyph[+4]) << 6) | (((+0xAC + glyph[+3]) >> 4) & 0x3f)
// (exe/fns.s:10605-10621); the factory zeroes +0xAE (exe/fns.s:12119) and the
// kind-3 glyphs these two words use carry clut_y 0 in their record, so the row
// is exactly 2 -- the flat white of `uifont.json` cluts["3"].rows["2"], not the
// amber of row 0 the walker used to paint.
//
// Only the anchor is per list, because F0x8001AE38 takes x and y as arguments
// and each list's own widget builder passes its own:
//
//   TECH   L1 (26,159) R1 (128,159)  FIGHTSTG_F0x80096048  fightstg.s:19881,
//         :19892 and :19899, :19910  (the two +0x138 stores are the `li $a1,2`
//         in each jalr's delay slot)
//   ITEM   L1 (26,169) R1 (128,169)  FIGHTSTG_F0x8009563C  fightstg.s:19216,
//         :19227 and :19234, :19245
//   form   L1 (34,171) R1 (56,171)   FIGHTSTG_F0x8009492C  fightstg.s:18354,
//         :18365 and :18372, :18383
//
// The hints themselves are never hidden -- no list calls +0x144 on them -- so
// they print on a single page as well as on several. Only the arrow cels
// (0x1F / 0x20) are page-gated, and then only behind bit 4 of [0x8004DF98](),
// the same display counter the arrows blink on (FIGHTSTG_F0x80095E40,
// fightstg.s:19786-19810; FIGHTSTG_F0x8009543C, :19136-19150).
export function listPageHint(l1, r1) {
  return Object.freeze({ kind: 3, clut: 2, l1: Object.freeze(l1), r1: Object.freeze(r1) });
}

/**
 * Command-row label origin for row `index`: FIGHTSTG_F0x80093cf4 places the six
 * text widgets at (0x24, 0x6d + 19*index) on layer 0x1005 (claim
 * battle-command-window-labels-2026-08-19); the layer's +0x11c origin is (0,0),
 * so those are final screen coordinates. The row art's cel components already
 * sit at (16, 109+19i) and (32, 106+19i).
 */
export function commandLabelPos(index, C = BATTLE_UI_LAYOUT.commands) {
  return { x: C.boxX, y: C.y + (index | 0) * C.rowH };
}

export function normalizeDvGauge(value) {
  return Math.min(DV_GAUGE_MAX, Math.max(0, Math.trunc(Number(value) || 0)));
}
