// Frame owner for the translated in-battle TECH list (pro/fightstg): the six
// rows a player picks a technique from, with the original's paging, greyed
// unaffordable rows, page arrows, description pane and marker highlight.
//
// The screen's own routines are the registered ports in
// native/battle-tech-menu.ts (actor construct/tick, widget build, row update,
// draw); the list model and its state machine and the vsync marker blit are the
// ports in native/fight-command-menu.ts, because F0x800967A0 builds its list with
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
//   [0x8005B44C]/[0x8005B46C]/[0x8005B47C] and [0x800A466C]
//                                   -> the battle's own technique data, seeded
//                                      by the caller (the walker already decodes
//                                      the technique words, their prices and MP)
//
// Data-only inputs: the config block at 0x800A3554 and the 12x12 marker strip
// rectangle at 0x800A3654 from the overlay, the three text banks (0x7F the UI
// words, 0x9B the technique descriptions, 0xA2 the technique names) and the
// resident font block.
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
import {
    commandMenuCreate, commandMenuStateMachine, commandMenuVsyncBlit,
    COMMAND_BLIT_RECT, COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, COMMAND_MENU_UPDATE,
    COMMAND_STRING_BASE, COMMAND_TIME_OBJECT,
    type CommandMenuBlitHost, type CommandMenuMemory,
} from "./native/fight-command-menu.ts";
import {
    techListActorConstruct, techListCreateWidgets, techListDraw, techListTick,
    techListUpdateRows, TECH_BANK_DESCRIPTION, TECH_BANK_NAME, TECH_BANK_UI,
    TECH_LIST_ACTOR_EXTRA, TECH_LIST_ACTOR_HANDLER, TECH_LIST_ACTOR_SIZE,
    TECH_LIST_CONFIG, TECH_LIST_PAGE_FILL, TECH_LIST_PAGE_IDS, TECH_LIST_PAGE_STRIDE,
    TECH_ICON_TABLE, TECH_ICON_TABLE_SIZE, TECH_LIST_ROWS, TECH_MEMBER_BLOCK,
    TECH_MEMBER_STRIDE, TECH_PARTY_BASE,
    TECH_PARTY_INDEX, TECH_PARTY_MAX_MP, TECH_PARTY_MP, TECH_PARTY_NO_CHARGE,
    TECH_PARTY_STRIDE, TECH_PARTY_TECH_COUNT, TECH_RESULT_CANCEL,
    type TechListHost, type TechListMemory,
} from "./native/battle-tech-menu.ts";

/** The TECH data file: the 32-byte config block, the 8-byte blit rectangle, then
 *  the exe's technique icon table. The file carries that table in a 512-entry
 *  window; only its first TECH_ICON_TABLE_ENTRIES entries are the table (see
 *  battle-tech-menu.ts), so that is what this screen copies into RAM. */
export const FIGHT_TECH_TABLES_SIZE = 40 + 0x12 * 512;
/** Where the icon table starts inside the file, and how much of it is the table. */
export const FIGHT_TECH_ICON_OFFSET = 40;
export const FIGHT_TECH_ICON_SIZE = TECH_ICON_TABLE_SIZE;
export const FIGHT_TECH_BANKS = [TECH_BANK_UI, TECH_BANK_DESCRIPTION, TECH_BANK_NAME] as const;
/** Widget storage clear of the overlay data and of the task tree's first blocks. */
export const FIGHT_TECH_WIDGET_ARENA = { first: 0x80180000, limit: 0x801e0000 } as const;
/** The strip the marker blit copies from: VRAM (0, 0xF4), 156x12 (wfightmn loader). */
export const FIGHT_TECH_STRIP_VRAM = { x: 0, y: 0xf4, w: 156, h: 12 } as const;

export interface FightTechResources {
    tables: Uint8Array;
    font: Uint8Array;
    banks: ReadonlyMap<number, Uint8Array>;
    /** The resident cursor glyph table (0x8004DCE0); forwarded or the shared default. */
    cursorGlyphs?: CursorGlyphTable;
}

export interface FightTechTechnique {
    /** The list entry word: 13 bits of technique id plus the two flag bits. */
    word: number;
    /** The MP price [0x800A466C](0, entry). */
    cost: number;
}

export interface FightTechSeed {
    /** The acting party slot, 0..2 ([0x800A4468]). */
    activeIndex: number;
    /** That member's current MP (party record +0x0C). */
    mp: number;
    /** That member's maximum MP (party record +0x0A). */
    maxMp: number;
    /** party record +0x1A: when set the list neither greys nor charges MP. */
    noCharge: number;
    /** The member's technique list, in the order the original's pages hold it. */
    techniques: readonly FightTechTechnique[];
}

