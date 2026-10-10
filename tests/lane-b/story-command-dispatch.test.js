// Research oracle only: compare the translated command router against the
// resident getter/setter's own instructions. Production uses the TS port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { NativeStageRuntime } from '../../engine/native/runtime.ts';
import { STORY_COMMAND_BANKS, storyCommand } from '../../engine/systems/story-command-banks.ts';
import { commandCensus, commandBanksFromAssembly } from '../../tools/story-command-census.mjs';
import { applySetFlag } from '../../engine/systems/scene-completion.ts';
import { createFlagStore } from '../../web/flag-store.js';

const resident = new Uint8Array(readFileSync('web/assets/native/screens/resident.bin'));
// The assembly-arm census needs the ddw3 asm corpus; skip it without one.
const ASM_FNS = `${process.env.DDW3_DIR ?? `${process.env.HOME}/ddw3`}/asm/dw2003/exe/fns.s`;
const SKIP_ASM = { skip: !existsSync(ASM_FNS) && "ddw3 asm corpus not present on this machine (set DDW3_DIR or clone ddw3 to ~/ddw3)" };
function kit() {
  const rt = new NativeStageRuntime(new Uint8Array(4), { size: 4, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() { throw Error('oracle called host flag store'); }, getFlag() { throw Error('oracle called host getter'); }, rand16: () => 0 },
    undefined, undefined, undefined, { image: resident, base: 0x80010000 });
  rt.cpu.clearStub(0x800163b0);
  rt.cpu.clearStub(0x800165ac);
  const calls = [];
  rt.mem.write32(0x8009b6a4, 0x80163000);
  rt.cpu.setStub(0x80163000, c => { calls.push(['battle', c.reg(4)]); return 0; });
  rt.cpu.setStub(0x8008b770, c => { calls.push(['screen', c.reg(4), c.reg(5), c.reg(6), c.reg(7), rt.mem.read32((c.reg(29) + 0x10) >>> 0)]); return 0; });
  rt.cpu.setStub(0x8008bfa4, c => { calls.push(['talk_event', c.reg(4)]); return 0; });
  rt.cpu.setStub(0x8008c000, () => { calls.push(['inn']); return 0; });
  return { rt, calls };
}
function commandCall(command) {
  if (!command) return [];
  if (command.kind === 'battle' || command.kind === 'talk_event') return [[command.kind, command.index]];
  if (command.kind === 'inn') return [['inn']];
  return [['screen', command.screen, command.parameter, 0, 0, 0]];
}

test('assembly arm census equals the production command-bank list; converted use census is complete', SKIP_ASM, () => {
  const decoded = commandBanksFromAssembly();
  assert.deepEqual([...STORY_COMMAND_BANKS], decoded);
  const census = commandCensus();
  assert.deepEqual(census, JSON.parse(readFileSync('data/story-command-uses.json', 'utf8')));
  // Independent completeness check: inspect primitive flag fields and tagged
  // arguments, rather than calling the production census's record classifier.
  const independent = [];
  const collect = (value, pointer = '', parent = null, key = '') => {
    if (typeof value === 'number' && value >= 0 && value <= 0xffff && decoded.includes((value >>> 8) & 0xfe)) {
      if ((key === 'id' && typeof parent?.expected === 'number')
          || (key === 'flag' && (parent?.op === 'set_flag' || typeof parent?.eq === 'number'))
          || key === 'cond_a' || key === 'cond_b' || key === 'flag_b'
          || (key === 'v' && parent?.t === 'FLAGID') || /\/sets\/\d+\/0$/.test(pointer)) independent.push(value);
    }
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'leaf' && (value.leaf === 'flag' || value.leaf === 'hasFlag')
        && decoded.includes((Number(value.args[0]) >>> 8) & 0xfe)) independent.push(value.args[0]);
    for (const [k, child] of Object.entries(value)) collect(child, `${pointer}/${k}`, value, k);
  };
  for (const source of ['web/assets/engine-content.json', 'web/assets/data/story_steps.json',
    ...readdirSync('web/assets/scenes').filter(n => /^s\d+\.json$/.test(n)).map(n => `web/assets/scenes/${n}`)])
    collect(JSON.parse(readFileSync(source, 'utf8')));
  assert.deepEqual(census.uses.map(use => use.id).sort((a, b) => a - b), independent.sort((a, b) => a - b));

  const flags = createFlagStore({ get() { throw Error('storage'); }, set() { throw Error('storage'); } });
  for (const use of census.uses) {
    if (use.access === 'read') assert.equal(flags.matches(use.id, use.value), true, `${use.source}${use.pointer}`);
    if (use.access === 'write' || use.access === 'completion_copy') {
      const calls = [];
      applySetFlag(use.id, use.value, { setFlag() { throw Error('command stored'); } }, { stored: () => true, command: cmd => calls.push(...commandCall(cmd)) });
      assert.deepEqual(calls, commandCall(storyCommand(use.id)), `${use.source}${use.pointer}`);
    }
  }
});

test('seven command banks, 512 indices, both polarities and both write values match original dispatch', () => {
  const { rt, calls } = kit();
  let reads = 0, writes = 0;
  for (const bank of STORY_COMMAND_BANKS) for (let index = 0; index < 512; index++) {
    const id = bank * 256 + index;
    for (const value of [0, 1]) {
      assert.equal(rt.cpu.call(0x800163b0, [id, value]), 1, `getter ${id.toString(16)} expected=${value}`);
      reads++;
      calls.length = 0;
      rt.cpu.call(0x800165ac, [id, value]);
      const translated = [];
      applySetFlag(id, value, { setFlag() { throw Error('command stored'); } }, {
        stored: () => true, command: command => translated.push(...commandCall(command)),
      });
      assert.deepEqual(translated, calls, `setter ${id.toString(16)} value=${value}`);
      writes++;
    }
  }
  assert.equal(reads, 7168);
  assert.equal(writes, 7168);
});
