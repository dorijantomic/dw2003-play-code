// The training gym's TRANIN pack services, translated from the original pro/stgtrain bodies
// (F0x8008BAA8 .. F0x8008C1C8, the service table at 0x8008D2A8).
//
// Oracle: tests/lane-b/gym-packs.test.js runs each original through engine/native on the
// shipped TRANIN00 pack and compares the ordered boundary calls, every field of the pack
// table and the decoded pages.
//
// What the services are. Each drill names one TRANIN file (record word 0 of the 16-byte drill
// table at 0x8008CE3C: the disc index). A TRANIN file is an archive of nine sub-directories,
// one per trainee category (the roster slot, 0..7) plus the shared props (8). A sub-directory
// is itself an archive {count, offsets[count]}: entry 0 the clip directory (layers per clip),
// entries 1..6 the six animation scripts (intro, wind-up, hit, miss, win, lose), entries 7..
// the texture pages (RLEN-packed TIM blocks). The 0x50-byte records at 0x8008CFCC + slot * 0x50
// are the parsed index of the loaded sub-directories:
//   +0x0C slot id     +0x10 clip directory   +0x14/+0x18 the two words after the offset table
//   +0x1C..+0x30 the six script pointers (0 when an entry is absent)
//   +0x34.. the page pointers   +0x44 the page count (entries - 7)
//   +0x48.. each page's VRAM x (halfwords)   +0x58 the pages' VRAM y
// Word 0 of the block (0x8008CFCC) is the rank-menu entry count, +4 the loaded file's RAM base,
// +8 the current file's drill index.
//
//   F0x8008BAA8 gymPackPreload   (drill) ask the resident cache for the drill's TRANIN file; a
//                                drill other than the current one clears the parsed index first.
//   F0x8008BB38 gymPackBase      the file's RAM base once the cache has it, else 0.
//   F0x8008BD90 gymPackParse     (slot) index one sub-directory (clips, scripts, pages).
//   F0x8008BE54 gymPackUpload    (slot, vram) RLEN-expand each page and upload its CLUT and
//                                image blocks to VRAM: page k at x + 0x40 * k, the CLUT at
//                                clutX + the block's own x.
//   F0x8008C064 .. F0x8008C12C   table accessors. F0x8008C158 / F0x8008C1C8 walk the rank menu.
// Services not reached by the route (no caller): the +0x2EC / +0x2F0 tween pair F0x8008B9FC /
// F0x8008BA3C, F0x8008BBD0 and the +0x31C accessor F0x8008C108.
export const GYM_PACKS = 0x8008cfcc;
export const GYM_PACK_RECORDS = 0x8008ce3c;
export const GYM_RANK_MENUS = 0x8008c4e4;
export const GYM_PACK_SCRATCH = 0xa800;

export interface GymPackMemory {
  read8(addr: number): number;
  read16(addr: number): number;
  read32(addr: number): number;
  write8(addr: number, value: number): void;
  write32(addr: number, value: number): void;
}

export interface GymPackHost {
  /** [0x8004B600](dest, bytes): the resident zero-fill. */
  zeroFill(dest: number, bytes: number): void;
  /** [0x80044F44](id) = F0x80013C30: ask the resource cache for a file. */
  requestFile(id: number): void;
  /** [0x80044B38 + 0x404](id): zero once the file is resident. */
  fileLoading(id: number): number;
  /** [0x80044B38 + 0x414](id): the resident file's RAM base. */
  fileBase(id: number): number;
  /** F0x8001FFA8(context): build the upload context. */
  contextInit(): void;
  /** context +0x24(x, y): the destination of the next image block. */
  setImageDestination(x: number, y: number): void;
  /** context +0x28(x, y): the destination of the next CLUT block. */
  setClutDestination(x: number, y: number): void;
  /** context +0x20(tim): upload the TIM blocks at `tim`. */
  upload(tim: number): void;
  /** [0x8004B5F4](size, tag): scratch allocation. */
  alloc(size: number, tag: number): number;
  /** [0x8004B5EC](ptr): free scratch. */
  free(ptr: number): void;
}

const s16 = (v: number): number => (v << 16) >> 16;

