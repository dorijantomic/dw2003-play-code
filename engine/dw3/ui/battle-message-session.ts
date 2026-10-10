// The in-battle message line as a session, composed from the ports in
// engine/dw3/ui/native/battle-message-line.ts on top of the already-translated message
// services (engine/dw3/ui/message-box.ts's bank and widget-method offsets, which the
// ports reuse verbatim).
//
// This is the L2 layer the HP plate's port uses: one exported class that owns the two
// text elements, the reveal/hold/close machine, and the draw, and takes the pad word
// and the display tick from its caller. `?legacyBattleMsg=1` (web/battlemsg-translated.js)
// keeps web/battle.js's hand-drawn rectangle instead.
//
// Decode: .bunny-scratch/battlemsg-fix2-report.md (2026-10-02), which re-read
// pro/fightstg from the controller F0x8009a298 outward. It supersedes
// .bunny-scratch/battlemsg-report.md on which routine is which: the step routine is
// F0x80098c9c, the draw F0x80098924 and the reveal machine F0x80098a84, not the
// seven-child controller F0x8009a898 that the first decode read.

import {
    BATTLE_MESSAGE_ARMS, BATTLE_MESSAGE_BANK, BATTLE_MESSAGE_BANK_FIELD,
    BATTLE_MESSAGE_BANK_ITEM, BATTLE_MESSAGE_BANK_PARTY, BATTLE_MESSAGE_CLOSE_BIT,
    BATTLE_MESSAGE_CURSE_INDEX, BATTLE_MESSAGE_FONT_KIND, BATTLE_MESSAGE_LAYER,
    BATTLE_MESSAGE_LINE1, BATTLE_MESSAGE_LINE2, BATTLE_MESSAGE_NAME, BATTLE_MESSAGE_PANEL_BOX,
    BATTLE_MESSAGE_PANEL_CEL, BATTLE_MESSAGE_PANEL_H, BATTLE_MESSAGE_PANEL_PACK,
    BATTLE_MESSAGE_PANEL_W, BATTLE_MESSAGE_PANEL_X, BATTLE_MESSAGE_PANEL_Y,
    BATTLE_MESSAGE_PHASE_TABLE, BATTLE_MESSAGE_PROMPT_CEL, BATTLE_MESSAGE_PROMPT_CLIP,
    BATTLE_MESSAGE_PROMPT_FRAMES, BATTLE_MESSAGE_PROMPT_GATE, BATTLE_MESSAGE_PROMPT_PACK,
    BATTLE_MESSAGE_PROMPT_SIZE, BATTLE_MESSAGE_PROMPT_TICKS, BATTLE_MESSAGE_PROMPT_X,
    BATTLE_MESSAGE_PROMPT_Y, BATTLE_MESSAGE_EL_SET_NUMBER,
    BATTLE_MESSAGE_EL_SET_SLOT, BATTLE_MESSAGE_EL_SET_STRING, BATTLE_MESSAGE_EL_VISIBLE,
    BATTLE_MESSAGE_REVEAL, BATTLE_MESSAGE_DRAW, BATTLE_MESSAGE_TICK,
    BattleMessageReveal, type BattleMessageArm, type BattleMessageWidgets, battleMessageArm,
    battleMessageDraw, battleMessageKindFor, battleMessageLineIndex, battleMessageNamesLineOne,
    battleMessagePromptClipId,
    battleMessagePromptFrame, battleMessageShow,
} from "./native/battle-message-line.ts";

