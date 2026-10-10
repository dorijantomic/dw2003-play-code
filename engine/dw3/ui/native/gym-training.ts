// The gym's training session window, translated from the original pro/stgtrain objects:
// constructor F0x80088070, handler F0x80087F28, state machine F0x8008706C, per-rep stat
// dispatcher F0x800866CC, widget builder F0x80086B24 and picture draw F0x80086C0C.
//
// Oracle: tests/lane-b/gym-training.test.js runs each original through engine/native with the
// resident services, the object methods and the sound cells replaced by recording stubs; the
// port gets the same calls from a recording host. The draw test compares the recorded picture
// intents.
//
// What a player sees. After the partner and the drill are confirmed the window grows in and the
// trainee starts the workout. Each rep runs its animation (the rep actor, native/gym-rep-actor.ts)
// and then shows a ring (hit) or an X (miss) in the marker row while the plate above the window
// prints the stat that rep raised (or lowered) and by how much. Three reps are played; a
// perfect three for a basic drill starts the Ultra Training Chance rep straight away, a perfect
// three for a super drill offers "Challenge" (one more rep at a 50% chance) or "As is" (two more
// ordinary reps), and a super drill that did not sweep the first three plays two more reps. Then
// the trainee takes the closing pose, the summary message prints the total per stat, and the
// window folds away when the player confirms.
//
// Fields (window object, 0x134 bytes, children [0x1C]: 0 the stat text, 4 the second stat text,
// 8/0xC/0x10 the challenge texts, 0x14 the cursor, 0x18 the rep actor):
//   +0x10 step   +0x14 the rep being resolved   +0x18 the last rep index (2: three reps, 4: five)
//   +0x50 screen   +0x5C roster slot   +0x60 drill id (13 or more: super)   +0xA0 rank group
//   +0x64..+0x74 five rep results (1 hit, 0 miss, -1 not played)
//   +0x78..+0x88 five primary gains   +0x8C..+0x9C five secondary changes
//   +0xA4 the 0x2C-byte stats projection taken when the session opened
//   +0xD0 cursor on the Challenge / As-is choice   +0xD4 marker blink   +0xD8 Ultra rep taken
//   +0xDC/+0xE0 blink phase and stamp   +0xE4 show the continue arrow   +0xE8/+0xEC its frame and stamp
//   +0xF0 the looping sound's channel   +0xF4/+0x104/+0x114/+0x124 four window folds
import {
  gymRollCoreGain, gymRollCoreLoss, gymRollElementGain, gymRollHpMpGain, gymRepBonus,
  type GymRollHost, type GymRollMemory,
} from "./gym-rolls.ts";
import { gymRankMenuFind, type GymPackMemory } from "./gym-packs.ts";
import {
  GYM_PACK_CMFONT, GYM_PACK_STTRNG3,
  type GymDrawHost, type GymUiHost,
} from "./gym-host.ts";

export const GYM_TRAINING_HANDLER = 0x80087f28;
export const GYM_TRAINING_SIZE = 0x134;
export const GYM_TRAINING_EXTRA = 0x1c;

export interface GymTrainingMemory extends GymRollMemory, GymPackMemory {
  write8(addr: number, value: number): void;
  write16(addr: number, value: number): void;
}

/** Method calls on other objects: the rep actor, the screen, the session itself. */
export interface GymTrainingHost extends GymUiHost, GymRollHost {
  alloc(handler: number, size: number, extra: number): number;
  /** target+slot(args...): a method of the rep actor, the screen or this object. */
  call(target: number, slot: number, args: number[]): number;
  /** F0x8008A274(category, drill, layer, bucket): build the rep actor. */
  createRepActor(category: number, drill: number, layer: number, bucket: number): number;
}

const s16 = (v: number): number => (v << 16) >> 16;
export const TRAINING_SLOT = { setState0: 0x28, setState1: 0x2c, advance: 0x38 } as const;
/** The rep actor's method slots (native/gym-rep-actor.ts GYM_REP_METHODS). */
export const REP = { pageOrigin: 0xa4, clutOrigin: 0xa8, hitPercent: 0xac, growIn: 0xb0, resume: 0xb8, holdBoth: 0xbc,
  setScale: 0xc0, result: 0xc4, closingPose: 0xc8 } as const;
/** The screen's draw method slot (F0x80084370). */
export const SCREEN_DRAW = 0x110;

