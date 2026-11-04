// web/cardduel-net.js — the host-authoritative half of a two-human card duel.
//
// WHY THIS FILE EXISTS. The duel itself is already decoded and modelled in
// engine/systems/card-battle.ts: six phases (Start, Draw, Load, Summon,
// Compile, Battle), best of three sets (SETS_TO_WIN = 2), a set decided on the
// HP each side has left with a TIE GOING TO SIDE 1, six field slots, ten-card
// hands, forty-card folders and five S-Energy colours. All of that stays where
// it is — this module is the networking half. It gives two human players one
// shared duel: ONE host owns the DuelState and runs the engine's own rules for
// both sides, and every screen is rebuilt from the same snapshots.
//
// It is pure: no DOM, no fetch, no relay, no Math.random. `duel.player` is
// side 0 and `duel.opponent` side 1, and every random draw — the coin toss, the
// player pile's shuffle, the set-change shuffle, a card program's own dice —
// comes from the one seeded generator created here. Same seed + same commands
// = the same snapshot, on either screen.
//
// PROTOCOL (client -> host). Every command carries a per-side `seq`:
//   hello    { name }              announce a side, any time (display name)
//   folder   { cards: [40 ids] }   this side's folder; the duel starts when both are in
//   mulligan ()                    once per side, set 1, before any card is played:
//                                  the hand goes back into the deck, shuffle, draw 6 again
//   play     { slot }              Summon Phase: place the Digimon in hand slot `slot`
//                                  Load/Compile: play the Program card in that slot
//   pass     ()                    end my Summon turn / decline a Program turn
//   attack   ()                    Battle Phase ready check; both sides must send it
//   result   ()                    ask for the duel result so far
//
// The host answers every command with { ok, ... }. A refused command carries a
// `reason` and changes nothing; a retransmitted command (seq at or below the
// last one accepted from that side) is acknowledged with `duplicate: true` and
// changes nothing either, so a relay may resend freely. A reply that placed or
// played a card also carries `hand`, the acting side's own hand — the hand is
// private, so it is NOT in the public snapshot, which carries only its count.
//
// THE PHASES ARE THE ENGINE'S. Start, Draw and Battle are run whole by
// `stepPhase`. Load, Summon and Compile are played one turn at a time, using
// the engine's own turn machines (`beginProgramTurns` / `playProgramTurn` /
// `passProgramTurn`, `beginSummonTurns` / `takeSummonTurn` / `endSummonTurn`),
// which is exactly what the duel screen at web/cardduel.js drives. A phase is
// parked by the engine's own `duel.human` flag: it is set only for the frame
// that opens the turn machine, because the engine parks these phases when a
// screen drives them (card-battle.ts applyCeremonyOp cases 0x98/0x99 and 0x9A),
// and cleared at once — this host is not a screen.
//
// "attack" is the Battle Phase's ready check, not a per-card attack: the
// decoded duel fights whole phases. Both sides' boards are summed and both
// attacks land in one Battle Phase (cardduel-rules-2026-08-06.md §6), so the
// host waits for both players to press "Start Battle!" and then runs it.
//
// FACTS this module leans on, all from the decoded rules and the engine:
//   * best of three, first to two sets — SETS_TO_WIN = 2 (F0x800a0f94 case 0x11)
//   * the set goes to whoever has more total HP left; a tie goes to side 1
//     (state 0xA's `slt` is false on an equal pair) and shows the draw line
//   * 40-card folders, at most four copies of one card (F0x80085210)
//   * six cards drawn per set; six field slots; ten-card hands; 99 stat cap
//   * five S-Energy colours; a card drawn grants one point of its own colour
//   * two mirrored 0x4C HUD records, one per side, at 0x800A59D0
//     (cardduel-screen-decoded-2026-08-05.md §5) — the snapshot keeps both
//     sides in the same shape.
import {
  createDuel, stepPhase, phase,
  FOLDER_SIZE, MAX_COPIES_PER_FOLDER, HAND_LIMIT, TRASH_LIMIT, FIELD_LIMIT,
  ENERGY_COLOURS, STAT_CAP, DRAW_COUNT, SETS_TO_WIN,
  indexCatalog, energyIndex, settleStats, shuffleDeck,
  programTurnSide, playProgramTurn, passProgramTurn, pumpProgramTurns, tickProgramTurns,
  summonTurnSide, takeSummonTurn, endSummonTurn,
} from './vendor/engine.js';

