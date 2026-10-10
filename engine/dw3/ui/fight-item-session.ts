// Frame owner for the translated in-battle ITEM list (pro/fightstg): the seven
// rows a player picks an item from, with the original's paging, the quantity the
// player is carrying, page arrows, description pane and marker highlight.
//
// The screen's own routines are the registered ports in
// native/battle-item-menu.ts (actor construct/tick, widget build, row update,
// draw); the list model and its state machine and the vsync marker blit are the
// ports in native/fight-command-menu.ts, because F0x800959B0 builds its list with
// the shared factory F0x8009B0C8. No PlayStation instruction is executed here.
//
// Services, each an existing translated provider or a documented platform one:
//   object factory F0x80014504        -> TranslatedTaskTree.allocate
//   default methods +0x28/+0x38      -> TranslatedTaskTree default slots
//   child close on destroy           -> TranslatedTaskTree closeTick
//   text box F0x8001AE38, +0x114/+0x118/+0x138/+0x144/+0x148
//                                   -> ShopWidgetServices / dispatchWidgetMethod
//   text box tick F0x8001AC14        -> textRevealTick (the browser paints glyphs)
//   pack by number [0x80044F4C]      -> ScreenTextBanks.source
//   pack entry handle [0x80044F5C]   -> identity handle, painted by the pack renderer
//   pad [0x8004BBC4]                 -> ScreenPad
//   sound [0x80055C48]               -> host.playSound
//   frame counter [0x8004DF98]       -> the display clock's tick
//   picture service F0x8001F648      -> ShopDrawIntents
//   vsync callback [0x8004DE10]      -> dispatched once per display tick
//   F0x800135E8 (the inventory id list), F0x8001355C (the item record),
//   F0x80013584 (the icon cel), [0x80055BF4]/[0x80055BEC] (the id array)
//                                   -> the battle's own inventory, seeded by the
//                                      caller from the same save the merchant
//                                      tasks read (engine/dw3/ui/shop-save-state.ts)
//
// Data-only inputs: the config block at 0x800A3534 and the 12x12 marker strip
// rectangle at 0x800A3654 from the overlay, the three text banks (0x7F the UI
// words, 0x63 the item descriptions, 0x6A the item names) and the resident font
// block. The icon cel table at 0x80042BA8 travels in the module that reads it.
import { NativeMemory } from "../../native/memory.ts";
import { PackedSoundCursor } from "../../systems/packed-sound.ts";
import type { PadButton } from "../../systems/input-map.ts";
import { clearOtag, setDrawMove, CLEAR_OTAG_HEAD } from "../psyq-video.ts";
import { ScreenTextBanks } from "./screen-text-banks.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ScreenPad } from "./screen-services.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { textRevealTick } from "./text-window.ts";
import { callTaskOrWidget, loadResidentResources, type CursorGlyphTable } from "./resident-text-host.ts";
import { drawTextElement, type TextDrawerStepperHost } from "./text-drawer.ts";
import { frameDelta } from "../../systems/frame-clock.ts";
// The battle's item-record rule: the port of the class byte +0 bit 1 the ITEM screen
// tests (`F0x8001355C(id)` -> byte 0 -> `andi 0x2`, pro/fightstg.s:19468-19473).
import { itemUsableInBattle } from "../items.ts";
import {
    commandMenuCreate, commandMenuStateMachine, commandMenuVsyncBlit,
    COMMAND_BLIT_RECT, COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, COMMAND_MENU_UPDATE,
    COMMAND_STRING_BASE, COMMAND_TIME_OBJECT,
    type CommandMenuBlitHost, type CommandMenuMemory,
} from "./native/fight-command-menu.ts";
import {
    itemListActorConstruct, itemListCreateWidgets, itemListDraw, itemListTick,
    itemListUpdateRows, ITEM_BANK_DESCRIPTION, ITEM_BANK_NAME, ITEM_BANK_UI,
    ITEM_HELD_BASE, ITEM_HELD_MAX_ID, ITEM_ICON_CEL_TABLE, ITEM_ICON_CLASS_MAX,
    ITEM_LIST_ACTOR_EXTRA, ITEM_LIST_ACTOR_HANDLER, ITEM_LIST_ACTOR_SIZE,
    ITEM_LIST_CONFIG, ITEM_LIST_ROWS, type ItemListHost, type ItemListMemory,
} from "./native/battle-item-menu.ts";

