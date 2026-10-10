// The card duel's per-player HUD: the panel slide and the card row, translated
// from pro/cardgame:
//   F0x80099440 slidePlayerPanel — the whole HUD half slides on / off
//   F0x80098898 drawPlayerCardRow — the strip, cubes, plaques, counters and icons
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/player-hud-oracle.test.js runs both originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin with the draw
// context, the pack resolver, the frame delta and the digit drawer recorded.
//
// DECODED: authority-2 closures `_asm/F0x80099440.s` (706 lines, jump table
// D0x80083730 at 0x80083730) and `_asm/F0x80098898.s` (1497 lines), the m2c
// bodies `exe-decomp/cardgame_c/F0x80099440.c` and `F0x80098898.c`, and the
// accepted contract `cardgame-panel-row-contracts`.
//
// Player-visible result: each player's whole HUD half. The panel slide moves it
// as one piece: side 0's strip travels down (rest y 141, away y 241), side 1's
// travels up (rest y 0, away y -100); the y-only states 4/5 move the strip and
// leave the deck/pile and plate parked. The row draws the strip chrome, the
// five S-ENERGY cube plates with their counts, the AP/HP plaques with their
// 3-digit totals and glows, the deck and trash counters with their animated
// icons, the trash plate at its own origin, and the main card plate. At rest
// (every flag byte 0) the cubes and icons sit on their resting frames and no
// glow is drawn, which is what the reference capture shows.

import { drawDigitSprites, type CardDrawHost, type CardDrawMemory } from "./cardgame-draw.ts";

