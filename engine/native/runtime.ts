// Production stage runtime for wstag native ambience code (P1/P2 of
// docs/specs/2026-07-04-wstag-native-interpreter-design.md).
//
// Boots a stage from decomp-extracted assets only (tools/build_native_overlays.py):
// the overlay image loads at 0x800A5DE0, the stub boundary replaces the EXE
// helpers, and the stage's own root constructor (manifest.root_ctor — the fn
// the game installs at descriptor+0x04) performs the authentic initial allocs
// through the interpreter. Per frame each live object's real callback runs
// under a cycle budget; any NativeTrap disables THAT object and is logged —
// the stage otherwise keeps playing (fail-soft guardrail from the spec).

import { NativeMemory } from "./memory.ts";
import { PackedSoundCursor } from "../systems/packed-sound.ts";
import {
    PAD_BLOCK,
    PAD_BUTTONS,
    PAD_BUTTON_MAP_IN_PORT,
    PAD_HELD,
    PAD_HELD_PREVIOUS,
    PAD_PORT_STRIDE,
    PAD_PRESSED,
    PAD_RECORD_BASE,
    PAD_REPEAT,
    PAD_SLOT_STRIDE,
    padButtonBit,
    padHeld,
    padPressed,
} from "../systems/pad-block.ts";
import { ScreenHeap, type HeapServices } from "./screen-heap.ts";
import { NativeTrap, R3000 } from "./mips.ts";
import { decodeRawPrims, type RawPrim } from "./raw-prims.ts";
import type { DrawCall, NativeHost, NativeObject } from "./stubs.ts";
import {
  A,
  destroyTrackedObject,
  installCoreStubs,
  installDrawStubs,
  isChildArray,
  OBJECT_LIFECYCLE_DEAD,
  StubWorld,
} from "./stubs.ts";
import { VramMap } from "./vram.ts";
import { installDevicePorts } from "./device-ports.ts";

export const OVERLAY_BASE = 0x800a5de0;

/** fieldstg (the resident field engine overlay): full image loaded so stage
 * code can read its static tables (effect registry, zonemgr, opcode tables)
 * and run its real helper code. */
export const FIELDSTG_BASE = 0x80082cb0;

/** Effect registry inside fieldstg: {id, construct_fn, draw_fn} × 56, static. */
export const EFFECT_REGISTRY = 0x8009b3e8;

/** Descriptor bank the init fns write (stage id at +0, tables at +0x8..+0x4c). */
export const DESCRIPTOR_BANK = 0x80099d80;

// ── additional decoded EXE helpers the overlays reach (spike table +
// s780-street-life doc). Globals are seeded with the real runtime target
// addresses; the targets are PC-hooked. ──
const CTX_FILL = 0x8001f648; // fills the 0xa0 stack draw-context (decoded)
const FRAME_DELTA_ALT = 0x8001d6f4; // return [0x8004de20] (delta twin of 0x8001d704)
const SET_DE30 = 0x8001d854; // trivial setter: [0x8004de30] = a0
const GET_DE30 = 0x8001d844; // getter of the same (current draw-target global)
const LAYER_LOOKUP = 0x8001da84; // render-layer registry: id → layer object (30 slots @0x8004de10)
const START_EVENT = 0x800853f8; // fieldstg start_event(event_id) — wstag-script-decode.md
const GETTER_48 = 0x80018854; // u16 [0x8004b7d0 + slot*448 + 0x48]
const GETTER_4E = 0x80018878; // u16 [... + 0x4e]
const GETTER_A4 = 0x80018980; // u8  [0x8004b7d0 + slot*448 + off + 0xa4]
const OBJ_LOOKUP = 0x8001810c; // object search (type 5 = player); P1-web wires it
const SFX_PLAY = 0x8002006c; // play-SFX packed id, cell [0x80055c48] (packed-sound.ts)
// Resident resource-service base lookup: bank id -> loaded file RAM base
// (resourceGetBase F0x80013E5C; receiver 0x80044B38 slot +0x414 = cell
// 0x80044F4C). The shop asks it for ESITMNAM (id 108) to fill item names.
const RESOURCE_GET_BASE = 0x80013e5c;
const RESOLVER = 0x800140d8; // handle → mapped pack sub pointer

const GLOBAL_SEEDS: ReadonlyArray<readonly [number, number]> = [
  [0x8004df68, GET_DE30],
  [0x8004df6c, SET_DE30],
  [0x8004df8c, LAYER_LOOKUP],
  [0x8004df98, FRAME_DELTA_ALT],
  [0x80044f5c, RESOLVER],
  [0x80044f4c, RESOURCE_GET_BASE],
  [0x8004b7bc, OBJ_LOOKUP],
  [0x8004bbc4, GETTER_48],
  [0x8004bbd8, GETTER_A4],
  [0x80055c48, SFX_PLAY],
];

// fieldstg API table (zonemgr) at 0x8009b6c4: +0x40 = load_texture(slot,id)
// (F0x800928cc, "API-register: apitable[a0]=a1" — wstag-script-decode.md),
// +0x50 = commit (F0x800928e4). Stage inits call these to request their packs.
const ZONEMGR = 0x8009b6c4;
const ZONEMGR_SET = 0x800928cc;
const ZONEMGR_COMMIT = 0x800928e4;

// EXE trig helpers (fns.s): quarter-wave i16 table, base 0x80056088 (the
// full table starts at 0x80055888 = base - 0x400 entries). The runtime loads
// the extracted table (exe_tables.json) into memory at the real address and
// these stubs replicate the exact index/negate logic.
const SIN_FN = 0x8002abcc; // signed arg; sin(a & 0xfff) with sign passthrough
const COS_FN = 0x8002ac9c; // |a| & 0xfff, phase-shifted table walk
const SIN_TABLE_BASE = 0x80056088;

// EXE sound-channel object ctor F0x8001ffa8: zeroes a 0x34 struct, installs
// method ptrs at +0x1c..+0x30, default volume 0xa800 at +0x18. Methods are
// recording stubs (the SFX side is already bridged via [0x80055c48]).
// libgpu LoadImage F0x80025B14: RECT* in a0, pixel pointer in a1. The browser
// serves it as the VRAM upload record (engine/native/vram.ts).
const LOAD_IMAGE = 0x80025b14;
// The card grant routine (sets the album's ever-obtained flag + copies held).
const GRANT_CARD = 0x80016e2c;
const SND_OBJ_CTOR = 0x8001ffa8;
const SND_METHOD_BASE = 0x0fd00000; // synthetic pc range for the 6 methods

// fieldstg F0x80089548: ambient point-table rebind — writes a0 to
// [0x8009b8fc] and the current point table ptr [0x80099d90] to [0x8009b8f8],
// then refreshes (0x800894d8). The two writes are modeled; the refresh is
// renderer-side and has no interpreter-visible state.
const POINT_REBIND = 0x80089548;