/** The ITEM data file: the 32-byte config block and the 8-byte blit rectangle. */
export const FIGHT_ITEM_TABLES_SIZE = 40;
export const FIGHT_ITEM_BANKS = [ITEM_BANK_UI, ITEM_BANK_DESCRIPTION, ITEM_BANK_NAME] as const;
/** Widget storage clear of the overlay data and of the task tree's first blocks. */
export const FIGHT_ITEM_WIDGET_ARENA = { first: 0x80180000, limit: 0x801e0000 } as const;
/** The strip the marker blit copies from: VRAM (0, 0xF4), 156x12 (wfightmn loader). */
export const FIGHT_ITEM_STRIP_VRAM = { x: 0, y: 0xf4, w: 156, h: 12 } as const;

export interface FightItemResources {
    tables: Uint8Array;
    font: Uint8Array;
    banks: ReadonlyMap<number, Uint8Array>;
    /** The resident cursor glyph table (0x8004DCE0); forwarded or the shared default. */
    cursorGlyphs?: CursorGlyphTable;
}

export interface FightItemSeedItem {
    /** The item id the original lists. */
    id: number;
    /** How many the player is carrying (the byte at 0x80048DB0 + id). */
    qty: number;
    /** The item record's icon class (byte +9 of the 12-byte record). */
    family: number;
}

export interface FightItemSeed {
    /** The carried items, in the order the original's id table offers them. */
    items: readonly FightItemSeedItem[];
}

export interface FightItemHost {
    playSound(id: number): void;
}

/** One GP0 0x80 VRAM-to-VRAM copy the platform GPU executed this tick. */
export interface FightItemMove {
    srcX: number; srcY: number; dstX: number; dstY: number; w: number; h: number;
}

export class FightItemSession {
    readonly mem = new NativeMemory();
    readonly tree: TranslatedTaskTree;
    readonly widgets: ShopWidgetServices;
    readonly draw = new ShopDrawIntents(this.mem);
    readonly root: number;
    /** The GPU moves the vsync callback queued on the latest display tick. */
    readonly moves: FightItemMove[] = [];
    /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
    private readonly audio = new PackedSoundCursor();
    /** The ids this screen asked the shared queue for. */
    get sounds(): number[] { return this.audio.sounds; }
    readonly seed: FightItemSeed;
    private readonly cell: number;
    private readonly banks: ScreenTextBanks;
    private readonly pad = new ScreenPad();
    private readonly revealHost: Parameters<typeof textRevealTick>[1];
    private readonly blitHost: CommandMenuBlitHost;
    private frame = 0;

