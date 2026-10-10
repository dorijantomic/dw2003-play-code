// Frame owner for the translated in-battle Digivolve form list (pro/fightstg):
// the row a player picks a new form from, its greyed current form, the clamped
// cursor, the three pages of its stat panel and the three packed sounds.
//
// The screen's own routines are the registered ports in
// native/digivolve-form-menu.ts (actor construct/tick, row update, the panel's
// allocator, its state machine, its captions, its page-zero numbers and its two
// draws); the list model and its state machine and the vsync marker blit are the
// ports in native/fight-command-menu.ts, because F0x80094478 builds its list with
// the shared factory F0x8009B0C8. No PlayStation instruction is executed here.
//
// Services, each an existing translated provider or a documented platform one:
//   object factory F0x80014504        -> TranslatedTaskTree.allocate
//   default methods +0x28/+0x38      -> TranslatedTaskTree default slots
//   child close on destroy           -> TranslatedTaskTree closeTick
//   text box F0x8001AE38, +0x114/+0x118/+0x138/+0x148
//                                   -> ShopWidgetServices / dispatchWidgetMethod
//   text box tick F0x8001AC14        -> textRevealTick (the browser paints glyphs)
//   pack by number [0x80044F4C]      -> ScreenTextBanks.source
//   pack entry handle [0x80044F5C]   -> identity handle, painted by the pack renderer
//   pad [0x8004BBC4]                 -> ScreenPad
//   sound [0x80055C48]               -> host.playSound
//   frame counter [0x8004DF98]       -> the display clock's tick
//   picture service F0x8001F648      -> ShopDrawIntents
//   vsync callback [0x8004DE10]      -> dispatched once per display tick
//   [0x8004B44C]/[0x8004B46C]/[0x8004B47C]/[0x8004B468] and [0x8005CCA0]
//                                   -> the walker's own roster: which profile each
//                                      party slot holds, the four forms that profile
//                                      can reach, its technique words, and the
//                                      per-species record block the screen reads
//
// Data-only inputs: the config block at 0x800A34EC, the page-zero number table at
// 0x800A350C and the 12x12 marker strip rectangle at 0x800A3654 from the overlay,
// the three text banks (0x4E the Digimon names, 0x7F the UI words, 0xA2 the
// technique names) and the resident font block.
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
import {
    commandMenuCreate, commandMenuStateMachine, commandMenuVsyncBlit,
    COMMAND_BLIT_RECT, COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, COMMAND_MENU_UPDATE,
    COMMAND_STRING_BASE, COMMAND_TIME_OBJECT,
    type CommandMenuBlitHost, type CommandMenuMemory,
} from "./native/fight-command-menu.ts";
import {
    formListActorConstruct, formListTick, formPanelTick,
    FORM_BANK_NAME, FORM_BANK_UI, FORM_ICON_TABLE,
    FORM_LIST_CONFIG, FORM_LIST_COUNT, FORM_LIST_CURRENT, FORM_LIST_EXTRA, FORM_LIST_HANDLER,
    FORM_LIST_PAGE, FORM_LIST_SIZE, FORM_PANEL_EXTRA, FORM_PANEL_HANDLER, FORM_PANEL_SIZE,
    FORM_PANEL_PAGE0_TABLE, FORM_PROFILE_BLOCK,
    type FormListHost,
} from "./native/digivolve-form-menu.ts";
import { TECH_ICON_TABLE_SIZE } from "./native/battle-tech-menu.ts";
import {
    createFormPanelHost, seedFormRoster, sweepFormPanels, writeFormPanelProfile,
    type FormPanelMember, type FormPanelOption,
} from "./form-panel-host.ts";
import { gameFormId, profileRecord, walkerIdOf } from "./native/pause-status.ts";

/** The page-zero number table's own length: thirteen three-byte (x, y, slot)
 *  triples, of which F0x80094AD0 reads the first 39. */
export const FIGHT_FORM_PANEL_TABLE_SIZE = 40;
/** The exe's technique table the pages 1-2 draw reads: 443 records of 0x12 bytes,
 *  cut at the first resident word after it (battle-tech-menu.ts). The file below
 *  carries it in a 512-entry window, whose tail is the exe's own words. */
