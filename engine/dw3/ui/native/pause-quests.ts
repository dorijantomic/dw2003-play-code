// The QUESTS pause page: EXTRA, not on the disc. It is built from the same pieces the disc's own pause pages use: the
// shared page services (text widgets, the cursor icon, the panel folds, the pad, the picture calls), the pause host's
// backdrop, the list window and the top bar that the home list draws, and the description band the SORT page uses.
//
//   top bar       cmfont clip 0x18 with the prompt text, folding open as on every page
//   list window   cmfont clip 0x24, the disc's eight-row panel, with eight text rows and the selection cursor (as the home list)
//   description   the band under the screen (pack 0x04040000 clip 0x20) with up to three lines about the selected quest
//
// Lifecycle and structure follow pause-sort.ts: a root that builds on its first tick, a state machine, the folds, state 3
// when it is done (the host then sees the page leave its child slot and the pause returns to the home list).
//
// Confirm on a quest reads its full text in the same band, page by page; Confirm turns the page, Back returns to the list.
//
// Object fields: +0x54 layer, +0x58 bucket, +0x50 parent, +0x5c quest count, +0x60 selected, +0x64 first visible, +0x68 page being read,
// +0x70 / +0x80 / +0x90 the folds (list window, top bar, description band; a fold is 0x10 bytes: frames, step, value at +8, running at +0xc).
// Widget slots (ui): +0 the prompt, +4.. eight rows, +0x24 the cursor, +0x28.. three description lines.
import type { PauseMemory, PauseServices } from "./pause-services.ts";

export const QUESTS_HANDLER = 0x80f00001; // not a disc address: this page is not on the disc
export const QUESTS_SIZE = 0xb0;
export const QUESTS_EXTRA = 0x60;
const LAYOUT = 0x8009af6c;
const PACK_CMFONT = 0x02860000;
const PACK_BAND = 0x04040000;
const ROWS = 8;
const LINES = 3;

const s16 = (v: number): number => (v << 16) >> 16;

export interface QuestsHost extends PauseServices {
  alloc(handler: number, size: number, extra: number): number;
  /** The address of the page's string bank (registered as a text source). */
  bank(): number;
  /** How many quests the page lists. */
  count(): number;
  /** Where quest i's full text starts in the bank (a string index) and how many three-line pages it has. */
  detail(i: number): { start: number; pages: number };
}

/** String indexes in the page's bank: titles, then three lines per quest, then the prompt and the two "none" strings. */
export const questTitleIndex = (i: number): number => i;
export const questLineIndex = (count: number, i: number, k: number): number => count + i * LINES + k;
export const questPromptIndex = (count: number): number => count * (1 + LINES);
export const questNoneIndex = (count: number): number => questPromptIndex(count) + 1;
export const questNoneLineIndex = (count: number): number => questPromptIndex(count) + 2;
export const questReadPromptIndex = (count: number): number => questPromptIndex(count) + 3;
/** The strings after these: every quest's full text, three lines to a page, quest by quest. */
export const questDetailBase = (count: number): number => questPromptIndex(count) + 4;

/** Build the page object (the pause host's builder for the extra row). */
export function questsFactory(mem: PauseMemory, parent: number, host: QuestsHost): number {
  const obj = host.alloc(QUESTS_HANDLER, QUESTS_SIZE, QUESTS_EXTRA);
  mem.write32(obj + 0x54, 0x1000);
  mem.write32(obj + 0x58, 2);
  mem.write32(obj + 0x50, parent);
  return obj;
}

/** The page's lifecycle. */
export function questsRoot(mem: PauseMemory, obj: number, ui: number, host: QuestsHost): void {
  const state = mem.read32(obj + 0xc) | 0;
  if (state === 1) {
    questsTick(mem, obj, ui, host);
    questsDraw(mem, obj, host);
    return;
  }
  if (state >= 2 && state < 4) return;
  host.callMethod(obj, 0x38, []);
  mem.write32(obj + 0x5c, host.count());
  for (const fold of [0x70, 0x80]) mem.write32(obj + fold, 0xa);
  mem.write32(obj + 0x90, 8);
  for (const fold of [0x70, 0x80, 0x90]) host.foldStart(obj + fold, 1);
  questsCtor(mem, obj, ui, host);
}

function questsCtor(mem: PauseMemory, obj: number, ui: number, host: QuestsHost): void {
  const layer = mem.read32(obj + 0x54) | 0;
  const layout = mem.read32(LAYOUT) | 0;
  const top = layout + 0x84;
  mem.write32(ui, host.createText(layer, 1, s16(mem.read16(top + 4)), s16(mem.read16(top + 8))));
  for (let i = 0; i < ROWS; i++) mem.write32(ui + 4 + i * 4, host.createText(layer, 1, 0xbd, 0x31 + i * 0xe));
  const cursor = host.createIcon(layer, 0, 0xb0, 0x31);
  mem.write32(ui + 0x24, cursor);
  host.callMethod(cursor, 0x80, [0]);
  const band = layout + 0x90;
  const x = s16(mem.read16(band + 4)), y = s16(mem.read16(band + 8));
  for (let k = 0; k < LINES; k++) mem.write32(ui + 0x28 + k * 4, host.createText(layer, 1, x, y - 3 + k * 0xe));
}

