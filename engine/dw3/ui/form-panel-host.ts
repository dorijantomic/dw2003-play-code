// The stat carry-over panel of pro/fightstg, shared by every screen that opens it.
//
// F0x800953E4 builds the panel (tick 0x80094F08, 0xEC bytes, 0x60 extra) from three
// numbers: the profile it describes, which of its three pages to show, and which
// row of the owner's list the cursor is on. Two callers pass those three and
// nothing else: the Digivolve form list (F0x80094478, .L0x80094558) and the
// in-battle DNA pane (F0x800980E4, .L0x8009881C and .L0x80098858). The panel's
// own port is native/digivolve-form-menu.ts — this file supplies the host both
// screens need and the roster tables the panel reads through, so the panel is
// opened the same way twice instead of once per screen.
//
// The panel's own numbers, from the tick at fightstg.s:18727-19040:
//   +0x54 the profile, +0x58 the page (0..2, what L1 and R1 walk), +0x5C the row.
//   page 0  [0x8004B468] writes the 22-halfword stat block at +0x64; for any row
//           but the first the row's species record adds its six halfwords at
//           +0x02 into +0x70 and its seven at +0x0E into +0x7C. Thirteen number
//           widgets take those thirteen sums (table 0x800A350C), clamped to 999,
//           and +0x8A/+0x8C/+0x8E grey three of them.
//   page 1  the row's 0x14-byte technique block lands at +0x98; its level byte
//           (+0x02) becomes the headline at +0x60 and its six entry words (+0x08)
//           the six rows at +0xD4. With no row, +0x60 is -1 (the dash) and
//           +0xD4 the profile's own pre-selected word with the signature bit.
//   page 2  every equipped member's block lands at +0x98 + 0x14*member; the
//           members OTHER than the row contribute their loadable (0x4000) ids,
//           masked to 13 bits, into a ten-entry scratch table, which is compacted
//           into +0xD4 with duplicates dropped.
import type { NativeMemory } from "../../native/memory.ts";
import { frameDelta } from "../../systems/frame-clock.ts";
import {
    equippedFormsAddress, formTechBlockAddress, readEquippedForms, readFormTechBlock,
    registerFormTechBlock, TECH_BLOCK_COUNT, TECH_BLOCK_SIZE, TECH_MIN_SPECIES, writeFormTechBlock,
} from "../form-tech-blocks.ts";
import { buildEffectiveStats, EFFECTIVE_SRC_OFFSET } from "../effective-stats.ts";
import { ROSTER_SLOT_STRIDE, SAVE_CONTEXT } from "../form-ledger.ts";
import type { ScreenTextBanks } from "./screen-text-banks.ts";
import type { ShopDrawIntents } from "./shop-draw-intents.ts";
import type { ShopWidgetServices } from "./shop-widget-services.ts";
import type { ScreenPad } from "./screen-services.ts";
import type { TranslatedTaskTree } from "./translated-task-tree.ts";
import { callTaskOrWidget } from "./resident-text-host.ts";
import {
    FORM_ICON_TABLE, FORM_PANEL_EXTRA, FORM_PANEL_HANDLER, FORM_PANEL_SIZE,
    FORM_PROFILE_BLOCK, FORM_PROFILE_STRIDE, type FormListHost,
} from "./native/digivolve-form-menu.ts";

/** Halfwords F0x80017174 copies into the panel's page-zero block (0x2C bytes). */
export const FORM_PANEL_BLOCK_HALFWORDS = 22;
/** A technique block is five words; its six entry words live at +0x08. */
const TECH_BLOCK_SIZE_WORDS = TECH_BLOCK_SIZE / 4;
const TECH_ENTRY_COUNT = 6;

/** One form the panel can be asked about, as the caller holds it. */
export interface FormPanelOption {
    /** The species id the row carries. */
    species: number;
    /** The six halfwords at species record +0x02 the panel sums into +0x70. */
    left: readonly number[];
    /** The seven halfwords at species record +0x0E the panel sums into +0x7C. */
    right: readonly number[];
    /** The six technique entry words: 13-bit id plus the 0x8000/0x4000 flags. */
    techs: readonly number[];
    /** The form's level, the technique block's byte at +0x02. */
    level: number;
    /** Digivolution exp banked against the form (the block's word at +0x04). */
    dvexp: number;
}

