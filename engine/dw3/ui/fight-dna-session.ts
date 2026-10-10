// Frame owner for the translated in-battle DNA screen (pro/fightstg).
//
// The command is two screens in a row. The first is the shared partner list —
// the port already shipped in native/battle-tag-menu.ts, owned here by a
// FightTagSession opened in DNA mode (its third argument, self+0x58 = 1, is the
// flag the original's per-row compatibility test is gated on). It is reused, not
// copied: this file holds no partner-list code. The second is the DNA pane
// (native/battle-dna-menu.ts, tick 0x800980E4): the species under the cursor at
// the top, up to three result species moved with L1/R1 through the shared
// list model, then the Switch and DNA DV rows with the Jogress MP price.
//
// Services, each an existing translated provider or a documented platform one:
//   object factory F0x80014504        -> TranslatedTaskTree.allocate
//   default methods +0x28/+0x2C/+0x38/+0x3C/+0x40 -> TranslatedTaskTree
//   text box F0x8001AE38, +0x114/+0x118/+0x138/+0x144/+0x148
//                                   -> ShopWidgetServices / dispatchWidgetMethod
//   text box tick F0x8001AC14        -> textRevealTick
//   pack by number [0x80044F4C]      -> ScreenTextBanks.source
//   pack entry handle [0x80044F5C]   -> identity handle, painted by the pack renderer
//   pad [0x8004BBC4]                 -> ScreenPad
//   sound [0x80055C48]               -> host.playSound
//   picture service F0x8001F648      -> ShopDrawIntents
//   vsync callback [0x8004DE10]      -> dispatched once per display tick
//   species getter [0x8005CCA0]      -> native/pause-status.ts profileRecord
//   combatant index [0x8004B44C]     -> the profile row of the partner's live
//                                      form (see combatantOf below)
//   candidate species [0x8004B46C]   -> form-tech-blocks.ts readEquippedForms
//                                      (F0x800176AC), the shared rule the carry-
//                                      over panel's pages one and two read too
//   profile records 0x8003EF5C       -> report/resident.bin
//   stat carry-over panel F0x800953E4 -> form-panel-host.ts (the shared port
//                                      native/digivolve-form-menu.ts also uses)
//
// Data-only inputs: the two config blocks at 0x800A3594 and 0x800A35B4 and the
// four MP-plate x halfwords at 0x800A35D4 from the overlay; the exe's technique
// table at 0x80042BDC (18 bytes a row) that the pane reads the Jogress price
// from; the party records at 0x800A4470; the 0x4E and 0x7F name banks.
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
import { gameFormId, profileRecord } from "./native/pause-status.ts";
import { readEquippedForms } from "../form-tech-blocks.ts";
import { frameDelta } from "../../systems/frame-clock.ts";
import {
    commandMenuCreate, commandMenuStateMachine, commandMenuVsyncBlit,
    COMMAND_BLIT_RECT, COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, COMMAND_MENU_UPDATE,
    COMMAND_STRING_BASE, COMMAND_TIME_OBJECT,
    type CommandMenuBlitHost,
} from "./native/fight-command-menu.ts";
import { FightTagSession } from "./fight-tag-session.ts";
import {
    createFormPanelHost, FORM_PANEL_BLOCK_HALFWORDS, seedFormRoster, sweepFormPanels,
    writeFormPanelProfile, type FormPanelMember, type FormPanelOption,
} from "./form-panel-host.ts";
import {
    formPanelConstruct, formPanelTick, FORM_PANEL_EXTRA, FORM_PANEL_HANDLER, FORM_PANEL_SIZE,
    FORM_PANEL_PAGE0_TABLE,
} from "./native/digivolve-form-menu.ts";
import {
    dnaPaneActorConstruct2, dnaPaneArt, dnaPaneTick,
    DNA_BANK_NAME, DNA_BANK_UI, DNA_COMBATANT, DNA_DNA_ID, DNA_MP_XS,
    DNA_PANE_CONFIG_OPTIONS, DNA_PANE_CONFIG_STRIP, DNA_PANE_EXTRA,
    DNA_PANE_HANDLER, DNA_PANE_SIZE, DNA_PARTY_AILMENTS, DNA_PARTY_BASE, DNA_SLOT_PREVIEW_A,
    DNA_SLOT_PREVIEW_B,
    DNA_PARTY_BLAST, DNA_PARTY_HP, DNA_PARTY_INDEX, DNA_PARTY_MAX_HP,
    DNA_PARTY_MAX_MP, DNA_PARTY_MP, DNA_PARTY_SPECIES, DNA_PARTY_STRIDE,
    DNA_PRICES, DNA_PREVIEW_OPTION, DNA_PROFILE_INDEX, DNA_ROW_COUNT, DNA_SELECTED, DNA_SLOT_MODEL,
    DNA_MODEL_CURSOR, DNA_SLOT_OPTIONS, DNA_SPECIES, DNA_SPECIES_TABLE, DNA_STATE, DNA_STRIP_CURSOR,
    DNA_SUB_STATE,
    type DnaPaneHost,
} from "./native/battle-dna-menu.ts";
import { TECH_ICON_TABLE, TECH_ICON_TABLE_SIZE } from "./native/battle-tech-menu.ts";

