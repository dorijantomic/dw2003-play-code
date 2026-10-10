// The Online Center wizard's animation families, translated from pro/stplnmet.
//
// Family C (table-dwell): F0x80083748 (create) and F0x800835F0 (tick).
// Family B (frame-step):  F0x800835C4 (create) and F0x800833E8 (tick).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/wizard-anim-oracle.test.js runs the original through
// engine/native and compares the draw intents, the frame fields and the index
// walk.
//
// DECODED: `exe-decomp/stplnmet_c/_asm/F0x80083748.s` / `F0x800835F0.s` and
// `_asm/F0x800835c4.s` / `_asm/F0x800833e8.s` (authority 2) and the accepted
// wizard-screen-families answer Family C.
//
// Family C create is F0x80014504(handler 0x800835F0, size 0x68, extra 0). The
// tick's state 1 draws at origin (0x280,0x100) on layer (0x1001,6); it holds an
// index at +0x60 and a frame stamp at +0x64 into the 8-byte record table
// 0x800885EC (word0 threshold, word1 sprite id). Every frame whose delta
// exceeds the current record's threshold advances the index and restamps; a
// record whose sprite id is 0 wraps the index to 0. Then it draws the current
// record's sprite id from pack 0x028A0000 at (0,0).
//
// Family B create is F0x80014504(handler 0x800833E8, size 0x68, extra 0). Its
// tick's state 1 also draws at origin (0x280,0x100) on layer (0x1001,6) from the
// same pack 0x028A0000, but it walks the 12-frame clip range 0x18..0x23 with a
// 5-tick dwell held at +0x60 and stamped at +0x64, and draws that one clip at
// five fixed positions. In any other state except 2 and 3 it resets +0x60 to
// 0x18 and calls the +0x38 advance method.

