// Production composition for the translated title owner, sequence and choice
// dispatcher. The child objects are our menu, logo, glow and fade sessions.
import { titleChoiceDispatch, TITLE_FADE } from "./title-fade.ts";
import { TitleFadeSession } from "./title-fade-session.ts";
import { TitleMemory, TitleMenuSession } from "./title-menu-session.ts";
import {
    titleSequenceOwnerTick, titleSequenceTick, TITLE_SEQUENCE,
    TITLE_SEQUENCE_CHILD, TITLE_SEQUENCE_SLOT,
} from "./title-sequence-tick.ts";
import { TITLE_LANGUAGE_PTR } from "./title-draw.ts";
import { titleBootCreate, titleBootTick, TITLE_LOGO_CELL, TITLE_PACK_TABLE } from "./title-boot.ts";
import { TitleVisualSession } from "./title-visual-session.ts";
import { TitleBackgroundSession } from "./title-background-session.ts";
import { frameDelta } from "../../systems/frame-clock.ts";
import { PackedSoundCursor } from "../../systems/packed-sound.ts";
import type { TitleTwinkle, TitleTwinkleData } from "./title-background-session.ts";

const SELF = 0x80183000;
const CHILD = 0x80183100;
const FADE = 0x80183200;
const GLOW = 0x80183300;
const WORDMARK = 0x80183400;
const LOGO = 0x80183500;
const DECO = 0x80183600;
const MENU = 0x80183700;
const BACKGROUND = 0x80183800;
const BOOT = 0x80183900;
const BOOT_CHILD = 0x80183980;

// Seven {upload page, sprite handle} records from the title pack table;
// tools/extract_stdwtitl_ui.py documents the five repeated PAL entries.
const LOGO_PACKS = [
    [0x08860001, 0x08860000], [0x08a40001, 0x08a40000],
    ...Array.from({ length: 5 }, () => [0x094d0001, 0x094d0000]),
];

export class TitleSequenceSession {
    private readonly mem = new TitleMemory();
    private readonly menu: TitleMenuSession;
    private readonly visual: TitleVisualSession;
    private readonly background: TitleBackgroundSession;
    private fade: TitleFadeSession | null = null;
    /**
     * The title's own cue log. The disc plays one packed word per `startTitle`
     * entry — `TITLEBGM` 0x611C0000, `[0x80055C48](0x611C0000)` in the sequence
     * tick's glow case (stdwtitl `F0x800869D0` case 2). This is the same
     * per-screen cursor `TitleMenuSession` publishes its menu cues through.
     */
    private readonly audio = new PackedSoundCursor();
    private promptStartedValue = false;
    private resultValue = 0;
    private selectorValue = 0;
    private readonly previousCode: number;

    constructor(language: number, menu: TitleMenuSession, visual: TitleVisualSession,
        twinkleData: TitleTwinkleData, previousScreenCode = 0) {
        this.menu = menu;
        this.visual = visual;
        this.previousCode = previousScreenCode | 0;
        this.background = new TitleBackgroundSession(twinkleData);
        this.mem.write32(TITLE_LANGUAGE_PTR, language);
        for (let i = 0; i < LOGO_PACKS.length; i++) {
            this.mem.write32(TITLE_PACK_TABLE + i * 8, LOGO_PACKS[i]![0]!);
            this.mem.write32(TITLE_PACK_TABLE + i * 8 + 4, LOGO_PACKS[i]![1]!);
        }
        titleBootCreate(this.mem, this.bootHost);
    }

    promptStarted(): boolean { return this.promptStartedValue; }
    result(): number { return this.resultValue; }
    fading(): boolean { return this.fade !== null; }
    fadeLevel(): number { return this.fade?.level() ?? 0; }
    sequenceState(): number { return this.mem.read32(SELF + TITLE_SEQUENCE.state1) | 0; }
    /** The sequence's +0x54 beat counter, in sixtieths of a second: the units
     *  `stdwtitl.s:1756-1759` adds through [0x8004DF9C] every field. */
    beatCounter(): number {
        return this.mem.read32(SELF + TITLE_SEQUENCE.accumulator) | 0;
    }
    selector(): number { return this.selectorValue; }
    logoHandle(): number { return this.mem.read32(TITLE_LOGO_CELL); }
    twinkles(): TitleTwinkle[] { return this.background.twinkles(); }
    /** The packed cues the sequence has rung since the last drain: the disc's
     *  TITLEBGM at the reveal glow, oldest first. */
    takeSounds(): number[] { return this.audio.take(); }

    private readonly bootHost = {
        allocTitleBoot: (_handler: number, _size: number, _extra: number) => BOOT,
        requestSoundArchive: (_id: number) => {},
        audioPending: () => 0,
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
        createTitleSequence: (_obj: number) => SELF,
        installStandardContext: () => {},
        contextSlot: (slot: number) => slot,
        contextCall: (_slot: number, _a: number, _b: number, _c?: number) => {},
        packResolve: (handle: number) => handle,
    };