/** F0x80088070(screen, slot, drill): build the training session window. */
export function gymTrainingCreate(
  mem: GymTrainingMemory, host: Pick<GymTrainingHost, "alloc" | "rankGroup">,
  screen: number, slot: number, drill: number,
): number {
  const obj = host.alloc(GYM_TRAINING_HANDLER, GYM_TRAINING_SIZE, GYM_TRAINING_EXTRA);
  mem.write32(obj + 0x54, 0x1000);
  mem.write32(obj + 0x58, 6);
  mem.write32(obj + 0x50, screen >>> 0);
  mem.write32(obj + 0x5c, slot >>> 0);
  mem.write32(obj + 0x60, drill >>> 0);
  mem.write32(obj + 0xa0, host.rankGroup() >>> 0);
  return obj;
}

/** F0x80086B24(self, children): the stat plates' text widgets and the challenge cursor. */
export function gymTrainingWidgets(mem: GymTrainingMemory, self: number, children: number, host: GymUiHost): void {
  const target = mem.read32(self + 0x54);
  const first = host.createText(target, 1, 0x74, 0xc0);
  mem.write32(children, first >>> 0);
  host.textFlag(first, 2);
  mem.write32(children + 4, host.createText(target, 1, 0x74, 0xce) >>> 0);
  mem.write32(children + 8, host.createText(0x1002, 1, 0xa2, 0x75) >>> 0);
  mem.write32(children + 0xc, host.createText(0x1002, 1, 0xa2, 0x91) >>> 0);
  mem.write32(children + 0x10, host.createText(0x1002, 1, 0xa2, 0xa1) >>> 0);
  const cursor = host.createCursor(0x1002, (mem.read32(self + 0x58) - 1) | 0, 0x94, 0x91);
  mem.write32(children + 0x14, cursor >>> 0);
  host.cursorShow(cursor, 0);
}

/** F0x800866CC(self, rep): roll the rep's stat change (hits only) and print it on the plates. */
export function gymTrainingRoll(mem: GymTrainingMemory, self: number, rep: number, host: GymTrainingHost): void {
  const children = mem.read32(self + 0x24) >>> 0;
  const entry = gymRankMenuFind(mem, mem.read32(self + 0xa0), mem.read32(self + 0x60));
  const at = self + rep * 4;
  const w0 = mem.read32(children) >>> 0;
  const w1 = mem.read32(children + 4) >>> 0;
  const source = (): number => host.textSource();
  const hide1 = (): void => host.textShow(w1, 0);
  if ((mem.read32(at + 0x64) | 0) === 0) {
    host.textSet(w0, source(), 0x46);
    host.textColour(w0, 0);
    hide1();
    return;
  }
  const primary = s16(mem.read16(entry + 4));
  if (primary !== 0) {
    if (((mem.read16(entry + 4) - 1) >>> 0) < 5) {
      mem.write32(at + 0x78, gymRollCoreGain(mem, self, primary, host) >>> 0);
    } else {
      mem.write32(at + 0x78, gymRollElementGain(mem, self, primary, host) >>> 0);
      const secondary = s16(mem.read16(entry + 6));
      if (secondary !== 0) {
        if (((mem.read16(entry + 6) - 1) >>> 0) < 5) mem.write32(at + 0x8c, gymRollCoreLoss(mem, self, secondary, host) >>> 0);
        else mem.write32(at + 0x8c, gymRollHpMpGain(mem, self, secondary, host) >>> 0);
      }
    }
  }
  if ((mem.read32(at + 0x64) | 0) === 0) {
    host.textSet(w0, source(), 0x46);
    host.textColour(w0, 0);
    hide1();
    return;
  }
  const primaryId = mem.read16(entry + 4);
  if (((primaryId - 1) >>> 0) < 5) {
    host.textSet(w0, source(), 0x5c);
    host.textFormat(w0, source(), (s16(primaryId) + 0x46) | 0, 1);
    host.textNumber(w0, 2, mem.read32(at + 0x78));
    host.textColour(w0, 1);
    hide1();
    return;
  }
  host.textSet(w0, source(), 0x5c);
  host.textFormat(w0, source(), (s16(primaryId) + 0x4d) | 0, 1);
  host.textNumber(w0, 2, mem.read32(at + 0x78));
  host.textColour(w0, 1);
  const secondary = s16(mem.read16(entry + 6));
  if (secondary === 0) return;
  const secondaryId = mem.read16(entry + 6);
  if (((secondaryId - 1) >>> 0) < 5) {
    if (mem.read32(at + 0x8c) === 0) { hide1(); return; }
    host.textSet(w1, source(), 0x5d);
    host.textFormat(w1, source(), (s16(secondaryId) + 0x46) | 0, 1);
    host.textNumber(w1, 2, mem.read32(at + 0x8c));
    host.textColour(w1, 5);
    return;
  }
  host.textSet(w1, source(), 0x5c);
  host.textFormat(w1, source(), (s16(secondaryId) + 0x44) | 0, 1);
  host.textNumber(w1, 2, mem.read32(at + 0x8c));
  host.textColour(w1, 1);
}

