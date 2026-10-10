// Seeded browser proof: an item-bag pack appears at the real card shop, opens,
// grants six cards, consumes one copy and persists. All 35 sets also pass the
// independent engine census. The before capture reproduces the former detached
// stock Map; it is explicitly a reproduction, not a capture of an old checkout.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { baseUrl } from './verify-base-url.mjs';
const ROOT=baseUrl(8983);
const OUT='.bunny-scratch/booster-inventory';
mkdirSync(OUT,{recursive:true});
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:640,height:480}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  if (localStorage.getItem('engineSchema') === '2') return;
  localStorage.clear();localStorage.setItem('engineSchema','2');
  localStorage.setItem('playerName','Junior');localStorage.setItem('assetMode','authentic');
  localStorage.setItem('inventory',JSON.stringify([{id:375,qty:2}]));
  localStorage.setItem('party',JSON.stringify(['p003pken','p005koet','p004kogu']));
  localStorage.setItem('charId','p003pken');
 });
 await page.goto(`${ROOT}/?skipTitle=1&map=s210&noEncounters=1&legacyCardShop=1`);
 await page.waitForFunction(()=>window.__state?.started&&window.__labOpen);
 await page.evaluate(async()=>{const cs=await import('./cardstate.js');await Promise.all([cs.loadBoosters(),cs.loadCatalog()]);});
 const screenshot=async(name)=>{
  await page.waitForTimeout(100);
  await page.locator('canvas#game').screenshot({path:`${OUT}/${name}.png`});
 };
 const before=await page.evaluate(async()=>{
  const cs=await import('./cardstate.js');cs.cards().packs=new Map();
  window.__labOpen('cardshop');
  const shop=window.__cardShopLegacy;shop.handleKey('down',window.__state);shop.handleKey('circle',window.__state);
  return {screen:shop.screen,message:shop.message,stock:cs.heldPackSets(),bag:window.__state.inventory};
 });
 assert.equal(before.stock.length,0);assert.equal(before.screen,'root');
 await screenshot('before-detached-stock');
 const after=await page.evaluate(async()=>{
  const cs=await import('./cardstate.js');cs.bindCardInventory(window.__state);
  const shop=window.__cardShopLegacy;shop.handleKey('circle',window.__state);
  return {screen:shop.screen,stock:cs.heldPackSets(),bag:window.__state.inventory};
 });
 assert.equal(after.screen,'booster');assert.deepEqual(after.stock,[375]);
 await screenshot('after-bag-stock');
 const result=await page.evaluate(async()=>{
  const cs=await import('./cardstate.js');const shop=window.__cardShopLegacy;
  const beforeOwned=new Map(cs.cards().owned);
  shop.handleKey('circle',window.__state);
  const pull=shop.lastPull.map(c=>c.id);
  const frequency=new Map();for(const id of pull)frequency.set(id,(frequency.get(id)??0)+1);
  return {screen:shop.screen,pull,counts:[...frequency].map(([id,n])=>[id,beforeOwned.get(id)??0,cs.cards().owned.get(id),n]),bag:window.__state.inventory,saved:JSON.parse(localStorage.getItem('inventory')),seen:pull.every(id=>cs.cards().seen.has(id)),packStock:cs.cards().packs.get(375)};
 });
 assert.equal(result.screen,'reveal');assert.equal(result.pull.length,6);assert.ok(result.seen);
 assert.equal(result.bag.find(s=>s.id===375).qty,1);assert.equal(result.saved.find(s=>s.id===375).qty,1);
 assert.equal(result.packStock,1);
 for(const [id,old,count,n]of result.counts)assert.equal(count,Math.min(old+n,9),`card ${id}`);
 await page.waitForTimeout(1100);
 await screenshot('after-six-cards');
 await page.reload();await page.waitForFunction(()=>window.__state?.started);
 const reload=await page.evaluate(async()=>{const cs=await import('./cardstate.js');await cs.loadBoosters();return {bag:window.__state.inventory,stock:cs.cards().packs.get(375)};});
 assert.equal(reload.stock,1);assert.equal(reload.bag.find(s=>s.id===375).qty,1);assert.deepEqual(errors,[]);
 // The original-code adapter (?nativeCardShop=1) must expose the same held byte to its shop.
 await page.goto(`${ROOT}/?skipTitle=1&map=s210&noEncounters=1&nativeCardShop=1`);
 await page.waitForFunction(()=>window.__state?.started);
 await page.evaluate(()=>window.__labOpen('cardshop',0x31));
 await page.waitForFunction(()=>window.__cardShopNative?._host);
 await page.waitForTimeout(1200);
 const nativeBefore=await page.evaluate(()=>window.__nativeScreenRead(0x80048db0+375,1));
 assert.equal(nativeBefore,1,'bag pack seeded into the default card-shop adapter');
 const tap=async key=>{await page.keyboard.down(key);await page.waitForTimeout(100);await page.keyboard.up(key);await page.waitForTimeout(250);};
 await tap('ArrowDown');await tap('Enter');
 await screenshot('native-booster-list');
 for(let i=0;i<8;i++) {
  if(await page.evaluate(()=>window.__nativeScreenRead(0x80048db0+375,1)===0))break;
  await tap('Enter');
 }
 const nativeAfter=await page.evaluate(()=>({stock:window.__nativeScreenRead(0x80048db0+375,1),diagnostics:window.__cardShopNative.diagnostics()}));
 writeFileSync(`${OUT}/native-result.json`,JSON.stringify({nativeBefore,nativeAfter},null,2)+'\n');
 assert.equal(nativeAfter.stock,0,'default card shop opened the bag pack');
 await screenshot('native-after-opening');
 await page.evaluate(()=>window.__cardShopNative.close());
 const committed=await page.evaluate(()=>({bag:window.__state.inventory,saved:JSON.parse(localStorage.getItem('inventory'))}));
 assert.ok(!committed.bag.some(s=>s.id===375),'default shop committed consumption');
 assert.ok(!committed.saved.some(s=>s.id===375),'default shop persisted consumption');
 assert.deepEqual(errors,[]);
 writeFileSync(`${OUT}/result.json`,JSON.stringify({before,after,result,reload,nativeBefore,nativeAfter,committed,errors},null,2)+'\n');
 console.log('booster inventory PASS: bag pack -> shop -> six cards; stock 2 -> 1; reload 1');
} finally {await browser.close();}