    constructor(language: number, seed: FightItemSeed, resources: FightItemResources,
                host: FightItemHost) {
        if (resources.tables.length !== FIGHT_ITEM_TABLES_SIZE) throw new Error("Invalid battle item tables");
        const mem = this.mem;
        this.seed = seed;
        loadResidentResources(mem, { font: resources.font,
            ...(resources.cursorGlyphs ? { cursorGlyphs: resources.cursorGlyphs } : {}), ranges: [
            { base: ITEM_LIST_CONFIG, bytes: resources.tables.subarray(0, 32) },
            { base: COMMAND_BLIT_RECT, bytes: resources.tables.subarray(32, 40) },
        ] });
        this.banks = new ScreenTextBanks(mem, language, FIGHT_ITEM_BANKS, resources.banks, "battle item");
        this.widgets = new ShopWidgetServices(mem, this.banks as never, FIGHT_ITEM_WIDGET_ARENA);
        mem.write32(COMMAND_STRING_BASE, language);

        // The held-count table the original reads twice: once to decide which
        // ids the list offers, once for the quantity figure.
        for (let id = 1; id <= ITEM_HELD_MAX_ID; id++) mem.write8(ITEM_HELD_BASE + id, 0);
        for (const item of seed.items) {
            mem.write8(ITEM_HELD_BASE + item.id, item.qty & 0xff);
        }
        mem.write32(COMMAND_TIME_OBJECT, 0);
        this.cell = this.widgets.arena.alloc(8, 4);

        const playSound = (id: number): void => { this.audio.play(id); host.playSound(id); };
        // The call sites compose the bank as the language byte at D0x8005cca8
        // plus the literal offset (`lw $a0, -0x3358($v0); addiu $a0, 0x6a`), so
        // `bank` is already the language-relative id.
        const resourceBase = (bank: number): number => this.banks.source(bank);
        // F0x8001355C(id) and the screen's own flag test. The screen resolves the
        // item's effect record and keeps it when byte +0 bit 1 is set
        // (pro/fightstg.s:19468-19473) -- one rule over the item table, not an
        // allowlist of whatever ids the caller happened to pass.
        const menuHost: ItemListHost = {
            allocateActor: () => this.tree.allocate(ITEM_LIST_ACTOR_HANDLER, ITEM_LIST_ACTOR_SIZE, ITEM_LIST_ACTOR_EXTRA),
            // F0x8009B0C8 is the shared factory: the list model is the same
            // 0xA8 object the command menu builds, with this screen's config.
            createModel: (config) => commandMenuCreate(
                mem as never, config,
                { allocateMenu: () => this.tree.allocate(COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, 0) } as never,
            ),
            // F0x800135E8(kind, dest): the id list the battle list offers. The
            // seed already filtered it by held count, which is the only test
            // that service applies for kind 1.
            inventoryList: (_kind, dest) => {
                seed.items.forEach((item, i) => mem.write16(dest + i * 2, item.id & 0xffff));
                mem.write16(dest + seed.items.length * 2, 0);
                return seed.items.length;
            },
            inventoryRecordFlag: (id) => itemUsableInBattle(id),
            itemIconCel: (id) => {
                const item = seed.items.find((entry) => entry.id === id);
                const family = item?.family ?? 0;
                return ITEM_ICON_CEL_TABLE[Math.min(family, ITEM_ICON_CLASS_MAX)] ?? 0;
            },
            allocShorts: (bytes) => this.widgets.arena.alloc(bytes, 2),
            freeShorts: (ptr) => { if (this.widgets.arena.has(ptr)) this.widgets.arena.free(ptr); },
            createTextElement: (target, kind, x, y) => this.widgets.createTextElement(target, kind, x, y),
            resourceBase,
            packResolve: (handle) => this.draw.packResolve(handle),
            padRead: () => this.pad.pressed(),
            padReadA: () => this.pad.pressed(),
            padReadB: () => this.pad.repeated(),
            playSound,
            frameCounter: () => this.frame,
            initDrawContext: () => this.draw.initDrawContext(),
            setLayer: this.draw.setLayer,
            setOrigin: this.draw.setOrigin,
            drawSprite: this.draw.drawSprite,
            callMethod: (target, slot, args) => { callTaskOrWidget(mem, this.tree, this.widgets, target, slot, args); },
        };
        const otAddress = this.widgets.arena.alloc(8, 4);
        const packetArea = this.widgets.arena.alloc(0x4000, 4);
        const drawScratch = this.widgets.arena.alloc(0x48, 4);
        const drawerHost: TextDrawerStepperHost = {
            viewForKey: () => 1,
            bucketFor: () => otAddress,
            packetCursor: () => packetArea,
            flushPacketCursor: () => {},
            rotMatrixYXZ: () => { throw new Error("Battle item: rotated text is not translated"); },
            scaleMatrix: () => { throw new Error("Battle item: scaled text is not translated"); },
            applyMatrixSV: () => { throw new Error("Battle item: transformed text is not translated"); },
            alloc: this.widgets.arena.alloc,
            free: this.widgets.arena.free,
            stringById: (bank, id) => this.banks.stringById(mem, bank, id),
        };
        this.revealHost = {
            draw: (self) => drawTextElement(mem, drawerHost, self, drawScratch),
            playPackedSound: playSound,
            padButtonWord: () => this.pad.pressed(),
            logicalButtonBit: (code) => code,
            free: (ptr) => { if (this.widgets.arena.has(ptr)) this.widgets.arena.free(ptr); },
        };
        this.blitHost = {
            breakDraw: () => 0,
            clearOTag: (ot, count) => {
                clearOtag(mem, ot, count, { debugDispatch: () => { throw new Error("libgpu debug output is not translated"); } });
            },
            setDrawMove: (packet, rect, x, y) => setDrawMove(mem, packet, rect, x, y),
            drawSync: () => 0,
            continueDraw: (ot) => this.executeChain(ot),
        };

        const classes = new Map<number, TranslatedTaskClass>();
        classes.set(ITEM_LIST_ACTOR_HANDLER, {
            name: "battle item list screen", childSlots: [0], terminalTick: true,
            tick: (actor, children) => itemListTick(mem as ItemListMemory, actor, children, menuHost),
        });
        classes.set(COMMAND_MENU_HANDLER, {
            name: "battle list model", childSlots: [], terminalTick: true, closeTick: true,
            tick: (menu) => commandMenuStateMachine(mem, menu, menuHost as never),
        });
        this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
        this.root = itemListActorConstruct(mem, this.cell, menuHost);
    }