// Render-layer object method layout — decoded from the LIVE layer object
// (id 0x1002 at 0x800e1e7c, s780 rig dump f00, 2026-07-05; runtime pointer
// values are the sanctioned emulator use). The object is fieldstg's render
// runner: method slots interleaved with DATA fields the code writes freely
// (frame counters, scroll at +0x70/+0x74, ...) — so the synthetic object must
// only put pointers in the REAL method slots and leave the rest writable.
// Every distinct target below is pc-hooked; three have decoded semantics
// (getScroll +0x11c, setScroll +0x120, OT-bucket +0x138), the state-machine
// nine (+0x1dc..+0x200 = F0x80014274..F0x80014308) are already core stubs.
const LAYER_METHOD_SLOTS: ReadonlyArray<readonly [number, number]> = [
  [0x1c, 0x80017f6c], [0x30, 0x80029950], [0x34, 0x80017f6c], [0x38, 0x8001443c], [0x3c, 0x800334d4],
  [0x48, 0x8001d9dc], [0x54, 0x8001d810], [0x110, 0x8001e0b0], [0x114, 0x8001e0bc], [0x118, 0x8001e058],
  [0x11c, 0x8001e064], [0x120, 0x8001e088], [0x124, 0x8001e094], [0x128, 0x8001e0c8], [0x12c, 0x8001e028],
  [0x130, 0x8001de68], [0x134, 0x8001dda0], [0x138, 0x8001dfa8], [0x13c, 0x8001dfcc], [0x140, 0x8001dffc],
  [0x144, 0x8001e01c], [0x148, 0x8001e1e8], [0x14c, 0x8001e240], [0x150, 0x8001e324], [0x154, 0x8001e38c],
  [0x158, 0x8001e470], [0x15c, 0x8001e404], [0x160, 0x8001e55c], [0x164, 0x8001e4f4], [0x168, 0x8001e118],
  [0x1dc, 0x80014274], [0x1e0, 0x80014288], [0x1e4, 0x80014298], [0x1e8, 0x800142a4], [0x1ec, 0x800142ac],
  [0x1f0, 0x800142c8], [0x1f4, 0x800142e0], [0x1f8, 0x800142f4], [0x200, 0x80014308], [0x238, 0x80085f0c],
  [0x23c, 0x80085f38], [0x24c, 0x800839c4], [0x250, 0x80083b7c], [0x254, 0x80083b7c], [0x258, 0x800839d8],
  [0x25c, 0x800839ec], [0x260, 0x80083a00], [0x264, 0x80083a14], [0x268, 0x80083a28], [0x26c, 0x80083a3c],
  [0x270, 0x80083a50], [0x274, 0x80083a60], [0x278, 0x80083b7c], [0x27c, 0x80083b7c], [0x280, 0x80083b7c],
  [0x284, 0x80083b7c], [0x288, 0x80083a74], [0x28c, 0x80083a88], [0x290, 0x80083b7c], [0x294, 0x80083a9c],
  [0x298, 0x80083ab0], [0x29c, 0x80083ac4], [0x2a0, 0x80083ad8], [0x2a4, 0x80083b7c], [0x2a8, 0x80083aec],
  [0x2ac, 0x80083b00], [0x2b0, 0x80083b14], [0x2b4, 0x80083b28], [0x2b8, 0x80083b3c], [0x2bc, 0x80083b50],
  [0x2c0, 0x80083b7c], [0x2c4, 0x80083b64], [0x2c8, 0x80083e68], [0x2cc, 0x80083ec4], [0x2d0, 0x80083f2c],
  [0x2d4, 0x80083fac], [0x2d8, 0x80083f2c], [0x2dc, 0x800840e4], [0x2e0, 0x8008432c], [0x2e4, 0x80084350],
  [0x2e8, 0x80084448], [0x2ec, 0x8008461c], [0x2f0, 0x80084674], [0x2f4, 0x8008432c], [0x2f8, 0x8008432c],
  [0x2fc, 0x8008432c], [0x300, 0x8008432c], [0x304, 0x8008432c], [0x308, 0x8008468c], [0x30c, 0x80084710],
  [0x310, 0x80084c14], [0x314, 0x80084c20], [0x318, 0x80084c20], [0x31c, 0x80084c14], [0x320, 0x80084c20],
  [0x324, 0x80084c20], [0x328, 0x80084c20], [0x32c, 0x80084c14], [0x330, 0x80084c20], [0x334, 0x80084c14],
  [0x338, 0x80084c20], [0x33c, 0x80084c14], [0x340, 0x80084c20], [0x344, 0x80084c20], [0x348, 0x80084c20],
  [0x34c, 0x80084c20], [0x350, 0x80084c20], [0x354, 0x80084c14], [0x358, 0x80084c20], [0x35c, 0x80084c14],
  [0x360, 0x80084c20], [0x364, 0x80084c14], [0x368, 0x80084c20], [0x36c, 0x80084c14], [0x370, 0x80084c20],
  [0x374, 0x80084c14], [0x378, 0x80084c14], [0x37c, 0x80084c20], [0x380, 0x80084c20], [0x384, 0x80084c14],
  [0x388, 0x80084c20], [0x38c, 0x80084c14], [0x390, 0x80084c14], [0x394, 0x80084c14], [0x398, 0x80084c14],
  [0x39c, 0x80085050], [0x3a0, 0x80085070], [0x3a4, 0x80085128], [0x3a8, 0x8008518c], [0x3ac, 0x80085050],
  [0x3b0, 0x80085050], [0x3b4, 0x800852c4], [0x3bc, 0x800851b8], [0x3c0, 0x800851f0], [0x3c4, 0x80085208],
  [0x3c8, 0x80085240], [0x3cc, 0x80085280], [0x3d0, 0x80087a7c], [0x3d4, 0x80087aa0], [0x3d8, 0x80087ad8],
  [0x3dc, 0x80087ae8], [0x3e0, 0x80087b10], [0x3e4, 0x80088428], [0x3e8, 0x80088454], [0x3ec, 0x800884f0],
  [0x3f0, 0x80088470], [0x3f4, 0x800884f0], [0x3f8, 0x800884f0], [0x3fc, 0x8008849c], [0x400, 0x800884b0],
  [0x404, 0x800884d0], [0x40c, 0x8008854c], [0x410, 0x80088534], [0x414, 0x80088534], [0x418, 0x8008853c],
  [0x41c, 0x8008852c], [0x420, 0x8008852c], [0x424, 0x80088544], [0x434, 0x80088620], [0x438, 0x80088730],
  [0x43c, 0x80088770],
];
const LAYER_GET_SCROLL = 0x8001e064; // (obj,out): out[0/1] = [obj+0x70/+0x74]>>8
const LAYER_SET_SCROLL = 0x8001e088; // (obj,x,y): [obj+0x70/+0x74] = x/y
const LAYER_OT_BUCKET = 0x8001dfa8; // depth → ordering-table bucket ptr
const LAYER_ENQUEUE = 0x8001e240; // (layer, drawCb, obj, y, extra): sorted draw job

// ── resident resource/cache service (screens) ──
// Slot table walked by F0x80013cdc: 0x40 slots, stride 0x10, base 0x80044b3c
// (state +0, id +4, last-touch tick +8, buffer +0xc). Requests set state 1;
// the transfer method at service+0x30 (F0x80013914) starts the read; the slot
// is promoted to 2 by the cache tick and to 3 (resident) on the tick after.
const CACHE_TICK = 0x80013cdc;
const CACHE_TRANSFER = 0x80013914;
const CACHE_SLOTS = 0x80044b3c;
const SLOT_COUNT = 0x40;
const SLOT_STRIDE = 0x10;
const LBA_OFFSETS = 0x80044f6c; // u32 start sector per bank id (EXE data)
const LBA_LEN_SECTORS = 0x800474a4; // u16 sector count per bank id (EXE data)
const ALLOC_FROM_FREE_LIST = 0x80017d2c; // buffer allocator over D0x8004b5e0
const FREE_PTR = 0x8004b5ec; // the evictor's free function pointer

const RECORD_TABLE = PAD_BLOCK; // 448-byte record array behind the getters
const FRAME_DELTA_VALUE = 0x8004de28;
const FRAME_DELTA_ALT_VALUE = 0x8004de20;
const PROGRESS_ORDINAL = 0x8004b370; // master story ordinal (bank-0x60 backing)

// GPU packet arena: [0x8004de30] is the prim-packet write cursor; on console
// the render loop resets it every frame (double-buffered arena). Prim writers
// march it ~1KB/frame, so without the per-tick reset it eventually walks into
// live structures (that was the browser trap at ~frame 370).
const PACKET_ARENA = 0x80140000;

