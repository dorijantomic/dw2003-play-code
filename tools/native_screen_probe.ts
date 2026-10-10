// Static trap census and executed-function coverage for a screen overlay under
// the native interpreter.
//
// The wstag path (tools/build_native_overlays.py + NativeStageRuntime) boots a
// stage from an extracted image and a manifest root_ctor. Screen overlays load
// in the resident fieldstg slot (0x80082cb0) and are driven by the resident
// game, not by a self-contained root. This tool boots one anyway, from the
// decomp .s image and the overlay's own constructor, using the production
// boundary stubs; every address outside the image it fails to execute is the
// shared-service boundary a screen port has to serve.
//
//   node tools/native_screen_probe.ts
//   node tools/native_screen_probe.ts --module pro/stgdglab --ctor 0x... --tick 0x...
//   node tools/native_screen_probe.ts --all
//
// `--all` is Phase 0 of docs/plans/2026-09-14-native-screen-port-plan.md: it
// boots every root in screen-census-specs.json, records the union of original
// functions that execute (overlay-local and resident EXE) plus every external
// boundary target, and writes a generated JSON + Markdown report with the exact
// command that produced it. The report is the translation/host-service queue.
//
// The probe auto-stubs each trapped address with a return-zero recorder and
// resumes, so one run walks the whole external surface it can reach. Read-only
// with respect to everything original: reads the .s and the inventory, writes
// nothing outside the generated report.

