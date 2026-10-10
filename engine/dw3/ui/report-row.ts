// The fight report's row handler and its animated flourish, translated from
// pro/stfgtrep:
//   F0x800848E4 reportRowLifecycle — the row's per-frame handler (installed at
//                                    row+0x48 by reportRowCreate)
//   F0x80083744 reportRowFlourishDraw — the row's pictures and its flourish
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/report-row-oracle.test.js runs both originals through
// engine/native on the shipped pro_stfgtrep.bin + resident.bin with the row's
// sub-methods, the roster services, the tile-frame counter and the draw context
// recorded.
//
// DECODED: authority-2 closures `_asm/F0x800848e4.s` (149 instructions) and
// `_asm/F0x80083744.s` (817 instructions), the m2c bodies
// `exe-decomp/stfgtrep_c/F0x800848e4.c` / `F0x80083744.c`, and the canonical
// `docs/research/ui/stfgtrep-decoded-2026-07-12.md` / `overlays/stfgtrep.md`
// readings ("sets a row going" and "draws the row's animated flourish").
//
// Player-visible result: a partner's fight-report row. On the first frame the
// handler starts the row going — its EXP is read from the roster record, the
// target total is this battle's gain added on and clamped to 999,999, and the
// count-up is skipped entirely when the partner is already at 999,999. Every
// later frame it runs the row's state machine and draws the flourish: the
// partner's turning picture on its pedestal, the sparkle badge beside the total,
// one sparkle per party row, the "learned" banner and the per-row underline bars.
//
// The picture is not this screen's own: `*(0x8004B44C)(row+0x5C)` is the resident
// party-position service (F0x80016D94), the SAME row the pause STATUS cards and the
// Digimon Lab ask — the roster slot — and the table at 0x8008905C is this overlay's
// copy of the disc's one eight-row picture table. The walk is the shared
// engine/dw3/ui/digimon-picture.ts reader (ledger claim
// `digimon-picture-row-is-the-roster-slot-2026-10-03`); what stays here is what the
// original keeps per screen: pack 0x079F0000, anchor (0x14, slot*0x32 + 0x28) and
// the 13-frame step.
//
// The tick (F0x80083E74), the widget builder (F0x80083260, lane B) and the
// three learning services are host bridges here; the roster services
// ([0x80048D34+0x2718] / +0x2750) and the frame counter
// ([0x8004DE10+0x188]) are the resident boundaries.

import { type CardDrawHost } from "./cardgame-draw.ts";
import { advanceDigimonPictures, digimonPictureAtBase } from "./digimon-picture.ts";