export {
    BATTLE_MESSAGE_ARMS, BATTLE_MESSAGE_BANK, BATTLE_MESSAGE_BANK_FIELD,
    BATTLE_MESSAGE_CLOSE_BIT, BATTLE_MESSAGE_DRAW,
    BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_LINE1, BATTLE_MESSAGE_LINE2, BATTLE_MESSAGE_NAME,
    BATTLE_MESSAGE_PANEL_BOX, BATTLE_MESSAGE_PHASE_TABLE, BATTLE_MESSAGE_PROMPT_CLIP,
    BATTLE_MESSAGE_PROMPT_FRAMES, BATTLE_MESSAGE_PROMPT_GATE, BATTLE_MESSAGE_PROMPT_SIZE,
    BATTLE_MESSAGE_PROMPT_TICKS, BATTLE_MESSAGE_REVEAL, BATTLE_MESSAGE_TICK,
    battleMessageArm, battleMessageDraw, battleMessageKindFor, battleMessageLineIndex,
    battleMessagePromptClipId, battleMessagePromptFrame,
};

/**
 * The bank ids the VM reaches for, as the browser maps them. Bank `0x7f` is the message
 * bank (esmfight); the others supply the second slot of a few arms.
 */
export const BATTLE_MESSAGE_BANKS: readonly number[] = Object.freeze([
    BATTLE_MESSAGE_BANK, BATTLE_MESSAGE_BANK_PARTY, BATTLE_MESSAGE_BANK_ITEM,
    BATTLE_MESSAGE_BANK_FIELD,
]);

/** What the painter needs to know about a live message, one frame. */
export interface BattleMessageFrame {
    /** The two lines the original would have on screen, the hidden one blanked. */
    lines: readonly [string, string];
    /** The window picture: pack handle, cel, native place and measured size. */
    panel: { pack: number; cel: number; x: number; y: number; w: number; h: number };
    /** The advance prompt, or null until the last line has arrived (`.L0x80098b88`). */
    prompt: { pack: number; cel: number; clipId: string; x: number; y: number; size: number } | null;
}

/**
 * Resolve an `esmfight` index to the string the original's bank 0x7f holds.
 *
 * The original reads the disc's language file, so the string table itself is an
 * extracted asset, not code: the shipped English file is
 * `~/ddw3/lang_file/dw2003/eng/esmfight.toml`. The port takes it as an
 * argument so a caller can pass its own bank and the oracle can pass the original's.
 */
export type BattleMessageTextOf = (bank: number, index: number) => string;

/** Substitute the `{1}`-style slots the way the element's own slot layout does. */
export function battleMessageCompose(template: string, slots: readonly string[]): string {
    return template.replace(/\{(\d)\}/g, (all, digit) => slots[Number(digit) - 1] ?? all);
}

export interface BattleMessageSessionOptions {
    /** `esmfight` index -> string, for bank 0x7f. */
    textOf: BattleMessageTextOf;
    /** Draws the window picture and the prompt. Supplied by the browser adapter. */
    paint: (frame: BattleMessageFrame) => void;
}

/**
 * One `unkAC(task, kind, payload)` call the way the original's own call sites make it.
 *
 * `kind` is the arm index of `FIGHTSTG_F0x80099588`'s 22-entry table
 * (`.L0x8008318c`), `payload` the words the call site writes before the call, `name`
 * the acting Digimon's name — the original reads that itself, out of the party records
 * or the current actor, in `FIGHTSTG_F0x80098d14` — and `slots` the already-formatted
 * strings that fill the second line's numbered slots (a technique name out of bank
 * `0xa2`, an item name out of bank `0x6a`, a partner name out of bank `0x4e`, or the
 * plain numbers kinds 4, 11, 15, 16, 18 and 21 write through `+0x118`).
 */
export interface BattleMessageSpec {
    kind: number;
    payload?: readonly number[];
    name?: string;
    slots?: readonly string[];
}

/**
 * One battle message line.
 *
 * `open()` is the ported `unkAC(task, kind, payload)` — the original's callers reach it
 * through the object method at `+0xac`. `tick(tick, buttons)` is
 * `FIGHTSTG_F0x80098c9c` followed by `FIGHTSTG_F0x80098a84`: it reveals one whole line per
 * `BATTLE_MESSAGE_LINE_DELAY_TICKS` and only closes on `BATTLE_MESSAGE_CLOSE_BIT`.
 *
 * The owner stops waiting because the generic child runner writes the child's return value
 * back over its slot (`exe/fns.s:8929-8931`) and a finished controller returns 0
 * (`exe/fns.s:8883,8900-8905`) — not because a screen object clears anything.
 */