/** The duel's rule sheet, straight from the engine — one object both screens
 *  can render without importing the 3MB bundle themselves. `setsToWin` is the
 *  decoded two (best of three), never three. */
export const DUEL_RULES = Object.freeze({
  folderSize: FOLDER_SIZE,
  maxCopies: MAX_COPIES_PER_FOLDER,
  handLimit: HAND_LIMIT,
  trashLimit: TRASH_LIMIT,
  fieldLimit: FIELD_LIMIT,
  drawCount: DRAW_COUNT,
  energyColours: ENERGY_COLOURS,
  statCap: STAT_CAP,
  setsToWin: SETS_TO_WIN,
});

/** The rules a host publishes: the engine's, plus the host-only mulligan
 *  allowance (a mulligan does not exist on the disc; it is this protocol's own
 *  nicety, so it is kept out of DUEL_RULES above). */
function makeRules(overrides) {
  const limit = overrides && Number.isInteger(overrides.mulliganPerSide)
    ? Math.max(0, overrides.mulliganPerSide) : 1;
  return Object.freeze({ ...DUEL_RULES, mulliganPerSide: limit });
}

/** The one seeded generator. mulberry32: 32-bit state, uniform floats, no
 *  dependency on Math.random, identical in node and in a browser. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const emptyEnergy = () => Object.fromEntries(ENERGY_COLOURS.map((colour) => [colour, 0]));
const refuse = (reason) => ({ ok: false, reason });

/** Which DuelSide is slot `side` of the table. */
function sideOf(duel, side) {
  return side === 0 ? duel.player : duel.opponent;
}

/** The reverse: a DuelSide's table slot, or null for no side at all. */
function sideIndex(duel, duelSide) {
  if (!duelSide) return null;
  return duelSide === duel.player ? 0 : 1;
}

/** Whose command the current phase is waiting for, or null when it is not
 *  waiting for one (Start, Draw, Battle and the lobby). */
function turnOf(host) {
  const duel = host.duel;
  if (!duel || duel.outcome) return null;
  const key = phase(duel).key;
  if (key === 'load' || key === 'compile') return sideIndex(duel, programTurnSide(duel));
  if (key === 'summon') return sideIndex(duel, summonTurnSide(duel));
  return null;
}

// ---------------------------------------------------------------------------
// Per-side snapshot
// ---------------------------------------------------------------------------

function sideSnapshot(host, side) {
  const duel = host.duel;
  const s = duel ? sideOf(duel, side) : null;
  return {
    name: host.names[side],
    hand: s ? s.hand.length : 0,
    deck: s ? s.deck.length : 0,
    trash: s ? s.trash.length : 0,
    // The six field slots: one entry per occupied slot, in placement order,
    // with the true and displayed pair the HUD draws. Rules.fieldLimit is 6.
    field: s
      ? s.field.map((f, slot) => ({
        slot, id: f.id, ap: f.ap, hp: f.hp, shownAp: f.shownAp, shownHp: f.shownHp,
      }))
      : [],
    energy: s ? { ...s.energy } : emptyEnergy(),
    sets: s ? s.score : 0,
    mulligans: host.mulligans[side],
  };
}

/** The public state of the duel. This is what both screens rebuild from: the
 *  phase and whose command it waits for, both sides' hands (counts), decks,
 *  trash, field slots, S-Energy and sets, the rule sheet, the result and the
 *  engine's own log. It carries no RNG state and no placement-instance
 *  counters, so the same seed and the same commands reproduce it exactly.
 *  A side's actual hand is handed back only to that side, in the reply to its
 *  own command. */
export function snapshot(host) {
  const duel = host.duel;
  return {
    seed: host.seed,
    status: host.status,
    phase: duel ? phase(duel).key : null,
    set: duel ? duel.set : 0,
    turn: turnOf(host),
    ready: [host.ready[0], host.ready[1]],
    rules: host.rules,
    // the engine's own word for the duel (side 0's view), null until decided
    outcome: duel ? duel.outcome : null,
    result: host.result,
    sides: [sideSnapshot(host, 0), sideSnapshot(host, 1)],
    log: duel ? duel.log.slice() : [],
    events: host.events.slice(),
  };
}