export interface ReportRowLifecycleMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface ReportRowLifecycleHost extends CardDrawHost {
    /** `[0x8004DE10+0x188]` = resident F0x8001D6F4: the free-running frame counter. */
    frameCounter(): number;
    /**
     * `[0x80048D34+0x2718]` = resident F0x80016D94(position): the party slot's
     * context. The handler turns it into the member record through
     * `rosterHandle`; the flourish uses the same value as the report type that
     * selects its three icon-frame runs.
     */
    rosterSlot(position: number): number;
    /** `[0x80048D34+0x2750]`(slot): the member record base. */
    rosterHandle(slot: number): number;
    /** The row's base-table `+0x38` method: advance the row's phase. */
    advanceRowPhase(fn: number, row: number): void;
    /** The row's `+0x16C` method (F0x80084A2C, lane B): compute the row score. */
    computeRowScore(fn: number, row: number): void;
    /** F0x80083260(row, widgets): build the row's text and number objects. */
    buildRowWidgets(row: number, widgets: number): void;
    /** `[0x80089144]`(tween, on): start the row's fold. */
    rowFoldStart(window: number, on: number): void;
    /** `[0x80089148]`(tween): nonzero once the fold has landed. */
    rowFoldTick(window: number): number;
    /** `[0x80089154]`(slot, gain): nonzero when a level was gained. */
    levelUpApply(slot: number, gain: number): number;
    /** `[0x80089158]`(slot): the unlocked form id, else 0. */
    digivolutionUnlock(slot: number): number;
    /** `[0x8008915C]`(slot, form, gain): nonzero when a form level was gained. */
    dvLadder(slot: number, form: number, gain: number): number;
    /** `[0x80089160]`(slot, form): the learned technique id, else 0. */
    learnTech(slot: number, form: number): number;
    /** `[0x80089164]`(slot, form): the loadable technique id, else 0. */
    makeLoadable(slot: number, form: number): number;
    /** `[0x80089168]`(slot, form, score, count): the DVEXP gain. */
    dvGain(slot: number, form: number, score: number, count: number): number;
    /** `[0x80048D34+0x2738]`(slot, out): copy the partner's form ids. */
    copyRowForms(slot: number, out: number): void;
    /** `[0x80048D34+0x2740]`(slot, out): count the acquired ledger entries. */
    enumerateAcquired(slot: number, out: number): number;
    /** `[0x80044F4C]`(language + offset): the text-bank handle. */
    bankGet(id: number): number;
    /** `[0x8005CCA0]`(form): the profile record for a form. */
    profileRecord(form: number): number;
    /** `[0x80055C48]`(id): start a packed sound, returning its channel. */
    playSound(id: number): number;
    /** `[0x80055C50]`(id, channel): stop a packed sound. */
    stopSound(id: number, channel: number): void;
    /** `[0x8004B7D0]+0x3F4`(port): the pad word pressed this frame. */
    padPressed(port: number): number;
    /** `[0x8004B7D0]+0x408`(port, code): the keymap shift for a button. */
    padKey(port: number, code: number): number;
    /** message widget +0x114(widget, source, id): set a message line. */
    messageSet(widget: number, source: number, id: number): void;
    /** message widget +0x118(widget, line, value): set a number line. */
    messageNumber(widget: number, line: number, value: number): void;
    /** message widget +0x120(widget, source, value, flag): insert an argument. */
    messageInsert(widget: number, source: number, value: number, flag: number): void;
    /** message widget +0x128(widget): skip the typewriter. */
    messageSkip(widget: number): void;
    /** message widget +0x130(widget, mode): start the typewriter. */
    messageStart(widget: number, mode: number): void;
    /** message widget +0x144(widget, value): show or hide the line. */
    messageVisible(widget: number, value: number): void;
    /** message widget +0x168(widget): nonzero when the typewriter has finished. */
    messageDone(widget: number): number;
    /** message widget +0x170(widget): nonzero while waiting for a page turn. */
    messageWaiting(widget: number): number;
    /** F0x80083404(row, widgets, flag): refill or clear the row. */
    fillCard(row: number, widgets: number, flag: number): void;
}

/** The row object's fields this pair of bodies touches. */
export const REPORT_ROW = {
    state: 0x10,
    phase: 0x0c,
    index: 0x5c,
    gain: 0x60,
    capped: 0x64,
    expCurrent: 0x138,
    expTarget: 0x13c,
    expCapFlag: 0x140,
    unk148: 0x148,
    layer: 0x54,
    layerBucket: 0x58,
    scale: 0x150,
    expUp: 0xf0,
    expFrame: 0xf4,
    expFrameAt: 0xf8,
    banner: 0x68,
    bannerFrame: 0x158,
    bannerFrameAt: 0x15c,
    rowIndex: 0xe8,
    statIds: 0x74,
    pictureFrame: 0x6c,
    pictureFrameAt: 0x70,
    advanceFn: 0x38,
    scoreFn: 0x16c,
} as const;

/** The per-party-row records: three of stride 0x10, ending at row+0x30. */
export const REPORT_ROW_ENTRIES = { first: 0x100, stride: 0x10, count: 3 } as const;
/** The sparkle/banner animation step: every 3 frames, clamped at 0xA. */
export const REPORT_ROW_STEP_FRAMES = 3;
export const REPORT_ROW_STEP_MAX = 0xb;
export const REPORT_ROW_STEP_CLAMP = 0xa;
/** The banner step: every 5 frames, four-frame cycle. */
export const REPORT_BANNER_STEP_FRAMES = 5;
export const REPORT_BANNER_FRAMES = 4;
/**
 * The partner's turning picture: every 0xD frames (the same 13 as the pause
 * screen's cards), seven words per row, walking on at eight (`!(next < 8)` in the
 * asm) or restarting at the row's `-1`. The ROW IS THE ROSTER SLOT, from the same
 * `[0x80048D34]+0x2718` service the pause screen asks, and the table is the shared
 * eight-row picture table this overlay copies to 0x8008905C — read through the
 * shared module, not a second copy of the walk.
 */
