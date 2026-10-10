// tools/compare_cardduel_to_disc.mjs — drive the WALKER through the same beats
// the disc was driven through on the rig, and shoot one frame per beat, so the
// two can be put side by side.
//
// This exists because checking one screen at a time and declaring it right is
// how the duel ended up looking nothing like the disc while every individual
// check passed. The disc side is tools/windows-rig/play-cardduel.lua.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/cardduel-walker-beats";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  w.__labOpen("cardduel"); w.__labDuel.open(null, "Opponent", null, 13);
});
await p.waitForTimeout(1500);

const press = async (k, ms = 130) => {
  await p.evaluate(() => document.getElementById("game").contentWindow.focus());
  await p.keyboard.press(k);
  await p.waitForTimeout(ms);
};
const state = () => p.evaluate(() => {
  const d = document.getElementById("game").contentWindow.__labDuel;
  return {
    open: d.openingScreen(),
    phase: d.phaseKey(),
    stage: d.play?.stage ?? null,
    setEnd: d.setEndState()?.step ?? null,
    hand: d.duel?.player.hand.length ?? null,
    field: d.duel?.player.field.length ?? null,
  };
});
async function shot(name) {
  const url = await p.evaluate(() => {
    const w = document.getElementById("game").contentWindow;
    const c = w.document.createElement("canvas");
    c.width = 320; c.height = 240;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    w.__labDuel.draw(g, 320, 240);
    return c.toDataURL("image/png");
  });
  writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
  console.log("beat", name, JSON.stringify(await state()));
}

// Every beat, in the order the duel reaches them.
await shot("00-challenge");
await press("Enter"); await shot("01-chooser");
await press("Enter"); await shot("02-start-announce");
await press("Enter"); await p.waitForTimeout(600); await shot("03-coin");
for (let i = 0; i < 8; i++) { await press("Enter", 400); }
await shot("04-after-coin");
// walk to the Draw Phase deal
for (let i = 0; i < 12; i++) {
  const s = await state();
  if (s.phase === "draw") break;
  await press("Enter", 400);
}
await shot("05-draw-announce");
await press("Enter", 250); await shot("06-deal-early");
await p.waitForTimeout(900); await shot("07-deal-late");
await p.waitForTimeout(1200); await shot("08-board-dealt");
// on to the Load Phase and its question
for (let i = 0; i < 40; i++) {
  const s = await state();
  if (s.phase === "load" || s.stage) break;
  await press("Enter", 300);
}
await shot("09-load-announce");
for (let i = 0; i < 40; i++) {
  const s = await state();
  if (s.stage === "ask") break;
  await press("Enter", 250);
}
await shot("10-ask");
// force the browser open even when nothing is playable, so the beat is comparable
await p.evaluate(() => {
  const d = document.getElementById("game").contentWindow.__labDuel;
  if (d.play) { d.play.frozen = false; d.play.ask = 0; }
});
await press("Enter"); await shot("11-browser");
await press("Enter"); await shot("12-commit");
await press("Enter", 500); await shot("13-after-play");
await b.close();