/** The DNA pane's overlay data: the two config blocks and the four MP-plate
 *  x anchors, 0x800A3594 through 0x800A35E3. */
export const FIGHT_DNA_TABLES_SIZE = 0x50;
/** Widget storage clear of the overlay data and of the task tree's first blocks. */
export const FIGHT_DNA_WIDGET_ARENA = { first: 0x80180000, limit: 0x801e0000 } as const;
/** The technique-name bank (0xA2) pages one and two of the panel read. */
export const FIGHT_DNA_TECH_BANK = 0xa2;
/** Page zero's two stat columns: six core sums at +0x70, seven elements at +0x7C. */
const FORM_PANEL_LEFT_HALFWORDS = 6;
const FORM_PANEL_RIGHT_HALFWORDS = 7;
/** The thirteen page-zero sums the panel prints: six core stats, seven elements. */
const FORM_PANEL_SUM_HALFWORDS = FORM_PANEL_LEFT_HALFWORDS + FORM_PANEL_RIGHT_HALFWORDS;
export const FIGHT_DNA_BANKS = [DNA_BANK_UI, DNA_BANK_NAME, FIGHT_DNA_TECH_BANK] as const;

/** One hand-off screen the pane asked for (F0x800953E4). */
export interface FightDnaHandoff {
    combatant: number;
    row: number;
    species: number;
}

export interface FightDnaMember {
    /**
     * The walker's own Digimon id (digimon.json, 1..55). The pane is handed the
     * GAME's ids, so every id in this seed — this one, `forms[].species` and
     * `panel.equipped` — is turned into the game's own form id by one mapping
     * (`gameFormId`, the `value0` halfword of the profile row the walker's id
     * numbers) before it reaches any translated code. See FightDnaPane's
     * constructor. This is the member's LIVE form: it is what the pane writes
     * into the party record at `0x800A4470 + 0x20*i` (+0x00), and the pairing test
     * asks that record's own profile row for its DNA-partner byte.
     */
    digimonId: number;
    /**
     * The ROSTER SLOT this member holds — `F0x80016D94` on the walker side
     * (`partyPositionRosterSlot`, engine/dw3/roster.ts), 0..7 = the eight
     * starters. The pane stores it at `self+0x60`
     * (FIGHTSTG_F0x80098884, fightstg.s 0x800988c8-0x800988d8) and uses it for
     * exactly three reads: the equipped triple `F0x800176AC` resolves, the
     * strip's first row `*(u16 *)(0x8003EF5C + 0x58*it)`, and the carry-over
     * panel's first argument. So the strip leads with the member's STARTER
     * species and lists the equipped forms after it, even once the member has
     * digivolved — which is what the disc's rows 0..7 are.
     */
    rosterSlot: number;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    /** The party's ailment/status bits the pane tests (record +0x1C). */
    status?: number;
    /** Resident record +0x1A: Blast suppresses the DNA offer. */
    blast?: boolean;
    /**
     * The carry-over panel's data for this member, when the caller has it. The
     * panel F0x800953E4 opens is the same object the Digivolve form list shows,
     * so it reads the same roster: the three equipped form ids at panel +0x90,
     * one 0x14-byte technique block per form, and the profile's own 22 stat
     * halfwords. Without these the panel still opens and still draws its frame,
     * its captions and its page-one dash, which is what the original shows for a
     * profile with nothing acquired.
     */
    panel?: FormPanelMember;
    /** The forms this member's panel can be asked about, for its species records. */
    forms?: readonly FormPanelOption[];
    /** The profile's own pre-selected technique word (profile +0x28). */
    preselected?: number;
}

export interface FightDnaSeed {
    /** The acting party slot. */
    activeIndex: number;
    /** The partner's party slot the player picked in the first step. */
    partnerIndex: number;
    members: readonly FightDnaMember[];
}

