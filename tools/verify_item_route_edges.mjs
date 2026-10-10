import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { baseUrl } from './verify-base-url.mjs';
const out='.bunny-scratch/item-route-edges'; mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:960,height:720}});
 await page.goto(`${baseUrl(8983)}/index.html?skipTitle=1&noEncounters=1&legacyStatus=1`);
 await page.waitForFunction(()=>window.__state?.started&&window.__menu);
 await page.evaluate(async()=>{
  const menu=window.__menu;
  menu.openAt('items'); window.__state.menuOpen=true;
  // Use the page's species database; wait for its normal lazy fetch.
 });
 await page.waitForFunction(()=>window.__menu.digimonDB);
 const seeded=await page.evaluate(async()=>{
  const s=window.__state,m=window.__menu;
  const {partyRosterView,baseStatsFor,CHARID_TO_DIGID}=await import('/party.js');
  s.party=['p003pken'];s.partyStats=[];s.partnerStats=baseStatsFor(m.digimonDB[CHARID_TO_DIGID[s.party[0]]]);
  const profile=partyRosterView(s.party,s.partnerStats,s.partyStats,m.digimonDB,s.digimonNames)[0].profile;
  const base=Number(profile?.resistances?.fire??0);
  s.partnerStats.elemBonuses={fire:999-base};
  s.inventory=[{id:55,qty:2}];
  m.feedbackMsg=null; m.itemMode='use_target';m.itemCat=0;m.itemCursor=0;m.itemTarget=0;
  return {base,points:s.partnerStats.elemBonuses.fire};
 });
 assert.ok(seeded.base>0,'real lead profile has a fire resistance');
 const shot=async name=>writeFileSync(`${out}/${name}.png`,Buffer.from((await page.locator('canvas#game').evaluate(el=>el.toDataURL('image/png'))).split(',')[1],'base64'));
 await page.waitForTimeout(200); await shot('before-confirm');
 await page.evaluate(()=>window.__menu.handleKey('circle',window.__state));
 const after=await page.evaluate(()=>({points:window.__state.partnerStats.elemBonuses.fire,qty:window.__state.inventory[0].qty,message:window.__menu.feedbackMsg}));
 assert.equal(after.points,seeded.points);assert.equal(after.qty,2);assert.equal(after.message,'No effect.');
 await page.waitForTimeout(200); await shot('after-refusal');
 const stats=await page.evaluate(async()=>{
  const {useBattleItem}=await import('/vendor/engine.js');
  const user={hp:100,maxHp:100,str:101,def:101,spd:101,ailments:{}};
  const enemy={...user,ailments:{}};
  useBattleItem(73,user,enemy);useBattleItem(87,user,enemy);
  return {user:user.buffs,enemy:enemy.buffs};
 });
 assert.equal(stats.user.def,-12);assert.equal(stats.enemy.str,30);assert.equal(stats.enemy.def,-50);
 writeFileSync(`${out}/result.json`,JSON.stringify({seeded,after,stats},null,2)+'\n');
 console.log('PASS: legacy chip refusal preserves the copy; browser battle stat arithmetic matches the port');
} finally {await browser.close();}