function questsTick(mem: PauseMemory, obj: number, ui: number, host: QuestsHost): void {
  const r = (off: number) => mem.read32(obj + off) | 0;
  const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
  const at = (off: number) => mem.read32(ui + off) | 0;
  const count = r(0x5c);
  const say = (widget: number, index: number) => host.callMethod(widget, 0x114, [host.bank(), index]);
  const hide = (widget: number) => host.callMethod(widget, 0x144, [0]);
  const bit = (bits: number, code: number) => (bits >> host.padBit(0, code)) & 1;
  const pressed = (code: number) => bit(host.padPressed(0), code) !== 0;
  const pressedOrRepeat = (code: number) => bit(host.padPressed(0), code) !== 0 || bit(host.padRepeat(0), code) !== 0;
  const foldsDone = () => [0x70, 0x80, 0x90].map((f) => host.foldTick(obj + f)).every((d) => d !== 0);

  const showRows = () => {
    for (let i = 0; i < ROWS; i++) {
      const index = r(0x64) + i;
      const widget = at(4 + i * 4);
      if (count === 0) { if (i === 0) say(widget, questNoneIndex(count)); else hide(widget); }
      else if (index < count) say(widget, questTitleIndex(index));
      else hide(widget);
    }
  };
  const showLines = () => {
    for (let k = 0; k < LINES; k++) {
      const widget = at(0x28 + k * 4);
      if (count === 0) { if (k === 0) say(widget, questNoneLineIndex(count)); else hide(widget); }
      else say(widget, questLineIndex(count, r(0x60), k));
    }
  };
  const showPage = () => {
    const { start } = host.detail(r(0x60));
    for (let k = 0; k < LINES; k++) say(at(0x28 + k * 4), start + r(0x68) * LINES + k);
  };
  const placeCursor = () => host.callMethod(at(0x24), 0x84, [0xb0, (r(0x60) - r(0x64)) * 0xe + 0x31]);

  switch (r(0x10)) {
    default:
      if (!foldsDone()) return;
      say(at(0), questPromptIndex(count));
      showRows();
      showLines();
      if (count > 0) { placeCursor(); host.callMethod(at(0x24), 0x80, [1]); }
      w(0x10, 1);
      return;
    case 1: {
      const before = r(0x60);
      if (count > 0) {
        if (pressedOrRepeat(4)) w(0x60, r(0x60) === 0 ? count - 1 : r(0x60) - 1);
        else if (pressedOrRepeat(6)) w(0x60, r(0x60) + 1 >= count ? 0 : r(0x60) + 1);
        if (r(0x60) !== before) {
          if (r(0x60) < r(0x64)) w(0x64, r(0x60));
          if (r(0x60) >= r(0x64) + ROWS) w(0x64, r(0x60) - ROWS + 1);
          host.playSound(0x4001b);
          showRows();
          showLines();
          placeCursor();
        }
      }
      if (count > 0 && pressed(0xd)) {
        host.playSound(0x4001c);
        w(0x68, 0);
        showPage();
        say(at(0), questReadPromptIndex(count));
        w(0x10, 3);
        return;
      }
      if (pressed(0xe)) {
        host.playSound(0x800450bd);
        hide(at(0));
        for (let i = 0; i < ROWS; i++) hide(at(4 + i * 4));
        for (let k = 0; k < LINES; k++) hide(at(0x28 + k * 4));
        host.callMethod(at(0x24), 0x80, [0]);
        for (const fold of [0x70, 0x80, 0x90]) host.foldStart(obj + fold, 0);
        w(0x10, 2);
      }
      return;
    }
    case 2:
      if (foldsDone()) w(0xc, 3);
      return;
    case 3: {                                        // reading one quest's full text
      const { pages } = host.detail(r(0x60));
      if (pressed(0xd)) {
        host.playSound(0x4001c);
        if (r(0x68) + 1 < pages) { w(0x68, r(0x68) + 1); showPage(); return; }
      } else if (!pressed(0xe)) return;
      else host.playSound(0x800450bd);
      showLines();                                   // back to the list's three summary lines
      say(at(0), questPromptIndex(count));
      w(0x10, 1);
      return;
    }
  }
}

function questsDraw(mem: PauseMemory, obj: number, host: QuestsHost): void {
  const r = (off: number) => mem.read32(obj + off) | 0;
  const pack = (id: number) => host.packHandle(id);
  host.drawInit();
  host.draw7C(r(0x54), r(0x58));
  host.draw74(0x140, 0);
  const scaled = (value: number, px: number, py: number) => {
    if (value !== 0x1000) { host.draw8C(value, 0x1000, 0x1000); host.draw94(px, py); } else host.draw8C(0x1000, 0x1000, 0x1000);
  };
  const top = r(0x88);
  if (top !== 0) { scaled(top, 0x140, 0x19); host.drawSprite(pack(PACK_CMFONT), 0x18, 0x22, 0xd); }
  const list = r(0x78);
  if (list !== 0) { scaled(list, 0x140, 0x52); host.drawSprite(pack(PACK_CMFONT), 0x24, 0xa8, 0x28); }
  const band = r(0x98);
  if (band !== 0) {
    scaled(band, 0, 0xd3);
    host.draw74(0x280, 0x100);
    host.drawSprite(pack(PACK_BAND), 0x20, 0, 0xc2);
  }
  host.draw8C(0x1000, 0x1000, 0x1000);
}