// ── console hardware / BIOS boundaries (host-served) ──
// libetc VSync F0x8002e7fc polls the vblank counter the console's interrupt
// handler advances; with no interrupt source the poll never terminates, which
// is the "budget exhausted" trap the stage-select and sound-test screens hit
// while self-registering a display view inside their tick. [0x8005c018] is the
// counter VSync(-1) returns; the host advances it one vblank per call.
const VSYNC = 0x8002e7fc;
const VBLANK_COUNT = 0x8005c018;
// libgs GTE helpers: setGeomOffset (F0x8002b3ec, ctc2 OFX/OFY), setGeomScreen
// (F0x8002b40c, ctc2 the projection distance) and the 3-angle rotation helper
// RotMatrixYXZ (F0x8002b65c, mtc2 + GPF) place the memory-card slot transition's
// four vertices. The interpreter's COP2 support executes these bodies directly
// (engine/native/mips.ts gteCommand), so they are no longer host-served no-ops;
// the transition bar's quad is built from real matrix arithmetic.
// Contract: research answer save-screen-card-and-gte (accepted 2026-09-22).
// Memory-card manager services. The manager at 0x80048750 is a STATIC object
// whose 13-entry method table is statically initialised in the exe image
// (0x80048a80..0x80048aa8 = object +0x330..+0x358), so the real bodies run - but
// they drive the PS1 card BIOS, which has no host here, so their polls never
// return and the screen's "Checking MEMORY CARD." wait hangs. Return protocol
// (research answer save-screen-service-values, accepted 2026-09-22): 0 = still
// pending (call again next frame), 1 = done/success, N >= 2 = done with error
// status N-1, which the screen prints from its own message table 0x80088310
// ("MEMORY CARD is not inserted." for status 1). With no card the services
// answer 2; the read/write/checksum slots are only reached with a card.
const MEMCARD_STAGE = 0x80014930;   // +0x330 stage command
const MEMCARD_OPEN = 0x80014b44;    // +0x334 open/poll
const MEMCARD_RESET = 0x80014c24;   // +0x338 reset/poll
const MEMCARD_READ = 0x80014d04;    // +0x33C read
const MEMCARD_WRITE = 0x80014fc4;   // +0x340 write
const MEMCARD_LIST = 0x80015480;    // +0x344 mode 0 directory list
const MEMCARD_MODE1 = 0x800154b8;   // +0x348 mode 1
const MEMCARD_FORMAT = 0x800154f0;  // +0x34C mode 2 format
const MEMCARD_CHECKSUM = 0x80015564; // +0x358 byte-XOR checksum
const MEMCARD_NO_CARD = 2;          // status 1 -> "MEMORY CARD is not inserted."
const MEMCARD_CARD_STRUCT = 0x80048750;
/** A read at least this large is the 0x26C4 save image, not a 0xD4 directory. */
const SAVE_IMAGE_MIN = 0x1000;
// PSY-Q BIOS file services. The shock-test screen opens the host-simulation
// device path "sim:C:/DEVELOP/DLSKDATA.TXT", which does not exist on a retail
// console; a failed open is the retail result the screen itself handles.
// Audio-archive load poll: F0x8002043C returns D0x80055C40 != 0 ("an audio
// archive is still loading"). The resident sound state machine that clears the
// flag is not driven by the browser tick, so screens that wait on it
// (gym/wizard/memory-card) stall. The jingle is host-side audio, not screen
// chrome, so the poll is served as "not pending" for the screen runtime.
// Title logo region store. The region loader F0x80086df8 is a local routine
// inside create_title_sequence that the standalone boot never reaches, so its
// store of the current language's logo handle stays 0 and every logo draw
// resolves to pack index 0. Serve the store: copy the region table's word1 for
// the language index into the cell the logo draws read.
// Table/anchors: docs/research/ui/stdwtitl-decoded-2026-07-11.md.
const TITLE_REGION_TABLE = 0x8008824c;
const TITLE_LOGO_CELL = 0x80088234;
const LANGUAGE_INDEX = 0x8005cca8;
const AUDIO_BANK_PENDING = 0x8002043c;
const BIOS_FOPEN = 0x800250ac;
const BIOS_FREAD = 0x800250bc;
const BIOS_FWRITE = 0x800250cc;
const BIOS_FCLOSE = 0x800250dc;

// ── resident controller-input service (host-served) ──
// The service object at 0x8004B7D0; its base, strides and field names live in
// engine/systems/pad-block.ts. Claims CORE-PAD-SERVICE-OBJECT-0x8004B7D0-001,
// CORE-PAD-RECORD-BUTTON-WORDS-001, CORE-PAD-KEYMAP-REMAP-001 (identity map:
// Circle 0x2000 confirms, Cross 0x4000 cancels, Start 0x0008).
const PAD_RECORDS = PAD_RECORD_BASE;

export interface StageManifestEntry {
  size: number;
  event_table: number;
  init_fn: number;
  root_ctor: number;
  allocs: { site: number; ctor_fn: number; cb: number | null; size: number | null; extra: number; with_id: boolean }[];
  effect_ids: number[];
}

export interface DisabledObject {
  cb: number;
  pc: number;
  reason: string;
}

/** One textured quad published through the GPU packet cursor (0x8004DF6C).
 *  Layout decoded from wstag780's builder 0x800a6fbc: 4 xy vertices, 4 uv
 *  pairs, CLUT word at +0x0E, texpage word at +0x16 (GPU register formats),
 *  command 0x2C (opaque) / 0x2E (ABR on). */
export interface NativeScreenQuad {
  cmd: number;
  x: [number, number, number, number];
  y: [number, number, number, number];
  u: [number, number, number, number];
  v: [number, number, number, number];
  texpage: number;
  clut: number;
}

/** One textured sprite the class's +0x34 emit published through the GPU packet
 *  cursor: a 0x1C-byte sprite + DR_TPAGE pair. Field layout from the accepted
 *  vram-sample-contract answer and `_asm/F0x8001e9e0.s` (the emit builder). */
export interface NativeCardPrim {
  /** The sprite command byte: 0x64 opaque, 0x66 semi-transparent. */
  cmd: number;
  x: number;
  y: number;
  /** Texture u/v inside the texpage. */
  u: number;
  v: number;
  clut: number;
  /** The DR_TPAGE parameter's texpage bits (low 9 bits). */
  tpage: number;
}

export class NativeStageRuntime {
  readonly mem: NativeMemory;
  readonly cpu: R3000;
  readonly world: StubWorld;
  /** Where this overlay image is mapped. Stage overlays use OVERLAY_BASE;
   *  screen overlays load in the resident slot (0x80082cb0). */
  readonly overlayBase: number;
  readonly drawCalls: DrawCall[] = [];
  /** Indices in `drawCalls` where a new picture service was constructed. */
  readonly ctxMarkers: number[] = [];
  /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
  private readonly audio = new PackedSoundCursor();
  /** The ids this runtime asked the shared queue for. */
  get sfx(): number[] { return this.audio.sounds; }
  /** Forget the sound window (a test resetting its log between cases). */
  resetSfx(): void { this.audio.reset(); }
  /** Textured quads captured from the GPU packet cursor this frame. */
  readonly screenQuads: NativeScreenQuad[] = [];
  /** Single textured sprites (the card faces) captured from the same cursor. */
  readonly cardPrims: NativeCardPrim[] = [];
  /** Raw primitives (the dim quad, the memory-card POLY_G4) captured from the
   *  packet cursor this frame, in publish order; `at` is the drawCalls index the
   *  block was published at, so the renderer can merge them into the recorded
   *  stream (engine/native/raw-prims.ts). */
  readonly rawPrims: RawPrim[] = [];
  /** VRAM uploads the console's LoadImage would have written. */
  readonly vram = new VramMap();
  /** load_texture(slot, packed-id) requests the stage init makes. */
  readonly resources: { slot: number; id: number }[] = [];
  /** start_event(id) calls native code made (bridged to the engine via host). */
  readonly events: number[] = [];
  readonly disabled: DisabledObject[] = [];
  /** Trap raised during boot (root ctor/init), if any. */
  bootTrap: DisabledObject | null = null;
  /**
   * Run the original screen object manager's lifecycle rule (F0x80018140): an
   * object whose +0xC reads 3 at the top of its turn is destroyed instead of
   * ticked, and the parent's child-array slot becomes NULL. Default off so the
   * coverage probe and differential gate keep their recorded flat-tick
   * behaviour; the production browser host turns it on.
   */
  objectLifecycle = false;
  /** Arguments for the root constructor (see `boot`). Empty = a single 0. */
  bootArgs: number[] = [];
  private readonly deadCbs = new Set<number>();
  private readonly renderJobs: { cb: number; obj: number; extra: number }[] = [];
  /** The bucket the last render-layer +0x138 selection named; consumed by the
   *  next packet publish (see captureRawPrims). The selection is observed either
   *  at the LAYER_OT_BUCKET stub (a registered view) or at the null-call guard
   *  at 0 (a view the boot never registered); both carry the bucket in $a1.
   *  null = none since the previous capture. */
  private pendingOtBucket: number | null = null;
  private readonly overlayEnd: number;

  private fieldstgEnd = FIELDSTG_BASE; // exclusive; == base when not loaded
  private residentEnd = 0; // resident EXE image (screens); 0 when not loaded
  private heap: ScreenHeap | null = null; // screen buffer arena (null for stages)
  private bridgeServices: HeapServices | null = null;

