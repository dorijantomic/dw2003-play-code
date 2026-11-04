// The game's own reaction bubbles over a friend's head (web/mp-emotes.js).
//
// F2 -> Extras -> "The game's own reaction bubbles" (off by default). With it on, two of
// the eight multiplayer emotes stop being a typed character and become the disc's own
// balloon: FIELDCOM balloon id 0x35 with the glyph row the game's own program table gives
// it (web/fieldcom.js drawIndicatorBubble). Only "!" (emote 1 — the game's list starts with
// the heart, so "!" is not 0 — KIND.exclaim, program 0) and "..." (emote 3, KIND.dots,
// program 3) have a row in that table. The other six have
// no mark on the disc (smoke is a puff, the arrows say directions), so they keep the typed
// glyph — the honest fallback, nothing invented. With the switch off nothing changes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMOTE_BUBBLE, bubbleFor, bubbleTick } from "../web/mp-emotes.js";
import { drawIndicatorBubble, KIND, BALLOON_ANCHOR_LIFT } from "../web/fieldcom.js";
import { EMOTES, drawGhostLabel } from "../web/multiplayer.js";

const MP_SRC = readFileSync(new URL("../web/multiplayer.js", import.meta.url), "utf8");
const GAME_SRC = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
const FC_SRC = readFileSync(new URL("../web/fieldcom.js", import.meta.url), "utf8");
const AMB_SRC = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
const MANIFEST = JSON.parse(
  readFileSync(new URL("../web/assets/ui/fieldcom.json", import.meta.url), "utf8"));

test("only the ! and ... emotes map to a FIELDCOM glyph row; the other six have none", () => {
  assert.deepEqual(Object.keys(EMOTE_BUBBLE), ["1", "3"]);
  assert.equal(bubbleFor(1), 0);
  assert.equal(bubbleFor(3), 3);
  for (const i of [0, 2, 4, 5, 6, 7]) assert.equal(bubbleFor(i), null, `emote ${i}`);
  assert.equal(bubbleFor(-1), null);
  assert.equal(bubbleFor(8), null);
});

test("the emote numbers are the game's own list: 0 is the heart, 1 is ! and 3 is ...", () => {
  // web/multiplayer.js EMOTES builds the F4 panel's buttons in this order and sends the
  // index, so the raw index is the only thing the bubble map may key on.
  assert.equal(EMOTES[0], "♥");
  assert.equal(EMOTES[1], "!");
  assert.equal(EMOTES[3], "...");
  assert.equal(EMOTE_BUBBLE[1], KIND.exclaim, "! wears the disc's exclaim row");
  assert.equal(EMOTE_BUBBLE[3], KIND.dots, "... wears the disc's dots row");
});

test("the mapped kinds are the fieldcom module's own exclaim 0 and dots 3", () => {
  // The disc's table (FIELDSTG.PRO 0x800975c0) is decoded in web/fieldcom.js; the emote
  // module keeps plain numbers, so a test pins them to KIND by source and by import.
  assert.match(FC_SRC, /exclaim:\s*0\b/, "KIND.exclaim is 0 in web/fieldcom.js");
  assert.match(FC_SRC, /dots:\s*3\b/, "KIND.dots is 3 in web/fieldcom.js");
  assert.equal(KIND.exclaim, 0);
  assert.equal(KIND.dots, 3);
  assert.equal(EMOTE_BUBBLE[1], KIND.exclaim);
  assert.equal(EMOTE_BUBBLE[3], KIND.dots);
});

test("the fieldcom manifest is the table the bubbles are drawn from", () => {
  const programs = MANIFEST.programs;
  assert.ok(Array.isArray(programs), "manifest.programs");
  assert.equal(programs.length, 11, "programs 0..10");
  assert.deepEqual(programs[0], [{ id: 0, delay: 60 }], "program 0 is the standing !");
  assert.equal(programs[3].length, 4, "program 3 is the four-step dots");
  assert.equal(programs[3].at(-1).id, 53, "the dots rest on id 53");
  for (const [p, program] of programs.entries()) {
    assert.ok(program.length > 0, `program ${p} has steps`);
    for (const step of program) {
      assert.ok(Number.isInteger(step.id) && step.id >= 0 && step.id <= 255, `program ${p} id`);
      assert.ok(Number.isInteger(step.delay) && step.delay > 0, `program ${p} delay`);
    }
  }
});

test("bubbleTick is the 60fps program clock: ten ticks a frame, pure", () => {
  assert.equal(bubbleTick(0), 0);
  assert.equal(bubbleTick(1000), 600, "60 frames x 10 ticks");
  assert.equal(bubbleTick(16), 0, "inside the first frame");
  assert.equal(bubbleTick(17), 10, "the second frame");
  assert.equal(bubbleTick(1234), bubbleTick(1234), "same clock, same tick");
});

