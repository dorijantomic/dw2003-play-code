// First look at the native pro/stgdglab (Digimon Lab) in the native-screen lab:
// boot it, seed a real roster slot, and watch what it draws and how the root
// state machine responds to the pad.
//   tools/run-playwright.sh tools/probe_lab_dri.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_LAB || `${baseUrl(8742)}/native-screen-lab.html?bridge=1`;
const OUT = "/tmp/opencode/lab-dri";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 640 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const snap = async (name) => {
    const d = await page.evaluate(() => {
        const s = window.__nativeScreen?.();
        const read = (a, size = 4) => window.__nativeScreenRead(a, size);
        const objs = window.__nativeScreenObjects();
        const root = objs[0]?.addr ?? 0;
        return {
            screen: s?.id ?? s?.module ?? null,
            booted: s?.booted, traps: s?.traps, frames: s?.frames,
            objects: objs.length,
            root, rootState: root ? read(root + 0xc) : null, rootUnk10: root ? read(root + 0x10) : null,
            aux: root ? read(root + 0x24) : null,
            party: [0, 1, 2].map((i) => read(0x80048d34 + 0x70 + i * 4)),
            rec0: {
                owned: read(0x80049494, 4), form: read(0x80049498, 4),
                hp: read(0x80049494 + 0x28, 2), mp: read(0x80049494 + 0x2c, 2),
                equip: [0x3c8, 0x3ca, 0x3cc, 0x3ce, 0x3d0, 0x3d2].map((o) => read(0x80049494 + o, 2)),
                equippedForms: [0x50, 0x52, 0x54].map((o) => read(0x80049494 + o, 2)),
            },
            draws: window.__nativeScreenDraws().length,
            render: window.__nativeScreenRender(),
        };
    });
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify(d, null, 1) + "\n");
    await page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});
    console.log(name, JSON.stringify({ ...d, draws: d.draws, render: d.render ? { clips: d.render.clips, byPack: d.render.byPack } : null }));
    return d;
};
const press = async (buttons, ms = 120) => {
    await page.evaluate((b) => window.__nativeScreenPad(b), buttons);
    await page.waitForTimeout(ms);
    await page.evaluate(() => window.__nativeScreenPad(0));
    await page.waitForTimeout(400);
};

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__nativeScreenList?.()?.length > 0, null, { timeout: 30000 });
    await page.evaluate(() => { window.__nativeScreenBoot("pro/stgdglab"); });
    await page.waitForTimeout(1500);
    await snap("0-booted");

    // Seed the way the adapter will: roster slot 0 = Kotemon (record 0), party map [0,-1,-1].
    await page.evaluate(() => {
        window.__nativeScreenSeedParty({
            positions: [0, 0xffffffff, 0xffffffff],
            stats: [{
                slot: 0, name: "Kotemon", level: 5, tp: 10, hp: 30, maxHp: 40, mp: 12, maxMp: 20,
                core: [5, 6, 7, 8, 9, 10], elements: [1, 2, 3, 4, 5, 6, 7],
            }],
        });
        const w = window.__nativeScreenWrite;
        w(0x80049494 + 0x50, 0xffff, 2); w(0x80049494 + 0x52, 0xffff, 2); w(0x80049494 + 0x54, 0xffff, 2);
    });
    await page.waitForTimeout(800);
    await snap("1-seeded");
    const d = await page.evaluate(() => window.__nativeScreenTextDump?.() ?? []);
    writeFileSync(`${OUT}/texts.json`, JSON.stringify(d, null, 1) + "\n");
    console.log("texts:", JSON.stringify(d.map((w) => w.decoded).flat().filter(Boolean)).slice(0, 400));

    await press(0x2000);   // Circle: confirm "Select Action" row 0
    await snap("2-circle");
    await press(0x0040);   // Down
    await snap("3-down");
    await press(0x2000);
    await snap("4-circle2");
    await press(0x1000);   // Triangle (Back)
    await snap("5-triangle");
    console.log("errors:", errors.length ? errors.join(" | ") : "none");
} finally {
    await browser.close();
}
