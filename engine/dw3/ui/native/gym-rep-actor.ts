// The gym's rep actor, translated from the original pro/stgtrain F0x800897B8 (handler) with its
// constructor F0x8008A274 and the methods F0x8008A0F4..F0x8008A264.
//
// Oracle: tests/lane-b/gym-rep-actor.test.js runs the originals through engine/native with the
// pack services, the two sprite actors' methods and the random service stubbed, and compares
// the ordered calls and every field.
//
// What it is. The training session (native/gym-session-machine.ts, F0x8008706C) owns one of
// these. It is the object that PLAYS one rep: it loads the drill's TRANIN file, uploads the
// trainee's and the props' pages to VRAM, builds two sprite actors (the trainee and the props)
// and walks them through the TRANIN scripts, and it decides whether the rep hit.
//   +0x50 play state: 1 idle/ready, 2 growing in, 4 playing a rep, 8 playing the closing pose
//   +0x54 trainee category (the roster slot)   +0x58 drill id
//   +0x5C the script being played (0 intro, 1 wind-up, 2 hit, 3 miss, 4 win, 5 lose)
//   +0x60 the last rep's result: 1 hit, 0 miss, -1 not resolved
//   +0x64/+0x68 the grow-in scale and its step   +0x70 "apply the scale" request
//   +0x74/+0x78 the actors' view and ordering bucket   +0x80..+0x8C the VRAM page / CLUT origins
//   +0x94/+0x98 set when the origins were given   +0x9C the hit chance percent (0..99)
// The children array (+0x24): [0] the trainee actor, [4] the props actor.
// Methods: +0xA4 setPageOrigin, +0xA8 setClutOrigin, +0xAC setHitPercent, +0xB0 growIn,
// +0xB4 shrinkOut, +0xB8 resume, +0xBC holdBoth, +0xC0 setScale, +0xC4 result, +0xC8 closingPose.
//
// A rep hits when `+0x9C >= random % 100`, so a chance of 99 never misses and one of 0 still
// hits on a roll of zero. The random source is the resident service [0x8004DC0C] (the same cell
// every gym roll uses).
export const GYM_REP_HANDLER = 0x800897b8;
export const GYM_REP_SIZE = 0xd4;
export const GYM_REP_EXTRA = 0xc;
export const GYM_REP_METHODS = [
  [0xa4, 0x8008a1d0], [0xa8, 0x8008a1e4], [0xac, 0x8008a1f8], [0xb0, 0x8008a200], [0xb4, 0x8008a218],
  [0xb8, 0x8008a158], [0xbc, 0x8008a0f4], [0xc0, 0x8008a234], [0xc4, 0x8008a244], [0xc8, 0x8008a264],
] as const;
/** The actor class slots the rep actor calls. */
export const GYM_ACTOR_SLOT = {
  setData: 0xe0, setScript: 0xe4, setOrigin: 0xe8, setPage: 0xec, setLayer: 0xf0, setClut: 0xf4,
  setScale: 0xf8, setPivot: 0xfc, isDone: 0x104, hold: 0x108,
} as const;

export interface GymRepMemory {
  read32(addr: number): number;
  write32(addr: number, value: number): void;
}