export const REPORT_PICTURE_STEP_FRAMES = 0xd;
export const REPORT_PICTURE_WRAP = 8;
/** `lui $v1,0x8009 / addiu $v1,-0x6fa4` = 0x8008905C (pro/stfgtrep.s:914-916). */
export const REPORT_PICTURE_TABLE = 0x8008905c;
/** The fight report's own resident sheet. */
export const REPORT_PACK = 0x079f0000;
export const REPORT_ORIGIN_X = 0x280;
export const REPORT_CLIP_SPARKLE_BADGE = 0x22;
export const REPORT_CLIP_ROW_SPARKLE = 0x23;
export const REPORT_CLIP_BANNER = 0x24;
export const REPORT_CLIP_UNDERLINE = 0x25;
export const REPORT_CLIP_BANNER_BACK = 0x1f;
export const REPORT_CLIP_BAR = 0x20;
/** `sp94(pack, tile, 0x14, base+0x28)` — the picture's own anchor (F0x80083744). */
export const REPORT_X_PICTURE = 0x14;
export const REPORT_Y_PICTURE = 0x28;
export const REPORT_X_SPARKLE_BADGE = 0x63;
export const REPORT_X_ROW_SPARKLE = 0xef;
export const REPORT_X_BANNER = 0x11;
export const REPORT_X_UNDERLINE = 0x87;
export const REPORT_PITCH = 0x32;
export const REPORT_ROW_PITCH = 0x0f;
export const REPORT_MIN_STATE = 0x14;
export const REPORT_EXP_CAP = 0x0f423f;
export const REPORT_EXP_FLAG_AT = 0x0f423e;
export const REPORT_CAP_FLAG = 0x0a;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;

/**
 * F0x80083744(row): draw the row's animated flourish. The sparkles and the
 * banner step on their own frame clocks; the type icon walks the overlay's
 * seven-frame table for the row's report type.
 */