/** The DNA pane on its own: the tick, the widgets and the picture calls. */
export class FightDnaPane {
    readonly mem = new NativeMemory();
    readonly tree: TranslatedTaskTree;
    readonly widgets: ShopWidgetServices;
    readonly draw = new ShopDrawIntents(this.mem);
    /** One GP0 0x80 VRAM-to-VRAM copy the platform GPU executed this tick. */
    readonly moves: { srcX: number; srcY: number; dstX: number; dstY: number; w: number; h: number }[] = [];
    /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
    private readonly audio = new PackedSoundCursor();
    /** The ids this screen asked the shared queue for. */
    get sounds(): number[] { return this.audio.sounds; }
    /** Every F0x800953E4 the confirm asked for, in order. */
    readonly handoffs: FightDnaHandoff[] = [];

    readonly root: number;
    /** The pane's widget block, the `a1` of its tick. */
    children = 0;
    private readonly cell: number;
    private readonly speciesCell: number;
    private readonly banks: ScreenTextBanks;
    private readonly pad = new ScreenPad();
    private readonly revealHost: Parameters<typeof textRevealTick>[1];
    private readonly blitHost: CommandMenuBlitHost;
    private frame = 0;

    constructor(
        language: number,
        seed: FightDnaSeed,
        resources: {
            /** The pane's two config blocks and the four MP-plate x anchors. */
            tables: Uint8Array;
            /** The exe's 18-byte technique records the Jogress price lives in. */
            techniques: Uint8Array;
            /** The 40 (x, y, sum) bytes of the panel's page-zero number table. */
            panelTable: Uint8Array;
            /** The 0x34 profile records at 0x8003EF5C. */
            species: Uint8Array;
            font: Uint8Array;
            banks: ReadonlyMap<number, Uint8Array>;
            /** The resident cursor glyph table (0x8004DCE0); forwarded or the shared default. */
            cursorGlyphs?: CursorGlyphTable;
        },
        host: { playSound(id: number): void },
    ) {
        const tables = resources.tables;
        const techniques = resources.techniques;
        if (tables.length !== FIGHT_DNA_TABLES_SIZE) throw new Error("Invalid battle DNA tables");
        if (techniques.length < TECH_ICON_TABLE_SIZE) throw new Error("Battle DNA technique table is short");
        if (!Number.isInteger(seed.activeIndex) || seed.activeIndex < 0 || seed.activeIndex > 2) {
            throw new Error("Invalid battle DNA party slot");
        }
        if (!Number.isInteger(seed.partnerIndex) || seed.partnerIndex < 0 || seed.partnerIndex > 2) {
            throw new Error("Invalid battle DNA partner slot");
        }
        const mem = this.mem;
        loadResidentResources(mem, { font: resources.font,
            ...(resources.cursorGlyphs ? { cursorGlyphs: resources.cursorGlyphs } : {}), ranges: [
            { base: DNA_PANE_CONFIG_STRIP, bytes: tables.subarray(0, 0x20) },
            { base: DNA_PANE_CONFIG_OPTIONS, bytes: tables.subarray(0x20, 0x40) },
            { base: DNA_MP_XS, bytes: tables.subarray(0x40, 0x50) },
            { base: DNA_SPECIES_TABLE, bytes: resources.species },
            // The exe's technique table, cut at its own end (443 records): the
            // extracted window runs on over D0x80044B02 and the two pack-service
            // pointers, so the tail is not copied into the session's RAM.
            { base: TECH_ICON_TABLE, bytes: techniques.subarray(0, TECH_ICON_TABLE_SIZE) },
            // The carry-over panel's thirteen (x, y, sum) triples, 0x800A350C,
            // the same extracted bytes the Digivolve form list reads.
            { base: FORM_PANEL_PAGE0_TABLE, bytes: resources.panelTable },
        ] });
        this.banks = new ScreenTextBanks(mem, language, FIGHT_DNA_BANKS, resources.banks, "battle DNA");
        this.widgets = new ShopWidgetServices(mem, this.banks as never, FIGHT_DNA_WIDGET_ARENA);
        mem.write32(COMMAND_STRING_BASE, language);
        mem.write32(DNA_PARTY_INDEX, seed.activeIndex);

        // The caller speaks the walker's own Digimon ids; everything below this
        // line speaks the game's. ONE mapping does the turn (native/pause-status.ts
        // `gameFormId`, the value0 halfword of the row that id numbers), and every
        // id this pane is given goes through it: the party record's own species,
        // the profile row each member's roster goes in at, and the forms the roster
        // record carries. The pane itself reads only the game's table — the strip's
        // species at 0x8003EF5C + 0x58*(self+0x60), the name byte each record's
        // +0x55 carries and the pairing bytes at +0x3D/+0x55 — so a walker id
        // handed straight through would name the wrong Digimon and find no pairing.
        const formOf = (walkerId: number): number => gameFormId(mem, walkerId);
        for (let i = 0; i < 3; i++) {
            const member = seed.members[i];
            if (!member) continue;
            const record = DNA_PARTY_BASE + i * DNA_PARTY_STRIDE;
            mem.write16(record + DNA_PARTY_SPECIES, formOf(member.digimonId) & 0xffff);
            mem.write16(record + DNA_PARTY_MAX_HP, member.maxHp & 0xffff);
            mem.write16(record + DNA_PARTY_HP, member.hp & 0xffff);
            mem.write16(record + DNA_PARTY_MAX_MP, member.maxMp & 0xffff);
            mem.write16(record + DNA_PARTY_MP, member.mp & 0xffff);
            mem.write8(record + DNA_PARTY_BLAST, member.blast ? 1 : 0);
            mem.write8(record + DNA_PARTY_AILMENTS, (member.status ?? 0) & 0xff);
        }

        mem.write32(COMMAND_TIME_OBJECT, 0);
        this.cell = this.widgets.arena.alloc(8, 4);
        this.speciesCell = this.widgets.arena.alloc(8, 4);

        // The carry-over panel reads one profile's roster, and the pane hands it
        // the partner's combatant index, so seed every member's profile: the
        // equipped triple F0x800176AC resolves, one 0x14-byte technique block per
        // form F0x80017A1C searches, and the profile's own 22 stat halfwords.
        // These are the same tables the Digivolve form list seeds, from the same
        // helper — the panel is opened one way twice. The forms arrive as the
        // walker's ids and go through the same mapping, because the roster record
        // the panel reads holds the game's own.
        const forms = seed.members.flatMap((member) => (member.forms ?? []).map(
            (form) => ({ ...form, species: formOf(form.species) })));
        const records = new Map<number, number>();
        const recordFor = (species: number): number => {
            const found = records.get(species);
            if (found !== undefined) return found;
            const address = this.widgets.arena.alloc(0x60, 4);
            const option = forms.find((row) => row.species === species);
            const halfs = (offset: number, values: readonly number[] | undefined, count: number) => {
                for (let i = 0; i < count; i++) {
                    mem.write16(address + offset + i * 2, ((values?.[i] ?? 0) | 0) & 0xffff);
                }
            };
            halfs(0x02, option?.left, FORM_PANEL_LEFT_HALFWORDS);
            halfs(0x0e, option?.right, FORM_PANEL_RIGHT_HALFWORDS);
            // The name byte bank 0x4E is indexed by (species record + 0x55), and the
            // record the pane really asks for is the table's own row, so the byte is
            // that row's +0x55 — NOT the form id. A form the table does not hold has
            // no row and so no name, and 0xFF is past the bank's last word, so it
            // draws none, which is what the original's `beqz` on the species getter
            // leaves on that row.
            const real = profileRecord(mem as never, species) >>> 0;
            mem.write8(address + 0x55, real === 0 ? 0xff : mem.read8(real + DNA_PROFILE_INDEX));
            records.set(species, address);
            return address;
        };
        for (let i = 0; i < 3; i++) {
            const member = seed.members[i];
            if (!member) continue;
            // One index, one record: the roster slot. In the original that is the
            // deployed Digimon's own roster slot — F0x80016D94 ([0x8004B44C])
            // answers it for a party position — and it is what the pane stores at
            // +0x60, hands the candidate service F0x800176AC, reads the strip's
            // first row from (`*(u16 *)(0x8003EF5C + 0x58*it)`) and passes the
            // carry-over panel. So a member's equipped triple and its technique
            // blocks belong where the pane will look for them. The profile block's
            // own species halfword is NOT written here: it is the disc's, and it is
            // the STARTER's (rows 0..7 are the eight starters) — writing the live
            // form there is what made the strip lead with the wrong row.
            const rosterSlot = member.rosterSlot | 0;
            writeFormPanelProfile(mem, rosterSlot, (member.preselected ?? 0) & 0xffff);
            if (member.panel) {
                seedFormRoster(mem, this.widgets.arena.alloc, {
                    ...member.panel,
                    slotIndex: rosterSlot,
                    options: member.panel.options.map(
                        (form) => ({ ...form, species: formOf(form.species) })),
                    ...(member.panel.equipped
                        ? { equipped: member.panel.equipped.map((id) => formOf(id)) }
                        : {}),
                });
            }
        }

        const playSound = (id: number): void => { this.audio.play(id); host.playSound(id); };

        const classes = new Map<number, TranslatedTaskClass>();
        classes.set(DNA_PANE_HANDLER, {
            name: "battle DNA pane",
            childSlots: [DNA_SLOT_MODEL, DNA_SLOT_OPTIONS, DNA_SLOT_PREVIEW_A, DNA_SLOT_PREVIEW_B],
            terminalTick: true,
            tick: (actor, children) => { this.children = children; dnaPaneTick(mem, actor, children, paneHost); },
        });
        classes.set(COMMAND_MENU_HANDLER, {
            name: "battle list model", childSlots: [], terminalTick: true, closeTick: true,
            tick: (menu) => commandMenuStateMachine(mem, menu, paneHost as never),
        });
        classes.set(FORM_PANEL_HANDLER, {
            name: "battle stat carry-over panel", childSlots: [], terminalTick: true, closeTick: true,
            tick: (panel, children) => formPanelTick(mem as never, panel, children, panelHost as never),
        });
        this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));

        // The panel's own host: the same one the Digivolve form list hands its
        // panel, so both screens draw the carry-over pages through one port.
        const panelHost = createFormPanelHost({
            mem, tree: this.tree, widgets: this.widgets, banks: this.banks,
            draw: this.draw, pad: this.pad, playSound,
            frame: () => this.frame,
            allocateActor: () => this.tree.allocate(DNA_PANE_HANDLER, DNA_PANE_SIZE, DNA_PANE_EXTRA),
            createModel: (config) => commandMenuCreate(
                mem as never, config,
                { allocateMenu: () => this.tree.allocate(COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, 0) } as never,
            ),
            memberProfile: (position) => position | 0,
            recordFor,
        });

        const paneHost: DnaPaneHost = {
            allocateActor: () => this.tree.allocate(DNA_PANE_HANDLER, DNA_PANE_SIZE, DNA_PANE_EXTRA),
            createModel: (config) => commandMenuCreate(
                mem as never, config,
                { allocateMenu: () => this.tree.allocate(COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, 0) } as never,
            ),
            createTextElement: (target, kind, x, y) => this.widgets.createTextElement(target, kind, x, y),
            resourceBase: (bank) => this.banks.source(bank),
            packResolve: (handle) => this.draw.packResolve(handle),
            preselectRecord: (species) => profileRecord(mem as never, species),
            // [0x8004B44C](partySlot) (fightstg.s:22494-22498,
            // `lw $v0, -0x4bb4($v0)` whose cell holds F0x80016D94, called with the
            // parent word and stored at +0x60): the ROSTER SLOT that party
            // position holds, not a row of the member's live form. The pane uses
            // that one value in exactly three places: the candidate service,
            // `+0x68 = *(u16 *)(0x8003EF5C + 0x58*it)` (the species the strip
            // starts on — the STARTER species, since rows 0..7 are the eight
            // starters) and the hand-off screen's first argument.
            combatantOf: (slot) => seed.members[slot]?.rosterSlot ?? slot | 0,
            // *[0x8004B46C](combatant, dest, 0, 1) (fightstg.s:21979-21986,
            // `lui $v0, 0x8005` + `lw $v0, -0x4b94($v0)`, whose cell holds
            // 0x800176AC): the partner's own roster record decides the three
            // halfwords. F0x800176AC keeps each of the roster's three EQUIPPED
            // form ids (roster +0x7B0) that is at least 3 and that the roster's
            // own 44-entry acquired-form ledger (roster +0x7B8, 0x14 bytes a
            // block) holds, pads the rest with -1 and answers the kept count.
            // That is the same port the carry-over panel's pages one and two
            // read through form-panel-host.ts, so the species the pane lists and
            // the species the preview pages cannot disagree.
            dnaCandidates: (combatant, dest) => {
                readEquippedForms(mem as never, combatant | 0, dest >>> 0);
            },
            padRead: () => this.pad.pressed(),
            padReadA: () => this.pad.pressed(),
            padReadB: () => this.pad.repeated(),
            playSound,
            frameDelta,
            initDrawContext: () => this.draw.initDrawContext(),
            setLayer: this.draw.setLayer,
            setOrigin: this.draw.setOrigin,
            setPaletteRow: this.draw.paletteShift,
            setSpritePalette: () => {},
            drawSprite: this.draw.drawSprite,
            callMethod: (target, slot, args) => { callTaskOrWidget(mem, this.tree, this.widgets, target, slot, args); return 0; },
            // F0x800953E4(combatant, row, species) (fightstg.s:19043-19063) is
            // F0x80014504(0x80094F08, 0xEC, 0x60) plus three stores, and the tick
            // at 0x80094F08 is the stat carry-over panel the Digivolve form list
            // already shows — form-panel-host.ts and native/digivolve-form-menu.ts
            // port it once, and this is the DNA pane's second caller.
            spawnHandoff: (combatant, row, species) => {
                this.handoffs.push({ combatant: combatant | 0, row: row | 0, species: species | 0 });
                return formPanelConstruct(mem as never, combatant, row, species, panelHost as never);
            },
        };
        const otAddress = this.widgets.arena.alloc(8, 4);
        const packetArea = this.widgets.arena.alloc(0x4000, 4);
        const drawScratch = this.widgets.arena.alloc(0x48, 4);
        const drawerHost: TextDrawerStepperHost = {
            viewForKey: () => 1,
            bucketFor: () => otAddress,
            packetCursor: () => packetArea,
            flushPacketCursor: () => {},
            rotMatrixYXZ: () => { throw new Error("Battle DNA: rotated text is not translated"); },
            scaleMatrix: () => { throw new Error("Battle DNA: scaled text is not translated"); },
            applyMatrixSV: () => { throw new Error("Battle DNA: transformed text is not translated"); },
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

        mem.write32(this.cell, seed.partnerIndex | 0);
        this.root = dnaPaneActorConstruct2(mem, this.cell, this.speciesCell, paneHost);
        this.children = this.tree.tasks.get(this.root)?.children ?? 0;
    }

    /** One display tick. */
    tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
        this.frame = displayTick ?? this.frame + 1;
        this.draw.beginFrame(this.frame);
        this.moves.length = 0;
        this.pad.update(buttons, this.frame);
        this.tree.tick(this.root);
        this.sweepPanels();
        this.widgets.forEachText((w) => textRevealTick(this.mem, this.revealHost, w));
        this.vsync();
    }

    /**
     * The pane alternates two preview slots and closes the one it is about to
     * replace (fightstg.s:22398-22452), so a page change faster than the child
     * traversal retires the old panel leaves one unreferenced. Nothing ticks an
     * unreferenced panel in the original either; the walker's tree would keep it
     * and its text widgets forever, so it is disposed here.
     */
    private sweepPanels(): void {
        if (!this.tree.tasks.has(this.root)) return;
        const slot = this.tree.tasks.get(this.root)!.children;
        sweepFormPanels(this.tree, this.mem, [
            this.mem.read32(slot + DNA_SLOT_PREVIEW_A) >>> 0,
            this.mem.read32(slot + DNA_SLOT_PREVIEW_B) >>> 0,
        ]);
    }

    private vsync(): void {
        const hook = this.mem.read32(COMMAND_TIME_OBJECT) >>> 0;
        if (hook === 0) return;
        if (hook !== COMMAND_MENU_UPDATE) throw new Error(`Untranslated vsync callback ${hook.toString(16)}`);
        commandMenuVsyncBlit(this.mem, this.mem.read32(COMMAND_TIME_OBJECT + 4) >>> 0, this.blitHost);
    }

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
                throw new Error(`Battle DNA: untranslated GPU command ${command.toString(16)}`);
            }
            const next = tag & 0xffffff;
            if (next === 0xffffff) return;
            node = (0x80000000 | next) >>> 0;
        }
        throw new Error("Battle DNA: GPU chain does not terminate");
    }

    finished(): boolean { return !this.tree.tasks.has(this.root); }

    /** The answer word: -1 while the pane is open, -2 for a cancel, else row|species<<4. */
    answer(): number { return this.mem.read32(this.cell) | 0; }

