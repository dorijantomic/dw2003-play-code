import { chromium } from 'playwright';
import { selectAuthentic } from './select-authentic.mjs';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { navigate } from './field-navigator.mjs';
import { baseUrl } from "./verify-base-url.mjs";

const out=`.dw3-research/lobby-navigation-${Date.now()}`;
mkdirSync(out,{recursive:true});
const log=e=>{appendFileSync(`${out}/trace.jsonl`,JSON.stringify({time:Date.now(),...e})+'\n');if(e.type!=='move')console.log(JSON.stringify(e));};
const recorded=JSON.parse(readFileSync('.dw3-research/manual-lobby-route/latest.json','utf8'));
const events=readFileSync(recorded.log,'utf8').trim().split('\n').map(JSON.parse).flatMap(r=>r.type==='batch'?r.events:[]);
const releases=events.filter(e=>e.type==='keyup'&&e.state?.map==='s210');
// Three widely separated destinations actually visited in the demonstration,
// then the recorded starting point. Routes are calculated, not replayed keys.
const goals=[releases[0].state,releases[2].state,releases[19].state,{x:448,y:320}].map(({x,y})=>({x,y}));
const browser=await chromium.launch({headless:false});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try {
  await page.goto(`${baseUrl(8741)}/?skipTitle=1&map=s210`);
  await selectAuthentic(page);
  await page.waitForFunction(()=>window.__state?.started&&document.getElementById('asset-mode-screen')?.hidden);
  await page.waitForTimeout(2500);
  await page.evaluate(()=>document.title='Collision-aware lobby navigation test');
  await page.screenshot({path:`${out}/before.png`});
  log({type:'fixture',map:'s210',recording:recorded.log,goals});
  for(let i=0;i<goals.length;i++) {
    await navigate(page,goals[i],{log});
    await page.screenshot({path:`${out}/arrival-${i}.png`});
  }
  if(errors.length)throw Error(errors.join('\n'));
  await page.screenshot({path:`${out}/after.png`});
  log({type:'PASS',destinations:goals.length,errors,artifacts:out});
} catch(e) {
  log({type:'FAIL',message:String(e),errors,artifacts:out});
  await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});
  process.exitCode=1;
} finally { await browser.close(); }
