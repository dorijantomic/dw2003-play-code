// Production state and service adapter for the translated title menu tick.
// The only seeded table values come from stdwtitl_ui.json's decoded layout.
import { titleMenuTick, TITLE_MENU } from "./title-menu.ts";
import { PackedSoundCursor } from "../../systems/packed-sound.ts";
import { TITLE_LANGUAGE_CLIP_TABLE, TITLE_LANGUAGE_PTR, TITLE_MENU_OPTION_TABLE } from "./title-draw.ts";

export interface TitleMenuLayout {
    promptAt: number[];
    optionAt: number[][];
    clipByLanguage: Record<string, number[]>;
}

export class TitleMemory {
    private readonly bytes = new Map<number, number>();
    read8(addr: number): number { return this.bytes.get(addr >>> 0) ?? 0; }
    read16(addr: number): number { return this.read8(addr) | (this.read8(addr + 1) << 8); }
    read16s(addr: number): number { return (this.read16(addr) << 16) >> 16; }
    read32(addr: number): number {
        return (this.read8(addr) | (this.read8(addr + 1) << 8)
            | (this.read8(addr + 2) << 16) | (this.read8(addr + 3) << 24)) >>> 0;
    }
    write8(addr: number, value: number): void { this.bytes.set(addr >>> 0, value & 0xff); }
    write16(addr: number, value: number): void {
        this.write8(addr, value); this.write8(addr + 1, value >>> 8);
    }
    write32(addr: number, value: number): void {
        this.write16(addr, value); this.write16(addr + 2, value >>> 16);
    }
}

const OBJ = 0x80180000;
const START = 1 << 3;
const UP = 1 << 4;
const DOWN = 1 << 6;
const CONFIRM = 1 << 13;

export class TitleMenuSession {
    private readonly mem = new TitleMemory();
    private readonly pending: number[] = [];
    /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
    private readonly audio = new PackedSoundCursor();

    constructor(layout: TitleMenuLayout, language: number) {
        const m = this.mem;
        m.write32(TITLE_LANGUAGE_PTR, language);
        for (let i = 0; i < 3; i++) {
            const point = i === 2 ? layout.promptAt : layout.optionAt[i]!;
            m.write32(TITLE_MENU_OPTION_TABLE + i * 8, point[0]!);
            m.write32(TITLE_MENU_OPTION_TABLE + i * 8 + 4, point[1]!);
        }
        for (const [key, clips] of Object.entries(layout.clipByLanguage)) {
            const base = TITLE_LANGUAGE_CLIP_TABLE + Number(key) * 4;
            for (let i = 0; i < 3; i++) m.write8(base + i, clips[i] ?? 0);
        }
        m.write32(OBJ + TITLE_MENU.state0, 1);
        m.write32(OBJ + TITLE_MENU.state1, 0);
        m.write32(OBJ + 0x8c, 0x1000);
    }

    startPrompt(): void { this.mem.write32(OBJ + TITLE_MENU.state1, 1); }

    state0(): number { return this.mem.read32(OBJ + TITLE_MENU.state0) | 0; }
    state1(): number { return this.mem.read32(OBJ + TITLE_MENU.state1) | 0; }
    highlight(): number { return this.mem.read16s(OBJ + TITLE_MENU.select); }
    blink(): number { return this.mem.read8(OBJ + TITLE_MENU.counter); }
    optionsShown(): boolean { return this.mem.read16s(OBJ + TITLE_MENU.marker) !== 0; }
    showBox(): boolean { return this.mem.read8(OBJ + TITLE_MENU.flag) !== 0; }
    result(): number { return this.mem.read16s(OBJ + TITLE_MENU.result); }
    optionY(): number[] { return [this.mem.read32(OBJ + TITLE_MENU.y0) | 0, this.mem.read32(OBJ + TITLE_MENU.y1) | 0]; }
    optionX(): number[] { return [this.mem.read32(OBJ + TITLE_MENU.x0) | 0, this.mem.read32(OBJ + TITLE_MENU.x1) | 0]; }
    takeSounds(): number[] { return this.audio.take(); }

    queueStart(): void { this.pending.push(START); }
    queueUp(): void { this.pending.push(UP); }
    queueDown(): void { this.pending.push(DOWN); }
    queueConfirm(): void { this.pending.push(CONFIRM); }
    selectPointer(index: number): void { this.mem.write16(OBJ + TITLE_MENU.select, index === 0 ? 0 : 1); }

    tick(): void {
        const m = this.mem;
        const word = this.pending.shift() ?? 0;
        titleMenuTick(m, OBJ, {
            initDrawContext() {}, setOrigin() {}, setLayer() {}, setDepth() {}, setFrame() {},
            drawSprite() {}, packResolve: () => 0,
            playSound: (id) => { this.audio.play(id); },
            padCall: (slot, arg) => slot === 0x408 ? arg : slot === 0x3f4 ? word : 0,
            setState0: (obj, state) => {
                m.write32(obj + 0x0c, state); m.write32(obj + 0x10, 0);
                m.write32(obj + 0x14, 0); m.write32(obj + 0x18, 0);
            },
            advance0: (obj) => {
                m.write32(obj + 0x0c, m.read32(obj + 0x0c) + 1);
                m.write32(obj + 0x10, 0); m.write32(obj + 0x14, 0); m.write32(obj + 0x18, 0);
            },
            advance1: (obj) => {
                m.write32(obj + 0x10, m.read32(obj + 0x10) + 1);
                m.write32(obj + 0x14, 0); m.write32(obj + 0x18, 0);
            },
        });
    }
}
