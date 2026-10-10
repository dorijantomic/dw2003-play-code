import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NativeMemory } from '../engine/native/memory.ts';
import { MemcardSession } from '../engine/dw3/ui/memcard-session.ts';
import { readSaveBlock, writeSaveBlock, decodeSaveRoster, SAVE_STORED_BANKS, seedSaveFlags, readSaveFlags, SAVE_CARD_MAX, SAVE_FOLDER_COUNT, SAVE_FOLDER_CARDS } from '../engine/dw3/save-block.ts';
import { residentStorage } from '../engine/persistence/memcard-state.ts';
// The original-ASM census tests below read the ddw3 tree the same way the
// rest of the suite does (DDW3_DIR, then ~/ddw3) and skip when it is absent.
const ASM_ROOT = join(process.env.DDW3_DIR || join(homedir(), 'ddw3'), 'asm/dw2003');
const asmSrc = p => readFileSync(join(ASM_ROOT, p), 'utf8');
const asmSkip = existsSync(join(ASM_ROOT, 'exe/fns.s')) ? false : 'ddw3 asm tree not present (set DDW3_DIR)';
const bytes = path => new Uint8Array(readFileSync(`web/assets/data/${path}`));
const profiles = bytes('digimon_profiles.bin');
const manifest = JSON.parse(readFileSync('web/assets/data/memcard/manifest.json'));
const resources = { profiles, tables: bytes('memcard/tables.bin'), font: bytes('shop_font.bin'),
  textButtons: Uint8Array.from(manifest.textButtons.bytes),
  banks: new Map([[0x7a, bytes('memcard/122.bin')], [0xab, bytes('memcard/171.bin')], [0x96, bytes('shop-banks/150.bin')]]) };
const member = slot => ({ position: slot < 3 ? slot : -1, rosterSlot: slot, nameBytes: [14 + slot],
  lastUltraDrill:3+slot, exp: 123 + slot, level: 4 + slot, tp: 21 + slot, hp: 101 + slot, maxHp: 201 + slot, mp: 31 + slot, maxMp: 41 + slot,
  core: Array.from({length:6}, (_, i) => 50 + slot * 6 + i), elements: Array.from({length:7}, (_,i) => 80 + slot*7+i),
  equipment: {head: 200, body: 201, right: 202, left: 203, acc0: 330, acc1: 332},
  forms: {digimonId:9, equippedForms:[9,10,11], formLedger: Array.from({length:44}, (_, i) => ({id:9+i, formLevel:2+i,
    preservedByte: 90+i, dvexp:1000+i, techSlots:Array.from({length:6}, (_,j) => 0xe000| (i*6+j+1))}))} });
const seed = { language:2, mode:'save', bits:6789, bag:[{id:402,held:5,worn:2}], playSeconds:3725,
  playerNameBytes:[14,15], members:[0,1,2].map(member), reserves:[3,4,5,6,7].map(member),
  residentImage:Uint8Array.from({length:0x26c4}, (_, i) => (i*13+17)&255) };
const session = () => new MemcardSession(seed, resources, {playSound(){}, card:{present:()=>true,directory:()=>new Uint8Array(0xd4),image:()=>null,writeDirectory(){},writeImage(){}}});