export class BattleMessageSession {
    private widgets: BattleMessageWidgets = { line1: 0, line2: 0 };
    private reveal: BattleMessageReveal = new BattleMessageReveal([""]);
    /** The numbered slots of the line at native (20, 194). */
    private slots1: string[] = [];
    /** The numbered slots of the line at native (20, 208). */
    private slots2: string[] = [];
    private template1 = "";
    private template2 = "";
    private index1 = -1;
    private index2 = -1;
    private up = false;
    private tickCount = 0;
    private closed = false;
    /** The kind the live line was opened with, for the caller and the oracle. */
    private openedKind = 0;

    /** The bank lookup and the painter the session was built with. */
    readonly options: BattleMessageSessionOptions;

    constructor(options: BattleMessageSessionOptions) {
        this.options = options;
    }

    /** The ported element pair: `F0x8001AE38` at (20, 194) and (20, 208). */
    build(createTextElement: (layer: number, kind: number, x: number, y: number) => number):
        BattleMessageWidgets {
        this.widgets = {
            line1: createTextElement(BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_FONT_KIND,
                BATTLE_MESSAGE_LINE1.x, BATTLE_MESSAGE_LINE1.y),
            line2: createTextElement(BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_FONT_KIND,
                BATTLE_MESSAGE_LINE2.x, BATTLE_MESSAGE_LINE2.y),
        };
        return this.widgets;
    }

    /** Whether a message is on screen. */
    get active(): boolean {
        return this.up;
    }

    /**
     * Whether the line has already been read: the controller reached `self+0x0c = 3` on a
     * Circle press (`.L0x80098c04`/`.L0x80098c84`). From then on nothing is drawn: the step
     * routine F0x80098c9c draws only in state 1 (`.L0x80098ccc` -> `.L0x80098d00` for states
     * 2 and 3), and the child runner F0x80018140 tears the object and its two line elements
     * down. A caller must not paint a finished line.
     */
    get finished(): boolean {
        return this.closed;
    }

    /** The two text elements, for the oracle and for a caller that paints them itself. */
    get elements(): BattleMessageWidgets {
        return this.widgets;
    }

    /** The last `tick` index handed to `tick()`, so the adapter can keep the prompt in step. */
    get clock(): number {
        return this.tickCount;
    }

    /**
     * The walker's own two lines, run through the original's shapes. `lines` is what
     * web/battle.js put in `b.message`; this picks the VM kind that produces the same
     * panel, and the substituted text the element would hold.
     */
    open(lines: readonly string[], payload: readonly number[] = []): number {
        const kind = battleMessageKindFor(lines);
        if (lines.length === 0 || !String(lines[0] ?? "").length) {
            // No message, no object: the original only allocates one from a caller that
            // has something to say (`FIGHTSTG_F0x8009a298`), and a caller that has
            // nothing to say never calls it, so no panel is drawn.
            this.up = false;
            this.closed = true;
            this.reveal = new BattleMessageReveal([""]);
            return kind;
        }
        const words = String(lines[0] ?? "");
        this.slots2 = payload.map((value, i) => (i === 0 ? words : String(value)));
        // A line of the walker's own: the shared tail still fills line one's name slot,
        // so the walker's first line goes there rather than leaving `esmfight[0x16]`
        // = "{1}" on screen unsubstituted.
        this.slots1 = battleMessageNamesLineOne(kind) && words ? [words] : [];
        this.openedKind = kind;
        this.index1 = battleMessageLineIndex(kind, 0, payload) ?? 0;
        this.index2 = battleMessageLineIndex(kind, 1, payload) ?? 0;
        this.template1 = kind === 1
            ? String(lines[0] ?? "")
            : this.options.textOf(BATTLE_MESSAGE_BANK, this.index1);
        this.template2 = this.options.textOf(BATTLE_MESSAGE_BANK, this.index2);
        this.reveal = new BattleMessageReveal(lines);
        this.reveal.builtByVm();
        this.up = true;
        this.closed = false;
        this.tickCount = 0;
        return kind;
    }