test("the balloon draw is gated by the F2 switch and the glyph stays the else branch", () => {
  const start = MP_SRC.indexOf("export function drawGhostLabel(");
  const end = MP_SRC.indexOf("\n// ------------------------------------------------------------ the panel", start);
  assert.ok(start >= 0 && end > start, "drawGhostLabel not found");
  const fn = MP_SRC.slice(start, end);
  assert.match(fn, /window\.__fx\?\.mpbubbles/, "the F2 switch is read in drawGhostLabel");
  const gate = fn.indexOf("window.__fx?.mpbubbles");
  const call = fn.indexOf("drawIndicatorBubble(");
  assert.ok(call > gate, "the balloon is drawn only after the switch says yes");
  assert.match(fn, /bubbleFor\(g\.emoteIx\)/, "the raw emote index selects the glyph row");
  // headY is ALREADY the game's balloon anchor (game.js passes balloonAnchorY(...), the ground
  // minus 0x1b), so the balloon is drawn at headY itself. Adding BALLOON_ANCHOR_LIFT a second
  // time drops it 27 px down the canvas, onto the body and feet instead of over the head.
  assert.match(fn, /drawIndicatorBubble\(\s*ctx,\s*Math\.round\(sx\),\s*headY,/,
    "the balloon draws at headY, the game's own anchor");
  assert.doesNotMatch(fn, /BALLOON_ANCHOR_LIFT/, "no second anchor lift in the draw");
  assert.match(fn, /\}\s*else\s*\{[\s\S]*?fillText\(g\.emote/, "the other six emotes keep the typed glyph");
  assert.equal(EMOTES.length, 8);
});

test("headY is already the game's balloon anchor, so the balloon cannot slip 27 px down", () => {
  // game.js draws the name tag and the balloon from the one point balloonAnchorY() gives:
  // ground - BALLOON_ANCHOR_LIFT (0x1b = 27), the same anchor every other bubble in the game
  // hangs from. These pins keep drawGhostLabel's headY meaning that, not the bare ground.
  assert.match(GAME_SRC, /drawGhostLabel\(ctx, g, [^\n]*balloonAnchorY\(g\.y - camY\)\)/,
    "a friend's headY is balloonAnchorY(g.y - camY)");
  assert.match(GAME_SRC, /drawGhostLabel\(ctx, me, [^\n]*balloonAnchorY\(state\.y - camY\)\)/,
    "my own headY is balloonAnchorY(state.y - camY)");
  assert.equal(BALLOON_ANCHOR_LIFT, 0x1b, "the lift headY already carries");
  // ...and multiplayer.js does not import it any more, so no caller can add it back by habit.
  assert.doesNotMatch(MP_SRC, /import \{[^}]*BALLOON_ANCHOR_LIFT[^}]*\} from "\.\/fieldcom\.js"/,
    "web/multiplayer.js no longer imports the anchor lift");
});

test("the switch is in F2 -> Extras and starts off", () => {
  const extras = AMB_SRC.match(/\["Extras", \[([^\n]*)\n/);
  assert.ok(extras, "the Extras group is in web/ambience.js");
  assert.match(extras[1], /\["mpbubbles", "The game's own reaction bubbles"\]/);
  const experimental = AMB_SRC.match(/const EXPERIMENTAL = \[([\s\S]*?)\];/);
  assert.ok(experimental, "EXPERIMENTAL list found");
  assert.match(experimental[1], /"mpbubbles"/, "off by default");
});

test("drawing before the atlas is loaded does nothing and does not throw", () => {
  let calls = 0;
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => { calls++; };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  assert.equal(drawIndicatorBubble(ctx, 100, 50, KIND.exclaim, 0), undefined);
  assert.equal(drawIndicatorBubble(ctx, 100, 50, KIND.dots, 0), undefined);
  assert.equal(calls, 0, "no draw call before loadFieldcom");
});

test("off draws every typed glyph; on, only ! and ... give way to the balloon", () => {
  const drawn = [];
  const ctx = {
    save() {}, restore() {},
    measureText: (t) => ({ width: String(t).length * 6 }),
    fillRect() {},
    fillText: (t) => drawn.push(String(t)),
  };
  const ghost = { name: "Agumon", emote: "!", emoteIx: 1, say: "" };
  const glyphCount = (ch) => drawn.filter((t) => t === ch).length;
  try {
    globalThis.window = { __fx: {} };
    drawGhostLabel(ctx, ghost, 10, 100);
    assert.equal(glyphCount("Agumon"), 1, "the name tag still draws");
    assert.equal(glyphCount("!"), 2, "off: today's typed glyph, shadow + face");

    drawn.length = 0;
    globalThis.window = { __fx: { mpbubbles: true } };
    drawGhostLabel(ctx, ghost, 10, 100);
    assert.deepEqual(drawn, ["Agumon"], "on: the disc's balloon instead of the typed !");

    drawn.length = 0;
    drawGhostLabel(ctx, { ...ghost, emote: "♥", emoteIx: 0 }, 10, 100);
    assert.equal(glyphCount("♥"), 2, "on: the heart has no disc row and keeps its typed glyph");

    drawn.length = 0;
    drawGhostLabel(ctx, { ...ghost, emote: "...", emoteIx: 3 }, 10, 100);
    assert.deepEqual(drawn, ["Agumon"], "on: ... is the disc's dots balloon too");
  } finally {
    delete globalThis.window;
  }
});
