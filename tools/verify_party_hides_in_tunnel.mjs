// The Protocol Ruins tunnel — a CONTROLLED A/B check that cannot lie.
//
// The previous version compared the party's crop against the stage's flat map
// image with a lenient mean threshold, so it reported "hidden" while its own
// screenshot showed the character (the operator's report, 2026-10-08). A crop
// compared against art that may itself be wrong is not proof.
//
// This version captures the SAME frame three times, straight from the renderer's
// own end-of-frame copy (`window.__frameCopy`), so no screenshot round-trip and
// no mid-frame canvas read is involved:
//   A1, A2 = the party DRAWN (the second is the animation floor — what the
//            scene changes on its own between two frames);
//   B      = the party SUPPRESSED (`window.__hideParty`, a debug switch on the
//            leader/follower draw functions).
// The DIFFERENCE is counted inside the party's own on-screen boxes (computed
// from the drawn positions and the camera), so the measurement is provably over
// the actors and not over a patch of stone.
//
//   covered  <=>  diff(A1,B) <= floor(A1,A2) + slack   (no party-specific pixels)
//   drawn    <=>  diff(A1,B) >>  floor
//
// Run: VERIFY_URL=http://localhost:8788 tools/run-playwright.sh tools/verify_party_hides_in_tunnel.mjs [outdir]
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const OUT = process.argv[2] || ".dw3-research/tunnel-ground-cover-2026-10-08/browser";
const VERIFY_URL = process.env.VERIFY_URL || "http://localhost:8788";
const STAGE = "s375";
const PARTY = ["p003pken", "p004kogu", "p006agum"];

const ROUTE = JSON.parse(readFileSync(
    new URL("./verify_party_hides_in_tunnel.route.json", import.meta.url), "utf8")).route;
const IDX = { outside: 0, mouth: 25, corridor: 89, diamond: 139 };
// The tunnel footprint read from the collision grid and the disc's own op-5 zones
// (story_trigger_zones.json byte 1 = hide, byte 226 = restore): the mouth column
// (x800..823), the east opening (x1048..1071) and the corridor between, with a
// margin so the tiles just outside each entrance are covered too.
const TUNNEL_BBOX = [640, 216, 1120, 460];
// Outside the east opening; the operator's own way in.
const EAST_WALK_START = [1120, 402.4];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(`${VERIFY_URL}/index.html?skipTitle=1&map=${STAGE}&noEncounters=1`);
const style = page.locator("#asset-mode-authentic");
if (await style.isVisible().catch(() => false)) await style.click();
await page.waitForFunction(() => window.__state?.started, null, { timeout: 30000 });
await page.evaluate((party) => { window.__state.party = party; }, PARTY);
await page.evaluate((mid) => {
    const i = window.__state.manifest.maps.findIndex((m) => m.id === mid);
    if (i >= 0) window.__setMap(i, null);
}, STAGE);
await page.waitForFunction((mid) => {
    const g = window.__state?.mapImgs?.[mid];
    return g instanceof Image && g.complete && g.naturalWidth > 0;
}, STAGE, { timeout: 30000 });
await page.waitForFunction((mid) => {
    const g = window.__state?.mapGroundImgs?.[mid];
    return g && typeof g.getContext === "function";
}, STAGE, { timeout: 30000 });
await page.waitForTimeout(400);