/**
     * The DNA result species the confirm wrote through self+0x80, or 0 while it
     * is still open: the word block is the caller's, the pane only writes it on
     * the DNA DV row.
     */
speciesOut(): number {
        return this.mem.read32(this.speciesCell) >>> 0;
    }

    ready(): boolean {
        return this.tree.tasks.has(this.root) && (this.mem.read32(this.root + DNA_STATE) | 0) === 1;
    }

    /** The sub-state: 0 the species names, 1 the Switch / DNA DV rows. */
    subState(): number {
        return this.tree.tasks.has(this.root) ? this.mem.read32(this.root + DNA_SUB_STATE) | 0 : -1;
    }

    /** The species strip's own cursor, the header's index. */
    stripCursor(): number {
        return this.tree.tasks.has(this.root) ? this.mem.read32(this.root + DNA_STRIP_CURSOR) | 0 : -1;
    }

/**
     * L1/R1's own three-position selection, the carry-over preview's second
     * argument. The Switch / DNA DV row is the option list model's cursor, which
     * the shared list widget moves with Up and Down; read it with optionRow().
     */
previewOption(): number {
        return this.tree.tasks.has(this.root) ? this.mem.read32(this.root + DNA_PREVIEW_OPTION) | 0 : -1;
    }

    /** The row the option list model has selected, 0 "Switch" and 1 "DNA DV". */
    optionRow(): number {
        if (!this.tree.tasks.has(this.root)) return -1;
        const model = this.mem.read32(this.children + DNA_SLOT_OPTIONS) >>> 0;
        return model === 0 ? -1 : this.mem.read32(model + DNA_MODEL_CURSOR) | 0;
    }

    /** The confirmed selection the tail stores, or -1 before the first confirm. */
    selected(): number {
        return this.tree.tasks.has(this.root) ? this.mem.read32(this.root + DNA_SELECTED) | 0 : -1;
    }

    /** The partner's combatant index, kept from the constructor. */
    combatant(): number {
        return this.tree.tasks.has(this.root) ? this.mem.read32(this.root + DNA_COMBATANT) | 0 : -1;
    }

    /** The species the pane lists, `self[2*i + 0x68]`. */
    species(): number[] {
        if (!this.tree.tasks.has(this.root)) return [];
        const out: number[] = [];
        for (let i = 0; i < (this.mem.read32(this.root + DNA_ROW_COUNT) | 0); i++) {
            out.push(this.mem.read16s(this.root + DNA_SPECIES + i * 2) | 0);
        }
        return out;
    }

    /**
     * The stat carry-over panel the pane currently shows, and the page L1 and R1
     * are on: its thirteen page-zero sums, its six technique rows and the headline
     * number, or null while the two preview slots are both empty.
     */
    preview(): {
        page: number;
        row: number;
        address: number;
        block: number[];
        pageZero: number[];
        rows: number[];
        headline: number;
    } | null {
        if (!this.tree.tasks.has(this.root)) return null;
        const children = this.tree.tasks.get(this.root)!.children;
        const address = (this.mem.read32(children + DNA_SLOT_PREVIEW_A) >>> 0)
            || (this.mem.read32(children + DNA_SLOT_PREVIEW_B) >>> 0);
        if (!address) return null;
        const block: number[] = [];
        for (let i = 0; i < FORM_PANEL_BLOCK_HALFWORDS; i++) {
            block.push(this.mem.read16s(address + 0x64 + i * 2) | 0);
        }
        const pageZero: number[] = [];
        for (let i = 0; i < FORM_PANEL_SUM_HALFWORDS; i++) {
            pageZero.push(this.mem.read16s(address + 0x70 + i * 2) | 0);
        }
        const rows: number[] = [];
        for (let i = 0; i < 6; i++) rows.push(this.mem.read16s(address + 0xd4 + i * 4) | 0);
        return {
            page: this.mem.read32(address + 0x58) | 0,
            row: this.mem.read32(address + 0x5c) | 0,
            address,
            block,
            pageZero,
            rows,
            headline: this.mem.read32(address + 0x60) | 0,
        };
    }

    /** The DNA result id the pane settled on, 0 when there is no pairing. */
    dnaId(): number {
        return this.tree.tasks.has(this.root) ? this.mem.read32(this.root + DNA_DNA_ID) | 0 : 0;
    }

    /** The current HP and MP of a party slot, as the pane's tests read them. */
    partyStatus(slot: number): { hp: number; mp: number; status: number } {
        const record = DNA_PARTY_BASE + DNA_PARTY_STRIDE * (slot | 0);
        return {
            hp: this.mem.read16s(record + DNA_PARTY_HP) | 0,
            mp: this.mem.read16(record + DNA_PARTY_MP) & 0xffff,
            status: this.mem.read8(record + 0x1c) | 0,
        };
    }

    /** The Jogress price the pane shows for the DNA DV row. */
    price(): number {
        const id = this.dnaId();
        return id === 0 ? 0 : this.mem.read16(DNA_PRICES + 0x12 * ((id - 1) | 0)) & 0xffff;
    }

    /** Redraw the pane's own art without a screen tick (the verifier's helper). */
    drawArt(): void { dnaPaneArt(this.mem as never, this.root, this.artHost()); }

    private artHost(): DnaPaneHost {
        return {
            initDrawContext: () => this.draw.initDrawContext(),
            setLayer: this.draw.setLayer,
            setOrigin: this.draw.setOrigin,
            packResolve: (handle: number) => this.draw.packResolve(handle),
            drawSprite: this.draw.drawSprite,
        } as unknown as DnaPaneHost;
    }

    vsyncInstalled(): boolean { return (this.mem.read32(COMMAND_TIME_OBJECT) >>> 0) !== 0; }

    dispose(): void { this.tree.dispose(this.root); }
}

