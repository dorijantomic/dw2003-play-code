import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { applyNpcPrograms, selectNpcDialogue } from '../engine/dw3/npc-manager.ts';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const programs=read('web/stage-npc-programs.json').stages;
const banks=read('data/stage_estalk_bank.json');
// The original-descriptor census test below reads the ddw3 asm tree the same
// way the rest of the suite does (DDW3_DIR, then ~/ddw3) and skips when absent.
const ASM_PRO = join(process.env.DDW3_DIR || join(homedir(), 'ddw3'), 'asm/dw2003/pro');
const asmSkip = existsSync(ASM_PRO) ? false : 'ddw3 asm tree not present (set DDW3_DIR)';

test('every descriptor has its own language-adjusted bank, including estalk08/09',()=>{
 const descriptors=read('docs/generated/stage-descriptors.json');
 assert.deepEqual(Object.keys(banks).sort(),descriptors.map(d=>d.stage.replace('wstag','s')).sort());
 assert.deepEqual(Object.keys(programs).sort(),Object.keys(banks).sort());
 for(const d of descriptors) {
  const base=parseInt(d.fields['44'].match(/\+ (0x[\dA-F]+)\)/)[1],16);
  const expected=`estalk${((base-197)/7).toString().padStart(2,'0')}`;
  assert.equal(banks[d.stage.replace('wstag','s')].bank,expected);
  for(const npc of programs[d.stage.replace('wstag','s')])for(const state of npc.dialogue_states??[])assert.equal(state.dialogue.file,expected);
 }
});

test('all original extracted item spawn/talk predicates survive the browser program',()=>{
 for(const r of read('docs/generated/item-native-readers.json').tables.filter(r=>r.kind!=='step')) {
  const [slot,id,x,y,n]=r.who.split(':').map(Number);
  const matches=programs[r.stage].filter(p=>p.slot===slot&&p.npc_id===id&&p.x===x&&p.y===y&&p.n===n);
  assert.ok(matches.some(p=>r.kind==='npc_spawn'?p.spawn_flags?.some(c=>c.id===r.flag_id&&c.expected===r.expected):p.dialogue_states?.some(d=>d.dialogue.index===r.text_index&&d.gate?.some(c=>c.id===r.flag_id&&c.expected===r.expected))),`${r.stage} ${r.who} ${r.kind} ${r.flag_id}`);
 }
});

test('a failed key gate stays silent instead of replaying the first line',()=>{
 const npc={dialogue:{file:'estalk09',index:209},dialogue_states:[{gate:[{id:0x8006,expected:1}],dialogue:{file:'estalk09',index:209}}]};
 assert.equal(selectNpcDialogue(npc,()=>0,{}),null);
 assert.equal(selectNpcDialogue(npc,()=>1,{}).dialogue.index,209);
 assert.equal(selectNpcDialogue({dialogue:npc.dialogue},()=>0,{}).dialogue.index,209);
});

test('program installation keeps distinct spawn gates and preserves scene metadata',()=>{
 const one={slot:5,npc_id:123,x:240,y:600,n:1,spawn_flags:[{id:0x8006,expected:0}],ptrB:123,dialogue_states:[]};
 const two={...one,spawn_flags:[{id:0x8006,expected:1}]};
 const applied=applyNpcPrograms([{...one,custom:'scene'}],[one,two]);
 assert.equal(applied.length,2);assert.equal(applied[0].custom,'scene');assert.equal(applied[1].custom,undefined);
});

test('Agumon DDNA has both possession branches in the descriptor bank',()=>{
 const states=programs.s971.find(p=>p.npc_id===123).dialogue_states;
 assert.ok(states.some(d=>d.gate?.some(f=>f.id===0x8006&&f.expected===1)));
 assert.ok(states.some(d=>d.gate?.some(f=>f.id===0x8006&&f.expected===0)));
 for(const d of states)assert.equal(d.dialogue.file,'estalk09');
});

test('bank census independently equals every original descriptor +0x44 store',{skip:asmSkip},()=>{
 for(const [stage,row]of Object.entries(banks)) {
  const lines=readFileSync(join(ASM_PRO,`${stage.replace('s','wstag')}.s`),'utf8').split('\n');
  const bases=[];
  for(let i=0;i<lines.length;i++) {
   const store=lines[i].match(/sw (\$\w+), 0x44\(\$\w+\)/);
   if(!store)continue;
   // The constructor's language-index addition immediately precedes its descriptor write.
   const add=lines[i-1]?.match(/addiu (\$\w+), (?:\$\w+, )?(0x[\da-f]+)/);
   if(add&&add[1]===store[1])bases.push(parseInt(add[2],16));
  }
  assert.deepEqual([...new Set(bases)],[row.descriptor_base],`${stage}: original bank store`);
 }
});

test('a decoded silent actor cannot inherit an old generated dialogue fallback',()=>{
 const npc={slot:4,npc_id:1,x:0,y:0,n:1,dialogue:{file:'estalk00',index:1}};
 const [installed]=applyNpcPrograms([npc],[{slot:4,npc_id:1,x:0,y:0,n:1,dialogue_states:[]}]);
 assert.equal(installed.dialogue,undefined);
 assert.equal(selectNpcDialogue(installed,()=>0,{}),null);
});