await page.evaluate((route) => {
    const s = window.__state;
    // The renderer's own end-of-frame copy: set by web/game.js when this canvas
    // exists, and incremented in window.__frameCopySeq once per completed frame.
    window.__frameCopy = document.createElement("canvas");
    window.__frameCopySeq = 0;
    window.__place = (x, y) => {
        s.x = x; s.y = y; s.moving = false; s.stopping = false; s.dir = "left";
        const fs = window.__followers;
        for (let i = 0; i < 3; i++) { fs[i].x = x - 12 - i * 10; fs[i].y = y; fs[i].dir = "left"; fs[i].parked = false; fs[i].stopping = false; }
    };
    window.__walk = (r) => new Promise((resolve) => {
        let seg = 1, cx = r[0][0], cy = r[0][1];
        s.x = cx; s.y = cy;
        function frame() {
            const [tx, ty] = r[seg];
            const dx = tx - cx, dy = ty - cy, d = Math.hypot(dx, dy), step = 2;
            if (d <= step) {
                seg++;
                if (seg >= r.length) { s.x = r[r.length - 1][0]; s.y = r[r.length - 1][1]; s.moving = false; return requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }
            } else { cx += dx / d * step; cy += dy / d * step; }
            s.x = cx; s.y = cy; s.moving = true;
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    });
    // Wait for one NEW completed frame, then read the copy.
    const grab = async () => {
        const seq = window.__frameCopySeq;
        while (window.__frameCopySeq === seq) await new Promise((r) => requestAnimationFrame(r));
        const fc = window.__frameCopy;
        return { data: fc.getContext("2d").getImageData(0, 0, fc.width, fc.height).data, w: fc.width, h: fc.height };
    };
    // Each party member's box in the copy's device pixels (the sprite occupies
    // [x-20,x+20] x [y-52,y+4] at zoom 2).
    const boxes = () => {
        const cam = window.__lastCam, sc = cam.zoom || 2;
        const pts = [["leader", s.x, s.y]];
        for (let i = 0; i < 3; i++) { const f = window.__followers[i]; if (f && !f.parked) pts.push(["f" + i, f.x, f.y]); }
        return pts.map(([n, x, y]) => {
            const dx = x - cam.x, dy = y - cam.y;
            return { n, x0: Math.round((dx - 20) * sc), y0: Math.round((dy - 52) * sc), x1: Math.round((dx + 20) * sc), y1: Math.round((dy + 4) * sc) };
        });
    };
    const diff = (A, B, boxes, w) => {
        let inside = 0, outside = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let i = 0; i < A.length; i += 4) {
            const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
            if (d <= 30) continue;
            const px = i / 4, x = px % w, y = (px / w) | 0;
            let hit = false;
            for (const b of boxes) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) { hit = true; break; }
            if (hit) { inside++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
            else outside++;
        }
        return { inside, outside, bbox: inside ? [x0, y0, x1, y1] : null };
    };
    window.__ab = async () => {
        const cam = window.__lastCam;
        const frame = window.__lastFrame;
        window.__hideParty = false;
        const a1 = await grab();
        const a2 = await grab();
        window.__hideParty = true;
        const b = await grab();
        window.__hideParty = false;
        const bx = boxes();
        return { vsHidden: diff(a1.data, b.data, bx, a1.w), floor: diff(a1.data, a2.data, bx, a1.w), boxes: bx, cam, frame };
    };
    // ── The WHOLE-TILE-MAP pass ────────────────────────────────────────────────
    // Every walkable pixel of the tunnel footprint, probed at FRACTIONAL coords
    // (x+0.5, y+0.5) — the walking condition, because the disc reads INTEGER
    // pixels while the walker's own `state.x`/`state.y` are fractional on the
    // move. A per-tile read that only ever runs on integer placements (the
    // earlier route checkpoints) cannot see the exact-zone row lookup miss.
    // `disc` = the zone the disc's own data puts under the pixel: byte 1 writes
    // the draw-layer word to 8 (hide), byte 226 to 4 (restore); every other byte
    // writes nothing. `seen` = the op-5 word the engine's setup arm actually
    // produces there.
    window.__tileMapCheck = (bbox) => {
        const [X0, Y0, X1, Y1] = bbox;
        const ts = window.__engineTriggerSystem;
        const s = window.__state;
        const zones = s.storyZones && s.storyZones["375"];
        const rows = new Map();
        for (const r of zones) { const l = rows.get(r[2]); if (l) l.push(r); else rows.set(r[2], [r]); }
        const zbyte = (x, y) => { const rr = rows.get(y); if (rr) for (const r of rr) if (x >= r[0] && x <= r[1]) return r[3] & 0xff; return 0; };
        const coll = s.collision["s375"]; const cell = coll.cell, cols = coll.cols, nrows = coll.rows;
        const blocked = (x, y) => { const c = (x / cell) | 0, r = (y / cell) | 0; if (c < 0 || r < 0 || c >= cols || r >= nrows) return true; return coll.cells[r * cols + c] === 1; };
        const actor78At = (x, y) => { const eff = ts.setup("s375", x, y, 0); return (eff && eff.effect && eff.effect.actor78 != null) ? (eff.effect.actor78 & 0xff) : null; };
        let walkable = 0, discHide = 0, discRestore = 0, missHide = 0, missRestore = 0, falseHide = 0, intMiss = 0;
        const exMissHide = [], exMissRestore = [], exFalseHide = [];
        for (let y = Y0; y < Y1; y++) {
            for (let x = X0; x < X1; x++) {
                if (blocked(x, y)) continue;
                walkable++;
                const d = zbyte(x, y);
                const got = actor78At(x, y);          // integer read: the placed / stopped case
                if (got !== null && d !== 1 && d !== 226) { falseHide++; if (exFalseHide.length < 12) exFalseHide.push([x, y, d, got]); }
                if (d === 1) { discHide++; if (got !== 8 && exMissHide.length < 12) exMissHide.push([x, y, got]); }
                else if (d === 226) { discRestore++; if (got !== 4 && exMissRestore.length < 12) exMissRestore.push([x, y, got]); }
                // fractional read: the WALKING condition (what the operator does)
                const walk = actor78At(x + 0.5, y + 0.5);
                if (d === 1) { if (walk !== 8) { missHide++; if (exMissHide.length < 12) exMissHide.push([x + 0.5, y + 0.5, walk]); } }
                else if (d === 226) { if (walk !== 4) { missRestore++; if (exMissRestore.length < 12) exMissRestore.push([x + 0.5, y + 0.5, walk]); } }
                // the flag must also reach `state.playerDrawBucket` the same way when rolled
                if ((d === 1 || d === 226) && got !== (d === 1 ? 8 : 4)) intMiss++;
            }
        }
        return { walkable, discHide, discRestore, missHide, missRestore, falseHide, intMiss, exMissHide, exMissRestore, exFalseHide };
    };
}, ROUTE);

