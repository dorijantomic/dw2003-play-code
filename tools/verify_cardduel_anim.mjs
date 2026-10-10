// Capture the card duel across frames so the card MOTION is visible, not just
// a single static composition. Advances phases and samples the canvas mid-
// animation, then reports whether the sprites actually moved.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || "/tmp/duelanim";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

// The legacy duel: this check reads the old shell's own surface (labDuel?.phaseKey), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "networkidle" });

const frame = p.frames().find((f) => f.url().includes("index.html")) || p.mainFrame();
await frame.waitForFunction(() => !!window.__labOpen, null, { timeout: 20000 });
await frame.evaluate(() => window.__labOpen("cardduel"));
await p.waitForTimeout(2500);

// The lab only routes keys once the game canvas has focus.
await p.locator("iframe").first().click({ position: { x: 200, y: 200 } })
  .catch(() => {});
await p.waitForTimeout(300);

/** read the live sprite positions out of the real module */
const probe = () => frame.evaluate(() => {
  const d = window.__labDuel;
  if (!d) return null;
  return [...d.sprites].map(([k, r]) => ({
    key: k, x: r.sprite.x, y: r.sprite.y,
    sx: r.sprite.scaleX, sy: r.sprite.scaleY,
    state: r.sprite.state, effect: r.sprite.effect,
  }));
});

const shot = (n) => p.locator("iframe").first().screenshot({ path: `${OUT}/${n}.png` })
  .catch(() => p.screenshot({ path: `${OUT}/${n}.png` }));

const samples = [];
await shot("00-open");
samples.push(await probe());

// step a few phases, sampling densely right after each one so a tween is caught
// in flight rather than only at its endpoints
const phases = [];
for (let step = 0; step < 14; step++) {
  await p.keyboard.press("Enter");
  for (let i = 0; i < 6; i++) {
    await p.waitForTimeout(70);
    samples.push(await probe());
  }
  phases.push(await frame.evaluate(() => window.__labDuel?.phaseKey?.()));
  await shot(`${String(step + 1).padStart(2, "0")}-phase`);
  await p.waitForTimeout(500);
}
console.log(`phases=${phases.filter(Boolean).join(" -> ")}`);
await shot("99-settled");

const real = samples.filter(Boolean);
if (!real.length) {
  console.log("NO SPRITE PROBE — window.__labDuel not exposed");
} else {
  // did anything actually animate?
  const moved = new Set(), scaled = new Set(), effects = new Set(), states = new Set();
  const pos = new Map();
  for (const s of real) for (const c of s) {
    states.add(c.state);
    if (c.effect) effects.add(c.effect);
    if (c.sx !== 0x1000 || c.sy !== 0x1000) scaled.add(c.key);
    const prev = pos.get(c.key);
    if (prev && (prev.x !== c.x || prev.y !== c.y)) moved.add(c.key);
    pos.set(c.key, c);
  }
  console.log(`samples=${real.length} sprites_seen=${pos.size}`);
  console.log(`moved=${moved.size} scaled=${scaled.size}`);
  console.log(`states_observed=[${[...states].sort((a, b) => a - b).join(",")}]`);
  console.log(`effect_runs_observed=[${[...effects].sort().join(",")}]`);
}
console.log(errors.length ? `PAGE ERRORS:\n${errors.slice(0, 8).join("\n")}` : "no page errors");
await b.close();
