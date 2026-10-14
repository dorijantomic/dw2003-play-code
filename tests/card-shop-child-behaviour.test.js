// The card shop's child flows against the original's construction-time writes.
//
// Audit 2026-10-14 (audit/card-album-vs-decode). Three clauses were missing or
// wrong in engine/dw3/ui/card-shop-session.ts:
//
//   1. F0x8008300C (pack-open windows) creates the pack-list cursor and then
//      calls its +0x80(0): `sw a0, 0x20(s3); lw v0, 0x80(a0); jalr v0; a1 = 0`
//      (stcrdshp 0x8008300c 0x80083404-0x80083418). F0x80086074 does the same
//      for the buy screen's confirm cursor at +0x44 (0x80086074 0x800035A0-
//      0x800035B4). F0x8001B364 leaves +0x64 = 1, so without the hide the
//      cursor glyph shows while the list folds open / while you browse.
//   2. F0x80083780 (the revealed card's panel) hides the whole panel when the
//      card's ever-obtained byte [0x80048D34 + id + 0x4DF] is zero
//      (0x80083780 0x80083780+0x18C: `lbu 0x4DF(s2); beqz` -> hide-all).
//   3. F0x80085678 (the six revealed cards) stops the draw at the first slot
//      whose id is out of range (0x80085678 0x8008569C: `addiu v0, a0, -1;
//      sltiu v0, 0x13A; beqz v0` -> epilogue), rather than skipping that slot.
//
// Clauses 2 and 3 cannot fire with the shipped data (a pack grants its cards
// before the panel fills; every pool id is 1..0x13A), but each is a behaviour
// the original has and the walker did not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CardShopSession } from '../engine/dw3/ui/card-shop-session.ts';
import { createCollection } from '../engine/systems/card-battle.ts';

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
function until(s,predicate,label){for(let i=0;i<600;i++){if(predicate())return;s.tick();}assert.fail(`Timed out: ${label}; ${s.mem.read32(s.root+0x10)}/${s.child?.state}/${s.child?.reveal?.mode}`);}
function press(s,key){s.tick([key]);s.tick();}
const root=(s)=>until(s,()=>s.mem.read32(s.root+0x10)===3,'root');
const icon=(s,slot)=>s.mem.read32(s.child.context+slot)>>>0;
const visible=(s,slot)=>s.mem.read32(icon(s,slot)+0x64)|0;

test('both child cursors are hidden the moment the original hides them',()=>{
  // Buy One Card: F0x80086074 stores the confirm cursor at +0x44 and hides it.
  {
    const {session:s}=open();
    root(s);press(s,'circle');
    until(s,()=>s.child?.kind==='buy'&&s.child.state===0,'buy child created');
    assert.equal(visible(s,0x44),0,'the buy confirm cursor is hidden at creation (F0x80086074)');
    until(s,()=>s.child?.state===2,'stock list');
    assert.equal(visible(s,0x44),0,'still hidden while browsing the stock list');
    press(s,'circle');
    until(s,()=>s.child?.state===7,'BUY/NO panel');
    assert.equal(visible(s,0x44),1,'the confirm panel shows it (F0x800874D0)');
  }
  // Open Booster: F0x8008300C stores the pack-list cursor at +0x20 and hides it.
  {
    const {session:s,col}=open();
    col.packs.set(boosterItems[0],1);
    root(s);press(s,'down');press(s,'circle');
    until(s,()=>s.child?.kind==='booster'&&s.child.state===0,'booster child created');
    assert.equal(visible(s,0x20),0,'the pack-list cursor is hidden at creation (F0x8008300C)');
    until(s,()=>s.child?.state===3,'pack list');
    assert.equal(visible(s,0x20),1,'the filled list shows it (F0x80084580)');
  }
});

test('the revealed-card panel hides for a card the player has never held',()=>{
  const {session:s,col}=open();
  col.packs.set(boosterItems[0],1);
  root(s);press(s,'down');press(s,'circle');
  until(s,()=>s.child?.kind==='booster'&&s.child.state===4,'pack list');
  press(s,'circle');
  until(s,()=>s.child?.state===13,'revealed pack');
  const context=s.child.context;
  const nameWidget=s.mem.read32(context+0x4c)>>>0;
  const log=[];
  const w=s.widgets;
  const set=w.textSet,show=w.textShow;
  w.textSet=(widget,source,index)=>{log.push(['set',widget>>>0,source>>>0,index]);return set(widget,source,index);};
  w.textShow=(widget,value)=>{log.push(['show',widget>>>0,value]);return show(widget,value);};
  // The revealed card was granted, so its panel fills.
  press(s,'right');
  assert.ok(log.some((e)=>e[0]==='set'&&e[1]===nameWidget),'the owned card fills the name widget');
  assert.equal(s.child.revealCursor,1,'the reveal cursor moved');
  // Forget the cards: the original's +0x4DF byte is now zero for them.
  for(const id of s.child.reveal.cards)col.seen.delete(id);
  log.length=0;
  press(s,'left');
  assert.ok(!log.some((e)=>e[0]==='set'&&e[1]===nameWidget),'an un-held card does not fill the name widget');
  assert.ok(log.some((e)=>e[0]==='show'&&e[1]===nameWidget&&e[2]===0),'the panel hides instead (F0x80083780)');
  w.textSet=set;w.textShow=show;
});

test('the six-card draw stops at the first out-of-range slot',()=>{
  const {session:s,col}=open();
  col.packs.set(boosterItems[0],1);
  root(s);press(s,'down');press(s,'circle');
  until(s,()=>s.child?.kind==='booster'&&s.child.state===4,'pack list');
  press(s,'circle');
  until(s,()=>s.child?.state===13,'revealed pack');
  const r=s.child.reveal;
  r.mode=3;r.cards=[1,0,3,4,5,6];r.visible=6;
  s.tick([]);
  const sprites=s.draw.calls.filter((c)=>c.method==='cardSprite');
  assert.equal(sprites.length,1,'only the slot before the bad id drew (F0x80085678 aborts the loop)');
  assert.equal(sprites[0].args[0],1,'and it is the first card');
});
