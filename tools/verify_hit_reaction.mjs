// What a struck Digimon looks like in the walker, measured on the real GL path during a real
// fight.
//
// The original draws no colour change on a struck fighter at all. A fighter's triangles are
// submitted by FIGHTSTG_F0x80085110 (~/ddw3/asm/dw2003/pro/fightstg.s:2382), whose two
// arguments are the model object and an 8-word world matrix and which carries no colour,
// alpha or blend parameter (F0x80085f3c, :3289-3299); its per-primitive vertex colours are
// written from one site (:2783-2812) out of the model's own baked table; and the descriptor
// byte that would carry the semi-transparency flag is a constant picked by "is this primitive
// textured" (F0x80084bc0 :2057, F0x80084e0c :2180). Nor does the hit path write appearance:
// op1 (F0x8008b69c, :8769) and the damage-reaction machine (F0x8008d3b4, :10676) store clip
// and motion fields only. The on-hit appearance IS the reaction clip, the eyes shutting
// (F0x8008b118), the knockback distance, and the reaction script's own op10[99] sprite.
//
// The walker used to answer "the struck body goes red for 0.3 s", driven from web/battle.js
// when the damage was committed. So this plays an actual battle with the FIGHT command and
// watches the shader uniforms the GPU is handed, frame by frame, across the strike: while the
// struck fighter is playing its reaction, no red-dominant colour may reach the GPU. It also
// proves the reaction itself still happens -- the point is not that the hit became invisible,
// it is that the flash was never in the game.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    tools/run-playwright.sh tools/verify_hit_reaction.mjs [output-directory]
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { readBattleLine, runBattleTurn, tapCircle, waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.HIT_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.HIT_SHOT || process.argv[2] || ".bunny-scratch/hit-reaction";
mkdirSync(OUT, { recursive: true });

// A colour pushed toward red: red clearly above both of the other two. The colours this
// renderer legitimately draws a fighter with are white, plus the grey floor and the black sky.
const RED_PUSH = 0.05;

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

// Record every 4-component colour the renderer hands the GPU. WebGL calls go through the
// prototype, so patching it before any module loads sees the fighter draw calls too.
await page.addInitScript(() => {
  window.__tints = [];
  window.__tintFrame = null;
  for (const name of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
    const proto = window[name]?.prototype;
    if (!proto || !proto.uniform4fv) continue;
    const orig = proto.uniform4fv;
    proto.uniform4fv = function (loc, a, b, c, d) {
      const v = d !== undefined ? [a, b, c, d] : (ArrayBuffer.isView(a) ? Array.from(a) : a);
      if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number")) {
        (window.__tintFrame ??= []).push(v.map((n) => +n.toFixed(3)));
      }
      return d !== undefined ? orig.call(this, loc, a, b, c, d) : orig.call(this, loc, a);
    };
  }
});

await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  const member = (digimonId) => ({
    digimonId, level: 5, xp: 0, tp: 10, hp: 200, maxHp: 200, mp: 80, maxMp: 80,
    stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 40, chr: 20 },
    bonuses: {}, elemBonuses: {},
  });
  localStorage.setItem("partnerStats", JSON.stringify(member(3)));
  localStorage.setItem("partyStats", JSON.stringify([member(3), member(7), member(8)]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
});

