import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NativeStageRuntime } from '../../engine/native/runtime.ts';
import { DNA_PATH_BRANCHES, dnaAnswerAction, dnaAnswerForm } from '../../engine/dw3/battle-dna-branches.ts';
const fight = readFileSync('web/assets/native/screens/pro_fightstg.bin');
const resident = readFileSync('web/assets/native/screens/resident.bin');
const word = a => fight.readUInt32LE(a - 0x80082cb0);

test('DNA branch census equals the independently quoted canonical table', () => {
  const doc = readFileSync('docs/research/battle/dna-path-branches-2026-10-04.md', 'utf8');
  const ids = [...doc.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map(x => x[1]);
  assert.deepEqual(ids.sort(), DNA_PATH_BRANCHES.map(x => x.id).sort());
  assert.equal(new Set(ids).size, ids.length);
});

test('every raw Switch and DNA refusal branch has one census member', () => {
  // Independent population: all conditional branches from first Switch status
  // read to the first MP store, before ANY successful-confirm side effect.
  const branches = [];
  for (let a = 0x80098550; a < 0x80098650; a += 4) {
    const opcode = word(a) >>> 26;
    if (opcode >= 4 && opcode <= 7) branches.push(a);
  }
  const ids = ['switch-active-status','switch-partner-status','active-mp',
    'partner-mp','active-status-20','partner-status-20','active-status-08',
    'active-hp','partner-hp'];
  assert.deepEqual(DNA_PATH_BRANCHES.filter(r => ids.includes(r.id)).map(r => r.address), branches);
  for (const a of branches) {
    const offset = (word(a) << 16) >> 16;
    assert.equal(a + 4 + offset * 4, 0x80098790, 'refusal converges on repaint');
  }
});

test('full original phase tick agrees with the decode, including dispatch delay slots', () => {
  const rt = new NativeStageRuntime(fight, { size: fight.length, event_table: 0,
    init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 }, undefined, undefined,
    0x80082cb0, { image: resident, base: 0x80010000 });
  const phase = 0x80150000, children = 0x80160000;
  for (const kind of ['command', 'forced']) {
    for (const answer of [-2, -1, 0, 1, 2, 0x1a0, 0x1a1, 0x1b1, 0x1a5]) {
      rt.mem.write32(phase + 0x0c, 1);
      rt.mem.write32(phase + 0x10, kind === 'command' ? 2 : 4);
      rt.mem.write32(phase + 0x14, kind === 'command' ? 4 : 0);
      rt.mem.write32(phase + 0x18, 2);
      rt.mem.write32(phase + 0x2c, 0x80014288);
      rt.mem.write32(phase + 0x34, 0x800142a4);
      rt.mem.write32(phase + 0x58, answer);
      rt.mem.write32(phase + 0x5c, 0x777);
      rt.cpu.call(0x80092684, [phase, children], 1000);
      const expected = dnaAnswerAction(kind, answer);
      const result = rt.mem.read32(phase + 0x5c);
      const actual = result === 5 ? 'switch' : result === 6 ? 'dna'
        : rt.mem.read32(phase + 0x18) === 0 ? 'restart'
        : answer === -1 ? 'wait' : 'nothing';
      assert.equal(actual, expected, `${kind} answer ${answer}`);
    }
  }
  // These instructions supply the comparator at BOTH entry paths.
  assert.equal(word(0x80092ab8), 0x2402fffe);
  assert.equal(word(0x80092c48), 0x2402fffe);
});

test('browser consumes pane cancel by reopening the picker in both routes', () => {
  const source = readFileSync(process.env.DNA_BATTLE_SOURCE || 'web/battle.js', 'utf8');
  const begin = source.indexOf('  function applyDnaAnswer(');
  const end = source.indexOf('\n  /**', begin);
  assert.ok(begin > 0 && end > begin);
  const ST = { PLAYER_TAG: 11, PLAYER_DNA_CHOICE: 15,
    PLAYER_MENU: 2, PLAYER_ACT: 5 };
  const apply = new Function('dnaAnswerAction', 'ST',
    source.slice(begin, end) + '\nreturn applyDnaAnswer;')(dnaAnswerAction, ST);
  for (const kind of ['command', 'forced']) {
    const b = { state: 15, _forcedTag: kind === 'forced', pendingAction: null,
      _dnaChoice: { rosterIndex: 1, formId: 26 } };
    apply(b, -2, kind);
    assert.equal(b.state, ST.PLAYER_TAG, `${kind}: cancel must reopen partner picker`);
    assert.equal(b.pendingAction, null);
    assert.equal(b._forcedTag, kind === 'forced');
  }
});

test('forced DNA answer does not invent a Switch commit', () => {
  const source = readFileSync('web/battle.js', 'utf8');
  const begin = source.indexOf('  function applyDnaAnswer(');
  const end = source.indexOf('\n  /**', begin);
  const apply = new Function('dnaAnswerAction', 'ST', source.slice(begin,end)
    + '\nreturn applyDnaAnswer;')(dnaAnswerAction, { PLAYER_ACT: 5, PLAYER_TAG: 11 });
  const b = { state: 15, pendingAction: null, _dnaChoice: { rosterIndex: 1, formId: 26 } };
  apply(b, 0x1a1, 'forced');
  assert.equal(b.pendingAction, null);
  assert.equal(b._dnaBranchBlocked, true);
});

test('every profile-selected DNA action reaches a supported category and clip 12', () => {
  const actions = new Set();
  for (let i = 0; i < 55; i++) {
    const row = 0x8003ef5c - 0x80010000 + i * 0x58;
    if (resident[row + 0x3d]) {
      const id = resident.readUInt16LE(row + 0x2a);
      assert.ok(id > 0);
      actions.add(id);
    }
  }
  assert.ok(actions.size > 0);
  for (const id of actions) {
    const row = 0x80042bca - 0x80010000 + id * 0x12;
    assert.ok([2, 3, 4].includes(resident[row + 4]), `DNA action ${id} category`);
    assert.equal(resident[row + 0x10], 12, `DNA action ${id} clip`);
  }
});


test('Switch and DNA use the species answered by the pane, across every profile row', () => {
  const mem = { read16: address => resident.readUInt16LE(address - 0x80010000) };
  for (let row = 0; row < 55; row++) {
    const species = mem.read16(0x8003ef5c + row * 0x58);
    for (const option of [0, 1]) assert.equal(dnaAnswerForm(mem, species << 4 | option), row + 1);
  }
});

test('grey-label condition census independently exhausts both raw label regions', () => {
  const raw = [];
  for (const [start,end] of [[0x80097de4,0x80097e08],[0x80097ee4,0x80097f84]]) {
    for (let a = start; a < end; a += 4) {
      const op = word(a) >>> 26;
      if (op >= 4 && op <= 7) raw.push(a);
    }
  }
  assert.deepEqual(DNA_PATH_BRANCHES.filter(r => r.id.startsWith('grey-')).map(r => r.address),raw);
  assert.equal(word(0x8009b018),0x14400026,'successful confirm disables shared list input');
});