export interface WizardAnimMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface WizardAnimHost {
    /** F0x80014504(handler, size, extra) -> the new animation object. */
    allocAnim(handler: number, size: number, extra: number): number;
    /** obj->0x38 (F0x800142AC): advance/close. */
    advance(obj: number): void;
    /** F0x8001F648: reset the draw context. */
    initDrawContext(): void;
    setOrigin(x: number, y: number): void;
    setLayer(target: number, bucket: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** [0x80044F5C] = F0x800140D8: pack handle -> directory pointer. */
    packResolve(handle: number): number;
    /** [0x8004DF98] = F0x8001D6F4: free-running frame tick. */
    frameTick(): number;
}

export const WIZARD_TABLE_DWELL_HANDLER = 0x800835f0;
export const WIZARD_TABLE_DWELL_SIZE = 0x68;
export const WIZARD_TABLE_DWELL_EXTRA = 0;
/** 8-byte records: word0 threshold, word1 sprite id; id 0 terminates. */
export const WIZARD_DWELL_TABLE = 0x800885ec;
export const WIZARD_DWELL_PACK = 0x028a0000;
export const WIZARD_DWELL_ORIGIN = { x: 0x280, y: 0x100 } as const;
export const WIZARD_DWELL_LAYER = { target: 0x1001, bucket: 6 } as const;

export const WIZARD_FRAME_STEP_HANDLER = 0x800833e8;
export const WIZARD_FRAME_STEP_SIZE = 0x68;
export const WIZARD_FRAME_STEP_EXTRA = 0;
export const WIZARD_FRAME_STEP_PACK = 0x028a0000;
/** First/last (exclusive) clip of the 12-frame walk; wraps back to FIRST. */
export const WIZARD_FRAME_STEP_FIRST = 0x18;
export const WIZARD_FRAME_STEP_LAST = 0x24;
/** Ticks between frame steps: advance when (now - stamp) >= DWELL. */
export const WIZARD_FRAME_STEP_DWELL = 5;
export const WIZARD_FRAME_STEP_ORIGIN = { x: 0x280, y: 0x100 } as const;
export const WIZARD_FRAME_STEP_LAYER = { target: 0x1001, bucket: 6 } as const;
/** The five fixed draw positions, in the original's call order. */
export const WIZARD_FRAME_STEP_POSITIONS = [
    { x: 0x33, y: 0 },
    { x: 0x78, y: -0x14 },
    { x: 0xa7, y: -0x58 },
    { x: 0xf8, y: 0xd },
    { x: 0x120, y: 0 },
] as const;

/** Animation object fields (both families share this layout). */
export const WIZARD_ANIM = {
    state: 0x0c,
    advance: 0x38,
    index: 0x60,
    stamp: 0x64,
} as const;

const s32 = (v: number): number => v | 0;

/** F0x80083748(): build the table-dwell animation object. */
export function wizardTableDwellCreate(mem: WizardAnimMemory, host: WizardAnimHost): number {
    return host.allocAnim(WIZARD_TABLE_DWELL_HANDLER, WIZARD_TABLE_DWELL_SIZE, WIZARD_TABLE_DWELL_EXTRA) >>> 0;
}

/** F0x800835F0(obj): one table-dwell frame. */
export function wizardTableDwellTick(
    mem: WizardAnimMemory,
    obj: number,
    host: WizardAnimHost,
): void {
    const state = s32(mem.read32(obj + WIZARD_ANIM.state));

    if (state === 1) {
        host.initDrawContext();
        host.setOrigin(WIZARD_DWELL_ORIGIN.x, WIZARD_DWELL_ORIGIN.y);
        host.setLayer(WIZARD_DWELL_LAYER.target, WIZARD_DWELL_LAYER.bucket);

        const tick = host.frameTick();
        let index = s32(mem.read32(obj + WIZARD_ANIM.index));
        const threshold = s32(mem.read32(WIZARD_DWELL_TABLE + index * 8));
        if (threshold < s32(tick - s32(mem.read32(obj + WIZARD_ANIM.stamp)))) {
            const now = host.frameTick();
            mem.write32(obj + WIZARD_ANIM.stamp, now >>> 0);
            index += 1;
            mem.write32(obj + WIZARD_ANIM.index, index >>> 0);
            if (s32(mem.read32(WIZARD_DWELL_TABLE + index * 8 + 4)) === 0) {
                index = 0;
                mem.write32(obj + WIZARD_ANIM.index, 0);
            }
        }
        host.drawSprite(
            host.packResolve(WIZARD_DWELL_PACK) >>> 0,
            mem.read32(WIZARD_DWELL_TABLE + index * 8 + 4) >>> 0,
            0,
            0,
        );
        return;
    }
    if (state === 2 || state === 3) return;
    host.advance(obj);
}

/** F0x800835C4(): build the frame-step animation object. */
export function wizardFrameStepCreate(mem: WizardAnimMemory, host: WizardAnimHost): number {
    return host.allocAnim(WIZARD_FRAME_STEP_HANDLER, WIZARD_FRAME_STEP_SIZE, WIZARD_FRAME_STEP_EXTRA) >>> 0;
}

/** F0x800833E8(obj): one frame-step animation frame. */
export function wizardFrameStepTick(
    mem: WizardAnimMemory,
    obj: number,
    host: WizardAnimHost,
): void {
    const state = s32(mem.read32(obj + WIZARD_ANIM.state));

    if (state !== 1) {
        // States 0, 1 (handled), >=4 reset the frame and advance; 2 and 3 idle.
        if (state < 2 || state >= 4) {
            mem.write32(obj + WIZARD_ANIM.index, WIZARD_FRAME_STEP_FIRST);
            host.advance(obj);
        }
        return;
    }

    host.initDrawContext();
    host.setOrigin(WIZARD_FRAME_STEP_ORIGIN.x, WIZARD_FRAME_STEP_ORIGIN.y);
    host.setLayer(WIZARD_FRAME_STEP_LAYER.target, WIZARD_FRAME_STEP_LAYER.bucket);

    let frame = s32(mem.read32(obj + WIZARD_ANIM.index));
    const now = s32(host.frameTick());
    if (s32(now - s32(mem.read32(obj + WIZARD_ANIM.stamp))) >= WIZARD_FRAME_STEP_DWELL) {
        const stamp = host.frameTick();
        mem.write32(obj + WIZARD_ANIM.stamp, stamp >>> 0);
        frame += 1;
        if (frame >= WIZARD_FRAME_STEP_LAST) frame = WIZARD_FRAME_STEP_FIRST;
        mem.write32(obj + WIZARD_ANIM.index, frame >>> 0);
    }

    // The original re-fetches the pack handle at the +0x424 slot before each
    // of the five draws; keep that call order even though the lookup is pure.
    for (const pos of WIZARD_FRAME_STEP_POSITIONS) {
        host.drawSprite(host.packResolve(WIZARD_FRAME_STEP_PACK) >>> 0, frame >>> 0, pos.x, pos.y);
    }
}

// ---------------------------------------------------------------------------
// Family A (intro / entry animation), translated from pro/stplnmet
// F0x800833A4 (create, `_asm/F0x800833a4.s`), F0x80083144 (tick,
// `_asm/F0x80083144.s`), F0x80083310 and F0x80083398 (the two custom method
// slots the create installs; decoded from the raw overlay image, authority 2,
// because the disassembler never named their starts).
//
// The create allocates F0x80014504(handler 0x80083144, size 0x84, extra 0) and
// installs +0x7C = 0x80083310 (origin/context setup) and +0x80 = 0x80083398
// (layer setter). The tick's state 1 draws two scrolling elements from pack
// 0x02C40000 at the origin/layer the setters stored, plus a fixed third clip:
// each element holds a stamp at +0x64 (element 0) / +0x68 (element 1) and an
// x/y pair at +0x6C/+0x70 (element 0) / +0x74/+0x78 (element 1). When
// (index + 1) < (tick - stamp) the pair steps x -= 2, y += 1; if the 4-byte
// threshold table 0x800885E4[index] is >= the new x the pair resets to 0 and
// the stamp is restamped with the tick. The real table is signed { -176, -190 }
// (`~/ddw3/asm/dw2003/pro/stplnmet.s` L5717-5718). In every state except 1, 2
// and 3, when +0x58 is set, the tick stamps both elements with the current tick
// and calls the +0x38 advance method.
//
// The setup's F0x8001FFA8 object is the resident context ledger
// UI-TEXTCTX-FFA8-001 (partially_verified) names a text context (slots at
// +0x1C..+0x30, default +0x18 = 0xA800); the native runtime labels those same
// slots `snd+N`. The port calls it through a neutral host boundary.

export const WIZARD_INTRO_HANDLER = 0x80083144;
export const WIZARD_INTRO_SIZE = 0x84;
export const WIZARD_INTRO_EXTRA = 0;
export const WIZARD_INTRO_PACK = 0x02c40000;
export const WIZARD_INTRO_TABLE = 0x800885e4;
export const WIZARD_INTRO_SETUP = 0x80083310;
export const WIZARD_INTRO_LAYER = 0x80083398;
/** 0x08A70000 (LBA 0x8A7): the pack the setup hands to the context's slot. */
export const WIZARD_INTRO_CONTEXT_PACK = 0x08a70000;

/** Family A object fields. */
export const WIZARD_INTRO = {
    state: 0x0c,
    advance: 0x38,
    originX: 0x50,
    originY: 0x54,
    enabled: 0x58,
    layerTarget: 0x5c,
    layerBucket: 0x60,
    stamp0: 0x64,
    stamp1: 0x68,
    elem0X: 0x6c,
    elem0Y: 0x70,
    elem1X: 0x74,
    elem1Y: 0x78,
    setupSlot: 0x7c,
    layerSlot: 0x80,
} as const;

export interface WizardIntroHost extends WizardAnimHost {
    /** Shared resident text-context builder (F0x8001FFA8). */
    installStandardContext(): void;
    /** Invoke the resident text-context slot with its two meaningful args. */
    contextCall(slot: number, a: number, b: number): void;
}

/** F0x800833A4(): build the intro animation object. */
export function wizardIntroCreate(mem: WizardAnimMemory, host: WizardAnimHost): number {
    const obj = host.allocAnim(WIZARD_INTRO_HANDLER, WIZARD_INTRO_SIZE, WIZARD_INTRO_EXTRA) >>> 0;
    mem.write32(obj + WIZARD_INTRO.setupSlot, WIZARD_INTRO_SETUP);
    mem.write32(obj + WIZARD_INTRO.layerSlot, WIZARD_INTRO_LAYER);
    return obj;
}

/**
 * F0x80083310(obj, a1, a2): record the origin and lay out the resident text
 * context. Slot +0x24 is the text cursor setter (a1, a2); slot +0x2C is the
 * RLEN layout pass with the 0x08A70000 pack directory (the original leaves the
 * earlier a2 in that call's second register, which the shared context helper
 * does not model). Reuses the same host boundary as wizard-root.ts.
 */
export function wizardIntroSetup(
    mem: WizardAnimMemory,
    obj: number,
    a1: number,
    a2: number,
    host: WizardIntroHost,
): void {
    mem.write32(obj + WIZARD_INTRO.originX, a1 >>> 0);
    mem.write32(obj + WIZARD_INTRO.originY, a2 >>> 0);
    host.installStandardContext();
    host.contextCall(0x24, a1 >>> 0, a2 >>> 0);
    host.contextCall(0x2c, host.packResolve(WIZARD_INTRO_CONTEXT_PACK) >>> 0, 0);
    mem.write32(obj + WIZARD_INTRO.enabled, 1);
}

/** F0x80083398(obj, a1, a2): store the draw layer target and bucket. */
export function wizardIntroSetLayer(
    mem: WizardAnimMemory,
    obj: number,
    a1: number,
    a2: number,
): void {
    mem.write32(obj + WIZARD_INTRO.layerTarget, a1 >>> 0);
    mem.write32(obj + WIZARD_INTRO.layerBucket, a2 >>> 0);
}

/** F0x80083144(obj): one intro-animation frame. */
export function wizardIntroTick(
    mem: WizardAnimMemory,
    obj: number,
    host: WizardAnimHost,
): void {
    const state = s32(mem.read32(obj + WIZARD_INTRO.state));

    if (state !== 1) {
        if (state !== 2 && state !== 3 && s32(mem.read32(obj + WIZARD_INTRO.enabled)) !== 0) {
            const now = host.frameTick();
            mem.write32(obj + WIZARD_INTRO.stamp1, now >>> 0);
            mem.write32(obj + WIZARD_INTRO.stamp0, now >>> 0);
            host.advance(obj);
        }
        return;
    }

    host.initDrawContext();
    host.setOrigin(
        s32(mem.read32(obj + WIZARD_INTRO.originX)),
        s32(mem.read32(obj + WIZARD_INTRO.originY)),
    );
    host.setLayer(
        s32(mem.read32(obj + WIZARD_INTRO.layerTarget)),
        s32(mem.read32(obj + WIZARD_INTRO.layerBucket)),
    );

    const tick = s32(host.frameTick());
    for (let i = 0; i < 2; i++) {
        const stamp = obj + WIZARD_INTRO.stamp0 + i * 4;
        const xOff = obj + WIZARD_INTRO.elem0X + i * 8;
        const yOff = xOff + 4;
        const delta = s32(tick - s32(mem.read32(stamp)));
        if (i + 1 < delta) {
            let x = s32(mem.read32(xOff)) - 2;
            let y = s32(mem.read32(yOff)) + 1;
            mem.write32(xOff, x >>> 0);
            mem.write32(yOff, y >>> 0);
            if (!(s32(mem.read32(WIZARD_INTRO_TABLE + i * 4)) < x)) {
                x = 0;
                y = 0;
                mem.write32(xOff, 0);
                mem.write32(yOff, 0);
            }
            mem.write32(stamp, tick >>> 0);
        }
        host.drawSprite(
            host.packResolve(WIZARD_INTRO_PACK) >>> 0,
            i,
            mem.read32(xOff) >>> 0,
            mem.read32(yOff) >>> 0,
        );
    }
    host.drawSprite(host.packResolve(WIZARD_INTRO_PACK) >>> 0, 2, 0, 0);
}

// ---------------------------------------------------------------------------
// Wizard portrait draw, translated from pro/stplnmet F0x80088070
// (`_asm/F0x80088070.s`, authority 2; C `F0x80088070.c`, authority 3).
//
// Called from the wizard sequence tick (F0x80087C9C). It resets the draw
// context, sets the origin (0x280,0x100) and the layer from the object's
// +0x50/+0x54, then, only when the portrait scale at +0x64 is nonzero, scales
// and positions the sprite (unless the scale is exactly 0x1000, in which case
// the context's defaults already apply) and draws clip (+0x58 + 0xC) from pack
// 0x028A0000 at (0x18, 0x15).

export const WIZARD_PORTRAIT_PACK = 0x028a0000;
export const WIZARD_PORTRAIT_ORIGIN = { x: 0x280, y: 0x100 } as const;
export const WIZARD_PORTRAIT_CLIP_OFFSET = 0xc;
export const WIZARD_PORTRAIT_SCALE_UNIT = 0x1000;
export const WIZARD_PORTRAIT_POS = { x: 0x18, y: 0x20 } as const;
export const WIZARD_PORTRAIT_DRAW = { x: 0x18, y: 0x15 } as const;

/** Wizard portrait object fields. */
export const WIZARD_PORTRAIT = {
    layerTarget: 0x50,
    layerBucket: 0x54,
    clip: 0x58,
    scale: 0x64,
} as const;

export interface WizardPortraitHost extends WizardAnimHost {
    setScale(sx: number, sy: number, sz: number): void;
    setPos(x: number, y: number): void;
}

/** F0x80088070(obj): draw the wizard portrait when its scale is nonzero. */
export function wizardPortraitDraw(
    mem: WizardAnimMemory,
    obj: number,
    host: WizardPortraitHost,
): void {
    host.initDrawContext();
    host.setOrigin(WIZARD_PORTRAIT_ORIGIN.x, WIZARD_PORTRAIT_ORIGIN.y);
    host.setLayer(
        s32(mem.read32(obj + WIZARD_PORTRAIT.layerTarget)),
        s32(mem.read32(obj + WIZARD_PORTRAIT.layerBucket)),
    );

    const scale = s32(mem.read32(obj + WIZARD_PORTRAIT.scale));
    if (scale === 0) return;
    if (scale !== WIZARD_PORTRAIT_SCALE_UNIT) {
        host.setScale(scale, WIZARD_PORTRAIT_SCALE_UNIT, WIZARD_PORTRAIT_SCALE_UNIT);
        host.setPos(WIZARD_PORTRAIT_POS.x, WIZARD_PORTRAIT_POS.y);
    }
    host.drawSprite(
        host.packResolve(WIZARD_PORTRAIT_PACK) >>> 0,
        (s32(mem.read32(obj + WIZARD_PORTRAIT.clip)) + WIZARD_PORTRAIT_CLIP_OFFSET) >>> 0,
        WIZARD_PORTRAIT_DRAW.x,
        WIZARD_PORTRAIT_DRAW.y,
    );
}

// ---------------------------------------------------------------------------
// Wizard chrome (the animated frame/text furniture), translated from
// pro/stplnmet F0x80083D38 (create) and F0x80083774 (tick); contract from the
// accepted wizard-chrome-family-d answer and verified against
// `_asm/F0x80083d38.s` / `_asm/F0x80083774.s` (authority 2).
//
// The create allocates F0x80014504(handler 0x80083774, size 0x5C, extra 8),
// giving it an 8-byte child block at +0x24 (the two text widgets) and stores the
// wizard screen pointer at +0x50 (never read). The tick builds on the first
// frame: widget A at arg1+0 with +0x160(3), widget B at arg1+4, advance (+0x38),
// substate 1 (+0x2C), then B +0x114(resource line 2), +0x138(1), +0x144(0), A
// +0x150(0x800454C4) and +0x14 = frame tick. Its live branch is a three-way
// substate machine (default/default-2/default-3) that ends with the shared tail:
// setLayer(0x1001,5), setOrigin(0x280,0x100), draw clip 0x38 at (0x4B,0xB8),
// set the CLUT row from +0x54, draw clip 0x0F at (0x38,0x2F). All from pack
// 0x028A0000 and re-fetched per draw.

export interface WizardChromeHost {
    /** F0x80014504(handler, size, extra) -> the new chrome object. */
    allocChrome(handler: number, size: number, extra: number): number;
    /** obj+0x38 (F0x800142AC). */
    advance(obj: number): void;
    /** obj+0x28 (F0x80014274): set state0. */
    setState0(obj: number, state: number): void;
    /** obj+0x2C (F0x80014288): set substate. */
    setSubstate(obj: number, substate: number): void;
    /** [0x80044F4C] = F0x80013E5C: resource id -> base pointer. */
    resourceGetBase(id: number): number;
    /** F0x8001AE38(view, font, x, y) -> text widget. */
    createWidget(view: number, font: number, x: number, y: number): number;
    /** widget+0x160: page line count. */
    widgetSetPageLines(widget: number, lines: number): void;
    /** widget+0x114: line text from a resource base + line. */
    widgetSetResourceLine(widget: number, base: number, line: number): void;
    /** widget+0x138: text colour row. */
    widgetSetColourRow(widget: number, row: number): void;
    /** widget+0x144: typewriter run flag. */
    widgetSetTypewriter(widget: number, run: number): void;
    /** widget+0x150: per-character cue. */
    widgetSetCallback(widget: number, cue: number): void;
    /** widget+0x130: typewriter speed (ticks per glyph). */
    widgetSetTypewriterSpeed(widget: number, speed: number): void;
    /** widget+0x134: widget position. */
    widgetSetPos(widget: number, x: number, y: number): void;
    /** widget+0x168: busy/pause byte. */
    widgetBusy(widget: number): number;
    /** widget+0x170: widget base state. */
    widgetState(widget: number): number;
    /** widget+0x16C: typewriter flag byte. */
    widgetFlag(widget: number): number;
    /** widget+0x128: reveal the rest of the page. */
    widgetReveal(widget: number): void;
    /** [0x8004B7D0+0x3F4](port): pressed-edge word. */
    padPressed(port: number): number;
    /** [0x8004B7D0+0x408](port, logical): shift of a logical button. */
    padShift(port: number, logical: number): number;
    /** [0x8004DF98]: free-running frame tick. */
    frameTick(): number;
    initDrawContext(): void;
    setOrigin(x: number, y: number): void;
    setLayer(target: number, bucket: number): void;
    /** ctx+0x88 (F0x8001ECEC): write the CLUT row offset. */
    setClutRow(row: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    packResolve(handle: number): number;
}

export const WIZARD_CHROME_HANDLER = 0x80083774;
export const WIZARD_CHROME_SIZE = 0x5c;
export const WIZARD_CHROME_EXTRA = 8;
export const WIZARD_CHROME_PACK = 0x028a0000;
export const WIZARD_CHROME_RESOURCE_OFFSET = 0x8d;
export const WIZARD_CHROME_CUE = 0x800454c4;
export const WIZARD_CHROME_PAD_LOGICAL = 0x0d;
export const WIZARD_CHROME_WIDGET = { view: 0x1001, font: 1, x: 0x42, y: 0x3b } as const;
export const WIZARD_CHROME_TAIL = { target: 0x1001, bucket: 5, originX: 0x280, originY: 0x100 } as const;
export const WIZARD_CHROME_DRAWS = [
    { clip: 0x38, x: 0x4b, y: 0xb8 },
    { clip: 0x0f, x: 0x38, y: 0x2f },
] as const;

/** Chrome object fields. */
export const WIZARD_CHROME = {
    state: 0x0c,
    substate: 0x10,
    stamp: 0x14,
    screen: 0x50,
    pose: 0x54,
    widgetA: 0x00,
    widgetB: 0x04,
    penX: 0xb8,
    penY: 0xba,
} as const;

const s16 = (v: number): number => (v << 16) >> 16;

/** F0x80083D38(screen): build the chrome object. */
export function wizardChromeCreate(mem: WizardAnimMemory, screen: number, host: WizardChromeHost): number {
    const obj = host.allocChrome(WIZARD_CHROME_HANDLER, WIZARD_CHROME_SIZE, WIZARD_CHROME_EXTRA) >>> 0;
    mem.write32(obj + WIZARD_CHROME.screen, screen >>> 0);
    return obj;
}

/** F0x80083774(obj, arg1): one chrome frame. */
export function wizardChromeTick(
    mem: WizardAnimMemory,
    obj: number,
    arg1: number,
    host: WizardChromeHost,
): void {
    const state = s32(mem.read32(obj + WIZARD_CHROME.state));

    if (state === 1) {
        const widgetA = mem.read32(arg1 + WIZARD_CHROME.widgetA) >>> 0;
        const widgetB = mem.read32(arg1 + WIZARD_CHROME.widgetB) >>> 0;
        const sub = s32(mem.read32(obj + WIZARD_CHROME.substate));
        if (sub === 2) {
            if (s32(host.widgetBusy(widgetA)) !== 0) {
                host.setSubstate(obj, 3);
                mem.write32(obj + WIZARD_CHROME.stamp, host.frameTick() >>> 0);
                mem.write32(obj + WIZARD_CHROME.pose, 4);
                host.widgetSetTypewriter(widgetB, 0);
                host.widgetSetTypewriter(widgetA, 0);
            } else {
                host.widgetSetPos(
                    widgetB,
                    s16((mem.read32(widgetA + WIZARD_CHROME.penX) & 0xffff) + 0x42),
                    s16((mem.read32(widgetA + WIZARD_CHROME.penY) & 0xffff) + 0x3b),
                );
                if (s32(host.widgetState(widgetA)) !== 0) {
                    if (s32(host.widgetFlag(widgetB)) !== 0) {
                        if (s32(host.frameTick()) - s32(mem.read32(obj + WIZARD_CHROME.stamp)) >= 0x11) {
                            mem.write32(obj + WIZARD_CHROME.stamp, host.frameTick() >>> 0);
                            host.widgetSetTypewriter(widgetB, 0);
                        }
                    } else if (s32(host.frameTick()) - s32(mem.read32(obj + WIZARD_CHROME.stamp)) >= 9) {
                        mem.write32(obj + WIZARD_CHROME.stamp, host.frameTick() >>> 0);
                        host.widgetSetTypewriter(widgetB, 1);
                    }
                } else {
                    host.widgetSetTypewriter(widgetB, 1);
                    mem.write32(obj + WIZARD_CHROME.stamp, host.frameTick() >>> 0);
                }
                const word = host.padPressed(0);
                const bit = host.padShift(0, WIZARD_CHROME_PAD_LOGICAL) & 31;
                if (((word >> bit) & 1) !== 0) host.widgetReveal(widgetA);
            }
        } else if (sub === 3) {
            if (s32(host.frameTick()) - s32(mem.read32(obj + WIZARD_CHROME.stamp)) >= 6) {
                let pose = s32(mem.read32(obj + WIZARD_CHROME.pose)) + 1;
                mem.write32(obj + WIZARD_CHROME.pose, pose >>> 0);
                if (pose >= 8) {
                    host.setState0(obj, 3);
                    mem.write32(obj + WIZARD_CHROME.pose, 7);
                }
            }
        } else if (s32(host.frameTick()) - s32(mem.read32(obj + WIZARD_CHROME.stamp)) >= 6) {
            mem.write32(obj + WIZARD_CHROME.stamp, host.frameTick() >>> 0);
            let pose = s32(mem.read32(obj + WIZARD_CHROME.pose)) + 1;
            mem.write32(obj + WIZARD_CHROME.pose, pose >>> 0);
            if (pose >= 4) {
                mem.write32(obj + WIZARD_CHROME.pose, 3);
                host.setSubstate(obj, 2);
                mem.write32(obj + WIZARD_CHROME.stamp, host.frameTick() >>> 0);
                const base = host.resourceGetBase((mem.read32(0x8005cca8) + WIZARD_CHROME_RESOURCE_OFFSET) >>> 0) >>> 0;
                host.widgetSetResourceLine(widgetA, base, 1);
                host.widgetSetColourRow(widgetA, 1);
                host.widgetSetTypewriterSpeed(widgetA, 6);
                host.widgetSetTypewriter(widgetB, 1);
            }
        }

        // Shared tail, drawn on every live frame.
        host.initDrawContext();
        host.setLayer(WIZARD_CHROME_TAIL.target, WIZARD_CHROME_TAIL.bucket);
        host.setOrigin(WIZARD_CHROME_TAIL.originX, WIZARD_CHROME_TAIL.originY);
        const first = WIZARD_CHROME_DRAWS[0];
        const second = WIZARD_CHROME_DRAWS[1];
        host.drawSprite(host.packResolve(WIZARD_CHROME_PACK) >>> 0, first.clip, first.x, first.y);
        host.setClutRow(mem.read32(obj + WIZARD_CHROME.pose) >>> 0);
        host.drawSprite(host.packResolve(WIZARD_CHROME_PACK) >>> 0, second.clip, second.x, second.y);
        return;
    }

    if (state === 2 || state === 3) return;

    // Build branch.
    const widgetA = host.createWidget(
        WIZARD_CHROME_WIDGET.view, WIZARD_CHROME_WIDGET.font, WIZARD_CHROME_WIDGET.x, WIZARD_CHROME_WIDGET.y,
    ) >>> 0;
    mem.write32(arg1 + WIZARD_CHROME.widgetA, widgetA);
    host.widgetSetPageLines(widgetA, 3);
    const widgetB = host.createWidget(
        WIZARD_CHROME_WIDGET.view, WIZARD_CHROME_WIDGET.font, WIZARD_CHROME_WIDGET.x, WIZARD_CHROME_WIDGET.y,
    ) >>> 0;
    mem.write32(arg1 + WIZARD_CHROME.widgetB, widgetB);
    host.advance(obj);
    host.setSubstate(obj, 1);
    const base = host.resourceGetBase((mem.read32(0x8005cca8) + WIZARD_CHROME_RESOURCE_OFFSET) >>> 0) >>> 0;
    host.widgetSetResourceLine(widgetB, base, 2);
    host.widgetSetColourRow(widgetB, 1);
    host.widgetSetTypewriter(widgetB, 0);
    host.widgetSetCallback(widgetA, WIZARD_CHROME_CUE);
    mem.write32(obj + WIZARD_CHROME.stamp, host.frameTick() >>> 0);
}
