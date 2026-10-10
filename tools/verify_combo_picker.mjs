// Verify the combo-target picker (plan items C2 + C3) in the real game module.
//
// C2 — F0x8008C8D8 opens the cursor on a combo entry when one is available.
// C3 — F0x8008AD98 dims every field slot that is not part of a run, and gates
//      selection on the same flag.
//
// This drives web/game.js through the UI lab rather than a mock: it forces a
// three-of-a-kind onto the player's field, opens the picker, and reads the
// picker state and the rendered pixels back out.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || "/tmp/combopicker";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "networkidle" });
const frame = p.frames().find((f) => f.url().includes("index.html")) || p.mainFrame();
await frame.waitForFunction(() => !!window.__labOpen, null, { timeout: 20000 });
await frame.evaluate(() => window.__labOpen("cardduel"));
await p.waitForTimeout(2500);

const shot = (n) => p.locator("iframe").first().screenshot({ path: `${OUT}/${n}.png` })
  .catch(() => p.screenshot({ path: `${OUT}/${n}.png` }));

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

// Put a real run on the player's field: three copies of one card plus one of
// another, so exactly one slot must stay dimmed.
const setup = await frame.evaluate(() => {
  const d = window.__labDuel;
  if (!d?.duel) return { error: "no duel" };
  const cat = d.duel.byId;
  // pick a card that actually carries a combo target (+0x0a != 0)
  let run = null;
  for (const [id, rec] of cat) {
    const into = rec.comboInto ?? rec.unkA ?? 0;
    if (into !== 0 && rec.kind === "digimon") { run = rec; break; }
  }
  const other = [...cat.values()].find((r) => r !== run && r.kind === "digimon");
  if (!run || !other) return { error: "no suitable cards" };
  const slot = (r) => ({ id: r.id, ap: r.ap, hp: r.hp, baseAp: r.ap, baseHp: r.hp });
  d.duel.player.field = [slot(run), slot(other), slot(run), slot(run)];
  d.resyncSprites();
  return { runId: run.id, otherId: other.id };
});
console.log("setup:", JSON.stringify(setup));
if (setup.error) { console.log("SETUP FAILED"); await b.close(); process.exit(1); }

const opened = await frame.evaluate(() => {
  const d = window.__labDuel;
  return { available: d.comboPickerAvailable(), opened: d.openComboPicker() };
});
check(opened.available, "a field with three of a kind offers the picker");
check(opened.opened, "the picker opens");

await p.waitForTimeout(400);
await shot("01-picker-open");

const st = await frame.evaluate(() => {
  const d = window.__labDuel;
  return { cursor: d.picker?.cursor, dimmed: d.picker?.dimmed, runs: d.picker?.runs?.length };
});
console.log("picker:", JSON.stringify(st));
const keys = await frame.evaluate(() => [...window.__labDuel.sprites.keys()].filter((k)=>k.startsWith("you:field")));
console.log("field sprites:", JSON.stringify(keys));
check(keys.length === 4, "all four field slots have a sprite");
const pos = await frame.evaluate(() => [...window.__labDuel.sprites].filter(([k])=>k.startsWith("you:field")).map(([k,r])=>[k, r.sprite.x>>8, r.sprite.y>>8, r.sprite.state]));
console.log("positions:", JSON.stringify(pos));
check(JSON.stringify(st.dimmed) === JSON.stringify([false, true, false, false]),
      "only the non-run slot is dimmed");
check(st.dimmed?.[st.cursor] === false, "the cursor opens on a lit (combo) slot");
check(st.cursor === 0, "the forward pass lands on the first flagged slot");

// C3's gate: confirming on a dimmed slot must be refused (picker stays open).
await frame.evaluate(() => { window.__labDuel.picker.cursor = 1; });
await frame.evaluate(() => window.__labDuel.handleKey(" "));
const afterDimmed = await frame.evaluate(() => !!window.__labDuel.picker);
check(afterDimmed, "confirming a dimmed slot is refused and the picker stays open");
await shot("02-cursor-on-dimmed");

// ...and confirming a lit slot closes it.
await frame.evaluate(() => { window.__labDuel.picker.cursor = 0; });
await frame.evaluate(() => window.__labDuel.handleKey(" "));
const afterLit = await frame.evaluate(() => !!window.__labDuel.picker);
check(!afterLit, "confirming a lit slot closes the picker");

// Cancel path.
await frame.evaluate(() => window.__labDuel.openComboPicker());
await frame.evaluate(() => window.__labDuel.handleKey("escape"));
check(!(await frame.evaluate(() => !!window.__labDuel.picker)), "cancel closes the picker");

await shot("03-closed");

if (errors.length) { console.log("PAGE ERRORS:"); errors.forEach((e) => console.log("  " + e)); }
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall checks passed");
await b.close();
process.exit(fail.length || errors.length ? 1 : 0);
