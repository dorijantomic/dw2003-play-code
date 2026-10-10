// tools/verify_cardduel_hold_repeat.mjs — the card duel's held-direction repeat.
//
// The disc's pickers read the pad service's REPEAT word as well as its pressed
// word: the hand selector F0x800875AC and the summon selector F0x800878B4 OR
// 0x8004B7D0->unk3FC with unk3F4 for the direction bits, and the folder chooser
// F0x8009F110 does the same for the up/down bits (claims
// cardgame-folder-chooser-pad-arms-2026-09-13; CARD-Q006). A held direction
// therefore walks the cursor on the shared edge/16/6/4 curve. This drives the
// real game loop with ONE keydown (no browser auto-repeat) and watches the
// folder chooser's cursor.
//
// Needs the lab served:  python3 -m http.server 8742 --directory web
// Run through the wrapper: .opencode/autonomy/check-browser tools/verify_cardduel_hold_repeat.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.env.DUEL_HOLD_SHOT || ".dw3-research/autonomous-plan/shots/cardduel-hold-repeat";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
p.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
// The legacy duel: this check reads the old shell's own surface (labDuel.chooserArrival, labDuel.chooserCursor, labDuel.handleKey, labDuel.open), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

const inGame = (fn, arg) => p.evaluate(({ src, a }) => {
  const w = document.getElementById("game").contentWindow;
  // eslint-disable-next-line no-new-func
  return new Function("w", "a", src)(w, a);
}, { src: fn, a: arg ?? null });

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };

try {
  await inGame(`w.__labOpen("cardduel"); w.__labDuel.open(null, "Opponent", null, 13);`);
  await p.waitForTimeout(1200);
  await inGame(`w.__labDuel.handleKey("circle");`);          // challenge -> chooser
  await p.waitForFunction(() => document.getElementById("game").contentWindow.__labDuel.chooserArrival()?.ready === true,
    null, { timeout: 5000 });
  const before = await inGame(`return w.__labDuel.chooserCursor();`);
  if (before !== 0) fail(`expected the chooser to open on folder 0, got ${before}`);

  // ONE keydown, no keyup: the browser sends no auto-repeat here, so any later
  // cursor movement is the decoded in-game repeat.
  await inGame(`w.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));`);
  const timeline = await inGame(`
    return new Promise((resolve) => {
      const out = [];
      const t0 = performance.now();
      let last = null;
      const tick = () => {
        const c = w.__labDuel.chooserCursor();
        if (c !== last) {
          out.push({ t: Math.round(performance.now() - t0), cursor: c, age: w.__labDuel.chooserArrival().age });
          last = c;
        }
        if (performance.now() - t0 > 1400) { resolve(out); return; }
        requestAnimationFrame(tick);
      };
      tick();
    });
  `);
  await inGame(`w.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown" }));`);
  const afterRelease = await inGame(`return w.__labDuel.chooserCursor();`);
  await p.waitForTimeout(400);
  const stillAfterRelease = await inGame(`return w.__labDuel.chooserCursor();`);
  writeFileSync(`${OUT}/chooser-held-down.png`,
    Buffer.from((await inGame(`return (w.document.querySelector("canvas#game") || document.querySelector("canvas")).toDataURL("image/png");`)).split(",")[1], "base64"));

  console.log("timeline:", JSON.stringify(timeline));
  if (timeline.length < 2) fail(`the held direction did not repeat: ${JSON.stringify(timeline)}`);
  const first = timeline[0];
  const repeat = timeline[1];
  if (first.cursor !== 1) fail(`the keydown edge did not move the cursor: ${JSON.stringify(timeline)}`);
  // The pad service counts TICKS, not wall time: the first repeat is the 17th
  // held frame (the edge plus 16), so the chooser's own age must advance by ~16
  // between the edge and the repeat (a slow swiftshader frame only stretches
  // the wall clock, which is why this asserts the age, not the milliseconds).
  const beat = repeat ? repeat.age - first.age : null;
  if (beat == null || beat < 15 || beat > 19)
    fail(`the first repeat was not the 16-tick beat (age +${beat}): ${JSON.stringify(timeline)}`);
  // The chooser has three rows: the repeat must clamp at 2 and never wrap to 0.
  if (timeline.some((s) => s.cursor === 0)) fail(`the cursor wrapped instead of clamping: ${JSON.stringify(timeline)}`);
  if (afterRelease !== stillAfterRelease) fail(`the cursor kept moving after release: ${afterRelease} -> ${stillAfterRelease}`);
  if (errors.length) fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, errors, before, timeline, afterRelease, stillAfterRelease }));
} catch (e) {
  await fail(e.message);
} finally {
  await b.close();
}
process.exit(failed ? 1 : 0);
