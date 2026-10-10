// Live field proof: the stage's own text bank, and the live bag picking the key-item line.
// No original emulator is involved.
//
// The "discarded gates" step this file used to take is gone: it re-read the shipped
// s971.json, installed it in place of the live record, and asserted the NPC had no line
// at all without the DNA. That was true of the shipped file until 2026-10-04, when the
// scene generator stopped dropping an ordered dialogue line whose text it could not
// resolve -- the same fix 374b9e3a made for the MetalGreymon pair. The shipped record
// now carries both lines, so the shipped-vs-runtime gap it photographed no longer exists,
// and what is checked instead is the record itself: two ordered lines, the first gated on
// the Agumon DDNA you carry.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { baseUrl } from './verify-base-url.mjs';
const OUT='.bunny-scratch/item-dialogue-gates';mkdirSync(OUT,{recursive:true});
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:640,height:480}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.clear();localStorage.setItem('engineSchema','2');localStorage.setItem('playerName','Junior');localStorage.setItem('assetMode','authentic');localStorage.setItem('inventory','[]');});
 await page.goto(`${baseUrl(8983)}/?skipTitle=1&map=s971&noEncounters=1`);
 await page.waitForFunction(()=>window.__state?.started&&window.__engine);
 const initial=await page.evaluate(()=>{
  const s=window.__state;s.entryKey=5;s.entryCompanion=2;s.x=240;s.y=628;s.dir='up';s.inventory=[];
  window.__storyFlags.set(0,0);window.__storyFlags.set(0x0a14,0);
  const npc=s.scenes.s971.npcs.find(n=>n.npc_id===123);window.__itemGateNpc=npc;
  return {bank:npc.dialogue_states[0].dialogue.file,target:window.__talkTarget(),lines:npc.dialogue_states.map(d=>d.dialogue.index),spawn:npc.spawn_flags.map(f=>[f.id,window.__storyFlags.get(f.id),f.expected])};
 });
 assert.equal(initial.bank,'estalk09');assert.equal(initial.target.npc,123);
 assert.equal(initial.target.state.dialogue.index,210);
 // Both ordered lines ship: the DNA-gated one first, the unconditional one behind it.
 assert.deepEqual(initial.lines.slice(0,2),[209,210],'the shipped s971 record carries every ordered line');
 await page.keyboard.press('Space');await page.waitForTimeout(2500);
 await page.locator('#game').screenshot({path:`${OUT}/after-no-ddna.png`});
 const denied=await page.evaluate(()=>({active:window.__dialogueBox.isOpen(),target:window.__talkTarget()}));
 assert.ok(denied.active);
 // Close the first line through its real return path before inspecting the item branch.
 for(let i=0;i<8;i++){await page.keyboard.press('Space');await page.waitForTimeout(100);if(!await page.evaluate(()=>window.__dialogueBox.isOpen()))break;}
 const owned=await page.evaluate(()=>{
  window.__state.inventory=[{id:6,qty:1}];
  return {predicate:window.__storyFlags.get(0x8006),target:window.__talkTarget()};
 });
 assert.equal(owned.predicate,1);assert.equal(owned.target.state.dialogue.index,209);
 await page.keyboard.press('Space');await page.waitForTimeout(2500);
 await page.locator('#game').screenshot({path:`${OUT}/after-owned-ddna.png`});
 assert.deepEqual(errors,[]);
 writeFileSync(`${OUT}/result.json`,JSON.stringify({initial,denied,owned,errors},null,2)+'\n');
 console.log('PASS: the shipped s971 record carries both ordered lines; live bag changes Agumon DDNA branch; correct descriptor bank; no page errors');
} finally {await browser.close();}
