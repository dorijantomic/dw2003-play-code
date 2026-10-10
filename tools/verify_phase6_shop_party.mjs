// Real production screen, controlled party fixture; no original-emulator input.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { baseUrl } from "./verify-base-url.mjs";
const out = process.argv[2] ?? 'captures/phase6-shop-party-2026-09-27';
const before = process.env.BEFORE === '1';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
const check = (name, ok, detail) => { results.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); };
const press = async key => { await page.keyboard.down(key); await page.waitForTimeout(100); await page.keyboard.up(key); await page.waitForTimeout(650); };
const texts = () => page.evaluate(async () => {
    const {drawNativeTextWidgets} = await import('./native-screen-text.js');
    return drawNativeTextWidgets({drawImage() {}}, window.__nativeTextWidgets()).texts;
});
try {
    if (before) await page.route('**/shop-native.js', async route => {
        const response = await route.fetch();
        let body = await response.text();
        body = body.replace('preBoot: ({ write }) => write(SHOP_ID_CELL, sh._shopId | 0, 4),', '');
        body = body.replace(/                const db = opts.digimonDB\?\.\(\) \?\? \{\};[\s\S]*?                write\(MONEY,/, '                write(SHOP_ID_CELL, sh._shopId | 0, 4);\n                write(MONEY,');
        await route.fulfill({response, body});
    });
    await page.addInitScript(() => localStorage.setItem('assetMode', 'authentic'));
    await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&nativeShop=1`);
    await page.waitForFunction(() => window.__state?.started);
    await page.evaluate(() => {
        const s = window.__state;
        s.party = ['p003pken', 'p009rena', 'p010pata'];
        s.partyStats = [1,7,8].map(digimonId => ({digimonId, level:1, xp:0, hp:300, maxHp:300, mp:100, maxMp:100,
            stats:{str:48,def:32,spt:27,wis:24,spd:21,chr:16}, bonuses:{}, elemBonuses:{}}));
        s.partnerStats = s.partyStats[0]; s.equipment = [{},{},{}]; s.bits = 10000; s.inventory = [];
    });
    for (const [id, name] of [[2,'Asuka Item Shop'],[1,'Asuka Pawn Shop'],[0,'Asuka Armory']]) {
        await page.evaluate(id => window.__applyStoryFlag(0x7a00 + id, 1), id);
        await page.waitForFunction(() => window.__shop.diagnostics().host?.frames >= 60);
        const t = await texts();
        check(`shop ${id} header`, before ? t.includes('Asuka Armory') : t.includes(name), t);
        await page.locator('#game').screenshot({path:`${out}/${before?'before':'after'}-shop-${id}.png`});
        if (id !== 0) await page.evaluate(() => window.__shop.close());
    }
    await press('c');
    await page.waitForTimeout(1200);
    // Bamboo Spear is the second row in the right column.
    await press('ArrowDown'); await press('ArrowRight');
    // The item's Effects card is the third face button, word bit 0x1000, which the
    // one pad map reaches with `k` (engine/systems/input-map.ts, commit 173ebcf0).
    // `z` reached that bit before 2026-10-03 and confirms now.
    await press('k');
    const t = await texts();
    check('Bamboo Spear effect screen has live party stats', before || (t.includes('Bamboo Spear') && t.filter(x => x==='48').length >= 2), t);
    await page.locator('#game').screenshot({path:`${out}/${before?'before':'after'}-bamboo-effects.png`});
    const mem = await page.evaluate(() => {
        const h=window.__shop._host;
        return {map:[0,1,2].map(i=>h.read(0x80048da4+i*4,4)),
            str:[0,6,7].map(i=>h.read(0x80049494+i*0x3dc+0x30,2)), traps:h.state().traps};
    });
    check('party uses the three starter identities and stored strength', before || (mem.map.join()==='0,6,7' && mem.str.every(x=>x===48) && mem.traps===0), mem);
    if (!before) {
        // The item's Effects card is the third face button, word bit 0x1000, which the
    // one pad map reaches with `k` (engine/systems/input-map.ts, commit 173ebcf0).
    // `z` reached that bit before 2026-10-03 and confirms now.
    await press('k'); await press('c'); await press('c'); await press('c');
        await page.locator('#game').screenshot({path:`${out}/after-equip-offer.png`});
        await press('c');
        await page.locator('#game').screenshot({path:`${out}/after-equip-who.png`});
        await press('c'); await press('c');
        await page.evaluate(() => window.__shop.close());
        await page.evaluate(() => window.__applyStoryFlag(0x7a00, 1));
        await page.waitForTimeout(1800);
        await press('c'); await page.waitForTimeout(1200);
        await press('ArrowDown'); await press('ArrowRight');
        await press('c'); await press('c'); await press('c');
        await page.waitForTimeout(1200);
        await press('c'); await page.waitForTimeout(1200);
        await press('ArrowRight'); await page.waitForTimeout(900);
        await press('c'); await press('c');
        await page.locator('#game').screenshot({path:`${out}/after-patamon-equipped.png`});
        await page.evaluate(() => window.__shop.close());
        const eq = await page.evaluate(() => ({gear:window.__state.equipment, bag:window.__state.inventory, saved:JSON.parse(localStorage.getItem('equipment'))}));
        check('Bamboo Spear equips Renamon and Patamon and persists', eq.gear[1]?.right===167 && eq.saved[1]?.right===167 && eq.gear[2]?.right===167 && eq.saved[2]?.right===167, eq);
    }
    check('no page errors', errors.length===0,errors);
} finally { writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2)); await browser.close(); }
if(results.some(r=>!r.ok)) process.exitCode=1;