const fmt = (d) => `${d.inside}px in the party's boxes (${d.outside} elsewhere)${d.bbox ? " bbox" + JSON.stringify(d.bbox) : ""}`;

let failures = 0;
const results = {};
async function checkpoint(name, idx) {
    if (idx > 0) await page.evaluate((r) => window.__walk(r), ROUTE.slice(0, idx + 1));
    await page.evaluate(([x, y]) => window.__place(x, y), ROUTE[idx]);
    await page.waitForTimeout(450);
    const r = await page.evaluate(() => window.__ab());
    await page.screenshot({ path: `${OUT}/${name}.png` });
    results[name] = r;
    console.log(`      ${name.padEnd(9)} b=${r.frame.bucket} under=${r.frame.playerUnderMap} cover=${r.frame.groundCover}`);
    console.log(`                vs-hidden: ${fmt(r.vsHidden)}`);
    console.log(`                floor    : ${fmt(r.floor)}`);
    console.log(`                boxes    : ${JSON.stringify(r.boxes.map((b) => [b.n, b.x0, b.y0, b.x1, b.y1]))}`);
    return r;
}

try {
    const outside = await checkpoint("outside", IDX.outside);
    if (outside.frame.bucket === 4 && outside.vsHidden.inside > Math.max(outside.floor.inside * 2, 200))
        console.log("PASS  before the opening (real route): bucket 4, the party is DRAWN (over the ground)");
    else { failures++; console.log("FAIL  before the opening: expected bucket 4 and the party drawn"); }

    const mouth = await checkpoint("mouth", IDX.mouth);
    if (mouth.frame.bucket === 8 && mouth.vsHidden.inside > Math.max(mouth.floor.inside * 2, 200))
        console.log("PASS  through the stone opening (bucket 8 over layer-2): the party is SHOWN");
    else { failures++; console.log("FAIL  at the opening: expected bucket 8 and the party shown over layer 2"); }

    const corridor = await checkpoint("corridor", IDX.corridor);
    if (corridor.frame.bucket === 8 && corridor.vsHidden.inside <= Math.max(corridor.floor.inside + 60, 120))
        console.log("PASS  inside the corridor over the opaque floor: NO party pixel is drawn (covered by the ground)");
    else { failures++; console.log(`FAIL  inside the corridor: ${corridor.vsHidden.inside}px of the party are still drawn (floor ${corridor.floor.inside}) — the ground does not cover it`); }

    const diamond = await checkpoint("diamond", IDX.diamond);
    if (diamond.frame.bucket === 4 && diamond.vsHidden.inside > Math.max(diamond.floor.inside * 2, 200))
        console.log("PASS  at the far restore diamond: bucket 4, the party is DRAWN again");
    else { failures++; console.log(`FAIL  at the diamond: expected bucket 4 and the party drawn`); }

    // ── The WHOLE tile map, not one route ─────────────────────────────────────
    console.log("");
    console.log("  every walkable pixel of the tunnel footprint:");
    const tm = await page.evaluate((bbox) => window.__tileMapCheck(bbox), TUNNEL_BBOX);
    results.tileMap = tm;
    console.log(`      ${tm.walkable} walkable pixels   disc hides ${tm.discHide}   disc restores ${tm.discRestore}`);
    console.log(`      walk read (x+.5,y+.5): hidden tiles showing the party ${tm.missHide}, restore tiles failing ${tm.missRestore}`);
    console.log(`      placed read (x,y):     hidden/restore tiles wrong ${tm.intMiss}, party shown off-zone ${tm.falseHide}`);
    if (tm.exMissHide.length) console.log(`      e.g. shown where the disc hides (x,y,actor78): ${JSON.stringify(tm.exMissHide.slice(0, 6))}`);
    if (tm.discHide > 0 && tm.missHide === 0 && tm.missRestore === 0 && tm.intMiss === 0 && tm.falseHide === 0)
        console.log("PASS  every disc-hidden tile hides the character, every restore tile shows it — the whole map");
    else { failures++; console.log(`FAIL  the tunnel tile map disagrees with the disc: ${tm.missHide} hidden tiles still show the party`); }

    // ── Walk in from the east opening on a FRACTIONAL position ────────────────
    // The operator's own way in: they walk, they are not placed. The disc reads
    // integer pixels; the walker's state.x/state.y are fractional on the move.
    await page.evaluate(([x, y]) => {
        const s = window.__state;
        s.playerDrawBucket = 4; s.x = x; s.y = y; s.moving = true; s.stopping = false; s.dir = "left";
    }, EAST_WALK_START);
    let firstHidden = null, lastBucket = null;
    for (let i = 0; i < 90; i++) {
        await page.evaluate(() => { const s = window.__state; s.x = Math.max(1030, s.x - 1.7); s.moving = true; });
        await page.waitForTimeout(35);
        const st = await page.evaluate(() => ({ x: window.__state.x, b: window.__state.playerDrawBucket }));
        lastBucket = st.b;
        if (st.b === 8 && firstHidden === null) firstHidden = st.x;
    }
    results.walk = { firstHidden, lastBucket };
    console.log("");
    console.log(`  walking in from the east opening at fractional y=${EAST_WALK_START[1]}:`);
    console.log(`      bucket turned 8 at x=${firstHidden === null ? "never" : firstHidden.toFixed(1)}   (ended bucket ${lastBucket})`);
    if (firstHidden !== null && firstHidden <= 1071)
        console.log("PASS  the hide lands while the party is still walking in (fractional position)");
    else { failures++; console.log("FAIL  walking in never hid the party — the hide only lands on an integer position"); }

    await writeFile(`${OUT}/tunnel_ab_acceptance.json`, JSON.stringify({ results, errs }, null, 2));
    if (errs.length) { failures++; console.log(`FAIL  page errors: ${errs.join(" | ")}`); }
    console.log(failures ? `VERDICT FAIL (${failures})` : "VERDICT OK");
} catch (e) {
    console.log(`FAIL  harness: ${e.stack || e.message}`);
    console.log("VERDICT FAIL");
    failures++;
} finally {
    await browser.close();
}
process.exit(failures ? 1 : 0);
