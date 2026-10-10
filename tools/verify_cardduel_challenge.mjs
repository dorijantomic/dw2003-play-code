// tools/verify_cardduel_challenge.mjs — the CHALLENGE screen, checked against
// the original-game reference frame.
//
// The challenge screen is rig run 1 frame 510 (web/assets/ref/cardduel/
// challenge.png): an amber "Card Battle Challenge" over the opponent's level
// and the name of the folder they play. That capture is opponent LV 10 /
// "Mother Nature Folder", which is CARD_NPC record 13, so the duel is opened
// against record 13 and the two frames are differenced pixel for pixel.
//
// The comparison runs INSIDE the page — it already has a PNG decoder and the
// reference is served next to the lab — so this needs no image library here.
//
// Needs the lab served:  python3 -m http.server 8742 --directory web
// Run through the wrapper: tools/run-playwright.sh tools/verify_cardduel_challenge.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/cardduel-challenge";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
// The legacy duel: this check reads the old shell's own surface (labDuel.draw, labDuel.open), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

// Open the duel against CARD_NPC record 13 rather than through the lab button,
// which passes no record at all.
await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  w.__labOpen("cardduel");
  w.__labDuel.open(null, "Opponent", null, 13);
});
await p.waitForTimeout(2000);

const result = await p.evaluate(async () => {
  const w = document.getElementById("game").contentWindow;
  const draw = () => {
    const c = w.document.createElement("canvas");
    c.width = 320; c.height = 240;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    w.__labDuel.draw(g, 320, 240);
    return { canvas: c, data: g.getImageData(0, 0, 320, 240).data };
  };
  const mine = draw();

  const img = new w.Image();
  await new Promise((ok, no) => {
    img.onload = ok; img.onerror = no;
    img.src = "assets/ref/cardduel/challenge.png";
  });
  const rc = w.document.createElement("canvas");
  rc.width = 320; rc.height = 240;
  const rg = rc.getContext("2d");
  rg.imageSmoothingEnabled = false;
  rg.drawImage(img, 0, 0);
  const ref = rg.getImageData(0, 0, 320, 240).data;

  // The backdrop is a scrolling plate, so it is never the same pixel twice.
  // Score the two BANDS — the banner at y 66..85 and the prompt window at
  // y 96..143 — which is what this screen actually is; the whole frame is
  // reported alongside so the backdrop's share is visible rather than hidden.
  const diff = (y0, y1) => {
    let n = 0, total = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < 320; x++) {
        const i = (y * 320 + x) * 4;
        total += 1;
        if (Math.abs(mine.data[i] - ref[i]) > 8
          || Math.abs(mine.data[i + 1] - ref[i + 1]) > 8
          || Math.abs(mine.data[i + 2] - ref[i + 2]) > 8) n += 1;
      }
    }
    return { n, total, pct: +(100 * n / total).toFixed(2) };
  };
  return {
    png: mine.canvas.toDataURL("image/png"),
    banner: diff(66, 86),
    prompt: diff(96, 144),
    whole: diff(0, 240),
  };
});

writeFileSync(`${out}/challenge.png`, Buffer.from(result.png.split(",")[1], "base64"));
const say = (label, d) => console.log(`${label}: ${d.n} / ${d.total} px  (${d.pct}%)`);
say("banner band  y 66..85 ", result.banner);
say("prompt band  y 96..143", result.prompt);
say("whole frame           ", result.whole);
console.log("wrote", `${out}/challenge.png`);

await b.close();
