// Shoot the moment the loser's board is swept, and say which beat is on screen.
import { chromium } from "playwright";
const OUT = process.argv[2] ?? "/tmp/duelsweep";
import { mkdirSync } from "node:fs"; mkdirSync(OUT, { recursive: true });
import { baseUrl } from "./verify-base-url.mjs";
const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
await page.goto(`${baseUrl(8742)}/ui-lab.html`);
await page.waitForTimeout(2500);
const frame = page.frames().find((f) => f.url().includes("index.html")) ?? page.mainFrame();
await frame.evaluate(() => window.__labOpen && window.__labOpen("cardduel"));
await page.waitForTimeout(1500);
const canvas = await page.locator("iframe").first().contentFrame().locator("canvas").first();

// Stack the board so the player wins the exchange outright.
await frame.evaluate(() => new Promise((done) => {
  const c = window.__labDuel;
  const tick = () => {
    const d = c.duel;
    if (!d) { c.handleKey("enter"); return requestAnimationFrame(tick); }
    if (c.phaseKey() === "summon") return done(true);
    if (c.coin) c.handleKey("circle");
    else if (c.play) c.handleKey("cross");
    else if (c.picker || c.effectPicker) c.handleKey("circle");
    else c.handleKey("enter");
    requestAnimationFrame(tick);
  };
  tick();
}));
await frame.evaluate(() => {
  const d = window.__labDuel.duel;
  const ids = [...d.byId.keys()].filter((i) => d.byId.get(i).kind === "digimon");
  const slot = (id, ap, hp) => ({ id, ap, hp, shownAp: ap, shownHp: hp });
  d.player.field = [slot(ids[0], 90, 90), slot(ids[1], 90, 90)];
  d.opponent.field = [slot(ids[2], 5, 5), slot(ids[3], 5, 5)];
  window.__labDuel.resyncSprites();
});
await canvas.screenshot({ path: `${OUT}/00-before.png` });

// Run until a sweep beat is on screen, shooting as it goes.
let shots = 0;
for (let i = 0; i < 1200 && shots < 4; i++) {
  const st = await frame.evaluate(() => {
    const c = window.__labDuel, d = c.duel;
    if (!d) return null;
    if (c.coin) c.handleKey("circle");
    else if (c.play) c.handleKey("cross");
    else if (c.picker || c.effectPicker) c.handleKey("circle");
    else if (c.combo || c.setEnd) c.handleKey("circle");
    else c.handleKey("enter");
    return { beat: d.beat.current, phase: c.phaseKey(),
             you: d.player.field.length, foe: d.opponent.field.length,
             ops: d.ceremony.map((b) => b.op) };
  });
  if (st && (st.beat === 0x17 || st.beat === 0x18)) {
    await canvas.screenshot({ path: `${OUT}/0${++shots}-sweep-${st.beat.toString(16)}.png` });
    console.log("sweep beat", st.beat.toString(16), "you", st.you, "foe", st.foe);
  }
  await page.waitForTimeout(45);
}
const end = await frame.evaluate(() => {
  const d = window.__labDuel.duel;
  return { ops: d.ceremony.map((b) => b.op.toString(16)), you: d.player.field.length,
           foe: d.opponent.field.length, log: d.log.slice(-4) };
});
console.log(JSON.stringify(end));
await canvas.screenshot({ path: `${OUT}/09-after.png` });
await browser.close();