/**
 * The whole DNA command: the shared partner list first, then the pane. The list
 * step is a FightTagSession opened in DNA mode (its third constructor argument
 * is the original's self+0x58 mode flag), so the partner list's own port is
 * reused as it stands rather than restated here.
 */
export class FightDnaSession {
    /** The partner list, while it is open. */
    list: FightTagSession | null = null;
    /** The DNA pane, once the list has answered. */
    pane: FightDnaPane | null = null;
    private readonly seed: FightDnaSeed;
    private readonly resources: {
        /** The partner list's own config block (the TAG screen's tables). */
        tables: Uint8Array;
        /** The pane's two config blocks and the four MP-plate x anchors. */
        dnaTables: Uint8Array;
        /** The carry-over panel's thirteen (x, y, sum) triples, 0x800A350C. */
        panelTable: Uint8Array;
        /** The one shared cut of the Digimon profile table (0x8003EF5C, 55 records). */
        profiles: Uint8Array;
        font: Uint8Array;
        techniques: Uint8Array;
        banks: ReadonlyMap<number, Uint8Array>;
        /** The resident cursor glyph table (0x8004DCE0); forwarded or the shared default. */
        cursorGlyphs?: CursorGlyphTable;
    };
    private readonly language: number;
    private readonly host: { playSound(id: number): void };

