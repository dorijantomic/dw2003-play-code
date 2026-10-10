// Browser proof for the translated field conversation box in the UI Lab (Step G of the dialogue
// worklist). Opens the lab entries through window.__labOpen on the real game page, with every
// assets/native/** request denied, screenshots the balloon next to the reference capture, presses
// confirm through the pages and checks the box closes with the fold sounds 0x40019 / 0x4001A.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_dialogue_lab.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = `${baseUrl(8742)}`;
const OUT = process.argv[2] ?? "captures/step-g-dialogue-lab-2026-10-01";
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); if (!ok) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const native = [];
await page.route("**/assets/native/**", (route) => { native.push(route.request().url()); return route.abort(); });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem("assetMode", "authentic"); } catch { /* blocked */ } });
await page.goto(`${ROOT}/?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started && window.__labOpen, null, { timeout: 60000 });

const diag = () => page.evaluate(() => window.__dialogueBox.diagnostics());
const waitState = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout });
const confirm = async () => { await page.keyboard.down("Enter"); await page.waitForTimeout(120); await page.keyboard.up("Enter"); };
const shot = async (name) => { await page.locator("canvas").first().screenshot({ path: `${OUT}/${name}.png` }); };

// 1. the balloon, mode 0, with the reference line
await page.evaluate(() => window.__labOpen("textbox"));
// the page-turn marker (clip 7) appears once the text has fully revealed
await waitState(() => window.__dialogueBox._session?.drawIntents().calls.some((c) => c.method === "drawSprite" && c.args[1] === 7), null, 30000);
await page.waitForTimeout(300);
let d = await diag();
check("balloon open and ticking", d.open && !d.failed, JSON.stringify({ ticks: d.ticks, state: d.state, err: d.error }));
check("fold-open sound requested", d.sounds.includes(0x40019), JSON.stringify(d.sounds));
await shot("balloon-open");
d = await diag();
check("clips, fill and wipe lines painted", (d.renderer.clips ?? 0) > 0 && (d.renderer.raw ?? 0) > 0, JSON.stringify({ clips: d.renderer.clips, raw: d.renderer.raw, skipped: d.renderer.skipped }));
let closed = false;
for (let i = 0; i < 12 && !closed; i++) {
    await confirm();
    await page.waitForTimeout(500);
    closed = !(await diag()).open;
}
d = await diag();
check("confirm through the pages closes the box", closed, `closes=${d.closes}`);
check("fold-close sound requested", d.sounds.includes(0x4001a) && (d.packed[0x4001a] ?? 0) > 0, JSON.stringify(d.packed));

// 2. the plain bottom window with a real estalk00 line
await page.evaluate(() => window.__labOpen("textbox_plain"));
await waitState(() => window.__dialogueBox._session?.textWidgets().some((w) => { const m = window.__dialogueBox._session.mem; return m.read32(w.addr + 0xc) === 2 && m.read32(w.addr + 0x10) === 1; }), null, 40000);
await page.waitForTimeout(300);
d = await diag();
check("plain window open", d.open && !d.failed, JSON.stringify({ err: d.error, state: d.state }));
await shot("plain-open");
closed = false;
// A confirm that closes the window can also reopen the lab entry within the same key press, so count
// closes and keep the union of the packed sounds seen while polling.
const seen = {};
const closeSounds = (q) => q.sounds.filter((id) => id === 0x4001a).length;
let atClose = null;
for (let i = 0; i < 16 && !atClose; i++) {
    const press = page.evaluate(() => window.__dialogueBox.pressConfirm());
    for (let k = 0; k < 80 && !atClose; k++) {
        await page.waitForTimeout(8);
        const q = await diag();
        for (const [id, n] of Object.entries(q.packed)) seen[id] = Math.max(seen[id] ?? 0, n);
        if (q.closes >= 2) atClose = q;
    }
    await press;
}
d = { ...(atClose ?? await diag()), packed: seen };
closed = !!atClose;
check("plain window closes", closed);
check("fold-open sound on the plain window", (d.packed[0x40019] ?? 0) > 0, JSON.stringify(d.packed));
// The plain window plays its close sound when the last page ends, which can come before the
// window reports closed; the log survives a reopen, so require the balloon's and this window's.
check("fold-close sound on the plain window", closeSounds(d) >= 2, JSON.stringify(d.sounds.slice(-8)));

check("no assets/native request", native.length === 0, native.slice(0, 2).join(" "));
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

// side-by-side: capture | reference
const mine = readFileSync(`${OUT}/balloon-open.png`).toString("base64");
const ref = readFileSync("web/assets/ref/s415_bulbmon_dialogue_ref.png").toString("base64");
const cmp = await browser.newPage({ viewport: { width: 1000, height: 500 } });
await cmp.setContent(`<body style="margin:0;background:#222"><img id=a src="data:image/png;base64,${mine}" width=480 height=360><img id=b src="data:image/png;base64,${ref}" width=480 height=360 style="margin-left:8px;image-rendering:pixelated"></body>`);
await cmp.waitForFunction(() => [...document.images].every((i) => i.complete));
await cmp.screenshot({ path: `${OUT}/balloon-vs-reference.png` });
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);
