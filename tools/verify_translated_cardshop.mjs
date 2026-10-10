// Ordinary translated card-shop route. One browser; executable assets denied
// until the Edit Folder hand-off, which opens the original folder screen
// (pro/stcrddek) exactly as the pause menu's Card Folders row does.
// Run: VERIFY_PORT=8985 tools/run-playwright.sh tools/verify_translated_cardshop.mjs .bunny-scratch/cardshop-after
import { chromium } from 'playwright';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { baseUrl } from './verify-base-url.mjs';
const out=process.argv[2]??'.bunny-scratch/cardshop-after';mkdirSync(out,{recursive:true});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:640,height:480}});
const errors=[],requests=[];const results=[];
page.on('pageerror',(e)=>errors.push(e.message));
page.on('console',(m)=>{if(m.type()==='error')errors.push(m.text());});
await page.route('**/assets/native/**',(route)=>{requests.push(route.request().url());return route.abort();});
await page.addInitScript(()=>{
  if(sessionStorage.getItem('translatedCardFixture'))return;
  sessionStorage.setItem('translatedCardFixture','1');
  for(const [key,value] of Object.entries({assetMode:'authentic',engineSchema:'2',playerName:'Junior',
    bits:'20000',inventory:'[]',equipment:'[]',charId:'p003pken',
    party:JSON.stringify(['p003pken','p009rena','p010pata']),
    cardCollection:JSON.stringify({owned:[],seen:[],folders:[],activeFolder:0,packs:[]}),
  }))localStorage.setItem(key,value);
});
const check=(name,ok,detail)=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' '+JSON.stringify(detail):''}`);};
const press=async(key)=>{await page.keyboard.down(key);await page.waitForTimeout(70);await page.keyboard.up(key);await page.waitForTimeout(100);};
const waitRoot=()=>page.waitForFunction(()=>window.__cardShopTranslated?.diagnostics().state===3,null,{timeout:10000});
const waitChild=(state)=>page.waitForFunction((state)=>window.__cardShopTranslated?.diagnostics().child?.state===state,state,{timeout:10000});
const shot=(name)=>page.locator('#game').screenshot({path:`${out}/${name}.png`});
const wallet=()=>page.evaluate(async()=>{const cs=await import('./cardstate.js');return {bits:window.__state.bits,owned:cs.ownedCount(cs.cards(),65),packs:[...cs.cards().packs]};});
const open=async(id=0x31)=>{await page.evaluate((id)=>window.__labOpen('cardshop',id),id);await waitRoot();};
try {
  await page.goto(`${baseUrl(8985)}/index.html?skipTitle=1&map=s270&noEncounters=1`);
  await page.waitForFunction(()=>window.__state?.started&&window.__labOpen);
  await open();await shot('root');check('ordinary route is translated',await page.evaluate(()=>window.__cardShop===window.__cardShopTranslated));
  await press('c');await waitChild(2);await shot('stock');
  await press('c');await waitChild(7);await shot('confirm');
  await press('c');await waitChild(2);await shot('purchased');
  const paid=await wallet();check('one card purchased for 10000 BIT',paid.bits===10000&&paid.owned===1,paid);
  await press('Escape');await waitRoot();await press('Escape');
  await page.waitForFunction(()=>!window.__cardShop.isOpen());await shot('field-return');
  await page.reload();await page.waitForFunction(()=>window.__state?.started);const reloaded=await wallet();
  check('money and card survive reload',reloaded.bits===10000&&reloaded.owned===1,reloaded);
  await page.evaluate(()=>{window.__state.bits=0;});await open();await press('c');await waitChild(2);
  await press('c');await waitChild(12);await shot('bit-refusal');
  check('BIT refusal appears before Buy/No',await page.evaluate(()=>window.__cardShop.diagnostics().child.message===19));
  await press('Escape');await waitChild(2);await page.evaluate(()=>window.__cardShop.close());
  await page.evaluate(async()=>{window.__state.bits=20000;const cs=await import('./cardstate.js');cs.cards().owned.set(65,9);});
  await open();await press('c');await waitChild(2);await press('c');await waitChild(12);await shot('nine-copy-refusal');
  check('nine copies refused before Buy/No',await page.evaluate(()=>window.__cardShop.diagnostics().child.message===20));
  await page.evaluate(()=>window.__cardShop.close());
  await open();await press('ArrowDown');await press('c');
  await page.waitForFunction(()=>window.__cardShop.diagnostics().state===22);await shot('no-boosters');
  check('empty boosters stays at root',await page.evaluate(()=>window.__cardShop.diagnostics().child===null));
  await press('c');await waitRoot();await page.evaluate(()=>window.__cardShop.close());
  await page.evaluate(async()=>{const cs=await import('./cardstate.js');cs.cards().packs.set(361,1);});
  await open();await press('ArrowDown');await press('c');await waitChild(4);await shot('booster-list');
  check('booster list reads the shared bag',await page.evaluate(()=>window.__state.inventory.find((r)=>r.id===361)?.qty===1));
  await press('c');await waitChild(13);await shot('reveal');
  check('pack spent and six cards revealed',await page.evaluate(async()=>{const cs=await import('./cardstate.js');return cs.cards().packs.get(361)===0&&window.__cardShop._session.child.reveal.cards.length===6;}));
  check('opening persists the shared bag',await page.evaluate(()=>!window.__state.inventory.some((r)=>r.id===361&&r.qty>0)&&!JSON.parse(localStorage.getItem('inventory')).some((r)=>r.id===361&&r.qty>0)));
  await press('Escape');await waitRoot();await press('ArrowDown');
  // Edit Folder (row 2). The hand-off is the one leg of this journey that runs
  // the original pro/stcrddek overlay: on the disc both this option and the
  // pause menu's Card Folders row launch screen code 0x400 = stcrddek
  // (docs/research/ui/stcrdshp-decoded-2026-07-12.md §0). Allow executable
  // assets from here on; the translated shop itself stays covered by the
  // request count read just before the hand-off.
  const shopRequests=requests.length;
  await page.unroute('**/assets/native/**');
  await press('c');
  await page.waitForFunction(()=>window.__cardDeckNative?.isOpen?.()===true,{timeout:20000});
  await page.waitForFunction(()=>{const d=window.__cardDeckNative?.diagnostics?.();return !!d&&!d.pending&&!!d.host;},{timeout:20000}).catch(()=>{});
  await shot('folder-handoff');
  const handoff=await page.evaluate(()=>{const d=window.__cardDeckNative?.diagnostics?.();return {shopOpen:window.__cardShop.isOpen(),sameAdapter:window.__cardDeck===window.__cardDeckNative,open:d?.open===true,module:d?.host?.module??null};});
  check("Edit Folder opens the pause menu's native folder screen",handoff.shopOpen===false&&handoff.sameAdapter===true&&handoff.open===true&&handoff.module==='pro/stcrddek',handoff);
  check('the translated shop asked for no executable asset before the folder hand-off',shopRequests===0,`${shopRequests} request(s)`);
  // Triangle (x) is the folder editor's own Back; it commits and leaves.
  for(let i=0;i<6;i++){if(await page.evaluate(()=>window.__cardDeckNative?.isOpen?.()!==true))break;await press('x');}
  await page.waitForFunction(()=>window.__cardDeckNative?.isOpen?.()===false,{timeout:15000}).catch(()=>{});
  check('triangle leaves the folder screen back to the field',await page.evaluate(()=>window.__cardDeckNative?.isOpen?.()===false));
  const stocks=JSON.parse(readFileSync('web/assets/data/card_shops.json','utf8')).shops;
  for(const stock of stocks){await open(stock.shopId);await press('c');await waitChild(2);
    const actual=await page.evaluate(()=>window.__cardShop.diagnostics().child.stock);
    check(`stock ${stock.shopId}`,JSON.stringify(actual)===JSON.stringify(stock.cardIds));
    await page.evaluate(()=>window.__cardShop.close());
  }
  check('no executable asset requested by the translated shop',shopRequests===0,requests);
  check('no page errors',errors.length===0,errors);
}catch(error){check('browser journey',false,error.message);}finally{await browser.close();}
writeFileSync(`${out}/result.json`,JSON.stringify({results,errors,requests},null,2)+'\n');
process.exitCode=results.every((r)=>r.ok)?0:1;
