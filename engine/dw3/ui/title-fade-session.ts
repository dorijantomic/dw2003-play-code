// The live title's vignette, driven by its translated fade object.
import { createScreenFade, screenFadeTick, startTitleFade, TITLE_FADE } from "./title-fade.ts";
import { TitleMemory } from "./title-menu-session.ts";

const OBJ = 0x80181000;

export class TitleFadeSession {
    private readonly mem = new TitleMemory();
    private readonly host = {
        allocate: () => OBJ,
        advance0: (obj: number) => {
            const m = this.mem;
            m.write32(obj + 0x0c, m.read32(obj + 0x0c) + 1);
            m.write32(obj + 0x10, 0); m.write32(obj + 0x14, 0); m.write32(obj + 0x18, 0);
        },
        setState1: (obj: number, state: number) => {
            const m = this.mem;
            m.write32(obj + 0x10, state);
            m.write32(obj + 0x14, 0); m.write32(obj + 0x18, 0);
        },
        buildVignetteQuad: (_level: number) => {},
    };

    constructor(startImmediately = true) {
        // The new object first takes the port's reset arm, then the sequence
        // starts it through the installed method before the visible ramp.
        createScreenFade(this.mem, this.host);
        screenFadeTick(this.mem, OBJ, this.host);
        if (startImmediately) this.start();
    }

    start(): void { startTitleFade(this.mem, OBJ, this.host); }
    tick(): void { screenFadeTick(this.mem, OBJ, this.host); }
    level(): number { return this.mem.read16(OBJ + TITLE_FADE.level); }
    isDone(): boolean { return this.mem.read32(OBJ + TITLE_FADE.result) !== 0; }
}
