// PlayStation pad abstraction — the single place that decides "which button is
// this?" for both the keyboard and a real joystick.
//
// WHAT THE PLAYER SEES. The game is driven by a PlayStation controller: a d-pad,
// four face buttons, two shoulders and Start/Select. On a keyboard those are
// stood in for by keys; with a joystick plugged in they are the buttons
// themselves. Both roads arrive at the same button name, so every screen reacts
// identically no matter which one the player used.
//
// WHY THIS EXISTS. Before this module each screen compared raw key strings, and
// the same key stood for two different pad buttons in different screens: `c` was
// the Square sort submenu in the main menu (web/menu.js) and the Circle
// details toggle in the shop (web/shop.js), while `x` was both the Back button
// and the fishing strike. A joystick cannot be wired to that, and neither can a
// player.
//
// BUTTON BIT IDENTITIES. The game reads the pad through the BIOS path — `InitPad`
// at ~/ddw3/asm/dw2003/exe/fns.s:47389 and `StartPad` at :47407 — into a raw
// state word plus a separate "newly pressed" latch, and the resident controller
// service's poll `F0x80018BCC` turns that raw word into the word every screen
// reads. Two of its bits are decoded in this project from real call sites:
//
//   0x2000 = CONFIRM  docs/research/field/submarimon-buoyancy-decoded-2026-07-28.md:41
//                      (re-cited by fishing-system-decoded-2026-07-11.md:391)
//   0x4000 = BACK     the same line
//
// Those two are the standard PlayStation pad bits for CIRCLE and CROSS, so the
// remaining bits are filled in from that layout. They are NOT decoded from this
// game's own code and are marked GUESS: below. Nothing in the walker depends on
// the numeric value of an undecoded bit — the bit table is documentation plus a
// future decode hook; dispatch runs on the button NAMES.
//
// TWO LAYERS, AND THE SWAP BETWEEN THEM. A name in this file is either a
// PHYSICAL button (the one on the controller the player touches) or a WORD-BIT
// name (the bit in the word the screens read). They are not the same thing, and
// the original moves three of them:
//
//   .L0x80018ce4 nor  $a0, $zr, $v0        fns.s:9689  the raw word, active-high
//   .L0x80018ce8 lui  $v0, %hi(D0x8005cca8)             the language index
//   .L0x80018cf4 beqz $v0, .L0x80018d48    fns.s:9693  language 0: no swap at all
//   .L0x80018d28 ori  $s3, $a0, 0x2000     fns.s:9706  raw bit 14 -> word bit 13
//   .L0x80018d38 ori  $s3, 0x4000          fns.s:9710  raw bit 12 -> word bit 14
//   .L0x80018d44 ori  $s3, 0x1000          fns.s:9713  raw bit 13 -> word bit 12
//
// Each test is independent: the `move_` that reloads the next button's bit sits
// in a branch DELAY SLOT (fns.s:9701 and :9706), and a delay slot always runs.
// So outside Japanese a physical Cross lands on the confirm bit, a physical
// Triangle on the back bit and a physical Circle on bit 12, while Square stays
// put. Measured on the rig with the Europe disc in English
// (docs/research/ui/captures/pad-face-button-swap-rig-2026-10-03.log):
// Cross 0x2000, Circle 0x1000, Triangle 0x4000, Square 0x8000.
// Claim: `pad-poll-swaps-face-buttons-when-language-is-not-zero-2026-10-03`.
//
// `padWordButton` / `padWordBit` are that one shared step, and BOTH roads into
// the walker go through it: a gamepad button through `buttonsFromGamepad`, a key
// through `buttonForKey`. Screens only ever see word-bit names, so none of them
// knows which physical button the player used.

/** The fourteen buttons of a digital PlayStation pad. */
export type PadButton =
  | "up" | "down" | "left" | "right"
  | "circle" | "cross" | "triangle" | "square"
  | "l1" | "r1" | "l2" | "r2"
  | "start" | "select";

export const PAD_BUTTONS: readonly PadButton[] = [
  "up", "down", "left", "right",
  "circle", "cross", "triangle", "square",
  "l1", "r1", "l2", "r2",
  "start", "select",
];

/**
 * The bit each WORD-BIT name occupies in the word every screen reads.
 *
 * These are the game's word bits, NOT the buttons on the pad: bit 13 (`circle`)
 * is the confirm bit and bit 14 (`cross`) the back bit in every screen read so
 * far. Which PHYSICAL button produces each one depends on the language index —
 * in English (index 2) the poll swaps three of them, so `circle` here is the
 * player's Cross and `cross` is the player's Triangle. Use `padWordBit` to go
 * from a physical button to its bit, never this table directly.
 *
 * CIRCLE and CROSS are decoded from this game (see the header). The other twelve
 * are `GUESS:` — the standard PlayStation layout, consistent with those two, but
 * no call site in this game has been read for them.
 */
