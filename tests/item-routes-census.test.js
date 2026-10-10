import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ITEM_BY_ID, itemUsableInField, itemUsableInBattle } from '../engine/dw3/items.ts';
import { EQUIPMENT } from '../engine/dw3/equipment.ts';
import { isBattleEffectItem } from '../engine/dw3/battle-items.ts';
const shipped=JSON.parse(readFileSync('web/assets/data/item_effects.json','utf8')).items;
const resident=readFileSync('web/assets/native/screens/resident.bin');
const overlay=readFileSync('web/assets/native/screens/pro_fightstg.bin');
const record=id=>resident.readUInt32LE(0x80041838+12*id-0x80010000);
const byte=id=>record(id)?resident[record(id)-0x80010000]:0;
test('the catalog covers the shipped master item rows, with no missing member',()=>{
  assert.deepEqual(Object.keys(ITEM_BY_ID).map(Number).filter(id=>id>0).sort((a,b)=>a-b),shipped.map(r=>r.id));
  for(const row of shipped) assert.ok(ITEM_BY_ID[row.id].name);
});
test('field and battle admissions equal the effect-record gates for the whole catalog',()=>{
  for(const {id,category} of shipped) {
    // Gear has a different list; its effect byte is a wear mask, not a use mask.
    const consumable=category==='consumable'||category==='booster';
    assert.equal(itemUsableInField(id),consumable && (byte(id)&1)!==0,`field ${id}`);
    assert.equal(itemUsableInBattle(id),consumable && (byte(id)&2)!==0,`battle ${id}`);
  }
});
test('equipment members and battle effect handlers equal the decoded data populations',()=>{
  assert.deepEqual(EQUIPMENT.map(r=>r.id).sort((a,b)=>a-b),shipped.filter(r=>['equipment','accessory'].includes(r.category)).map(r=>r.id));
  const effectHandlers=[];
  for(let i=0;i<48;i++) {
    const ptr=overlay.readUInt32LE(0x80082f1c-0x80082cb0+i*4);
    if(ptr!==0x8008dc00) effectHandlers.push(i+43);
  }
  assert.deepEqual(shipped.filter(r=>isBattleEffectItem(r.id)).map(r=>r.id),effectHandlers);
});
test('the durable route census has one row per shipped member',()=>{
  const census=JSON.parse(readFileSync('docs/generated/item-routes.json','utf8')).items;
  assert.deepEqual(census.map(r=>r.id),shipped.map(r=>r.id));
  for(const row of census) {
    assert.equal(Boolean(row.fieldUse),itemUsableInField(row.id));
    assert.equal(Boolean(row.pauseUse),itemUsableInField(row.id));
    assert.equal(Boolean(row.battleUse),itemUsableInBattle(row.id));
  }
});

test('each item has a reader decision and negative searches name their corpus',()=>{
  const census=JSON.parse(readFileSync('docs/generated/item-routes.json','utf8'));
  assert.ok(census.readerSearch.original.files>0);
  assert.ok(census.readerSearch.converted.sceneFiles>0);
  for(const item of census.items) {
    assert.ok(Array.isArray(item.readers),`item ${item.id}`);
    assert.equal(item.readerDecision.status,item.readers.some(r=>r.kind!=='inventory_directory')?'readers_found':'no_special_reader_in_searched_corpus');
    if(!item.readers.some(r=>r.kind!=='inventory_directory')) assert.equal(item.readerDecision.search,'readerSearch');
  }
});
test('route members equal original extracted NPC/step readers and native calls',()=>{
  const routes=JSON.parse(readFileSync('docs/generated/item-routes.json','utf8')).items;
  const original=JSON.parse(readFileSync('docs/generated/item-native-readers.json','utf8'));
  const references=routes.flatMap(r=>r.readers.map(reader=>({id:r.id,reader})));
  for(const [kind,members] of [['readers',original.readers],['tables',original.tables]]) {
    assert.deepEqual(references.filter(r=>r.reader.original?.startsWith(`docs/generated/item-native-readers.json#/${kind}/`)).map(r=>r.reader.original).sort(),members.map((_,i)=>`docs/generated/item-native-readers.json#/${kind}/${i}`).sort());
    members.forEach((m,index)=>{
      const route=references.find(r=>r.reader.original===`docs/generated/item-native-readers.json#/${kind}/${index}`);
      assert.equal(route.id,m.item_id);
      assert.equal(route.reader.expected,m.expected??m.a1);
    });
  }
  // 0x92 is card ownership, so a card id must never enter the item census.
  for(const {reader} of references.filter(r=>r.reader.flag&&r.reader.kind!=='compound_possession'))
    assert.ok(((reader.flag>>8)&0xfe)>=0x80&&((reader.flag>>8)&0xfe)<=0x8e);
});
test('converted step reader census covers both conditions of every opcode',()=>{
  const routes=JSON.parse(readFileSync('docs/generated/item-routes.json','utf8')).items;
  const actual=routes.flatMap(r=>r.readers.filter(x=>x.kind==='converted_step').map(x=>[x.stage,x.who,x.op,x.flag,x.expected]));
  const steps=JSON.parse(readFileSync('web/assets/data/story_steps.json','utf8')).stages;
  const expected=[];
  for(const [stage,program] of Object.entries(steps)) for(const [i,s] of program.steps.entries())
    for(const arm of ['a','b']) {
      const flag=s[`cond_${arm}`];const bank=(flag>>8)&0xfe;
      if(bank>=0x80&&bank<=0x8e)expected.push([`s${stage}`,i,s.op,flag,s[`arg_${arm}`]]);
    }
  assert.deepEqual(actual.map(JSON.stringify).sort(),expected.map(JSON.stringify).sort());
});

test('directory and Cardmon reward consumers cover their decoded populations',()=>{
 const routes=JSON.parse(readFileSync('docs/generated/item-routes.json','utf8')).items;
 assert.deepEqual(routes.filter(r=>r.readers.some(x=>x.kind==='inventory_directory')).map(r=>r.id),shipped.map(r=>r.id));
 const table=JSON.parse(readFileSync('web/assets/data/cardmon_boosters.json','utf8'));
 const ids=new Set();
 for(const group of [table.odd,table.even,{default:table.default}])for(const c of Object.values(group))for(const pair of [c,c.story2d])if(pair){ids.add(pair.nz);ids.add(pair.z);}
 assert.deepEqual(routes.filter(r=>r.readers.some(x=>x.kind==='cardmon_booster_reward')).map(r=>r.id),[...ids].sort((a,b)=>a-b));
});
