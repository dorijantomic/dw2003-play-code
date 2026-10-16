// Frame owner for the translated in-battle TAG list (pro/fightstg): the two
// partner rows a player picks a knocked-in replacement from, with the original's
// HP/MP plate, the greyed plate of a partner that is down, the blinking selector
// and the pulsing cursor.
//
// The screen's own routines are the registered ports in native/battle-tag-menu.ts
// (actor construct/tick, widget build, row update, panels, the compatibility
// test); the list model and its state machine and the vsync marker blit are the
// ports in native/fight-command-menu.ts, because F0x80097498 builds its list with
// the shared factory F0x8009B0C8. No PlayStation instruction is executed here.
//
// Services, each an existing translated provider or a documented platform one:
//   object factory F0x80014504        -> TranslatedTaskTree.allocate
//   default methods +0x28/+0x38      -> TranslatedTaskTree default slots
//   text box F0x8001AE38, +0x114/+0x118/+0x138/+0x144/+0x148
//                                   -> ShopWidgetServices / dispatchWidgetMethod
//   text box tick F0x8001AC14        -> textRevealTick (the browser paints glyphs)
//   pack by number [0x80044F4C]      -> ScreenTextBanks.source
//   pack entry handle [0x80044F5C]   -> identity handle, painted by the pack renderer
//   pad [0x8004BBC4]                 -> ScreenPad
//   sound [0x80055C48]               -> host.playSound
//   frame counter [0x8004DF98]       -> the display clock's tick
//   picture service F0x8001F648     -> ShopDrawIntents
//   vsync callback [0x8004DE10]      -> dispatched once per display tick
//   equipped forms [0x80048D34+0x2738] -> form-ledger.ts validateEquippedForm
//   species getter [0x80048D34+0x2718] -> party-context.ts partyPositionToRosterSlot
//                                       (a party POSITION -> the member's ROSTER SLOT)
//   species name   [0x80048D34+0x2750] -> party-context.ts persistentRosterSlot
//                                       (the roster slot -> the member's record, whose
//                                        string at +0x08 is the row plate's name)
//   profile record [0x8005CCA0]      -> native/pause-status.ts profileRecord
//   [0x800A4468]/[0x800A4470]        -> the party's acting slot and records, seeded
//                                      by the caller from the walker's roster
//
// Data-only inputs: the config block at 0x800A3574 and the 12x12 marker strip
// rectangle at 0x800A3654 from the overlay, the Digimon profile table at
// 0x8003EF5C (52 records of 0x58 bytes, read for the compatibility test), the
// three-member save context at 0x80048D34 the equipped forms come from, and the
// 0x7F battle UI text bank with its "HP" / "MP" / "/" / no-partner words.
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
import { validateEquippedForm } from "../form-ledger.ts";
import { nativeFormIds, seedRosterForms, type RosterFormState } from "./roster-form-state.ts";
import { PROFILE_ROWS, PROFILE_TABLE_BASE, profileRecord } from "./native/pause-status.ts";
import { partyPositionToRosterSlot, persistentRosterSlot, PARTY_MAP, ROSTER_RECORDS, ROSTER_STRIDE, rosterRecordAddress } from "../party-context.ts";
import { frameDelta } from "../../systems/frame-clock.ts";
import {
    commandMenuCreate, commandMenuStateMachine, commandMenuVsyncBlit,
    COMMAND_BLIT_RECT, COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, COMMAND_MENU_UPDATE,
    COMMAND_STRING_BASE, COMMAND_TIME_OBJECT,
    type CommandMenuBlitHost, type CommandMenuMemory,
} from "./native/fight-command-menu.ts";
import {
    tagMenuActorConstruct, tagMenuPanels, tagMenuTick,
    TAG_BANK_UI, TAG_LIST_ACTOR_EXTRA, TAG_LIST_ACTOR_HANDLER, TAG_LIST_ACTOR_SIZE,
    TAG_LIST_CONFIG, TAG_OUT_ROW, TAG_OUT_SLOT, TAG_PANEL_OK, TAG_PARTY_BASE,
    TAG_PARTY_BLAST, TAG_PARTY_HP, TAG_PARTY_INDEX, TAG_PARTY_MAX_HP, TAG_PARTY_MAX_MP,
    TAG_PARTY_MP, TAG_PARTY_SPECIES, TAG_PARTY_STRIDE, TAG_PROFILES,
    TAG_RESULT_CANCEL, TAG_RESULT_RUNNING, TAG_STRING_BASE,
    type TagListHost, type TagListMemory,
} from "./native/battle-tag-menu.ts";