export function createDuelHost({
  seed = 1, folders = [], rules = {}, catalog = null, effects = new Map(), names = [],
} = {}) {
  if (!catalog || !Array.isArray(catalog.cards)) {
    throw new TypeError('createDuelHost needs a card catalog: { counts, cards } — '
      + 'the browser passes cardstate catalog(), tests pass their own records');
  }
  const seed32 = Number(seed) >>> 0;
  const host = {
    seed: seed32,
    rng: mulberry32(seed32),
    catalog,
    byId: indexCatalog(catalog),
    effects,
    rules: makeRules(rules),
    duel: null,
    folders: [null, null],
    names: [String(names[0] ?? 'Player 0').slice(0, 16), String(names[1] ?? 'Player 1').slice(0, 16)],
    status: 'lobby',
    seq: [0, 0],
    mulligans: [0, 0],
    ready: [false, false],
    events: [],
    result: null,
  };
  for (const side of [0, 1]) {
    const cards = folders[side];
    if (!cards) continue;
    const problem = folderProblem(host, cards);
    if (problem) throw new TypeError(`folder ${side} is not legal: ${problem}`);
    host.folders[side] = cards.slice();
  }
  maybeStart(host);
  return host;
}

// ---------------------------------------------------------------------------
// The duel loop
// ---------------------------------------------------------------------------

function settleBoth(duel) {
  // The host has no frame clock, so the displayed stat ramps (F0x8008E08C) are
  // settled at the end of every action the way the engine's own model-only
  // driver does: the true pair is already written, this walks the shown pair
  // to it and reaps a slot whose displayed HP has reached zero.
  settleStats(duel.player);
  settleStats(duel.opponent);
}

/** Run Start and Draw whole, park the next played phase, or wait for the Battle
 *  ready check. Called whenever the previous phase has finished. */
function advance(host) {
  const duel = host.duel;
  if (!duel) return;
  // Any Battle-Phase ready check is over once the phase has moved on.
  host.ready = [false, false];
  for (let guard = 0; guard < 12; guard++) {
    if (duel.outcome) { finish(host); return; }
    const key = phase(duel).key;
    if (key === 'start' || key === 'draw') {
      stepPhase(duel, undefined, host.rng, host.effects);
      continue;
    }
    if (key === 'battle') {
      return;
    }
    // Load, Summon and Compile are played turn by turn. `duel.human` is the
    // engine's own "a screen drives this phase" flag; it is raised just for
    // this call so the phase opens its turn machine and parks instead of
    // letting an agent play both hands, then cleared at once.
    duel.human = 0;
    stepPhase(duel, undefined, host.rng, host.effects);
    duel.human = null;
    settleBoth(duel);
    const opened = key === 'summon' ? !!duel.summonTurns : !!duel.programTurns;
    if (opened) return;
    // Nothing to drive (the phase ran straight through); the index moved on.
  }
}

/** Finish the parked Load / Compile / Summon phase: the engine's own resume
 *  arms clear the turn machine (0x12 / 0x9A) and move the phase index on. */
function finishPhase(host) {
  stepPhase(host.duel, undefined, host.rng, host.effects);
  advance(host);
}

/** The turn's play or decline has been made; resolve it as far as the engine
 *  will go without asking a human, then finish the phase if it ended.
 *  A card program always resolves with `interactive: false`, so it picks its
 *  own targets and pile entries — the same behaviour the headless duel has. */
function afterProgramAction(host) {
  const duel = host.duel;
  const t = duel.programTurns;
  if (!t) return;
  if (t.state === 'pass') {
    // State 0xB's twenty-tick delay is a screen clock; the host flushes it.
    tickProgramTurns(duel, t.passDelay);
  }
  if (t.state === 'resolve') pumpProgramTurns(duel, host.effects, host.rng);
  settleBoth(duel);
  if (t.done) finishPhase(host);
}

function finish(host) {
  const duel = host.duel;
  if (!duel || host.status === 'done') return;
  host.status = 'done';
  host.ready = [false, false];
  const won = duel.outcome === 'win';
  host.result = {
    outcome: duel.outcome,
    winner: won ? 0 : 1,
    sets: [duel.player.score, duel.opponent.score],
    sides: [
      { side: 0, name: duel.player.name, outcome: won ? 'win' : 'loss' },
      { side: 1, name: duel.opponent.name, outcome: won ? 'loss' : 'win' },
    ],
  };
  host.events.push('duel finished');
}