  constructor(
    overlay: Uint8Array,
    manifest: StageManifestEntry,
    host: NativeHost,
    exeTables?: { sin_table_base: number; halfwords: number[] },
    fieldstg?: Uint8Array,
    overlayBase: number = OVERLAY_BASE,
    resident?: { image: Uint8Array; base: number },
  ) {
    this.overlayBase = overlayBase >>> 0;
    this.mem = new NativeMemory();
    // GPUSTAT/DMA2 etc. answer from the device service instead of flat RAM, so
    // the GPU queue drain does not spin (loadimage-chain-contract section 6).
    installDevicePorts(this.mem);
    if (resident) {
      // Resident EXE first: its initial data must sit under the stubs' seeded
      // globals, and the overlay swaps into its slot on top of it.
      this.mem.load(resident.image, resident.base);
      this.residentEnd = (resident.base + resident.image.length) >>> 0;
    }
    if (fieldstg) {
      this.mem.load(fieldstg, FIELDSTG_BASE);
      this.fieldstgEnd = FIELDSTG_BASE + fieldstg.length;
    }
    this.mem.load(overlay, this.overlayBase);
    if (exeTables) {
      for (let i = 0; i < exeTables.halfwords.length; i++) {
        this.mem.write16(exeTables.sin_table_base + i * 2, exeTables.halfwords[i] as number);
      }
    }
    this.overlayEnd = this.overlayBase + manifest.size;
    this.cpu = new R3000(this.mem);
    this.hostRef = host;
    this.world = installCoreStubs(this.cpu, host);
    installDrawStubs(this.cpu, (c) => this.drawCalls.push(c));
    this.installRuntimeStubs(host);
    // executing outside the loaded images must hit a stub — everything else
    // is unloaded EXE code and trapping there names the gap. fieldstg code
    // (when its image is loaded) runs natively; the decoded stub boundary
    // still intercepts first (stubs are checked before instruction fetch).
    this.cpu.execGuard = (pc) =>
      (pc >= this.overlayBase && pc < this.overlayEnd) ||
      (pc >= FIELDSTG_BASE && pc < this.fieldstgEnd) ||
      (this.residentEnd !== 0 && pc >= 0x80010000 && pc < this.residentEnd);
    this.manifest = manifest;
  }

  private manifest: StageManifestEntry;

  /**
   * TypeScript services the mixed-mode bridge hands to translated ports that
   * allocate (engine/native/bridge.ts). Null on stage runtimes, where the
   * allocator stub is not installed, so service-needing entries are skipped
   * rather than diverging.
   */
  get services(): HeapServices | null {
    return this.bridgeServices;
  }

