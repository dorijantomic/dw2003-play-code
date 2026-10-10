// Player-visible regression check: the Asuka City download — the blue halo on
// each of its three pads, and the DIGI_EN cue that goes with each one — in
// ORDINARY play.
//
// The disc: wstag212.s file 0x368-0x418 — the configure handler stores the pad
// the operand names, setClip(1)s and plays that slot's table word on EVERY fire
// (the three words at file 0x23a8 are 0x010c0000/1/2 = DIGI_EN0/1/2); the three
// fires are ops 88 (SETANIM 810 815), 107 (810 826) and 113 (810 827) of event
// 0x01120004.  What a player sees: each pad's halo runs its script; what they
// hear: DIGI_EN0, then 1, then 2, over the lobby music.
//
// TWO regressions this pins, both shipped and both reverted by the fix:
//   - the halo showed on the FIRST pad only: the port armed a copy that had no
//     run left without resetting the scripts' cursors, so pads 2 and 3 died on
//     their next blank (the disc re-clips and re-runs on every fire);
//   - the cue never played in ordinary play: it was read from an emote watcher
//     that only ever caught a cue when an unrelated SETANIM landed mid-flash
//     (which never happens at 1x; it took __gameSpeed to see one).  The actor
//     now plays it at its own fire, so this check must run at 1x.
//
// Seeds the pack-B download exactly like tools/verify_opening_pack_download.mjs
// and drives it to the hand-off to s200.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_download_halo_cue.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.PACK_ROOT || `${baseUrl(8741)}/`;
const OUT = process.argv[2] || ".bunny-scratch/shots/download-halo-cue";
mkdirSync(OUT, { recursive: true });

const PACK_B = ["p005koet", "p006agum", "p009rena"];
const ARRIVAL_ORDINAL = 2; // bank-0x60 flag 0x6002, the s212 download gate

// The halo sprites' source rects in the s212 sheet (point_sprites.json):
//   92: 64,656,24,8   93: 224,640,32,16   94: 160,552,48,24   95: 208,552,48,24
const HALO_RECTS = ["64,656,24,8", "224,640,32,16", "160,552,48,24", "208,552,48,24"];

// What the scene fires, in order: scene op -> SETANIM command -> pad -> cue.
const PADS = [
    { cmd: 815, at: [217, 292], cue: "digi_en0" },
    { cmd: 826, at: [257, 272], cue: "digi_en1" },
    { cmd: 827, at: [297, 252], cue: "digi_en2" },
];