export interface PlayerHudMemory extends CardDrawMemory {
    read16(addr: number): number;
    read16s(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface PlayerHudHost extends CardDrawHost {
    /** `[0x8004DF9C]` = resident F0x8001D704: the frame delta. */
    frameDelta(): number;
    /** A host-owned scratch buffer (the original builds its digit record on the stack). */
    scratch(bytes: number): number;
}

/** The panel object: 0x54 bytes at view+0x60 (side 0) / view+0xB4 (side 1). */
export const PANEL = {
    timer: 0x00, duration: 0x02, state: 0x04, arrival: 0x06,
    x: 0x0c, y: 0x0e, altX: 0x20, altY: 0x22, plateX: 0x3c, plateY: 0x3e,
} as const;

/** The two sides' constants (prologue of F0x80099440). */
export const PANEL_SIDE = [
    { restY: 0x8d, awayY: 0xf1, constY: 0x8f, endY: 0xbd },
    { restY: 0x00, awayY: -0x64, constY: 0x50, endY: 0x26 },
] as const;
export const PANEL_ALT_REST = 0x120;
export const PANEL_ALT_AWAY = 0x147;
export const PANEL_PLATE_REST = 0x113;
export const PANEL_PLATE_AWAY = 0x13a;
export const PANEL_ARRIVED = 2;
export const PANEL_GONE = 0;

/** The row screen's fields. */
export const ROW = {
    phase: 0x08,
    xOrigin: 0x0c,
    yOrigin: 0x0e,
    totalA: 0x10,
    totalB: 0x12,
    slotNumbers: 0x18,
    counterA: 0x1d,
    counterB: 0x1e,
    altX: 0x20,
    altY: 0x22,
    altNumber: 0x28,
    flags: 0x30,
    altMarkerGate: 0x35,
    deckGate: 0x36,
    trashGate: 0x37,
    apGlow: 0x38,
    hpGlow: 0x39,
    plateX: 0x3c,
    plateY: 0x3e,
    plateIndex: 0x44,
} as const;

/** The per-side record: 0x4C bytes at side*0x4C + 0x800A59D0. */
export const ROW_RECORD = 0x800a59d0;
export const ROW_RECORD_STRIDE = 0x4c;
export const ROW_REC = {
    chromeClip: 0x01, plateClip: 0x02, altClip: 0x03,
    cubeX: 0x04, cubeY: 0x06, slotX: 0x08, slotY: 0x0a,
    counterAX: 0x0c, counterAY: 0x0e, counterBX: 0x10, counterBY: 0x12,
    altNumberX: 0x14, altNumberY: 0x16,
    labelAX: 0x18, labelAY: 0x1a, totalAX: 0x1c, totalAY: 0x1e,
    labelBX: 0x20, labelBY: 0x22, totalBX: 0x24, totalBY: 0x26,
    iconBX: 0x28, iconBY: 0x2a, iconAX: 0x2c, iconAY: 0x2e,
    altCardX: 0x30, altCardY: 0x32, slotPlateX: 0x34, slotPlateY: 0x36,
    markerAX: 0x38, markerAY: 0x3a, markerBX: 0x3c, markerBY: 0x3e,
    altMarkerX: 0x40, altMarkerY: 0x42, pileAX: 0x44, pileAY: 0x46,
    pileBX: 0x48, pileBY: 0x4a,
} as const;

/** The row's frame-cycle tables (all byte tables). */
export const ROW_PLATE_CYCLE = 0x800a5a68;
export const ROW_LABEL_CLIPS = 0x800a5a70;
export const ROW_TRASH_CYCLE = 0x800a5a80;
export const ROW_DECK_CYCLE = 0x800a5a88;
export const ROW_ALT_CYCLE = 0x800a5a90;
export const ROW_CUBE_CLIPS = 0x800a5a98;
export const ROW_CUBE_CYCLE = 0x800a5aa0;
export const ROW_LANGUAGE_PTR = 0x8005cca8;
/** `[0x8005CCB0]`: nonzero on a 50Hz build — the strip and plate shift 12px. */
export const ROW_HZ_FLAG = 0x8005ccb0;
export const ROW_50HZ_TERM = 0x0c;
export const ROW_SLOT_COUNT = 5;
export const ROW_SLOT_STRIDE = 0x2a;
export const ROW_LAYER = 0x100;
export const ROW_DRAW_LAYER = 1;
export const ROW_BOARD_PAGE = 0x340;
export const ROW_CARD_PAGE = 0x280;
export const ROW_BOARD_PACK = 0x025d0003;
export const ROW_CARD_PACK = 0x025d0002;
export const ROW_PLATE_PERIOD = 36;
export const ROW_LABEL_PERIOD = 24;
export const ROW_ICON_PERIOD = 30;
export const ROW_CYCLE_STEP = 6;
/** Board clips the row draws directly. */
export const ROW_CLIP_SLOT = 0x0d;
export const ROW_CLIP_GLOW = 0x0c;
export const ROW_CLIP_COUNTER = 0x0e;
export const ROW_CLIP_ALT_MARKER = 0x0f;
/** Card-sheet clip offsets. */
export const ROW_CLIP_TRASH_BASE = 9;
export const ROW_CLIP_DECK_BASE = 6;
export const ROW_CLIP_ALT_CARD_BASE = 0x31;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;

/** The console's signed DIV: by zero the emulator leaves lo = sign(dividend). */
function mipsDiv(a: number, b: number): number {
    if (b !== 0) return Math.trunc(a / b);
    return a >= 0 ? -1 : 1;
}

/**
 * F0x80099440(panel, side): slide one player's whole HUD half.
 * States 1 (in) / 3 (out) move every widget; states 4 (in) / 5 (out) move only
 * the strip and pin the others away. States 0 and 2 do nothing.
 */
export function slidePlayerPanel(
    mem: PlayerHudMemory, panel: number, side: number, host: PlayerHudHost,
): void {
    const cfg = PANEL_SIDE[side === 0 ? 0 : 1];
    const restY = cfg.restY;
    const awayY = cfg.awayY;
    const constY = cfg.constY;
    const endY = cfg.endY;

    const arrival = s16(mem.read16s(panel + PANEL.arrival));
    if (arrival === 1 || arrival === 2) mem.write16(panel + PANEL.arrival, 0);
    const state = mem.read16(panel + PANEL.state) & 0xffff;
    if (state >= 6) return;

    const duration = s16(mem.read16s(panel + PANEL.duration));
    const tick = (): number => {
        const t = (mem.read16(panel + PANEL.timer) - (host.frameDelta() | 0)) & 0xffff;
        mem.write16(panel + PANEL.timer, t);
        return t;
    };
    const lerp = (from: number, to: number, t: number): number =>
        from - mipsDiv((from - to) * t, duration);

    if (state === 1) {
        const t = tick();
        if (s16(t) > 0) {
            mem.write16(panel + PANEL.x, s16(0 - mipsDiv(0, duration)));
            mem.write16(panel + PANEL.y, s16(lerp(restY, awayY, s16(t))));
            mem.write16(panel + PANEL.altX, s16(PANEL_ALT_REST - mipsDiv((PANEL_ALT_REST - PANEL_ALT_AWAY) * s16(t), duration)));
            mem.write16(panel + PANEL.altY, constY - mipsDiv((constY - constY) * s16(t), duration));
            mem.write16(panel + PANEL.plateX, PANEL_PLATE_REST - mipsDiv((PANEL_PLATE_REST - PANEL_PLATE_AWAY) * s16(t), duration));
            mem.write16(panel + PANEL.plateY, endY - mipsDiv((endY - endY) * s16(t), duration));
            return;
        }
        mem.write16(panel + PANEL.state, PANEL_ARRIVED);
        mem.write16(panel + PANEL.timer, 0);
        mem.write16(panel + PANEL.duration, 0);
        mem.write16(panel + PANEL.x, 0);
        mem.write16(panel + PANEL.y, restY);
        mem.write16(panel + PANEL.altX, PANEL_ALT_REST);
        mem.write16(panel + PANEL.altY, constY);
        mem.write16(panel + PANEL.plateX, PANEL_PLATE_REST);
        mem.write16(panel + PANEL.plateY, endY);
        return;
    }

    if (state === 3) {
        const t = tick();
        if (s16(t) > 0) {
            mem.write16(panel + PANEL.x, s16(0 - mipsDiv(0, duration)));
            mem.write16(panel + PANEL.y, s16(lerp(awayY, restY, s16(t))));
            mem.write16(panel + PANEL.altX, s16(0x147 - mipsDiv((0x147 - 0x120) * s16(t), duration)));
            mem.write16(panel + PANEL.altY, constY - mipsDiv((constY - constY) * s16(t), duration));
            mem.write16(panel + PANEL.plateX, PANEL_PLATE_AWAY - mipsDiv((PANEL_PLATE_AWAY - PANEL_PLATE_REST) * s16(t), duration));
            mem.write16(panel + PANEL.plateY, endY - mipsDiv((endY - endY) * s16(t), duration));
            return;
        }
        mem.write16(panel + PANEL.state, PANEL_GONE);
        mem.write16(panel + PANEL.arrival, 1);
        mem.write16(panel + PANEL.timer, 0);
        mem.write16(panel + PANEL.duration, 0);
        mem.write16(panel + PANEL.x, 0);
        mem.write16(panel + PANEL.y, awayY);
        mem.write16(panel + PANEL.altX, PANEL_ALT_AWAY);
        mem.write16(panel + PANEL.altY, constY);
        mem.write16(panel + PANEL.plateX, PANEL_PLATE_AWAY);
        mem.write16(panel + PANEL.plateY, PANEL_PLATE_AWAY);
        return;
    }

    if (state === 4) {
        mem.write16(panel + PANEL.altX, PANEL_ALT_AWAY);
        mem.write16(panel + PANEL.altY, constY);
        mem.write16(panel + PANEL.plateX, PANEL_PLATE_AWAY);
        mem.write16(panel + PANEL.plateY, PANEL_PLATE_AWAY);
        const t = tick();
        if (s16(t) > 0) {
            mem.write16(panel + PANEL.x, s16(0 - mipsDiv(0, duration)));
            mem.write16(panel + PANEL.y, s16(lerp(restY, awayY, s16(t))));
            return;
        }
        mem.write16(panel + PANEL.state, PANEL_ARRIVED);
        mem.write16(panel + PANEL.timer, 0);
        mem.write16(panel + PANEL.duration, 0);
        mem.write16(panel + PANEL.x, 0);
        mem.write16(panel + PANEL.y, restY);
        return;
    }

    if (state === 5) {
        mem.write16(panel + PANEL.altX, PANEL_ALT_AWAY);
        mem.write16(panel + PANEL.altY, constY);
        mem.write16(panel + PANEL.plateX, PANEL_PLATE_AWAY);
        mem.write16(panel + PANEL.plateY, PANEL_PLATE_AWAY);
        const t = tick();
        if (s16(t) > 0) {
            mem.write16(panel + PANEL.x, s16(0 - mipsDiv(0, duration)));
            mem.write16(panel + PANEL.y, s16(lerp(awayY, restY, s16(t))));
            return;
        }
        mem.write16(panel + PANEL.state, PANEL_GONE);
        mem.write16(panel + PANEL.arrival, 1);
        mem.write16(panel + PANEL.timer, 0);
        mem.write16(panel + PANEL.duration, 0);
        mem.write16(panel + PANEL.x, 0);
        mem.write16(panel + PANEL.y, awayY);
    }
}

/** The row's per-tick draw state. */
interface RowState {
    phase: number;
    s16Phase: number;
    y: number;
    plateY: number;
    rec: number;
}

function rowDigit(
    mem: PlayerHudMemory, host: PlayerHudHost, record: number, value: number,
    x: number, y: number, count: number, force: number,
): void {
    mem.write16(record + 0x00, value & 0xffff);
    mem.write16(record + 0x02, x & 0xffff);
    mem.write16(record + 0x04, y & 0xffff);
    mem.write8(record + 0x0e, count);
    mem.write8(record + 0x0f, force);
    mem.write8(record + 0x10, 1);
    drawDigitSprites(mem, record, 0, host);
}

/**
 * F0x80098898(screen, side): one tick of one player's HUD row.
 * The three context passes draw the board chrome and the card sheet in the
 * exact order the original issues them; the digit drawer fills the counters.
 */
export function drawPlayerCardRow(
    mem: PlayerHudMemory, screen: number, side: number, host: PlayerHudHost,
): void {
    let y = s16(mem.read16s(screen + ROW.yOrigin));
    let plateY = s32(mem.read16s(screen + ROW.plateY));
    if (s32(mem.read32(ROW_HZ_FLAG)) !== 0) {
        if (side === 0) {
            y = s16(y + ROW_50HZ_TERM);
            plateY = s32(plateY + ROW_50HZ_TERM);
        } else {
            y = s16(y - ROW_50HZ_TERM);
            plateY = s32(plateY - ROW_50HZ_TERM);
        }
    }
    const phase = s32(mem.read32(screen + ROW.phase));
    const rec = ROW_RECORD + side * ROW_RECORD_STRIDE;
    const xOrigin = s16(mem.read16s(screen + ROW.xOrigin));
    const altX = s16(mem.read16s(screen + ROW.altX));
    const altY = s16(mem.read16s(screen + ROW.altY));
    const lang = s32(mem.read32(ROW_LANGUAGE_PTR));
    const r16 = (off: number): number => s16(mem.read16s(rec + off));
    const r8 = (off: number): number => mem.read8(rec + off);
    const boardPack = (): number => host.packResolve(ROW_BOARD_PACK) >>> 0;
    const cardPack = (): number => host.packResolve(ROW_CARD_PACK) >>> 0;
    const cycle = (period: number): number => Math.trunc((phase % period) / ROW_CYCLE_STEP);

    // Pass A: the board-sheet chrome.
    host.setLayer(ROW_LAYER, ROW_DRAW_LAYER);
    host.setOrigin(ROW_BOARD_PAGE, 0);
    host.setFrame(mem.read8(ROW_PLATE_CYCLE + cycle(ROW_PLATE_PERIOD)));
    for (let i = 0; i < ROW_SLOT_COUNT; i++) {
        if (mem.read8(screen + ROW.flags + i) !== 0) {
            host.drawSprite(boardPack(), ROW_CLIP_SLOT,
                s16(xOrigin + r16(ROW_REC.slotPlateX) + i * ROW_SLOT_STRIDE),
                s16(y + r16(ROW_REC.slotPlateY)));
        }
    }
    if (mem.read8(screen + ROW.apGlow) !== 0) {
        host.drawSprite(boardPack(), ROW_CLIP_GLOW,
            s16(xOrigin + r16(ROW_REC.pileAX)), s16(y + r16(ROW_REC.pileAY)));
    }
    if (mem.read8(screen + ROW.hpGlow) !== 0) {
        host.drawSprite(boardPack(), ROW_CLIP_GLOW,
            s16(xOrigin + r16(ROW_REC.pileBX)), s16(y + r16(ROW_REC.pileBY)));
    }
    if (mem.read8(screen + ROW.deckGate) !== 0) {
        host.drawSprite(boardPack(), ROW_CLIP_COUNTER,
            s16(xOrigin + r16(ROW_REC.markerAX)), s16(y + r16(ROW_REC.markerAY)));
    }
    if (mem.read8(screen + ROW.trashGate) !== 0) {
        host.drawSprite(boardPack(), ROW_CLIP_COUNTER,
            s16(xOrigin + r16(ROW_REC.markerBX)), s16(y + r16(ROW_REC.markerBY)));
    }
    if (mem.read8(screen + ROW.altMarkerGate) !== 0) {
        host.drawSprite(boardPack(), ROW_CLIP_ALT_MARKER,
            s16(altX + r16(ROW_REC.altMarkerX)), s16(altY + r16(ROW_REC.altMarkerY)));
    }

    // Pass B: the board-sheet labels and every number.
    host.setLayer(ROW_LAYER, ROW_DRAW_LAYER);
    host.setOrigin(ROW_BOARD_PAGE, 0);
    const labelRow = cycle(ROW_LABEL_PERIOD);
    host.setFrame(mem.read8(screen + ROW.apGlow) !== 0 ? labelRow + 1 : 0);
    host.drawSprite(boardPack(), mem.read8(ROW_LABEL_CLIPS + lang * 2),
        s16(xOrigin + r16(ROW_REC.labelAX)), s16(y + r16(ROW_REC.labelAY)));
    host.setFrame(mem.read8(screen + ROW.hpGlow) !== 0 ? labelRow + 1 : 0);
    host.drawSprite(boardPack(), mem.read8(ROW_LABEL_CLIPS + lang * 2 + 1),
        s16(xOrigin + r16(ROW_REC.labelBX)), s16(y + r16(ROW_REC.labelBY)));

    const digit = host.scratch(0x12);
    rowDigit(mem, host, digit, mem.read8(screen + ROW.counterA), s16(xOrigin + r16(ROW_REC.counterAX)),
        s16(r16(ROW_REC.counterAY) + y), 2, 1);
    rowDigit(mem, host, digit, mem.read8(screen + ROW.counterB), s16(xOrigin + r16(ROW_REC.counterBX)),
        s16(r16(ROW_REC.counterBY) + y), 2, 1);
    rowDigit(mem, host, digit, mem.read16(screen + ROW.totalA), s16(xOrigin + r16(ROW_REC.totalAX)),
        s16(r16(ROW_REC.totalAY) + y), 3, 0);
    rowDigit(mem, host, digit, mem.read16(screen + ROW.totalB), s16(xOrigin + r16(ROW_REC.totalBX)),
        s16(r16(ROW_REC.totalBY) + y), 3, 0);
    for (let i = 0; i < ROW_SLOT_COUNT; i++) {
        rowDigit(mem, host, digit, mem.read8(screen + ROW.slotNumbers + i),
            s16(xOrigin + r16(ROW_REC.slotX) + i * ROW_SLOT_STRIDE), s16(r16(ROW_REC.slotY) + y), 2, 1);
    }
    rowDigit(mem, host, digit, mem.read16(screen + ROW.altNumber), s16(altX + r16(ROW_REC.altNumberX)),
        s16(altY + r16(ROW_REC.altNumberY)), 2, 1);

    // Pass C: the card sheet.
    host.setLayer(ROW_LAYER, ROW_DRAW_LAYER);
    host.setOrigin(ROW_CARD_PAGE, 0);
    host.drawSprite(cardPack(), s32(r8(ROW_REC.plateClip) + mem.read32(screen + ROW.plateIndex)),
        s16(mem.read16s(screen + ROW.plateX)), plateY);
    const iconRow = cycle(ROW_ICON_PERIOD);
    host.drawSprite(cardPack(),
        mem.read8(ROW_TRASH_CYCLE + (mem.read8(screen + ROW.trashGate) !== 0 ? iconRow : 0)) + ROW_CLIP_TRASH_BASE,
        s16(xOrigin + r16(ROW_REC.iconAX)), s16(y + r16(ROW_REC.iconAY)));
    host.drawSprite(cardPack(),
        mem.read8(ROW_DECK_CYCLE + (mem.read8(screen + ROW.deckGate) !== 0 ? iconRow : 0)) + ROW_CLIP_DECK_BASE,
        s16(xOrigin + r16(ROW_REC.iconBX)), s16(y + r16(ROW_REC.iconBY)));
    host.drawSprite(cardPack(),
        mem.read8(ROW_ALT_CYCLE + (mem.read8(screen + ROW.altMarkerGate) !== 0 ? iconRow : 0)) + ROW_CLIP_ALT_CARD_BASE,
        altX, altY);
    for (let i = 0; i < ROW_SLOT_COUNT; i++) {
        const frame = mem.read8(screen + ROW.flags + i) !== 0 ? iconRow : 0;
        host.drawSprite(cardPack(),
            mem.read8(ROW_CUBE_CLIPS + i) + mem.read8(ROW_CUBE_CYCLE + frame),
            s16(xOrigin + r16(ROW_REC.cubeX) + i * ROW_SLOT_STRIDE), s16(y + r16(ROW_REC.cubeY)));
    }
    host.drawSprite(cardPack(), r8(ROW_REC.altClip),
        s16(altX + r16(ROW_REC.altCardX)), s16(altY + r16(ROW_REC.altCardY)));
    host.drawSprite(cardPack(), r8(ROW_REC.chromeClip), xOrigin, y);

    mem.write32(screen + ROW.phase, ((phase + (host.frameDelta() | 0)) & 0xffff) >>> 0);
}