  private installRuntimeStubs(host: NativeHost): void {
    const mem = this.mem;
    // Fieldstg-targeted hooks must only exist while fieldstg is the image at
    // its base. Screen overlays load in that same slot; the same addresses are
    // then the screen's own code and stubbing them would hijack the screen.
    const fieldstgLoaded = this.fieldstgEnd !== FIELDSTG_BASE;
    for (const [g, target] of GLOBAL_SEEDS) mem.write32(g, target);

    if (fieldstgLoaded) {
      // zonemgr method cells + their fieldstg targets
      mem.write32(ZONEMGR + 0x40, ZONEMGR_SET);
      mem.write32(ZONEMGR + 0x50, ZONEMGR_COMMIT);
      cpuStub(this.cpu, ZONEMGR_SET, (c) => {
        const slot = c.reg(4), id = c.reg(5);
        this.resources.push({ slot, id: id >>> 0 });
        if (slot >= 0 && slot < 0x10) mem.write32(ZONEMGR + slot * 4, id);
        return 0;
      });
      cpuStub(this.cpu, ZONEMGR_COMMIT, () => 0);
    }

    cpuStub(this.cpu, CTX_FILL, (c) => {
      // byte-exact port of F0x8001f648 (fns.s): zero 0xa0 bytes, defaults,
      // method table — methods themselves are the installDrawStubs hooks
      const ctx = c.reg(4) >>> 0;
      for (let i = 0; i < 0xa0; i += 4) mem.write32(ctx + i, 0);
      mem.write32(ctx + 0x38, 0x1000);
      mem.write32(ctx + 0x3c, 0x1000);
      mem.write32(ctx + 0x40, 0x1000);
      mem.write32(ctx + 0x24, 1);
      mem.write8(ctx + 0x28, 0x80);
      mem.write8(ctx + 0x29, 0x80);
      mem.write8(ctx + 0x2a, 0x80);
      mem.write32(ctx + 0x70, 0x8001ecb0);
      mem.write32(ctx + 0x74, 0x8001ecbc);
      mem.write32(ctx + 0x78, 0x8001ecd8);
      mem.write32(ctx + 0x7c, 0x8001ed34);
      mem.write32(ctx + 0x80, 0x8001ecf8);
      mem.write32(ctx + 0x84, 0x8001ed6c);
      mem.write32(ctx + 0x88, 0x8001ecec);
      mem.write32(ctx + 0x8c, 0x8001f5d0);
      mem.write32(ctx + 0x90, 0x8001f5ec);
      mem.write32(ctx + 0x94, 0x8001f608);
      mem.write32(ctx + 0x98, 0x8001f61c);
      mem.write32(ctx + 0x9c, 0x8001f628);
      // The real fill ends by making this context the current one
      // (F0x8001ecb0 writes gp+0x1C0). Screens build a fresh context on their
      // own stack immediately before each picture, so the index of the next
      // recorded call is a picture boundary: the renderer resets transform and
      // palette state there, or one picture's fold scale leaks into the next
      // picture's plates. A side channel, not a drawCalls entry: the recorded
      // call stream is what the translation oracles compare.
      this.ctxMarkers.push(this.drawCalls.length);
    });

    cpuStub(this.cpu, FRAME_DELTA_ALT, () => mem.read32(FRAME_DELTA_ALT_VALUE));
    // The GPU packet cursor is the draw-submission boundary: stage code builds
    // its prims in the packet arena and publishes the new cursor here. Textured
    // quads (0x2C/0x2E) are the animated screens (wstag780's 40-quad builder,
    // 0x800a6fbc) and any other raw prim path; capture them so the web renderer
    // can draw what the console GPU would have. Everything else passes through.
    cpuStub(this.cpu, SET_DE30, (c) => {
      const end = c.reg(4) >>> 0;
      const start = mem.read32(0x8004de30) >>> 0;
      this.captureScreenQuads(end);
      this.captureCardPrim(start, end);
      this.captureRawPrims(start, end);
      mem.write32(0x8004de30, end);
    });
    cpuStub(this.cpu, GET_DE30, () => mem.read32(0x8004de30));
    mem.write32(0x8004de30, PACKET_ARENA); // per-frame GPU packet arena (reset each tick)

    // render-layer lookup: synthesize one object per layer id whose method
    // slots (+0x00..+0x43c) are per-offset recording stubs — the "ctx family"
    // (+0x11c/+0x138/+0x3f4..) all land here with their offset named
    // scratch layout (far from cpu.sp at 0x801ffcf0): prim writers march
    // hundreds of bytes past the returned bucket, so buckets are 2KB apart in
    // a ring that stops 192KB short of the layer objects (guard gap).
    const layerObjs = new Map<number, number>();
    let layerScratch = 0x801d0000;
    let otScratch = 0x80180000;

    // hook every distinct layer method target once; unknown ones record + 0
    const layerMethodNames = new Map<number, string>();
    for (const [off, addr] of LAYER_METHOD_SLOTS) {
      if (!layerMethodNames.has(addr)) layerMethodNames.set(addr, `layer+0x${off.toString(16)}`);
    }
    if (fieldstgLoaded) {
      for (const [addr, name] of layerMethodNames) {
        if (addr === LAYER_GET_SCROLL || addr === LAYER_SET_SCROLL || addr === LAYER_OT_BUCKET || addr === LAYER_ENQUEUE) continue;
        if (addr >= 0x80014274 && addr <= 0x80014308) continue; // core state-machine stubs own these
        cpuStub(this.cpu, addr, (c) => {
          this.drawCalls.push({ method: name, args: [c.reg(4), c.reg(5), c.reg(6), c.reg(7)] });
          return 0;
        });
      }
    }
    // exact ports (fns.s): scroll accessors read/write the object's own fields
    cpuStub(this.cpu, LAYER_GET_SCROLL, (c) => {
      const o = c.reg(4), out = c.reg(5);
      mem.write32(out, mem.read32(o + 0x70) >> 8);
      mem.write32(out + 4, mem.read32(o + 0x74) >> 8);
    });
    cpuStub(this.cpu, LAYER_SET_SCROLL, (c) => {
      const o = c.reg(4);
      mem.write32(o + 0x70, c.reg(5));
      mem.write32(o + 0x74, c.reg(6));
    });
    cpuStub(this.cpu, LAYER_OT_BUCKET, (c) => {
      // (layer, bucket): the prim writers select their ordering-table bucket
      // through this slot immediately before they publish a packet block (the
      // dim quad and the memory-card POLY_G4 both do; see raw-prims.ts). Keep
      // the selection so the raw capture can label the block with it.
      this.pendingOtBucket = c.reg(5) & 0xffff;
      otScratch += 0x800;
      if (otScratch >= 0x801a0000) otScratch = 0x80180000;
      return otScratch;
    });
    // F0x8001e240 inserts a five-word render job into the layer's y-sorted
    // linked list. The real layer runner later invokes drawCb(obj, extra).
    // Preserve that boundary instead of treating the enqueue itself as a draw
    // call; native draw callbacks then reach the ordinary draw-context stubs.
    cpuStub(this.cpu, LAYER_ENQUEUE, (c) => {
      this.renderJobs.push({
        cb: c.reg(5) >>> 0,
        obj: c.reg(6) >>> 0,
        extra: mem.read32((c.reg(29) >>> 0) + 0x10) >>> 0,
      });
      return 0;
    });

    // 0x8001DA84 is the display-service view lookup (its body walks the 30
    // slots at 0x8004DE10 matching +0xD8). The synthetic layer registry below
    // only stands in for the fieldstg render path, so the screen roots run the
    // shipped body and find the views the screen registered itself.
    if (fieldstgLoaded) {
      cpuStub(this.cpu, LAYER_LOOKUP, (c) => {
        const id = c.reg(4);
        let obj = layerObjs.get(id);
        if (obj === undefined) {
          obj = layerScratch;
          layerScratch += 0x440;
          for (let off = 0; off < 0x440; off += 4) mem.write32(obj + off, 0);
          for (const [off, addr] of LAYER_METHOD_SLOTS) mem.write32(obj + off, addr);
          layerObjs.set(id, obj);
        }
        return obj;
      });
    }

    // trig: exact ports of F0x8002abcc / F0x8002ac9c over the loaded table
    const tab = (idx: number) => mem.read16s(SIN_TABLE_BASE + idx * 2);
    const quarterSin = (a: number): number => {
      // F0x8002ac08: 0..0x400 direct, 0x401..0x800 mirrored, else negated mirror
      if (a <= 0x400) return tab(a);
      if (a <= 0x800) return tab(0x800 - a);
      return a <= 0xc00 ? -tab(a - 0x800) : -tab(0x1000 - a);
    };
    cpuStub(this.cpu, SIN_FN, (c) => {
      const a = c.reg(4);
      return a >= 0 ? quarterSin(a & 0xfff) : -quarterSin(-a & 0xfff);
    });
    cpuStub(this.cpu, COS_FN, (c) => {
      const a = Math.abs(c.reg(4)) & 0xfff;
      if (a <= 0x400) return tab(0x400 - a);
      if (a <= 0x800) return -tab(a - 0x400);
      return a <= 0xc00 ? -tab(0xc00 - a) : tab(a - 0xc00);
    });

    // The address 0x8001FFA8 is the resident card-artwork upload helper (it
    // installs F0x8001FD50/FD3C/FD28/FD1C/FE38/FF9C), not a sound-object
    // constructor: the synthetic model below only stands in for the fieldstg
    // render path, so it is installed only while fieldstg is loaded. On the
    // screen roots the shipped body runs (cardgame/cnty_sel call it).
    if (fieldstgLoaded) {
      for (let i = 0; i < 6; i++) {
        const slot = 0x1c + i * 4;
        cpuStub(this.cpu, SND_METHOD_BASE + i * 4, (c) => {
          this.drawCalls.push({ method: `snd+0x${slot.toString(16)}`, args: [c.reg(4), c.reg(5), c.reg(6), c.reg(7)] });
          return 0;
        });
      }
      cpuStub(this.cpu, SND_OBJ_CTOR, (c) => {
        const o = c.reg(4) >>> 0;
        for (let i = 0; i < 0x34; i += 4) mem.write32(o + i, 0);
        for (let i = 0; i < 6; i++) mem.write32(o + 0x1c + i * 4, SND_METHOD_BASE + i * 4);
        mem.write32(o + 0x18, 0xa800);
        return o;
      });
    }

    // libgpu LoadImage: the console's CPU->VRAM transfer, reached from the card
    // helper's F0x8001FD50 with a RECT* and the pixel pointer. Its own callees
    // (F0x800258D0 the debug RECT validator, F0x800275E4 the GPU-queue send and
    // F0x80027030 the GP0 0xA0 builder) are device code that spins on the GPU
    // status register 0x1f801814; the browser has no command queue, so the
    // upload is recorded instead (accepted loadimage-chain-contract, section 6).
    cpuStub(this.cpu, LOAD_IMAGE, (c) => {
      const rect = c.reg(4) >>> 0;
      this.vram.upload(
        mem.read16(rect) | 0,
        mem.read16(rect + 2) | 0,
        mem.read16(rect + 4) | 0,
        mem.read16(rect + 6) | 0,
        c.reg(5) >>> 0,
        8, // card artwork is 8-bit per texel; the palette upload is a second call
        false,
        (addr) => mem.read8(addr),
        (addr, dest) => mem.readInto(addr, dest),
      );
      return 0;
    });

    if (fieldstgLoaded) {
      cpuStub(this.cpu, POINT_REBIND, (c) => {
        mem.write32(0x8009b8fc, c.reg(4));
        mem.write32(0x8009b8f8, mem.read32(0x80099d90));
        return 0;
      });

      cpuStub(this.cpu, START_EVENT, (c) => {
        const id = c.reg(4);
        this.events.push(id);
        host.startEvent?.(id);
        return 0;
      });
    }

    // Screens: the resident bank transfer is an asynchronous disc read on
    // console. Serve it synchronously through the host (real bank bytes when
    // the host provides readBank, zero-fill otherwise) so the native cache
    // state machine can promote the slot 1 -> 2 -> 3 across ticks.
    if (this.residentEnd !== 0) {
      // The pad service's logical->physical button map (object+0xA4, read by
      // F0x80018980) is filled at boot by InitPad (F0x80018310 -> F0x800188C0)
      // from the 16-byte table at 0x8004BBF4. A static screen boot never runs
      // that code, so the cells read back zero and every screen's
      // `pressed >> key(code)` tests the wrong bit — the input phase of the
      // coverage probe was inert because of it. Seed the shipped identity map
      // (claim UI-PADSERVICE-BUTTON-REMAP-IS-IDENTITY-2026-08-13) for both
      // standard ports' four multitap slots.
      for (let port = 0; port < 2; port++) {
        for (let slot = 0; slot < 4; slot++) {
          const rec = RECORD_TABLE + port * PAD_PORT_STRIDE + slot * PAD_SLOT_STRIDE;
          for (let n = 0; n < PAD_BUTTONS; n++) mem.write8(rec + PAD_BUTTON_MAP_IN_PORT + n, n);
        }
      }
      // The game's buffer free list (D0x8004b5e0) is initialised by boot code
      // that never runs in a static screen boot, so the native allocator would
      // hand out addresses near 0. Give it a real arena instead; frees are
      // no-ops (a screen's buffers are released at screen close).
      this.heap = new ScreenHeap(mem);
      const heap = this.heap;
      const world = this.world;
      const startTransfer = (id: number, buf: number): void => {
        id &= 0xffff;
        const sectors = mem.read16(LBA_LEN_SECTORS + id * 2);
        const bytes = Math.min((sectors << 11) >>> 0, 0x200000);
        if ((buf >>> 0) >= 0x80000000 && bytes > 0) {
          if (host.readBank) host.readBank(id, buf >>> 0, bytes);
          else for (let a = 0; a < bytes; a += 4) mem.write32(buf + a, 0);
        }
      };
      this.bridgeServices = {
        startTransfer,
        playPackedSound: (id) => this.playPackedSound(id),
        alloc: (size, align) => heap.alloc(size, align),
        free: () => {},
        carve: (size) => world.carve(size),
        allocObject: (cb, size, extraSize, id) => world.alloc(cb, size, extraSize, id),
      };
      cpuStub(this.cpu, ALLOC_FROM_FREE_LIST, (c) => heap.allocLowLevel(c.reg(4) >>> 0));
      const FREE_STUB = 0x0fd10000;
      cpuStub(this.cpu, FREE_STUB, () => 0);
      mem.write32(FREE_PTR, FREE_STUB);

      cpuStub(this.cpu, CACHE_TRANSFER, () => {
        for (let i = 0; i < SLOT_COUNT; i++) {
          const slot = CACHE_SLOTS + i * SLOT_STRIDE;
          if (mem.read32(slot) !== 1) continue;
          const id = mem.read32(slot + 4) & 0xffff;
          const buf = mem.read32(slot + 0xc) >>> 0;
          startTransfer(id, buf);
          break;
        }
        return 0;
      });

      // Console VSync: the screen's display-init path (F0x80026d20 ->
      // set_alarm/F0x80027da0) waits on the vblank counter that the console's
      // interrupt handler advances. The host stands in for that interrupt
      // source: each VSync(-1) advances the counter one vblank and returns it.
      // Only installed for the screen runtime (resident EXE loaded); stages
      // never reach this address.
      let vblank = 0;
      cpuStub(this.cpu, VSYNC, (c) => {
        if (c.reg(4) < 0) {
          vblank = (vblank + 1) >>> 0;
          mem.write32(VBLANK_COUNT, vblank);
          return vblank | 0;
        }
        return mem.read32(VBLANK_COUNT) | 0;
      });

      // The libgs GTE helpers (setGeomOffset, setGeomScreen, RotMatrixYXZ) now
      // run as real bodies: the interpreter executes their ctc2/mtc2/GPF
      // (engine/native/mips.ts gteCommand). No host no-op is installed.

      // Memory-card services. The manager drives the PS1 card BIOS, which has no
      // host, so the method table is served from `host.memcard` when the browser
      // has a virtual card and from the terminal no-card status when it does not.
      // The stage command (+0x330) is NOT stubbed — its real body builds the
      // header block and is pinned by tests/save-header-oracle.test.js.
      const cardStatus = (): number => {
        const card = host.memcard;
        return card && card.fileCount() > 0 ? 1 : MEMCARD_NO_CARD;
      };
      for (const addr of [MEMCARD_OPEN, MEMCARD_RESET, MEMCARD_LIST, MEMCARD_MODE1, MEMCARD_FORMAT]) {
        cpuStub(this.cpu, addr, () => cardStatus());
      }
      // The read service (handle, buf, len, file): state 0x15 reads the selected
      // file's 0xD4 header through it and state 0x47 reads the 0x26C4 save image.
      // The manager passes the card file as its fourth argument (F0x80084dcc: the
      // selected slot + 2), and the browser card maps that file to its own slot.
      cpuStub(this.cpu, MEMCARD_READ, (c) => {
        const card = host.memcard;
        if (!card || card.fileCount() <= 0) return MEMCARD_NO_CARD;
        const len = c.reg(6) >>> 0;
        // The driver's fourth argument is the card FILE for the header and image
        // reads that follow a slot selection (selected slot + 2). The card-check
        // read passes 1 instead, which is not a file: fall back to the screen's
        // own current slot (`0x80088768+4`, which the driver later overwrites from
        // the block's slot byte) so the directory keeps the player's selection.
        const fileArg = c.reg(7) | 0;
        let file = fileArg;
        if (file < 2 || file > 4) {
            const stageSlot = mem.read32(0x80088768 + 4) | 0;
            if (stageSlot >= 0 && stageSlot <= 2) file = stageSlot + 2;
        }
        const data = len >= SAVE_IMAGE_MIN ? (card.block?.(file) ?? null) : card.record(file);
        if (!data) return MEMCARD_NO_CARD;
        const buf = c.reg(5) >>> 0;
        for (let i = 0; i < Math.min(len, data.length); i++) mem.write8(buf + i, (data[i] ?? 0) & 0xff);
        return 1;
      });
      // The write service (handle, buf, len, file): states 0x34/0x35 hand the
      // header and then the 0x26C4 image back to the card.
      cpuStub(this.cpu, MEMCARD_WRITE, (c) => {
        const card = host.memcard;
        if (!card || card.fileCount() <= 0) return MEMCARD_NO_CARD;
        const buf = c.reg(5) >>> 0;
        const len = c.reg(6) >>> 0;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = mem.read8(buf + i) & 0xff;
        card.store?.(c.reg(7) | 0, bytes);
        return 1;
      });

      // BIOS file services: retail has no "sim:" host device, so fopen fails
      // and the calling screen takes the same failure branch it takes when the
      // file is absent. fread/fclose are served for completeness.
      // A screen object whose method slot the game's setup never installed
      // calls through a null pointer (probe: "null function-pointer call:
      // recover and keep going"). Serve it as a no-op so one unset slot does
      // not disable the whole screen; the probe's coverage runs the same way.
      //
      // One such call carries meaning: the raw-prim writers select their
      // ordering-table bucket through the view's +0x138 immediately before they
      // publish a packet block, and a screen boot that never registered that
      // view resolves the lookup to 0 — the bucket still rides in $a1 (the dim
      // quad passes its object's +0x54, the memory-card POLY_G4 its +0x54 = 1),
      // so keep it for the packet capture (engine/native/raw-prims.ts). When a
      // view IS registered, the same selection arrives at the +0x138 stub
      // (LAYER_OT_BUCKET) instead.
      cpuStub(this.cpu, 0, (c) => {
        this.pendingOtBucket = c.reg(5) & 0xffff;
        return 0;
      });
      cpuStub(this.cpu, AUDIO_BANK_PENDING, () => 0);

      // Serve the title region loader's store (see TITLE_REGION_TABLE). Guard on
      // the table's own signature: 0x80088234/0x8008824c sit in the shared
      // overlay slot, so an unconditional write would clobber another overlay's
      // image or the resident data (same hazard as the DESCRIPTOR_BANK clobber).
      if (mem.read32(TITLE_REGION_TABLE) === 0x08860001) {
        const lang = mem.read32(LANGUAGE_INDEX) & 7;
        mem.write32(TITLE_LOGO_CELL, mem.read32(TITLE_REGION_TABLE + lang * 8 + 4) >>> 0);
      }

      cpuStub(this.cpu, BIOS_FOPEN, () => -1);
      cpuStub(this.cpu, BIOS_FREAD, () => 0);
      cpuStub(this.cpu, BIOS_FWRITE, () => 0);
      cpuStub(this.cpu, BIOS_FCLOSE, () => 0);
    }

    cpuStub(this.cpu, GETTER_48, (c) => padPressed(mem, c.reg(4)));
    cpuStub(this.cpu, GETTER_4E, (c) => padHeld(mem, c.reg(4)));
    cpuStub(this.cpu, GETTER_A4, (c) => padButtonBit(mem, c.reg(4), c.reg(5)));
    cpuStub(this.cpu, OBJ_LOOKUP, () => 0); // no entity world yet (P1-web)
    cpuStub(this.cpu, RESOLVER, () => 0x801e0000); // zeroed scratch "pack sub"
    // Stage runtime only: with no resident EXE the resource base lookup has no
    // real body to run, so it is a host no-op. With the resident image loaded
    // (screens) F0x80013E5C runs for real: it walks the resident cache and is
    // what lets the shop resolve ESITMNAM (108) instead of a zero base.
    if (this.residentEnd === 0) cpuStub(this.cpu, RESOURCE_GET_BASE, () => 0);
    cpuStub(this.cpu, SFX_PLAY, (c) => {
      const id = c.reg(4) >>> 0;
      this.playPackedSound(id);
      return 0;
    });
  }

