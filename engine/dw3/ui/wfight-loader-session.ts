// Frame owner for the translated battle boot loader (pro/wfightmn): the task
// the battle starts before the first command list. Step G of
// docs/plans/2026-09-28-translated-game-completion-plan.md.
//
// The loader's own routines are the registered ports in native/wfight-menu.ts
// (root F0x800A6414, tick F0x800A5ECC with its seven phases). This file
// composes them into one task tree and supplies the services the loader calls.
// No PlayStation instruction is executed.
//
// What the loader does, measured from wfightmn.s L0x000000ec-L0x00000630:
//   phase 0      asks the resident cache for the five scene packs
//                0x456, 0x79E, 0x7AE, 0x7E1, 0x7E3
//   phase 1      waits for 0x456, builds the upload context and uploads
//                PGFGTW00 entry 1 (the RLEN records, two per pack) to VRAM
//                (0x200, 0) and entry 0 (the 156x12 marker strip the command
//                list's vsync blit copies from) to VRAM (0, 0xF4)
//   phases 2..5  wait for one pack each and upload its records to VRAM
//                (0x140, 0x100), (0x1C0, 0x100), (0x200, 0x100), (0x240, 0x100)
//   phase 6      releases the five packs, then steps its sub-state
//   sub-state 1  asks for eight text banks (0x286, 0x455 and the current
//                language's 0x7F, 0x4E, 0xA2, 0x9B, 0x6A, 0x63 families), waits
//                until all are resident, then SET_STATE(self, 3): it retires.
//
// Services, each an existing translated provider or a documented platform one:
//   object factory F0x80014504        -> TranslatedTaskTree.allocate (zeroing)
//   default methods +0x28/+0x38/+0x3C/+0x40 -> TranslatedTaskTree defaults
//   cache poll [0x80044B38+0x404]     -> resource-service.ts cachePoll
//   cache request [+0x40C]            -> cacheAcquire
//   cache release [+0x418]            -> freeCacheSlotBlock
//   resource base [+0x414]            -> resourceGetBase
//   pack entry resolver [+0x424]      -> packResolveHandle (F0x800140D8)
//   cache tick F0x80013CDC            -> cacheServicePending, once per display tick
//   upload context F0x8001FFA8 and its slots +0x20/+0x24/+0x2C
//                                     -> card-view.ts cardViewHelper* ports
//   LoadImage F0x80025B14             -> platform GPU: recorded in a VramMap
//   DrawSync(0)                       -> platform GPU: always idle
//   heap [0x8004B5F4]                 -> platform: ShopWidgetArena
//   disc transfer [0x80044B34]        -> platform: the shipped pack bytes
//
// Platform contract for the disc transfer: the five packs are copied from the
// data build. The eight text banks are requested and awaited but the loader
// never reads their bytes, and the walker has no consumer for them, so the
// data build ships only their sector counts (the cache sizes each buffer from
// them) and their transfer completes with the buffer left zeroed.
import { NativeMemory } from "../../native/memory.ts";
import { VramMap } from "../../native/vram.ts";
import {
  cacheAcquire, cachePoll, cacheServicePending, freeCacheSlotBlock, packResolveHandle,
  resourceGetBase, CACHE_SLOT_COUNT, FRAME_CLOCK_CELL, LBA_LEN_SECTORS,
  type CacheServiceHost,
} from "../resource-service.ts";
import {
  cardViewHelperInit, cardViewHelperSetPairA, cardViewHelperUpload, cardViewHelperUploadPack,
  type CardViewHost, type PackUploadHost,
} from "./card-view.ts";
import { ShopWidgetArena } from "./shop-widget-services.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import {
  wfightMenuFactory, wfightMenuTick, WFIGHT_MENU_HANDLER, WFIGHT_MENU_SIZE,
  WFIGHT_MENU_STRING_BASE, type WfightMenuHost,
} from "./native/wfight-menu.ts";

/** One resource the loader may ask the cache for. */
export interface WfightLoaderResource {
  id: number;
  role: string;
  /** The cache sizes the buffer from this: sectors << 11 bytes. */
  sectors: number;
  /** The shipped pack file, or null when the loader never reads the bytes. */
  file: string | null;
}