test('save retains the copied bytes outside the mapped walker fields', () => {
  const s=session();
  for (const [start,end] of [[4,0x48],[0x3a2,0x760],[0x2654,0x26c4]]) for(let i=start;i<end;i++)
    assert.equal(s.mem.read8(0x80048d34+i),seed.residentImage[i], `byte ${i.toString(16)}`);
  s.dispose();
});
test('the card carries every owned roster member, including five reserves', () => {
  const s=session(); const roster=decodeSaveRoster(readSaveBlock(s.mem), profiles);
  assert.equal(roster.length,8);
  for(const r of roster) { assert.equal(r.owned,r.slot+3); assert.equal(r.level,4+r.slot); assert.equal(r.xp,123+r.slot); }
  s.dispose();
});
test('every roster stat and equipment field survives the memory-card seed', () => {
  const s=session();
  for(const r of decodeSaveRoster(readSaveBlock(s.mem),profiles)) {
    const m=member(r.slot); for(const k of ['tp','hp','maxHp','mp','maxMp','core','elements','equipment','lastUltraDrill']) assert.deepEqual(r[k],m[k], `${r.slot} ${k}`);
  } s.dispose();
  const rawLedger=Array(44*0x14).fill(0);
  const m=member(0);
  m.forms={digimonId:9,rawLedger,formLedger:[{id:9,index:0,formLevel:7},{id:10,formLevel:4}]};
  const next=new MemcardSession({...seed,members:[m],reserves:[]},resources,{playSound(){},card:{present:()=>true,directory:()=>new Uint8Array(0xd4),image:()=>null,writeDirectory(){},writeImage(){}}});
  const forms=decodeSaveRoster(readSaveBlock(next.mem),profiles)[0].formLedger;
  assert.deepEqual(forms.map(e=>[e.id,e.index,e.formLevel]),[[9,0,7],[10,1,4]]);
  next.dispose();
});
test('all 44 forms and six flagged technique words reach each roster record', () => {
  const s=session();
  for(const r of decodeSaveRoster(readSaveBlock(s.mem),profiles)) {
    const m=member(r.slot); assert.equal(r.digimonId,9); assert.deepEqual(r.equippedForms,[9,10,11]);
    for(let i=0;i<44;i++) for(const k of ['id','formLevel','preservedByte','dvexp','techSlots']) assert.deepEqual(r.ledger[i][k],m.forms.formLedger[i][k], `${r.slot}:${i}:${k}`);
  } s.dispose();
});
test('load reads card money, items, roster and equipment instead of stale companion values', () => {
  const s=session(); const data=residentStorage(readSaveBlock(s.mem),profiles,{party:'[]',partyStats:'[]',bits:'1',inventory:'[]',browserPreference:'keep'});
  assert.equal(data.bits,'6789'); assert.equal(data.playSeconds,'3725'); assert.equal(data.rosterOwned,'255');
  assert.deepEqual(JSON.parse(data.inventory),[{id:402,qty:5}]);
  assert.equal(JSON.parse(data.partyStats)[0].formLedger.length,44);
  assert.equal(JSON.parse(data.reserveStats).p010pata.level,11);
  assert.equal(JSON.parse(data.equipment)[0].acc1,332);
  assert.equal(data.browserPreference,'keep');
  s.dispose();
});
test('every byte copied by the serializer round-trips, including unnamed spans', () => {
  const s=session();
  assert.deepEqual(readSaveBlock(s.mem).slice(4,0x48),seed.residentImage.slice(4,0x48));
  s.dispose();
  const m=new NativeMemory(); writeSaveBlock(m,seed.residentImage); assert.deepEqual(readSaveBlock(m),seed.residentImage);
});
test('roster and form censuses equal the original loop populations', { skip: asmSkip }, () => {
  const asm=asmSrc('exe/fns.s');
  const rosterBody=asm.slice(asm.indexOf('F0x80016bac:'),asm.indexOf('F0x80016d94:'));
  const formsBody=asm.slice(asm.indexOf('F0x80017898:'),asm.indexOf('F0x80017924:'));
  const rosterBound=parseInt(rosterBody.match(/slti \$v0, \$s4, (0x[\da-f]+)/)[1],16);
  const formBound=parseInt(formsBody.match(/slti \$v0, \$t0, (0x[\da-f]+)/)[1],16);
  const s=session(); const roster=decodeSaveRoster(readSaveBlock(s.mem),profiles);
  assert.deepEqual(roster.filter(r=>r.owned>=3).map(r=>r.slot),Array.from({length:rosterBound},(_,i)=>i));
  for(const r of roster) assert.deepEqual(r.ledger.map(e=>e.index),Array.from({length:formBound},(_,i)=>i));
  s.dispose();
});