export function reportRowFlourishDraw(
    mem: ReportRowLifecycleMemory, row: number, host: ReportRowLifecycleHost,
): void {
    host.setLayer(s32(mem.read32(row + REPORT_ROW.layer)), s32(mem.read32(row + REPORT_ROW.layerBucket)));
    host.setOrigin(REPORT_ORIGIN_X, 0);
    const pitch = s32(mem.read32(row + REPORT_ROW.index)) * REPORT_PITCH;

    if (s32(mem.read32(row + REPORT_ROW.state)) >= REPORT_MIN_STATE) {
        if (s32(mem.read32(row + REPORT_ROW.expUp)) !== 0) {
            // The original reads the counter once for the comparison and again
            // for the store, so the port must issue both reads.
            if ((host.frameCounter() | 0) - (mem.read32(row + REPORT_ROW.expFrameAt) | 0) >= REPORT_ROW_STEP_FRAMES) {
                mem.write32(row + REPORT_ROW.expFrameAt, (host.frameCounter() | 0) >>> 0);
                let next = (mem.read32(row + REPORT_ROW.expFrame) | 0) + 1;
                if (next >= REPORT_ROW_STEP_MAX) next = REPORT_ROW_STEP_CLAMP;
                mem.write32(row + REPORT_ROW.expFrame, next >>> 0);
            }
            host.setFrame(s32(mem.read32(row + REPORT_ROW.expFrame)));
            host.drawSprite(host.packResolve(REPORT_PACK) >>> 0, REPORT_CLIP_SPARKLE_BADGE,
                REPORT_X_SPARKLE_BADGE, pitch + 0x2b);
            host.setFrame(0);
        }
        let step = 0;
        for (let i = 0; i < REPORT_ROW_ENTRIES.count; i++) {
            const entry = row + REPORT_ROW_ENTRIES.first + i * REPORT_ROW_ENTRIES.stride;
            if (s32(mem.read32(entry)) !== 0) {
                if ((host.frameCounter() | 0) - (mem.read32(entry + 0x08) | 0) >= REPORT_ROW_STEP_FRAMES) {
                    mem.write32(entry + 0x08, (host.frameCounter() | 0) >>> 0);
                    let next = (mem.read32(entry + 0x04) | 0) + 1;
                    if (next >= REPORT_ROW_STEP_MAX) next = REPORT_ROW_STEP_CLAMP;
                    mem.write32(entry + 0x04, next >>> 0);
                }
                host.setFrame(s32(mem.read32(entry + 0x04)));
                host.drawSprite(host.packResolve(REPORT_PACK) >>> 0, REPORT_CLIP_ROW_SPARKLE,
                    REPORT_X_ROW_SPARKLE, pitch + step + 0x23);
            }
            step += REPORT_ROW_PITCH;
        }
        host.setFrame(0);
    }

    if (s32(mem.read32(row + REPORT_ROW.banner)) !== 0) {
        if ((host.frameCounter() | 0) - (mem.read32(row + REPORT_ROW.bannerFrameAt) | 0) >= REPORT_BANNER_STEP_FRAMES) {
            mem.write32(row + REPORT_ROW.bannerFrameAt, (host.frameCounter() | 0) >>> 0);
            let next = (mem.read32(row + REPORT_ROW.bannerFrame) | 0) + 1;
            if (next >= REPORT_BANNER_FRAMES) next = 0;
            mem.write32(row + REPORT_ROW.bannerFrame, next >>> 0);
        }
        host.setFrame(s32(mem.read32(row + REPORT_ROW.bannerFrame)));
        host.drawSprite(host.packResolve(REPORT_PACK) >>> 0, REPORT_CLIP_BANNER, REPORT_X_BANNER, pitch + 0x26);
        if (s32(mem.read32(row + REPORT_ROW.state)) >= REPORT_MIN_STATE) {
            const index = s32(mem.read32(row + REPORT_ROW.rowIndex));
            if (index >= 0 && s16(mem.read16s(row + REPORT_ROW.statIds + index * 2)) >= 4) {
                host.drawSprite(host.packResolve(REPORT_PACK) >>> 0, REPORT_CLIP_UNDERLINE,
                    REPORT_X_UNDERLINE, pitch + index * REPORT_ROW_PITCH + 0x26);
            }
        }
        host.setFrame(0);
    }

const scale = s32(mem.read32(row + REPORT_ROW.scale));
    if (scale === 0) return;
    if (scale !== 0x1000) host.setScale(scale, 0x1000, 0x1000);
    // The partner's turning picture. F0x80083744 asks the party-position service
    // once for the row, then walks it through the shared eight-row table this
    // overlay copies to 0x8008905C: 13 frames a step, on at eight or at the row's
    // `-1`. The walk itself is engine/dw3/ui/digimon-picture.ts, the same one the
    // pause screen and the Lab use; only the pack, the anchor and the step cadence
    // are this screen's.
    const pictureRow = host.rosterSlot(s32(mem.read32(row + REPORT_ROW.index))) | 0;
    if (scale !== 0x1000) host.setPos(REPORT_X_BANNER, pitch + 0x3a);
    advanceDigimonPictures({
        mem,
        tableBase: REPORT_PICTURE_TABLE,
        timer: row + REPORT_ROW.pictureFrameAt,
        cadence: REPORT_PICTURE_STEP_FRAMES,
        frame: () => host.frameCounter() | 0,
        groups: [{
            counterBase: row + REPORT_ROW.pictureFrame,
            count: 1,
            rowAt: () => pictureRow,
            skipNegativeRow: false,
            wrapAt: REPORT_PICTURE_WRAP,
        }],
    });
    const picture = digimonPictureAtBase(mem, REPORT_PICTURE_TABLE,
        pictureRow, mem.read32(row + REPORT_ROW.pictureFrame) | 0);
    host.drawSprite(host.packResolve(REPORT_PACK) >>> 0, picture, REPORT_X_PICTURE, pitch + REPORT_Y_PICTURE);
    if (s32(mem.read32(row + REPORT_ROW.expUp)) !== 0) host.setFrame(s32(mem.read32(row + REPORT_ROW.expFrame)));
    host.drawSprite(host.packResolve(REPORT_PACK) >>> 0, REPORT_CLIP_BANNER_BACK, REPORT_X_BANNER, pitch + 0x26);
    if (s32(mem.read32(row + REPORT_ROW.expUp)) !== 0) host.setFrame(0);
    let step = 0;
    for (let i = 0; i < REPORT_ROW_ENTRIES.count; i++) {
        const entry = row + REPORT_ROW_ENTRIES.first + i * REPORT_ROW_ENTRIES.stride;
        if (scale !== 0x1000) host.setPos(REPORT_X_UNDERLINE, pitch + step + 0x2d);
        const frame = s32(mem.read32(entry)) !== 0 ? s32(mem.read32(entry + 0x04)) : 0;
        host.setFrame(frame);
        host.drawSprite(host.packResolve(REPORT_PACK) >>> 0, REPORT_CLIP_BAR, REPORT_X_UNDERLINE, pitch + step + 0x26);
        step += REPORT_ROW_PITCH;
    }
}