    /**
     * Open the line the original's own call site would: `FIGHTSTG_F0x80099588` builds
     * the two elements, takes each line's `esmfight` index off its arm, writes the
     * numbered slots and, for every arm but kinds 1, 9 and 20, puts the acting
     * Digimon's name into slot 1 of line 1 through `FIGHTSTG_F0x80098d14`.
     *
     * This is the path web/battle.js uses wherever it has read the original's arm and
     * payload off pro/fightstg; `open` stays for the lines that have no read counterpart.
     */
    openOriginal(spec: BattleMessageSpec): number {
        const payload = spec.payload ?? [];
        const arm = battleMessageArm(spec.kind);
        if (!arm) return this.open([], payload);
        const slots = spec.slots ?? [];
        this.slots1 = battleMessageNamesLineOne(spec.kind) && spec.name ? [String(spec.name)] : [];
        this.slots2 = slots.map((text) => String(text));
        // Every arm the walker reaches writes both lines, so the reveal shows two.
        return this.arm(spec.kind, payload, battleMessageLineIndex(spec.kind, 1, payload) !== null
            ? 2 : 1);
    }

    /** The kind the live line was opened with. */
    get liveKind(): number {
        return this.openedKind;
    }

    /**
     * Fill both lines off one arm the way the VM does. `lineCount` is what the VM
     * stored at `self+0x7c`: `.L0x800996e8` and its eleven copies write 2 for every
     * arm that sets both lines, and `.L0x80099674` writes 1 for the single-line kind 1.
     */
    private arm(kind: number, payload: readonly number[], lineCount: number): number {
        this.openedKind = kind;
        this.index1 = battleMessageLineIndex(kind, 0, payload) ?? 0;
        this.index2 = battleMessageLineIndex(kind, 1, payload) ?? 0;
        this.template1 = this.options.textOf(BATTLE_MESSAGE_BANK, this.index1);
        this.template2 = this.options.textOf(BATTLE_MESSAGE_BANK, this.index2);
        this.reveal = new BattleMessageReveal(this.index2 < 0 ? [""] : ["", ""]);
        // The VM's own two writes on the way in: `.L0x800995b4 sw $v0, 0x74($s4)` sets the
        // "a message was built" flag phase 0 waits on, and `.L0x80099614 sw $zr,
        // 0x78($s4)` rewinds the cursor the reveal machine walks.
        this.reveal.builtByVm(lineCount ?? (this.index2 < 0 ? 1 : 2));
        this.up = true;
        this.closed = false;
        this.tickCount = 0;
        return kind;
    }

    /** The kind `open` chose, and the arm behind it. */
    get kind(): number {
        return battleMessageKindFor([]);
    }

    /** The strings the two elements would hold right now. */
    lines(): readonly [string, string] {
        const text = (template: string, index: number, slots: readonly string[]) =>
            index >= 0 ? battleMessageCompose(template, slots) : "";
        return [
            text(this.template1, this.index1, this.slots1),
            this.reveal.visibleLines > 1 ? text(this.template2, this.index2, this.slots2) : "",
        ];
    }

    /**
     * FIGHTSTG_F0x80098c9c + FIGHTSTG_F0x80098a84. `tick` is the display tick the original
     * counts (`[0x8004df98]()`); `buttons` the pad word it reads through
     * `[0x8004bbc4](0)`.
     * @returns whether the controller reached `self+0x0c = 3` on this tick. After that the
     *   line is `finished` and draws nothing (see `finished`).
     */
    tick(tick: number, buttons: number): boolean {
        if (!this.up) return true;
        this.tickCount = tick;
        const done = this.reveal.tick(tick, buttons);
        if (done) this.closed = true;
        return done;
    }

