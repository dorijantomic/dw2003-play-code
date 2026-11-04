// The pure half of a two-human card duel: the host-authoritative command
// protocol in web/cardduel-net.js. No screen, no relay — just the module the
// two screens of part 2 will share.
//
// The card data here is a TEST catalog, not a claim about the disc: ids 1..10
// are a strong white Digimon (10/10, cost 1), ids 11..20 a weak one (5/5, cost
// 1), four copies of each in the folder. Every rule about the duel itself comes
// from engine/systems/card-battle.ts, which is what the host runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuel, battleAward, SETS_TO_WIN, FOLDER_SIZE, HAND_LIMIT, FIELD_LIMIT, ENERGY_COLOURS,
} from '../web/vendor/engine.js';
import {
  createDuelHost, applyCommand, snapshot, DUEL_RULES,
} from '../web/cardduel-net.js';

const STRONG = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const WEAK = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

function makeCatalog() {
  const cards = [
    ...STRONG.map((id) => ({ id, name: `Testmon ${id}`, colour: 'white', kind: 'digimon', ap: 10, hp: 10, summonCost: 1 })),
    ...WEAK.map((id) => ({ id, name: `Foddermon ${id}`, colour: 'white', kind: 'digimon', ap: 5, hp: 5, summonCost: 1 })),
  ];
  return { counts: { total: cards.length, digimon: cards.length, program: 0 }, cards };
}

/** A legal 40-card folder: ten ids, four copies of each. */
const folder = (ids) => ids.flatMap((id) => [id, id, id, id]);

function hostWithFolders(seed) {
  return createDuelHost({
    seed,
    catalog: makeCatalog(),
    folders: [folder(STRONG), folder(WEAK)],
  });
}

/** Send one command and assert the host accepted it. */
function send(host, side, cmd) {
  const out = applyCommand(host, side, cmd);
  assert.equal(out.ok, true, `side ${side} ${cmd.type} refused: ${out.reason}`);
  return out;
}

/**
 * Play the duel out the way two screens would: whoever the snapshot names
 * answers, and nobody may act out of turn. Each side summons one Digimon per
 * set (when `summon` is on) and passes the Program phases; both sides press
 * attack to open the Battle Phase.
 */
function playDuel(host, { summon = true } = {}) {
  const seq = [1, 1];
  let set = 0;
  let summoned = [false, false];
  for (let guard = 0; guard < 400; guard++) {
    const snap = snapshot(host);
    if (snap.status === 'done') return snap;
    if (snap.set !== set) { set = snap.set; summoned = [false, false]; }
    if (snap.phase === 'load' || snap.phase === 'compile') {
      send(host, snap.turn, { type: 'pass', seq: seq[snap.turn]++ });
      continue;
    }
    if (snap.phase === 'summon') {
      const side = snap.turn;
      if (summon && !summoned[side]) {
        send(host, side, { type: 'play', slot: 0, seq: seq[side]++ });
        summoned[side] = true;
      } else {
        send(host, side, { type: 'pass', seq: seq[side]++ });
      }
      continue;
    }
    if (snap.phase === 'battle') {
      const side = snap.ready[0] ? 1 : 0;
      send(host, side, { type: 'attack', seq: seq[side]++ });
      continue;
    }
    throw new Error(`unexpected phase ${snap.phase} (status ${snap.status})`);
  }
  throw new Error('the duel did not finish');
}

test('a scripted duel runs to a result for both sides from one seed', () => {
  const host = createDuelHost({ seed: 0x51ee, catalog: makeCatalog() });
  send(host, 0, { type: 'hello', name: 'Host', seq: 1 });
  send(host, 1, { type: 'hello', name: 'Guest', seq: 1 });
  send(host, 0, { type: 'folder', cards: folder(STRONG), seq: 2 });
  assert.equal(snapshot(host).status, 'lobby', 'one folder is not a duel');
  send(host, 1, { type: 'folder', cards: folder(WEAK), seq: 2 });

  const snap = playDuel(host);
  assert.equal(snap.status, 'done');
  assert.equal(snap.outcome, 'win', 'side 0 (the stronger folder) took the duel');
  assert.equal(snap.result.winner, 0);
  assert.deepEqual(snap.result.sets, [2, 0]);
  assert.deepEqual(snap.result.sides.map((s) => s.outcome), ['win', 'loss']);
  // both screens are told the same result
  const guest = applyCommand(host, 1, { type: 'result', seq: 99 });
  assert.equal(guest.ok, true);
  assert.deepEqual(guest.result.sides.map((s) => s.outcome), ['win', 'loss']);
});

