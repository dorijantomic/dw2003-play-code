// Browser task composition for the decoded title sequence. The layout and
// pictures are extracted data; this controller owns the frame and pad decisions.
import { TitleMenuSession } from "./title-menu-session.ts";
import { TitleFadeSession } from "./title-fade-session.ts";
import { TitleVisualSession } from "./title-visual-session.ts";
import { TitleSequenceSession } from "./title-sequence-session.ts";
import { MenuDisplayClock } from "./pad-words.ts";
import type { TitleTwinkle, TitleTwinkleData } from "./title-background-session.ts";

export const TITLE_RESULT_START = 1;
export const TITLE_RESULT_CONTINUE = 2;
export const TITLE_RESULT_IDLE = 3;

export interface TitleSessionLayout {
    promptAt: number[];
    optionAt: number[][];
    clipByLanguage: Record<string, number[]>;
    logo: { at: number[]; start: number[] }[];
    numeral: { at: number[] };
    glow: { at: number[]; script: number[] };
    legalScripts?: number[][];
    twinkles: TitleTwinkleData;
    jpn: {
        logo: { at: number[]; start: number[] };
        wordmark: { at: number[]; start: number[] };
        numeral: { at: number[] };
        glow: { at: number[]; script: number[]; stay: number };
    };
}

export type TitlePhase = "slide" | "glow" | "intro" | "prompt" | "flashIn" |
    "split" | "settle" | "menu" | "flashOut" | "fade" | "done";

export class TitleSession {
    private readonly layout: TitleSessionLayout;
    private phaseValue: TitlePhase;
    private timer = 0;
    /**
     * The title's display service: the same `MenuDisplayClock` every other
     * translated screen's host is given, so a title field and a shop field are
     * the same 50Hz PAL field, and it is that one object which advances the
     * shared frame clock (engine/dw3/ui/pad-words.ts:29-42).
     */
    private readonly display = new MenuDisplayClock();
    private readonly menu: TitleMenuSession;
    private readonly visual: TitleVisualSession | null;
    private readonly sequence: TitleSequenceSession | null;
    private fade: TitleFadeSession | null = null;
    private resultValue = 0;
    private slideCount = 10;
    private glowIdx = 0;
    private glowValue: number;
    private numeralVisible: boolean;
    private logoX: number;
    private wordX: number;
    private readonly logoSettle: number[];
    private readonly logoStart: number[];
    private readonly wordSettle: number[];
    private readonly wordStart: number[];
    private readonly numeralPoint: number[];
    private readonly glowPoint: number[];
    private readonly glowScript: number[];
    private readonly glowStay: number;
    private readonly clipIds: number[];
    private readonly japanese: boolean;
    private readonly language: number;

    constructor(layout: TitleSessionLayout, language = 2, skipReveal = false,
        previousScreenCode = 0) {
        this.layout = layout;
        this.language = language;
        this.japanese = language === 0;
        const j = layout.jpn;
        this.logoSettle = this.japanese ? j.logo.at : layout.logo[0]!.at;
        this.logoStart = this.japanese ? j.logo.start : layout.logo[0]!.start;
        this.wordSettle = this.japanese ? j.wordmark.at : layout.logo[1]!.at;
        this.wordStart = this.japanese ? j.wordmark.start : layout.logo[1]!.start;
        this.numeralPoint = this.japanese ? j.numeral.at : layout.numeral.at;
        this.glowPoint = this.japanese ? j.glow.at : layout.glow.at;
        this.glowScript = this.japanese ? j.glow.script : layout.glow.script;
        this.glowStay = this.japanese ? j.glow.stay : -1;
        this.visual = skipReveal ? null : new TitleVisualSession(
            this.glowScript, this.japanese, layout.legalScripts,
        );
        this.clipIds = layout.clipByLanguage[String(language)] ?? [8, 9, 10];
        this.menu = new TitleMenuSession(layout, language);
        this.sequence = this.visual ? new TitleSequenceSession(
            language, this.menu, this.visual, layout.twinkles, previousScreenCode,
        ) : null;
        if (skipReveal) this.menu.startPrompt();
        this.phaseValue = skipReveal ? "intro" : "slide";
        this.glowValue = skipReveal ? this.glowStay : -1;
        this.numeralVisible = skipReveal;
        this.logoX = skipReveal ? this.logoSettle[0]! : this.logoStart[0]!;
        this.wordX = skipReveal ? this.wordSettle[0]! : this.wordStart[0]!;
    }