/**
 * F0x800848E4(row, widgets): the row's per-frame handler. State 1 runs the
 * state machine and the flourish; states 2 and 3 idle; every other state sets
 * the row going.
 */
export function reportRowLifecycle(
    mem: ReportRowLifecycleMemory, row: number, widgets: number, host: ReportRowLifecycleHost,
): void {
    const state = s32(mem.read32(row + REPORT_ROW.phase));
    if (state === 1) {
        reportRowTick(mem, row, widgets, host);
        reportRowFlourishDraw(mem, row, host);
        return;
    }
    if (state >= 2 && state < 4) return;

    host.advanceRowPhase(mem.read32(row + REPORT_ROW.advanceFn) >>> 0, row);
    host.buildRowWidgets(row, widgets);
    mem.write32(row + REPORT_ROW.unk148, REPORT_CAP_FLAG);
    const slot = host.rosterSlot(s32(mem.read32(row + REPORT_ROW.index))) >>> 0;
    const record = host.rosterHandle(slot) >>> 0;
    const current = s32(mem.read32(record + 0x18));
    mem.write32(row + REPORT_ROW.expCurrent, current >>> 0);
    if (current > REPORT_EXP_FLAG_AT) mem.write32(row + REPORT_ROW.expCapFlag, REPORT_CAP_FLAG);
    if (s32(mem.read32(row + REPORT_ROW.capped)) === 0) {
        host.computeRowScore(mem.read32(row + REPORT_ROW.scoreFn) >>> 0, row);
    }
    let target = s32(mem.read32(record + 0x18)) + s32(mem.read32(row + REPORT_ROW.gain));
    if (target > REPORT_EXP_CAP) target = REPORT_EXP_CAP;
    mem.write32(row + REPORT_ROW.expTarget, target >>> 0);
}

/** The row-tick's own fields and the widgets block it drives. */
export const REPORT_TICK = {
    state: 0x10,
    selector: 0x14,
    widgets: 0x24,
    parent: 0x50,
    partner: 0x5c,
    gain: 0x60,
    banner: 0x68,
    forms: 0x74,
    acquired: 0x7a,
    formIndex: 0xe8,
    levelUpFlag: 0xf0,
    levelUpFrame: 0xf4,
    formFlag: 0x100,
    formFrame: 0x104,
    evolutionLatch: 0x12c,
    soundId: 0x130,
    soundChannel: 0x134,
    tween: 0x148,
    expShown: 0x138,
    expTarget: 0x13c,
    expStep: 0x140,
    scoreCount: 0x70,
} as const;

/** The eight overlay cells the tick calls, and the row's widget block. */
export const REPORT_CELL_FOLD_OPEN = 0x80089144;
export const REPORT_CELL_FOLD_TICK = 0x80089148;
export const REPORT_CELL_LEVEL_UP = 0x80089154;
export const REPORT_CELL_DIGIVOLVE = 0x80089158;
export const REPORT_CELL_DV_LADDER = 0x8008915c;
export const REPORT_CELL_LEARN_TECH = 0x80089160;
export const REPORT_CELL_LOADABLE = 0x80089164;
export const REPORT_CELL_DV_GAIN = 0x80089168;
/** The per-party form gate and the score table the state-20 arm reads. */
export const REPORT_FORM_GATE = 0x80042b84;
export const REPORT_DV_SCORE_TABLE = 0x80086a88;
/** The message widget is the block's +0x2C member. */
export const REPORT_WIDGETS_MESSAGE = 0x2c;
/** The bank offsets the four messages are fetched through. */
export const REPORT_BANK_TEXT = 0x55;
export const REPORT_BANK_ARGS = 0xa2;
export const REPORT_BANK_PROFILE = 0x4e;
export const REPORT_LANGUAGE = 0x8005cca8;
/** The sounds the tick plays and the button it waits on. */
export const REPORT_SFX_TECH = 0x4000c;
export const REPORT_SFX_APPLY = 0x4001c;
export const REPORT_SFX_LEVEL_UP = 0x4000b;
export const REPORT_SFX_COUNT_DONE = 0x800452c6;
export const REPORT_PAD_CIRCLE = 0xd;
/** The count-up's ten-step shortcut. */
export const REPORT_COUNT_STEPS = 0xa;

