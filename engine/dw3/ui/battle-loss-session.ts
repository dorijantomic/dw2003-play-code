// The battle loss, as one session: the defeat effect, the fade and the exit that
// asks for the title screen, composed from the ports in
// engine/dw3/ui/native/battle-loss.ts on top of the existing translations.
//
// What the player sees: "Annihilated..." goes up in the battle's own message panel
// (the ported BattleMessageSession, opened on the original's arm 1 with the payload
// word esmfight[0x53]); the camera cuts to the original's close shot of your
// Digimon and turns slowly while its animation drops to quarter speed (both the
// renderer's, reached through the two callbacks below); the screen then darkens one
// tenth of a second at a time, holds black, and the title screen opens on top of the
// black without the page restarting.
//
// The frame order is the resident stepper's: the controller's own mode step first,
// then the two objects its block names in slot order. See the header of
// engine/dw3/ui/native/battle-loss.ts for why, and for the two edges the port
// records without building (the camera/motion block and the workspace write-back).
//
// Decode: docs/research/battle/battle-loss-decoded-2026-10-02.md, re-read for this
// port. Oracle: tests/lane-b/battle-loss.test.js.

import { NativeMemory } from "../../native/memory.ts";
import { frameDelta } from "../../systems/frame-clock.ts";
import { DISPLAY_SERVICE, DISPLAY_SERVICE_FIELDS } from "../display-service.ts";
import { setState1 } from "./task-object.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import {
  LOSS_EFFECT_CHILD_TICK, LOSS_EFFECT_EXTRA, LOSS_EFFECT_SIZE, LOSS_EFFECT_TICK,
  LOSS_FADE_TICKS, LOSS_FADE_TICK, LOSS_GAMEOVER_SOUND, LOSS_LAUNCH_TITLE,
  LOSS_MESSAGE_ID, LOSS_MESSAGE_KIND, LOSS_MODE, LOSS_NO_LAUNCH, LOSS_RESULT_BYTE,
  LOSS_SLOT_EFFECT, LOSS_SLOT_FADE, LOSS_STATE,
  lossBranch, lossClearViewColour, lossEffectTick, lossExitTick, lossFadeCreate,
  lossFadeGrey, lossFadeLevel, lossFadeTick, type BattleLossExit, type BattleLossHost,
} from "./native/battle-loss.ts";

/**
 * The controller's child-pointer block. The loss branch stores the defeat effect at
 * +0x18 and the message window at +0x1C (pro/wfightmn.s .L0x00003494 and the three
 * `sw $v0, 0x1c($s3)` sites), and the exit reads +0x18 and overwrites +0x1C with
 * the fade. Two slots are decoded; the block's own size is not, so the session
 * gives it the eight slots the two offsets need and nothing more.
 */
const LOSS_BLOCK_SLOTS = 8;
const LOSS_BLOCK_SIZE = LOSS_BLOCK_SLOTS * 4;

/**
 * The screen object the exit's mode word belongs to (the battle controller), and
 * the controller's child-pointer block beside it. Both sit above the task tree's
 * own range (0x80100000..0x801E0000) so an allocation can never land on them.
 */
const LOSS_SCREEN = 0x801f0000;
const LOSS_BLOCK = 0x801f0100;
/**
 * The battle's message window, F0x8009A298's object. The loss branch builds it before it
 * chooses an outcome (pro/wfightmn.s .L0x00003434) and stores it at block+0x1C, which the
 * exit later overwrites with the fade, so the panel object the branch opens the line on is
 * separate from the block slot.
 */
const LOSS_MESSAGE_WINDOW = 0x801f0200;