    phase(): TitlePhase { return this.phaseValue; }
    highlight(): number { return this.menu.highlight(); }
    result(): number { return this.resultValue; }
    launchCode(): number { return this.sequence?.selector() ?? 0; }
    isDone(): boolean { return this.resultValue !== 0 && this.phaseValue === "done"; }
    optionsShown(): boolean { return this.menu.optionsShown(); }
    showBox(): boolean { return this.menu.showBox(); }
    blink(): number { return this.menu.blink(); }
    /** Everything the title asked the packed-sound service for since the last
     *  drain: the sequence's own cue (the disc's TITLEBGM at the reveal glow)
     *  first, then the menu's — the order the disc rings them. */
    takeSounds(): number[] {
        return [...(this.sequence?.takeSounds() ?? []), ...this.menu.takeSounds()];
    }
    dimLevel(): number {
        return this.sequence?.fadeLevel() ?? this.fade?.level() ?? 0;
    }
    clips(): number[] { return this.clipIds.slice(); }
    logoAt(): number[] { return [this.visual?.logoX() ?? this.logoX, this.logoSettle[1]!]; }
    wordmarkAt(): number[] { return [this.visual?.wordmarkX() ?? this.wordX, this.wordSettle[1]!]; }
    numeralAt(): number[] { return this.numeralPoint; }
    glowAt(): number[] { return this.glowPoint; }
    glowLevel(): number { return this.visual ? (this.phaseValue === "slide" ? -1 : this.visual.glowLevel()) : this.glowValue; }
    showNumeral(): boolean { return this.visual?.numeralVisible() ?? this.numeralVisible; }
    isJapanese(): boolean { return this.japanese; }
    isUsa(): boolean { return this.language === 1; }
    legalVisible(): boolean { return this.visual?.legalVisible() ?? true; }
    legalRows(): number[] { return this.visual?.legalRows() ?? [11, 7]; }
    twinkles(): TitleTwinkle[] { return this.sequence?.twinkles() ?? []; }
    optionY(): number[] { return this.menu.optionY(); }
    boxAt(): number[] {
        const row = this.menu.highlight();
        if (row < 2) {
            return [this.layout.optionAt[row]![0]!, this.optionY()[row]! - 1];
        }
        return [this.layout.promptAt[0]!, this.layout.promptAt[1]! - 1];
    }

    private syncMenuPhase(): void {
        const state0 = this.menu.state0();
        const state1 = this.menu.state1();
        this.phaseValue = state0 === 2
            ? (state1 === 2 ? "flashOut" : state1 === 1 ? "menu" : "settle")
            : state1 <= 1 ? "intro" : state1 === 2 ? "prompt"
                : state1 === 3 ? "flashIn" : state1 === 4 ? "split" : "settle";
    }

    private advanceMenu(): void {
        this.menu.tick();
        const outcome = this.menu.result();
        if (outcome !== 0) {
            this.resultValue = outcome;
            this.phaseValue = "fade";
            this.fade = new TitleFadeSession();
            return;
        }
        this.syncMenuPhase();
    }

    /**
     * One browser frame of REAL time, in seconds — the same `dt` every other
     * screen's host is given (web/game.js hands it the rAF elapsed time, the
     * same value the country screen and the battle menus get).
     *
     * The title is a PAL screen: it runs on the original's 50Hz display field,
     * so the seconds are spent through `MenuDisplayClock` and the screen runs
     * once per field that comes due — zero, one or more per browser frame. Each
     * field is one tick of this screen's own scripts (the 32px logo slide, the
     * glow walk, the menu blink) and one published frame of the shared clock,
     * which is where the title's beat counter gets its 1.1992 sixtieths a field
     * (0x133 / 0x100). The host must therefore NOT pass one field per browser
     * frame: at 60Hz that would run the title 20% fast, and at 120Hz more than
     * double speed. Both browser rates now reach the prompt in the same 49
     * fields, as the disc does.
     */
    tick(seconds: number): void {
        const fields = this.display.advance(seconds).length;
        for (let field = 0; field < fields; field += 1) this.step();
    }

