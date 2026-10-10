import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCollection, grantPack, openPack, packCount, serializeCollection, deserializeCollection } from '../engine/systems/card-battle.ts';
import { bindBoosterStock, seedBoosterStock, commitBoosterStock, BOOSTER_HELD_BASE } from '../engine/dw3/booster-stock.ts';
import { BOOSTER_ITEM_IDS } from '../engine/dw3/booster-items.ts';
import { addItem, heldCount, removeItem } from '../engine/dw3/item-store.ts';
const sets=JSON.parse(readFileSync('web/assets/data/card_boosters.json')).sets;

test('pack stock members equal the decoded table, including Booster 01a',()=>{
  assert.deepEqual([...BOOSTER_ITEM_IDS],sets.map(s=>s.setId));
});
test('each earned bag booster opens its own six pools and consumes the carried copy',()=>{
  for (const set of sets) {
    const state={inventory:[]}; const col=createCollection();
    bindBoosterStock(col,state,BOOSTER_ITEM_IDS);
    addItem(state,set.setId,2);
    assert.equal(packCount(col,set.setId),2,`set ${set.setId}`);
    assert.deepEqual(openPack(col,set.setId,set.pools.map(p=>p.cards),()=>0),set.pools.map(p=>p.cards[0]));
    assert.equal(heldCount(state,set.setId),1);
    for(const id of set.pools.map(p=>p.cards[0])) assert.ok(col.seen.has(id));
    removeItem(state,set.setId,1);
    assert.equal(openPack(col,set.setId,set.pools.map(p=>p.cards)),null);
  }
});
test('duel rewards, bag possession and the card shop share stock, capped at 99',()=>{
  for(const id of BOOSTER_ITEM_IDS) {
    const state={inventory:[]}; const col=createCollection();
    bindBoosterStock(col,state,BOOSTER_ITEM_IDS);
    addItem(state,id,98); grantPack(col,id,3);
    assert.equal(heldCount(state,id),99);
    assert.equal(packCount(col,id),99);
    col.packs.delete(id); assert.equal(heldCount(state,id),0);
  }
});
test('old saves migrate once and binding never adds a second stock',()=>{
  const state={inventory:[{id:375,qty:2},{id:43,qty:9}]}; const col=createCollection();
  grantPack(col,375,3); grantPack(col,91,1);
  bindBoosterStock(col,state,BOOSTER_ITEM_IDS);
  assert.equal(heldCount(state,375),3); assert.equal(heldCount(state,91),1);
  removeItem(state,375,3); bindBoosterStock(col,state,BOOSTER_ITEM_IDS);
  assert.equal(heldCount(state,375),0);
  const saved=deserializeCollection(serializeCollection(col));
  assert.deepEqual([...saved.packs],[[91,1]]);
  col.packs.clear(); assert.deepEqual(state.inventory,[{id:43,qty:9}]);
});
test('both original-code adapters seed the same stock and commit opening or a reward',()=>{
  const state={inventory:BOOSTER_ITEM_IDS.map(id=>({id,qty:2})).concat({id:43,qty:5})};
  const memory=new Map();
  seedBoosterStock(state,BOOSTER_ITEM_IDS,(addr,n,size)=>{assert.equal(size,1); memory.set(addr,n);});
  assert.equal(memory.size,sets.length);
  for(const id of BOOSTER_ITEM_IDS) memory.set(BOOSTER_HELD_BASE+id,id===91?3:1);
  commitBoosterStock(state,BOOSTER_ITEM_IDS,(addr,size)=>{assert.equal(size,1);return memory.get(addr);});
  assert.equal(heldCount(state,91),3); assert.equal(heldCount(state,375),1); assert.equal(heldCount(state,43),5);
  for(const file of ['web/cardshop-native.js','web/cardduel-native.js']) {
    const source=readFileSync(file,'utf8');
    assert.match(source,/seedBoosterStock\(state, BOOSTER_ITEM_IDS, write\)/);
    assert.match(source,/commitBoosterStock\(state, BOOSTER_ITEM_IDS/);
  }
});