function maybeStart(host) {
  if (host.duel || !host.folders[0] || !host.folders[1]) return false;
  host.duel = createDuel(
    host.catalog, host.folders[0], host.folders[1], host.names[0], host.names[1],
  );
  host.status = 'playing';
  host.events.push('duel started');
  advance(host);
  return true;
}

// ---------------------------------------------------------------------------
// Lobby and card moves
// ---------------------------------------------------------------------------

/** Why this folder cannot be played, or null when it can. The two rules are
 *  the folder editor's own: exactly FOLDER_SIZE cards, and at most
 *  MAX_COPIES_PER_FOLDER of any one id (F0x80085210). Unknown ids are refused
 *  too — a card the catalog has no record for could never be summoned. */
function folderProblem(host, cards) {
  if (!Array.isArray(cards)) return 'folder_invalid';
  if (cards.length !== FOLDER_SIZE) return 'folder_size';
  const seen = new Map();
  for (const id of cards) {
    if (!Number.isInteger(id) || id <= 0) return 'folder_invalid';
    if (!host.byId.has(id)) return 'unknown_card';
    const n = (seen.get(id) ?? 0) + 1;
    if (n > MAX_COPIES_PER_FOLDER) return 'folder_copies';
    seen.set(id, n);
  }
  return null;
}

/** One card off the top of a deck into the hand (or the trash when the hand is
 *  full), granting one S-Energy of its own colour, capped at 99. This is
 *  `drawOne` in card-battle.ts; the browser bundle does not re-export that
 *  helper, so the host performs its two same steps here from the same engine
 *  pieces. Used only by the mulligan — the Draw Phase itself stays the engine's. */
function drawIntoHand(host, s) {
  if (!s.deck.length) return false;
  const id = s.deck.shift();
  const slot = s.deckSlots.length ? s.deckSlots.shift() : -1;
  if (s.hand.length < HAND_LIMIT) {
    s.hand.push(id);
    s.handSlots.push(slot ?? -1);
  } else {
    s.trash.push(id);
  }
  const rec = host.byId.get(id);
  const ei = rec ? energyIndex(rec.colour) : -1;
  if (ei >= 0) {
    const colour = ENERGY_COLOURS[ei];
    s.energy[colour] = Math.min(STAT_CAP, s.energy[colour] + 1);
  }
  return true;
}

function doHello(host, side, cmd) {
  const name = String(cmd.name ?? '').trim().slice(0, 16) || `Player ${side}`;
  host.names[side] = name;
  if (host.duel) sideOf(host.duel, side).name = name;
  host.events.push(`side ${side} is ${name}`);
  return { ok: true };
}

function doFolder(host, side, cmd) {
  if (host.duel) return refuse('already_started');
  const problem = folderProblem(host, cmd.cards);
  if (problem) return refuse(problem);
  host.folders[side] = cmd.cards.slice();
  host.events.push(`side ${side} sent a folder`);
  const started = maybeStart(host);
  return { ok: true, started };
}

function doMulligan(host, side) {
  const duel = host.duel;
  if (!duel || host.status !== 'playing') return refuse('no_duel');
  if (host.status === 'done' || duel.outcome) return refuse('duel_over');
  // A mulligan belongs to the opening hand of set 1 and to nothing after a
  // card has been played: once the phase has seen a play, the hand is in play.
  if (phase(duel).key !== 'load' || duel.set !== 1) return refuse('wrong_phase');
  if (host.mulligans[side] >= host.rules.mulliganPerSide) return refuse('mulligan_used');
  if (duel.playedThisPhase.length) return refuse('already_played');
  const s = sideOf(duel, side);
  // A drawn card granted one S-Energy of its colour (drawOne); a card handed
  // back must give that point back before the new hand grants its own, or a
  // mulligan would inflate the pool. Nothing has been spent yet — this is the
  // opening hand, before the first play.
  for (const id of s.hand) {
    const rec = duel.byId.get(id);
    const ei = rec ? energyIndex(rec.colour) : -1;
    if (ei < 0) continue;
    const colour = ENERGY_COLOURS[ei];
    s.energy[colour] = Math.max(0, s.energy[colour] - 1);
  }
  // Back on top of the pile, exactly as the set change returns a hand
  // (endSet): the cards land in front of the read cursor, then the pile is
  // shuffled with the engine's own forty-pass shuffle.
  s.deck.unshift(...s.hand);
  s.deckSlots.unshift(...s.handSlots);
  s.hand = [];
  s.handSlots = [];
  shuffleDeck(s, host.rng);
  for (let i = 0; i < DRAW_COUNT; i++) drawIntoHand(host, s);
  host.mulligans[side] += 1;
  host.events.push(`side ${side} mulliganed`);
  return { ok: true, hand: s.hand.slice() };
}