    constructor(
        language: number,
        seed: FightDnaSeed,
        resources: {
            tables: Uint8Array;
            dnaTables: Uint8Array;
            panelTable: Uint8Array;
            profiles: Uint8Array;
            font: Uint8Array;
            techniques: Uint8Array;
            banks: ReadonlyMap<number, Uint8Array>;
            cursorGlyphs?: CursorGlyphTable;
        },
        host: { playSound(id: number): void },
        withList = true,
    ) {
        this.seed = seed;
        this.resources = resources;
        this.language = language;
        this.host = host;
        if (!withList) {
            // The caller already ran the partner list, so the pane opens at once.
            this.openPane();
            return;
        }
        this.list = new FightTagSession(language, {
            activeIndex: seed.activeIndex,
            // self+0x58 = 1 is the original's DNA mode: it is the flag the
            // per-row compatibility test is gated on.
            interactive: 1,
            members: seed.members.map((m) => ({
                digimonId: m.digimonId, hp: m.hp, maxHp: m.maxHp, mp: m.mp, maxMp: m.maxMp, name: 0, blast: !!m.blast,
            })),
        }, { tables: resources.tables, profiles: resources.profiles, font: resources.font, banks: resources.banks,
             ...(resources.cursorGlyphs ? { cursorGlyphs: resources.cursorGlyphs } : {}) },
           host);
    }