/** The TAG data file: the 32-byte config block and the 8-byte blit rectangle. */
export const FIGHT_TAG_TABLES_SIZE = 40;
/** The Digimon profile table: 52 records of 0x58 bytes from 0x8003EF5C. */
export const FIGHT_TAG_SPECIES_SIZE = 52 * 0x58;
/**
 * The banks the tag screen loads. The disc's list reads only the battle UI bank
 * (0x7F) for its "HP"/"MP"/"/" words; each row's NAME is the member's own record
 * string at DIGIMON_CUR_STATS + slot*0x3DC, which the list reaches through
 * ctx+0x2718 -> ctx+0x2750, not through a text bank.
 */
export const FIGHT_TAG_BANKS = [TAG_BANK_UI] as const;
/** Widget storage clear of the overlay data and of the task tree's first blocks. */
export const FIGHT_TAG_WIDGET_ARENA = { first: 0x80180000, limit: 0x801e0000 } as const;

export interface FightTagResources {
    tables: Uint8Array;
    /**
     * The Digimon profile records from 0x8003EF5C: the ONE cut every screen showing a
     * Digimon loads (assets/data/digimon_profiles.bin). All PROFILE_ROWS of them, because
     * that is the table's length; this list's own reader walks the original's 52
     * (PROFILE_SCAN_ROWS), so it reads no row the disc's list could not read.
     */
    profiles: Uint8Array;
    font: Uint8Array;
    banks: ReadonlyMap<number, Uint8Array>;
    /** The resident cursor glyph table (0x8004DCE0); forwarded or the shared default. */
    cursorGlyphs?: CursorGlyphTable;
}

export interface FightTagMember {
    /** The walker's Digimon id, mapped to the game's live form id. */
    digimonId: number;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    /** Combat record +0x1A suppresses the DNA compatibility badge. */
    blast?: boolean;
    /** The roster record the equipped-form service reads (status screen shape). */
    forms?: RosterFormState;
    /**
     * The member's ROSTER SLOT — the identity ctx+0x70 carries and every reader of
     * [0x80048D34+0x2718] resolves the member by. The row's name service and the
     * form ledger are both keyed by it. Defaults to the party position when absent.
     */
    rosterSlot?: number;
    /**
     * The member's own name, in the screen text codec (the roster record's string at
     * +0x08, the bytes ctx+0x2750 points at). Absent leaves the plate blank.
     */
    nameBytes?: readonly number[];
}

export interface FightTagSeed {
    activeIndex: number;
    /** 1 when the battle may cancel the list, 0 for the forced TAG. */
    interactive: number;
    members: readonly FightTagMember[];
    /** The row the caller last had; the original seeds the cursor from it. */
    cursorRow?: number;
}

export interface FightTagHost {
    playSound(id: number): void;
}

/** One GP0 0x80 VRAM-to-VRAM copy the platform GPU executed this tick. */
export interface FightTagMove {
    srcX: number; srcY: number; dstX: number; dstY: number; w: number; h: number;
}

export class FightTagSession {
    readonly mem = new NativeMemory();
    readonly tree: TranslatedTaskTree;
    readonly widgets: ShopWidgetServices;
    readonly draw = new ShopDrawIntents(this.mem);
    readonly root: number;
    /** The GPU moves the vsync callback queued on the latest display tick. */
    readonly moves: FightTagMove[] = [];
    /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
    private readonly audio = new PackedSoundCursor();
    /** The ids this screen asked the shared queue for. */
    get sounds(): number[] { return this.audio.sounds; }
    readonly seed: FightTagSeed;
    private readonly cell: number;
    private readonly rowCell: number;
    private readonly banks: ScreenTextBanks;
    private readonly pad = new ScreenPad();
    private readonly revealHost: Parameters<typeof textRevealTick>[1];
    private readonly blitHost: CommandMenuBlitHost;
    private frame = 0;