export interface WfightLoaderManifest { resources: WfightLoaderResource[] }

export interface WfightLoaderResources {
  manifest: WfightLoaderManifest;
  /** The shipped pack bytes by resource id. */
  packs: ReadonlyMap<number, Uint8Array>;
}

/** The arena the cache buffers, the upload scratch and the context live in. */
export const WFIGHT_LOADER_ARENA = { first: 0x80110000, limit: 0x801f0000 } as const;
/** The VRAM rectangle of the command list's marker strip. */
export const WFIGHT_STRIP_VRAM = { x: 0, y: 0xf4, w: 156, h: 12 } as const;
/** The upload context's slots the loader calls through. */
const CONTEXT_UPLOAD = 0x20;
const CONTEXT_SET_DESTINATION = 0x24;
const CONTEXT_UPLOAD_PACK = 0x2c;

/** One LoadImage the platform GPU received, in order. */
export interface WfightUpload { x: number; y: number; w: number; h: number }
/** One disc transfer the platform served. */
export interface WfightTransfer { id: number; bytes: number; shipped: boolean }

export class WfightLoaderSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly root: number;
  readonly vram = new VramMap();
  /** Every resource id the loader asked for, in request order (first request only). */
  readonly requested: number[] = [];
  /** Every resource id the loader released, in order. */
  readonly released: number[] = [];
  readonly uploads: WfightUpload[] = [];
  readonly transfers: WfightTransfer[] = [];
  private readonly arena: ShopWidgetArena;
  private readonly known = new Map<number, WfightLoaderResource>();
  private readonly context: number;
  private frame = 0;

  constructor(language: number, resources: WfightLoaderResources) {
    if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error("Battle loader language index is invalid");
    const mem = this.mem;
    this.arena = new ShopWidgetArena(mem, WFIGHT_LOADER_ARENA);
    for (const resource of resources.manifest.resources) {
      if (!Number.isInteger(resource.id) || resource.id <= 0 || resource.id >= 0x10000 ||
          !Number.isInteger(resource.sectors) || resource.sectors <= 0) {
        throw new Error("Invalid battle loader resource");
      }
      if (resource.file !== null && (resources.packs.get(resource.id)?.length ?? 0) === 0) {
        throw new Error(`Battle loader pack ${resource.id.toString(16)} is missing`);
      }
      this.known.set(resource.id, resource);
      // The resident sector table the cache sizes its buffers from (EXE data).
      mem.write16(LBA_LEN_SECTORS + resource.id * 2, resource.sectors);
    }
    mem.write32(WFIGHT_MENU_STRING_BASE, language);
    this.context = this.arena.alloc(0x34, 4);

    const known = (id: number): number => {
      id &= 0xffff;
      if (!this.known.has(id)) throw new Error(`Unknown battle loader resource ${id.toString(16)}`);
      return id;
    };
    const cacheHost: CacheServiceHost & { clock(): number; busyGate(): number } = {
      alloc: (size) => this.arena.alloc(size, 4),
      startTransfer: (id, buffer) => this.startTransfer(known(id), buffer, resources),
      clock: () => this.frame,
      busyGate: () => 0, // Platform: the disc service is never mid-command between display ticks.
    };
    const cardHost: CardViewHost = {
      resourceGetBase: (id) => resourceGetBase(mem, known(id), cacheHost),
      loadImage: (x, y, w, h, data) => {
        this.uploads.push({ x, y, w, h });
        // The transfer counts VRAM halfwords whatever the texel depth (libgpu LoadImage).
        this.vram.upload(x, y, w, h, data, 16, false, (a) => mem.read8(a),
          (a, dest) => dest.set(mem.bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + dest.length)));
      },
      findRegisteredHandleByKey: () => { throw new Error("Battle loader: registered views are not used"); },
      callViewMethod: () => { throw new Error("Battle loader: view methods are not used"); },
    };
    const packHost: PackUploadHost = {
      ...cardHost,
      allocScratch: (size) => this.arena.alloc(size, 4), // heap tag 2 is not distinguished
      free: (ptr) => this.arena.free(ptr),
      drawSync: () => {}, // Platform GPU: every LoadImage completes before the next call.
    };

    const host: WfightMenuHost = {
      allocateActor: () => this.tree.allocate(WFIGHT_MENU_HANDLER, WFIGHT_MENU_SIZE, 0),
      resourceLoaded: (id) => {
        const wanted = known(id);
        return cachePoll(mem, wanted, cacheHost);
      },
      loadResource: (id) => {
        const wanted = known(id);
        if (!this.requested.includes(wanted)) this.requested.push(wanted);
        cacheAcquire(mem, wanted, cacheHost);
      },
      releaseResource: (id) => {
        const wanted = known(id);
        this.released.push(wanted);
        freeCacheSlotBlock(mem, wanted, { freeBlock: (buffer) => this.arena.free(buffer) });
      },
      resourceBase: (id) => resourceGetBase(mem, known(id), cacheHost),
      packResolve: (handle) => packResolveHandle(mem, handle, cacheHost),
      initMenuContext: () => cardViewHelperInit(mem, this.context),
      contextMethod: (slot, args) => {
        switch (slot) {
          case CONTEXT_UPLOAD: cardViewHelperUpload(mem, cardHost, args[0]!); return;
          case CONTEXT_SET_DESTINATION: cardViewHelperSetPairA(mem, args[0]!, args[1]!); return;
          case CONTEXT_UPLOAD_PACK: cardViewHelperUploadPack(mem, packHost, args[0]!); return;
          default: throw new Error(`Battle loader: untranslated upload context slot ${slot.toString(16)}`);
        }
      },
      callMethod: (target, slot, args) => this.tree.callMethod(target, slot, args),
    };
    this.cacheHost = cacheHost;
    const classes = new Map<number, TranslatedTaskClass>();
    classes.set(WFIGHT_MENU_HANDLER, {
      name: "battle boot loader", childSlots: [], terminalTick: true,
      tick: (loader) => wfightMenuTick(mem, loader, host),
    });
    this.tree = new TranslatedTaskTree(mem, classes);
    this.root = wfightMenuFactory(host);
  }

  private readonly cacheHost: CacheServiceHost & { clock(): number; busyGate(): number };

  private startTransfer(id: number, buffer: number, resources: WfightLoaderResources): void {
    const resource = this.known.get(id)!;
    const data = resource.file === null ? undefined : resources.packs.get(id);
    const bytes = data ? Math.min(data.length, resource.sectors << 11) : 0;
    if (data) this.mem.load(data.subarray(0, bytes), buffer);
    this.transfers.push({ id, bytes, shipped: data !== undefined });
  }

  /** One display tick: the resident cache tick, then the loader task. */
  tick(): void {
    this.frame++;
    this.mem.write32(FRAME_CLOCK_CELL, this.frame);
    cacheServicePending(this.mem, this.cacheHost);
    this.tree.tick(this.root);
  }

  /** True once the loader has retired itself (SET_STATE 3) or was disposed. */
  finished(): boolean { return !this.tree.tasks.has(this.root); }

  /** The loader's four nested state counters, while it is alive. */
  state(): { state0: number; state1: number; phase: number } | null {
    if (!this.tree.tasks.has(this.root)) return null;
    return { state0: this.mem.read32(this.root + 0x0c), state1: this.mem.read32(this.root + 0x10),
      phase: this.mem.read32(this.root + 0x14) };
  }

  /** The pixels of the latest upload that exactly filled this VRAM rectangle, or null. */
  vramRegion(x: number, y: number, w: number, h: number): Uint8Array | null {
    const load = this.vram.find(x, y);
    return load && load.x === x && load.y === y && load.w === w && load.h === h ? load.pixels : null;
  }

  /** The command list's marker strip as the loader left it in VRAM (0, 0xF4). */
  stripPixels(): Uint8Array | null {
    const { x, y, w, h } = WFIGHT_STRIP_VRAM;
    return this.vramRegion(x, y, w, h);
  }

  /** How many cache slots are in use (the loader releases its five packs). */
  cacheSlotsInUse(): number {
    let used = 0;
    for (let i = 0; i < CACHE_SLOT_COUNT; i++) {
      if ((this.mem.read32(0x80044b3c + i * 0x10 + 4) | 0) !== 0) used++;
    }
    return used;
  }

  dispose(): void { this.tree.dispose(this.root); }
}
