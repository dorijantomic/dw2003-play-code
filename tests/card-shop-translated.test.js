import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CardShopSession } from '../engine/dw3/ui/card-shop-session.ts';
import { bindCardPacks } from '../engine/dw3/ui/card-pack-store.ts';
import { createCollection, grantPack } from '../engine/systems/card-battle.ts';

const bytes=(file)=>new Uint8Array(readFileSync(file));
const json=(file)=>JSON.parse(readFileSync(file,'utf8'));
const catalog=json('web/assets/data/shop_catalog.json');
const records=bytes(`web/assets/data/${catalog.itemRecords.file}`);
const dirs=catalog.inventoryDirectories.filter((r)=>r.category===1).flatMap((r)=>r.items);
const boosterItems=[...new Set(dirs.filter((id)=>catalog.itemIconClips.bytes[records[id*12+9]]===0x62))];
const resources={
  font:bytes('web/assets/data/shop_font.bin'),cursorGlyphs:catalog.cursorGlyphs,
  banks:new Map([0x16,0x1d,0x32,0x6a,0x94].map((o)=>[o+2,
    bytes(o===0x6a||o===0x94?`web/assets/data/shop-banks/${o+2}.bin`:`web/cardshop-data/${o+2}.bin`)])),
  tables:bytes('web/cardshop-data/tables.bin'),shops:json('web/assets/data/card_shops.json').shops,
  prices:json('web/assets/data/card_prices.json').prices,boosters:json('web/assets/data/card_boosters.json').sets,
  cards:json('web/assets/data/card_catalog.json').cards,boosterItems,itemIcons:new Map(),
};
const open=(shop=0x31,bits=20000)=>{
  const col=createCollection();const wallet={bits};const sounds=[];
  const session=new CardShopSession(shop,2,wallet,col,resources,(id)=>sounds.push(id),()=>0,0x270);
  return {session,col,wallet,sounds};
};
function until(s,predicate,label){for(let i=0;i<400;i++){if(predicate())return;s.tick();}assert.fail(`Timed out: ${label}; ${s.mem.read32(s.root+0x10)}/${s.child?.state}/${s.child?.reveal?.mode}`);}
function press(s,key){s.tick([key]);s.tick();}
function root(s){until(s,()=>s.mem.read32(s.root+0x10)===3,'root');}
function buy(s){root(s);press(s,'circle');until(s,()=>s.child?.kind==='buy'&&s.child.state===2,'stock');}
function pick(s){press(s,'circle');until(s,()=>[7,12].includes(s.child?.state),'confirm or refusal');}

test('three card-shop dispatch populations equal original pointer tables',()=>{
  const image=Buffer.from(bytes('web/assets/native/screens/pro_stcrdshp.bin'));
  for(const [file,start,end,offset,count] of [
    ['engine/dw3/ui/card-shop-session.ts','private tickBooster()', 'private placePackCursor()',0,61],
    ['engine/dw3/ui/card-shop-session.ts','private tickBuy()', 'private tickBooster()',61*4,52],
    ['engine/dw3/ui/native/card-shop-tick.ts','export function shopRootTick','\0',(61+52)*4,102],
  ]){
    const source=readFileSync(file,'utf8');const tail=source.slice(source.indexOf(start));
    const body=end==='\0'?tail:tail.slice(0,tail.indexOf(end));
    const implemented=[...body.matchAll(/case\s+(0x[\da-f]+|\d+)\s*:/gi)].map((m)=>Number(m[1])).sort((a,b)=>a-b);
    const defaults=image.readUInt32LE(offset);
    const decoded=Array.from({length:count},(_,state)=>state).filter((state)=>image.readUInt32LE(offset+state*4)!==defaults);
    assert.deepEqual(implemented,decoded,start);
  }
  assert.deepEqual([...boosterItems].sort((a,b)=>a-b),resources.boosters.map((r)=>r.setId).sort((a,b)=>a-b),
    'every resident pack item has a decoded pool record');
  const source=readFileSync('web/game.js','utf8');
  assert.match(source,/: cardShopTranslated;/,'ordinary route must run translated shop');
});

