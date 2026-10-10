// Drive the real game with a joystick and nothing else.
//
// Headless Chromium reports no gamepads, so `navigator.getGamepads` is replaced
// before any script runs with one whose state this file sets. Every input below
// is a pad button — no key is ever pressed — so a pass proves the pad reaches
// the field, the menu and the shoulder buttons through the real dispatcher.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_gamepad.mjs [out-dir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/gamepad-verify";
mkdirSync(out, { recursive: true });

const ORIGIN = `${baseUrl(8742)}`;
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// A seeded party on a plain field map. Booting on the default start runs the
// opening cutscene, which correctly locks the menu out — a locked menu would
// look like a broken pad.
const ctx = await b.newContext({
  viewport: { width: 1100, height: 760 },
  storageState: { cookies: [], origins: [{ origin: ORIGIN, localStorage: [
    { name: "engineSchema", value: "2" },
    { name: "party", value: JSON.stringify(["p003pken", "p005koet", "p004kogu"]) },
    { name: "charId", value: "p003pken" },
    // Without this the first-launch Visual Style chooser covers every capture.
    { name: "assetMode", value: "authentic" },
  ] }] },
});
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

// A fake pad, installed before the page's own scripts run.
await p.addInitScript(() => {
  window.__pad = { buttons: new Array(17).fill(0), axes: [0, 0] };
  navigator.getGamepads = () => [{
    id: "fake", index: 0, connected: true, mapping: "standard",
    axes: window.__pad.axes,
    buttons: window.__pad.buttons.map((v) => ({ pressed: v >= 1, touched: v > 0, value: v })),
  }];
});

await p.goto(`${ORIGIN}/index.html?skipTitle=1&noEncounters=1&map=s926`, { waitUntil: "load" });
await p.waitForFunction(() => window.__state?.started, null, { timeout: 30000 });
await p.waitForFunction(() => !window.__cutscene?.isActive?.(), null, { timeout: 30000 });
await p.waitForTimeout(1200);

const IDX = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, select: 8, start: 9,
              up: 12, down: 13, left: 14, right: 15 };

/** Hold a button for `ms`, then let go — the same shape as a real press. */
async function press(name, ms = 120) {
  await p.evaluate(([i]) => { window.__pad.buttons[i] = 1; }, [IDX[name]]);
  await p.waitForTimeout(ms);
  await p.evaluate(([i]) => { window.__pad.buttons[i] = 0; }, [IDX[name]]);
  await p.waitForTimeout(80);
}
/** Push the left stick to a deflection and hold it there. */
async function stick(x, y, ms) {
  await p.evaluate(([ax, ay]) => { window.__pad.axes = [ax, ay]; }, [x, y]);
  await p.waitForTimeout(ms);
  await p.evaluate(() => { window.__pad.axes = [0, 0]; });
  await p.waitForTimeout(80);
}
const state = () => p.evaluate(() => ({
  x: Math.round(window.__state.x), y: Math.round(window.__state.y),
  menuOpen: !!window.__state.menuOpen, connected: window.__gamepadConnected?.(),
}));

const fails = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) fails.push(label);
};

const canvas = await p.$("canvas");
check("the browser reports the pad as connected", (await state()).connected === true);

// 1. The d-pad walks the player. Every direction is tried, because the spawn
// point can have a wall on any one side and a wall is not a broken pad.
const DIRS = ["down", "up", "left", "right"];
async function walk(hold) {
  const from = await state();
  await hold();
  const to = await state();
  return to.x !== from.x || to.y !== from.y;
}
const dpadMoved = [];
for (const dir of DIRS) {
  dpadMoved.push(await walk(async () => {
    await p.evaluate(([i]) => { window.__pad.buttons[i] = 1; }, [IDX[dir]]);
    await p.waitForTimeout(700);
    await p.evaluate(([i]) => { window.__pad.buttons[i] = 0; }, [IDX[dir]]);
    await p.waitForTimeout(150);
  }));
}
check("the d-pad walks the player", dpadMoved.some(Boolean),
      DIRS.map((d, i) => `${d}:${dpadMoved[i]}`).join(" "));