/** Everything the panel reads about one profile. */
export interface FormPanelMember {
    /**
     * The roster slot (F0x80016D94, `[0x8004B44C]`): the index into the roster
     * records at `0x80049494 + slot*0x3DC` AND into the disc's profile table at
     * `0x8003EF5C + 0x58*slot`, whose rows 0..7 are the eight starters.
     */
    slotIndex: number;
    /** The forms this profile can be asked about, in list order. */
    options: readonly FormPanelOption[];
    /** The three equipped form ids; the panel reads the triple itself at +0x90. */
    equipped?: readonly number[];
    /** The profile's own 22 halfwords, [0x8004B468]'s answer. */
    panelBlock: readonly number[];
}

/**
 * Write one profile's roster tables: the 0x2C stat block F0x80017174 copies
 * (halfwords 19..21 are the buff counters that subtract from STR, DEF and SPD
 * and grey three page-zero numbers), the three equipped form ids F0x800176AC
 * resolves, and the 44 technique blocks F0x80017A1C searches — one per form,
 * carrying its level and its six entry words.
 */
export function seedFormRoster(
    mem: NativeMemory,
    alloc: (bytes: number, align: number) => number,
    member: FormPanelMember,
): void {
    const slot = member.slotIndex;
    const base = (SAVE_CONTEXT + slot * ROSTER_SLOT_STRIDE) >>> 0;
    for (let i = 0; i < FORM_PANEL_BLOCK_HALFWORDS; i++) {
        mem.write16(base + EFFECTIVE_SRC_OFFSET + i * 2, (member.panelBlock[i] ?? 0) & 0xffff);
    }
    const equipped = member.equipped
        ? member.equipped
        : member.options.slice(1).map((row) => row.species);
    for (let i = 0; i < 3; i++) {
        mem.write16(equippedFormsAddress(slot) + i * 2, (equipped[i] ?? -1) & 0xffff);
    }
    for (let i = 0; i < TECH_BLOCK_COUNT; i++) {
        const at = formTechBlockAddress(slot, i);
        for (let b = 0; b < TECH_BLOCK_SIZE_WORDS; b++) mem.write32(at + b * 4, 0);
    }
    const scratch = alloc(TECH_BLOCK_SIZE, 4);
    const seen = new Set<number>();
    for (const row of member.options) {
        if (row.species < TECH_MIN_SPECIES || seen.has(row.species)) continue;
        seen.add(row.species);
        // F0x80017924 acquires the form (level 1), then F0x80017AB4 — the DRI
        // menu's own save path — writes the whole entry with its real level and
        // its six technique words.
        registerFormTechBlock(mem, slot, row.species);
        for (let i = 0; i < TECH_BLOCK_SIZE_WORDS; i++) mem.write32(scratch + i * 4, 0);
        mem.write16(scratch, row.species & 0xffff);
        mem.write8(scratch + 0x02, row.level & 0xff);
        mem.write32(scratch + 0x04, row.dvexp >>> 0);
        for (let i = 0; i < TECH_ENTRY_COUNT; i++) {
            mem.write16(scratch + 0x08 + i * 2, (row.techs[i] ?? 0) & 0xffff);
        }
        writeFormTechBlock(mem, slot, row.species, scratch);
    }
}

/**
 * The panel's own read of the per-profile block at `0x8003EF5C + 0x58*rosterSlot`,
 * and the ONLY word it needs from it: the pre-selected technique halfword at
 * `+0x28`, which page one shows for the cursor sitting on the first row
 * (digivolve-form-menu.ts `formPanelPageOneData`, `cursor === 0`).
 *
 * The block's own species halfword at `+0x00` is the DISC's and stays that way.
 * That halfword is the whole point of the row: rows 0..7 are the eight starters,
 * so it is the partner's STARTER species, and both the DNA pane's strip
 * (battle-dna-menu.ts `dnaPaneSeed`, `lhu` at `0x8003EF5C + 0x58*(self+0x60)`)
 * and the Digivolve list's first row (`formListBuild`, `FORM_LIST_CURRENT`) read
 * it as their leading row. An earlier port of this helper also wrote that
 * halfword, from the member's LIVE form — which made both strips lead with the
 * form the Digimon was currently in instead. Nothing in the original ever writes
 * this table.
 */
export function writeFormPanelProfile(mem: NativeMemory, rosterSlot: number, preselected: number): void {
    const block = (FORM_PROFILE_BLOCK + Math.imul(rosterSlot, FORM_PROFILE_STRIDE)) >>> 0;
    mem.write16(block + 0x28, preselected & 0xffff);
}