    /** The sequence's own +0x54 beat counter: the sixtieths of a second the
     *  title has counted, read from the ported object's memory. */
    beatCounter(): number {
        return this.sequence?.beatCounter() ?? 0;
    }

    /** One displayed field of the title: the screen's whole state machine, with
     *  the shared clock already advanced for this field by the display clock. */
    private step(): void {
        this.timer++;
        if (this.sequence) {
            this.sequence.tick();
            if (this.sequence.result() !== 0) {
                this.resultValue = this.sequence.result();
                this.phaseValue = "done";
            } else if (this.sequence.fading()) this.phaseValue = "fade";
            else if (this.sequence.promptStarted()) this.syncMenuPhase();
            else this.phaseValue = this.sequence.sequenceState() < 3 ? "slide" : "glow";
            return;
        }
        if (this.phaseValue === "fade") {
            this.fade!.tick();
            if (this.fade!.isDone()) this.phaseValue = "done";
            return;
        }
        if (this.phaseValue !== "slide" && this.phaseValue !== "glow"
            && this.phaseValue !== "done") {
            this.advanceMenu();
            return;
        }
        switch (this.phaseValue) {
            case "slide": {
                if (this.visual) {
                    this.visual.tick();
                    if (this.visual.logoX() === this.logoSettle[0]
                        && this.visual.wordmarkX() === this.wordSettle[0]) {
                        this.visual.startGlow();
                        this.phaseValue = "glow";
                    }
                    break;
                }
                const logoStep = Math.round((this.logoStart[0]! - this.logoSettle[0]!) / 10);
                const wordStep = Math.round((this.wordStart[0]! - this.wordSettle[0]!) / 10);
                this.logoX = this.logoSettle[0]! + this.slideCount * logoStep;
                this.wordX = this.wordSettle[0]! + this.slideCount * wordStep;
                if (this.slideCount <= 0) {
                    this.logoX = this.logoSettle[0]!;
                    this.wordX = this.wordSettle[0]!;
                    this.glowIdx = 0;
                    this.glowValue = this.glowScript[0] ?? 0;
                    this.numeralVisible = false;
                    this.phaseValue = "glow";
                    this.timer = 0;
                } else this.slideCount--;
                break;
            }
            case "glow":
                if (this.visual) {
                    this.visual.tick();
                    if (this.visual.numeralVisible()) this.phaseValue = "intro";
                    break;
                }
                if (this.glowIdx >= this.glowScript.length) {
                    this.glowValue = this.glowStay;
                    this.numeralVisible = true;
                    this.phaseValue = "intro";
                    this.timer = 0;
                } else {
                    this.glowValue = this.glowScript[this.glowIdx++]!;
                    if (this.glowIdx >= this.glowScript.length) {
                        this.glowValue = this.glowStay;
                        this.numeralVisible = true;
                        this.phaseValue = "intro";
                        this.timer = 0;
                    }
                }
                break;
            default: break;
        }
    }

    start(): boolean {
        if (this.phaseValue !== "prompt") return false;
        this.menu.queueStart();
        if (this.sequence) this.step(); else this.advanceMenu();
        return true;
    }
    up(): boolean {
        if (this.phaseValue !== "menu" || this.highlight() === 0) return false;
        this.menu.queueUp();
        if (this.sequence) this.step(); else this.advanceMenu();
        return true;
    }
    down(): boolean {
        if (this.phaseValue !== "menu" || this.highlight() === 1) return false;
        this.menu.queueDown();
        if (this.sequence) this.step(); else this.advanceMenu();
        return true;
    }
    confirm(): boolean {
        if (this.phaseValue !== "menu") return false;
        this.menu.queueConfirm();
        if (this.sequence) this.step(); else this.advanceMenu();
        return true;
    }
    choose(index: number): boolean {
        if (this.phaseValue !== "menu") return false;
        this.menu.selectPointer(index);
        return this.confirm();
    }
}