  private hostRef: NativeHost | null = null;
  private playPackedSound(id: number): void {
    const fields = this.audio.play(id);
    this.hostRef?.playPackedSound?.(fields.packed);
    this.hostRef?.log?.(`sfx 0x${fields.packed.toString(16)}`);
  }
  /** Host-supplied held button words, one per controller port (screens). */
  private readonly padHeld = [0, 0];
  private readonly padPrev = [0, 0];
  /** Per physical bit: tick of the last repeat pulse and its credit ladder
   *  (docs/research/ui/pad-input-service-behaviour-2026-08-21.md: rate 16,
   *  credit +10 saturating at 12, release resets). */
  private readonly padLast = [new Int32Array(16), new Int32Array(16)];
  private readonly padCredit = [new Int32Array(16), new Int32Array(16)];
  private padTick = 0;

  /** Parse the 40 textured quads the screen builder just wrote before SET_DE30.
   *  Bounds come from the decoded builder: stride 0x28, vertices at +8/+0x10/
   *  +0x18/+0x20, uv at +0xC/+0x14/+0x1C/+0x24, CLUT +0xE, texpage +0x16,
   *  command byte +7. The batch is contiguous and exactly 40 quads long; if the
   *  memory before the published cursor does not carry that shape (a different
   *  prim writer moved the cursor), nothing is captured. */
  private captureScreenQuads(end: number): void {
    const mem = this.mem;
    const base = (end - 40 * 0x28) >>> 0;
    const looksQuad = (a: number): boolean =>
      mem.read8(a + 3) === 9 &&
      mem.read8(a + 4) === 0x80 &&
      mem.read8(a + 5) === 0x80 &&
      mem.read8(a + 6) === 0x80 &&
      (mem.read8(a + 7) === 0x2c || mem.read8(a + 7) === 0x2e);
    for (let i = 0; i < 40; i++) {
      if (!looksQuad(base + i * 0x28)) return;
    }
    for (let i = 0; i < 40; i++) {
      const a = base + i * 0x28;
      this.screenQuads.push({
        cmd: mem.read8(a + 7),
        x: [mem.read16s(a + 8), mem.read16s(a + 0x10), mem.read16s(a + 0x18), mem.read16s(a + 0x20)],
        y: [mem.read16s(a + 0xa), mem.read16s(a + 0x12), mem.read16s(a + 0x1a), mem.read16s(a + 0x22)],
        u: [mem.read8(a + 0xc), mem.read8(a + 0x14), mem.read8(a + 0x1c), mem.read8(a + 0x24)],
        v: [mem.read8(a + 0xd), mem.read8(a + 0x15), mem.read8(a + 0x1d), mem.read8(a + 0x25)],
        texpage: mem.read16(a + 0x16),
        clut: mem.read16(a + 0xe),
      });
    }
  }

