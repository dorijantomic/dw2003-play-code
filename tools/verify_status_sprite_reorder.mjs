// The pause STATUS card sprites after a party reorder — a before/after capture of
// the fix in engine/dw3/ui/pause-root-session.ts + web/status-translated.js.
//
// The operator's bug (docs/plans/2026-10-07-playtest-bugs.md item 9): a card kept
// the sprite of the Digimon that used to stand on it, so a party that owns no
// Kotemon showed one after a SORT swap. The party map (ctx+0x70) is seated with
// each member's ROSTER SLOT, so the picture row follows the Digimon.
//
// Serve web/ first:  python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_status_sprite_reorder.mjs
//
// BEFORE serves the committed bundle + the HEAD adapter; AFTER serves the freshly
// built engine (engine/** working tree) + the working-tree adapter. So the two
// shots differ only by this fix, and neither run rewrites web/vendor/engine.js.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.STATUS_ROOT || `${baseUrl(8742)}/`;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const OUT = process.env.STATUS_OUT || join(REPO, "captures/playtest-2026-10-07-you/status-sprite");
const FIXED_ENGINE = process.env.STATUS_ENGINE || "/tmp/engine-fixed.js";
mkdirSync(OUT, { recursive: true });

// Monmon, Renamon, Patamon — none sits at its pedestal's index, so every card
// would be wrong under the old pedestal-keyed map.
const PARTY = ["p005koet", "p009rena", "p010pata"];

const oldAdapter = execFileSync("git", ["show", "HEAD:web/status-translated.js"], { cwd: REPO });
const committedEngine = readFileSync(join(REPO, "web/vendor/engine.js"));
const fixedEngine = readFileSync(FIXED_ENGINE);

const CLASS = { items: 0x80091d18, sort: 0x800980b0, map: 0x8009913c, techniques: 0x80096380, status: 0x8008e744 };
const ROW = { sort: 1, status: 4 };

async function shot(page, variant) {
    const press = async (key, ms = 90, after = 140) => {
        await page.keyboard.down(key);
        await page.waitForTimeout(ms);
        await page.keyboard.up(key);
        await page.waitForTimeout(after);
    };
    const settled = (cls) => page.waitForFunction((c) => {
        const d = window.__status?.diagnostics?.();
        return d?.open === true && d.pending === false && d.classes.includes(c) && d.renderer.frames >= 60;
    }, cls, { timeout: 30000 });
    const leave = async () => {
        for (let i = 0; i < 24 && await page.evaluate(() => window.__status.isOpen()); i++) await press("Escape", 90, 700);
    };
    const menuRow = async (index) => {
        await page.evaluate(() => { window.__state.menuOpen = true; window.__menu.openAt("home"); });
        await page.waitForTimeout(300);
        for (let i = 0; i < index; i++) await press("ArrowDown", 90, 120);
        await press("Enter", 90, 200);
    };

    await page.goto(`${ROOT}?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 40000 });
    await page.evaluate((party) => {
        const s = window.__state;
        s.bits = 4321;
        s.party = party.slice();
        const base = { level: 12, xp: 100, tp: 30, hp: 45, maxHp: 500, mp: 21, maxMp: 25,
            core: [50, 40, 30, 20, 10, 5], elements: [1, 2, 3, 4, 5, 6, 7] };
        s.partyStats = s.party.map(() => ({ ...base }));
        s.partnerStats = s.partyStats[0];
        s.inventory = [{ id: 43, qty: 3 }];
        s.equipment = [];
    }, PARTY);

    // The party as it stands: three cards, one sprite each.
    await menuRow(ROW.status);
    await settled(CLASS.status);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${variant}-1-status-party.png` });

    // Reorder: swap the first and last partner on the SORT page, then look again.
    await leave();
    await menuRow(ROW.sort);
    await settled(CLASS.sort);
    await page.waitForTimeout(600);
    await press("Enter", 90, 500);     // pick the first partner
    await press("ArrowDown", 90, 200); // move to the last
    await press("Enter", 90, 500);     // swap
    await page.screenshot({ path: `${OUT}/${variant}-2-sort-swap.png` });
    await leave();
    await menuRow(ROW.status);
    await settled(CLASS.status);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${variant}-3-status-reordered.png` });
}

const browser = await chromium.launch({ headless: true });
try {
    for (const variant of ["before", "after"]) {
        const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e.message)));
        await page.addInitScript(() => {
            localStorage.setItem("assetMode", "authentic");
            localStorage.setItem("playerName", "Junior");
        });
        // Swap the adapter and the engine to one side of the fix or the other.
        await page.route("**/status-translated.js", (route) =>
            variant === "before"
                ? route.fulfill({ contentType: "text/javascript", body: oldAdapter })
                : route.continue());
        await page.route("**/vendor/engine.js", (route) =>
            route.fulfill({ contentType: "text/javascript",
                body: variant === "before" ? committedEngine : fixedEngine }));
        await shot(page, variant);
        console.log(`${variant}: ${errors.length ? `PAGE ERRORS ${errors.join(" | ")}` : "clean"} -> ${OUT}/${variant}-*.png`);
        await page.close();
    }
} finally {
    await browser.close();
}