import { closeSync, existsSync, openSync, readSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import type { NativeMemory } from "../engine/native/memory.ts";
import { NativeTrap } from "../engine/native/mips.ts";
import type { NativeHost } from "../engine/native/stubs.ts";
import {
  bridgeAddresses,
  bridgeInvocations,
  installTranslationBridge,
  isBridged,
  setBridgeProbe,
} from "../engine/native/bridge.ts";

// Functions already translated into engine/dw3 and proven by an oracle test.
// The coverage report marks these `translated`; tests/native-screen-coverage.test.js
// checks each entry names an existing port and oracle file, so the translation
// queue is machine-checked.
interface TranslatedFunction {
  address: string;
  module?: string;
  name: string;
  port: string;
  oracle: string;
}
const TRANSLATED_FUNCTIONS: TranslatedFunction[] = JSON.parse(
  readFileSync(new URL("../data/translated_functions.json", import.meta.url), "utf8"),
);
// Overlay functions share address ranges across overlays (every screen overlay
// loads at 0x80082cb0), so a translation is keyed by BOTH its module and its
// address — and the same address can carry a translation in two modules, so the
// index keeps a list per address. An entry with no `module` applies to any.
const TRANSLATED_BY_ADDRESS = new Map<number, TranslatedFunction[]>();
for (const e of TRANSLATED_FUNCTIONS) {
  const a = parseInt(e.address, 16) >>> 0;
  const list = TRANSLATED_BY_ADDRESS.get(a);
  if (list === undefined) TRANSLATED_BY_ADDRESS.set(a, [e]);
  else list.push(e);
}
function isTranslated(module: string, address: number): boolean {
  const list = TRANSLATED_BY_ADDRESS.get(address >>> 0);
  if (list === undefined) return false;
  return list.some((e) => e.module === undefined || e.module === module);
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INVENTORY = join(ROOT, "recovered/ddw3/function-inventory.json");
const SEMANTICS = join(ROOT, "recovered/ddw3/semantics.json");
const ASM = join(homedir(), "ddw3/asm/dw2003/pro");
// Tracked screen-root list (mirrors the 2026-09-14 census: allocator call
// sites with an in-overlay callback + the constructor that owns them).
// data/ is tracked, so the build extractor and this probe share one
// authority instead of a research-only copy.
const SPECS_PATH = join(ROOT, "data/native_screen_roots.json");
const DEFAULT_REPORT_BASE = join(
  ROOT,
  ".dw3-research/bulk-port-plan-2026-09-14/screen-coverage-2026-09-14",
);

export interface CtorSpec {
  module: string;
  ctor: number;
  tick: number;
  /** Disc .PRO file index (LBA_*_PRO_IDX); when set the overlay image is the
   *  real file (code + data tail) rather than the .s reconstruction. */
  discIndex?: number;
  actor?: string;
  parentSize?: number;
  ctorArg?: number;
}

export type ExecStatus = "translated" | "replaced" | "host-served" | "native" | "inline";

export interface ExecutedFn {
  address: number;
  module: string;
  name: string;
  hits: number;
  /** -1 = executed during boot (root constructor). */
  firstFrame: number;
  /** host-served = a host stub intercepts it; replaced = the mixed-mode bridge
   *  ran the engine/dw3 port instead of the original body; native = original
   *  MIPS runs in engine/native from the shipped image (the Phase 4 queue). */
  status: ExecStatus;
}

export interface ExternalTarget {
  address: number;
  count: number;
  /** resident | synthetic-stub | null | external-stub */
  kind: string;
  name: string;
  callers: string[];
  /** host-served = the runtime/interpreter stub answers the call. */
  status: ExecStatus;
}

export interface ScreenTrap {
  count: number;
  pc: number;
  cb: number;
  reason: string;
}

export interface ScreenRun {
  sounds: number[];
  module: string;
  actor: string | null;
  base: number;
  ctor: number;
  tick: number;
  imageBytes: number;
  booted: boolean;
  bootTrap: string | null;
  frames: number;
  /** Pad interaction frames ticked after the idle frames (0 when idle-only). */
  interactionFrames: number;
  /** Bridge entries installed for this run with their invocation counts. */
  bridged: { module: string; address: number; name: string; invocations: number }[];
  /** FNV-1a over the live address space after the run (stack scratch below the
   *  interpreter's initial $sp excluded — see the hash loop; differential proof). */
  memHash: string;
  /** FNV-1a over all bytes, including unwound stack scratch (diagnostics only). */
  memHashFull: string;
  /** FNV-1a over every recorded draw intent in order (differential proof). */
  drawHash: string;
  /** FNV-1a over the captured textured quads in order (differential proof). */
  quadHash: string;
  /** The runtime's memory after the run (present when `keepMemory` is set). */
  mem?: NativeMemory;
  objects: number;
  bankReads: number;
  bankBytes: number;
  bankIds: number[];
  drawIntents: number;
  drawMethods: Record<string, number>;
  drawIds: number[];
  /** drawSprite id -> the first-arg pack directory pointer it was drawn with. */
  drawDirs: Record<string, number>;
  /** Every distinct pack directory pointer any drawSprite used (an id can be
   *  drawn from more than one directory, e.g. a bundle's several sub-dirs). */
  drawDirsAll: number[];
  /** pack directory pointer (hex) -> the LBA file index the screen requested. */
  packDirIndex: Record<string, number>;
  /** pack directory pointer (hex) -> the handle's low-u16 sub-slot (bundle packs
   *  select a sprite sub-directory with it; simple packs use 0). */
  packDirSlot: Record<string, number>;
  drawSample: { method: string; args: number[] }[];
  executed: ExecutedFn[];
  residentExecuted: ExecutedFn[];
  unmapped: { address: number; hits: number; firstFrame: number; status: ExecStatus }[];
  boundary: ExternalTarget[];
  traps: ScreenTrap[];
  ringOverflow: boolean;
  ringDump: string[];
  /** Per-trap-site ring snapshot, keyed by 'pc=.. reason'. */
  trapTrace: Record<string, string[]>;
  imageSha256: string;
}

interface FnDesc {
  address: number;
  end: number;
  name: string;
  module: string;
}

// ── CLI helpers ──────────────────────────────────────────────────────────────
function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  return v.startsWith("0x") ? (Number(BigInt(v)) >>> 0) : Number(v) >>> 0;
}

// FNV-1a over bytes/words for the differential bridge check.
const FNV_OFFSET = 0x811c9dc5;
const fnvByte = (h: number, b: number): number => Math.imul(h ^ (b & 0xff), 0x01000193) >>> 0;
const fnvWord = (h: number, w: number): number =>
  fnvByte(fnvByte(fnvByte(fnvByte(h, w), w >>> 8), w >>> 16), w >>> 24);

function u32(v: unknown): number {
  if (typeof v === "number") return v >>> 0;
  if (typeof v === "string") return (v.startsWith("0x") ? Number.parseInt(v, 16) : Number(v)) >>> 0;
  throw new Error(`not an address: ${String(v)}`);
}

// ── inventory / semantics indices ────────────────────────────────────────────
// Research-only name/boundary indices (recovered/ is not part of the public
// export): without them functions are known by address only, which changes
// trace labels but not what a screen loads.
const inventory = existsSync(INVENTORY) ? JSON.parse(readFileSync(INVENTORY, "utf8")) : { modules: [] };
const semantics = existsSync(SEMANTICS) ? JSON.parse(readFileSync(SEMANTICS, "utf8")) : { functions: {}, families: {} };

/**
 * A partition of one module's address range into functions. Functions get their
 * provisional end, clamped at the next known start so a routine never absorbs
 * its neighbour; pointer candidates (constructor-installed routines the
 * disassembler missed) and curated semantics names are folded in as starts.
 */
export function indexModule(modId: string): FnDesc[] {
  const mod = inventory.modules.find((m: { id: string }) => m.id === modId);
  if (!mod) return [];
  const starts = new Map<number, { name: string; end: number }>();
  const put = (addr: number, name: string, end: number, overwrite: boolean | ((old: string) => boolean)): void => {
    const rec = starts.get(addr);
    if (!rec) {
      starts.set(addr, { name, end });
      return;
    }
    const should = overwrite === true || (typeof overwrite === "function" && overwrite(rec.name));
    if (should) rec.name = name;
    if (end > rec.end) rec.end = end;
  };
  for (const f of mod.functions ?? []) {
    const addr = u32(f.address ?? 0);
    if (addr) put(addr, String(f.semantic_name ?? f.original_name ?? f.id ?? `0x${addr.toString(16)}`), u32(f.provisional_end_address ?? 0), false);
  }
  for (const f of mod.pointer_candidates ?? []) {
    const addr = u32(f.address ?? f.target_address ?? 0);
    if (addr) put(addr, String(f.original_name ?? f.id ?? `0x${addr.toString(16)}`), 0, false);
  }
  for (const [key, fn] of Object.entries<{ name?: string }>(semantics.functions ?? {})) {
    const [m, a] = key.split(":");
    if (m !== modId || !a) continue;
    const addr = u32(a.replace(/^F0x/, "0x"));
    if (addr) put(addr, fn.name ?? `0x${addr.toString(16)}`, 0, true);
  }
  for (const family of Object.values<{ members?: Record<string, string> }>(semantics.families ?? {})) {
    for (const [key, name] of Object.entries<string>(family.members ?? {})) {
      const [m, a] = key.split(":");
      if (m !== modId || !a) continue;
      const addr = u32(a.replace(/^F0x/, "0x"));
      if (addr) put(addr, name, 0, (old) => /(^|:)F0x[0-9a-f]+$/.test(old) || /:C0x[0-9a-f]+$/.test(old) || /^0x/.test(old));
    }
  }
  if (modId === "exe/fns") {
    // Separate resident source fragments tile this gap in fns.s. Their generated
    // extents carry reliable starts but placeholder size=4; use the next start,
    // not that size. See docs/research/infra/static-decoder.md:151-156.
    // Keep them in the resident runtime namespace (not separately loaded modules).
    const extentsPath = join(ROOT, "docs/generated/function-extents.json");
    const extents = existsSync(extentsPath) ? JSON.parse(readFileSync(extentsPath, "utf8")) : { sources: {} };
    for (const [source, record] of Object.entries<{ functions: { address: number; name: string }[] }>(extents.sources)) {
      if (!/\/asm\/dw2003\/exe\/f[0-9]\.s$/.test(source)) continue;
      for (const f of record.functions) put(u32(f.address), f.name, 0, false);
    }
  }
  const sorted = [...starts.entries()]
    .map(([address, v]) => ({ address, ...v }))
    .sort((a, b) => a.address - b.address);
  const out: FnDesc[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const next = sorted[i + 1];
    // `inventory.provisional_end_address` is the *last instruction address*, i.e.
    // inclusive (tools/build_recovered_inventory.py writes `next_start - 4`),
    // while `fnAt` below tests `addr < end`. Adopting the raw value made the last
    // instruction of every routine land in the `unmapped` bucket: the report read
    // 222 rows as "candidate hidden routines" when they were all delay slots of
    // the routine physically before them (audit 2026-09-15,
    // .dw3-research/autonomous-team/researcher/results/executed-unnamed-pcs-audit/).
    // Convert to an exclusive bound, then clamp at the next start.
    let end = cur.end > cur.address ? cur.end + 4 : next ? next.address : cur.address + 4;
    if (next && end > next.address) end = next.address;
    out.push({ address: cur.address, end, name: cur.name, module: modId });
  }
  return out;
}

function fnAt(index: FnDesc[], addr: number): FnDesc | undefined {
  let lo = 0;
  let hi = index.length - 1;
  let found: FnDesc | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index[mid]!.address <= addr) {
      found = index[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found && addr < found.end ? found : undefined;
}

// Exact-start names across all modules, for targets outside both loaded images.
const byStart = new Map<number, string>();
for (const m of inventory.modules) {
  for (const f of m.functions ?? []) {
    byStart.set(u32(f.address), `${m.id}:${f.semantic_name ?? f.original_name ?? f.id}`);
  }
}

// ── overlay image reconstruction (same .word-annotation rule as
// tools/build_native_overlays.py).
const WORD_RE = /\.[Ll]0x([0-9a-f]{8}): (?:\.word 0x([0-9a-f]+)|.*?# \.word 0x([0-9a-f]+))/g;
function loadImage(path: string, base: number): Uint8Array {
  const text = readFileSync(path, "utf8");
  const words = new Map<number, number>();
  let absolute = true;
  for (const m of text.matchAll(WORD_RE)) {
    const key = Number.parseInt(m[1]!, 16);
    if (key < 0x1000000) absolute = false;
    words.set(key, Number.parseInt(m[2] ?? m[3]!, 16) >>> 0);
  }
  if (words.size === 0) throw new Error(`no .word annotations in ${path}`);
  // Most overlay disassemblies label by file offset; fightstg labels by
  // absolute address. Normalize the latter to offsets.
  if (absolute) {
    const shifted = new Map<number, number>();
    for (const [key, word] of words) shifted.set(key - base, word);
    words.clear();
    for (const [key, word] of shifted) words.set(key, word);
  }
  let size = 0;
  for (const off of words.keys()) size = Math.max(size, off + 4);
  const img = new Uint8Array(size);
  const view = new DataView(img.buffer);
  for (const [off, word] of words) view.setUint32(off, word, true);
  return img;
}

// ── resident EXE image from the disc (SLES_039.36 at LBA 24, 2048 raw bytes
// per 2352-byte sector, 0x800-byte PS-X header before the loadable image).
// It carries the shared services (text element, pad, resource bank) as real
// code; the overlay is loaded after it, exactly as the console does.
function openDisc(path: string): number | null {
  if (!existsSync(path)) return null;
  return openSync(path, "r");
}

/** Read `bytes` from disc sectors starting at `lba`, 2048 data bytes per
 *  2352-byte sector (24-byte header skipped). */
function readSectors(fd: number, lba: number, bytes: number): Buffer {
  const out = Buffer.alloc(bytes);
  const sec = Buffer.alloc(2352);
  let done = 0;
  for (let s = 0; done < bytes; s++) {
    readSync(fd, sec, 0, 2352, (lba + s) * 2352);
    const n = Math.min(2048, bytes - done);
    sec.copy(out, done, 24, 24 + n);
    done += n;
  }
  return out;
}

/** Read one overlay's real .PRO file from the disc, using the resident EXE's
 *  own LBA/length tables (the same tables the cache service reads). */
function loadOverlayFromDisc(fd: number, exe: { image: Uint8Array; base: number }, index: number): Uint8Array {
  const data = exe.image;
  const lbaOff = 0x80044f6c - exe.base + index * 4;
  const lenOff = 0x800474a4 - exe.base + index * 2;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lba = dv.getUint32(lbaOff, true) >>> 0;
  const sectors = dv.getUint16(lenOff, true);
  if (lba === 0 || sectors === 0) throw new Error(`overlay index ${index} has no disc extent`);
  return new Uint8Array(readSectors(fd, lba, sectors << 11));
}

function loadExe(fd: number): { image: Uint8Array; base: number } | null {
  // PS-X EXE is a 0x800-byte header followed by t_size bytes of image. Read the
  // header first, then the whole text segment: a fixed 0x48000 read truncated
  // every EXE data table past file offset 0x47800 (e.g. the language index at
  // 0x8005cca8 read as 0, so the shop asked for bank 106 instead of 108).
  const head = readSectors(fd, 24, 0x800);
  if (head.toString("latin1", 0, 8) !== "PS-X EXE") throw new Error("disc LBA 24 is not a PS-X EXE");
  const tAddr = head.readUInt32LE(0x18);
  const tSize = head.readUInt32LE(0x1c);
  const exe = readSectors(fd, 24, 0x800 + tSize);
  return { image: new Uint8Array(exe.subarray(0x800, 0x800 + tSize)), base: tAddr };
}

// ── spec loading ─────────────────────────────────────────────────────────────
export function loadSpecs(path = SPECS_PATH): CtorSpec[] {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${path} is not a spec array`);
  return raw.map((r: Record<string, unknown>) => ({
    module: String(r.module),
    ctor: u32(r.ctor),
    tick: u32(r.tick),
    discIndex: r.disc_index === undefined ? undefined : u32(r.disc_index),
    actor: r.actor === undefined ? undefined : String(r.actor),
    parentSize: r.parentSize === undefined ? undefined : u32(r.parentSize),
    ctorArg: r.ctorArg === undefined ? undefined : u32(r.ctorArg),
  }));
}

// ── interaction phase ────────────────────────────────────────────────────────
// The idle run is a floor: it boots each root and ticks without input. The
// interaction phase taps the host pad after the idle frames so the report also
// covers the functions normal play reaches through cursor, confirm and cancel
// paths. This is a deterministic sample, not an enumeration of interactions:
// the plan's monotonic coverage rule means any later authentic interaction can
// extend the queue, and a re-run of this probe must never shrink it.
const PAD_UP = 0x0010;
const PAD_RIGHT = 0x0020;
const PAD_DOWN = 0x0040;
const PAD_LEFT = 0x0080;
const PAD_CIRCLE = 0x2000;
const PAD_CROSS = 0x4000;
const INTERACT_TAP_FRAMES = 16;
const INTERACT_HOLD_FRAMES = 2;
/** One tap per entry: Down/Right/Up/Left (cursor), Cross (confirm), Circle (cancel). */
export const INTERACT_SCHEDULE: readonly number[] = [
  PAD_DOWN,
  PAD_DOWN,
  PAD_RIGHT,
  PAD_CROSS,
  PAD_CIRCLE,
  PAD_UP,
  PAD_LEFT,
  PAD_CROSS,
];
export const INTERACT_FRAMES = INTERACT_SCHEDULE.length * INTERACT_TAP_FRAMES;

/** Held-button word for the interaction phase at frame `frame` (0-based). */
export function interactionPad(frame: number): number {
  const tap = Math.floor(frame / INTERACT_TAP_FRAMES);
  if (tap >= INTERACT_SCHEDULE.length) return 0;
  return frame % INTERACT_TAP_FRAMES < INTERACT_HOLD_FRAMES ? (INTERACT_SCHEDULE[tap] as number) : 0;
}

// ── one root run ─────────────────────────────────────────────────────────────
export interface RunOptions {
  frames?: number;
  discPath?: string;
  noExe?: boolean;
  debugCache?: boolean;
  /** Trace ring capacity; 8M pcs = 32 MB and is drained every frame. */
  ringSize?: number;
  /** Run the pad interaction phase after the idle frames (coverage growth). */
  interact?: boolean;
  /** Install the mixed-mode bridge: replaced entries run engine/dw3 TS ports
   *  instead of the shipped MIPS body (translated -> actually replacing). */
  bridge?: boolean;
  /** Attach the final memory image to the run (differential memory diffing). */
  keepMemory?: boolean;
}

export function runScreen(spec: CtorSpec, opts: RunOptions = {}): ScreenRun {
  const idleFrames = opts.frames ?? 60;
  const interact = opts.interact === true;
  const bridge = opts.bridge === true;
  const interactionFrames = interact ? INTERACT_FRAMES : 0;
  const frames = idleFrames + interactionFrames;
  const moduleId = spec.module;
  const mod = inventory.modules.find((m: { id: string }) => m.id === moduleId);
  if (!mod) throw new Error(`module ${moduleId} not in inventory`);
  const base = u32(mod.load_base);
  const localIndex = indexModule(moduleId);
  const discPath = opts.discPath ?? process.env.DW3_DISC ?? join(process.env.DDW3_DIR ?? join(homedir(), "ddw3"), "build/iso/dw2003.bin");
  const discFd = opts.noExe ? null : openDisc(discPath);
  const exe = discFd !== null ? loadExe(discFd) : null;
  // Prefer the real .PRO image (code + data tail the .s reconstruction misses);
  // fall back to the .s word stream for modules with no disc index.
  let image: Uint8Array;
  if (discFd !== null && exe && spec.discIndex !== undefined) {
    image = loadOverlayFromDisc(discFd, exe, spec.discIndex);
  } else {
    const asmName = mod.source.split("/").pop() as string;
    image = loadImage(join(ASM, asmName), base);
  }
  const overlayEnd = (base + image.length) >>> 0;
  const residentIndex = exe ? indexModule("exe/fns") : [];
  const residentBase = exe ? exe.base : 0;
  const residentEnd = exe ? (exe.base + exe.image.length) >>> 0 : 0;

  const resolveWithOffset = (addr: number): string => {
    const a = addr >>> 0;
    const idx = a >= base && a < overlayEnd ? localIndex : exe && a >= residentBase && a < residentEnd ? residentIndex : null;
    if (idx) {
      const f = fnAt(idx, a);
      if (f) return `${f.module}:${f.name}${a !== f.address ? `+0x${(a - f.address).toString(16)}` : ""}`;
      return `0x${a.toString(16)}`;
    }
    return byStart.get(a) ?? `0x${a.toString(16)}`;
  };

  const host: NativeHost = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777, log() {} };
  const manifest = { size: image.length, event_table: 0, init_fn: 0, root_ctor: (spec.ctor - base) >>> 0, allocs: [], effect_ids: [] };
  const rt = new NativeStageRuntime(image, manifest, host, undefined, undefined, base, exe ?? undefined);
  if (exe) rt.cpu.gp = 0x8005cb50; // boot gp the parity/oracle runs use
  // Diagnostic: log every arena allocation (native stub calls and bridged
  // ports both go through the heap service) so an allocation-order divergence
  // between the native and bridge runs can be diffed directly.
  if (process.env.DW3_DUMP_ALLOC && rt.services !== null) {
    const svc = rt.services;
    const realAlloc = svc.alloc.bind(svc);
    const realCarve = svc.carve.bind(svc);
    const realObject = svc.allocObject.bind(svc);
    svc.alloc = (size, align) => {
      const p = realAlloc(size, align);
      console.log(`ALLOC ${size} -> 0x${(p >>> 0).toString(16)}`);
      return p;
    };
    svc.carve = (size) => {
      const p = realCarve(size);
      console.log(`CARVE ${size} -> 0x${(p >>> 0).toString(16)}`);
      return p;
    };
    svc.allocObject = (cb, size, extra, id) => {
      const p = realObject(cb, size, extra, id);
      console.log(`OBJECT cb=0x${(cb >>> 0).toString(16)} size=${size} extra=${extra} -> 0x${(p >>> 0).toString(16)}`);
      return p;
    };
    rt.cpu.setStub(0x80017d2c, (c) => {
      const p = svc.alloc(c.reg(4) >>> 0);
      const caller = rt.mem.read32((c.reg(29) >>> 0) + 0x1c) >>> 0;
      console.log(`LOW caller=0x${caller.toString(16)} ${c.reg(4) >>> 0} -> 0x${(p >>> 0).toString(16)}`);
      return p;
    });
  }
  rt.cpu.setStub(0, () => 0); // null function-pointer call: recover and keep going

  // Serve the pack resolver with a DISTINCT directory pointer per requested
  // pack, so a recorded drawSprite's first argument identifies its pack.
  // The screen passes a packed handle = LBA_file_index << 16: the item shop
  // asks for CMFONTCS 0x02860000 and STSHOPCS 0x04020000
  // (docs/research/ui/shop-system-decompiled.md 3b). One shared scratch pointer
  // collapsed every pack into one tag.
  const packIndexByDir = new Map<number, number>();
  const packSlotByDir = new Map<number, number>();
  const packIndexByHandle = new Map<number, number>();
  const dirByKey = new Map<number, number>();
  rt.cpu.setStub(0x800140d8, (c) => {
    const handle = c.reg(4) >>> 0;
    const idx = (handle >>> 16) & 0xffff;
    const sub = handle & 0xffff;
    packIndexByHandle.set(handle, idx);
    // Bundle packs (carddata, sttrng, ttcommpk) put the sprite sub-directory in
    // the handle's LOW u16, which the old scheme dropped so every sub collapsed
    // to one tag. Keep a stable distinct directory per (idx, sub) in the
    // synthetic range the probe already reserves for stubs.
    const key = ((idx << 16) | sub) >>> 0;
    let dir = dirByKey.get(key);
    if (dir === undefined) {
      dir = (0x0fd00000 + dirByKey.size * 0x10) >>> 0;
      dirByKey.set(key, dir);
      packIndexByDir.set(dir, idx);
      packSlotByDir.set(dir, sub);
    }
    return dir;
  });

  // ── coverage instrumentation ──
  const ring = new Int32Array(opts.ringSize ?? 8_000_000);
  rt.cpu.traceRing = ring;
  const cpuState = rt.cpu as unknown as { tracePos: number };
  cpuState.tracePos = 0;
  const executed = new Map<number, { fn: FnDesc; hits: number; firstFrame: number }>();
  const residentExecuted = new Map<number, { fn: FnDesc; hits: number; firstFrame: number }>();
  const unmapped = new Map<number, { hits: number; firstFrame: number }>();
  let ringOverflow = false;
  const bump = <T extends { hits: number; firstFrame: number }>(map: Map<number, T>, key: number, make: () => T, frame: number): void => {
    const rec = map.get(key);
    if (rec) {
      rec.hits++;
      if (frame < 0) rec.firstFrame = -1;
    } else {
      const fresh = make();
      fresh.hits = 1;
      fresh.firstFrame = frame;
      map.set(key, fresh);
    }
  };
  const drain = (frame: number): void => {
    const pos = cpuState.tracePos;
    const n = Math.min(pos, ring.length);
    if (pos > ring.length) ringOverflow = true;
    for (let i = 0; i < n; i++) {
      const pc = ring[i]! >>> 0;
      if (pc >= base && pc < overlayEnd) {
        const f = fnAt(localIndex, pc);
        if (f) bump(executed, f.address, () => ({ fn: f, hits: 0, firstFrame: frame }), frame);
        else bump(unmapped, pc, () => ({ hits: 0, firstFrame: frame }), frame);
      } else if (residentBase !== 0 && pc >= residentBase && pc < residentEnd) {
        const f = fnAt(residentIndex, pc);
        if (f) bump(residentExecuted, f.address, () => ({ fn: f, hits: 0, firstFrame: frame }), frame);
      }
    }
    cpuState.tracePos = 0;
  };

  if (opts.debugCache && exe) {
    const stubs = (rt.cpu as unknown as { stubs: Map<number, (c: never) => number> }).stubs;
    const orig = stubs.get(0x80013914)!;
    let calls = 0;
    rt.cpu.setStub(0x80013914, (c) => {
      calls++;
      if (calls <= 5) {
        const slots: string[] = [];
        for (let i = 0; i < 0x40; i++) {
          const s = 0x80044b3c + i * 0x10;
          const st = rt.mem.read16(s);
          if (st !== 0) slots.push(`slot${i} st=${st} id=${rt.mem.read32(s + 4)} buf=0x${(rt.mem.read32(s + 0xc) >>> 0).toString(16)}`);
        }
        console.log(
          `transfer call ${calls}: a0=0x${u32(c.reg(4)).toString(16)} a3=0x${u32(c.reg(7)).toString(16)} ` +
            `flag=${rt.mem.read32(0x80044b38)} slots=[${slots.join(", ")}]`,
        );
      }
      return orig(c as never);
    });
  }

  // Real bank bytes for the resident cache service: id -> start sector and
  // sector count come from the EXE data tables the native code itself reads.
  let bankReads = 0;
  let bankBytes = 0;
  const bankIds = new Set<number>();
  if (exe && discFd !== null) {
    host.readBank = (id, dest, bytes) => {
      bankIds.add(id >>> 0);
      const lba = rt.mem.read32(0x80044f6c + id * 4) >>> 0;
      if (lba === 0) return;
      bankReads++;
      bankBytes += bytes;
      const data = readSectors(discFd, lba, bytes);
      for (let i = 0; i < bytes; i++) rt.mem.write8(dest + i, data[i] as number);
    };
  }

  // ── external boundary targets ──
  const externalCalls = new Map<number, { from: Set<number>; count: number }>();
  const callJournal: { from: number; to: number }[] = [];
  rt.cpu.onCall = (callerPc, target) => {
    const t = target >>> 0;
    if (t >= base && t < overlayEnd) return;
    const rec = externalCalls.get(t) ?? { from: new Set<number>(), count: 0 };
    rec.from.add(callerPc >>> 0);
    rec.count++;
    externalCalls.set(t, rec);
    callJournal.push({ from: callerPc >>> 0, to: t });
    if (callJournal.length > 64) callJournal.shift();
    const watch = num(process.argv[process.argv.indexOf("--watch") + 1]);
    if (process.argv.includes("--watch") && (callerPc >>> 0) === watch) {
      console.log(
        `[watch] caller=0x${u32(callerPc).toString(16)} target=0x${t.toString(16)} ` +
          `v0=0x${u32(rt.cpu.reg(2)).toString(16)} mem@0x80055c48=0x${u32(rt.mem.read32(0x80055c48)).toString(16)} ` +
            `code@0x80099d80=0x${u32(rt.mem.read32(0x80099d80)).toString(16)} code@0x80099d7c=0x${u32(rt.mem.read32(0x80099d7c)).toString(16)}`,
      );
    }
  };

  const dbg = !!process.env.DW3_DEBUG;
  const rd80 = (): string => `0x80099d80=0x${u32(rt.mem.read32(0x80099d80)).toString(16)} 0x80099d7c=0x${u32(rt.mem.read32(0x80099d7c)).toString(16)}`;
  if (dbg) {
    console.log(`dbg preboot ${rd80()}`);
    const w32 = rt.mem.write32.bind(rt.mem);
    const w16 = rt.mem.write16.bind(rt.mem);
    const w8 = rt.mem.write8.bind(rt.mem);
    (rt.mem as unknown as { write32: (a: number, v: number) => void }).write32 = (a, v) => {
      if ((a >>> 0) === 0x80099d80) {
        const tp = cpuState.tracePos;
        const last: string[] = [];
        for (let i = 6; i >= 1; i--) last.push(`0x${u32(ring[(tp - i + ring.length) % ring.length]).toString(16)}`);
        console.log(`dbg WRITE32 0x80099d80 = 0x${(v >>> 0).toString(16)} recent=[${last.join(" ")}]`);
      }
      w32(a, v);
    };
    (rt.mem as unknown as { write16: (a: number, v: number) => void }).write16 = (a, v) => {
      if ((a >>> 0) === 0x80099d80) console.log(`dbg WRITE16 0x80099d80 = 0x${(v >>> 0).toString(16)}`);
      w16(a, v);
    };
    (rt.mem as unknown as { write8: (a: number, v: number) => void }).write8 = (a, v) => {
      if ((a >>> 0) >= 0x80099d80 && (a >>> 0) <= 0x80099d83) console.log(`dbg WRITE8 0x${(a >>> 0).toString(16)} = 0x${(v >>> 0).toString(16)}`);
      w8(a, v);
    };
  }
  let hostStubs = new Set<number>();
  // Mixed-mode bridge: install before boot so constructor-time calls to bridged
  // functions are replaced too. The invocation counters are snapshotted to give
  // this run's own counts (the module counters accumulate across --all runs).
  const invBefore = bridge ? new Map(bridgeInvocations()) : null;
  let currentFrame = -1;
  if (bridge) {
    const onlyEnv = process.env.DW3_BRIDGE_ONLY;
    const only = onlyEnv
      ? new Set(onlyEnv.split(",").map((s) => Number.parseInt(s.trim(), 16) >>> 0))
      : null;
    installTranslationBridge(rt.cpu, rt.mem, [spec.module], only, rt.services);
    if (process.env.DW3_DUMP_BRIDGE) {
      setBridgeProbe((entry, c, ret) => {
        console.log(
          `BRIDGE f${currentFrame} ${entry.module}:${entry.name} ra=0x${(c.reg(31) >>> 0).toString(16)} ` +
            `a0=0x${(c.reg(4) >>> 0).toString(16)} a1=0x${(c.reg(5) >>> 0).toString(16)} ` +
            `a2=0x${(c.reg(6) >>> 0).toString(16)} a3=0x${(c.reg(7) >>> 0).toString(16)} ` +
            `ret=0x${(ret >>> 0).toString(16)} v1=0x${(c.reg(3) >>> 0).toString(16)}`,
        );
      });
    }
  }
  if (process.env.DW3_DUMP_WRITES) {
    const [lo, hi] = process.env.DW3_DUMP_WRITES.split(":").map((s) => Number.parseInt(s, 16) >>> 0);
    const m = rt.mem as unknown as Record<string, (a: number, v: number) => void>;
    for (const method of ["write8", "write16", "write32"]) {
      const orig = m[method].bind(rt.mem);
      m[method] = (addr: number, v: number) => {
        if ((addr >>> 0) >= lo && (addr >>> 0) < hi) {
          console.log(`W ${method} 0x${(addr >>> 0).toString(16)} ${v} ra=0x${(rt.cpu.reg(31) >>> 0).toString(16)} sp=0x${(rt.cpu.reg(29) >>> 0).toString(16)}`);
        }
        orig(addr, v);
      };
    }
  }
  const booted = rt.boot();
  if (dbg) console.log(`dbg postboot ${rd80()}`);
  let bootTrap: string | null = null;
  if (!booted) bootTrap = rt.bootTrap?.reason ?? "unknown";
  drain(-1);
  const ringDump: string[] = [];

  const traps: ScreenTrap[] = [];
  const trapSnapshots = new Map<string, string[]>();
  let drawIntents = 0;
  let drawHash = FNV_OFFSET;
  let quadHash = FNV_OFFSET;
  const drawMethods: Record<string, number> = {};
  const drawIds = new Set<number>();
  const drawDirs: Record<string, number> = {};
  const drawDirsAll = new Set<number>();
  const drawSample: { method: string; args: number[] }[] = [];
  if (booted) {
    // Iterate: tick a frame, record every fail-soft trap, install a return-zero
    // stub there, clear the object's dead flag, and tick again. Each pass walks
    // one missing service deeper into the screen.
    const dead = rt as unknown as { deadCbs: Set<number> };
    const rawCall = rt.cpu.call.bind(rt.cpu) as (addr: number, args: number[], budget?: number) => number;
    (rt.cpu as unknown as { call: typeof rawCall }).call = (addr, callArgs, budget) => {
      try {
        return rawCall(addr, callArgs, budget);
      } catch (e) {
        if (e instanceof NativeTrap) {
          // Snapshot the ring AT THE TRAP SITE, once per distinct site - the ring
          // is overwritten by the next object callback, so the post-frame
          // `disabled` list cannot reconstruct it.
          const key = `pc=0x${u32(e.pc).toString(16)} ${e.message}`;
          if (!trapSnapshots.has(key)) {
            const w = cpuState.tracePos;
            const start = (w - 48 + ring.length) % ring.length;
            const pcs: string[] = [];
            for (let i = 0; i < 48; i++) pcs.push(`0x${u32(ring[(start + i) % ring.length]).toString(16)}`);
            const calls = callJournal
              .slice(-14)
              .map((c) => `${resolveWithOffset(c.from)} -> ${resolveWithOffset(c.to)}`);
            const lines = [
              `trap pc=0x${u32(e.pc).toString(16)} ra=0x${u32(rt.cpu.reg(31)).toString(16)}`,
              `  ring: ${pcs.join(" -> ")}`,
              `  last calls: ${calls.join(" | ")}`,
              `  mem: 0x80055c48=0x${(rt.mem.read32(0x80055c48) >>> 0).toString(16)} ` +
                `0x8009b5d8=0x${(rt.mem.read32(0x8009b5d8) >>> 0).toString(16)} ` +
                `0x800a31b8(word@0x8009af68+0x250?)=0x0 ` +
                `ra@sp? n/a`,
            ];
            trapSnapshots.set(key, lines);
            if (ringDump.length === 0) ringDump.push(...lines);
          }
        }
        throw e;
      }
    };
    // Host-served addresses by design (before the tick loop adds the per-trap
    // recovery stubs): the coverage report marks these host-served and the rest
    // native (the Phase 4 translation queue). Bridge stubs are not host
    // services: their functions are `replaced`, so remove them from this set.
    hostStubs = new Set(rt.cpu.stubAddresses());
    if (bridge) for (const addr of bridgeAddresses([spec.module])) hostStubs.delete(addr);
    for (let f = 0; f < frames; f++) {
      currentFrame = f;
      if (interact && f >= idleFrames) rt.setPadHeld(0, interactionPad(f - idleFrames));
      const before = rt.disabled.length;
      if (dbg && f < 6) console.log(`dbg frame${f} pre ${rd80()}`);
      rt.drawCalls.length = 0;
      rt.ctxMarkers.length = 0;
      rt.tick(1);
      drawIntents += rt.drawCalls.length;
      for (const c of rt.drawCalls) {
        if (process.env.DW3_DUMP_DRAW) console.log(`DRAW f${f} ${c.method}(${c.args.join(",")})`);
        // Fold every intent into the order-sensitive hash the differential
        // bridge check compares (method name then each argument word).
        for (let i = 0; i < c.method.length; i++) drawHash = fnvByte(drawHash, c.method.charCodeAt(i));
        for (const arg of c.args) drawHash = fnvWord(drawHash, arg >>> 0);
        drawMethods[c.method] = (drawMethods[c.method] ?? 0) + 1;
        if (c.method === "drawSprite") {
          drawIds.add(c.args[1] >>> 0);
          drawDirs[String(c.args[1] >>> 0)] = c.args[0] >>> 0;
          drawDirsAll.add(c.args[0] >>> 0);
        }
        if (drawSample.length < 120) drawSample.push({ method: c.method, args: [...c.args] });
      }
      // Captured textured quads are a per-frame host-side side effect of
      // SET_DE30; hash them once per frame so the differential check covers
      // them without folding in the frame's draw-call count.
      for (const q of rt.screenQuads) {
        quadHash = fnvWord(quadHash, q.cmd);
        quadHash = fnvWord(quadHash, ((q.x[0] & 0xffff) << 16) | (q.y[0] & 0xffff));
        quadHash = fnvWord(quadHash, ((q.u[0] & 0xff) << 24) | ((q.v[0] & 0xff) << 16) | (q.texpage & 0xffff));
        quadHash = fnvWord(quadHash, ((q.clut & 0xffff) << 16) | (q.x[1] & 0xffff));
      }
      drain(f);
      for (const d of rt.disabled.slice(before)) {
        traps.push({ count: 1, pc: u32(d.pc), cb: u32(d.cb), reason: d.reason });
        if (u32(d.pc) !== 0) rt.cpu.setStub(u32(d.pc), () => 0);
      }
      if (rt.disabled.length > before) {
        rt.disabled.length = 0;
        dead.deadCbs.clear();
      }
    }
  }
  // Merge repeated traps into one row per site.
  const mergedTraps = new Map<string, ScreenTrap>();
  for (const t of traps) {
    const key = `pc=0x${t.pc.toString(16)} cb=0x${t.cb.toString(16)} ${t.reason}`;
    const rec = mergedTraps.get(key);
    if (rec) rec.count++;
    else mergedTraps.set(key, { ...t });
  }

  const boundary: ExternalTarget[] = [...externalCalls.entries()]
    .map(([address, rec]) => {
      let kind = "external-stub";
      if (address === 0) kind = "null";
      else if (exe && address >= residentBase && address < residentEnd) kind = "resident";
      else if (address >= 0x0fd00000 && address < 0x0fe00000) kind = "synthetic-stub";
      return {
        address,
        count: rec.count,
        kind,
        name: resolveWithOffset(address),
        callers: [...rec.from].map(resolveWithOffset).sort(),
        status: isTranslated("exe/fns", address)
          ? "translated"
          : hostStubs.has(address)
            ? "host-served"
            : "native",
      };
    })
    .sort((a, b) => a.address - b.address);

  const toExecuted = (map: Map<number, { fn: FnDesc; hits: number; firstFrame: number }>): ExecutedFn[] =>
    [...map.values()]
      .map((r) => ({
        address: r.fn.address,
        module: r.fn.module,
        name: r.fn.name,
        hits: r.hits,
        firstFrame: r.firstFrame,
        status: bridge && isBridged(r.fn.module, u32(r.fn.address))
          ? ("replaced" as const)
          : isTranslated(r.fn.module, u32(r.fn.address))
            ? ("translated" as const)
            : hostStubs.has(u32(r.fn.address))
              ? ("host-served" as const)
              : ("native" as const),
      }))
      .sort((a, b) => a.address - b.address);
  const toUnmapped = (map: Map<number, { hits: number; firstFrame: number }>): ScreenRun["unmapped"] =>
    [...map.entries()]
      .map(([address, r]) => ({ address, hits: r.hits, firstFrame: r.firstFrame, status: "inline" as const }))
      .sort((a, b) => a.address - b.address);

  if (discFd !== null) closeSync(discFd);

  // Differential bridge proof state: the full 2MB address space and the ordered
  // draw-intent stream after the run. A bridge-off and bridge-on run of the same
  // root must hash identically (tests/native-bridge.test.js,
  // tools/verify_native_bridge.ts).
  // Memory proof: FNV over the whole live address space. The interpreter's
  // stack scratch below its initial $sp (0x801ffcf0) is excluded — after the
  // run every frame is unwound, so that region holds only dead residue whose
  // bytes depend on which callback happened to be innermost last, not on
  // observable state. `memHashFull` keeps the all-bytes hash for diagnostics;
  // the differential gate is `memHash`.
  const STACK_TOP = 0x801ffcf0;
  const STACK_SCRATCH_FLOOR = 0x801f0000;
  const RAM_BASE = 0x80000000;
  let memHash = FNV_OFFSET;
  let memHashFull = FNV_OFFSET;
  {
    const bytes = rt.mem.bytes;
    for (let i = 0; i < bytes.length; i += 4) {
      const word =
        ((bytes[i] as number) | ((bytes[i + 1] as number) << 8) | ((bytes[i + 2] as number) << 16) | ((bytes[i + 3] as number) << 24)) >>> 0;
      memHashFull = fnvWord(memHashFull, word);
      const addr = (RAM_BASE + i) >>> 0;
      if (addr >= STACK_SCRATCH_FLOOR && addr < STACK_TOP) continue;
      memHash = fnvWord(memHash, word);
    }
  }
  const bridged: ScreenRun["bridged"] = [];
  if (bridge && invBefore) {
    for (const [k, count] of bridgeInvocations()) {
      const delta = count - (invBefore.get(k) ?? 0);
      if (delta <= 0) continue;
      const [mod, addrHex] = k.split(":");
      const addr = Number.parseInt(addrHex as string, 16) >>> 0;
      bridged.push({ module: mod as string, address: addr, name: resolveWithOffset(addr), invocations: delta });
    }
    bridged.sort((x, y) => x.address - y.address);
    // A fully replaced function has no pc inside its partition any more, so it
    // would vanish from the executed set. Re-add each invoked bridge entry with
    // hits 0; the zero is the proof the original MIPS body never ran.
    for (const b of bridged) {
      const isResident = b.module === "exe/fns";
      const fn = fnAt(isResident ? residentIndex : localIndex, b.address);
      if (fn === undefined) continue;
      const map = isResident ? residentExecuted : executed;
      if (!map.has(b.address)) map.set(b.address, { fn, hits: 0, firstFrame: -1 });
    }
  }

  return {
    module: moduleId,
    sounds: [...rt.sfx],
    actor: spec.actor ?? null,
    base,
    ctor: spec.ctor,
    tick: spec.tick,
    imageBytes: image.length,
    booted,
    bootTrap,
    frames: booted ? frames : 0,
    interactionFrames: booted ? interactionFrames : 0,
    bridged,
    memHash: memHash.toString(16),
    memHashFull: memHashFull.toString(16),
    drawHash: drawHash.toString(16),
    quadHash: quadHash.toString(16),
    mem: opts.keepMemory === true ? rt.mem : undefined,
    objects: rt.world.objects.length,
    bankReads,
    bankBytes,
    bankIds: [...bankIds].sort((a, b) => a - b),
    drawIntents,
    drawMethods,
    drawIds: [...drawIds].sort((a, b) => a - b),
    drawDirs,
    drawDirsAll: [...drawDirsAll].sort((a, b) => a - b),
    packDirIndex: Object.fromEntries([...packIndexByDir.entries()].map(([dir, idx]) => [String(dir), idx])),
    packDirSlot: Object.fromEntries([...packSlotByDir.entries()].map(([dir, sub]) => [String(dir), sub])),
    drawSample,
    executed: toExecuted(executed),
    residentExecuted: toExecuted(residentExecuted),
    unmapped: toUnmapped(unmapped),
    boundary,
    traps: [...mergedTraps.values()].sort((a, b) => b.count - a.count),
    ringOverflow,
    ringDump,
    trapTrace: Object.fromEntries(trapSnapshots),
    imageSha256: createHash("sha256").update(image).digest("hex").slice(0, 16),
  };
}

// ── single-root console output ───────────────────────────────────────────────
function printRun(run: ScreenRun): void {
  console.log(`module=${run.module} base=0x${run.base.toString(16)} image=0x${run.imageBytes.toString(16)} bytes`);
  console.log(`ctor=0x${run.ctor.toString(16)} tick=0x${run.tick.toString(16)} booted=${run.booted}`);
  if (!run.booted) console.log(`boot trap: ${run.bootTrap}`);
  console.log(`objects allocated=${run.objects} bank reads=${run.bankReads} (${run.bankBytes} bytes)`);
  console.log(`\n## executed overlay functions (${run.executed.length})`);
  for (const f of run.executed) console.log(`  x${f.hits.toString().padStart(6)}  ${f.name}  (${f.module}:0x${f.address.toString(16)})`);
  console.log(`\n## executed resident EXE functions (${run.residentExecuted.length})`);
  for (const f of run.residentExecuted) console.log(`  x${f.hits.toString().padStart(6)}  exe/fns:${f.name}  (0x${f.address.toString(16)})`);
  if (run.unmapped.length) {
    console.log(`\n## executed PCs with no indexed function (${run.unmapped.length})`);
    for (const p of run.unmapped.slice(0, 40)) console.log(`  0x${p.address.toString(16)} x${p.hits}`);
  }
  console.log(`\n## trapped callbacks (${run.traps.length})`);
  for (const t of run.traps) console.log(`  x${t.count}  pc=0x${t.pc.toString(16)} cb=0x${t.cb.toString(16)} ${t.reason}`);
  console.log(`\n## external call targets (${run.boundary.length})`);
  for (const b of run.boundary) {
    console.log(
      `  0x${b.address.toString(16).padStart(8, "0")} x${b.count.toString().padStart(4)}  [${b.kind}] ${b.name}   <- ${b.callers.slice(0, 3).join(", ")}`,
    );
  }
  console.log(`\n## draw intents recorded (${run.drawIntents})`);
  console.log(`  methods: ${JSON.stringify(run.drawMethods)}`);
  console.log(`  drawSprite ids: [${run.drawIds.join(",")}]`);
  for (const id of run.drawIds) {
    const dir = run.drawDirs[String(id)]!;
    console.log(`    id ${id} dir=0x${dir.toString(16)}`);
  }
  for (const d of run.drawSample.slice(0, 40)) console.log(`  ${d.method}(${d.args.map((a) => a.toString()).join(", ")})`);
  if (run.ringDump.length) console.log(run.ringDump.join("\n"));
  for (const [key, lines] of Object.entries(run.trapTrace)) {
    if (lines === run.ringDump) continue;
    console.log(`\n## trap trace ${key}\n${lines.join("\n")}`);
  }
  console.log(`image sha256 ${run.imageSha256}`);
  console.log(`memHash=${run.memHash} drawHash=${run.drawHash} quadHash=${run.quadHash}`);
  if (run.bridged.length) {
    console.log(`\n## mixed-mode bridge (${run.bridged.length} entries, ${run.bridged.reduce((n, b) => n + b.invocations, 0)} invocations)`);
    for (const b of run.bridged) console.log(`  x${b.invocations.toString().padStart(7)}  ${b.module}:${b.name}  (0x${b.address.toString(16)})`);
  }
}

// ── Phase 0: coverage report over every root ─────────────────────────────────
export interface CoverageSummary {
  roots_total: number;
  roots_booted: number;
  overlay_functions_executed: number;
  resident_functions_executed: number;
  boundary_targets: number;
  unmapped_pcs: number;
  traps: number;
  /** Distinct external boundary targets answered by a host stub. */
  host_served_boundaries: number;
  /** Distinct external boundary targets that run as original code. */
  native_boundaries: number;
  /** Distinct executed functions that run as original MIPS in engine/native
   *  (the Phase 4 translation queue). */
  translation_queue: number;
  /** Distinct executed functions already ported to engine/dw3 with an oracle test. */
  translated_functions: number;
  /** Distinct executed functions whose port ran in place of the MIPS body
   *  (mixed-mode bridge installed for this run). */
  replaced_functions: number;
  /** Distinct executed functions that have a port but no bridge entry yet:
   *  translated-but-still-native, with the per-address reason in BRIDGE_BLOCKERS. */
  translated_not_replaced: number;
  /** Total bridge invocations across all roots in this run. */
  bridge_invocations: number;
}

export function summarize(runs: ScreenRun[]): CoverageSummary {
  const overlay = new Set<string>();
  const resident = new Set<string>();
  const boundary = new Set<number>();
  const fnStatus = new Map<string, ExecStatus>();
  let unmapped = 0;
  let traps = 0;
  let bridgeInvocations = 0;
  for (const r of runs) {
    for (const f of r.executed) {
      overlay.add(`${f.module}:${f.address}`);
      fnStatus.set(`overlay:${f.address}`, f.status);
    }
    for (const f of r.residentExecuted) {
      resident.add(`exe/fns:${f.address}`);
      fnStatus.set(`resident:${f.address}`, f.status);
    }
    for (const b of r.boundary) boundary.add(b.address);
    unmapped += r.unmapped.length;
    traps += r.traps.reduce((n, t) => n + t.count, 0);
    bridgeInvocations += r.bridged.reduce((n, b) => n + b.invocations, 0);
  }
  const statuses = [...fnStatus.values()];
  const hostBoundaries = new Set<number>();
  const nativeBoundaries = new Set<number>();
  for (const r of runs) {
    for (const b of r.boundary) (b.status === "host-served" ? hostBoundaries : nativeBoundaries).add(b.address);
  }
  return {
    roots_total: runs.length,
    roots_booted: runs.filter((r) => r.booted).length,
    overlay_functions_executed: overlay.size,
    resident_functions_executed: resident.size,
    boundary_targets: boundary.size,
    unmapped_pcs: unmapped,
    traps,
    host_served_boundaries: hostBoundaries.size,
    native_boundaries: nativeBoundaries.size,
    translation_queue: statuses.filter((s) => s === "native").length,
    translated_functions: statuses.filter((s) => s === "translated").length,
    replaced_functions: statuses.filter((s) => s === "replaced").length,
    translated_not_replaced: statuses.filter((s) => s === "translated").length,
    bridge_invocations: bridgeInvocations,
  };
}

export function markdown(runs: ScreenRun[], command: string, frames: number, interactionFrames = 0): string {
  const s = summarize(runs);
  const lines: string[] = [];
  lines.push("---");
  lines.push(
    "reach: Selecting the Phase 0 translation/host-service queue for the native screen port — which original functions actually execute per screen root and every external boundary target it calls.",
  );
  lines.push("status: generated");
  lines.push("---");
  lines.push("");
  lines.push("# Native screen coverage — executed functions and boundary targets");
  lines.push("");
  lines.push(`> Generated by \`${command}\`.`);
  lines.push("> Do not edit by hand; fix the probe (tools/native_screen_probe.ts).");
  lines.push("");
  lines.push(
    `Each root boots its real constructor from the decomp image under engine/native, with the resident EXE image loaded from the disc, then ticks ${frames} idle frames` +
      (interactionFrames > 0
        ? `, then ${interactionFrames} frames of scripted pad taps (Down, Down, Right, Cross, Circle, Up, Left, Cross; 2-frame hold, 14-frame release). `
        : ". ") +
      "`hits` counts executed instructions attributed to the containing function (pointer candidates and curated semantic names are folded into the function partition). " +
      "Boundary rows are calls that leave the overlay image; `resident` rows run original EXE code under the interpreter, the other kinds need a host service or a stub.",
  );
  lines.push("");
  lines.push("Each executed function carries a `status`: `host-served` when a runtime/interpreter stub answers it (engine/native host services, listed in `resident-screen-services.md`), `replaced` when the mixed-mode bridge ran its engine/dw3 port instead of the shipped MIPS body (`--bridge`), `translated` when the port exists with an oracle test but the bridge is not installed (or not bridgeable yet), `native` when the original MIPS runs in engine/native from the shipped image. The `native` set is the Phase 4 translation queue; a pc outside every partition range would be a function-extent gap (see below), not an `inline` status.");
  lines.push(
    interactionFrames > 0
      ? "Method and limits: the interaction phase drives the host pad service (engine/native/runtime.ts) on one deterministic schedule; it samples normal play, not an enumeration. The boot-plus-idle pass is a floor and every later authentic interaction can extend the queue, so a re-run must never shrink the accounted set."
      : "Method and limits: the host pad service exists (engine/native/runtime.ts) but is not driven in this idle run, so each root is boot plus idle ticks (no button press); run with `--interact` for the pad interaction phase, and note that any later authentic interaction can only add functions.",
  );
  lines.push("A function counts as executed when any executed pc falls in its partition range, so `hits` is instruction count, not call count.");
  lines.push("A nonempty `unmapped` list means a real function-extent gap: an executed pc outside every partition range (the inventory's `provisional_end_address` is inclusive and the probe converts it to an exclusive bound, so the last instruction of each routine is attributed; audit 2026-09-15). The list should therefore be empty, and any row is either a routine the index missed or an m2c-truncated tail, for the next decode pass.");
  lines.push("The report is a floor, not a ceiling: an interaction phase can only add functions to the queue.");
  lines.push("Boundary names are recovered-inventory semantic names, not ledger names; two are known to conflict with the ledger (0x80013914, 0x8001b04c). The claim-level contract of every resident screen service is in .dw3-research/bulk-port-plan-2026-09-14/resident-screen-services.md.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- roots: ${s.roots_total} (booted ${s.roots_booted})`);
  lines.push(`- distinct overlay functions executed: ${s.overlay_functions_executed}`);
  lines.push(`- distinct resident EXE functions executed: ${s.resident_functions_executed}`);
  lines.push(`- distinct external boundary targets: ${s.boundary_targets}`);
  lines.push(`- executed PCs with no indexed function: ${s.unmapped_pcs}`);
  lines.push(`- external boundary targets host-served: ${s.host_served_boundaries}`);
  lines.push(`- external boundary targets native: ${s.native_boundaries}`);
  lines.push(`- executed functions translated to engine/dw3 with an oracle test: ${s.translated_functions}`);
  lines.push(`- executed functions replaced by the TS bridge (this run): ${s.replaced_functions} (${s.bridge_invocations} invocations)`);
  lines.push(`- translated but not bridgeable yet (falls back to native): ${s.translated_not_replaced}`);
  lines.push(`- executed functions native (Phase 4 translation queue): ${s.translation_queue}`);
  if (interactionFrames > 0) lines.push(`- interaction frames per root: ${interactionFrames}`);
  lines.push(`- trapped callbacks (all frames, merged sites): ${s.traps}`);
  lines.push("");
  lines.push("## Per root");
  lines.push("");
  lines.push("| module | actor | boot | objects | bank reads | draw intents | overlay fns | resident fns | boundary | unmapped | traps |");
  lines.push("|---|---|:--:|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const r of runs) {
    lines.push(
      `| \`${r.module}\` | ${r.actor ?? ""} | ${r.booted ? "yes" : "no"} | ${r.objects} | ${r.bankReads} | ${r.drawIntents} | ${r.executed.length} | ${r.residentExecuted.length} | ${r.boundary.length} | ${r.unmapped.length} | ${r.traps.reduce((n, t) => n + t.count, 0)} |`,
    );
  }
  lines.push("");
  for (const r of runs) {
    if (r.booted) continue;
    lines.push(`- \`${r.module}\` did not boot: ${r.bootTrap}`);
  }
  lines.push("");
  // union of executed overlay functions
  const overlay = new Map<string, { module: string; name: string; address: number; roots: Set<string>; hits: number; status: string }>();
  for (const r of runs) {
    for (const f of r.executed) {
      const key = `${f.module}:${f.address}`;
      const rec = overlay.get(key) ?? { module: f.module, name: f.name, address: f.address, roots: new Set<string>(), hits: 0, status: f.status };
      rec.roots.add(r.module);
      rec.hits += f.hits;
      overlay.set(key, rec);
    }
  }
  lines.push("## Union of executed overlay functions (translation queue)");
  lines.push("");
  lines.push("| module | function | address | status | roots | hits |");
  lines.push("|---|---|---|:--:|--:|--:|");
  const overlayRows = [...overlay.values()].sort((a, b) => (a.module === b.module ? a.address - b.address : a.module < b.module ? -1 : 1));
  for (const f of overlayRows) {
    lines.push(`| \`${f.module}\` | \`${f.name}\` | 0x${f.address.toString(16)} | ${f.status} | ${f.roots.size} | ${f.hits} |`);
  }
  lines.push("");
  // union of resident functions
  const resident = new Map<number, { name: string; roots: Set<string>; hits: number; status: string }>();
  for (const r of runs) {
    for (const f of r.residentExecuted) {
      const rec = resident.get(f.address) ?? { name: f.name, roots: new Set<string>(), hits: 0, status: f.status };
      rec.roots.add(r.module);
      rec.hits += f.hits;
      resident.set(f.address, rec);
    }
  }
  lines.push("## Executed resident EXE functions");
  lines.push("");
  lines.push("| function | address | status | roots | hits |");
  lines.push("|---|---|:--:|--:|--:|");
  for (const [address, f] of [...resident.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(`| \`exe/fns:${f.name}\` | 0x${address.toString(16)} | ${f.status} | ${f.roots.size} | ${f.hits} |`);
  }
  lines.push("");
  // boundary union (address 0 kept: the null function-pointer call is a real gap)
  const boundary = new Map<number, { kind: string; name: string; roots: Set<string>; count: number; callers: Set<string> }>();
  for (const r of runs) {
    for (const b of r.boundary) {
      const rec = boundary.get(b.address) ?? { kind: b.kind, name: b.name, roots: new Set<string>(), count: 0, callers: new Set<string>() };
      rec.roots.add(r.module);
      rec.count += b.count;
      for (const c of b.callers) rec.callers.add(c);
      boundary.set(b.address, rec);
    }
  }
  lines.push("## External boundary targets");
  lines.push("");
  lines.push("| target | kind | name | roots | calls | callers |");
  lines.push("|---|---|---|--:|--:|---|");
  for (const [address, b] of [...boundary.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(
      `| 0x${address.toString(16)} | ${b.kind} | \`${b.name}\` | ${b.roots.size} | ${b.count} | ${[...b.callers].slice(0, 3).join(", ")} |`,
    );
  }
  lines.push("");
  const unmapped = runs.filter((r) => r.unmapped.length);
  if (unmapped.length) {
    lines.push("## Executed PCs in a function-extent gap (empty = no unindexed executed routine)");
    lines.push("");
    lines.push("Every pc here executes but falls outside every partition range, so it is either a routine the index missed or an m2c-truncated tail. It is NOT a call target by construction: the inventory's provisional end is inclusive and the probe converts it, so the last instruction of each routine is already attributed.");
    lines.push("");
    for (const r of unmapped) {
      lines.push(`- \`${r.module}\` (${r.unmapped.length}): ${r.unmapped.slice(0, 12).map((p) => `0x${p.address.toString(16)}`).join(", ")}`);
    }
    lines.push("");
  }
  lines.push("## Trapped callbacks");
  lines.push("");
  if (!s.traps) {
    lines.push("None.");
  } else {
    for (const r of runs) {
      for (const t of r.traps) {
        lines.push(`- \`${r.module}\` x${t.count} pc=0x${t.pc.toString(16)} cb=0x${t.cb.toString(16)} ${t.reason}`);
      }
    }
  }
  lines.push("");
  return lines.join("\n") + "\n";
}

// ── main ─────────────────────────────────────────────────────────────────────
function isMain(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const bankPlanPath = flag("--bank-plan");
  if (bankPlanPath) {
    // Machine-readable asset plan for tools/build_native_screens.py: which bank
    // ids each screen requests from the resident cache service, and which pack
    // directories it draws from (the resolver handle high u16 = LBA file index).
    const frames = num(flag("--frames")) ?? 20;
    const specs = loadSpecs(flag("--specs") ?? SPECS_PATH);
    const banks: Record<string, number[]> = {};
    const packs: Record<string, string[]> = {};
    for (const spec of specs) {
      const run = runScreen(spec, { frames, noExe: args.includes("--no-exe") });
      banks[spec.module] = run.bankIds;
      // Only directories that actually reached drawSprite matter for rendering
      // (the resolver also serves texture pages).
      const usedDirs = new Set(run.drawDirsAll.length ? run.drawDirsAll : Object.values(run.drawDirs));
      const packKeys = new Set<string>();
      for (const d of usedDirs) {
        const idx = run.packDirIndex[String(d)];
        if (idx === undefined) continue;
        const sub = run.packDirSlot[String(d)] ?? 0;
        packKeys.add(`${idx}:${sub}`);
      }
      packs[spec.module] = [...packKeys].sort((a, b) => {
        const [ai, as] = a.split(":").map(Number);
        const [bi, bs] = b.split(":").map(Number);
        return ai === bi ? (as as number) - (bs as number) : (ai as number) - (bi as number);
      });
      console.log(`${spec.module}: banks=[${run.bankIds.join(",")}] packs=[${packs[spec.module]!.join(",")}]`);
    }
    writeFileSync(bankPlanPath, JSON.stringify({ banks, packs }, null, 1) + "\n");
    console.log(`wrote ${bankPlanPath}`);
  } else if (args.includes("--all")) {
    const frames = num(flag("--frames")) ?? 20;
    const interact = args.includes("--interact");
    const bridge = args.includes("--bridge");
    const reportBase = flag("--report") ?? DEFAULT_REPORT_BASE;
    const specs = loadSpecs(flag("--specs") ?? SPECS_PATH);
    const runs: ScreenRun[] = [];
    for (const spec of specs) {
      const t0 = Date.now();
      const run = runScreen(spec, { frames, interact, bridge, noExe: args.includes("--no-exe"), ringSize: num(flag("--ring-size")) });
      runs.push(run);
      console.log(
        `${run.module}: boot=${run.booted ? "yes" : "no"} objects=${run.objects} overlayFns=${run.executed.length} residentFns=${run.residentExecuted.length} boundary=${run.boundary.length} traps=${run.traps.reduce((n, t) => n + t.count, 0)} (${Date.now() - t0}ms)`,
      );
    }
    const summary = summarize(runs);
    const command = `node tools/native_screen_probe.ts --all --frames ${frames}${interact ? " --interact" : ""}${bridge ? " --bridge" : ""}`;
    const json = {
      generated_by: "tools/native_screen_probe.ts",
      command,
      frames,
      interaction_frames: interact ? INTERACT_FRAMES : 0,
      generated_at: new Date().toISOString(),
      summary,
      roots: runs,
    };
    writeFileSync(`${reportBase}.json`, JSON.stringify(json, null, 1) + "\n");
    writeFileSync(`${reportBase}.md`, markdown(runs, command, frames, interact ? INTERACT_FRAMES : 0));
    console.log(`\n${JSON.stringify(summary)}`);
    console.log(`wrote ${reportBase}.json`);
    console.log(`wrote ${reportBase}.md`);
  } else {
    const moduleId = flag("--module") ?? "pro/stitshop";
    const ctorFlag = num(flag("--ctor"));
    const tickFlag = num(flag("--tick"));
    let spec = loadSpecs().find((s) => s.module === moduleId);
    if (!spec) {
      if (ctorFlag === undefined || tickFlag === undefined) {
        console.error(`no known ctor spec for ${moduleId}; pass --ctor and --tick`);
        process.exit(2);
      }
      spec = { module: moduleId, ctor: ctorFlag, tick: tickFlag };
    }
    if (ctorFlag !== undefined) spec.ctor = ctorFlag;
    if (tickFlag !== undefined) spec.tick = tickFlag;
    const frames = num(flag("--frames")) ?? 60;
    const run = runScreen(spec, {
      frames,
      interact: args.includes("--interact"),
      bridge: args.includes("--bridge"),
      noExe: args.includes("--no-exe"),
      debugCache: args.includes("--debug-cache"),
      ringSize: num(flag("--ring-size")),
    });
    printRun(run);
  }
}