export interface BattleLossHostPorts {
  /** [0x80055C48](id): the packed-sound player. */
  playSound(id: number): void;
  /**
   * The effect's entry arm: the camera preset 0xb, the motion 0x17 and the class-0x14
   * object (F0x8008C93C .L0x8008C988-.L0x8008CA44). The 3-D renderer owns that
   * picture; this session only says when it happens. It answers the camera object,
   * which the effect keeps at its +0x50 and reads back every frame of the orbit. The
   * walker's renderer is not an object in this memory, so it answers 0 and the beat
   * runs exactly as it does with a real one — nothing else reads that word.
   */
  armDefeatEffect(): number;
  /** The orbit: two of 4096 per delta, then the camera's +0xF8 re-apply. */
  turnDefeatCamera(delta: number): void;
  /** [0x800A4548](level): F0x8009E510, the slow-motion level. */
  slowMotion(level: number): void;
  /** The defeat effect's child object (F0x8008C910) takes its own turn. */
  defeatChildTick?(obj: number, children: number): void;
}

export interface BattleLossCallbacks {
  /** [0x8004B440](code, arg): the resident screen launcher. */
  onLaunch?: (code: number, arg: number) => void;
}

/** Live state, for the tests, the lab and the verifier. */
export interface BattleLossState {
  /** The exit's mode word: 0 waits for phase 2, 1 waits for the ramp, 2 launches. */
  mode: number;
  /** The defeat effect's own state word (0..3). */
  effectState: number;
  /** The delta units the effect has counted; phase 2 begins at 0xF0. */
  effectUnits: number;
  /** The fade's own state word, or null before the exit builds it. */
  fadeState: number | null;
  /** The fade's level, 0 .. 0xFF00, or null. */
  fadeLevel: number | null;
  /** The grey the fade's quad is drawn with, the level's high byte. */
  fadeGrey: number | null;
  /** How many steps the whole sequence has run. */
  frames: number;
}

export class BattleLossSession {
  readonly mem = new NativeMemory();
  private readonly tree: TranslatedTaskTree;
  private readonly host: BattleLossHost;
  private readonly callbacks: BattleLossCallbacks;
  /** The screen object: its state words are the exit's mode and the message id. */
  private readonly screen = LOSS_SCREEN;
  /** The controller's child-pointer block. */
  private readonly block = LOSS_BLOCK;
  /**
   * The message window `F0x8009A298` built, standing for the battle's own panel. The
   * original stores it at block+0x1C and the exit overwrites that slot with the fade,
   * so the object itself is only ever named by the branch's `window->+0xAC` call.
   */
  private readonly messageWindow = LOSS_MESSAGE_WINDOW;
  private effect = 0;
  private fade = 0;
  private frames = 0;
  private begun = false;
  private done = false;
  /** The launch code the mode-2 arm asked for, 0 while it has not. */
  private launched = LOSS_NO_LAUNCH;
  /**
   * Every `window->+0xAC` the branch made, as [arm, payload address]: the panel call
   * the walker hands to the already-ported BattleMessageSession.
   */
  readonly messages: Array<[number, number]> = [];