export const FIGHT_FORM_ICON_TABLE_SIZE = TECH_ICON_TABLE_SIZE;
/** Where the icon table starts inside the file. */
export const FIGHT_FORM_ICON_OFFSET = 80;
/** The Digivolve data file: the config block, the blit rectangle, the page-zero
 *  number table, then the exe's technique icon table in a 512-entry window. */
export const FIGHT_FORM_TABLES_SIZE = 32 + 8 + FIGHT_FORM_PANEL_TABLE_SIZE + 0x12 * 512;
export const FIGHT_FORM_BANKS = [FORM_BANK_NAME, FORM_BANK_UI, 0xa2] as const;
/** Widget storage clear of the overlay data and of the task tree's first blocks. */
export const FIGHT_FORM_WIDGET_ARENA = { first: 0x80180000, limit: 0x801e0000 } as const;
/** The strip the marker blit copies from: VRAM (0, 0xF4), 156x12 (wfightmn loader). */
export const FIGHT_FORM_STRIP_VRAM = { x: 0, y: 0xf4, w: 156, h: 12 };

export interface FightFormResources {
    tables: Uint8Array;
    /**
     * The Digimon profile records at 0x8003EF5C, 0x58 bytes a row: the ONE cut
     * every screen showing a Digimon loads (assets/data/digimon_profiles.bin). This
     * screen reads the list's current form (F0x80094504 reads the row's first
     * halfword) and every row's own species record — the six stats at +0x02, the seven
     * elemental halfwords at +0x0E, the page-one headline technique at +0x28 and the
     * name byte at +0x55 — all out of it, indexed with no bound at all
     * (fightstg.s:18056-18066), so it needs every one of the 55 records.
     */
    profiles: Uint8Array;
    font: Uint8Array;
    banks: ReadonlyMap<number, Uint8Array>;
    /** The resident cursor glyph table (0x8004DCE0); forwarded or the shared default. */
    cursorGlyphs?: CursorGlyphTable;
}

/** One form the acting Digimon can take: its species id and its twelve numbers. */
export interface FightFormOption extends FormPanelOption {
    /** The species id the row carries (self+0x60 + 2*row). */
    species: number;
    /** The six halfwords at species record +0x02 the panel sums into +0x70. */
    left: readonly number[];
    /** The seven halfwords at species record +0x0E the panel sums into +0x7C. */
    right: readonly number[];
    /**
     * The six technique entry words the roster's 0x14-byte block for this form
     * carries at +0x08: 13 bits of technique id plus the 0x8000 (signature) and
     * 0x4000 (loadable) flags. Pages one and two list them by name.
     */
    techs: readonly number[];
    /**
     * The form's level, the byte at +0x02 of the same block. Pages one and two
     * print it as the headline number beside the caption.
     */
    level: number;
    /** Digivolution exp banked against the form (the entry's word at +0x04). */
    dvexp: number;
}

/** The acting member, its four rows and its live species. */
export interface FightFormSeed {
    /** [0x800A4468]: the acting party slot, 0..2. */
    activeIndex: number;
    /**
     * The screen's self+0x54. `F0x8009482C` copies the caller's word into it
     * (pro/fightstg.s 0x80094854), and the caller put there the answer of
     * `[0x8004B44C]` — `F0x80016D94`, the ROSTER SLOT the acting party position
     * holds, stored in the delay slot of the allocator call at 0x80092950-0x80092954
     * so `F0x8009482C` reads it. Every helper the screen reaches is keyed by it:
     * the equipped triple `F0x800176AC` resolves (roster record +0x50 at
     * `0x80049494 + slot*0x3DC`), the technique ledger `F0x80017A1C` searches,
     * the roster record `F0x80017174` reads, and the profile block at
     * `0x8003EF5C + 0x58*slot` whose first halfword becomes the list's own first
     * row (0x800944c4-0x8009450c). Rows 0..7 of that table are the eight starters,
     * so that first row is the STARTER species however far the Digimon has
     * digivolved. On the walker side it is `partyPositionRosterSlot`
     * (engine/dw3/roster.ts) — the ONE shared helper, the same one the DNA pane's
     * +0x60 comes from.
     */
    slotIndex: number;
    /**
     * The Digimon the roster record is CURRENTLY in — the species at
     * `0x800A4470 + 0x20*position` +0x00, the walker id the walker's own record
     * carries. It is what the list greys its row with, not what its first row is.
     */
    currentSpecies: number;
    /** The live combatant record's own species, which greys its row. */
    liveSpecies: number;
    /** Whether the live record carries the reserved second form (record +0x1A). */
    reservedForm: number;
    /**
     * `[0x8004B44C]` (`F0x80016D94`) for all three party positions: the roster
     * slot each holds. `memberProfile(position)` is this table, so the carry-over
     * panel reads the same roster the screen does.
     */
    rosterSlots: readonly number[];
    /** The four rows, in the order the profile block lists them. */
    options: readonly FightFormOption[];
    /** The profile block's own pre-selected technique word (profile +0x28). */
    preselected: number;
    /**
     * [0x8004B468](1, dest): the panel's page-zero block the numbers read around.
     * Halfwords 0..18 are the acting Digimon's own battle stats and 19..21 the
     * three buff counters F0x8001104C clears at the start of a battle; the three
     * that survive subtract from STR, DEF and SPD and are what greys those three
     * page-zero numbers.
     */
    panelBlock: readonly number[];
    /**
     * get_equipped (ctx+0x2738, F0x800176ac): the member's three equipped form
     * ids in slot order, -1 (0xFFFF) in an empty slot. The name list filters
     * this triple (a value below 3 is skipped) into its own rows; the panel
     * reads it directly at panel+0x90 + 2*(cursor-1), which is why it is the
     * triple and not the filtered row list.
     */
    equipped?: readonly number[];
}

