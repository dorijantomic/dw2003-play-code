// Drive the card duel in the UI lab far enough to exercise the pile widget and
// the banner slide, and fail loudly on any page error.
//
// This is the HAND-AUTHORED duel (web/cardduel.js). Since the native pro/cardgame
// screen became the production route, the lab must be asked for the
// `?legacyDuel=1` rollback (web/ui-lab.html forwards its query params to the game
// iframe). The native route's own proof is tools/verify_native_duel.mjs and
// tools/verify_native_duel_play.mjs.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
const out = process.argv[2] ?? "/tmp/cardduel";
mkdirSync(out, { recursive: true });

const errors = [];
const b = await chromium.launch({
  channel: "chromium-headless-shell",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
p.on("pageerror", (e) => { errors.push(`PAGEERROR: ${e.message}`); });
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`CONSOLE: ${m.text()}`);
});

await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
console.log("game booted");

// Screenshot the game canvas itself, inside the iframe.
// A direct canvas-element screenshot comes back blank (the drawing buffer is
// not preserved), so clip a page screenshot to the iframe's box instead.
const shotCanvas = async (path) => {
  await p.screenshot({ path, fullPage: true });
};

await p.click('[data-scr="cardduel"]');
await p.waitForTimeout(1500);
await shotCanvas(`${out}/duel-open.png`);
console.log("opened card duel");

// Advance through the announcements and into the deal: confirm repeatedly.
// The iframe sits below the fold in this layout, so bring it into view before
// clicking it — keyboard events go to whatever is focused.
// Real clicks are intercepted by the lab page's own layout, so drive the game
// by dispatching the key events its handlers listen for, inside the iframe.
const press = (key) => p.evaluate((k) => {
  const w = document.getElementById("game").contentWindow;
  for (const type of ["keydown", "keyup"]) {
    w.dispatchEvent(new w.KeyboardEvent(type, { key: k, bubbles: true }));
    w.document.dispatchEvent(new w.KeyboardEvent(type, { key: k, bubbles: true }));
  }
}, key);

for (let i = 0; i < 14; i++) {
  await press("Enter");
  await p.waitForTimeout(700);
  if (i === 3 || i === 7 || i === 13) {
    await shotCanvas(`${out}/duel-step${i}.png`);
    console.log("shot step", i);
  }
}

// Read back the internals we care about, from inside the iframe.
const probe = await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  const d = w.__labDuel ?? null;
  return {
    hasHook: !!d,
    phase: d?.duel?.phaseIndex ?? "n/a",
    playerDeck: d?.duel?.player?.deck?.length ?? null,
    playerHand: d?.duel?.player?.hand?.length ?? null,
  };
});
console.log("probe:", JSON.stringify(probe));

await b.close();
if (errors.length) {
  console.log("--- ERRORS ---");
  for (const e of errors) console.log(e);
  process.exit(1);
}
console.log("no page errors");