/** (pressed >> key(code)) & 1 for the row's Circle read. */
function padBit(host: ReportRowLifecycleHost, code: number): boolean {
    return (((host.padPressed(0) | 0) >> host.padKey(0, code)) & 1) !== 0;
}

/**
 * F0x80083D9C(row): one step of the experience count-up. Returns 1 while the
 * shown total is still climbing (the caller beeps on that), 0 when it snapped.
 */
export function expCountupStep(
    mem: ReportRowLifecycleMemory, row: number, host: ReportRowLifecycleHost,
): number {
    const step = ((mem.read32(row + REPORT_TICK.expStep) | 0) + 1) | 0;
    mem.write32(row + REPORT_TICK.expStep, step >>> 0);
    const widgets = mem.read32(row + REPORT_TICK.widgets) >>> 0;
    if (step >= REPORT_COUNT_STEPS) {
        mem.write32(row + REPORT_TICK.expShown, mem.read32(row + REPORT_TICK.expTarget) >>> 0);
        host.fillCard(row, widgets, 1);
        return 0;
    }
    let target = mem.read32(row + REPORT_TICK.expTarget) | 0;
    let digits = 0;
    let place = 10;
    while (target !== 0) {
        target -= target % place;
        digits += 1;
        place *= 10;
    }
    let repunit = 1;
    for (let k = 1; k < digits; k++) repunit = 10 * repunit + 1;
    const next = (mem.read32(row + REPORT_TICK.expShown) | 0) + repunit;
    mem.write32(row + REPORT_TICK.expShown, next >>> 0);
    if (9 * repunit < next) mem.write32(row + REPORT_TICK.expShown, (next - 1 - 9 * repunit) >>> 0);
    host.fillCard(row, widgets, 1);
    return 1;
}

/**
 * F0x80083E74(row, widgets): the report row's state machine. Every arm falls
 * through to the shared tail, which runs the count-up once the row is past
 * state 0x13 and beeps when it stepped.
 */
