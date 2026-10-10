// Journey 7 / Continue: an engine event row's `once` bit survives a reload.
//
// The original keeps a once-only stage-entry/talk cutscene's fired marker in the
// save context, so it fires once and never replays after Continue. The walker's
// EventManager used an in-memory Set, so every reload replayed every once row at
// the loaded stage. web/game.js now backs that set with localStorage
// `engineEvents` (engine/index.ts `onceStore`), and New Game clears it.
//
// The producer is s785's own OnEnterMap row `s785.auto.1` (event 014a0001, the
// starter-pack wizard). Leg 1 proves the fired marker is written; leg 2 reloads
// the same storage and proves that row does not fire again (while the next row,
// `s785.auto.3`, still does, because it had not run). No success value is seeded.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_event_once_persist.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.ONCE_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.ONCE_SHOT || "/tmp/event-once-persist";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
const fired = [];
page.on("console", (m) => {
  const hit = m.text().match(/EVENT FIRED (\S+)/);
  if (hit) fired.push(hit[1]);
});

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const shot = async (n) => writeFileSync(
  `${OUT}/${n}.png`,
  Buffer.from(
    (await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64",
  ),
);
const read = () => page.evaluate(() => ({
  engineEvents: JSON.parse(localStorage.getItem("engineEvents") ?? "[]"),
  pack: !!window.__state?.packSelect,
  busy: window.__engineBridge?.isBusy?.() ?? null,
}));

try {
  // ── leg 1: a fresh entry fires s785.auto.1 and persists the fired marker ────
  await page.goto(`${BASE}?noEncounters=1`);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("engineSchema", "2"); });
  await page.goto(`${BASE}?skipTitle=1&map=s785&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 15_000 });
  await page.waitForFunction(
    () => (JSON.parse(localStorage.getItem("engineEvents") ?? "[]")).includes("s785.auto.1"),
    null, { timeout: 8_000 },
  ).catch(() => {});
  await page.waitForTimeout(400);
  const leg1 = await read();
  await shot("once-leg1-fired");
  if (!fired.includes("014a0001"))
    await fail(`leg 1: the wizard row did not fire (fired=${JSON.stringify(fired)})`);
  if (!leg1.engineEvents.includes("s785.auto.1"))
    await fail(`leg 1: the fired marker was not persisted (${JSON.stringify(leg1.engineEvents)})`);

  // ── leg 2: reload the same storage; the fired row must not replay ───────────
  fired.length = 0;
  await page.reload();
  await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 15_000 });
  await page.waitForTimeout(2500);
  const leg2 = await read();
  await shot("once-leg2-reload");
  if (fired.includes("014a0001"))
    await fail(`leg 2: the already-fired wizard row replayed after reload (fired=${JSON.stringify(fired)})`);
  if (leg2.pack) await fail("leg 2: the pack wizard opened again after reload");
  if (!leg2.engineEvents.includes("s785.auto.1"))
    await fail(`leg 2: the marker was lost (${JSON.stringify(leg2.engineEvents)})`);
  // The next row in the stage had never run, so it must still fire — proving the
  // skip is the once bit, not the whole stage-entry path going dead.
  if (!fired.includes("014a0002"))
    await fail(`leg 2: the unseen follow-up row did not fire (fired=${JSON.stringify(fired)})`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, leg1, firedLeg2: fired, leg2 }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