export interface GymRepHost {
  /** [0x8004DC0C]() = F0x8001933C: a 16-bit random value. */
  rand(): number;
  /** [0x80044F3C](file) = F0x80013A6C: nonzero while the file is still loading. */
  filePending(file: number): number;
  /** F0x80083880(): build a sprite actor. */
  createActor(): number;
  /** One method call on a sprite actor's class table. */
  actor(actor: number, slot: number, args: number[]): number;
  /** self+0x38(self): advance the task state. */
  advance(self: number): void;
  /** self+0x3C(self): advance the second state counter. */
  advanceState1(self: number): void;
  /** self+0x2C(self, value): set the second state counter. */
  setState1(self: number, value: number): void;
  /** target+0x28(target, value): set another task's state. */
  setState0(target: number, value: number): void;
  /** [0x8008CFCC+0x308] F0x8008C064(drill): the drill's TRANIN file. */
  packFile(drill: number): number;
  /** [+0x30C] F0x8008C080(drill): the scene origin, y << 16 | x. */
  packOrigin(drill: number): number;
  /** [+0x310] F0x8008C0A4(drill): 1 draws the props at the trainee's row. */
  packPropsFlag(drill: number): number;
  /** [+0x300] F0x8008BD90(category): index a sub-directory. */
  packParse(category: number): number;
  /** [+0x304] F0x8008BE54(category, params): upload a sub-directory's pages. */
  packUpload(category: number, params: number): number;
  /** [+0x314] F0x8008C0C0(category): the clip directory. */
  packClips(category: number): number;
  /** [+0x318] F0x8008C0E4(category): the clip directory's data offset. */
  packDataOffset(category: number): number;
  /** [0x8008D2EC] F0x8008C12C(category, index): a script pointer. */
  packScript(category: number, index: number): number;
}

const A = GYM_ACTOR_SLOT;

/** F0x8008A274(category, drill, layer, bucket): build the rep actor. */
export function gymRepCreate(
  mem: GymRepMemory, host: { alloc(handler: number, size: number, extra: number): number },
  category: number, drill: number, layer: number, bucket: number,
): number {
  const obj = host.alloc(GYM_REP_HANDLER, GYM_REP_SIZE, GYM_REP_EXTRA);
  for (const [slot, routine] of GYM_REP_METHODS) mem.write32(obj + slot, routine | 0);
  mem.write32(obj + 0x54, category >>> 0);
  mem.write32(obj + 0x58, drill >>> 0);
  mem.write32(obj + 0x74, layer >>> 0);
  mem.write32(obj + 0x78, bucket >>> 0);
  return obj;
}

/** F0x8008A1D0(actor, x, y): where the trainee's pages go in VRAM. */
export function gymRepSetPageOrigin(mem: GymRepMemory, actor: number, x: number, y: number): void {
  mem.write32(actor + 0x80, x >>> 0);
  mem.write32(actor + 0x84, y >>> 0);
  mem.write32(actor + 0x94, 1);
}
/** F0x8008A1E4(actor, x, y): where the palettes go in VRAM. */
export function gymRepSetClutOrigin(mem: GymRepMemory, actor: number, x: number, y: number): void {
  mem.write32(actor + 0x88, x >>> 0);
  mem.write32(actor + 0x8c, y >>> 0);
  mem.write32(actor + 0x98, 1);
}
/** F0x8008A1F8(actor, percent). */
export function gymRepSetHitPercent(mem: GymRepMemory, actor: number, percent: number): void {
  mem.write32(actor + 0x9c, percent >>> 0);
}
/** F0x8008A200(actor): start growing the scene in from nothing. */
export function gymRepGrowIn(mem: GymRepMemory, actor: number): void {
  mem.write32(actor + 0x68, 0x199);
  mem.write32(actor + 0x64, 0);
  mem.write32(actor + 0x50, 2);
}
/** F0x8008A218(actor): start shrinking the scene out. */
export function gymRepShrinkOut(mem: GymRepMemory, actor: number): void {
  mem.write32(actor + 0x64, 0x1000);
  mem.write32(actor + 0x68, -0x333);
  mem.write32(actor + 0x50, 2);
}
/** F0x8008A234(actor, scale): apply a scale on the next tick. */
export function gymRepSetScale(mem: GymRepMemory, actor: number, scale: number): void {
  mem.write32(actor + 0x70, 1);
  mem.write32(actor + 0x64, scale >>> 0);
}
/** F0x8008A244(actor): the last rep's result once the rep is ready, else -1. */
export function gymRepResult(mem: GymRepMemory, actor: number): number {
  return (mem.read32(actor + 0x50) & 1) !== 0 ? mem.read32(actor + 0x60) | 0 : -1;
}
/** F0x8008A264(actor): play the closing win or lose pose. */
export function gymRepClosingPose(mem: GymRepMemory, actor: number): void {
  mem.write32(actor + 0x50, 8);
  mem.write32(actor + 0x10, 0);
}
/** F0x8008A158(actor): release both sprite actors and play the next rep. */
export function gymRepResume(mem: GymRepMemory, actor: number, host: Pick<GymRepHost, "actor">): void {
  const children = mem.read32(actor + 0x24) >>> 0;
  for (const slot of [0, 4]) {
    const child = mem.read32(children + slot) >>> 0;
    if (child !== 0) host.actor(child, A.hold, [0]);
  }
  mem.write32(actor + 0x50, 4);
}
/** F0x8008A0F4(actor): hold both sprite actors. */
export function gymRepHoldBoth(mem: GymRepMemory, actor: number, host: Pick<GymRepHost, "actor">): void {
  const children = mem.read32(actor + 0x24) >>> 0;
  for (const slot of [0, 4]) {
    const child = mem.read32(children + slot) >>> 0;
    if (child !== 0) host.actor(child, A.hold, [1]);
  }
}