export function reportRowTick(
    mem: ReportRowLifecycleMemory, row: number, widgets: number, host: ReportRowLifecycleHost,
): void {
    const state = mem.read32(row + REPORT_TICK.state) | 0;
    const message = mem.read32(widgets + REPORT_WIDGETS_MESSAGE) >>> 0;
    const parent = mem.read32(row + REPORT_TICK.parent) >>> 0;
    const formIndex = mem.read32(row + REPORT_TICK.formIndex) | 0;
    const partner = mem.read32(row + REPORT_TICK.partner) | 0;
    const bank = (offset: number): number => host.bankGet((mem.read32(REPORT_LANGUAGE) | 0) + offset);
    const advance = (): void => {
        mem.write32(row + REPORT_TICK.state, ((mem.read32(row + REPORT_TICK.state) | 0) + 1) | 0);
    };
    // +0x130 is a word and +0x134 is a halfword, as the asm's sw/sh pair shows.
    const playCue = (id: number): void => {
        const channel = host.playSound(id) | 0;
        mem.write32(row + REPORT_TICK.soundId, id >>> 0);
        mem.write16(row + REPORT_TICK.soundChannel, channel & 0xffff);
    };
    const stopCue = (): void => {
        const channel = s16(mem.read16s(row + REPORT_TICK.soundChannel));
        if (channel === -1) return;
        host.stopSound(mem.read32(row + REPORT_TICK.soundId) | 0, channel);
        mem.write16(row + REPORT_TICK.soundChannel, 0xffff);
    };
    const formId = (index: number): number => s16(mem.read16s(row + REPORT_TICK.forms + index * 2));

    switch (state) {
        case 1:
            host.rowFoldStart(row + REPORT_TICK.tween, 1);
            advance();
            break;

        case 2:
            if ((host.rowFoldTick(row + REPORT_TICK.tween) | 0) !== 0) {
                host.fillCard(row, widgets, 1);
                mem.write32(row + REPORT_TICK.state, 5);
            }
            break;

        case 11:
            host.rowFoldStart(row + REPORT_TICK.tween, 0);
            host.fillCard(row, widgets, 0);
            advance();
            break;

        case 12:
            if ((host.rowFoldTick(row + REPORT_TICK.tween) | 0) !== 0) {
                mem.write32(row + REPORT_TICK.state, 0x0f);
            }
            break;

        case 20: {
            const slot = host.rosterSlot(partner) | 0;
            host.copyRowForms(slot, row + REPORT_TICK.forms);
            if (mem.read8(REPORT_FORM_GATE + partner * 4 + formIndex + 7) !== 0) {
                const form = formId(formIndex);
                if (form >= 4) {
                    const score = mem.read32(REPORT_DV_SCORE_TABLE + s16(mem.read16s(REPORT_FORM_GATE)) * 0x0c) | 0;
                    const gain = host.dvGain(slot, form, score, mem.read32(parent + REPORT_TICK.scoreCount) | 0) | 0;
                    mem.write32(row + REPORT_TICK.formFlag + formIndex * 0x10,
                        host.dvLadder(slot, form, gain) >>> 0);
                }
            }
            advance();
            break;
        }

        case 21:
            if ((mem.read32(row + REPORT_TICK.formFlag + formIndex * 0x10) | 0) !== 0) {
                stopCue();
                playCue(REPORT_SFX_TECH);
                host.messageSet(message, bank(REPORT_BANK_TEXT), 4);
                host.messageStart(message, 6);
                host.fillCard(row, widgets, 1);
                mem.write32(row + REPORT_TICK.state, 0x19);
                mem.write32(row + REPORT_TICK.selector, 0);
            } else {
                mem.write32(row + REPORT_TICK.state, 0x18);
            }
            break;

        case 22: {
            const slot = host.rosterSlot(partner) | 0;
            host.copyRowForms(slot, row + REPORT_TICK.forms);
            const tech = host.learnTech(slot, formId(formIndex)) | 0;
            if (tech !== 0) {
                host.messageSet(message, bank(REPORT_BANK_TEXT), 5);
                host.messageInsert(message, bank(REPORT_BANK_ARGS), tech, 1);
                host.messageStart(message, 6);
                mem.write32(row + REPORT_TICK.state, 0x19);
                mem.write32(row + REPORT_TICK.selector, 1);
            } else {
                mem.write32(row + REPORT_TICK.state, 0x17);
            }
            break;
        }

        case 23: {
            const slot = host.rosterSlot(partner) | 0;
            host.copyRowForms(slot, row + REPORT_TICK.forms);
            const tech = host.makeLoadable(slot, formId(formIndex)) | 0;
            if (tech !== 0) {
                host.messageSet(message, bank(REPORT_BANK_TEXT), 6);
                host.messageInsert(message, bank(REPORT_BANK_ARGS), tech, 1);
                host.messageStart(message, 6);
                mem.write32(row + REPORT_TICK.state, 0x19);
                mem.write32(row + REPORT_TICK.selector, 2);
            } else {
                mem.write32(row + REPORT_TICK.state, 0x18);
            }
            break;
        }

        case 24: {
            const next = formIndex + 1;
            mem.write32(row + REPORT_TICK.formIndex, next >>> 0);
            if (next >= 3) {
                mem.write32(row + REPORT_TICK.formIndex, 0xffffffff);
                mem.write32(row + REPORT_TICK.state, 0x28);
            } else {
                mem.write32(row + REPORT_TICK.state, 0x14);
            }
            break;
        }

        case 25:
        case 45:
            if ((host.messageDone(message) | 0) !== 0) {
                host.messageVisible(message, 0);
                mem.write32(parent + REPORT_TICK.forms, 0);
                // The selector's own six-word table: 0/1 and >=6 -> 0x16,
                // 2 -> 0x17, 3/4 -> 0x29, 5 -> 0x32.
                switch (mem.read32(row + REPORT_TICK.selector) | 0) {
                    case 2:
                        mem.write32(row + REPORT_TICK.state, 0x17);
                        break;
                    case 3:
                    case 4:
                        mem.write32(row + REPORT_TICK.state, 0x29);
                        break;
                    case 5:
                        mem.write32(row + REPORT_TICK.state, 0x32);
                        break;
                    default:
                        mem.write32(row + REPORT_TICK.state, 0x16);
                        break;
                }
            } else if ((host.messageWaiting(message) | 0) !== 0) {
                if (padBit(host, REPORT_PAD_CIRCLE)) {
                    host.playSound(REPORT_SFX_APPLY);
                } else {
                    mem.write32(parent + REPORT_TICK.forms, 1);
                }
            } else if (padBit(host, REPORT_PAD_CIRCLE)) {
                host.messageSkip(message);
            }
            break;

        case 40: {
            const slot = host.rosterSlot(partner) | 0;
            if ((host.levelUpApply(slot, mem.read32(row + REPORT_TICK.gain) | 0) | 0) !== 0) {
                const record = host.rosterHandle(slot) >>> 0;
                mem.write32(row + REPORT_TICK.levelUpFlag, 1);
                stopCue();
                playCue(REPORT_SFX_LEVEL_UP);
                host.messageSet(message, bank(REPORT_BANK_TEXT), 7);
                host.messageInsert(message, record, 0xffffffff, 1);
                host.messageNumber(message, 2, s16(mem.read16s(record + 0x1c)));
                host.messageStart(message, 6);
                mem.write32(row + REPORT_TICK.state, 0x2d);
                mem.write32(row + REPORT_TICK.selector, 3);
            } else {
                mem.write32(row + REPORT_TICK.state, 0x29);
            }
            host.fillCard(row, widgets, 1);
            break;
        }

        case 41: {
            const form = host.digivolutionUnlock(host.rosterSlot(partner) | 0) | 0;
            if (form !== 0) {
                const profile = host.profileRecord(form) >>> 0;
                host.messageSet(message, bank(REPORT_BANK_TEXT), 8);
                host.messageInsert(message, bank(REPORT_BANK_PROFILE), mem.read8(profile + 0x55), 1);
                host.messageStart(message, 6);
                host.fillCard(row, widgets, 1);
                mem.write32(row + REPORT_TICK.state, 0x2d);
                mem.write32(row + REPORT_TICK.selector, 4);
                mem.write32(row + REPORT_TICK.evolutionLatch, 1);
            } else if ((mem.read32(row + REPORT_TICK.evolutionLatch) | 0) !== 0) {
                mem.write32(row + REPORT_TICK.state, 0x2a);
            } else {
                mem.write32(row + REPORT_TICK.state, 0x32);
            }
            break;
        }

        case 42:
            if ((host.enumerateAcquired(host.rosterSlot(partner) | 0,
                row + REPORT_TICK.acquired) | 0) >= 4) {
                host.messageSet(message, bank(REPORT_BANK_TEXT), 9);
                host.messageStart(message, 6);
                mem.write32(row + REPORT_TICK.state, 0x2d);
                mem.write32(row + REPORT_TICK.selector, 5);
            } else {
                mem.write32(row + REPORT_TICK.state, 0x32);
            }
            break;

        case 50: {
            let done = 1;
            if ((mem.read32(row + REPORT_TICK.levelUpFlag) | 0) !== 0) {
                done = ((mem.read32(row + REPORT_TICK.levelUpFrame) | 0) < REPORT_COUNT_STEPS) ? 0 : 1;
            }
            if (done !== 0) {
                for (let i = 0; i < 3; i++) {
                    if ((mem.read32(row + REPORT_TICK.formFlag + i * 0x10) | 0) !== 0
                        && (mem.read32(row + REPORT_TICK.formFrame + i * 0x10) | 0) < REPORT_COUNT_STEPS) {
                        done = 0;
                    }
                }
                if (done !== 0) {
                    mem.write32(row + REPORT_TICK.state, 5);
                    mem.write32(row + REPORT_TICK.banner, 0);
                }
            }
            break;
        }

        default:
            break;
    }

    if ((mem.read32(row + REPORT_TICK.state) | 0) >= REPORT_MIN_STATE
        && expCountupStep(mem, row, host) !== 0) {
        host.playSound(REPORT_SFX_COUNT_DONE);
    }
}