test('an empty third party position stays empty on a load', () => {
  const s=session(); s.mem.write32(0x80048d34+0x78,0xffffffff);
  s.mem.write16(0x80048d34+0x760+0x3c8,0);
  const data=residentStorage(readSaveBlock(s.mem),profiles,{});
  assert.equal(JSON.parse(data.party).length,2);
  assert.equal('head' in JSON.parse(data.equipment)[0],false);
  assert.equal(JSON.parse(data.reserveStats).p010pata.level,11);
  s.dispose();
});
test('the whole card collection and three forty-card folders reach the save', { skip: asmSkip }, () => {
  const asm=asmSrc('exe/fns.s');
  const folders=asm.slice(asm.indexOf('F0x80016e6c:'),asm.indexOf('F0x80016f0c:'));
  const album=asmSrc('pro/stcrdabm.s');
  assert.equal(SAVE_FOLDER_COUNT,parseInt(folders.match(/slti \$v0, \$a3, (0x[\da-f]+)/)[1],16));
  assert.equal(SAVE_FOLDER_CARDS,parseInt(folders.match(/slti \$v0, \$s0, (0x[\da-f]+)/)[1],16));
  assert.equal(SAVE_CARD_MAX,parseInt(album.match(/slti \$v0, \$s1, (0x[\da-f]+)/)[1],16));
  const cards={owned:Array.from({length:315},(_,i)=>[i+1,(i%9)+1]), seen:Array.from({length:315},(_,i)=>i+1),
    folders:Array.from({length:3},(_,f)=>({nameBytes:[14+f],cards:Array.from({length:40},(_,i)=>f*40+i+1)}))};
  const s=new MemcardSession({...seed,cards,progressOrdinal:19,packId:2},resources,{playSound(){},card:{present:()=>true,directory:()=>new Uint8Array(0xd4),image:()=>null,writeDirectory(){},writeImage(){}}});
  const data=residentStorage(readSaveBlock(s.mem),profiles,{});
  const loaded=JSON.parse(data.cardCollection);
  assert.deepEqual(loaded.owned,cards.owned); assert.deepEqual(loaded.seen,cards.seen);
  assert.deepEqual(loaded.folders.map(f=>f.cards),cards.folders.map(f=>f.cards));
  assert.equal(data.progressOrdinal,'19'); assert.equal(data.packId,'C');
  s.dispose();
});

test('stored-bank census equals the bases in the original get_flag dispatcher', { skip: asmSkip }, () => {
  const asm=asmSrc('exe/fns.s');
  const body=asm.slice(asm.indexOf('F0x800163b0:'),asm.indexOf('F0x800165ac:'));
  const addresses=[...body.matchAll(/(?:%lo\((D0x8004b[0-9a-f]{3})\)|la_ \$a0, (D0x8004b[0-9a-f]{3}))/g)].map(m=>parseInt((m[1]??m[2]).slice(3),16)-0x80048d34);
  addresses.push(0x8004949c+0x3dc*8-4-0x80048d34);
  assert.deepEqual([...new Set(addresses)].sort((a,b)=>a-b),SAVE_STORED_BANKS.map(r=>r[1]));
  const flags=Object.fromEntries(SAVE_STORED_BANKS.map(([b])=>[b,btoa('A'.repeat(64))]));
  const s=new MemcardSession({...seed,storedFlags:flags},resources,{playSound(){},card:{present:()=>true,directory:()=>new Uint8Array(0xd4),image:()=>null,writeDirectory(){},writeImage(){}}});
  for(const offset of addresses) assert.equal(s.mem.read8(0x80048d34+offset),65);
  s.dispose();
});
test('the stored portions of thirteen flag banks survive the save', () => {
  const mem=new NativeMemory();
  const flags=Object.fromEntries(SAVE_STORED_BANKS.map(([bank])=>[bank,btoa(String.fromCharCode(...Array.from({length:64},(_,i)=>(i+bank+1)&255)))]));
  seedSaveFlags(mem,flags); assert.deepEqual(readSaveFlags(mem,flags),flags);
  const s=new MemcardSession({...seed,storedFlags:flags},resources,{playSound(){},card:{present:()=>true,directory:()=>new Uint8Array(0xd4),image:()=>null,writeDirectory(){},writeImage(){}}});
  assert.deepEqual(readSaveFlags(s.mem,flags),flags); s.dispose();
});