    /** The whole panel, prompt included, as one frame for the painter. */
    frame(): BattleMessageFrame {
        const [line1, line2] = this.lines();
        const promptClip = battleMessagePromptClipId(this.tickCount);
        return {
            lines: [line1, line2],
            panel: {
                pack: BATTLE_MESSAGE_PANEL_PACK, cel: BATTLE_MESSAGE_PANEL_CEL,
                x: BATTLE_MESSAGE_PANEL_X, y: BATTLE_MESSAGE_PANEL_Y,
                w: BATTLE_MESSAGE_PANEL_W, h: BATTLE_MESSAGE_PANEL_H,
            },
            prompt: this.promptVisible ? {
                pack: BATTLE_MESSAGE_PROMPT_PACK, cel: BATTLE_MESSAGE_PROMPT_CEL,
                clipId: promptClip, x: BATTLE_MESSAGE_PROMPT_X, y: BATTLE_MESSAGE_PROMPT_Y,
                size: BATTLE_MESSAGE_PROMPT_SIZE,
            } : null,
        };
    }

    /** Paint this frame. `paint` is the browser adapter's canvas painter. */
    draw(): BattleMessageFrame {
        const frame = this.frame();
        this.options.paint(frame);
        return frame;
    }

    /**
     * The ported VM, for a caller that drives it the original's way instead of through
     * `open` — `battleMessageShow` with the same host shape as the ports in
     * native/battle-message-line.ts.
     */
    show(kind: number, payload: readonly number[], host: Parameters<typeof battleMessageShow>[0],
        numberOf: (value: number) => string = String): ReturnType<typeof battleMessageShow> {
        return battleMessageShow(host, this.widgets, kind, payload,
            this.options.textOf, numberOf);
    }

    /** The advance prompt's frame for a tick, exposed so a test can pin it. */
    promptFrame(tick: number): number {
        return battleMessagePromptFrame(tick);
    }

    /**
     * `true` only while the reveal machine is in phase 3 — `self+0x98` is set at
     * `.L0x80098b8c`, the moment the last line arrives, and cleared at `.L0x80098c34`.
     */
    get promptVisible(): boolean {
        return this.up && !this.closed && this.reveal.promptVisible;
    }

    /** The reveal machine itself, so a caller can inspect its state. */
    get machine(): BattleMessageReveal {
        return this.reveal;
    }

    /** Whether the element set is complete enough to draw. */
    get ready(): boolean {
        return this.widgets.line1 !== 0 && this.widgets.line2 !== 0;
    }

    /** The two lines' native places, as the original's own literals. */
    static positions(): readonly [{ x: number; y: number }, { x: number; y: number }] {
        return [BATTLE_MESSAGE_LINE1, BATTLE_MESSAGE_LINE2];
    }

    /** The window picture's measured box, for a caller that lays a frame out from it. */
    static panelBox(): { x: number; y: number; w: number; h: number } {
        return { ...BATTLE_MESSAGE_PANEL_BOX };
    }

    /** The 22 arms, for a caller that wants the whole table. */
    static arms(): readonly BattleMessageArm[] {
        return BATTLE_MESSAGE_ARMS;
    }

    /** The two element methods the VM calls, for a caller that implements a host. */
    static elementMethods(): readonly number[] {
        return [
            BATTLE_MESSAGE_EL_SET_STRING, BATTLE_MESSAGE_EL_SET_NUMBER,
            BATTLE_MESSAGE_EL_SET_SLOT, BATTLE_MESSAGE_EL_VISIBLE,
        ];
    }
}

export { BATTLE_MESSAGE_CURSE_INDEX };

/** Alias kept for the engine barrel's named export list. */
export const battleMessageBANKs = BATTLE_MESSAGE_BANKS;