    constructor(language: number, seed: FightTagSeed, resources: FightTagResources,
                host: FightTagHost) {
        if (resources.tables.length !== FIGHT_TAG_TABLES_SIZE) throw new Error("Invalid battle tag tables");
        if (!Number.isInteger(seed.activeIndex) || seed.activeIndex < 0 || seed.activeIndex > 2) {
            throw new Error("Invalid battle tag party slot");
        }
        this.seed = seed;
        const mem = this.mem;
        loadResidentResources(mem, { font: resources.font,
            ...(resources.cursorGlyphs ? { cursorGlyphs: resources.cursorGlyphs } : {}), ranges: [
            { base: TAG_LIST_CONFIG, bytes: resources.tables.subarray(0, 32) },
            { base: COMMAND_BLIT_RECT, bytes: resources.tables.subarray(32, 40) },
            { base: TAG_PROFILES, bytes: resources.profiles },
        ] });
        this.banks = new ScreenTextBanks(mem, language, FIGHT_TAG_BANKS, resources.banks, "battle tag");
        this.widgets = new ShopWidgetServices(mem, this.banks as never, FIGHT_TAG_WIDGET_ARENA);
        mem.write32(COMMAND_STRING_BASE, language);
        mem.write32(TAG_PARTY_INDEX, seed.activeIndex);
        mem.write32(TAG_STRING_BASE, language);

        // The three party records the screen scans, and the save context the
        // equipped-form and name services read for each member. The member's
        // ROSTER SLOT is their identity: the disc seats it at ctx+0x70 and every
        // reader (ctx+0x2718 -> ctx+0x2750, the stats producer, the form ledger)
        // resolves the member by that number, not by the party position. Seating
        // the party position here is what left the row plate's name empty.
        const { valueById } = nativeFormIds(mem);
        for (let i = 0; i < 3; i++) {
            const member = seed.members[i];
            if (!member) continue;
            const rosterSlot = Number.isInteger(member.rosterSlot) ? (member.rosterSlot as number) : i;
            mem.write32(PARTY_MAP + i * 4, rosterSlot);
            // The row plate's string is the member's own name, which lives in the
            // roster record at DIGIMON_CUR_STATS + slot*0x3DC — the byte after the
            // record's 8-byte head that ctx+0x2750 returns. The same seat the pause
            // sheet uses (engine/dw3/ui/pause-root-session.ts).
            if (member.nameBytes && member.nameBytes.length > 0) {
                const nameAt = (rosterRecordAddress(rosterSlot) + 8) >>> 0;
                const bytes = member.nameBytes.slice(0, 23);
                mem.load(Uint8Array.from(bytes, (b) => b & 0xff), nameAt);
                mem.write8(nameAt + Math.min(23, bytes.length), 0);
            }
            const record = TAG_PARTY_BASE + i * TAG_PARTY_STRIDE;
            mem.write16(record + TAG_PARTY_SPECIES, (valueById.get(member.digimonId | 0) ?? 0) & 0xffff);
            mem.write16(record + TAG_PARTY_MAX_HP, member.maxHp & 0xffff);
            mem.write16(record + TAG_PARTY_HP, member.hp & 0xffff);
            mem.write16(record + TAG_PARTY_MAX_MP, member.maxMp & 0xffff);
            mem.write16(record + TAG_PARTY_MP, member.mp & 0xffff);
            mem.write8(record + TAG_PARTY_BLAST, member.blast ? 1 : 0);
            seedRosterForms(mem as never, (rosterRecordAddress(rosterSlot)) >>> 0,
                { digimonId: member.digimonId, ...(member.forms ?? {}) });
        }

        mem.write32(COMMAND_TIME_OBJECT, 0);
        this.cell = this.widgets.arena.alloc(8, 4);
        this.rowCell = this.widgets.arena.alloc(8, 4);

        const playSound = (id: number): void => { this.audio.play(id); host.playSound(id); };
        const menuHost: TagListHost = {
            allocateActor: () => this.tree.allocate(TAG_LIST_ACTOR_HANDLER, TAG_LIST_ACTOR_SIZE, TAG_LIST_ACTOR_EXTRA),
            // F0x8009B0C8 is the shared factory: the list model is the same 0xA8
            // object the command menu builds, with this screen's config.
            createModel: (config) => commandMenuCreate(
                mem as never, config,
                { allocateMenu: () => this.tree.allocate(COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, 0) } as never,
            ),
            // [0x80048D34+0x2718](party position): the member's ROSTER SLOT — the
            // ctx+0x70 identity, NOT the party position and NOT a form id. The same
            // value the row's name service (ctx+0x2750) and the form ledger are keyed
            // by. -1 for a position past the party's end.
            speciesOfSlot: (position) => partyPositionToRosterSlot(mem as never, position | 0),
            preselectRecord: (species) => profileRecord(mem as never, species),
            // [0x80048D34+0x2738](roster slot, dest): the member's three equipped form
            // ids, validated against the acquired-form ledger. The service is handed
            // the roster slot ctx+0x2718 answered with.
            compatibilityList: (rosterSlot, dest) => validateEquippedForm(mem as never, rosterSlot | 0, dest),
            // [0x80048D34+0x2750](roster slot): the member's own record base, whose
            // bytes ARE the name the plate reads — the widget installs the pointer as a
            // literal string (text-widget-resource.ts, index < 0), so the record's
            // string at +0x08 is the row's name. The same service the pause list, the
            // gym HUD and the fight report name their rows with. -1 has no record.
            nameOfSlot: (rosterSlot) => ((rosterSlot | 0) < 0 ? 0 : persistentRosterSlot(rosterSlot | 0) >>> 0),
            createTextElement: (target, kind, x, y) => this.widgets.createTextElement(target, kind, x, y),
            resourceBase: (bank) => this.banks.source(bank),
            packResolve: (handle) => this.draw.packResolve(handle),
            padRead: () => this.pad.pressed(),
            padReadA: () => this.pad.pressed(),
            padReadB: () => this.pad.repeated(),
            playSound,
            // The list model this screen builds is the shared command-menu
            // object, so its own row draw runs here too and reads the frame
            // delta (command-menu F0x8009ADD4, host.frameDelta).
        frameDelta,
            frameCounter: () => this.frame,
            initDrawContext: () => this.draw.initDrawContext(),
            setLayer: this.draw.setLayer,
            setOrigin: this.draw.setOrigin,
            // The list model is the shared command-menu object, so its row draw
            // sets ctx+0x88 (the palette row) and draws the cursor cel itself.
            setPaletteRow: this.draw.paletteShift,
            // ctx+0x98 selects the sprite palette the shared row draw reads; the
            // translated picture painter ignores it (shop-draw-intents.ts).
            setSpritePalette: () => {},
            drawSprite: this.draw.drawSprite,
            // The object method table: most slots answer nothing, but the text
            // widget's +0x16C getter returns the word-pending byte the
            // "no partner" screen branches on, so the value has to come back.
            callMethod: (target, slot, args) => callTaskOrWidget(mem, this.tree, this.widgets, target, slot, args),
        };
        const otAddress = this.widgets.arena.alloc(8, 4);
        const packetArea = this.widgets.arena.alloc(0x4000, 4);
        const drawScratch = this.widgets.arena.alloc(0x48, 4);
        const drawerHost: TextDrawerStepperHost = {
            viewForKey: () => 1,
            bucketFor: () => otAddress,
            packetCursor: () => packetArea,
            flushPacketCursor: () => {},
            rotMatrixYXZ: () => { throw new Error("Battle tag: rotated text is not translated"); },
            scaleMatrix: () => { throw new Error("Battle tag: scaled text is not translated"); },
            applyMatrixSV: () => { throw new Error("Battle tag: transformed text is not translated"); },
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
        classes.set(TAG_LIST_ACTOR_HANDLER, {
            name: "battle TAG list screen", childSlots: [0], terminalTick: true,
            tick: (actor, children) => tagMenuTick(mem, actor, children, menuHost),
        });
        classes.set(COMMAND_MENU_HANDLER, {
            name: "battle list model", childSlots: [], terminalTick: true, closeTick: true,
            tick: (menu) => commandMenuStateMachine(mem, menu, menuHost as never),
        });
        this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
        this.root = tagMenuActorConstruct(mem, this.cell, this.rowCell, seed.interactive | 0, menuHost);
        mem.write32(this.rowCell, seed.cursorRow ?? 0);
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
                throw new Error(`Battle tag: untranslated GPU command ${command.toString(16)}`);
            }
            const next = tag & 0xffffff;
            if (next === 0xffffff) return;
            node = (0x80000000 | next) >>> 0;
        }
        throw new Error("Battle tag: GPU chain does not terminate");
    }

    finished(): boolean { return !this.tree.tasks.has(this.root); }

    /** The chosen party slot, -2 for a cancel, or null while the list is open. */
    chosen(): number | null {
        const value = this.mem.read32(this.cell) | 0;
        return value === TAG_RESULT_RUNNING ? null : value;
    }

    /** The cursor row the list confirms with, or null while it is open. */
    chosenRow(): number | null {
        return this.finished() ? this.mem.read32(this.rowCell) | 0 : null;
    }

    /** True once the screen reads the pad (state 1): the list is built and live. */
    ready(): boolean {
        return this.tree.tasks.has(this.root) && (this.mem.read32(this.root + 0x0c) | 0) === 1;
    }

    /** The "no partner left" screen: state 2, where only Circle is read. */
    messageOpen(): boolean {
        return this.tree.tasks.has(this.root) && (this.mem.read32(this.root + 0x0c) | 0) === 2;
    }

    /** The selected row the list currently shows. */
    selection(): number | null {
        const menu = this.model();
        return menu ? this.mem.read32(menu + 0x50) | 0 : null;
    }

    /** The rows the model shows. */
    rows(): number {
        const menu = this.model();
        return menu ? this.mem.read32(menu + 0x58) | 0 : 0;
    }

    /** The party slots the rows offer, in the order the list shows them. */
    candidates(): number[] {
        if (!this.tree.tasks.has(this.root)) return [];
        const count = this.mem.read32(this.root + 0x64) | 0;
        const out: number[] = [];
        for (let i = 0; i < count; i++) out.push(this.mem.read32(this.root + 0x5c + i * 4) | 0);
        return out;
    }

    /** Which rows pass the compatibility test, i.e. carry the HP/MP plate. */
    panels(): number[] {
        if (!this.tree.tasks.has(this.root)) return [];
        const count = this.mem.read32(this.root + 0x64) | 0;
        const out: number[] = [];
        for (let i = 0; i < count; i++) out.push(this.mem.read32(this.root + TAG_PANEL_OK + i * 4) | 0);
        return out;
    }

    /** Redraw the HP/MP plates without a screen tick (the verifier's helper). */
    drawPanels(): void { tagMenuPanels(this.mem as TagListMemory, this.root, this.panelHost()); }

    private panelHost(): TagListHost {
        return {
            initDrawContext: () => this.draw.initDrawContext(),
            setLayer: this.draw.setLayer,
            setOrigin: this.draw.setOrigin,
            packResolve: (handle: number) => this.draw.packResolve(handle),
            drawSprite: this.draw.drawSprite,
        } as unknown as TagListHost;
    }

    /** Whether the vsync marker callback is installed. */
    vsyncInstalled(): boolean { return (this.mem.read32(COMMAND_TIME_OBJECT) >>> 0) !== 0; }

    /** Dispose of every task (the battle left the TAG phase another way). */
    dispose(): void { this.tree.dispose(this.root); }

    /** The list model object, once the build has created it. */
    private model(): number | null {
        if (!this.tree.tasks.has(this.root)) return null;
        const slot = this.tree.tasks.get(this.root)!.children;
        const menu = this.mem.read32(slot) >>> 0;
        return menu && this.tree.tasks.has(menu) ? menu : null;
    }
}

/** The walker's Digimon id -> the game's own form id: roster-form-state.ts's
 *  `nativeFormIds`, which is native/pause-status.ts's `gameFormId` over the
 *  profile table's decoded 55 rows. This file used to carry its own copy of the
 *  walk, counted at 52; there is one mapping now. */