import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlagStore } from '../web/flag-store.js';
import { applySetFlag } from '../engine/systems/scene-completion.ts';
import { GameEngine } from '../engine/index.ts';

const banks = [0x74, 0x76, 0x78, 0x7a, 0x7c, 0x90, 0x94];

test('command-bank reads succeed for either requested polarity and do not read storage', () => {
  const flags = createFlagStore({ get() { throw Error('command read storage'); }, set() { throw Error('command wrote storage'); } });
  for (const bank of banks) for (const index of [0, 1, 0x100, 0x1ff]) {
    const id = bank * 256 + index;
    assert.equal(flags.get(id), 1, `bank ${bank.toString(16)} index ${index}`);
    // A command-bank get_flag returns success, not a stored value to invert.
    assert.equal(flags.matches(id, 0), true);
    assert.equal(flags.matches(id, 1), true);
  }
});

test('shared writer consumes every command bank, ignores value, and retains all nine index bits', () => {
  const seen = [], stored = [];
  const policy = { stored: () => true, command: (command) => seen.push(command) };
  const sink = { setFlag: (...args) => stored.push(args) };
  for (const bank of banks) for (const index of [0, 1, 0x100, 0x1ff]) {
    seen.length = 0;
    applySetFlag(bank * 256 + index, 0, sink, policy);
    const zero = structuredClone(seen);
    seen.length = 0;
    applySetFlag(bank * 256 + index, 1, sink, policy);
    assert.deepEqual(seen, zero);
    if (bank !== 0x7c || index < 2) assert.equal(seen.length, 1, `bank ${bank.toString(16)}`);
    else assert.equal(seen.length, 0, 'desk indices beyond 1 do nothing');
  }
  assert.deepEqual(stored, [], 'commands are not stored flags');
});

test('engine script writes and scene completion use the same command door', () => {
  const commands = [];
  const engine = new GameEngine({ roster: { records: [] }, ordinal: { byStage: {} }, flagKeys: {}, stages: [{
    mapId: 's-test', events: [{ id: 'cmd', on: 'OnTalk', do: 'cmd.script' }],
    scripts: [{ id: 'cmd.script', program: [{ op: 'SetFlag', args: [{ t: 'FLAGID', v: 0x7700 }, { t: 'INT', v: 0 }] }] }],
    completions: { '9': { writes: [{ op: 'set_flag', flag: 0x7700, value: 1 }] } },
  }] }, { storyCommand: (command) => commands.push(command) });
  engine.loadStage('s-test');
  engine.pump(engine.raise('OnTalk'));
  engine.completeEvent(9);
  assert.deepEqual(commands, [
    { kind: 'card_duel', index: 0x100, screen: 0x700, parameter: 513 },
    { kind: 'card_duel', index: 0x100, screen: 0x700, parameter: 513 },
  ]);
  for (const bank of banks) {
    assert.equal(engine.state.flags.get(bank * 256, 0), true);
    assert.equal(engine.state.flags.get(bank * 256, 1), true);
  }
});