export interface FormPanelHostDeps {
    mem: NativeMemory;
    tree: TranslatedTaskTree;
    widgets: ShopWidgetServices;
    banks: ScreenTextBanks;
    draw: ShopDrawIntents;
    pad: ScreenPad;
    playSound(id: number): void;
    /** The display tick, which [0x8004DF98] answers for the page arrows. */
    frame(): number;
    /** F0x80014504(0x80094478, 0x74, 0x1C): the owner's own screen object. */
    allocateActor(): number;
    /** F0x8009B0C8(config): the shared list model. */
    createModel(config: number): number;
    /** [0x8004B44C](position): the profile that party position holds. */
    memberProfile(position: number): number;
    /**
     * The species record the panel's name byte and page-zero sums come from:
     * 0x60 bytes with the six halfwords at +0x02, the seven at +0x0E and the name
     * byte at +0x55. Zero answers an unknown id, as [0x8005CCA0] does.
     */
    recordFor(species: number): number;
}

/**
 * The host both screens hand the panel. Every service is one the caller already
 * owns: the task factory and the default methods are the caller's tree, the text
 * box and the three resident helpers are the ports in effective-stats.ts and
 * form-tech-blocks.ts, and the picture context is the caller's draw intents.
 */
export function createFormPanelHost(deps: FormPanelHostDeps): FormListHost {
    const { mem, tree, widgets, banks, draw, pad } = deps;
    return {
        allocateActor: deps.allocateActor,
        createModel: deps.createModel,
        allocatePanel: () => tree.allocate(FORM_PANEL_HANDLER, FORM_PANEL_SIZE, FORM_PANEL_EXTRA),
        createTextElement: (target, kind, x, y) => widgets.createTextElement(target, kind, x, y),
        resourceBase: (bank) => banks.source(bank),
        packResolve: (handle) => draw.packResolve(handle),
        padRead: () => pad.pressed(),
        padReadA: () => pad.pressed(),
        padReadB: () => pad.repeated(),
        playSound: deps.playSound,
        frameCounter: () => deps.frame(),
        frameDelta,
        setPaletteRow: draw.paletteShift,
        initDrawContext: () => draw.initDrawContext(),
        setLayer: draw.setLayer,
        setOrigin: draw.setOrigin,
        drawSprite: draw.drawSprite,
        // [0x8004B46C] / ctx+0x2738 = F0x800176AC, get_equipped: it resolves each
        // of the roster's three equipped ids through the 44 technique blocks and
        // answers the kept count, which is what page one reads and page two loops.
        profileForms: (profile, dest) => readEquippedForms(mem, profile, dest),
        memberProfile: deps.memberProfile,
        speciesRecord: deps.recordFor,
        // [0x8004B468] / ctx+0x2734 = F0x80017174, buildEffectiveStats: it copies
        // the roster's 0x2C stat block, folds in the status sweep, then subtracts
        // the three counters at +0x26/+0x28/+0x2A from STR, DEF and SPD. Those
        // three land on panel +0x8A/+0x8C/+0x8E and grey page zero's first, second
        // and fifth numbers (F0x80094AD0 reads child slots 5, 6 and 9).
        panelBlock: (profile, dest) => {
            buildEffectiveStats(mem, { definitionRecord: () => 0 }, profile, dest);
        },
        // [0x8004B47C] = F0x80017A1C: it finds the species' 0x14-byte technique
        // block in the roster and copies all five words, so the panel's reads of
        // the level byte (dest+0x02) and the six entry words (dest+0x08) are the
        // original's bytes.
        profileTechs: (profile, species, dest) => readFormTechBlock(mem, profile, species, dest),
        callMethod: (target, slot, args) => { callTaskOrWidget(mem, tree, widgets, target, slot, args); },
    };
}

/** The exe's technique table the panel's icon draw reads: 18 bytes per entry. */
export const FORM_PANEL_ICON_TABLE = FORM_ICON_TABLE;

/**
 * Drop the panels no child slot points at. The original closes a panel by writing
 * state 2 into it and leaves the pointer in the slot until the traversal zeroes
 * it, and it alternates two slots, so a caller that replaces the panel faster than
 * the traversal retires the old one leaves a panel unreferenced — the original
 * simply never ticks it again. The walker's task tree would keep it (and its text
 * widgets) forever, so the session disposes it instead. `live` is every child slot
 * address that still holds a panel.
 */
export function sweepFormPanels(
    tree: TranslatedTaskTree,
    mem: NativeMemory,
    live: readonly number[],
): void {
    for (const address of [...tree.tasks.keys()]) {
        const task = tree.tasks.get(address)!;
        if (task.classId !== FORM_PANEL_HANDLER) continue;
        if (live.includes(address)) continue;
        tree.dispose(address);
    }
    void mem;
}