export const PAD_BIT: Readonly<Record<PadButton, number>> = {
  select: 0x0001,   // GUESS:
  start: 0x0008,    // GUESS:
  up: 0x0010,       // GUESS:
  right: 0x0020,    // GUESS:
  down: 0x0040,     // GUESS:
  left: 0x0080,     // GUESS:
  l2: 0x0100,       // GUESS:
  r2: 0x0200,       // GUESS:
  l1: 0x0400,       // GUESS:
  r1: 0x0800,       // GUESS:
  triangle: 0x1000, // GUESS: the walker's "triangle" bit — the player's CIRCLE in English
  circle: 0x2000,   // DECODED — the CONFIRM bit; the player's CROSS in English
  cross: 0x4000,    // DECODED — the BACK bit; the player's TRIANGLE in English
  square: 0x8000,   // GUESS: never moved by the swap
};

/**
 * The language index the walker runs in until a screen says otherwise.
 *
 * `D0x8005CCA8` in the original; English is index 2 and is what the walker
 * ships, so that is the default. `web/game.js` pushes the boot screen's choice
 * here through `setPadLanguage` on every write to `state.languageByte`.
 */
export const PAD_LANGUAGE_DEFAULT = 2;

let languageIndex: number = PAD_LANGUAGE_DEFAULT;

/** The language index the face-button swap is chosen by. */
export function padLanguage(): number {
  return languageIndex;
}

/** Record the boot screen's language choice, as `D0x8005CCA8` holds it. */
export function setPadLanguage(index: number | null | undefined): void {
  languageIndex = Number.isInteger(index) ? (index as number) : PAD_LANGUAGE_DEFAULT;
}

/**
 * The three face buttons the poll moves, as physical button -> word-bit name.
 *
 * Read out of `F0x80018BCC` `.L0x80018CDC`-`.L0x80018d44` (fns.s:9687-9713) and
 * confirmed on the rig in English. Square, the shoulders, Start, Select and the
 * directions are not in that block, so they pass through in every language.
 */
export const PAD_FACE_WORD_SWAP: Readonly<Partial<Record<PadButton, PadButton>>> = Object.freeze({
  // raw bit 14 (physical Cross) -> word bit 13, the confirm bit
  cross: "circle",
  // raw bit 12 (physical Triangle) -> word bit 14, the back bit
  triangle: "cross",
  // raw bit 13 (physical Circle) -> word bit 12
  circle: "triangle",
});

/**
 * The word-bit name a PHYSICAL button reaches in `languageIndex`.
 *
 * Language 0 is the raw layout and returns the button unchanged; any other
 * index moves the three face buttons. This is the single place the swap lives.
 */
export function padWordButton(
  physical: PadButton,
  languageIndex: number = padLanguage(),
): PadButton {
  if ((languageIndex | 0) === 0) return physical;
  return PAD_FACE_WORD_SWAP[physical] ?? physical;
}

/** The bit in the game's word that a PHYSICAL button reaches. */
export function padWordBit(physical: PadButton, languageIndex: number = padLanguage()): number {
  return PAD_BIT[padWordButton(physical, languageIndex)];
}

/** The set of buttons held in a raw pad word (as the original's raw-state read). */
export function buttonsFromMask(mask: number): PadButton[] {
  return PAD_BUTTONS.filter((b) => (mask & PAD_BIT[b]) !== 0);
}

/** The pad word for a set of held buttons — the inverse of `buttonsFromMask`. */
export function maskFromButtons(held: Iterable<PadButton>): number {
  let mask = 0;
  for (const b of held) mask |= PAD_BIT[b] ?? 0;
  return mask;
}