export interface FightFormHost {
    playSound(id: number): void;
}

/** One GP0 0x80 VRAM-to-VRAM copy the platform GPU executed this tick. */
export interface FightFormMove {
    srcX: number; srcY: number; dstX: number; dstY: number; w: number; h: number;
}

/** Halfwords F0x80017174 copies into the panel's page-zero block (0x2C bytes). */
const FIGHT_FORM_PANEL_BLOCK = 22;

export class FightFormSession {
    readonly mem = new NativeMemory();
    readonly tree: TranslatedTaskTree;
    readonly widgets: ShopWidgetServices;
    readonly draw = new ShopDrawIntents(this.mem);
    readonly root: number;
    /** The GPU moves the vsync callback queued on the latest display tick. */
    readonly moves: FightFormMove[] = [];
    /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
    private readonly audio = new PackedSoundCursor();
    /** The ids this screen asked the shared queue for. */
    get sounds(): number[] { return this.audio.sounds; }
    readonly seed: FightFormSeed;
    private readonly cell: number;
    private readonly banks: ScreenTextBanks;
    private readonly pad = new ScreenPad();
    private readonly revealHost: Parameters<typeof textRevealTick>[1];
    private readonly blitHost: CommandMenuBlitHost;
    private frame = 0;

    constructor(language: number, seed: FightFormSeed, resources: FightFormResources,
                host: FightFormHost) {
        if (resources.tables.length !== FIGHT_FORM_TABLES_SIZE) throw new Error("Invalid battle form tables");
        if (!Number.isInteger(seed.activeIndex) || seed.activeIndex < 0 || seed.activeIndex > 2) {
            throw new Error("Invalid battle form party slot");
        }
        this.seed = seed;
        const mem = this.mem;
        loadResidentResources(mem, { font: resources.font,
            ...(resources.cursorGlyphs ? { cursorGlyphs: resources.cursorGlyphs } : {}), ranges: [
            { base: FORM_LIST_CONFIG, bytes: resources.tables.subarray(0, 32) },
            { base: COMMAND_BLIT_RECT, bytes: resources.tables.subarray(32, 40) },
            // Exactly the table's own forty bytes. The icon table that follows it
            // in the file belongs at FORM_ICON_TABLE in the EXE's data, not here:
            // 0x800A350C and 0x800A3654 (the marker blit's source rectangle) are
            // 0x148 apart, so writing the tail here would land the icon bytes on
            // the blit rectangle and leave the selection bar with a rectangle
            // nobody can draw.
            { base: FORM_PANEL_PAGE0_TABLE, bytes: resources.tables.subarray(40, 80) },
            // And only the table's own 443 records: past them the file holds the
            // exe's word table at 0x80044B02, including both pack-service
            // pointers, so the 512-entry window's tail is left in the file.
            {
                base: FORM_ICON_TABLE,
                bytes: resources.tables.subarray(
                    FIGHT_FORM_ICON_OFFSET, FIGHT_FORM_ICON_OFFSET + FIGHT_FORM_ICON_TABLE_SIZE),
            },
            // The disc's own 55 profile records: this screen reads the current
            // form's species out of the acting profile's row (F0x80094504) and
            // asks the species getter [0x8005CCA0] for every row's record.
            { base: FORM_PROFILE_BLOCK, bytes: resources.profiles },
        ] });
        this.banks = new ScreenTextBanks(mem, language, FIGHT_FORM_BANKS, resources.banks, "battle form");
        this.widgets = new ShopWidgetServices(mem, this.banks as never, FIGHT_FORM_WIDGET_ARENA);
        mem.write32(COMMAND_STRING_BASE, language);

        // The caller speaks the walker's own Digimon ids; the table loaded above
        // is the disc's, whose rows carry the game's own form id in their first
        // halfword. ONE mapping does the turn (`gameFormId`, native/pause-status.ts
        // — the same function the DNA pane's constructor puts its own ids
        // through), and every id this screen is given goes through it here: the
        // acting profile's own species, the live combatant record's species (the
        // row it greys), the four rows' species, the equipped triple and the
        // roster's acquired-form ledger. Handed a walker id straight through, the
        // current form would come back as whichever row happens to hold that
        // number and every row name would be read from the wrong record.
        const formOf = (walkerId: number): number => gameFormId(mem, walkerId);
        const game = {
            ...seed,
            currentSpecies: formOf(seed.currentSpecies),
            liveSpecies: formOf(seed.liveSpecies),
            options: seed.options.map((row) => ({ ...row, species: formOf(row.species) })),
            ...(seed.equipped ? { equipped: seed.equipped.map((id) => formOf(id)) } : {}),
        };

        // The disc's own profile row for this roster slot. Only its +0x28 word is
        // written: the row's first halfword IS the starter species and becomes the
        // list's first row (formListBuild, `FORM_LIST_CURRENT`, `lhu` at
        // 0x8003EF5C + 0x58*(self+0x54)), and nothing in the original writes it.
        writeFormPanelProfile(mem, game.slotIndex, game.preselected);
        // The live combatant record, which greys its own row and answers confirm.
        const party = 0x800a4470 + game.activeIndex * 0x20;
        mem.write16(party + 0x00, game.liveSpecies & 0xffff);
        mem.write8(party + 0x1a, game.reservedForm & 0xff);
        mem.write32(0x800a4468, game.activeIndex);
        mem.write32(COMMAND_TIME_OBJECT, 0);
        this.cell = this.widgets.arena.alloc(8, 4);
        this.seedRoster(mem, game);

        const playSound = (id: number): void => { this.audio.play(id); host.playSound(id); };
        const resourceBase = (bank: number): number => this.banks.source(bank);
        const records = new Map<number, number>();
        // The species record for a form id is the disc's own profile row —
        // [0x8005CCA0] (F0x800134E8) answers that row's address, and the panel
        // reads the six stats at +0x02, the seven elemental halfwords at +0x0E and
        // the name byte at +0x55 out of it. The walker's per-species numbers were
        // byte-for-byte equal to it (55 of 55 rows, +0x02/+0x0E/+0x28/+0x55), so
        // there is nothing left to synthesize: the row IS the record, and a form
        // the table does not hold answers 0, which leaves the row unnamed exactly
        // as the original's `beqz` on the species getter does.
        const recordFor = (species: number): number => {
            const found = records.get(species);
            if (found !== undefined) return found;
            const address = profileRecord(mem as never, species) >>> 0;
            records.set(species, address);
            return address;
        };
        const classes = new Map<number, TranslatedTaskClass>();
        classes.set(FORM_LIST_HANDLER, {
            name: "battle digivolve form list", childSlots: [0x00, 0x14, 0x18], terminalTick: true,
            tick: (actor, children) => formListTick(mem, actor, children, menuHost),
        });
        classes.set(COMMAND_MENU_HANDLER, {
            name: "battle list model", childSlots: [], terminalTick: true, closeTick: true,
            tick: (menu) => commandMenuStateMachine(mem, menu, menuHost as never),
        });
        classes.set(FORM_PANEL_HANDLER, {
            name: "battle digivolve form panel", childSlots: [], terminalTick: true, closeTick: true,
            tick: (panel, children) => formPanelTick(mem, panel, children, menuHost),
        });
        this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));

        // The panel (F0x800953E4, tick 0x80094F08) is the shared carry-over
        // screen: form-panel-host.ts supplies its host and its roster reads, and
        // the in-battle DNA pane opens the same object through the same helper.
        const menuHost: FormListHost = createFormPanelHost({
            mem, tree: this.tree, widgets: this.widgets, banks: this.banks,
            draw: this.draw, pad: this.pad, playSound,
            frame: () => this.frame,
            allocateActor: () => this.tree.allocate(FORM_LIST_HANDLER, FORM_LIST_SIZE, FORM_LIST_EXTRA),
            // F0x8009B0C8 is the shared factory: the list model is the same 0xA8
            // object the command menu builds, with this screen's config block.
            createModel: (config) => commandMenuCreate(
                mem as never, config,
                { allocateMenu: () => this.tree.allocate(COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, 0) } as never,
            ),
            memberProfile: (pos) => game.rosterSlots[pos] ?? pos,
            recordFor: (species) => (records.has(species) ? records.get(species)! : recordFor(species)),
        });
        const otAddress = this.widgets.arena.alloc(8, 4);
        const packetArea = this.widgets.arena.alloc(0x4000, 4);
        const drawScratch = this.widgets.arena.alloc(0x48, 4);
        const drawerHost: TextDrawerStepperHost = {
            viewForKey: () => 1,
            bucketFor: () => otAddress,
            packetCursor: () => packetArea,
            flushPacketCursor: () => {},
            rotMatrixYXZ: () => { throw new Error("Battle form: rotated text is not translated"); },
            scaleMatrix: () => { throw new Error("Battle form: scaled text is not translated"); },
            applyMatrixSV: () => { throw new Error("Battle form: transformed text is not translated"); },
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

        // F0x80092684 writes the acting party position into the caller's word in
        // the delay slot of the allocator call (fightstg.s:16220-16229), so
        // F0x8009482C's `obj->0x54 = parent[0]` copies the acting position, and
        // the answer the screen writes back replaces it.
        mem.write32(this.cell, game.slotIndex);
        this.root = formListActorConstruct(mem, this.cell, menuHost);
    }

    /**
     * The acting Digimon's own roster record, the three tables every translated
     * resident helper reads:
     *
     *  - `roster + 0x784`, the 0x2C-byte stat block F0x80017174 copies before it
     *    folds in buffs. Halfwords 19..21 are the counters that subtract from STR,
     *    DEF and SPD and grey those three page-zero numbers.
     *  - `roster + 0x7B0`, the three equipped form ids F0x800176AC resolves.
     *  - `roster + 0x7B8`, the 44 technique blocks: one per species the Digimon
     *    knows techniques for, carrying its level and its six entry words.
     *  - `roster + 0xB28`, the six status/buff lookup keys. The walker has no
     *    status effects in battle, so they stay zero and the sweep folds nothing
     *    in — the same result as an empty equipment list in the original.
     */
    private seedRoster(mem: NativeMemory, seed: FightFormSeed): void {
        const member: FormPanelMember = {
            slotIndex: seed.slotIndex,
            options: seed.options,
            ...(seed.equipped ? { equipped: seed.equipped } : {}),
            panelBlock: seed.panelBlock,
        };
        seedFormRoster(mem, this.widgets.arena.alloc, member);
    }

    /** One display tick. */
    tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
        const next = displayTick ?? this.frame + 1;
        this.frame = next;
        this.draw.beginFrame(this.frame);
        this.moves.length = 0;
        this.pad.update(buttons, this.frame);
        this.tree.tick(this.root);
        this.sweepPanels();
        this.widgets.forEachText((w) => textRevealTick(this.mem, this.revealHost, w));
        this.vsync();
    }

    /**
     * A panel the cursor has moved past is closed and replaced, which leaves the
     * old object unreferenced from child slot 6 (the original alternates panels
     * between slots 5 and 6, closing the one it is about to overwrite). The
     * original never draws the dropped panel again, because nothing ticks it, so
     * the walker disposes it with its widgets rather than keeping one dead task
     * per cursor move.
     */
    private sweepPanels(): void {
        if (!this.tree.tasks.has(this.root)) return;
        const slot = this.tree.tasks.get(this.root)!.children + 0x18;
        sweepFormPanels(this.tree, this.mem, [this.mem.read32(slot) >>> 0]);
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
                throw new Error(`Battle form: untranslated GPU command ${command.toString(16)}`);
            }
            const next = tag & 0xffffff;
            if (next === 0xffffff) return;
            node = (0x80000000 | next) >>> 0;
        }
        throw new Error("Battle form: GPU chain does not terminate");
    }

    finished(): boolean { return !this.tree.tasks.has(this.root); }

    /**
     * The chosen species id in the walker's own numbering, -2 for a cancel, or
     * null while the list is open. The screen answers with the game's form id —
     * the row's own value0, what every id it was given was turned into — so the
     * one turn back is `walkerIdOf`, the same pair of functions in the other
     * direction. A form the table does not hold has no walker id; its raw answer
     * is handed on unchanged rather than silently turned into 0.
     */
    chosen(): number | null {
        const value = this.mem.read32(this.cell) | 0;
        if (value === -1) return null;
        if (value < 0) return value;
        return walkerIdOf(this.mem as never, value >>> 0) || value;
    }

    /** True once the screen reads the pad (state 1): the list is built and live. */
    ready(): boolean {
        return this.tree.tasks.has(this.root) && (this.mem.read32(this.root + 0x0c) | 0) === 1;
    }

    /** The selected row the list currently shows. */
    selection(): number | null {
        const model = this.model();
        return model ? this.mem.read32(model + 0x50) | 0 : null;
    }

    /** The page the panel currently shows (L1 and R1 wrap over 0..2). */
    page(): number {
        return this.tree.tasks.has(this.root) ? this.mem.read32(this.root + FORM_LIST_PAGE) | 0 : 0;
    }

    /** The rows the model shows. */
    rows(): number {
        return this.tree.tasks.has(this.root) ? this.mem.read32(this.root + FORM_LIST_COUNT) | 0 : 0;
    }

    /** The species id of each row the list offers, current form first. */
    rowSpecies(): number[] {
        if (!this.tree.tasks.has(this.root)) return [];
        const out: number[] = [];
        for (let i = 0; i < 4; i++) out.push(this.mem.read16s(this.root + FORM_LIST_CURRENT + i * 2) | 0);
        return out;
    }

    /** Whether the vsync marker callback is installed. */
    vsyncInstalled(): boolean { return (this.mem.read32(COMMAND_TIME_OBJECT) >>> 0) !== 0; }

    /**
     * The live panel's page-zero block: the 22 halfwords F0x80017174 wrote at
     * panel+0x64, so the three grey flags at +0x26/+0x28/+0x2A can be read back
     * where the draw reads them.
     */
    panelBlock(): number[] | null {
        const panel = this.panelAddress();
        if (panel === null) return null;
        const out: number[] = [];
        for (let i = 0; i < FIGHT_FORM_PANEL_BLOCK; i++) {
            out.push(this.mem.read16s(panel + 0x64 + i * 2) | 0);
        }
        return out;
    }

    /** The six technique words the live panel's technique page lists at +0xD4. */
    panelRows(): number[] | null {
        const panel = this.panelAddress();
        if (panel === null) return null;
        const out: number[] = [];
        for (let i = 0; i < 6; i++) out.push(this.mem.read16s(panel + 0xd4 + i * 4) | 0);
        return out;
    }

    /** The panel's headline number at +0x60 (negative draws the dash). */
    panelHeadline(): number | null {
        const panel = this.panelAddress();
        return panel === null ? null : (this.mem.read32(panel + 0x60) | 0);
    }

    /** The live panel object, whichever child slot the list keeps it in. */
    private panelAddress(): number | null {
        if (!this.tree.tasks.has(this.root)) return null;
        for (const address of this.tree.tasks.keys()) {
            if (this.tree.tasks.get(address)!.classId === FORM_PANEL_HANDLER) return address;
        }
        return null;
    }

    /** Dispose of every task (the battle left the DV phase another way). */
    dispose(): void { this.tree.dispose(this.root); }

    /** The list model object, once the build has created it. */
    private model(): number | null {
        if (!this.tree.tasks.has(this.root)) return null;
        const slot = this.tree.tasks.get(this.root)!.children;
        const model = this.mem.read32(slot) >>> 0;
        return model && this.tree.tasks.has(model) ? model : null;
    }
}