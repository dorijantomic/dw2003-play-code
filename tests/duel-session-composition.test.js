// Composition proof for the ordinary card duel: the translated controllers run
// together over one data memory with no interpreter. This drives the runnable
// half — the screen board (card-battle-scene), the duel object (duel-create),
// the scene handler's setup arm (duel-scene-handler over opponent-deck,
// intro-cue, card-battle-context, view-openers) and the tick's ported queue
// services (duel-queue, duel-view-queue) through the mode machine's opening
// (duel-mode-machine) — and pins the explicitly NAMED gaps: every edge whose
// original routine is not yet ported throws a TranslatedGapError naming it,
// never a silent success and never an instruction fetch.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DuelSession, TranslatedGapError, DUEL_UNPORTED_ROUTINES, DUEL_PORTED_BOARD_ROUTINES,
  DUEL_PORTED_VIEW_WINDOW_ROUTINES, DUEL_PORTED_EFFECT_COMMIT_ROUTINES,
  DUEL_PORTED_COUNTER_ROUTINES, DUEL_PORTED_AI_ROUTINES,
  DUEL_PORTED_MODE_UPDATE_ROUTINES,
} from "../engine/dw3/ui/duel-session.ts";
import { DUEL_METHOD_SLOTS, DUEL_SELECTOR } from "../engine/dw3/ui/duel-create.ts";
import { CARD_BATTLE_VIEW_HANDLER, CARD_BATTLE_PARENT } from "../engine/dw3/ui/card-battle-context.ts";
import { DUEL_SCENE_STATE } from "../engine/dw3/ui/duel-scene-handler.ts";
import { DUEL_MODE } from "../engine/dw3/ui/duel-mode-machine.ts";
import { DUEL_TICK_ARM } from "../engine/dw3/ui/duel-tick.ts";
import { SPINNER } from "../engine/dw3/ui/cardgame-draw.ts";
import { DUEL_CTX_VIEW, DUEL_CTX_INTRO, DUEL_CTX_FADE } from "../engine/dw3/ui/duel-scene-handler.ts";
import { DISPLAY_SERVICE, DISPLAY_SERVICE_FIELDS } from "../engine/dw3/display-service.ts";
import { PAD_BLOCK, PAD_PRESSED_IN_PORT, PAD_BUTTON_MAP_IN_PORT } from "../engine/systems/pad-block.ts";

test("the screen board builds the duel object with its factory's method table", () => {
  const session = new DuelSession({ shopId: 7 });
  const duel = session.buildScreenBoard();
  assert.ok(duel > 0, "the screen board created a duel object");
  assert.equal(session.mem.read8(duel + DUEL_SELECTOR), 7, "the duel carries the shop id");
  for (const [offset, target] of DUEL_METHOD_SLOTS) {
    assert.equal(session.mem.read32(duel + offset) >>> 0, target,
      `the duel installs its method pointer at +0x${offset.toString(16)}`);
  }
  // the screen object advanced to state 1 (its own handover word +0xC)
  assert.equal(session.mem.read32(session.screen + 0x0c) | 0, 1, "the screen advanced past setup");
  // the display view is registered in the resident display service
  const viewSlot = session.mem.read32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.viewBase) >>> 0;
  assert.ok(viewSlot > 0, "the screen board registered a display view");
});

test("the scene handler's setup arm builds the view, intro and fade and arms mode 1", () => {
  const session = new DuelSession({ shopId: 3 });
  const duel = session.buildScreenBoard();
  session.setupDuel();
  const view = session.view();
  assert.ok(view > 0, "the scene handler built the board view");
  assert.equal(session.mem.read32(view + CARD_BATTLE_PARENT) >>> 0, (duel + CARD_BATTLE_PARENT) >>> 0,
    "the view points back at the duel's parent cell");
  assert.ok(session.intro() > 0, "the scene handler built the intro voice object");
  assert.ok(session.fade() > 0, "the scene handler built the outro fade wash");
  assert.equal(session.mem.read32(duel + DUEL_SCENE_STATE) | 0, 2, "the duel advanced to its tick state");
  assert.equal(session.mode(), 1, "initDuelModeState armed mode 1");
  assert.ok(session.sounds().includes(0x609c0004), "the outro packed sound was played");
  void DUEL_SCENE_STATE;
});

