import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NativeMemory } from '../engine/native/memory.ts';
import { R3000 } from '../engine/native/mips.ts';
import { useBattleItem } from '../engine/dw3/battle-items.ts';
import { useItem } from '../engine/dw3/items.ts';
import { ELEMENT_KEYS } from '../engine/dw3/effective-stats.ts';

const resident = new Uint8Array(readFileSync('web/assets/native/screens/resident.bin'));
const overlay = new Uint8Array(readFileSync('web/assets/native/screens/pro_fightstg.bin'));
// Read the original dispatch, rather than maintaining a second list of handlers.
const dispatch = new DataView(overlay.buffer, overlay.byteOffset);
const handler = id => dispatch.getUint32(0x80082f1c - 0x80082cb0 + (id - 43) * 4, true);
const target = (n) => ({hp:100,maxHp:400,str:n,def:n,spd:n,ailments:{}});
function original(id, member) {
  const mem = new NativeMemory(); mem.load(resident, 0x80010000); mem.load(overlay, 0x80082cb0);
  const cpu = new R3000(mem);
  const obj=0x80110000, stats=0x80111000, message=0x80112000, output=0x80113000;
  const live=0x800a4460 + (id >= 87 ? 0x70 : 0x10);
  mem.write32(obj+0x70,id); mem.write32(0x800a4600,0x80114000);
  mem.write32(message+0xac,0x80114004);
  ['str','def','spd'].forEach((k,i)=>{
    mem.write16(stats+[2,4,10][i],member[k]);
    mem.write16(live+0x10+i*2,member.buffs?.[k]??0);
  });
  cpu.setStub(0x80114000,()=>stats); cpu.setStub(0x80114004,()=>0);
  cpu.setStub(0x8009cc20,()=>0); cpu.setStub(0x8009a298,()=>message);
  cpu.setStub(0x8008ede8,c=>{ c.setReg(31,0x00cafe00); });
  cpu.setStub(0x80114008,c=>{c.setReg(18,obj);c.setReg(19,output);c.setReg(31,handler(id));});
  cpu.call(0x80114008,[],10000);
  return Object.fromEntries(['str','def','spd'].map((k,i)=>[k,(mem.read16(live+0x10+i*2)<<16)>>16]));
}
// Enumerate numeric stat writers from the dispatch bodies: sh to live s0+10/12/14.
const starts=[...new Set(Array.from({length:48},(_,i)=>handler(i+43)))].sort((a,b)=>a-b);
const statWriters=Array.from({length:48},(_,i)=>i+43).filter(id=>{
  const start=handler(id), end=starts.find(p=>p>start)??0x8008ed88;
  for(let pc=start;pc<end;pc+=4) {
    const word=dispatch.getUint32(pc-0x80082cb0,true);
    if((word>>>26)===0x29 && ((word>>>21)&31)===16 && [0x10,0x12,0x14].includes(word&0xffff)) return true;
  }
  return false;
});
for (const id of statWriters) test(`item ${id}: stat changes match the dispatch arm, including odd bases and reuse`,()=>{
  for(const n of [9,3,7,31,101,127,999,1]) {
    const u=target(n), e=target(n), member=id>=87?e:u;
    for(let repeat=0;repeat<4;repeat++) {
      const expected=original(id,member);
      useBattleItem(id,u,e);
      assert.deepEqual(member.buffs,expected,`id ${id}, base ${n}, use ${repeat+1}`);
    }
  }
});
for (const [i,element] of ELEMENT_KEYS.entries()) test(`field chip: ${element} cap includes species resistance`,()=>{
  const ps={hp:10,maxHp:10,mp:10,maxMp:10,elemBonuses:{[element]:989}};
  const state={inventory:[{id:55+i,qty:2}],partnerStats:ps};
  const profile={resistances:{[element]:10}};
  const result=useItem(state,55+i,()=>9,profile);
  assert.equal(result.ok,false);
  assert.equal(ps.elemBonuses[element],989);
  assert.equal(state.inventory[0].qty,2);
  ps.elemBonuses[element]=988;
  assert.equal(useItem(state,55+i,()=>9,profile).delta,1);
  assert.equal(ps.elemBonuses[element],989);
});
