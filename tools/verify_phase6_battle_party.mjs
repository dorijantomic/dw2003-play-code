// Production battle/report path with controlled vitals, ordinary held keys.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { baseUrl } from "./verify-base-url.mjs";
const out = process.argv[2] ?? 'captures/phase6-battle-party-2026-09-27';
const before = process.env.BEFORE === '1';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:640,height:480}});
const results=[], errors=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(name,ok,detail)=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name} ${JSON.stringify(detail)}`);};
const press=async key=>{await page.keyboard.down(key);await page.waitForTimeout(120);await page.keyboard.up(key);await page.waitForTimeout(350);};
const shot=async name=>writeFileSync(`${out}/${name}.png`,Buffer.from(await page.locator('#game').evaluate(c=>c.toDataURL('image/png').split(',')[1]),'base64'));
try {
    if(before) await page.route('**/game.js',async route=>{
        const response=await route.fetch();
        const body=(await response.text()).replace('participated = paidParticipants(b).includes(row.index)','participated = true');
        await route.fulfill({response,body});
    });
    await page.addInitScript(() => localStorage.setItem('assetMode', 'authentic'));
    await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`);
    await page.waitForFunction(()=>window.__state?.started);
    await page.evaluate(()=>{
        const s=window.__state;
        s.party=['p003pken','p009rena','p010pata'];
        s.charId=s.party[0];s.charIdx=s.manifest.characters.findIndex(c=>c.id===s.charId);
        s.partyStats=[1,7,8].map(digimonId=>({digimonId,level:1,xp:0,tp:0,hp:9999,maxHp:9999,mp:100,maxMp:100,
            stats:{str:999,def:999,spt:999,wis:999,spd:999,chr:16},bonuses:{},elemBonuses:{}}));
        s.partnerStats=s.partyStats[0];s.equipment=[{},{},{}];
    });
    await page.evaluate(async()=>{await window.__battle.startScreen(5,null,null,null,{mapId:'s245'});window.__gameSpeed=4;});
    for(let i=0;i<100;i++) {
        if(await page.evaluate(()=>window.__reportNative?.isOpen())) break;
        await page.evaluate(()=>{const b=window.__battleB();if(b?.state===2)b.enemy.hp=1;});
        await press('Enter');
    }
    await page.evaluate(()=>window.__gameSpeed=1);
    await page.waitForFunction(()=>window.__reportNative?.isOpen(),null,{timeout:10000});
    // The report runs translated code in ordinary play, so the seed lives in the
    // adapter's own options (web/fightreport-translated.js keeps `_opts`) and each
    // partner's EXP is the session's own per-partner record
    // (engine/dw3/ui/fight-report-session.ts `record()`, roster slot +0x20) — the
    // same words the old native host read at 0x80049494+slot*0x3dc+0x20.
    const report=await page.evaluate(()=>({flags:(window.__reportNative._opts?.participants??[]).map(p=>p.participated),xp:window.__state.partyStats.map(p=>p.xp)}));
    check('only the lead participated',before?report.flags.every(Boolean):report.flags.join()==='true,false,false',report);
    await shot(`${before?'before':'after'}-reward-entry`);
    const maxXp=[0,0,0];let captured=false;
    for(let i=0;i<65 && await page.evaluate(()=>window.__reportNative.isOpen());i++) {
        await press('Enter');
        const values=await page.evaluate(()=>{const d=window.__reportNative.diagnostics();return d.records?.length?[0,1,2].map(i=>d.records[i]?.exp??0):null;});
        values?.forEach((v,j)=>maxXp[j]=Math.max(maxXp[j],v));
        if(!captured&&values?.[0]>0){await shot(`${before?'before':'after'}-exp-count`);captured=true;}
    }
    check('report counts EXP only for participants',before ? maxXp[1]>0&&maxXp[2]>0 : maxXp[0]>0&&maxXp[1]===0&&maxXp[2]===0,maxXp);
    const after=await page.evaluate(()=>({open:window.__reportNative.isOpen(),xp:window.__state.partyStats.map(p=>p.xp)}));
    check('reserves keep their EXP after the report closes',!after.open && after.xp[0]>0 && after.xp[1]===0 && after.xp[2]===0,after);
    await shot(`${before?'before':'after'}-reward-complete`);
    if(!before) {
        await page.evaluate(async()=>{await window.__battle.startScreen(5,null,null,null,{mapId:'s245'});});
        // The battle's own message line holds the turn until the player answers it
        // (`msgHoldsTurn`, web/battle.js), and only then does the translated
        // pro/fightstg command list come up — so confirm is pressed every pass, as
        // the first half of this check already does. State 5 is the battle's Fight
        // branch; the old 2 was the native list's "row chosen" state.
        for(let i=0;i<80 && await page.evaluate(()=>window.__battleB()?.state)!==5;i++) await press('Enter');
        await page.waitForFunction(()=>window.__battleB()?.state===5,null,{timeout:10000});
        await page.evaluate(()=>{
            const b=window.__battleB();b.player.hp=1;b.player.def=1;
            b.enemy.hp=99999;b.enemy.maxHp=99999;b.enemy.str=9999;b.enemy.spd=1;
            b.playerRecords[2].hp=0;
        });
        await shot('before-knockout');
        await press('Enter');
        await page.waitForFunction(()=>window.__battleB()?.state===7,null,{timeout:20000});
        // Place the controlled KO at the real action-result boundary. Attack
        // hit/miss randomness is outside this replacement regression check.
        await page.evaluate(()=>{window.__battleB().player.hp=0;});
        for(let i=0;i<70;i++) {
            const st=await page.evaluate(()=>window.__battleB()?.state);
            if(st===11||st===9||st==null)break;
            await press('Enter');
        }
        const ko=await page.evaluate(()=>{const b=window.__battleB();return {state:b?.state,forced:b?._forcedTag,hp:b?.playerRecords.map(p=>p.hp)};});
        check('knockout offers the living reserve',ko.state===11&&ko.forced&&ko.hp[0]===0&&ko.hp[1]>0&&ko.hp[2]===0,ko);
        await shot('after-knockout-chooser');
        await press('Escape');
        check('replacement cannot be cancelled',await page.evaluate(()=>window.__battleB()?.state===11));
        await press('Enter');await shot('after-knockout-form');
        // The replacement chooser is a screen of its own and needs its confirm to
        // land, so keep confirming until the battle leaves the forced state rather
        // than assuming a fixed number of presses (the shape
        // tools/verify_tag_after_two_knockouts.mjs plays it with).
        for(let i=0;i<8 && await page.evaluate(()=>!!window.__battleB()?._forcedTag);i++) await press('Enter');
        const tag=await page.evaluate(()=>({active:window.__battleB()?.activePlayerIndex,forced:window.__battleB()?._forcedTag}));
        check('confirm switches to Renamon',tag.active===1&&!tag.forced,tag);
        await shot('after-knockout-replacement');
    }
    check('no page errors',errors.length===0,errors);
} finally {writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));await browser.close();}
if(results.some(r=>!r.ok))process.exitCode=1;