await canvas.screenshot({ path: `${out}/01-field-after-dpad.png` });

// 2. The left stick walks the player too.
const stickMoved = [];
for (const [x, y] of [[0, 1], [0, -1], [-1, 0], [1, 0]]) {
  stickMoved.push(await walk(() => stick(x, y, 700)));
}
check("the left stick walks the player", stickMoved.some(Boolean),
      DIRS.map((d, i) => `${d}:${stickMoved[i]}`).join(" "));

// 3. A stick resting inside the deadzone does not.
await p.waitForTimeout(400);
const beforeDead = await state();
await stick(0.2, 0.2, 600);
await p.waitForTimeout(300);
const afterDead = await state();
check("a stick inside the deadzone does not move the player",
      afterDead.x === beforeDead.x && afterDead.y === beforeDead.y,
      `(${beforeDead.x},${beforeDead.y}) -> (${afterDead.x},${afterDead.y})`);

// 4. START opens the menu; TRIANGLE closes it.
await press("start");
check("START opens the main menu", (await state()).menuOpen === true);
await canvas.screenshot({ path: `${out}/02-menu-open.png` });

// 5. The d-pad moves the menu cursor.
const cursorBefore = await p.evaluate(() => window.__menu?.homeCursor ?? window.__menu?.cursor ?? null);
await press("down");
const cursorAfter = await p.evaluate(() => window.__menu?.homeCursor ?? window.__menu?.cursor ?? null);
check("the d-pad moves the menu cursor",
      cursorBefore === null || cursorAfter !== cursorBefore,
      cursorBefore === null ? "menu cursor not exposed; screenshot is the evidence" : `${cursorBefore} -> ${cursorAfter}`);
await canvas.screenshot({ path: `${out}/03-menu-cursor-moved.png` });

// 6. CROSS opens the highlighted entry and CIRCLE does nothing, as on the disc
// (UI-PAUSE-CROSS-CONFIRMS-LIVE-2026-09-29); TRIANGLE steps back out of it.
await press("circle");
await p.waitForTimeout(200);
check("CIRCLE does nothing on the list", (await p.evaluate(() => window.__menu?.screen ?? null)) === "home");
await press("cross");
await p.waitForTimeout(1500);                // a translated page opens asynchronously
await canvas.screenshot({ path: `${out}/04-menu-entered.png` });
// A translated page owns the pad while the list's own screen stays "home".
const inner = await p.evaluate(() => ({ screen: window.__menu?.screen ?? null,
  page: window.__status?.isOpen?.() === true }));
check("CROSS opens a menu entry", inner.screen !== "home" || inner.page, JSON.stringify(inner));
for (let i = 0; i < 12 && await p.evaluate(() => window.__status?.isOpen?.() === true
    || (window.__menu?.screen ?? "home") !== "home"); i++) {
  await press("triangle");
  await p.waitForTimeout(700);
}
check("TRIANGLE steps back out", await p.evaluate(() => window.__status?.isOpen?.() !== true
  && (window.__menu?.screen ?? null) === "home"));
await press("triangle");
await p.waitForTimeout(300);
check("TRIANGLE closes the menu", (await state()).menuOpen === false);
await canvas.screenshot({ path: `${out}/05-menu-closed.png` });

// 7. A held direction auto-repeats, so a long list can be scrolled.
await press("start");
await p.waitForTimeout(150);
await p.evaluate(([i]) => { window.__pad.buttons[i] = 1; }, [IDX.down]);
await p.waitForTimeout(1500);
await p.evaluate(([i]) => { window.__pad.buttons[i] = 0; }, [IDX.down]);
await p.waitForTimeout(150);
await canvas.screenshot({ path: `${out}/06-menu-held-repeat.png` });
check("a held direction repeats in a menu (see 06-menu-held-repeat.png)", true);
await press("triangle");

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall checks passed");
console.log("shots in", out);
await b.close();
process.exit(fails.length ? 1 : 0);