test('all stock records buy one card, pay once, close and retain a full folder',()=>{
  for(const stock of resources.shops){
    const {session:s,col,wallet}=open(stock.shopId,20000);
    col.folders=[{name:'Full',cards:Array(40).fill(1)}];
    buy(s);assert.deepEqual(s.child.stock,stock.cardIds);
    pick(s);const id=stock.cardIds[0],price=s.price(id);press(s,'circle');
    assert.equal(col.owned.get(id),1);assert.equal(wallet.bits,20000-price);
    until(s,()=>s.child?.state===2,'stock after purchase');
    assert.equal(wallet.bits,20000-price);
    assert.equal(col.folders[0].cards.length,40,'buy never inserts into a folder');
    press(s,'cross');root(s);press(s,'cross');until(s,()=>s.finished(),'field return');
  }
});

test('BIT refusal precedes nine copies and Buy/No; dismissal returns without charging',()=>{
  for(const [bits,owned,message] of [[0,9,19],[20000,9,20]]){
    const {session:s,col,wallet}=open(0x31,bits);col.owned.set(65,owned);
    buy(s);pick(s);assert.equal(s.child.state,12);assert.equal(s.child.message,message);
    press(s,'cross');until(s,()=>s.child?.state===2,'return from refusal');
    assert.equal(wallet.bits,bits);assert.equal(col.owned.get(65),owned);
  }
});

test('No and Cancel do not grant or charge; held confirm cannot buy again',()=>{
  for(const cancel of [false,true]){
    const {session:s,col,wallet}=open();buy(s);pick(s);
    if(cancel)press(s,'cross');else{press(s,'down');press(s,'circle');}
    until(s,()=>s.child?.state===2,'cancelled stock');assert.equal(wallet.bits,20000);assert.equal(col.owned.size,0);
  }
  const {session:s,col}=open();buy(s);pick(s);for(let i=0;i<70;i++)s.tick(['circle']);
  assert.equal(col.owned.get(65),1);
});

test('every booster consumes one pack and draws one id from each pool; returns to root',()=>{
  for(const set of resources.boosters){
    const {session:s,col}=open();col.packs.set(set.setId,1);root(s);press(s,'down');press(s,'circle');
    until(s,()=>s.child?.kind==='booster'&&s.child.state===4,'pack list');
    assert.deepEqual(s.child.packs,[set.setId]);press(s,'circle');
    until(s,()=>s.child?.state===13,'revealed pack');
    assert.equal(col.packs.get(set.setId),0);
    assert.deepEqual(s.child.reveal.cards,set.pools.map((p)=>p.cards[0]));
    assert.ok(s.child.reveal.cards.every((id)=>col.seen.has(id)));
    press(s,'cross');root(s);
  }
});

test('no boosters refuses at root; Edit Folder fades then hands off',()=>{
  const {session:s,sounds}=open();root(s);press(s,'down');press(s,'circle');
  until(s,()=>s.mem.read32(s.root+0x10)===22,'no boosters');assert.equal(s.child,null);
  press(s,'circle');root(s);assert.ok(sounds.includes(0x4001c));
  press(s,'down');press(s,'circle');until(s,()=>s.finished(),'folder handoff');assert.equal(s.transition,0x400);
});


test('the entire booster family shares the item bag for opening, rewards, persistence and reset',()=>{
  const col=createCollection();const state={inventory:[]};
  col.packs.set(boosterItems[0],2);bindCardPacks(col,state,boosterItems);
  for(const id of boosterItems) {
    grantPack(col,id,3);assert.equal(state.inventory.find((r)=>r.id===id).qty,id===boosterItems[0]?5:3);
    col.packs.set(id,col.packs.get(id)-1);assert.equal(state.inventory.find((r)=>r.id===id).qty,id===boosterItems[0]?4:2);
  }
  assert.equal([...col.packs].length,boosterItems.length);
  state.inventory=[{id:boosterItems[1],qty:8}];assert.equal(col.packs.get(boosterItems[1]),8);
  col.packs.clear();assert.equal(col.packs.size,0);assert.equal(state.inventory.length,0);
});

test('card-state reward saving persists the shared bag as well as the collection',async()=>{
  const cs=await import('../web/cardstate.js');const {ui}=await import('../web/vendor/engine.js');
  const state={inventory:[]};const col=cs.cards();ui.bindCardPacks(col,state,boosterItems);
  grantPack(col,boosterItems[0],4);
  const saved=new Map();cs.persistCollection({setItem:(key,value)=>saved.set(key,value)});
  assert.deepEqual(JSON.parse(saved.get('inventory')),[{id:boosterItems[0],qty:4}]);
  assert.deepEqual(JSON.parse(saved.get('cardCollection')).packs,[[boosterItems[0],4]]);
});
