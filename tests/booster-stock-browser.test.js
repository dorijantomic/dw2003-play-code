import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const saved=new Map([['inventory',JSON.stringify([{id:375,qty:2}])]]);
globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
globalThis.fetch=async path=>({json:async()=>JSON.parse(readFileSync(`web/${path}`,'utf8'))});
const cs=await import('../web/cardstate.js');
const state={inventory:[{id:375,qty:2}]};
cs.bindCardInventory(state);
await Promise.all([cs.loadBoosters(),cs.loadCatalog()]);
test('the real browser card API opens an earned bag pack and persists the shared count',()=>{
 assert.deepEqual(cs.heldPackSets(),[375]);
 assert.equal(cs.openBooster(375,()=>0).length,6);
 assert.equal(state.inventory.find(s=>s.id===375).qty,1);
 assert.equal(JSON.parse(saved.get('inventory')).find(s=>s.id===375).qty,1);
});
test('the real browser duel reward updates bag possession and persists it',()=>{
 state.inventory=[{id:375,qty:2}];
 cs.grantPackForOpponent({packSetId:375});
 assert.equal(state.inventory.find(s=>s.id===375).qty,3);
 assert.equal(JSON.parse(saved.get('inventory')).find(s=>s.id===375).qty,3);
 assert.equal(cs.cards().packs.get(375),3);
});