const REP_SOUND = 0x840000;
const LOOP_SOUND = 0xa084603c >>> 0;
const SFX_OK = 0x4001c;
const SFX_MOVE = 0x8004513e;
const SFX_SELECT = 0x8004503c;
const SFX_CANCEL = 0x800450bd;

/** F0x8008706C(self, children): the session's step machine. */
export function gymTrainingMachine(mem: GymTrainingMemory, self: number, children: number, host: GymTrainingHost): void {
  const child = (i: number): number => mem.read32(children + i * 4) >>> 0;
  const actor = child(6);
  const step = mem.read32(self + 0x10) >>> 0;
  const bump = (): void => mem.write32(self + 0x10, (mem.read32(self + 0x10) + 1) >>> 0);
  const isPressed = (logical: number): boolean => { const w = host.padPressed(); return ((w >> host.padBit(logical)) & 1) !== 0; };
  const isRepeated = (logical: number): boolean => { const w = host.padRepeat(); return ((w >> host.padBit(logical)) & 1) !== 0; };
  const source = (): number => host.textSource();
  const screen = (): number => mem.read32(self + 0x50) >>> 0;

  const stepIs = step < 0x33 ? step : -1;
  switch (stepIs) {
    case 1: return stepOne();
    case 2: return stepTwo();
    case 3: host.call(actor, REP.closingPose, []); bump(); return;
    case 4:
      if ((mem.read32(actor + 0x50) & 1) !== 0) {
        mem.write32(self + 0xe4, 1);
        bump();
      }
      return;
    case 5: return stepFive();
    case 6: return stepSix();
    case 10:
      if ((mem.read32(self + 0x60) | 0) < 0xd) {
        mem.write32(self + 0x10, 0x14);
        mem.write32(self + 0xd4, 1);
        host.call(actor, REP.resume, []);
        mem.write16(self + 0xf0, host.playSound(LOOP_SOUND));
        return;
      }
      bump();
      return;
    case 11: host.foldStart(self + 0x114, 1); bump(); return;
    case 12:
      if (host.foldTick(self + 0x114) !== 0) {
        host.textSet(child(2), source(), 0x11);
        host.foldStart(self + 0x124, 1);
        bump();
      }
      return;
    case 13:
      if (host.foldTick(self + 0x124) !== 0) {
        host.textSet(child(3), source(), 0xc);
        host.textSet(child(4), source(), 0xd);
        host.cursorPlace(child(5), 0x94, ((mem.read32(self + 0xd0) << 4) + 0x91) | 0);
        host.cursorShow(child(5), 1);
        bump();
      }
      return;
    case 14: return stepFourteen();
    case 15:
      host.foldStart(self + 0x114, 0);
      host.foldStart(self + 0x124, 0);
      host.textShow(child(2), 0);
      host.textShow(child(3), 0);
      host.textShow(child(4), 0);
      host.cursorShow(child(5), 0);
      bump();
      return;
    case 16:
      host.foldTick(self + 0x114);
      if (host.foldTick(self + 0x124) !== 0) {
        if ((mem.read32(self + 0x18) | 0) === 0) {
          mem.write32(self + 0x10, 0x14);
          mem.write32(self + 0xd4, 1);
          host.call(actor, REP.resume, []);
          mem.write16(self + 0xf0, host.playSound(LOOP_SOUND));
          const block = host.recordBlock(mem.read32(self + 0x5c)) >>> 0;
          const last = mem.read8(block + 0x3cc);
          if (last !== 0 && last === (mem.read32(self + 0x60) | 0)) {
            host.call(actor, REP.hitPercent, [0]);
            return;
          }
          mem.write8(block + 0x3cc, 0);
          host.call(actor, REP.hitPercent, [0x32]);
          return;
        }
        host.call(actor, REP.resume, []);
        mem.write32(self + 0x10, 2);
      }
      return;
    case 20: return stepTwenty();
    case 50: mem.write32(self + 0x0c, 3); return;
    default:
      host.foldStart(self + 0xf4, 1);
      host.foldStart(self + 0x104, 1);
      host.call(actor, REP.growIn, []);
      bump();
  }

  function stepOne(): void {
    host.foldTick(self + 0x104);
    if (host.foldTick(self + 0xf4) !== 0 && (mem.read32(actor + 0x50) & 1) !== 0) {
      mem.write32(self + 0x18, 2);
      bump();
      host.call(actor, REP.resume, []);
      host.call(actor, REP.hitPercent, [(gymRepBonus(mem, self, host) + 0x4b) | 0]);
    }
  }

  function stepTwo(): void {
    const idx = mem.read32(self + 0x14) | 0;
    const result = host.call(actor, REP.result, []) | 0;
    mem.write32(self + idx * 4 + 0x64, result >>> 0);
    const stored = mem.read32(self + (mem.read32(self + 0x14) | 0) * 4 + 0x64) | 0;
    if (stored === -1) return;
    host.playSound(stored !== 0 ? REP_SOUND | 1 : REP_SOUND);
    gymTrainingRoll(mem, self, mem.read32(self + 0x14) | 0, host);
    const next = ((mem.read32(self + 0x14) | 0) + 1) | 0;
    const last = mem.read32(self + 0x18) | 0;
    mem.write32(self + 0x14, next >>> 0);
    if (!(last < next)) {
      host.call(actor, REP.resume, []);
      return;
    }
    if (last === 2) {
      if (mem.read32(self + 0x64) !== 0 && mem.read32(self + 0x68) !== 0 && mem.read32(self + 0x6c) !== 0) {
        mem.write32(self + 0x10, 0xa);
        return;
      }
      if (!((mem.read32(self + 0x60) | 0) < 0xd)) {
        mem.write32(self + 0x18, 4);
        host.call(actor, REP.resume, []);
        return;
      }
    }
    host.call(self, TRAINING_SLOT.setState1, [3]);
  }

  function stepFive(): void {
    const pressed = host.padPressed();
    if (((pressed >> host.padBit(0xd)) & 1) === 0) return;
    host.playSound(SFX_OK);
    mem.write32(self + 0xe4, 0);
    const entry = gymRankMenuFind(mem, mem.read32(self + 0xa0), mem.read32(self + 0x60));
    let primarySum = 0;
    let secondarySum = 0;
    if (s16(mem.read16(entry + 4)) !== 0) {
      for (let k = 0; k < 5; k++) primarySum = (primarySum + (mem.read32(self + 0x78 + k * 4) | 0)) | 0;
      if (((mem.read16(entry + 4) - 8) >>> 0) < 7) {
        if (s16(mem.read16(entry + 6)) !== 0) {
          for (let k = 0; k < 5; k++) secondarySum = (secondarySum + (mem.read32(self + 0x8c + k * 4) | 0)) | 0;
        }
      }
    }
    const w0 = child(0);
    const w1 = child(1);
    if (primarySum === 0 && secondarySum === 0) {
      host.textSet(w0, source(), 0x71);
    } else {
      let shownPrimary = primarySum;
      let shownSecondary = secondarySum;
      const primary = mem.read16(entry + 4);
      const snap = (off: number): number => s16(mem.read16(self + 0xa4 + off)) | 0;
      if (primarySum !== 0) {
        if (((primary - 1) >>> 0) < 5) {
          const base = snap(0xa + primary * 2);
          shownPrimary = base + primarySum < 0x3e8 ? primarySum : 0x3e7 - base;
        } else {
          const base = s16(mem.read16(self + 0xa4 + 8 + (s16(primary) << 1)));
          shownPrimary = base + primarySum < 0x3e8 ? primarySum : 0x3e7 - base;
        }
      }
      if (secondarySum !== 0) {
        const secondary = mem.read16(entry + 6);
        if (((secondary - 1) >>> 0) < 5) {
          const base = s16(mem.read16(self + 0xae + (s16(secondary) << 1)));
          shownSecondary = base - secondarySum < 0 ? base : secondarySum;
        } else if (((secondary - 8) & 0xffff) < 7) {
          const base = s16(mem.read16(self + 0xac + (s16(secondary) << 1)));
          shownSecondary = base + secondarySum >= 0x3e8 ? 0x3e7 - base : secondarySum;
        } else if (s16(secondary) === 0xf) {
          const base = s16(mem.read16(self + 0xaa));
          shownSecondary = base + secondarySum < 0x2710 ? secondarySum : 0x270f - base;
        } else if (s16(secondary) === 0x10) {
          const base = s16(mem.read16(self + 0xae));
          shownSecondary = base + secondarySum >= 0x2710 ? 0x270f - base : secondarySum;
        }
      }
      if (((primary - 1) >>> 0) < 5) {
        host.textSet(w0, source(), (s16(primary) + 0x5d) | 0);
        host.textNumber(w0, 1, shownPrimary);
      } else if (secondarySum !== 0) {
        host.textSet(w0, source(), (s16(primary) + 0x62) | 0);
        host.textNumber(w0, 1, shownPrimary);
        host.textNumber(w0, 2, shownSecondary);
      } else {
        host.textSet(w0, source(), (s16(primary) + 0x5b) | 0);
        host.textNumber(w0, 1, shownPrimary);
      }
    }
    host.textColour(w0, 0);
    host.textScroll(w0, 6);
    host.textShow(w1, 0);
    bump();
    host.call(screen(), SCREEN_DRAW, [(self + 0xa4) >>> 0]);
  }

  function stepSix(): void {
    const w0 = child(0);
    if (host.textDone(w0) !== 0) {
      host.playSound(SFX_OK);
      mem.write32(self + 0x10, 0x32);
      mem.write32(self + 0xe4, 0);
      host.call(screen(), SCREEN_DRAW, [0]);
      return;
    }
    if (host.textWaiting(w0) !== 0) {
      mem.write32(self + 0xe4, 1);
      if (isPressed(0xd)) {
        host.playSound(SFX_OK);
        mem.write32(self + 0xe4, 0);
      }
      return;
    }
    mem.write32(self + 0xe4, 0);
    if (isPressed(0xd)) host.textRescan(w0);
  }

  function stepFourteen(): void {
    const before = mem.read32(self + 0xd0) | 0;
    if (isPressed(4) || isRepeated(4)) mem.write32(self + 0xd0, 0);
    else if (isPressed(6) || isRepeated(6)) mem.write32(self + 0xd0, 1);
    if (before !== (mem.read32(self + 0xd0) | 0)) {
      host.playSound(SFX_MOVE);
      host.cursorPlace(child(5), 0x94, ((mem.read32(self + 0xd0) << 4) + 0x91) | 0);
      return;
    }
    if (isPressed(0xd)) {
      host.playSound(SFX_SELECT);
      mem.write32(self + 0x18, (mem.read32(self + 0xd0) | 0) === 0 ? 0 : 4);
      bump();
      return;
    }
    if (isPressed(0xe)) {
      host.playSound(SFX_CANCEL);
      mem.write32(self + 0x18, 4);
      bump();
    }
  }

  function stepTwenty(): void {
    const result = host.call(actor, REP.result, []) | 0;
    mem.write32(self + 0x70, result >>> 0);
    if (result === -1) return;
    const block = host.recordBlock(mem.read32(self + 0x5c)) >>> 0;
    if ((mem.read32(self + 0x70) | 0) !== 0) {
      mem.write8(block + 0x3cc, mem.read8(self + 0x60));
      mem.write32(self + 0xd8, 1);
    } else {
      mem.write8(block + 0x3cc, 0);
    }
    host.playSound((mem.read32(self + 0x70) | 0) !== 0 ? REP_SOUND | 1 : REP_SOUND);
    host.stopSound(LOOP_SOUND, s16(mem.read16(self + 0xf0)));
    gymTrainingRoll(mem, self, 3, host);
    mem.write32(self + 0xe4, 1);
    mem.write32(self + 0xd4, 0);
    host.call(self, TRAINING_SLOT.setState1, [3]);
  }
}

