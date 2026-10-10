// Which sprite animation states and effect runs a WHOLE duel actually reaches.
//
// verify_cardduel_anim.mjs only presses Enter, so it never summons and never
// gets to the Battle Phase — it cannot observe states 5..11 whether they work
// or not. This one plays: it summons in the Summon Phase and confirms
// everywhere else, then reports every state and effect run it saw and which of
// the decoded ones it never did.
//
// The decoded states (cardduel-animation-decoded-2026-08-05 §3):
//   1 idle | 2 move+sound | 3 move silent | 4 flip | 5 summon arc
//   6 shake squash | 7 shake stretch | 8 hold 10f | 9 hold 0x24 | 10 hold 0x1C
//   11 active border (clip 9)
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));

// The legacy duel: this check reads the old shell's own surface, which the native duel — the default since web/game.js:545 — does not expose. Census: docs/research/card/CARD-DUEL-VERIFIED.md 34.
await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "networkidle" });
const frame = p.frames().find((f) => f.url().includes("index.html")) || p.mainFrame();
await frame.waitForFunction(() => !!window.__labOpen, null, { timeout: 20000 });
await frame.evaluate(() => window.__labOpen("cardduel"));
await p.waitForTimeout(2500);
await p.locator("iframe").first().click({ position: { x: 200, y: 200 } }).catch(() => {});
await p.waitForTimeout(300);

const states = new Set(), runs = new Set();
const phasesSeen = [];
const probe = () => frame.evaluate(() => {
  const d = window.__labDuel;
  if (!d) return null;
  return {
    phase: d.phaseKey?.() ?? null,
    summonCursor: d.summonCursor?.() ?? null,
    sprites: [...d.sprites].map(([, r]) => ({ state: r.sprite.state, effect: r.sprite.effect })),
  };
});
const sample = async (n = 4, ms = 60) => {
  for (let i = 0; i < n; i++) {
    await p.waitForTimeout(ms);
    const s = await probe();
    if (!s) continue;
    if (s.phase) phasesSeen.push(s.phase);
    for (const sp of s.sprites) {
      if (sp.state != null) states.add(sp.state);
      if (sp.effect) runs.add(sp.effect);
    }
  }
};

await sample(6);
for (let step = 0; step < 220; step++) {
  const s = await probe();
  if (s?.phase === "summon" && s.summonCursor != null) {
    // square summons the card under the cursor; enter ends the turn
    await p.keyboard.press("v");
    await sample(4);
    await p.keyboard.press("Enter");
  } else {
    await p.keyboard.press("Enter");
  }
  await sample(3);
}

// States 7 and 9 are the PLAYER-WINS branch of playBattleReactions: 7 is the
// opponent's cards shaking, 9 the long effect over yours. A run in which the
// player never takes a battle cannot observe them however correct they are, so
// they are reported apart rather than as failures.
const DECODED = [1, 2, 3, 4, 5, 6, 8, 10, 11];
const NEEDS_PLAYER_WIN = [7, 9];
const seen = [...states].sort((a, c) => a - c);
const missing = DECODED.filter((s) => !states.has(s));
const winOnly = NEEDS_PLAYER_WIN.filter((s) => !states.has(s));
console.log(`phases=${[...new Set(phasesSeen)].join(",")}`);
console.log(`states_observed=[${seen}]`);
console.log(`states_NEVER_seen=[${missing}]${missing.length ? "  <-- FAILURE" : ""}`);
console.log(`not_seen_needs_a_player_win=[${winOnly}]`);
console.log(`effect_runs_observed=[${[...runs].sort()}]`);
if (errors.length) console.log("PAGE ERRORS:\n" + [...new Set(errors)].slice(0, 6).join("\n"));
await b.close();
