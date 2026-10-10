// The service boundary the training gym's screen objects share (session window, confirm panel,
// drill picker, screen draw). Every method is one original call through a resident pointer, so
// the lane-b oracles log the original's call and the port's call under the same name.
//
//   text widgets   created by F0x8001AE38(target, kind, x, y); methods by slot: +0x114 set,
//                  +0x118 number, +0x120 format, +0x128 rescan, +0x130 scroll, +0x138 colour,
//                  +0x144 show, +0x160 flag, +0x168 done, +0x170 waiting.
//   cursor icon    created by F0x8001B364(target, order, x, y); +0x80 show, +0x84 place.
//   text source    [0x80044F4C](language + 0x10B): the gym's text bank.
//   pad service    [0x8004B7D0 + 0x3F4] pressed, +0x3F8 held, +0x3FC auto-repeat (port 0);
//                  +0x408(port, logical button) the logical -> physical bit.
//   sound          [0x80055C48](id) plays and returns a channel; [0x80055C50](id, channel) stops.
//   window fold    the overlay's own tween pair (native/window-fold.ts): start(obj, open) also
//                  plays 0x40019 (open) or 0x4001A (close); tick(obj) returns 1 when settled.
//   party          [0x8004B484](slot) the stats block, [0x8004B468](slot, dest) the 0x2C-byte
//                  stats projection, [0x8004B43C]() the rank group.
export interface GymUiHost {
  textSource(): number;
  createText(target: number, kind: number, x: number, y: number): number;
  createCursor(target: number, order: number, x: number, y: number): number;
  textSet(widget: number, source: number, id: number): void;
  textNumber(widget: number, line: number, value: number): void;
  textFormat(widget: number, source: number, id: number, line: number): void;
  textRescan(widget: number): number;
  /** Widget +0x134: move the text box. */
  textOrigin(widget: number, x: number, y: number): void;
  textScroll(widget: number, mode: number): void;
  textColour(widget: number, code: number): void;
  textShow(widget: number, visible: number): void;
  textFlag(widget: number, value: number): void;
  textDone(widget: number): number;
  textWaiting(widget: number): number;
  cursorShow(cursor: number, visible: number): void;
  cursorPlace(cursor: number, x: number, y: number): void;
  padPressed(): number;
  padHeld(): number;
  padRepeat(): number;
  padBit(logical: number): number;
  playSound(id: number): number;
  stopSound(id: number, channel: number): void;
  foldStart(fold: number, open: number): void;
  foldTick(fold: number): number;
  /** [0x8004B44C](position) = F0x80016D94: party position -> roster slot. */
  rosterSlot(position: number): number;
  recordBlock(slot: number): number;
  /** A scratch block the 0x2C-byte projection is copied into (the original's stack). */
  projectionScratch(): number;
  copyProjection(slot: number, dest: number): void;
  rankGroup(): number;
  /** target+0x28(target, value): set another task's state (the lifecycle word). */
  setState0(target: number, value: number): void;
}

/** The draw boundary the gym's screen objects share (one picture-service call each). */
export interface GymDrawHost {
  initDrawContext(): void;
  setLayer(target: number, bucket: number): void;
  setOrigin(x: number, y: number): void;
  setScale(x: number, y: number, z: number): void;
  setPos(x: number, y: number): void;
  paletteShift(value: number): void;
  drawSprite(pack: number, clip: number, x: number, y: number): void;
  packResolve(handle: number): number;
  frameTick(): number;
}

export const GYM_PACK_CMFONT = 0x02860000;
export const GYM_PACK_STTRNG0 = 0x028c0000;
export const GYM_PACK_STTRNG3 = 0x028c0003;
export const GYM_LANGUAGE_CELL = 0x8005cca8;
export const GYM_TEXT_BANK_OFFSET = 0x10b;