export interface FightTechHost {
    playSound(id: number): void;
}

/** One GP0 0x80 VRAM-to-VRAM copy the platform GPU executed this tick. */
export interface FightTechMove {
    srcX: number; srcY: number; dstX: number; dstY: number; w: number; h: number;
}

export class FightTechSession {
    readonly mem = new NativeMemory();
    readonly tree: TranslatedTaskTree;
    readonly widgets: ShopWidgetServices;
    readonly draw = new ShopDrawIntents(this.mem);
    readonly root: number;
    /** The GPU moves the vsync callback queued on the latest display tick. */
    readonly moves: FightTechMove[] = [];
    /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
    private readonly audio = new PackedSoundCursor();
    /** The ids this screen asked the shared queue for. */
    get sounds(): number[] { return this.audio.sounds; }
    readonly seed: FightTechSeed;
    private readonly cell: number;
    private readonly banks: ScreenTextBanks;
    private readonly pad = new ScreenPad();
    private readonly revealHost: Parameters<typeof textRevealTick>[1];
    private readonly blitHost: CommandMenuBlitHost;
    private readonly pages: number;
    private frame = 0;

    constructor(language: number, seed: FightTechSeed, resources: FightTechResources,
                host: FightTechHost) {
        if (resources.tables.length !== FIGHT_TECH_TABLES_SIZE) throw new Error("Invalid battle tech tables");
        if (!Number.isInteger(seed.activeIndex) || seed.activeIndex < 0 || seed.activeIndex > 2) {
            throw new Error("Invalid battle tech party slot");
        }
        this.seed = seed;
        const mem = this.mem;
        loadResidentResources(mem, { font: resources.font,
            ...(resources.cursorGlyphs ? { cursorGlyphs: resources.cursorGlyphs } : {}), ranges: [
            { base: TECH_LIST_CONFIG, bytes: resources.tables.subarray(0, 32) },
            { base: COMMAND_BLIT_RECT, bytes: resources.tables.subarray(32, 40) },
            // The table itself, cut at its own end. The file's 512-entry window
            // runs 0x4DA bytes past D0x80044B02, over the exe's word table and
            // over both pack-service pointers, so the tail is left alone.
            {
                base: TECH_ICON_TABLE,
                bytes: resources.tables.subarray(
                    FIGHT_TECH_ICON_OFFSET, FIGHT_TECH_ICON_OFFSET + FIGHT_TECH_ICON_SIZE),
            },
        ] });
        this.banks = new ScreenTextBanks(mem, language, FIGHT_TECH_BANKS, resources.banks, "battle tech");
        this.widgets = new ShopWidgetServices(mem, this.banks as never, FIGHT_TECH_WIDGET_ARENA);
        mem.write32(COMMAND_STRING_BASE, language);
        mem.write32(TECH_PARTY_INDEX, seed.activeIndex);

        // The party record the screen reads: its own fields, and the member's
        // technique word block, which the original reads at 0x8003EF5C + 0x58*member.
        const party = TECH_PARTY_BASE + seed.activeIndex * TECH_PARTY_STRIDE;
        mem.write16(party + TECH_PARTY_MP, seed.mp & 0xffff);
        mem.write16(party + TECH_PARTY_MAX_MP, seed.maxMp & 0xffff);
        mem.write8(party + TECH_PARTY_NO_CHARGE, seed.noCharge & 0xff);
        mem.write16(party + TECH_PARTY_TECH_COUNT, seed.techniques.length & 0xffff);
        const block = TECH_MEMBER_BLOCK;
        seed.techniques.forEach((technique, i) => mem.write16(block + i * 2, technique.word & 0xffff));
        mem.write16(block + 0x28, (seed.techniques[0]?.word ?? 0) & 0xffff);
        this.pages = Math.ceil(seed.techniques.length / TECH_LIST_ROWS) || 1;
        mem.write32(COMMAND_TIME_OBJECT, 0);
        this.cell = this.widgets.arena.alloc(8, 4);

        const playSound = (id: number): void => { this.audio.play(id); host.playSound(id); };
        // The call sites compose the bank as the language byte at D0x8005cca8
        // plus the offset (`lw $a0, -0x3358($v0); addiu $a0, 0xa2`), and the port
        // reads that word from COMMAND_STRING_BASE, which the session seeded
        // above; `bank` is therefore already the language-relative id.
        const resourceBase = (bank: number): number => this.banks.source(bank);
        let pageCursor = 0;
        const menuHost: TechListHost = {
            allocateActor: () => this.tree.allocate(TECH_LIST_ACTOR_HANDLER, TECH_LIST_ACTOR_SIZE, TECH_LIST_ACTOR_EXTRA),
            // F0x8009B0C8 is the shared factory: the list model is the same
            // 0xA8 object the command menu builds, with this screen's config.
            createModel: (config) => commandMenuCreate(
                mem as never, config,
                { allocateMenu: () => this.tree.allocate(COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, 0) } as never,
            ),
            activeMember: () => 0,
            techListBegin: (_member, headerBase) => {
                // One halfword per page of technique words: the page table the
                // screen reads back before asking for that page's ids.
                for (let page = 0; page < this.pages; page++) {
                    mem.write16(headerBase + page * 2, page * TECH_LIST_ROWS);
                }
                pageCursor = 0;
                return this.pages;
            },
            techListPage: (_member, header, dest) => {
                // The status halfword is the member's technique count: the
                // original skips a page whose value disagrees with party +0x00.
                mem.write16(dest, seed.techniques.length & 0xffff);
                const first = pageCursor * TECH_LIST_ROWS;
                for (let i = 0; i < TECH_LIST_ROWS; i++) {
                    const technique = seed.techniques[first + i];
                    mem.write16(dest + TECH_LIST_PAGE_IDS - TECH_LIST_PAGE_FILL + i * 2,
                        technique ? (technique.word & 0xffff) : 0);
                }
                pageCursor += 1;
                void header;
            },
            preselectRecord: () => null,
            techCost: (entry) => {
                const index = this.entryIndex(entry);
                return index < 0 ? 0 : (seed.techniques[index]?.cost ?? 0);
            },
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
            rotMatrixYXZ: () => { throw new Error("Battle tech: rotated text is not translated"); },
            scaleMatrix: () => { throw new Error("Battle tech: scaled text is not translated"); },
            applyMatrixSV: () => { throw new Error("Battle tech: transformed text is not translated"); },
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
        classes.set(TECH_LIST_ACTOR_HANDLER, {
            name: "battle tech list screen", childSlots: [0], terminalTick: true,
            tick: (actor, children) => techListTick(mem, actor, children, menuHost),
        });
        classes.set(COMMAND_MENU_HANDLER, {
            name: "battle list model", childSlots: [], terminalTick: true, closeTick: true,
            tick: (menu) => commandMenuStateMachine(mem, menu, menuHost as never),
        });
        this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
        this.root = techListActorConstruct(mem, this.cell, menuHost);
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
                throw new Error(`Battle tech: untranslated GPU command ${command.toString(16)}`);
            }
            const next = tag & 0xffffff;
            if (next === 0xffffff) return;
            node = (0x80000000 | next) >>> 0;
        }
        throw new Error("Battle tech: GPU chain does not terminate");
    }

    finished(): boolean { return !this.tree.tasks.has(this.root); }

    /** The chosen technique id, -2 for a cancel, or null while the list is open. */
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

    /** The page the list currently shows (0-based; -1 when L1 walked off the front). */
    page(): number {
        return this.tree.tasks.has(this.root) ? this.mem.read32(this.root + 0xd0) | 0 : 0;
    }

    /** The rows the model shows on the current page. */
    rows(): number {
        const menu = this.model();
        return menu ? this.mem.read32(menu + 0x58) | 0 : 0;
    }

    /** Whether the vsync marker callback is installed. */
    vsyncInstalled(): boolean { return (this.mem.read32(COMMAND_TIME_OBJECT) >>> 0) !== 0; }

    /** Dispose of every task (the battle left the TECH phase another way). */
    dispose(): void { this.tree.dispose(this.root); }

    /** The list model object, once the build has created it. */
    private model(): number | null {
        if (!this.tree.tasks.has(this.root)) return null;
        const slot = this.tree.tasks.get(this.root)!.children;
        const menu = this.mem.read32(slot) >>> 0;
        return menu && this.tree.tasks.has(menu) ? menu : null;
    }

    /** The seed's technique whose entry word matches, for the price lookup. */
    private entryIndex(entry: number): number {
        const id = entry & 0x1fff;
        const found = this.seed.techniques.findIndex((technique) => (technique.word & 0x1fff) === id);
        return found;
    }
}

/** The technique words and prices a battle turn offers the TECH list. */
export function techListFromSkills(skills: readonly { techWord?: number; cost: number }[]): FightTechTechnique[] {
    return skills.map((skill) => ({ word: Number(skill.techWord ?? 0) & 0xffff, cost: skill.cost | 0 }));
}