test('a guest command for side 0 is refused while it is side 1\'s turn', () => {
  const host = hostWithFolders(7);
  const snap = snapshot(host);
  assert.equal(snap.phase, 'load');
  assert.equal(snap.turn, 1, 'seed 7 opens on side 1');

  const bad = applyCommand(host, 0, { type: 'pass', seq: 1 });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'not_your_turn');
  assert.deepEqual(snapshot(host), snap, 'a refused command changes nothing');

  const good = applyCommand(host, 1, { type: 'pass', seq: 1 });
  assert.equal(good.ok, true, 'the side whose turn it is may act');
});

test('a duplicated command changes nothing', () => {
  const host = hostWithFolders(11);
  const side = snapshot(host).turn;
  send(host, side, { type: 'pass', seq: 4 });
  const after = snapshot(host);

  const dup = applyCommand(host, side, { type: 'pass', seq: 4 });
  assert.equal(dup.ok, true);
  assert.equal(dup.duplicate, true, 'a retransmit is acknowledged, not replayed');
  assert.deepEqual(snapshot(host), after);

  const old = applyCommand(host, side, { type: 'play', slot: 0, seq: 3 });
  assert.equal(old.duplicate, true, 'an older sequence number is stale');
  assert.deepEqual(snapshot(host), after);
});

test('a mulligan redraws the opening hand once, and its S-Energy matches the new hand', () => {
  const cards = [];
  for (let id = 1; id <= 10; id++) {
    cards.push({
      id,
      name: `Mixed ${id}`,
      colour: id % 2 ? 'white' : 'blue',
      kind: 'digimon',
      ap: 5,
      hp: 5,
      summonCost: 1,
    });
  }
  const mixed = { counts: { total: cards.length, digimon: cards.length, program: 0 }, cards };
  const deck = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((id) => [id, id, id, id]);
  const host = createDuelHost({ seed: 21, catalog: mixed, folders: [deck, deck] });
  const side = snapshot(host).turn;

  const out = applyCommand(host, side, { type: 'mulligan', seq: 1 });
  assert.equal(out.ok, true, `mulligan refused: ${out.reason}`);
  const snap = snapshot(host);
  assert.equal(snap.sides[side].hand, 6);
  assert.equal(snap.sides[side].deck, 34);
  assert.equal(snap.sides[side].mulligans, 1);
  // the returned cards give their energy back and the new six grant theirs,
  // so the pool is exactly the colours of the hand that is now held
  const colours = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  for (const id of out.hand) colours[id % 2 ? 'white' : 'blue'] += 1;
  assert.deepEqual(snap.sides[side].energy, colours);

  const again = applyCommand(host, side, { type: 'mulligan', seq: 2 });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'mulligan_used');
  const other = applyCommand(host, 1 - side, { type: 'mulligan', seq: 1 });
  assert.equal(other.ok, true, 'the other side has its own mulligan');
});

test('the attack ready check is cleared once the Battle Phase is over', () => {
  const host = hostWithFolders(13);
  let snap = snapshot(host);
  // Load: both sides decline
  send(host, snap.turn, { type: 'pass', seq: 1 });
  snap = snapshot(host);
  send(host, snap.turn, { type: 'pass', seq: 1 });
  // Summon: one card each, then end the turn
  for (let side = 0; side < 2; side++) {
    snap = snapshot(host);
    assert.equal(snap.phase, 'summon');
    const who = snap.turn;
    send(host, who, { type: 'play', slot: 0, seq: 2 });
    send(host, who, { type: 'pass', seq: 3 });
  }
  // Compile: both sides decline
  snap = snapshot(host);
  assert.equal(snap.phase, 'compile');
  send(host, snap.turn, { type: 'pass', seq: 4 });
  snap = snapshot(host);
  send(host, snap.turn, { type: 'pass', seq: 4 });
  // Battle ready check: one side alone is not enough
  snap = snapshot(host);
  assert.equal(snap.phase, 'battle');
  assert.deepEqual(snap.ready, [false, false]);
  send(host, 0, { type: 'attack', seq: 5 });
  snap = snapshot(host);
  assert.equal(snap.phase, 'battle', 'one attack does not start the battle');
  assert.deepEqual(snap.ready, [true, false]);
  send(host, 1, { type: 'attack', seq: 5 });
  // the battle ran: the duel is either decided or the next set has opened
  snap = snapshot(host);
  assert.deepEqual(snap.ready, [false, false], 'the ready check does not survive the battle');
  assert.ok(snap.status === 'done' || snap.set === 2);
});

