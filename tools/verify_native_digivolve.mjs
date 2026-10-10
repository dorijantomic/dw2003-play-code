// Real STATUS -> See Digivolve -> Battle Digivolve On/Off input path.
// Fixture starts with the battle progression's already-acquired Dinohumon.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { baseUrl } from "./verify-base-url.mjs";
const OUT = process.argv[2] ?? '/tmp/native-digivolve';
const BEFORE = process.env.DIGIVOLVE_BEFORE === '1';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const press = async key => {
    await page.keyboard.down(key); await page.waitForTimeout(90);
    await page.keyboard.up(key); await page.waitForTimeout(650);
};
const text = () => page.evaluate(async () => {
    const { drawNativeTextWidgets } = await import('/native-screen-text.js');
    return drawNativeTextWidgets({ drawImage() {} }, window.__nativeTextWidgets()).texts;
});
const shot = async name => page.screenshot({ path: `${OUT}/${name}.png` });
let failures = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${JSON.stringify(detail)}`);
    if (!ok) failures++;
};
try {
    if (BEFORE) await page.route('**/status-native.js', async route => {
        // Replay the pre-fix adapter (which omitted these fields) in this
        // isolated page only. The fixture and real renderer stay identical.
        const response = await route.fetch();
        const body = await response.text();
        const old = body.replace(/                forms: \{\n                    digimonId:[\s\S]*?                \},\n/, '');
        if (old === body) throw new Error('pre-fix adapter replay did not match');
        await route.fulfill({ response, body: old });
    });
    await page.addInitScript(() => localStorage.setItem('assetMode', 'authentic'));
    // The See Digivolve page is read through the original-code status overlay, and
    // the pause/status route runs translated code in ordinary play now, so this
    // check asks for it with ?nativeStatus=1 (the translated page's own proof is
    // tools/verify_translated_pause.mjs).
    await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&nativeStatus=1`);
    await page.waitForFunction(() => window.__state?.started);
    await page.evaluate(() => {
        const s = window.__state;
        s.party = ['p003pken'];
        s.charId = 'p003pken';
        s.charIdx = s.manifest.characters.findIndex(c => c.id === s.charId);
        s.digimonNames = { p003pken: 'Kotemon' };
        const stats = { digimonId: 1, level: 5, xp: 500, tp: 0, hp: 150, maxHp: 150,
            mp: 100, maxMp: 100, stats: {},
            equippedForms: [9],
            formLedger: [{ id: 9, formLevel: 1, dvexp: 0, techSlots: [0,0,0,0,0,0] }] };
        s.partyStats = [stats]; s.partnerStats = stats;
        localStorage.setItem('party', JSON.stringify(s.party));
        localStorage.setItem('charId', s.charId);
        window.__labOpen('status', 'status');
    });
    await page.waitForFunction(() => (window.__status?.diagnostics().renderer?.frames ?? 0) >= 60);
    await press('Enter'); // partner detail
    await press('Enter'); // See Digivolve
    await page.waitForTimeout(900);
    let texts = await text();
    check(BEFORE ? 'pre-fix handoff omits learned Dinohumon' : 'learned Dinohumon appears in See Digivolve',
        BEFORE ? !texts.includes('Dinohumon') : texts.includes('Dinohumon'), texts);
    await shot('01-forms');
    if (!BEFORE) {
    await press('ArrowRight'); // move from the rookie into the form list
    await press('Enter'); // select the form
    texts = await text();
    check('selected form offers Battle Digivolve On', texts.some(t => t.includes('Battle Digivolve On')), texts);
    await shot('02-action');
    await press('Enter'); // turn it on
    texts = await text();
    check('turn-on confirmation appears', texts.some(t => t.includes('Turned on Battle Digivolve')), texts);
    await shot('03-on');
    await press('Enter'); // dismiss the result before Back is accepted
    // Back is word bit 0x4000, which the one pad map reaches with Escape or x
    // (engine/systems/input-map.ts, commit 173ebcf0). `c` reached that bit before
    // 2026-10-03 and is the confirm bit now.
    for (let i = 0; i < 8 && await page.evaluate(() => window.__status.isOpen()); i++) await press('Escape');
    const result = await page.evaluate(() => ({ open: window.__status.isOpen(),
        form: window.__state.partyStats?.[0]?.digimonId,
        lead: window.__state.partnerStats?.digimonId,
        saved: JSON.parse(localStorage.getItem('partnerStats') || 'null')?.digimonId }));
    check('leaving status commits Dinohumon as the active form', !result.open && result.form === 9 && result.lead === 9 && result.saved === 9, result);
    check('no native traps or page errors', errors.length === 0, errors);
    if (!result.open && result.form === 9) {
        await page.reload();
        await page.waitForFunction(() => window.__state?.started);
        const loadedForm = await page.evaluate(() => window.__state.partnerStats?.digimonId);
        check('reload keeps Dinohumon selected', loadedForm === 9, loadedForm);
        await page.evaluate(async () => window.__battle.startScreen(5, null, null, null, { mapId:'s245' }));
        await page.waitForFunction(() => !!window.__battleB?.());
        const battleForm = await page.evaluate(() => window.__battleB().player.profile.id);
        check('the next battle starts in Dinohumon', battleForm === 9, battleForm);
        await shot('04-next-battle');
    }
    writeFileSync(`${OUT}/result.json`, JSON.stringify({ result, errors, failures }, null, 2));
    }
} finally { await browser.close(); }
process.exitCode = failures ? 1 : 0;