// The 3D renderer publishes itself for headless probes (web/battle.js:1828).
const installProbe = () => page.evaluate(() => {
  window.__probe = {
    frames: [],
    arm() {
      window.__probe.frames = [];
      const r = window.__battle3d;
      if (!r) return false;
      // One probe record per rendered frame: the struck fighter's own timeline table, the
      // colour the GPU was handed this frame, and its eye picture.
      const restTable = window.__battle3d.getAnimationReadout().enemy?.table ?? null;
      const loop = async () => {
        if (!window.__battle3d) return;
        const read = r.getAnimationReadout();
        const table = read.enemy?.table ?? null;
        window.__probe.frames.push({
          t: Math.round(performance.now()),
          enemyTable: table,
          enemyAnimId: read.enemy?.animId ?? null,
          eye: r.debugPatchState?.("enemy")?.variants?.[0] ?? null,
          tints: window.__tintFrame ?? [],
        });
        window.__tintFrame = null;
        // The GL frame on the FIRST frame of the reaction -- where the old build's red flash
        // was up. That pair is the before/after a player would see.
        if (table !== null && table !== restTable && !window.__probe.shot) {
          window.__probe.shot = await r.debugCaptureFrame();
          window.__probe.shotAt = Math.round(performance.now());
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      return true;
    },
    shot: null,
    shotAt: null,
  };
  return !!window.__battle3d;
});

try {
  await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 20_000;
  let launched = false;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => ({
      battle: !!window.__battle?.isActive?.(),
      tb: window.__textbox?.isOpen?.() ?? false,
    }));
    if (st.battle) { launched = true; break; }
    if (st.tb) await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
  }
  assert.ok(launched, "the s200 PRE launched the scripted battle");
  await page.evaluate(() => { window.__gameSpeed = 1; });

  await page.waitForFunction(() => !!window.__battle3d, null, { timeout: 15_000 });
  assert.ok(await installProbe(), "the battle published its 3D renderer (window.__battle3d)");

  await waitForCommandMenu(page);
  // FIGHT is the first row of the six-row command list; the battle auto-selects it, so one
  // Circle confirms the command and the ordinary action plays.
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready,
                             null, { timeout: 10_000 });
  const restTable = await page.evaluate(() => window.__battle3d.getAnimationReadout().enemy?.table ?? null);
  const hpBefore = await page.evaluate(() => window.__battle?.peek?.()?.enemy?.hp ?? null);
  console.log(`at rest: enemy timeline table ${restTable}, enemy HP ${hpBefore}`);
  writeFileSync(`${OUT}/1-rest.png`, await page.screenshot());

  await page.evaluate(() => window.__probe.arm());
  const before = await page.evaluate(() => window.__probe.frames.length);
  // FIGHT is the row the list opens on, so one Circle confirms it. Every line the battle puts
  // up afterwards is read the way a player reads it, which is also what lets the action play:
  // the battle's timed phases do not advance while a line is up.
  await tapCircle(page);
  await runBattleTurn(page, {
    ticks: 120,
    pause: 60,
    until: (snap) => snap.state === 7 && snap.pages && snap.ready,
  });
  const hpAfter = await page.evaluate(() => window.__battle?.peek?.()?.enemy?.hp ?? null);
  console.log(`the hit landed: enemy HP ${hpBefore} -> ${hpAfter}`);
  assert.ok(hpAfter !== null && hpAfter < hpBefore,
    `the enemy's HP never fell (${hpBefore} -> ${hpAfter}); no hit was measured`);

  // Keep watching past the landing, so the whole of the old 0.3 s flash is inside the window
  // even if the damage line arrives first.
  await page.waitForTimeout(2500);
  const frames = await page.evaluate(() => window.__probe.frames);
  const shot = await page.evaluate(() => window.__probe.shot ?? null);
  assert.ok(shot, "the struck fighter's first reaction frame was not captured");
  writeFileSync(`${OUT}/2-reaction.png`, Buffer.from(shot.split(",")[1], "base64"));

  const reaction = frames.slice(before).filter((f) => f.enemyTable !== null && f.enemyTable !== restTable);
  const reactionTables = [...new Set(reaction.map((f) => f.enemyTable))];
  console.log(`${frames.length - before} frames watched, ${reaction.length} of them in the `
            + `struck fighter's reaction`);
  console.log(`the struck fighter played table(s) ${reactionTables.join(", ") || "(none)"} `
              + `(its resting table is ${restTable})`);
  assert.ok(reaction.length > 0,
    "the struck fighter never left its resting table, so no reaction was measured");

  const seen = new Map();
  const colours = new Set();
  for (const f of reaction) {
    for (const tint of f.tints) {
      colours.add(tint.join(","));
      const [r, g, b] = tint;
      if (r - g > RED_PUSH && r - b > RED_PUSH) seen.set(tint.join(","), (seen.get(tint.join(",")) || 0) + 1);
    }
  }
  console.log(`colours handed the shader during the reaction: ${[...colours].join(" | ")}`);
  assert.deepEqual([...seen.entries()], [],
    `a colour pushed toward red reached the shader while the struck fighter was reacting: `
    + `${[...seen.entries()]}`);

  // The struck fighter shuts its eyes on its hit tables: FIGHTSTG_F0x8008b118 holds the eye
  // picture at variant 2 for the fighter's state codes 4..11, and a hit plays the 3..6 tables.
  // The story's own enemy carries no animated texture patch, so this half only runs when the
  // enemy that turned up has one; tests/fight-texture-patch.test.js and
  // tools/verify_texture_patches.mjs prove the rule and the three pictures themselves.
  const eyes = new Set(reaction.map((f) => f.eye).filter((v) => v !== null));
  if (eyes.size) {
    console.log(`eye picture variants seen while it was hit: ${[...eyes].join(", ")}`);
    assert.ok(eyes.has(2),
      `the struck fighter never shut its eyes (variants seen: ${[...eyes].join(", ")})`);
  } else {
    console.log("this enemy carries no animated texture patch, so the eye half does not apply "
              + "here (the rule itself is proved in tests/fight-texture-patch.test.js)");
  }

  // And there is no flash entry point left to drive one.
  assert.equal(await page.evaluate(() => typeof window.__battle3d?.flashEnemy), "undefined");
  assert.equal(await page.evaluate(() => typeof window.__battle3d?.flashPlayer), "undefined");

  assert.deepEqual(errors, [], "page errors while the hit played");
  console.log(`\nOK: a landed hit took the enemy from ${hpBefore} to ${hpAfter} HP, it played its `
            + `reaction table(s) ${reactionTables.join(", ")}, and no colour change was drawn `
            + `over it.`);
} finally {
  await browser.close();
}