  constructor(ports: BattleLossHostPorts, callbacks: BattleLossCallbacks = {}) {
    this.callbacks = callbacks;
    this.host = {
      // F0x80014504 loads `$a3` with zero in its own `jal` delay slot, so the
      // scheduler key is 0 for all three objects and the tree holds them as the
      // block's children instead.
      createTask: (classId, size, extra) => this.tree.allocate(classId, size, extra),
      baseMethod28: (obj, state) => this.tree.callMethod(obj, 0x28, [state]),
      // `[screen+0x2C](screen, 2)` is F0x80014288 on the screen's own table, and the
      // screen is the battle controller — not one of this tree's tasks — so the state
      // goes through the same translated setState1 the tree uses, written back here.
      baseMethod2C: (obj, state) => {
        const t = {
          state0: this.mem.read32(obj), state1: this.mem.read32(obj + 0x10),
          state2: this.mem.read32(obj + 0x14), state3: this.mem.read32(obj + 0x18),
        };
        setState1(t, state | 0);
        this.mem.write32(obj + 0x10, t.state1);
        this.mem.write32(obj + 0x14, t.state2);
        this.mem.write32(obj + 0x18, t.state3);
      },
      baseMethod38: (obj) => this.tree.callMethod(obj, 0x38),
      // The battle's own message panel is already the ported one
      // (engine/dw3/ui/battle-message-session.ts); the original's window->+0xAC is the
      // call that opens a line on it, and the panel's own arm and payload are what the
      // port hands over.
      openMessageWindow: (_window, kind, payload) => this.messages.push([kind | 0, payload >>> 0]),
      frameDelta,
      playSound: (id) => ports.playSound(id >>> 0),
      armDefeatEffect: () => ports.armDefeatEffect() >>> 0,
      turnDefeatCamera: (delta) => ports.turnDefeatCamera(delta | 0),
      slowMotion: (level) => ports.slowMotion(level | 0),
      defeatChildTick: (obj, children) => ports.defeatChildTick?.(obj, children),
      // The reward-selection block, the three-group write loop and the write-back
      // write the battle workspace, which the walker does not keep. Their timing is
      // what the player can see (a loss pays nothing and saves nothing), and that is
      // all this records.
      selectReward: () => {},
      writeOutcomeRecords: () => {},
      clearViewColour: (mem) => lossClearViewColour(mem),
      writeBack: () => {},
      launchScreen: (code, arg) => { this.launched = code | 0; callbacks.onLaunch?.(code | 0, arg | 0); },
      returnToField: () => {},
    };
    const classes = new Map<number, TranslatedTaskClass>();
    classes.set(LOSS_EFFECT_TICK, {
      name: "defeat effect",
      childSlots: [0],
      // F0x80018140 runs the step and only then retires a state-3 object
      // (exe/fns.s:8877-8884, 8919-8924), and the effect's phase-3 arm is the slow
      // motion going back to normal — so phase 3 has to be seen once, not skipped.
      terminalTick: true,
      tick: (obj, children) => lossEffectTick(this.mem, this.host, obj, children),
    });
    classes.set(LOSS_EFFECT_CHILD_TICK, {
      // F0x8008C590 is the child effect's own step and is not decoded; the object
      // exists because the original builds one, and its turn is the renderer's.
      name: "defeat effect child",
      childSlots: [],
      tick: (obj, children) => ports.defeatChildTick?.(obj, children),
    });
    classes.set(LOSS_FADE_TICK, {
      name: "battle fade",
      childSlots: [],
      tick: (obj) => lossFadeTick(this.mem, obj),
    });
    this.tree = new TranslatedTaskTree(this.mem, classes);
  }

  /**
   * The loss branch. F0x8008CB44 is `F0x80014504(F0x8008C93C, 0x54, 4)`, so the branch
   * allocates the effect through the tree; the message window was built before the branch
   * chose an outcome and only arrives here to be opened.
   */
  begin(): void {
    if (this.begun) return;
    this.begun = true;
    this.done = false;
    this.launched = LOSS_NO_LAUNCH;
    this.frames = 0;
    this.effect = 0;
    this.fade = 0;
    this.messages.length = 0;
    const from = LOSS_SCREEN & 0x1fffff;
    this.mem.bytes.fill(0, from, (LOSS_MESSAGE_WINDOW + 4) & 0x1fffff);
    // The display service's slot 0 registers the view the exit's mode-1 arm turns
    // the colour off on. The walker has no such view, so there is none and the arm
    // skips the store; the test registers one to compare the real call.
    for (let i = 0; i < 8; i++) {
      this.mem.write32(DISPLAY_SERVICE + i * 4 + DISPLAY_SERVICE_FIELDS.viewBase, 0);
      this.mem.write32(DISPLAY_SERVICE + i * 4 + DISPLAY_SERVICE_FIELDS.viewHandle, 0);
    }
    lossBranch(this.mem, this.host, this.screen, this.block, this.messageWindow);
    // The branch left the effect in the block's +0x18 slot (`sw $v0, 0x18($s3)` in the
    // `j`'s delay slot), which is where the exit reads it and where the stepper's child
    // walk empties it again once the object is retired.
    this.effect = this.effectSlot;
  }