/** F0x800897B8(actor, children): one frame of the rep actor. */
export function gymRepTick(mem: GymRepMemory, actor: number, children: number, host: GymRepHost): void {
  const state = mem.read32(actor + 0x0c) | 0;
  const child = (i: number): number => mem.read32(children + i * 4) >>> 0;
  const both = (fn: (c: number) => void): void => { for (const i of [0, 1]) if (child(i) !== 0) fn(child(i)); };

  if (state !== 1) {
    if (state >= 2 && state < 4) return;
    if ((host.filePending(host.packFile(mem.read32(actor + 0x58))) | 0) !== 0) return;
    if (mem.read32(actor + 0x94) === 0 || mem.read32(actor + 0x98) === 0) return;
    host.advance(actor);
    const origin = host.packOrigin(mem.read32(actor + 0x58)) >>> 0;
    const params = (actor + 0x80) >>> 0;
    const category = mem.read32(actor + 0x54);
    host.packParse(category);
    host.packUpload(category, params);
    if (child(0) === 0) mem.write32(children, host.createActor() >>> 0);
    // The trainee first: the order of the original's calls is data, then script, origin, page, clut, layer.
    host.actor(child(0), A.setData, [host.packClips(category), host.packDataOffset(category)]);
    host.actor(child(0), A.setScript, [host.packScript(category, mem.read32(actor + 0x5c))]);
    host.actor(child(0), A.setOrigin, [origin & 0xffff, origin >>> 16]);
    host.actor(child(0), A.setPage, [mem.read32(actor + 0x80), mem.read32(actor + 0x84)]);
    host.actor(child(0), A.setClut, [mem.read32(actor + 0x88), mem.read32(actor + 0x8c)]);
    host.actor(child(0), A.setLayer, [mem.read32(actor + 0x74), mem.read32(actor + 0x78)]);
    if ((host.packParse(8) | 0) !== 0) {
      const page = mem.read32(actor + 0x80);
      mem.write32(actor + 0x90, page);
      mem.write32(actor + 0x80, (page + 0x80) >>> 0);
      host.packUpload(8, params);
      mem.write32(actor + 0x80, mem.read32(actor + 0x90));
      if (child(1) === 0) mem.write32(children + 4, host.createActor() >>> 0);
      const props = child(1);
      host.actor(props, A.setData, [host.packClips(8), host.packDataOffset(8)]);
      host.actor(props, A.setScript, [host.packScript(8, mem.read32(actor + 0x5c))]);
      host.actor(props, A.setOrigin, [origin & 0xffff, origin >>> 16]);
      host.actor(props, A.setPage, [mem.read32(actor + 0x80), mem.read32(actor + 0x84)]);
      host.actor(props, A.setClut, [mem.read32(actor + 0x88), mem.read32(actor + 0x8c)]);
      const flag = host.packPropsFlag(mem.read32(actor + 0x58));
      host.actor(props, A.setLayer, [mem.read32(actor + 0x74), (mem.read32(actor + 0x78) - (flag === 0 ? 1 : 0)) >>> 0]);
    } else if (child(1) !== 0) {
      host.setState0(child(1), 3);
    }
    mem.write32(actor + 0x60, -1 >>> 0);
    return;
  }

  // Ready state.
  if (mem.read32(actor + 0x70) !== 0) {
    both((c) => host.actor(c, A.setScale, [mem.read32(actor + 0x64), mem.read32(actor + 0x64), 0x1000]));
    mem.write32(actor + 0x70, 0);
  }
  const play = mem.read32(actor + 0x50);
  const done = (): number => {
    if (child(1) !== 0) {
      const a = host.actor(child(0), A.isDone, []);
      const b = host.actor(child(1), A.isDone, []);
      return a & b;
    }
    return host.actor(child(0), A.isDone, []);
  };
  const scriptFor = (category: number): number => host.packScript(category, mem.read32(actor + 0x5c));
  const finishRep = (): void => {
    both((c) => host.actor(c, A.hold, [1]));
    mem.write32(actor + 0x5c, 0);
    host.setState1(actor, 0);
    mem.write32(actor + 0x50, 1);
  };

  if (play === 2) {
    const step = mem.read32(actor + 0x68) | 0;
    const scale = (mem.read32(actor + 0x64) + step) | 0;
    mem.write32(actor + 0x64, scale >>> 0);
    if (step > 0) {
      if (scale >= 0x1001) {
        mem.write32(actor + 0x64, 0x1000);
        mem.write32(actor + 0x68, 0);
        mem.write32(actor + 0x50, 1);
      }
    } else if (scale < 0) {
      mem.write32(actor + 0x64, 0);
      mem.write32(actor + 0x68, 0);
      mem.write32(actor + 0x50, 1);
    }
    both((c) => {
      host.actor(c, A.setScale, [mem.read32(actor + 0x64), mem.read32(actor + 0x64), 0x1000]);
      host.actor(c, A.setPivot, [0xcf, 0x7f]);
    });
    return;
  }
  if (play === 4) {
    if (done() === 0) return;
    if (mem.read32(actor + 0x10) === 0) {
      const next = (mem.read32(actor + 0x5c) + 1) | 0;
      mem.write32(actor + 0x5c, next >>> 0);
      if (next < 2) {
        if (child(0) !== 0) host.actor(child(0), A.setScript, [host.packScript(mem.read32(actor + 0x54), next)]);
        if (child(1) !== 0) host.actor(child(1), A.setScript, [host.packScript(8, mem.read32(actor + 0x5c))]);
        mem.write32(actor + 0x60, -1 >>> 0);
        return;
      }
      const hit = (mem.read32(actor + 0x9c) | 0) < ((host.rand() | 0) % 100) ? 0 : 1;
      const index = hit === 1 ? 2 : 3;
      if (child(0) !== 0) host.actor(child(0), A.setScript, [host.packScript(mem.read32(actor + 0x54), index)]);
      if (child(1) !== 0) host.actor(child(1), A.setScript, [host.packScript(8, index)]);
      mem.write32(actor + 0x60, hit);
      host.advanceState1(actor);
      return;
    }
    both((c) => host.actor(c, A.hold, [1]));
    mem.write32(actor + 0x5c, 0);
    host.setState1(actor, 0);
    mem.write32(actor + 0x50, 1);
    return;
  }
  if (play === 8) {
    if (mem.read32(actor + 0x10) === 0) {
      mem.write32(actor + 0x5c, mem.read32(actor + 0x60) !== 0 ? 4 : 5);
      if (child(0) !== 0) {
        const script = scriptFor(mem.read32(actor + 0x54));
        if (script !== 0) host.actor(child(0), A.setScript, [script]);
        else mem.write32(actor + 0x50, 1);
      }
      if (child(1) !== 0) {
        const script = scriptFor(8);
        if (script !== 0) host.actor(child(1), A.setScript, [script]);
        else mem.write32(actor + 0x50, 1);
      }
      mem.write32(actor + 0x10, (mem.read32(actor + 0x10) + 1) >>> 0);
      return;
    }
    if (done() === 0) return;
    finishRep();
  }
}
