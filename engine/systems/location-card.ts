// Stage-entry LOCATION TITLE CARD — the thing the game does when you walk into
// a screen: it tells you where you are.
//
// An area name is typed out near the top ("Kusanagi City") and a place name
// below it ("Street Corner"), while coloured bars slide in around them from the
// right and from the top. When both names have finished typing the card holds
// for one second, then a horizontal slit closes over the whole screen and takes
// the card away with it.
//
// DECODE (fieldstg.s / exe-decomp, overlay base 0x80082cb0):
//
//   * `F0x80087d68(1)` builds the card object (`F0x800143dc(0x80087974, 0x1C0,
//     8, 9)`) and raises the busy flag at `0x80099DD4`. Its only call site is
//     the field's own stage-entry sequence (`F0x8008aa10` case 0), with a
//     literal 1 — so the card runs on EVERY field-stage entry, always with the
//     names shown.
//   * `F0x80087974` is its per-frame callback. Case 0 copies the ten bar
//     templates from `0x80097458` into the object at +0x50 and calls
//     `F0x800875ac`, which looks the current scene id up in the name table at
//     `0x80097098` and builds two class-A text widgets:
//         F0x8001ae38(0x1003, 1, 0x80, 0x1A)  -> area name at (128, 26)
//         F0x8001ae38(0x1003, 1, 0x28, 0x44)  -> place name at (40, 68)
//     each followed by `unk130(widget, 5)` — `F0x8001a1b8`, which arms the
//     typewriter reveal with a delay of 5.
//   * The reveal itself is `F0x8001ac14`: `unkA8 += 1` every frame, and when
//     `unkAA < unkA8` one more character appears and the counter resets. With
//     the delay at 5 that is ONE CHARACTER EVERY SIX FRAMES. `unk168`
//     (`F0x8001a460`) reports `unkC3`, the "reached the end of the string" flag.
//   * Case 1 walks a five-step sub-state that switches the bars on in groups
//     and waits for one bar of each group to settle (the offsets it writes,
//     0x50/0x104/0x170/0x194/0x128/0x74/0x98/0x14C/0xBC/0xE0, are exactly the
//     ten records at +0x50 + i*0x24). Step 4 waits for both text widgets.
//   * Case 2 does NOTHING until somebody sets its sub-state to 1. The card
//     parks there, fully drawn, and the field releases it: `F0x8008aa10` keeps
//     the card's handle and, once its own entry sequence is finished, runs
//     `if (card->unkC == 2) card->unk2C(card, 1)` — set sub-state 1. Only then
//     does the card hold until `obj+0x14` reaches 0x3C, set the clip rectangle
//     of widget group 0x1003 to (0, 0, 320, 240), and close it by y += 8 and
//     h -= 0x10 per frame until the height is zero.
//   * Case 3 clears `0x80099DD4`, and the draw tail only runs for cases 1 and
//     2, so the bars vanish with the slit.
//   * Each bar is drawn by `F0x80087854` as a single GP0 0x28 flat quad —
//     an untextured solid rectangle in the record's own colour.
//   * `F0x80087704` is the bar animator: case 1 moves the record's x and width,
//     case 2 its y and height, each edge stepping independently toward its
//     target and clamping there; when both edges have arrived it writes 0 to
//     the record's axis field, which is what the sub-state waits on.
//
// The bar templates and the name table are DATA and come from
// web/assets/data/place_card.json (tools/extract_place_card.py). Everything in
// this file is the CODE half.
//
// NOT ESTABLISHED: whether the closing slit clips the bars as well as the text.
// The rectangle is set on widget group 0x1003 and both the labels and the bar
// primitives name that group, so this module clips both; the alternative — bars
// drawn outside the group's clip and popping off at the end — was not ruled
// out.

/** One bar template, exactly as it ships in the overlay. */
export interface LocationBarTemplate {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Flat quad colour, [r, g, b] straight out of the GP0 packet. */
  color: [number, number, number];
  /** 1 = animate x and width, 2 = animate y and height, 0 = settled. */
  axis: number;
  /** Target near edge (left or top). */
  near: number;
  /** Target far edge (right or bottom). */
  far: number;
  /** Pixels per frame. */
  step: number;
}

/** A bar as it should be drawn this frame. */
export interface LocationBarRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: [number, number, number];
}

