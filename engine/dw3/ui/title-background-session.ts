// Production adapter for the translated title board and its eight twinkles.
// The scripts are generated from the shipped title overlay as data.
import {
    titleBackgroundTick, TITLE_BG_RANDOM_POS_7, TITLE_BG_RANDOM_POS_8,
} from "./title-background-tick.ts";
import { TITLE_TWINKLE_PACK_A, TITLE_TWINKLE_PACK_B, TITLE_TWINKLE_TABLES } from "./title-draw.ts";
import { TitleMemory } from "./title-menu-session.ts";
import { titleBackgroundCreate, titleBackgroundInit } from "./title-tasks.ts";

const OBJ = 0x80182400;

export interface TitleTwinkleData {
    scripts: number[][][];
    positions: number[][][];
}

export interface TitleTwinkle {
    pack: number;
    clip: number;
    x: number;
    y: number;
}

export class TitleBackgroundSession {
    private readonly mem = new TitleMemory();
    private readonly random: () => number;
    private drawn: TitleTwinkle[] = [];
    private readonly host = {
        advance0: (obj: number) => {
            this.mem.write32(obj + 0x0c, this.mem.read32(obj + 0x0c) + 1);
            this.mem.write32(obj + 0x10, 0);
            this.mem.write32(obj + 0x14, 0);
            this.mem.write32(obj + 0x18, 0);
        },
        setState0: (obj: number, state: number) => {
            this.mem.write32(obj + 0x0c, state);
            this.mem.write32(obj + 0x10, 0);
            this.mem.write32(obj + 0x14, 0);
            this.mem.write32(obj + 0x18, 0);
        },
        setState1: (obj: number, state: number) => {
            this.mem.write32(obj + 0x10, state);
            this.mem.write32(obj + 0x14, 0);
            this.mem.write32(obj + 0x18, 0);
        },
        randU16: () => this.random() & 0xffff,
        initDrawContext() {}, setOrigin(_x: number, _y: number) {},
        setLayer(_target: number, _bucket: number) {},
        setDepth(_x: number, _y: number) {}, setFrame(_frame: number) {},
        packResolve: (handle: number) => handle,
        drawSprite: (pack: number, clip: number, x: number, y: number) => {
            if (pack === TITLE_TWINKLE_PACK_A || pack === TITLE_TWINKLE_PACK_B)
                this.drawn.push({ pack, clip, x, y });
        },
    };

    constructor(data: TitleTwinkleData, random = () => (Math.random() * 0x1000) | 0) {
        if (data.scripts.length !== TITLE_TWINKLE_TABLES.length ||
            data.positions[0]?.length !== 3 || data.positions[1]?.length !== 5)
            throw new Error("incomplete decoded title twinkle data");
        this.random = random;
        for (let script = 0; script < TITLE_TWINKLE_TABLES.length; script++) {
            const base = TITLE_TWINKLE_TABLES[script]!;
            for (let i = 0; i < data.scripts[script]!.length; i++) {
                const pair = data.scripts[script]![i]!;
                this.mem.write16(base + i * 4, pair[0]!);
                this.mem.write16(base + i * 4 + 2, pair[1]!);
            }
        }
        for (const [group, base] of [TITLE_BG_RANDOM_POS_7, TITLE_BG_RANDOM_POS_8].entries()) {
            for (let i = 0; i < data.positions[group]!.length; i++) {
                const pair = data.positions[group]![i]!;
                this.mem.write16(base + i * 4, pair[0]!);
                this.mem.write16(base + i * 4 + 2, pair[1]!);
            }
        }
        titleBackgroundCreate(this.mem, 0, { allocTitleTask: () => OBJ });
        titleBackgroundTick(this.mem, OBJ, this.host); // creator's first state step
    }

    startTwinkles(): void { titleBackgroundInit(this.mem, OBJ, this.host); }
    tick(): void {
        this.drawn = [];
        titleBackgroundTick(this.mem, OBJ, this.host);
    }
    twinkles(): TitleTwinkle[] { return this.drawn; }
}