  /** Parse the single 0x1C-byte sprite + DR_TPAGE the card class's +0x34 emit
   *  publishes (accepted vram-sample-contract section 2): the range is exactly
   *  0x1C bytes, byte +3 is the tag size, +4..+6 the neutral tint, +7 the sprite
   *  command (0x64/0x66) and +0x18 the DR_TPAGE parameter. Anything else is a
   *  different prim writer and is left alone. */
  private captureCardPrim(start: number, end: number): void {
    const mem = this.mem;
    const len = (end - start) >>> 0;
    if (len !== 0x1c) return;
    const a = start >>> 0;
    if (mem.read8(a + 3) !== 4) return;
    if (mem.read8(a + 4) !== 0x80 || mem.read8(a + 5) !== 0x80 || mem.read8(a + 6) !== 0x80) return;
    const cmd = mem.read8(a + 7);
    if (cmd !== 0x64 && cmd !== 0x66) return;
    const tpageWord = mem.read32(a + 0x18) >>> 0;
    if ((tpageWord >>> 24) !== 0xe1) return;
    this.cardPrims.push({
      cmd,
      x: mem.read16s(a + 0x8),
      y: mem.read16s(a + 0xa),
      u: mem.read8(a + 0xc),
      v: mem.read8(a + 0xd),
      clut: mem.read16(a + 0xe),
      tpage: tpageWord & 0x1ff,
    });
  }

  /** Parse the raw GPU primitives a writer just published through the packet
   *  cursor (SET_DE30): the full-screen 0x2A dim quad with its draw-mode word,
   *  and the POLY_G4 (0x38) the memory-card transition bar builds. Layouts and
   *  emit sites are cited in engine/native/raw-prims.ts; a block of any other
   *  shape is left to the capture path that owns it. The block joins the
   *  recorded stream at the current drawCalls index so the renderer can merge
   *  it into the frame's order. */
  private captureRawPrims(start: number, end: number): void {
    const bucket = this.pendingOtBucket;
    this.pendingOtBucket = null; // one selection per publish
    const prims = decodeRawPrims(this.mem, start, end);
    if (!prims) return;
    const at = this.drawCalls.length;
    for (const p of prims) {
      this.rawPrims.push(bucket === null ? { at, ...p } : { at, bucket, ...p });
    }
  }

  /**
   * The card grant (fixture seed): call the shipped grant routine F0x80016E2C
   * for one card id, which sets the album's "ever obtained" flag at
   * save + id + 0x4DF and adds to the copies-held byte at +0x3A2. This is the
   * game's own writer (its only store to that flag), so a captured run seeded
   * this way takes the same path a real obtained card does.
   */
  grantCard(id: number, count = 1): boolean {
    if (this.residentEnd === 0) return false; // the routine lives in the EXE image
    this.cpu.call(GRANT_CARD, [id | 0, count | 0], 10_000);
    return true;
  }

  /** Set the held-button word for a controller port (host input service).
   *  The next tick derives the pressed edge and writes the pad record the
   *  screens read through F0x80018854/F0x80018878/F0x8001889C. */
  setPadHeld(port: number, buttons: number): void {
    if (port < 0 || port >= this.padHeld.length) return;
    this.padHeld[port] = buttons & 0xffff;
  }

  /** Derive pressed (held & ~previous) and the 16/6/4 auto-repeat, publish the
   *  record words the screens read. Mirrors the resident poll F0x80018BCC for
   *  the shipped identity button map. */
  private applyPad(): void {
    const mem = this.mem;
    const RATE = 16;
    this.padTick++;
    for (let port = 0; port < this.padHeld.length; port++) {
      const held = this.padHeld[port]! & 0xffff;
      const prev = this.padPrev[port]! & 0xffff;
      let repeat = 0;
      for (let b = 0; b < 16; b++) {
        if (held & (1 << b)) {
          const due = this.padTick - (this.padLast[port]![b] as number) + (this.padCredit[port]![b] as number);
          if (Math.trunc(due / RATE) !== 0) {
            repeat |= 1 << b;
            this.padLast[port]![b] = this.padTick;
            this.padCredit[port]![b] = Math.min((this.padCredit[port]![b] as number) + 10, 12);
          }
        } else {
          this.padLast[port]![b] = this.padTick;
          this.padCredit[port]![b] = 0;
        }
      }
      const rec = PAD_RECORDS + port * PAD_PORT_STRIDE;
      mem.write16(rec + PAD_PRESSED, held & ~prev);
      mem.write16(rec + PAD_REPEAT, repeat);
      mem.write16(rec + PAD_HELD_PREVIOUS, prev);
      mem.write16(rec + PAD_HELD, held);
      this.padPrev[port] = held;
    }
  }

  /** Run the stage's real root constructor (initial allocs + descriptor init). */
  boot(budget = 2_000_000): boolean {
    this.mem.write32(FRAME_DELTA_VALUE, 1);
    this.mem.write32(FRAME_DELTA_ALT_VALUE, 0); // the tick counter starts at 0 and accumulates
    this.mem.write32(PROGRESS_ORDINAL, this.hostRef?.ordinal?.() ?? 0);
    // DESCRIPTOR_BANK (0x80099d80) is a wstag STAGE global, but the address also
    // falls inside some screen overlays' own code (ststatus code at 0x80099d7c+).
    // Zeroing it for a screen clobbered that code and produced a wild jump; only
    // the stage runtime (no resident EXE loaded) owns the slot.
    if (this.residentEnd === 0) this.mem.write32(DESCRIPTOR_BANK + 0, 0); // stage lba slot (game-managed)
    // rootArgs: the constructor's arguments. Most screens take none (a single 0);
    // a screen whose manifest root IS a sub-object factory needs its real
    // arguments — pro/fightstg's root is the command-menu actor constructor
    // F0x80093F9C(initialRow, outputCell).
    const bootArgs = this.bootArgs.length > 0 ? this.bootArgs.slice(0, 4) : [0];
    try {
      this.cpu.call(this.overlayBase + this.manifest.root_ctor, bootArgs, budget);
      return true;
    } catch (e) {
      if (e instanceof NativeTrap) {
        this.bootTrap = { cb: this.manifest.root_ctor, pc: e.pc, reason: e.message };
        return false;
      }
      throw e;
    }
  }