/** F0x8008BAA8(drill): request the drill's TRANIN file. Returns 1, or 0 for a negative drill. */
export function gymPackPreload(mem: GymPackMemory, drill: number, host: GymPackHost): number {
  if ((drill | 0) < 0) return 0;
  if ((drill | 0) !== (mem.read32(GYM_PACKS + 8) | 0)) {
    host.zeroFill(GYM_PACKS + 4, 0x2d8);
    mem.write32(GYM_PACKS + 8, drill >>> 0);
    host.requestFile(mem.read32(GYM_PACK_RECORDS + (drill | 0) * 0x10));
    mem.write32(GYM_PACKS + 4, 0);
  }
  return 1;
}

/** F0x8008BB38(): the TRANIN file's RAM base once resident. */
export function gymPackBase(mem: GymPackMemory, host: Pick<GymPackHost, "fileLoading" | "fileBase">): number {
  const id = mem.read32(GYM_PACK_RECORDS + (mem.read32(GYM_PACKS + 8) | 0) * 0x10);
  if ((host.fileLoading(id) | 0) === 0) {
    mem.write32(GYM_PACKS + 4, host.fileBase(mem.read32(GYM_PACK_RECORDS + (mem.read32(GYM_PACKS + 8) | 0) * 0x10)));
  }
  return mem.read32(GYM_PACKS + 4) | 0;
}

/** F0x8008BC1C(directory, slot): the clip directory pointer and the two words past the offset table. */
function bindClips(mem: GymPackMemory, directory: number, slot: number): number {
  const record = GYM_PACKS + slot * 0x50;
  mem.write32(record + 0x10, (mem.read32(GYM_PACKS + 4) + mem.read32(directory + 4)) >>> 0);
  const after = (directory + ((mem.read32(directory) << 2) + 4)) >>> 0;
  mem.write32(record + 0x14, mem.read32(after));
  mem.write32(record + 0x18, mem.read32(after + 4));
  return 1;
}

/** F0x8008BC94(directory, slot): the six animation script pointers. */
function bindScripts(mem: GymPackMemory, directory: number, slot: number): number {
  const record = GYM_PACKS + slot * 0x50;
  for (let k = 0; k < 6; k++) {
    const offset = mem.read32(directory + k * 4 + 8);
    mem.write32(record + 0x1c + k * 4, offset !== 0 ? (mem.read32(GYM_PACKS + 4) + offset) >>> 0 : 0);
  }
  return 1;
}

/** F0x8008BD08(directory, slot): the page count and pointers. */
function bindPages(mem: GymPackMemory, directory: number, slot: number): number {
  const record = GYM_PACKS + slot * 0x50;
  const count = (mem.read32(directory) - 7) | 0;
  mem.write32(record + 0x44, count >>> 0);
  for (let k = 0; k < count; k++) {
    mem.write32(record + 0x34 + k * 4, (mem.read32(GYM_PACKS + 4) + mem.read32(directory + 0x20 + k * 4)) >>> 0);
  }
  return 1;
}

/** F0x8008BD90(slot): index one sub-directory of the loaded file. Returns 1 when it parsed. */
export function gymPackParse(mem: GymPackMemory, slot: number): number {
  const base = mem.read32(GYM_PACKS + 4) | 0;
  if (base === 0 || (slot | 0) >= 9) return 0;
  mem.write32(GYM_PACKS + slot * 0x50 + 0xc, slot >>> 0);
  const directory = (base + mem.read32(base + slot * 4)) >>> 0;
  if (mem.read32(directory) === 0) return 0;
  if (bindClips(mem, directory, slot) === 0) return 0;
  if (bindScripts(mem, directory, slot) === 0) return 0;
  return bindPages(mem, directory, slot) !== 0 ? 1 : 0;
}

/**
 * The RLEN codec F0x8008BE54 runs inline: after the 8-byte header each control byte is a
 * length; bit 7 set repeats the next byte that many times, bit 7 clear copies that many
 * following bytes; a zero ends the stream.
 */
export function gymExpandRlen(mem: GymPackMemory, source: number, dest: number): void {
  let from = (source + 8) >>> 0;
  let to = dest >>> 0;
  let control = mem.read8(from);
  while (control !== 0) {
    const length = control & 0x7f;
    if ((control & 0x80) !== 0) {
      from = (from + 1) >>> 0;
      for (let i = 0; i < length; i++) mem.write8(to++, mem.read8(from));
      from = (from + 1) >>> 0;
    } else {
      from = (from + 1) >>> 0;
      for (let i = 0; i < length; i++) { mem.write8(to++, mem.read8(from)); from = (from + 1) >>> 0; }
    }
    control = mem.read8(from);
  }
}