/** A label as it should be drawn this frame. */
export interface LocationLabel {
  x: number;
  y: number;
  /** The revealed prefix — the typewriter has not written the rest yet. */
  text: string;
}

export interface LocationCardFrame {
  bars: LocationBarRect[];
  area: LocationLabel;
  place: LocationLabel;
  /** Everything the card draws is clipped to this rectangle. */
  clip: { x: number; y: number; w: number; h: number };
  /** True once the slit has closed; the card draws nothing more. */
  done: boolean;
}

// ── constants read out of the code ─────────────────────────────────────────

/** `F0x8001ae38(0x1003, 1, 0x80, 0x1A)` — the area name. */
export const AREA_LABEL_POS = { x: 0x80, y: 0x1a };
/** `F0x8001ae38(0x1003, 1, 0x28, 0x44)` — the place name. */
export const PLACE_LABEL_POS = { x: 0x28, y: 0x44 };
/** `unk130(widget, 5)`: one character every REVEAL_DELAY + 1 frames. */
export const REVEAL_DELAY = 5;
/** `obj->unk14 >= 0x3C` — the hold once both names are on screen. */
export const HOLD_FRAMES = 0x3c;
/** The clip rectangle the closing slit starts from. */
export const WIPE_RECT = { x: 0, y: 0, w: 0x140, h: 0xf0 };
/** `unk1BA += 8` — the top edge of the slit, per frame. */
export const WIPE_TOP_STEP = 8;
/** `unk1BE -= 0x10` — the slit's height, per frame. */
export const WIPE_HEIGHT_STEP = 0x10;

/**
 * Which bars each sub-state switches on, in the order case 1 writes them.
 * Sub-state 2 enables nothing and falls straight through, exactly as the
 * original does.
 */
export const BAR_GROUPS: readonly (readonly number[])[] = [
  [0, 5],
  [8, 9, 6, 1, 2, 7, 3],
  [],
  [4],
];

/**
 * The bar each sub-state waits to settle before moving on — obj+0x114, +0x1A4
 * and +0xF0 are records 5, 9 and 4's axis fields. `null` means the sub-state
 * advances on the same frame it is entered.
 */
export const BAR_WAITS: readonly (number | null)[] = [5, 9, null, 4];

// ── state ──────────────────────────────────────────────────────────────────

interface LiveBar extends LocationBarTemplate {
  enabled: boolean;
}

interface LiveLabel {
  text: string;
  revealed: number;
  tick: number;
}

export interface LocationCardState {
  bars: LiveBar[];
  area: LiveLabel;
  place: LiveLabel;
  /**
   * `obj+0xC`. 1 = bars sliding in and names typing, 2 = parked, then hold and
   * wipe once the field releases it, 3 = finished.
   */
  phase: number;
  /** `obj+0x10`, the sub-state within the phase. */
  step: number;
  /** The hold counter, obj+0x14. */
  hold: number;
  clip: { x: number; y: number; w: number; h: number };
}

/**
 * Build a card for one arrival. `bars` is the ten-record template block from
 * place_card.json; it is copied, never mutated.
 */
export function createLocationCard(
  bars: readonly LocationBarTemplate[],
  areaText: string,
  placeText: string,
): LocationCardState {
  return {
    bars: bars.map((b) => ({ ...b, color: [...b.color] as [number, number, number], enabled: false })),
    area: { text: areaText, revealed: 0, tick: 0 },
    place: { text: placeText, revealed: 0, tick: 0 },
    phase: 1,
    step: 0,
    hold: 0,
    clip: { ...WIPE_RECT },
  };
}

function labelFinished(l: LiveLabel): boolean {
  return l.revealed >= l.text.length;
}

/** `F0x8001ac14`'s reveal counter. */
function stepLabel(l: LiveLabel): void {
  if (REVEAL_DELAY <= 0 || labelFinished(l)) return;
  l.tick += 1;
  if (REVEAL_DELAY < l.tick) {
    l.tick = 0;
    l.revealed += 1;
  }
}

