// Production adapter for the translated international title logo and glow.
// Pixel placement and the glow script come from the decoded title layout.
import { TITLE_GLOW_SCRIPT_TABLE, TITLE_DECO, titleDecoLayerTick,
    titleGlowTick, titleLogoTick, titleWordmarkTick } from "./title-ticks.ts";
import { TitleMemory } from "./title-menu-session.ts";
import { titleDecoLayerCreate, titleGlowCreate, titleLogoCreate, titleWordmarkCreate } from "./title-tasks.ts";
import {
    TITLE_JP_GLOW_TABLE, titleJpGlowCreate, titleJpLogoCreate, titleJpWordmarkCreate,
    titleJpGlowTick, titleJpLogoTick, titleJpWordmarkTick,
} from "./title-japanese.ts";

const LOGO = 0x80182000;
const WORDMARK = 0x80182100;
const GLOW = 0x80182200;
const DECO = 0x80182300;
const DECO_SCRIPT = 0x80087c54;

export class TitleVisualSession {
    private readonly mem = new TitleMemory();
    private readonly japanese: boolean;
    private readonly taskHost = {
        setState0: (obj: number, state: number) => {
            const m = this.mem;
            m.write32(obj + 0x0c, state); m.write32(obj + 0x10, 0);
            m.write32(obj + 0x14, 0); m.write32(obj + 0x18, 0);
        },
        setState1: (obj: number, state: number) => {
            const m = this.mem;
            m.write32(obj + 0x10, state); m.write32(obj + 0x14, 0); m.write32(obj + 0x18, 0);
        },
        advance0: (obj: number) => {
            const m = this.mem;
            m.write32(obj + 0x0c, m.read32(obj + 0x0c) + 1);
            m.write32(obj + 0x10, 0); m.write32(obj + 0x14, 0); m.write32(obj + 0x18, 0);
        },
        advance1: (obj: number) => {
            const m = this.mem;
            m.write32(obj + 0x10, m.read32(obj + 0x10) + 1);
            m.write32(obj + 0x14, 0); m.write32(obj + 0x18, 0);
        },
    };
    private readonly drawHost = {
        initDrawContext() {}, setOrigin() {}, setLayer() {}, setDepth() {}, setFrame() {},
        drawSprite() {}, packResolve: () => 0,
    };

    constructor(script: number[], japanese = false,
        legalScripts: number[][] = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 1, 2, 3, 4, 5, 6, 7]]) {
        this.japanese = japanese;
        (japanese ? titleJpLogoCreate : titleLogoCreate)(this.mem, 0, { allocTitleTask: () => LOGO });
        (japanese ? titleJpWordmarkCreate : titleWordmarkCreate)(this.mem, 0, { allocTitleTask: () => WORDMARK });
        (japanese ? titleJpGlowCreate : titleGlowCreate)(this.mem, 0, { allocTitleTask: () => GLOW });
        titleDecoLayerCreate(this.mem, 0, { allocTitleTask: () => DECO });
        for (let block = 0; block < 2; block++) {
            const base = DECO_SCRIPT + block * 0x1a;
            for (let i = 0; i < legalScripts[block]!.length; i++)
                this.mem.write16(base + i * 2, legalScripts[block]![i]!);
            this.mem.write16(base + legalScripts[block]!.length * 2, 0xffff);
        }
        const table = japanese ? TITLE_JP_GLOW_TABLE : TITLE_GLOW_SCRIPT_TABLE;
        for (let i = 0; i < script.length; i++) {
            this.mem.write16(table + i * 2, script[i]!);
        }
        if (!japanese) this.mem.write16(table + script.length * 2, 0xffff);
        // The first update initializes positions before the owner starts the slide.
        this.tick();
    }

    startLogoSlide(): void { this.taskHost.setState1(LOGO, 1); }
    startWordmarkSlide(): void { this.taskHost.setState1(WORDMARK, 1); }
    startGlow(): void { this.taskHost.setState1(GLOW, 1); }
    startDeco(): void { this.taskHost.setState1(DECO, 1); }
    tick(): void {
        (this.japanese ? titleJpLogoTick : titleLogoTick)(this.mem, LOGO, this.taskHost, this.drawHost);
        (this.japanese ? titleJpWordmarkTick : titleWordmarkTick)(this.mem, WORDMARK, this.taskHost, this.drawHost);
        (this.japanese ? titleJpGlowTick : titleGlowTick)(this.mem, GLOW, this.taskHost, this.drawHost);
        titleDecoLayerTick(this.mem, DECO, this.taskHost, this.drawHost);
    }
    logoX(): number { return this.mem.read32(LOGO + 0x58) | 0; }
    wordmarkX(): number { return this.mem.read32(WORDMARK + 0x58) | 0; }
    glowLevel(): number { return this.mem.read32(GLOW + 0x58) | 0; }
    numeralVisible(): boolean { return this.mem.read32(GLOW + 0x5c) !== 0; }
    legalVisible(): boolean { return this.mem.read32(DECO + TITLE_DECO.drawEnable) !== 0; }
    legalRows(): number[] {
        return [this.mem.read16s(DECO + TITLE_DECO.shiftA), this.mem.read16s(DECO + TITLE_DECO.shiftB)];
    }
}