function doPlay(host, side, cmd) {
  const duel = host.duel;
  if (!duel) return refuse('no_duel');
  if (host.status === 'done' || duel.outcome) return refuse('duel_over');
  const slot = cmd.slot;
  if (!Number.isInteger(slot) || slot < 0) return refuse('bad_slot');
  const key = phase(duel).key;
  const s = sideOf(duel, side);
  if (key === 'summon') {
    if (summonTurnSide(duel) !== s) return refuse('not_your_turn');
    if (!takeSummonTurn(duel, s, slot)) return refuse('card_not_playable');
    settleBoth(duel);
    return { ok: true, hand: s.hand.slice() };
  }
  if (key === 'load' || key === 'compile') {
    if (programTurnSide(duel) !== s) return refuse('not_your_turn');
    if (!playProgramTurn(duel, s, slot, host.effects, host.rng)) return refuse('card_not_playable');
    afterProgramAction(host);
    return { ok: true, hand: s.hand.slice() };
  }
  return refuse('wrong_phase');
}

function doPass(host, side) {
  const duel = host.duel;
  if (!duel) return refuse('no_duel');
  if (host.status === 'done' || duel.outcome) return refuse('duel_over');
  const key = phase(duel).key;
  const s = sideOf(duel, side);
  if (key === 'summon') {
    if (summonTurnSide(duel) !== s) return refuse('not_your_turn');
    if (!endSummonTurn(duel, s)) return refuse('not_your_turn');
    settleBoth(duel);
    if (duel.summonTurns && duel.summonTurns.done) finishPhase(host);
    return { ok: true };
  }
  if (key === 'load' || key === 'compile') {
    if (programTurnSide(duel) !== s) return refuse('not_your_turn');
    if (!passProgramTurn(duel, s)) return refuse('not_your_turn');
    afterProgramAction(host);
    return { ok: true };
  }
  return refuse('wrong_phase');
}

function doAttack(host, side) {
  const duel = host.duel;
  if (!duel) return refuse('no_duel');
  if (host.status === 'done' || duel.outcome) return refuse('duel_over');
  if (phase(duel).key !== 'battle') return refuse('wrong_phase');
  host.ready[side] = true;
  if (!host.ready[0] || !host.ready[1]) return { ok: true, waiting: true };
  // Both sides pressed Start Battle! — the engine's whole Battle Phase runs.
  stepPhase(duel, undefined, host.rng, host.effects);
  if (duel.outcome) finish(host);
  else advance(host);
  return { ok: true };
}

function doResult(host) {
  return { ok: true, done: !!host.result, result: host.result ?? null };
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

/** Apply one client command for `side` (0 or 1). Mutates the host and returns
 *  the reply. Sequence numbers are per side: a command whose `seq` is at or
 *  below the last one accepted from that side has already been applied and is
 *  acknowledged without touching the duel. */
export function applyCommand(host, side, cmd) {
  if (!host || !Array.isArray(host.seq)) return refuse('bad_host');
  if (side !== 0 && side !== 1) return refuse('bad_side');
  if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') return refuse('bad_command');
  const seq = cmd.seq;
  if (!Number.isInteger(seq) || seq < 1) return refuse('bad_seq');
  // The duplicate check comes BEFORE turn ownership: a retransmit must be
  // harmless even when its action is no longer legal.
  if (seq <= host.seq[side]) return { ok: true, duplicate: true, seq, snapshot: snapshot(host) };

  let out;
  switch (cmd.type) {
    case 'hello': out = doHello(host, side, cmd); break;
    case 'folder': out = doFolder(host, side, cmd); break;
    case 'mulligan': out = doMulligan(host, side); break;
    case 'play': out = doPlay(host, side, cmd); break;
    case 'attack': out = doAttack(host, side); break;
    case 'pass': out = doPass(host, side); break;
    case 'result': out = doResult(host); break;
    default: out = refuse('unknown_command');
  }
  if (out.ok) host.seq[side] = seq;
  out.seq = seq;
  if (out.snapshot === undefined) out.snapshot = snapshot(host);
  return out;
}