/** `F0x80087704` — one edge-pair step of one bar. */
function stepBar(b: LiveBar): void {
  if (b.axis !== 1 && b.axis !== 2) return;
  let pos = b.axis === 1 ? b.x : b.y;
  const size = b.axis === 1 ? b.w : b.h;
  let end = pos + size;

  if (pos < b.near) {
    pos += b.step;
    if (b.near < pos) pos = b.near;
  } else if (b.near < pos) {
    pos -= b.step;
    if (pos < b.near) pos = b.near;
  }
  if (end < b.far) {
    end += b.step;
    if (b.far < end) end = b.far;
  } else if (b.far < end) {
    end -= b.step;
    if (end < b.far) end = b.far;
  }

  if (b.axis === 1) {
    b.x = pos;
    b.w = end - pos;
  } else {
    b.y = pos;
    b.h = end - pos;
  }
  if (pos === b.near && end === b.far) b.axis = 0;
}

/**
 * Advance the card by one 60 Hz frame — the state machine first, then the bar
 * animation, which is the order `F0x80087974` runs them in.
 */
export function stepLocationCard(st: LocationCardState): void {
  if (st.phase >= 3) return;

  if (st.phase === 1) {
    // Case 1's sub-states fall through into one another, so a group whose bar
    // has already settled hands straight on to the next group in the same
    // frame. Sub-state 3 does not fall into 4 — it breaks.
    for (let group = BAR_GROUPS[st.step]; group; group = BAR_GROUPS[st.step]) {
      for (const i of group) {
        const bar = st.bars[i];
        if (bar) bar.enabled = true;
      }
      const waitOn = BAR_WAITS[st.step] ?? null;
      if (waitOn !== null && st.bars[waitOn]?.axis !== 0) break;
      st.step += 1;
    }
    if (st.step >= BAR_GROUPS.length
      && labelFinished(st.area) && labelFinished(st.place)) {
      // `unk28(obj, 2)` — state 2, sub-state back to 0. The card now waits.
      st.phase = 2;
      st.step = 0;
      st.hold = 0;
    }
  } else if (st.phase === 2 && st.step === 1) {
    st.hold += 1;
    if (st.hold >= HOLD_FRAMES) {
      st.step = 3;
      st.clip = { ...WIPE_RECT };
      closeSlit(st);
    }
  } else if (st.phase === 2 && st.step >= 2) {
    closeSlit(st);
  }

  stepLabel(st.area);
  stepLabel(st.place);
  if (st.phase === 1 || st.phase === 2) {
    for (const b of st.bars) if (b.enabled) stepBar(b);
  }
}

/**
 * The field's own release — `if (card->unkC == 2) card->unk2C(card, 1)` in
 * `F0x8008aa10`. Until this runs the finished card just sits on screen, which
 * is how it covers a slow stage load. Harmless to call every frame.
 */
export function releaseLocationCard(st: LocationCardState): boolean {
  if (st.phase !== 2 || st.step !== 0) return false;
  st.step = 1;
  st.hold = 0;
  return true;
}

function closeSlit(st: LocationCardState): void {
  st.clip.y += WIPE_TOP_STEP;
  st.clip.h -= WIPE_HEIGHT_STEP;
  if (st.clip.h <= 0) {
    st.clip.h = 0;
    st.phase = 3;
  }
}

/**
 * The render model for the current frame.
 *
 * `bars` comes back BACK TO FRONT — record 9 first, record 0 last. The bars
 * overlap in threes: a wide navy panel, a blue bar inside it and a one- or
 * two-pixel cyan rule inside that, and the rule is the higher-numbered record
 * in none of those trios (0 over 5, 1 over 6 over 9, 2 over 7). Painting in
 * record order would bury every accent line. This is read off what has to be
 * visible, not off a decoded z-order: the draw loop hands all ten to the same
 * primitive linker in record order, and which end of its list the hardware
 * rasterises first was not established.
 */
export function locationCardFrame(st: LocationCardState): LocationCardFrame {
  const done = st.phase >= 3;
  return {
    bars: done
      ? []
      : st.bars
          .filter((b) => b.enabled)
          .reverse()
          .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, color: [...b.color] as [number, number, number] })),
    area: {
      ...AREA_LABEL_POS,
      text: done ? "" : st.area.text.slice(0, st.area.revealed),
    },
    place: {
      ...PLACE_LABEL_POS,
      text: done ? "" : st.place.text.slice(0, st.place.revealed),
    },
    clip: { ...st.clip },
    done,
  };
}

/** True while the card is still on screen. */
export function locationCardActive(st: LocationCardState): boolean {
  return st.phase < 3;
}