test("the tick runs the mode machine's opening: mode 1 arms the waiting spinner", () => {
  const session = new DuelSession({ shopId: 1 });
  session.buildScreenBoard();
  session.setupDuel();
  const view = session.view();
  assert.equal(session.mem.read8(view + SPINNER.state) & 0xff, 0, "the spinner starts idle");
  assert.equal(session.tickFrame(), 0, "the first tick reports not finished");
  assert.equal(session.mem.read8(view + SPINNER.state) & 0xff, 1, "mode 1 started the spinner");
  assert.equal(session.mem.read8(session.duel() + DUEL_MODE.subStep) & 0xff, 1, "mode 1 moved to its wait sub-step");
  // the spinner's own state machine is untouched by the tick until the view is
  // drawn; the tick keeps reporting not finished while it waits
  assert.equal(session.tickFrame(), 0, "the tick waits on the spinner");
  assert.equal(session.mem.read8(session.duel() + DUEL_TICK_ARM) & 0xff, 0, "the tick arm stays in the mode-machine arm");
});

test("an un-ported routine is a named gap, never a silent success", () => {
  // The tick layer is now fully ported (DUEL_UNPORTED_ROUTINES is empty), so the
  // named gap the composed match reaches is an effect-layer edge: forcing the
  // mode machine's pending mode 5 and running full frames (tick + draw pass)
  // reaches the Battle Phase, whose effect VM arms opcode 0x98 and then asks for
  // its tick — still a named gap.
  const CONFIRM = (1 << 0xd) | (1 << 0xe);
  const session = new DuelSession({
    shopId: 5, padWord: () => CONFIRM, padRepeatWord: () => 0, padKeyBit: (_port, code) => code,
  });
  for (let i = 0; i < 16; i++) session.mem.write8(PAD_BLOCK + PAD_BUTTON_MAP_IN_PORT + i, i);
  session.buildScreenBoard();
  session.setupDuel();
  session.mem.write8(session.duel() + DUEL_MODE.pending, 5);
  let thrown = null;
  for (let i = 0; i < 300 && !thrown; i++) {
    session.mem.write16(PAD_BLOCK + PAD_PRESSED_IN_PORT, CONFIRM);
    try { session.runFrame(); } catch (e) { thrown = e; }
  }
  assert.ok(thrown instanceof TranslatedGapError, "the gap is a TranslatedGapError");
  assert.equal(thrown.routine, 0x8008642c, "the gap names the opcode-0x98 picker tick F0x8008642C");
  assert.match(thrown.message, /F0x8008642C/, "the message names the routine");
});

test("the composition lists every un-ported routine by address", () => {
  // Every one of the seventeen originally named tick-level pieces is now a real
  // ported body: the board view's browse refresh F0x8009E024 (and its
  // slot-colour query view+0xF40) is the last one to leave the list. The four
  // view method slots startAiPileBrowse's reveal walk needs are ported bodies
  // too; the view-window / resolving-card, effect/commit and counter/stat
  // families are ported separately; modes 2, 3, 4, 5/7, 6 and 8 are all real
  // update bodies (duel-draw-phase.ts, duel-mode-updates.ts and
  // duel-mode-battle.ts); the tick's effect-VM layer (F0x80084320 F0x800A2180
  // F0x800A2608) is ported and wired (effect-vm.ts / duel-effect-step.ts); and
  // the pending enters are real bodies over already-ported services
  // (duel-phase-enters.ts). The remaining frontier is the effect layer's own
  // named edges, not this tick-level list.
  assert.equal(DUEL_UNPORTED_ROUTINES.length, 0, "no tick-level named gaps remain");
  assert.equal(DUEL_PORTED_BOARD_ROUTINES.length, 9, "nine board/browse pieces ported");
  assert.equal(DUEL_PORTED_VIEW_WINDOW_ROUTINES.length, 2, "two view-window pieces ported");
  assert.equal(DUEL_PORTED_EFFECT_COMMIT_ROUTINES.length, 2, "two effect/commit pieces ported");
  assert.equal(DUEL_PORTED_COUNTER_ROUTINES.length, 4, "four counter/stat pieces ported");
  assert.equal(DUEL_PORTED_MODE_UPDATE_ROUTINES.length, 6, "six mode updates ported");
  for (const [address, role] of DUEL_UNPORTED_ROUTINES) {
    assert.ok(Number.isInteger(address) && address > 0, `address for ${role}`);
    assert.ok(typeof role === "string" && role.length > 0, "a role for every address");
  }
  const session = new DuelSession();
  session.buildScreenBoard();
  session.setupDuel();
  assert.equal(session.diagnostics().execution, "translated");
  assert.deepEqual(session.diagnostics().unported,
    DUEL_UNPORTED_ROUTINES.map(([address]) => `0x${address.toString(16)}`));
  // none of the ported pieces is still a named gap
  const unported = new Set(DUEL_UNPORTED_ROUTINES.map(([address]) => address));
  for (const address of [
    ...DUEL_PORTED_BOARD_ROUTINES,
    ...DUEL_PORTED_VIEW_WINDOW_ROUTINES,
    ...DUEL_PORTED_EFFECT_COMMIT_ROUTINES,
    ...DUEL_PORTED_COUNTER_ROUTINES,
    ...DUEL_PORTED_MODE_UPDATE_ROUTINES,
  ]) {
    assert.ok(!unported.has(address), `0x${address.toString(16)} is no longer a gap`);
  }
});