    private readonly sequenceHost = {
        // [0x8004DF9C]() = F0x8001D704 = [0x8004DE28], the shared clock: the
        // sequence's +0x54 accumulator counts sixtieths of a second, so it takes
        // 10 units to open the glow and 12 to stage the next beat, not 10 and 12
        // displayed frames.
        frameDelta,
        setState1: (obj: number, state: number) => {
            this.mem.write32(obj + 0x10, state);
            this.mem.write32(obj + 0x14, 0);
            this.mem.write32(obj + 0x18, 0);
        },
        advance1: (obj: number) => {
            this.mem.write32(obj + 0x10, this.mem.read32(obj + 0x10) + 1);
            this.mem.write32(obj + 0x14, 0);
            this.mem.write32(obj + 0x18, 0);
        },
        callSlot: (obj: number, slot: number): number => {
            if (obj === LOGO && slot === TITLE_SEQUENCE_SLOT.startSlide) this.visual.startLogoSlide();
            else if (obj === WORDMARK && slot === TITLE_SEQUENCE_SLOT.startSlide) this.visual.startWordmarkSlide();
            else if (obj === GLOW && slot === TITLE_SEQUENCE_SLOT.startSlide) this.visual.startGlow();
            else if (obj === DECO && slot === TITLE_SEQUENCE_SLOT.startDeco) this.visual.startDeco();
            else if (obj === BACKGROUND && slot === TITLE_SEQUENCE_SLOT.startBackground)
                this.background.startTwinkles();
            else if (obj === MENU && slot === TITLE_SEQUENCE_SLOT.startPrompt) {
                this.menu.startPrompt();
                this.promptStartedValue = true;
            } else if (obj === MENU && slot === TITLE_SEQUENCE_SLOT.menuChoice) return this.menu.result();
            else if (obj === FADE && slot === TITLE_SEQUENCE_SLOT.startFade) this.fade?.start();
            return 0;
        },
        // `[0x80055C48](id)` — the resident packed-sound entry (F0x8002006C). The
        // sequence tick calls it once, in case 2, with the disc's own TITLEBGM
        // word 0x611C0000 (stdwtitl `F0x800869D0`; the rig captured
        // `a0=0x611c0000 ra=0x80086ac8`, docs/research/audio/captures/
        // title-and-gym-sound-rig-2026-10-03.md §1). Routing it through the
        // shared cursor is what lets `takeSounds` hand it to the browser's
        // packed-sound player, the bus `TitleMenuSession` already publishes on.
        playSound: (id: number) => { this.audio.play(id); },
        requestScreen: (_id: number) => {},
        createScreenFade: (): number => {
            this.fade = new TitleFadeSession(false);
            return FADE;
        },
        titleChoiceDispatch: (self: number, child: number): number => {
            this.mem.write32(FADE + TITLE_FADE.result, this.fade?.isDone() ? 1 : 0);
            return titleChoiceDispatch(this.mem, self, child, {
                resetSaveContext() {}, clearContextFields() {}, clearRegion() {}, applyLanguage() {},
                setSelector: (code: number) => { this.selectorValue = code; },
                previousScreenCode: () => this.previousCode,
            });
        },
    };

    private readonly ownerHost = {
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
        createBackground: () => BACKGROUND,
        createJpLogo: () => LOGO,
        createJpWordmark: () => WORDMARK,
        createJpGlow: () => GLOW,
        createEnLogo: () => LOGO,
        createEnWordmark: () => WORDMARK,
        createEnGlow: () => GLOW,
        createDeco: () => DECO,
        createMenu: () => MENU,
        sequenceTick: (self: number, child: number) => {
            const returned = titleSequenceTick(this.mem, self, child, this.sequenceHost);
            if (returned !== 0) this.resultValue = this.mem.read32(SELF + TITLE_SEQUENCE.outcome) | 0;
            return returned;
        },
        // Owner state 3 calls `[0x80055C68](0x611C0000)` — a DIFFERENT resident
        // cell (0x80055C68 = F0x800202D4, the stop-by-id entry), not the play
        // cell the sequence tick uses. On the disc it stops the title track when
        // the owner reaches state 3 (after the menu outcome has requested the
        // field), and the owner does not advance out of state 3, so a faithful
        // forward here would re-ask every field rather than once. It is left a
        // no-op deliberately: this is not the reveal cue, and the field track's
        // own start already stops TITLEBGM through the one exclusive register.
        playSound: (_id: number) => {},
    };

    /**
     * One displayed field of the title: the boot child, the sequence owner and
     * every child that is running. The screen reads the shared clock for its
     * beat counter but does not advance it — no screen increments either word
     * on the disc either; the display service does, once per field, and here
     * that is `MenuDisplayClock.advance` in the screen's host
     * (engine/dw3/ui/title-session.ts:tick). The extra step a button press runs
     * inside the field it was read on calls this too, which is why the counter
     * must not be spent twice for it.
     */
    tick(): void {
        const active = this.mem.read32(BOOT_CHILD) !== 0;
        titleBootTick(this.mem, BOOT, BOOT_CHILD, this.bootHost);
        if (active) titleSequenceOwnerTick(this.mem, SELF, CHILD, this.ownerHost);
        this.visual.tick();
        this.background.tick();
        if (this.promptStartedValue) this.menu.tick();
        this.fade?.tick();
    }
}
