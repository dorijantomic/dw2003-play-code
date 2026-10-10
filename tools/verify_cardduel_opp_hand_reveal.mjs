// tools/verify_cardduel_opp_hand_reveal.mjs - the opponent's hand is re-shown
// when it next acts, not right after the deal collapse.
//
// Raw run-2 dump `cardgame_s5_run2_modes6plus.txt`: slot 06 goes to state 0 at
// frame 611 and stays there; at frame 2055 (the Summon Phase) it ramps sx
// 820 -> 4096 over `anim 2 dur 10` - the same in-place reveal the player's rows
// use. The walker used to reopen the hand immediately after the collapse (a
// guess from a dealt-board capture). Gap B7.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Run:  .opencode/autonomy/check-browser tools/verify_cardduel_opp_hand_reveal.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.env.DUEL_OPP_REVEAL_SHOT || ".dw3-research/autonomous-plan/shots/cardduel-opp-hand-reveal";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
// The legacy duel: this check reads the old shell's own surface (labDuel.duel, labDuel.handleKey, labDuel.sprites), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "load" });
await page.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

const inGame = (fn) => page.evaluate((src) => {
  const w = document.getElementById("game").contentWindow;
  // eslint-disable-next-line no-new-func
  return new Function("w", src)(w);
}, fn);

const failures = [];
const check = (ok, m) => { if (!ok) failures.push(m); else console.log("  ok:", m); };

try {
  await inGame(`w.__labOpen("cardduel");`);
  await page.waitForTimeout(800);
  // The challenge screen then the folder chooser; alternate confirm keys until
  // the duel model exists (same handshake as the other card-duel verifiers).
  for (let i = 0; i < 80; i++) {
    if (await inGame(`return !!w.__labDuel.duel;`)) break;
    await inGame(`w.__labDuel.handleKey(${JSON.stringify("enter")});`);
    await page.waitForTimeout(120);
  }
  check(await inGame(`return !!w.__labDuel.duel;`), "the duel started");
  // Drive the opening until the deal has spawned the opponent's hand row.
  for (let i = 0; i < 120; i++) {
    const n = await inGame(`return [...w.__labDuel.sprites.keys()].filter((k) => k.startsWith("opp:hand:")).length;`);
    if (n > 0) break;
    await inGame(`w.__labDuel.handleKey("enter");`);
    await page.waitForTimeout(80);
  }
  // Wait for the deal to land and the opponent's hand to collapse edge-on.
  const collapsed = await inGame(`
    const c = w.__labDuel;
    const cv = w.document.createElement("canvas"); cv.width = 320; cv.height = 240;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = false;
    const hand = () => [...c.sprites].filter(([k]) => k.startsWith("opp:hand:"));
    for (let i = 0; i < 300; i++) {
      c.draw(g, 320, 240);
      const h = hand();
      if (h.length && h.every(([, r]) => r.sprite.scaleX === 0)) return true;
    }
    return false;
  `);
  check(collapsed, "the opponent's hand is edge-on after the deal");
  const before = await inGame(`
    return [...w.__labDuel.sprites].filter(([k]) => k.startsWith("opp:hand:"))
      .map(([, r]) => r.sprite.scaleX);
  `);
  check(before.every((v) => v === 0), `and stays edge-on before it acts (${JSON.stringify(before)})`);

  // Pose the Summon Phase (a fixture) so the reveal fires; the shell's
  // revealOppHandOnSummon keys on phase(d).key === "summon" once per set.
  const reveal = await inGame(`
    const c = w.__labDuel, d = c.duel;
    d.phaseIndex = 3;               // DUEL_PHASES[3] = Summon
    c.handleKey("circle");          // if a banner is up, dismiss it
    const cv = w.document.createElement("canvas"); cv.width = 320; cv.height = 240;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = false;
    const keys = [...c.sprites.keys()].filter((k) => k.startsWith("opp:hand:"));
    const out = [];
    let png = null;
    for (let f = 0; f < 40; f++) {
      c.draw(g, 320, 240);
      const sx = keys.map((k) => c.sprites.get(k)?.sprite.scaleX ?? -1);
      out.push(sx);
      if (f === 8) png = cv.toDataURL();
      if (sx.length && sx.every((v) => v === 4096)) break;
    }
    return { keys, out, png };
  `);
  const final = reveal.out[reveal.out.length - 1];
  console.log("  reveal scales:", JSON.stringify(reveal.out.slice(0, 16)));
  check(final.length > 0 && final.every((v) => v === 4096),
    `the hand comes back full width when the Summon Phase starts (${JSON.stringify(final)})`);
  // The first slot leads the last: at the frame where slot 0 is part-way, the
  // last slot must not be ahead of it.
  const lead = reveal.out.find((s) => s[0] > 0 && s[0] < 4096);
  check(!!lead && (lead[lead.length - 1] <= lead[0]),
    "the reveal is staggered in slot order (the first slot leads the last)");
  if (reveal.png) {
    writeFileSync(`${OUT}/reveal-mid.png`, Buffer.from(reveal.png.split(",")[1], "base64"));
  }
  if (errors.length) check(false, `${errors.length} page error(s)`);
} catch (e) {
  check(false, `check threw: ${e.message}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\nFAILED:");
  for (const m of failures) console.error(" -", m);
  process.exit(1);
}
console.log("\nOK: the opponent's hand is re-shown by the in-place reveal at the Summon Phase");