  /** One frame: tick every live object's real callback (decoded convention:
   * cb(obj, extraBuf), pause-gate on obj+0x1c when state==1). */
  tick(delta = 1, budgetPerObject = 8_000_000): void {
    const mem = this.mem;
    mem.write32(FRAME_DELTA_VALUE, delta);
    // 0x8004DE20 is the free-running tick counter (F0x8001D6F4), not the delta:
    // the resident VBLANK feeder accumulates it and F0x8001D504 publishes it, so
    // the host adds `delta` rather than assigning. The delta stays in
    // 0x8004DE28. See UI-DISPLAY-TICK-CHAIN-2026-08-21 / the timebase answer.
    mem.write32(FRAME_DELTA_ALT_VALUE, (mem.read32(FRAME_DELTA_ALT_VALUE) + delta) >>> 0);
    mem.write32(PROGRESS_ORDINAL, this.hostRef?.ordinal?.() ?? 0);
    mem.write32(0x8004de30, PACKET_ARENA); // per-frame packet-arena reset (see PACKET_ARENA)
    // Screens: publish the host pad state before the objects read it.
    if (this.residentEnd !== 0) this.applyPad();
    // Screens: the resident cache tick (F0x80013cdc) services requested bank
    // slots and starts/promotes their transfers. In the game this runs from
    // the main loop, which the object schedule does not include.
    if (this.residentEnd !== 0) {
      try {
        this.cpu.call(CACHE_TICK, [], 500_000);
      } catch (e) {
        if (!(e instanceof NativeTrap)) throw e;
      }
    }
    this.screenQuads.length = 0;
    this.cardPrims.length = 0;
    this.rawPrims.length = 0;
    this.renderJobs.length = 0;
    this.pendingOtBucket = null; // a stale selection from last frame must not label this frame's first publish
    // objects may alloc during ticks; iterate a snapshot. On SCREENS the
    // original's main loop ticks only the display-registered root and recurses
    // into each object's +0x20 count / +0x24 child array in index order
    // (F0x80018140 -> D0x8004b7c4 = F0x80018230). A flat allocation-order walk
    // instead, which is why the title's circuit background was recorded before
    // the logo it must sit behind. Stage paths keep the flat order unchanged.
    const objs = this.residentEnd !== 0 ? this.screenTickOrder([...this.world.objects]) : [...this.world.objects];
    // A child created by a tick in this pass is ticked in this same pass: the
    // original walks the parent's LIVE +0x24 array right after the parent's
    // handler (F0x80018140 -> F0x80018230), so a child created by the owner is
    // already one lifecycle step in by the next frame. The title needs this:
    // its sequence's state-0 arm calls each picture-object's start-slide slot
    // and the guard is `+0xC == 1` (F0x8008503C/F0x80084BB0), which only holds
    // if the logo/wordmark were ticked in the frame the create arm made them.
    // Only objects created after this pass began are pulled forward, so the
    // pre-existing depth-first order above is unchanged.
    const passStart = new Set<number>();
    for (const o of this.world.objects) passStart.add(o.addr >>> 0);
    const visited = new Set<number>();
    const tickOne = (addr: number): void => {
      const a = addr >>> 0;
      if (!a || visited.has(a)) return;
      visited.add(a);
      const o = this.world.objects.find((x) => x.addr >>> 0 === a);
      if (!o || !o.alive || this.deadCbs.has(o.addr)) return;
      if (this.objectLifecycle && (mem.read32(o.addr + 0xc) | 0) === OBJECT_LIFECYCLE_DEAD) {
        // F0x80018140: a lifecycle of 3 destroys the object at the top of its
        // turn and returns NULL to the parent's child-array slot.
        destroyTrackedObject(mem, this.world, o.addr);
        return;
      }
      if (mem.read32(o.addr + 0xc) === 1) {
        const pause = mem.read32(o.addr + 0x1c);
        if (pause !== 0) {
          if (pause > 0) mem.write32(o.addr + 0x1c, pause - 1);
          return;
        }
      }
      try {
        this.cpu.call(mem.read32(o.addr + 0x48) >>> 0, [o.addr | 0, mem.read32(o.addr + 0x24)], budgetPerObject);
      } catch (e) {
        if (!(e instanceof NativeTrap)) throw e;
        this.deadCbs.add(o.addr);
        this.disabled.push({ cb: o.cb, pc: e.pc, reason: e.message });
      }
      // F0x80018230: the parent's live child array, walked after its handler.
      const count = mem.read32(o.addr + 0x20) | 0;
      const array = mem.read32(o.addr + 0x24) >>> 0;
      if (!isChildArray(count, array)) return;
      for (let i = 0; i < count; i++) {
        const child = mem.read32(array + i * 4) >>> 0;
        if (child && !passStart.has(child)) tickOne(child);
      }
    };
    for (const o of objs) {
      if (!o.alive || this.deadCbs.has(o.addr)) continue;
      if (this.residentEnd !== 0 && !visited.has(o.addr >>> 0)) {
        tickOne(o.addr);
        continue;
      }
      if (mem.read32(o.addr + 0xc) === 1) {
        const pause = mem.read32(o.addr + 0x1c);
        if (pause !== 0) {
          if (pause > 0) mem.write32(o.addr + 0x1c, pause - 1);
          continue;
        }
      }
      try {
        this.cpu.call(mem.read32(o.addr + 0x48) >>> 0, [o.addr | 0, mem.read32(o.addr + 0x24)], budgetPerObject);
      } catch (e) {
        if (!(e instanceof NativeTrap)) throw e;
        this.deadCbs.add(o.addr);
        this.disabled.push({ cb: o.cb, pc: e.pc, reason: e.message });
      }
    }
    // Rendering is a distinct phase on the console: update callbacks enqueue
    // y-sorted jobs through the layer object, then the layer runner calls the
    // recorded draw callback. Run the same jobs after the update snapshot so
    // their ctx drawSprite calls become browser-visible draw intents.
    for (const job of this.renderJobs) {
      if (job.cb === 0) continue;
      try {
        this.cpu.call(job.cb, [job.obj | 0, job.extra | 0], budgetPerObject);
      } catch (e) {
        if (!(e instanceof NativeTrap)) throw e;
        this.disabled.push({ cb: job.cb, pc: e.pc, reason: `draw: ${e.message}` });
      }
    }
  }

  /**
   * Screen tick order, matching the original schedule. F0x80018140 calls an
   * object's +0x48 handler, then F0x80018230 walks its +0x20 count over the
   * +0x24 array in ascending index order and ticks each child the same way.
   * We reproduce that as a depth-first walk: each not-yet-visited object is
   * visited, then the tracked objects its +0x24 array names, in array order.
   * Roots first in allocation order, then anything the arrays never named, so
   * no live object is dropped. Only pointers that name a tracked object are
   * followed, so a +0x20 word that is not an array count cannot invent order.
   */
  private screenTickOrder(objs: NativeObject[]): NativeObject[] {
    const mem = this.mem;
    const byAddr = new Map<number, NativeObject>();
    for (const o of objs) byAddr.set(o.addr >>> 0, o);
    const visited = new Set<number>();
    const order: NativeObject[] = [];
    const visit = (o: NativeObject): void => {
      const addr = o.addr >>> 0;
      if (visited.has(addr)) return;
      visited.add(addr);
      order.push(o);
      const count = mem.read32(o.addr + 0x20) | 0;
      const array = mem.read32(o.addr + 0x24) >>> 0;
      if (!isChildArray(count, array)) return;
      for (let i = 0; i < count; i++) {
        const child = byAddr.get(mem.read32(array + i * 4) >>> 0);
        if (child) visit(child);
      }
    };
    for (const o of objs) visit(o);
    return order;
  }

  get liveObjects(): NativeObject[] {
    return this.world.objects.filter((o) => o.alive && !this.deadCbs.has(o.addr));
  }

  /**
   * Fire an effect id (the script's SETANIM ≥ 0x320 path). Fieldstg
   * F0x80084dd0 first looks up a live object by id, otherwise constructs one
   * into a free cutscene effect slot, then calls
   * F0x800924c8(obj,id,anim,facing). The
   * registry's +8 function receives only (obj,anim,facing). Either registry
   * function may be null; the id is still consumed when an entry exists.
   */
  fireEffect(id: number, anim = 0, facing = 0): boolean {
    if (this.fieldstgEnd === FIELDSTG_BASE) return false; // no registry loaded
    let entry = 0;
    for (let a = EFFECT_REGISTRY; ; a += 12) {
      const eid = this.mem.read32(a) >>> 0;
      if (eid === 0) return false;
      if (eid === id) { entry = a; break; }
    }
    const ctor = this.mem.read32(entry + 4) >>> 0;
    const draw = this.mem.read32(entry + 8) >>> 0;
    try {
      let nativeObj = this.world.objects.find(
        (o) => o.id === id && o.alive && !this.deadCbs.has(o.addr),
      );
      if (!nativeObj && ctor !== 0) {
        const obj = this.cpu.call(ctor, [id]) >>> 0;
        nativeObj = this.world.objects.find((o) => o.addr === obj && o.alive);
      }
      if (nativeObj && draw !== 0) this.cpu.call(draw, [nativeObj.addr | 0, anim, facing]);
      return true;
    } catch (e) {
      if (!(e instanceof NativeTrap)) throw e;
      this.disabled.push({ cb: ctor, pc: e.pc, reason: `fireEffect(0x${id.toString(16)}): ${e.message}` });
      return false;
    }
  }
}

function cpuStub(cpu: R3000, addr: number, fn: (c: R3000) => number | void): void {
  cpu.setStub(addr, fn);
}