const fails = [];
const check = (name, ok, detail) => {
    console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
    if (!ok) fails.push(name);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 900, height: 820 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript((rects) => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("packId", "B");
    localStorage.setItem("progressOrdinal", "2");
    localStorage.setItem("pendingParty", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
    localStorage.removeItem("party");
    localStorage.removeItem("rosterOwned");
    localStorage.removeItem("flags");
    localStorage.removeItem("engineFlags");

    // Every call that paints a halo sprite, with its timestamp and blend pass.
    window.__haloDraws = [];
    const di = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (img, ...rest) {
        const key = rest.slice(0, 4).join(",");
        if (rects.includes(key)) {
            window.__haloDraws.push({
                t: Math.round(performance.now()),
                lighter: this.globalCompositeOperation === "lighter",
            });
        }
        return di.call(this, img, ...rest);
    };
    // Every jingle the bgm player is asked for (PACKED_JINGLES stems).
    window.__jingles = [];
}, HALO_RECTS);

await page.goto(ROOT + "?skipTitle=1&map=s212&noEncounters=1");
await page.waitForFunction(() => window.__state?.started, null, { timeout: 25_000 });
await page.evaluate(() => {
    const orig = window.__bgm.playJingle.bind(window.__bgm);
    window.__bgm.playJingle = (stem) => {
        window.__jingles.push({ t: Math.round(performance.now()), stem });
        return orig(stem);
    };
});

// Ordinary cadence: the halo re-arm and the cue are both 1x behaviors.
const seen = [];        // one record per pad run, in fire order
let seenIdx = 0;
const deadline = Date.now() + 240_000;
while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
        const actors = window.__pointRecordActors.state("s212");
        const pad = actors.find((a) => a.machine === "pad-flash" && a.pad);
        const recs = window.__pointRecordActors.records("s212");
        const claimed = [54, 55, 56].map((i) => recs[i]);
        return {
            tb: window.__textbox?.isOpen?.() ?? false,
            map: window.__state.manifest.maps[window.__state.mapIdx].id,
            pad: pad ? { x: pad.pad.x, y: pad.pad.y, command: pad.pad.command } : null,
            claimed: claimed.map((r) => ({ active: r.active, x: r.x, y: r.y, sprite: r.sprite })),
            draws: window.__haloDraws.length,
            jingles: window.__jingles.length,
        };
    });
    if (st.map !== "s212") break;
    if (st.pad && st.pad.command === PADS[seenIdx]?.cmd) {
        // The first sample of a live run: start its record and its screenshot.
        const cue = await page.evaluate(() => window.__jingles.map((j) => j.stem));
        const rec = {
            ...st.pad,
            lit: 0, maxLit: 0, atPad: false,
            drawsAtStart: st.draws,
            draws: 0,
            cueBeforeOrAt: [...cue],
        };
        seen.push(rec);
        await page.locator("#game").screenshot({ path: `${OUT}/pad-${PADS[seenIdx].cmd}-halo.png` });
        seenIdx += 1;
        continue; // re-sample next tick with the record in place
    }
    const rec = seen[seenIdx - 1];
    if (rec) {
        const lit = st.claimed.filter((r) => r.active);
        rec.lit += lit.length;
        rec.maxLit = Math.max(rec.maxLit, lit.length);
        if (lit.some((r) => Math.abs(r.x - rec.x) <= 2 && Math.abs(r.y - rec.y) <= 64)) rec.atPad = true;
        rec.draws = st.draws - rec.drawsAtStart;
        rec.jinglesSeen = st.jingles;
    }
    if (st.tb) await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
}
const jingles = await page.evaluate(() => window.__jingles.map((j) => j.stem));
await page.locator("#game").screenshot({ path: `${OUT}/download-end.png` });

// ── the assertions ──────────────────────────────────────────────────────────
console.log("pads seen:", JSON.stringify(seen.map((r) => ({ cmd: r.command, at: [r.x, r.y], lit: r.lit, maxLit: r.maxLit, atPad: r.atPad, draws: r.draws }))));
console.log("jingles:", JSON.stringify(jingles));

check("all three pads fire, in scene order",
    seen.length === 3 && seen.every((r, i) => r.command === PADS[i].cmd
        && r.x === PADS[i].at[0] && r.y === PADS[i].at[1]),
    seen.map((r) => `${r.command}@${r.x},${r.y}`).join(" "));
for (let i = 0; i < Math.min(seen.length, 3); i++) {
    const r = seen[i];
    check(`pad ${PADS[i].cmd}: the halo lights its rows`, r.maxLit > 0, `max lit ${r.maxLit}`);
    check(`pad ${PADS[i].cmd}: the halo sits on the pad at ${PADS[i].at}`, r.atPad);
    check(`pad ${PADS[i].cmd}: the halo paints on the canvas (both passes)`, r.draws > 30,
        `${r.draws} halo draws`);
}
check("the three cues fire in pad order (DIGI_EN0/1/2)",
    JSON.stringify(jingles) === JSON.stringify(PADS.map((p) => p.cue)),
    JSON.stringify(jingles));
check("no page errors", errors.length === 0, errors.join("; "));

console.log(fails.length ? `VERDICT FAIL ${fails.join("; ")}` : "VERDICT OK");
await browser.close();
if (fails.length) process.exitCode = 1;
