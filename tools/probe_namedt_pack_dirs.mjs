// TEMP probe: which sprite directories does each native opening screen ask
// for, and which of them have no extracted pack mapped?
//
//   tools/run-playwright.sh tools/probe_namedt_pack_dirs.mjs [outdir]

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = `${baseUrl(8742)}`;
const OUT = process.argv[2] ?? "/tmp/opencode/dir-resolve";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

const collect = () => {
    const ns = window.__nsMod;
    const host = window.__packSelectNative?._host
        ?? window.__nameEntryNative?._host
        ?? null;
    const dc = host?.rt?.drawCalls ?? [];
    const out = {};
    for (const c of dc) {
        if (c.method !== "drawSprite") continue;
        const dir = c.args[0] >>> 0;
        const key = `${dir}`;
        if (!out[key]) {
            out[key] = {
                dirKey: ns.nativeScreenDirKey(dir),
                pack: ns.nativeScreenPackNameForDir(dir),
                ids: new Set(),
            };
        }
        out[key].ids.add(c.args[1]);
    }
    const res = {};
    for (const [k, v] of Object.entries(out)) {
        res[k] = { dirKey: v.dirKey, pack: v.pack, ids: [...v.ids].sort((a, b) => a - b) };
    }
    return {
        module: host?.state?.()?.module ?? null,
        dirs: res,
        stats: host?.renderer?.stats
            ? { byPack: host.renderer.stats.byPack, skipped: host.renderer.stats.skipped, clips: host.renderer.stats.clips }
            : null,
    };
};

async function press(page, key, ms = 180) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(150);
}

async function boot(page) {
    await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
    await page.goto(`${ROOT}/?skipTitle=1&map=s785&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
    await page.evaluate(async () => {
        window.__nsMod = await import("/native-screen.js");
        window.__gameSpeed = 8;
    });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        if (await page.evaluate(() => !!window.__state.packSelect)) break;
        await press(page, "Enter", 120);
    }
}

// ── pro/stplnmet: step 1 (keyboard) and step 3 (confirmation) ───────────────
if (process.env.ONLY !== "stdgname") {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    await boot(page);
    const R = () => page.evaluate(collect);
    const state = () => page.evaluate(() => {
        const objs = window.__nativeScreenObjects();
        const root = objs.find((o) => (o.cb >>> 0) === 0x80088138);
        if (!root) return null;
        const rd = (a, s = 4) => window.__nativeScreenRead(a, s) >>> 0;
        const arr = rd(root.addr + 0x24);
        const p = (i) => { const x = rd(arr + i * 4); return x ? rd(x + 0x10) : null; };
        return { sub: rd(root.addr + 0x10), sel: rd(root.addr + 0x14), name: p(1), pack: p(2), confirm: p(3) };
    });

    for (let i = 0; i < 120; i++) {
        const st = await state();
        if (st?.sub === 2 && st?.name === 2) break;
        if (st?.sub !== 2) await press(page, "Enter", 200);
        else await page.waitForTimeout(250);
    }
    console.log("STPLNMET step1 (Enter Name keyboard):");
    console.log(JSON.stringify(await R(), null, 1));
    console.log("FONT", JSON.stringify(await page.evaluate(async () => {
        const ns = await import('/native-screen.js');
        return ns.nativeTextWidgets().filter(w => w.visible && w.fixedPitch).map(w => {
            const basic = w.read32(w.font + 4);
            return { font: w.font.toString(16), basic: basic.toString(16),
                rec: Array.from({length: 11}, (_,i)=>w.read8(basic + 10*11+i)),
                vram: w.read16(w.addr + 0xac), palette: w.read16(w.addr + 0xae),
                clut: w.colour };
        });
    })));
    await page.screenshot({ path: `${OUT}/stplnmet-step1.png` });

    for (let i = 0; i < 24 && (await state()) !== null; i++) {
        const cur = await page.evaluate(() => {
            const objs = window.__nativeScreenObjects();
            const root = objs.find((o) => (o.cb >>> 0) === 0x80088138);
            if (!root) return null;
            const rd = (a, s = 4) => window.__nativeScreenRead(a, s) >>> 0;
            const arr = rd(root.addr + 0x24);
            const ne = rd(arr + 4);
            return ne ? { col: rd(ne + 0x98), row: rd(ne + 0x9c) } : null;
        });
        if (!cur || (cur.col === 13 && cur.row === 6)) break;
        if (cur.col !== 13) await press(page, "ArrowRight");
        else await press(page, "ArrowDown");
    }
    await press(page, "Enter", 250);
    const seen = [];
    for (let i = 0; i < 40; i++) {
        const st = await state();
        seen.push(st);
        if (st?.sel === 1 && st?.pack !== null) break;
        await page.waitForTimeout(500);
    }
    if (seen[seen.length - 1]?.sel !== 1) console.log("WARN step2 not reached, states:", JSON.stringify(seen.slice(-4)));
    await page.waitForTimeout(800);
    console.log("STPLNMET step2 (Choose a Starter Pack):");
    console.log(JSON.stringify(await R(), null, 1));
    await page.screenshot({ path: `${OUT}/stplnmet-step2.png` });
    for (let i = 0; i < 4; i++) {
        const st = await state();
        if (st?.sel === 2) break;
        await press(page, "Enter", 250);
        await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1200);
    console.log("STPLNMET step3 (confirmation):");
    console.log(JSON.stringify(await R(), null, 1));
    await page.screenshot({ path: `${OUT}/stplnmet-step3.png` });
    await page.close();
}

// ── pro/stdgname: partner pick + keyboard ──────────────────────────────────
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    await page.addInitScript(() => {
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("playerName", "Junior");
        localStorage.setItem("charId", "p003pken");
        localStorage.setItem("party", JSON.stringify(["p003pken"]));
        localStorage.setItem("bits", "5000");
    });
    await page.goto(`${ROOT}/?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
    await page.evaluate(async () => {
        window.__nsMod = await import("/native-screen.js");
        window.__gameSpeed = 8;
        const lead = window.__state?.party?.[0] ?? null;
        if (lead) window.__state.digimonNames = { ...(window.__state.digimonNames ?? {}), [lead]: "ABC" };
        window.__applyStoryFlag(0x7c01, true);
    });
    await page.waitForFunction(() => window.__nameEntryNative?.isOpen?.() === true, null, { timeout: 20000 });
    await page.waitForTimeout(2500);
    console.log("STDGNAME first screen:");
    console.log(JSON.stringify(await page.evaluate(collect), null, 1));
    await page.screenshot({ path: `${OUT}/stdgname-1.png` });
    for (let i = 0; i < 6; i++) {
        await press(page, "Enter", 250);
        await page.waitForTimeout(700);
    }
    console.log("STDGNAME after confirms:");
    console.log(JSON.stringify(await page.evaluate(collect), null, 1));
    await page.screenshot({ path: `${OUT}/stdgname-2.png` });
    await page.close();
}

await browser.close();