    /** One display tick. */
    tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
        this.frame = displayTick ?? this.frame + 1;
        this.draw.beginFrame(this.frame);
        this.moves.length = 0;
        this.pad.update(buttons, this.frame);
        this.tree.tick(this.root);
        this.widgets.forEachText((w) => textRevealTick(this.mem, this.revealHost, w));
        this.vsync();
    }

    /** The resident vsync handler's hook: [0x8004DE10]([0x8004DE14]). */
    private vsync(): void {
        const hook = this.mem.read32(COMMAND_TIME_OBJECT) >>> 0;
        if (hook === 0) return;
        if (hook !== COMMAND_MENU_UPDATE) throw new Error(`Untranslated vsync callback ${hook.toString(16)}`);
        commandMenuVsyncBlit(this.mem, this.mem.read32(COMMAND_TIME_OBJECT + 4) >>> 0, this.blitHost);
    }

    /** Platform GPU: run the packets linked from `ot` up to the libgpu terminator. */
    private executeChain(ot: number): void {
        let node = ot >>> 0;
        for (let guard = 0; guard < 64; guard++) {
            if (node === CLEAR_OTAG_HEAD) return;
            const tag = this.mem.read32(node) >>> 0;
            const length = tag >>> 24;
            for (let i = 0; i < length;) {
                const word = this.mem.read32(node + 4 + i * 4) >>> 0;
                const command = word >>> 24;
                if (command === 0x01) { i += 1; continue; }
                if (command === 0x80 && i + 4 <= length) {
                    const src = this.mem.read32(node + 8 + i * 4) >>> 0;
                    const dst = this.mem.read32(node + 12 + i * 4) >>> 0;
                    const size = this.mem.read32(node + 16 + i * 4) >>> 0;
                    this.moves.push({ srcX: src & 0xffff, srcY: src >>> 16, dstX: dst & 0xffff, dstY: dst >>> 16,
                        w: size & 0xffff, h: size >>> 16 });
                    i += 4;
                    continue;
                }
                throw new Error(`Battle item: untranslated GPU command ${command.toString(16)}`);
            }
            const next = tag & 0xffffff;
            if (next === 0xffffff) return;
            node = (0x80000000 | next) >>> 0;
        }
        throw new Error("Battle item: GPU chain does not terminate");
    }

    finished(): boolean { return !this.tree.tasks.has(this.root); }

    /** The chosen item id, -2 for a cancel, or null while the list is open. */
    chosen(): number | null {
        const value = this.mem.read32(this.cell) | 0;
        return value === -1 ? null : value;
    }

    /** True once the screen reads the pad (state 1): the list is built and live. */
    ready(): boolean {
        return this.tree.tasks.has(this.root) && (this.mem.read32(this.root + 0x0c) | 0) === 1;
    }

    /** The selected row the list currently shows. */
    selection(): number | null {
        const menu = this.model();
        return menu ? this.mem.read32(menu + 0x50) | 0 : null;
    }

    /** The page the list currently shows (0-based). */
    page(): number {
        return this.tree.tasks.has(this.root) ? this.mem.read32(this.root + 0x388) | 0 : 0;
    }

    /** The rows the model shows on the current page. */
    rows(): number {
        const menu = this.model();
        return menu ? this.mem.read32(menu + 0x58) | 0 : 0;
    }

    /** How many items the list was built with. */
    count(): number {
        return this.tree.tasks.has(this.root) ? this.mem.read32(this.root + 0x384) | 0 : 0;
    }

    /** The ids the list was built with, in order. */
    ids(): number[] {
        if (!this.tree.tasks.has(this.root)) return [];
        const base = this.mem.read32(this.root + 0x380) >>> 0;
        const count = this.mem.read32(this.root + 0x384) | 0;
        const out: number[] = [];
        for (let i = 0; i < count; i++) out.push(this.mem.read16s(base + i * 2) | 0);
        return out;
    }

    /** Whether the vsync marker callback is installed. */
    vsyncInstalled(): boolean { return (this.mem.read32(COMMAND_TIME_OBJECT) >>> 0) !== 0; }

    /** Dispose of every task (the battle left the ITEM phase another way). */
    dispose(): void { this.tree.dispose(this.root); }

    /** The list model object, once the build has created it. */
    private model(): number | null {
        if (!this.tree.tasks.has(this.root)) return null;
        const slot = this.tree.tasks.get(this.root)!.children;
        const menu = this.mem.read32(slot) >>> 0;
        return menu && this.tree.tasks.has(menu) ? menu : null;
    }
}

/** How many pages a seed's item count fills at seven rows a page. */
export function itemListPageCount(count: number): number {
    return count === 0 ? 0 : Math.ceil(count / ITEM_LIST_ROWS);
}