/** F0x80087F28(self, children): the window's tick. */
export function gymTrainingTick(mem: GymTrainingMemory, self: number, children: number, host: GymTrainingHost & GymDrawHost): void {
  const state = mem.read32(self + 0x0c) | 0;
  if (state === 1) {
    gymTrainingMachine(mem, self, children, host);
    gymTrainingDraw(mem, self, host);
    return;
  }
  if (state >= 2 && state < 4) return;
  host.call(self, TRAINING_SLOT.advance, []);
  gymTrainingWidgets(mem, self, children, host);
  mem.write32(self + 0xf4, 0xa);
  mem.write32(self + 0x104, 0xa);
  mem.write32(self + 0x114, 0xa);
  mem.write32(self + 0x124, 0xa);
  for (let k = 0; k < 5; k++) mem.write32(self + 0x64 + k * 4, 0xffffffff);
  const actor = host.createRepActor(mem.read32(self + 0x5c), mem.read32(self + 0x60), mem.read32(self + 0x54),
    (mem.read32(self + 0x58) - 3) | 0) >>> 0;
  mem.write32(children + 0x18, actor);
  host.call(actor, REP.pageOrigin, [0x300, 0]);
  host.call(actor, REP.clutOrigin, [0x2c0, 0]);
  host.call(actor, REP.holdBoth, []);
  host.call(actor, REP.setScale, [0]);
  host.copyProjection(mem.read32(self + 0x5c), (self + 0xa4) >>> 0);
}