test('a folder that is not 40 cards, holds five copies or names an unknown card is refused', () => {
  const host = createDuelHost({ seed: 2, catalog: makeCatalog() });
  const short = applyCommand(host, 0, { type: 'folder', cards: [1, 2, 3], seq: 1 });
  assert.equal(short.ok, false);
  assert.equal(short.reason, 'folder_size');

  const five = [1, 1, 1, 1, 1, ...Array(35).fill(2)];
  const copies = applyCommand(host, 0, { type: 'folder', cards: five, seq: 2 });
  assert.equal(copies.ok, false);
  assert.equal(copies.reason, 'folder_copies');

  const unknown = applyCommand(host, 0, { type: 'folder', cards: Array(40).fill(999), seq: 3 });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'unknown_card');
  assert.equal(snapshot(host).status, 'lobby', 'a refused folder leaves the host in the lobby');
});

test('the snapshot carries both sides\' hands, field, energy and sets', () => {
  const host = hostWithFolders(3);
  const start = snapshot(host);
  assert.equal(start.rules.setsToWin, SETS_TO_WIN);
  assert.equal(start.rules.folderSize, FOLDER_SIZE);
  assert.equal(start.rules.handLimit, HAND_LIMIT);
  assert.equal(start.rules.fieldLimit, FIELD_LIMIT);
  for (const side of start.sides) {
    assert.equal(side.hand, 6, 'six cards are drawn at the start of a set');
    assert.equal(side.deck, 34);
    assert.deepEqual(side.field, []);
    assert.equal(side.energy.white, 6, 'a white card drawn grants one white S-Energy');
    assert.equal(side.sets, 0);
  }

  // both sides pass the opening Load phase, then each summons its first Digimon
  let snap = snapshot(host);
  send(host, snap.turn, { type: 'pass', seq: 1 });
  snap = snapshot(host);
  send(host, snap.turn, { type: 'pass', seq: 1 });
  snap = snapshot(host);
  assert.equal(snap.phase, 'summon');
  const first = snap.turn;
  send(host, first, { type: 'play', slot: 0, seq: 2 });
  snap = snapshot(host);
  assert.equal(snap.sides[first].field.length, 1, 'the Digimon took a field slot');
  assert.ok([...STRONG, ...WEAK].includes(snap.sides[first].field[0].id));
  assert.equal(snap.sides[first].hand, 5);
  assert.equal(snap.sides[first].energy.white, 5, 'the summon cost was paid in white energy');
  send(host, first, { type: 'pass', seq: 3 });
  snap = snapshot(host);
  const second = snap.turn;
  assert.notEqual(second, first);
  send(host, second, { type: 'play', slot: 0, seq: 4 });
  snap = snapshot(host);
  assert.equal(snap.sides[second].field.length, 1);
  assert.equal(snap.sides[second].hand, 5);
  assert.equal(snap.sides[second].energy.white, 5);
  assert.equal(snap.sides[0].sets, 0);
  assert.equal(snap.sides[1].sets, 0);
});

test('SETS_TO_WIN is two, and a tied set is awarded to side 1', () => {
  assert.equal(SETS_TO_WIN, 2);
  assert.notEqual(SETS_TO_WIN, 3);
  assert.equal(DUEL_RULES.setsToWin, 2);

  // the engine's own state-0xA comparison, on an equal pair of totals
  const duel = createDuel(makeCatalog(), folder(STRONG), folder(WEAK));
  const walk = {
    combos: { player: [], opponent: [] },
    playerAp: 0, playerHp: 0, opponentAp: 0, opponentHp: 0,
    playerLeft: 5, opponentLeft: 5, winner: 1, settled: false,
  };
  battleAward(duel, walk);
  assert.equal(walk.winner, 1, 'a tie goes to side 1');
  assert.equal(duel.setAward, 1);
  assert.equal(duel.setDraw, true, 'an equal pair is the disc\'s draw line');

  // and the whole duel with nothing on either field is two such ties
  const host = hostWithFolders(5);
  const snap = playDuel(host, { summon: false });
  assert.equal(snap.result.winner, 1);
  assert.deepEqual(snap.result.sets, [0, 2]);
});

test('the same seed and the same commands produce the same snapshot twice', () => {
  const one = playDuel(hostWithFolders(0x2f2f));
  const two = playDuel(hostWithFolders(0x2f2f));
  assert.deepEqual(two, one, 'a shared seed rebuilds the identical duel');
  assert.equal(one.status, 'done');
  assert.ok(ENERGY_COLOURS.length === 5);
});