  /** One battle step: the exit, then the effect, then the fade. */
  tick(): void {
    if (!this.begun || this.done) return;
    const exit: BattleLossExit = {
      block: this.block,
      mode: this.screen + LOSS_MODE,
      createFade: () => {
        this.fade = lossFadeCreate(this.mem, this.host);
        return this.fade;
      },
    };
    this.launched = lossExitTick(this.mem, this.host, exit);
    if (this.effect !== 0) {
      this.tree.tick(this.effect);
      // The resident stepper retires an object whose state reads 3 at the top of its
      // turn (F0x80018140) and the child walk writes the return value back over the
      // slot (F0x80018230), so the slot empties on the frame the effect dies. The
      // controller's +0x18 is that slot, and the exit reads it on the next turn.
      if (!this.tree.tasks.has(this.effect)) {
        this.mem.write32(this.block + LOSS_SLOT_EFFECT, 0);
        this.effect = 0;
      }
    }
    if (this.fade !== 0) this.tree.tick(this.fade);
    this.frames++;
    if (this.launched !== LOSS_NO_LAUNCH) this.done = true;
  }

  /** The exit has asked for a screen: the battle is over. */
  finished(): boolean { return this.done; }

  /** The screen the exit asked for, or 0. 0xE00 is the title. */
  launchCode(): number { return this.launched; }

  /** How black the screen is, 0 .. 0xFF00, or 0 before the fade exists. */
  fadeLevel(): number {
    return this.fade === 0 ? 0 : lossFadeLevel(this.mem, this.fade);
  }

  /** The grey the fade's quad is drawn with: the level's high byte (F0x8008a96c). */
  fadeGrey(): number {
    return this.fade === 0 ? 0 : lossFadeGrey(this.mem, this.fade);
  }

  /** The message the loss branch put up, in the ported panel's own terms. */
  get messageId(): number { return LOSS_MESSAGE_ID; }
  /** The window VM's arm for it: one line, the caller's index, no name. */
  get messageKind(): number { return LOSS_MESSAGE_KIND; }
  /** The jingle the loss branch plays through [0x80055C48]. */
  get jingle(): number { return LOSS_GAMEOVER_SOUND; }
  /** The fade's own tick count the exit armed it with. */
  get fadeTicks(): number { return LOSS_FADE_TICKS; }
  /** The title code the mode-2 arm asks for on a loss. */
  get titleCode(): number { return LOSS_LAUNCH_TITLE; }
  /** The result byte the branch set. */
  get result(): number { return this.mem.read8(LOSS_RESULT_BYTE); }

  /** The live state, for the tests and the verifier. */
  state(): BattleLossState {
    return {
      mode: this.mem.read32(this.screen + LOSS_MODE) | 0,
      effectState: this.effect === 0 ? -1 : this.mem.read32(this.effect + LOSS_STATE) | 0,
      effectUnits: this.effect === 0 ? -1 : this.mem.read32(this.effect + 0x10) | 0,
      fadeState: this.fade === 0 ? null : this.mem.read32(this.fade + LOSS_STATE) | 0,
      fadeLevel: this.fade === 0 ? null : lossFadeLevel(this.mem, this.fade),
      fadeGrey: this.fade === 0 ? null : lossFadeGrey(this.mem, this.fade),
      frames: this.frames,
    };
  }

  /** The defeat effect's object, for a caller that renders it. */
  get effectObject(): number { return this.effect; }
  /** The fade's object, 0 before the exit builds it. */
  get fadeObject(): number { return this.fade; }
  /** The controller block's +0x18 slot. */
  get effectSlot(): number { return this.mem.read32(this.block + LOSS_SLOT_EFFECT) >>> 0; }
  /** The controller block's +0x1C slot: the message window, then the fade. */
  get fadeSlot(): number { return this.mem.read32(this.block + LOSS_SLOT_FADE) >>> 0; }

  /** Drop everything; the battle is over. */
  dispose(): void {
    if (this.effect !== 0 && this.tree.tasks.has(this.effect)) this.tree.dispose(this.effect);
    if (this.fade !== 0 && this.tree.tasks.has(this.fade)) this.tree.dispose(this.fade);
    this.effect = 0;
    this.fade = 0;
    this.begun = false;
  }
}