/** F0x80086C0C(self): the marker row, the viewport frame and the plate panels. */
export function gymTrainingDraw(mem: GymTrainingMemory, self: number, host: GymDrawHost): void {
  if (mem.read32(self + 0xe4) !== 0) {
    host.initDrawContext();
    host.setLayer(0x1002, 3);
    host.setOrigin(0x140, 0);
    if (((host.frameTick() - mem.read32(self + 0xec)) | 0) >= 4) {
      mem.write32(self + 0xec, host.frameTick() >>> 0);
      const frame = (mem.read32(self + 0xe8) + 1) | 0;
      mem.write32(self + 0xe8, frame >>> 0);
      if (frame >= 5) mem.write32(self + 0xe8, 0);
    }
    host.paletteShift(mem.read32(self + 0xe8));
    host.drawSprite(host.packResolve(GYM_PACK_CMFONT), 0xa, 0x124, 0xcd);
  }
  host.initDrawContext();
  host.setOrigin(0x240, 0x100);
  host.setLayer(mem.read32(self + 0x54), mem.read32(self + 0x58));
  if (mem.read32(self + 0xd4) !== 0) {
    if (((host.frameTick() - mem.read32(self + 0xe0)) | 0) >= 3) {
      mem.write32(self + 0xe0, host.frameTick() >>> 0);
      mem.write32(self + 0xdc, (1 - mem.read32(self + 0xdc)) >>> 0);
    }
    host.paletteShift((mem.read32(self + 0xdc) + 1) | 0);
  }
  for (let i = 0, x = 0x80; i < 5; i++, x += 0x11) {
    if (mem.read32(self + 0xd8) !== 0 && i === 3) host.paletteShift(3);
    const result = mem.read32(self + 0x64 + i * 4) | 0;
    if (result === 1) host.drawSprite(host.packResolve(GYM_PACK_STTRNG3), 0x45, x, 0x58);
    else if (result === 0) host.drawSprite(host.packResolve(GYM_PACK_STTRNG3), 0x46, x, 0x58);
  }
  host.paletteShift(0);
  const panel = (fold: number, sx: number, sy: number, px: number, py: number, clip: number, x: number, y: number): void => {
    const value = mem.read32(self + fold) | 0;
    if (value === 0) return;
    if (value !== 0x1000) {
      host.setScale(value, sx === 0 ? value : sx, 0x1000);
      host.setPos(px, py);
    }
    host.drawSprite(host.packResolve(GYM_PACK_STTRNG3), clip, x, y);
  };
  // +0xFC: the viewport frame, scaled both ways about (0xCF, 0x7F).
  panel(0xfc, 0, 0, 0xcf, 0x7f, 0x28, 0x72, 0x4b);
  // +0x10C: the lower panel.
  {
    const value = mem.read32(self + 0x10c) | 0;
    if (value !== 0) {
      if (value !== 0x1000) { host.setScale(value, 0x1000, 0x1000); host.setPos(0x140, 0xcd); }
      host.drawSprite(host.packResolve(GYM_PACK_STTRNG3), 0x23, 0x46, 0xba);
    }
  }
  host.setLayer(0x1002, mem.read32(self + 0x58));
  for (const [fold, py, clip, x, y] of [[0x11c, 0x7b, 0x26, 0x85, 0x70], [0x12c, 0x9f, 0x1d, 0x82, 0x8b]] as const) {
    const value = mem.read32(self + fold) | 0;
    if (value === 0) continue;
    if (value !== 0x1000) { host.setScale(value, 0x1000, 0x1000); host.setPos(0x140, py); }
    host.drawSprite(host.packResolve(GYM_PACK_STTRNG3), clip, x, y);
  }
}