/**
 * Keyboard stand-ins, button -> the keys that press it.
 *
 * The buttons here are the PHYSICAL ones — the button on a PlayStation pad that
 * the key stands for — so `cross` means the bottom face button whatever the
 * language is. Which bit that button reaches is `buttonForKey`'s problem, not
 * this table's.
 *
 * Every binding that existed before this module is kept, so no player and no test
 * loses a key. WHICH BIT each key reaches follows from the table above plus the
 * rotation, so the face-button rows are read together:
 *
 *   key              physical button   word bit   the player's job
 *   Enter/space/z/c  Cross             0x2000     CONFIRM   ("circle")
 *   Escape, x        Triangle          0x4000     BACK      ("cross")
 *   k                Circle            0x1000     the third row action ("triangle")
 *
 * Until 2026-10-03 Escape stood for the physical CIRCLE and `c` for the physical
 * Triangle, so Escape reached 0x1000 and `c` reached 0x4000 — the exact inverse
 * of what an English disc does. Every screen that went back therefore read the
 * wrong bit to match, and the pause home read a bit the original never asks for
 * (docs/research/ui/unknowns/d.md U-05), so the player's own back button did
 * nothing on it.
 *
 * The fix keeps each key's JOB and moves its bit. `c` has always been the key
 * that confirms in this walker — every screen that took a "cross" press took it
 * because `c` reached that name — so `c` now stands for the physical Cross and
 * reaches 0x2000. Escape and x stand for the physical Triangle, which is the
 * button an English disc goes back on
 * (docs/research/field/submarimon-buoyancy-decoded-2026-07-28.md:46: "0x4000 is
 * the PS1 pad's CROSS bit ... tested separately at 0xb808, is the
 * confirm/interact button").
 *
 * The physical CIRCLE takes `k`. Logical 0x0C is the third action on the screens
 * that print a third prompt: the shop's "[circle] Button: Effects" card
 * (docs/research/ui/shop-system-decompiled.md:295), the lab's
 * "[circle] Button: Details" panel (docs/research/ui/dri-gap-2026-09-02.md C3),
 * and the card folder editor's "[circle] Button:Sort"
 * (docs/research/ui/card-folder-editor-2026-08-14.md §3). Until 2026-10-03 that
 * bit had no key of its own — it was only reachable as a side effect of Escape
 * and x being bound to the physical Circle.
 *
 * Keys are compared lowercased, as `KeyboardEvent.key.toLowerCase()` yields
 * them. The space bar is the single-space string.
 */
export const KEYBOARD_BINDINGS: Readonly<Record<PadButton, readonly string[]>> = {
  up: ["arrowup", "w"],
  down: ["arrowdown", "s"],
  left: ["arrowleft", "a"],
  right: ["arrowright", "d"],
  // The bottom face button: the player's CONFIRM in English, and the key the
  // walker has always confirmed on. Also the fishing strike, which the bobber
  // reads as the confirm bit (fishing-system-decoded-2026-07-11.md:391).
  cross: ["enter", " ", "z", "c"],
  // The right face button: in English word bit 0x1000, the third row action on
  // the shop, the lab and the folder editor (see the note above). `k` is unused
  // anywhere else in the walker.
  circle: ["k"],
  // The top face button: in English the bit every screen reads as BACK, and the
  // bit the pause pages' own "[triangle] Button: Back" prompts are about. The
  // card screens' prompts name that physical button, which is why the card
  // screens' own back tests read the name "cross".
  triangle: ["escape", "x"],
  // "[square]Button: Sort Items" in the main menu (esstatus 33).
  square: ["v"],
  l1: ["q"],
  r1: ["e"],
  l2: ["1"],
  r2: ["3"],
  start: ["i"],
  select: ["r"],
};

/** key -> PHYSICAL button, derived from KEYBOARD_BINDINGS. */
const KEY_TO_BUTTON: Map<string, PadButton> = (() => {
  const m = new Map<string, PadButton>();
  for (const button of PAD_BUTTONS) {
    for (const key of KEYBOARD_BINDINGS[button]) m.set(key, button);
  }
  return m;
})();

/**
 * The word-bit button a keyboard key reaches, or null when it stands for none.
 *
 * The key names a physical button; the original's poll then decides which bit
 * that button lands on for the current language. `languageIndex` defaults to the
 * walker's own (`setPadLanguage`), and is an argument so a test can read either
 * layout without touching module state.
 */
export function buttonForKey(key: string, languageIndex: number = padLanguage()): PadButton | null {
  const physical = KEY_TO_BUTTON.get(key.toLowerCase());
  return physical ? padWordButton(physical, languageIndex) : null;
}

/** True when `name` is a pad button name rather than a raw key. */
export function isPadButton(name: string): name is PadButton {
  return (PAD_BUTTONS as readonly string[]).includes(name);
}

/**
 * Standard-gamepad button index -> the PHYSICAL pad button it stands for.
 *
 * The indices are the W3C Gamepad API "standard" mapping. Face buttons are
 * mapped BY POSITION, not by letter: the right face button (B on an Xbox pad,
 * index 1) is Circle, so a real DualShock lands correctly. The bit each of them
 * reaches is the language-dependent question `padWordButton` answers, which in
 * English makes index 0 (a Cross) the confirm button and index 3 (a Triangle)
 * the back button.
 */