test("the ported board pieces run their real bodies through the view queue", () => {
  const session = new DuelSession();
  session.buildScreenBoard();
  session.setupDuel();
  const view = session.view();
  // drive the three plate/slot writers and the two browse passes through the
  // session's own view-queue host; these are the exact edges that used to throw.
  const host = session["viewQueueHost"]();
  host.scaleSlot(view, 2, 0xa, 0x1000, 0x1000);
  host.openPlate(view, 1, 0x37);
  host.closePlate(view, 1);
  host.primeAiPileBrowseCounts(session.duel(), 0, 0, 0);
  assert.equal(session.mem.read32(view + 2 * 0x4c + 0x130) | 0, 0xa, "scaleSlot wrote the span");
  assert.equal(session.mem.read16(view + 1 * 0xc + 0xdc0 + 0x8) & 0xffff, 3, "closePlate closed the plate");
  // startAiPileBrowse now runs its whole reveal walk through the four ported
  // view-method slots — no gap left: the in-range slots are placed and the
  // out-of-range ones hidden.
  host.startAiPileBrowse(session.duel(), session.ctx, 0, 0);
  assert.equal(session.mem.read8(view + 0 * 0x4c + 0x14a) & 0xff, 1, "the first in-range slot is placed");
  assert.equal(session.mem.read8(view + 0x27 * 0x4c + 0x14a) & 0xff, 0, "the last out-of-range slot is hidden");
});

test("the opponent's card choice runs over the composed session's duel object", () => {
  const session = new DuelSession({
    aiHost: {
      resolveCardRecord: () => 0,
      cardField: () => 0x70,               // legality-gate arm 0 -> always legal
      isSummonableCard: () => true,
      fieldProbe: () => 1,
      fieldProbeKind: () => 1,
    },
  });
  session.buildScreenBoard();
  session.setupDuel();
  const duel = session.duel();
  // A Load-phase hand of one class-1 card whose duel+0x50 entry is a card the
  // worth-it test waves through (>= 0x3C -> the F0x800A44F0 default arm).
  session.mem.write8(duel + 0x2f8, 5);
  session.mem.write16(duel + 0x66e, 1);
  session.mem.write16(duel + 0x6c8, 41);
  session.mem.write8(duel + ((41 - 0x28) << 2) + 0x35c, 1);
  session.mem.write16(duel + 0x50 + 41 * 2, 0x60);
  session.mem.write8(duel + 0x575, 0);
  for (let i = 0; i < 6; i++) session.mem.write8(duel + 0x446 + i, i < 1 ? 1 : 0);
  session.mem.write8(duel + 0x72c, 4);
  assert.equal(session.chooseOpponentCard(0), 1, "the AI picked a card");
  assert.equal(session.mem.read8(duel + 0x46f) & 0xff, 1, "the pick is marked at duel+index+0x46F");
  // ... and it names F0x800A4978 among the ported AI pieces.
  assert.ok(DUEL_PORTED_AI_ROUTINES.includes(0x800a4978), "the pick is a ported piece");
});