    /** "list" while the partner list is open, "pane" once it has answered. */
    step(): "list" | "pane" | "done" {
        if (this.list && !this.list.finished()) return "list";
        if (this.pane && !this.pane.finished()) return "pane";
        return "done";
    }

    /** Move the DNA command on to the pane with the partner the list answered. */
    openPane(): void {
        if (this.pane) return;
        const chosen = this.list?.chosen();
        const partner = chosen === null || chosen === undefined || chosen < 0
            ? this.seed.partnerIndex : chosen;
        this.pane = new FightDnaPane(this.language, { ...this.seed, partnerIndex: partner | 0 }, {
            tables: this.resources.dnaTables,
            panelTable: this.resources.panelTable,
            techniques: this.resources.techniques,
            species: this.resources.profiles,
            font: this.resources.font,
            banks: this.resources.banks,
            ...(this.resources.cursorGlyphs ? { cursorGlyphs: this.resources.cursorGlyphs } : {}),
        }, this.host);
    }

    /** One display tick on whichever step is open. */
    tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
        const held = [...buttons];
        if (this.list && !this.list.finished()) {
            this.list.tick(held, displayTick);
            if (this.list.finished()) this.openPane();
            return;
        }
        this.pane?.tick(held, displayTick);
    }

    /** The partner the list answered with, -2 for a cancel, or the seed's partner. */
    chosenPartner(): number {
        return this.list ? (this.list.chosen() ?? this.seed.partnerIndex) : this.seed.partnerIndex;
    }

    /** The pane's answer word, or null while the pane is not open yet. */
    answer(): number | null { return this.pane ? this.pane.answer() : null; }

    finished(): boolean { return this.step() === "done"; }

    /** Dispose of every task (the battle left the DNA command another way). */
    dispose(): void {
        this.list?.dispose();
        this.pane?.dispose();
        this.list = null;
        this.pane = null;
    }
}