export const GAMEPAD_BUTTON_MAP: Readonly<Record<number, PadButton>> = {
  0: "cross",     // bottom face  (A)
  1: "circle",    // right face   (B)
  2: "square",    // left face    (X)
  3: "triangle",  // top face     (Y)
  4: "l1",
  5: "r1",
  6: "l2",
  7: "r2",
  8: "select",
  9: "start",
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};

/** Left-stick axis indices in the standard mapping. */
export const GAMEPAD_AXIS = { leftX: 0, leftY: 1 } as const;

/**
 * Left-stick deflection past which the stick counts as a d-pad press, and the
 * smaller value it must fall back under to count as released.
 *
 * The gap is hysteresis: a stick resting near the threshold would otherwise
 * chatter press/release every frame and machine-gun a menu cursor.
 */
export const STICK_PRESS = 0.5;
export const STICK_RELEASE = 0.35;

/**
 * Analog trigger depth past which L2/R2 count as pressed. Standard-mapping
 * triggers report as buttons with a `value`, but some pads only fill the axis.
 */
export const TRIGGER_PRESS = 0.5;

/**
 * Held-direction auto-repeat, in DISPLAY TICKS, and it is a CURVE, not one
 * interval. The pad service fires the edge, waits 16 ticks, then 6, then every
 * 4 — its repeat credit is 0 before the first repeat, 10 before the second and
 * 12 after, which is exactly 16, 6, 4 ticks. A recreation with a single fixed
 * interval is wrong from the second step onward.
 *
 * Decoded in docs/research/ui/pad-input-service-behaviour-2026-08-21.md §
 * "What a player feels". `framesHeld` counts display ticks, the press edge at
 * 1. A held face button does not repeat, which is why only directions are fed
 * through this.
 */
export const PAD_REPEAT = Object.freeze({ first: 16, second: 6, later: 4 });

/** True when a direction held for `framesHeld` display ticks pulses this tick:
 *  the edge (1), then 1+16, then 1+16+6, then every 4 after. */
export function padRepeatFires(framesHeld: number): boolean {
  const n = framesHeld | 0;
  if (n <= 0) return false;
  if (n === 1) return true;
  if (n === 1 + PAD_REPEAT.first) return true;
  if (n === 1 + PAD_REPEAT.first + PAD_REPEAT.second) return true;
  const later = 1 + PAD_REPEAT.first + PAD_REPEAT.second;
  return n > later && (n - later) % PAD_REPEAT.later === 0;
}

/** Buttons that auto-repeat while held. */
export const REPEATING: readonly PadButton[] = ["up", "down", "left", "right"];

export function repeats(button: PadButton): boolean {
  return (REPEATING as readonly string[]).includes(button);
}

/**
 * The buttons a gamepad snapshot is holding, as WORD-BIT names.
 *
 * `pad` is a `Gamepad` (or any object with `buttons` and `axes`); it is read
 * structurally so tests can pass a plain object. `previous` is the previously
 * held set, used only for the stick's release hysteresis — pass an empty set on
 * the first poll. `languageIndex` picks the face-button layout and defaults to
 * the walker's own; in English the pad's Cross is the confirm bit and its
 * Triangle the back bit, so a real controller confirms where the keyboard's
 * Enter does.
 */
export function buttonsFromGamepad(
  pad: { buttons?: readonly { pressed?: boolean; value?: number }[]; axes?: readonly number[] },
  previous: ReadonlySet<PadButton> = new Set(),
  languageIndex: number = padLanguage(),
): Set<PadButton> {
  const held = new Set<PadButton>();
  const buttons = pad.buttons ?? [];
  for (const [indexText, physical] of Object.entries(GAMEPAD_BUTTON_MAP)) {
    const entry = buttons[Number(indexText)];
    if (!entry) continue;
    const analog = physical === "l2" || physical === "r2";
    const down = entry.pressed === true || (analog && (entry.value ?? 0) >= TRIGGER_PRESS);
    if (down) held.add(padWordButton(physical, languageIndex));
  }

  // Left stick stands in for the d-pad. A stick already counted as held only has
  // to stay above the smaller release threshold to keep counting.
  const axes = pad.axes ?? [];
  const x = axes[GAMEPAD_AXIS.leftX] ?? 0;
  const y = axes[GAMEPAD_AXIS.leftY] ?? 0;
  const deflected = (value: number, button: PadButton): boolean => {
    const limit = previous.has(button) ? STICK_RELEASE : STICK_PRESS;
    return value >= limit;
  };
  if (deflected(-x, "left")) held.add("left");
  if (deflected(x, "right")) held.add("right");
  if (deflected(-y, "up")) held.add("up");
  if (deflected(y, "down")) held.add("down");

  return held;
}