/** F0x8008BE54(slot, vram): upload one sub-directory's pages. Returns 1, or 0 for a stale slot. */
export function gymPackUpload(
  mem: GymPackMemory, slot: number, vram: number, host: GymPackHost,
): number {
  const record = GYM_PACKS + slot * 0x50;
  if ((slot | 0) !== (mem.read32(record + 0xc) | 0)) return 0;
  const imageX = mem.read32(vram + 0);
  const imageY = mem.read32(vram + 4);
  const clutX = mem.read32(vram + 8);
  const clutY = mem.read32(vram + 0xc);
  host.contextInit();
  mem.write32(record + 0x58, imageY);
  const scratch = host.alloc(GYM_PACK_SCRATCH, 2);
  const pages = mem.read32(record + 0x44) | 0;
  let x = imageX | 0;
  for (let k = 0; k < pages; k++) {
    mem.write32(record + 0x48 + k * 4, x >>> 0);
    host.setImageDestination(x, imageY);
    let tim = mem.read32(record + 0x34 + k * 4);
    if (mem.read32(tim) === 0x4e454c52) {
      gymExpandRlen(mem, tim, scratch);
      tim = scratch;
    }
    x += 0x40;
    host.setClutDestination((clutX + s16(mem.read16(tim + 0xc))) | 0, clutY);
    host.upload(tim);
  }
  host.free(scratch);
  return 1;
}

/** F0x8008C064(drill): the drill's TRANIN file disc index. */
export const gymPackFile = (mem: GymPackMemory, drill: number): number =>
  mem.read32(GYM_PACK_RECORDS + (drill | 0) * 0x10) | 0;
/** F0x8008C080(drill): the scene origin, y << 16 | x. */
export const gymPackOrigin = (mem: GymPackMemory, drill: number): number =>
  ((mem.read32(GYM_PACK_RECORDS + (drill | 0) * 0x10 + 8) << 16) | mem.read32(GYM_PACK_RECORDS + (drill | 0) * 0x10 + 4)) | 0;
/** F0x8008C0A4(drill): record word 3 (1 draws the props one row higher). */
export const gymPackPropsFlag = (mem: GymPackMemory, drill: number): number =>
  mem.read32(GYM_PACK_RECORDS + (drill | 0) * 0x10 + 0xc) | 0;
/** F0x8008C0C0(slot): the slot's clip directory. */
export const gymPackClips = (mem: GymPackMemory, slot: number): number =>
  mem.read32(GYM_PACKS + (slot | 0) * 0x50 + 0x10) | 0;
/** F0x8008C0E4(slot): the slot's first trailing word (the data offset the actor starts at). */
export const gymPackDataOffset = (mem: GymPackMemory, slot: number): number =>
  mem.read32(GYM_PACKS + (slot | 0) * 0x50 + 0x14) | 0;
/** F0x8008C12C(slot, index): one of the slot's six script pointers. */
export const gymPackScript = (mem: GymPackMemory, slot: number, index: number): number =>
  mem.read32(GYM_PACKS + (slot | 0) * 0x50 + (index | 0) * 4 + 0x1c) | 0;

/** F0x8008C158(group): count the rank menu's entries into word 0; returns the group's menu. */
export function gymRankMenu(mem: GymPackMemory, group: number): number {
  let g = group | 0;
  if (((g - 1) >>> 0) >= 0xe) g = 0;
  mem.write32(GYM_PACKS, 0);
  for (let k = 0; k < 0x10; k++) {
    if (mem.read32(GYM_RANK_MENUS + (g << 7) + k * 8) !== 0) mem.write32(GYM_PACKS, (mem.read32(GYM_PACKS) + 1) >>> 0);
  }
  return ((g << 7) + GYM_RANK_MENUS) >>> 0;
}

/** F0x8008C1C8(group, key): the rank-menu entry whose first word is `key`, else 0. */
export function gymRankMenuFind(mem: GymPackMemory, group: number, key: number): number {
  let g = group | 0;
  if (((g - 1) >>> 0) >= 0xe) g = 0;
  for (let k = 0; k < 0x10; k++) {
    if ((mem.read32(GYM_RANK_MENUS + (g << 7) + k * 8) | 0) === (key | 0)) return ((g << 7) + GYM_RANK_MENUS + k * 8) >>> 0;
  }
  return 0;
}
