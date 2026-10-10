// engine/systems/card-animation.ts — the card duel's sprite animation system.
//
// Decoded 2026-08-05 from pro/cardgame.s; see
// docs/research/card/cardduel-animation-decoded-2026-08-05.md. This is the
// whole of the duel board's card motion, and it is a real state machine in the
// original, not a set of ad-hoc tweens:
//
//   F0x8009bac8  steps all 40 pooled 0x4C-byte card sprites every frame and
//                then draws them in two layer passes.
//   F0x8009b890  is the per-sprite step: a switch on the sprite's `unk42`
//                animation state. The switch compiles to the 12-entry jump
//                table at 0x80083748, whose entries for states 2 and 3 are the
//                same word — which is how we know those two share an animator
//                rather than merely looking alike in the decompilation.
//   F0x8009c510..F0x8009ce94  are the commands that START each animation: one
//                entry point per state, each setting the destination fields and
//                then the state byte.
//
// Units, matching the original exactly:
//   * positions are 8.8 fixed point (`>> 8` for pixels)
//   * scales are 12.4 with ONE = 0x1000, and the renderer multiplies only the
//     source crop by them
//   * durations are in frames, counted with the resident per-frame delta
//     (*0x8004DF9C)(); `dt` below is that delta.
//
// Integer division is C truncation-toward-zero throughout, and the odd-looking
// pre-shift bias terms (`+ 7` before `>> 3`, `+ 0xF` before `>> 4`) are the
// compiler's own arithmetic-shift-as-division rounding, reproduced rather than
// simplified — dropping them shifts the shake by a fraction of a pixel on
// negative half-cycles.
//
// NOT decoded, and therefore not encoded here: which duel event starts which
// animation. The commands are all decoded, but no `jal` or pointer-table entry
// in the original reaches the row-layout helper 0x8009CE94, so the calling
// sites that choose "deal plays a move, a lost battle plays a shake" are not
// traced. Callers of this module pick that mapping themselves.

/** Scale value meaning 1.0 (12.4 fixed point), the original's 0x1000. */
export const SCALE_ONE = 0x1000;

/** Animation states, the values of the sprite's `unk42`. Names are ours; the
 * numbering and the count are the original's jump table at 0x80083748. */
export const CardAnimState = {
  hidden: 0,
  idle: 1,
  move: 2,
  moveSilent: 3,
  flip: 4,
  summon: 5,
  shakeXY: 6,
  shakeX: 7,
  hold: 8,
  effectLong: 9,
  effectShort: 10,
  settle: 11,
} as const;
export type CardAnimStateValue =
  (typeof CardAnimState)[keyof typeof CardAnimState];

/** Render kinds, the sprite's `unk45`, switched on by the face drawer
 * F0x8009b168.
 *
 * The flip XORs this field with 3, and that pins down what the kinds ARE. The
 * XOR pairs 1 with 2, so kind 2 — card-sheet clip 0x10 — is the REVERSE of a
 * Digimon card face, not a separate card type: turning a card over is the only
 * thing a mid-flip swap can mean. (It also sends kind 3 to 0, i.e. flipping a
 * kind-3 sprite makes it vanish, which is why kind 3 is treated as a standalone
 * kind here rather than as anyone's reverse.)
 *
 * This corrects the provisional labels from the 2026-08-05 screen decode, which
 * guessed 2 = "program" and 3 = "back" from clip content alone with nothing to
 * tie them together. */
export const CardRenderKind = {
  none: 0,
  digimon: 1,
  reverse: 2,
  alt: 3,
} as const;

/** One pooled card sprite: the original's 0x4C-byte object, field for field.
 * The `_` names keep the decoded offsets visible at the use site. */
export interface CardSprite {
  /** +0x00 / +0x04, 8.8 */
  x: number;
  y: number;
  /** +0x08 / +0x0C — where the current tween is heading */
  destX: number;
  destY: number;
  /** +0x10 / +0x14 — where it started, and the rest position the shakes
   * return to */
  startX: number;
  startY: number;
  /** +0x18 / +0x1A, 12.4 */
  scaleX: number;
  scaleY: number;
  /** +0x1C / +0x1E */
  destScaleX: number;
  destScaleY: number;
  /** +0x20 / +0x22 */
  startScaleX: number;
  startScaleY: number;
  /** +0x24 — the sprite's slot index in the 40-entry pool */
  slot: number;
  /** +0x26 — draw-order flag. F0x8009bac8 runs two passes: sprites with a
   * non-zero value draw first (behind), zero draws second (in front). */
  layer: number;
  /** +0x28 — counts DOWN for the move tween and UP for every other state */
  timer: number;
  /** +0x2C — the tween length; doubles as the counter for `settle` */
  duration: number;
  /** +0x30 — the summon's separate intro countdown */
  introTimer: number;
  /** +0x42 */
  state: number;
  /** +0x45 */
  renderKind: number;
  /** +0x46 — badge clip index; its player-facing meaning is NOT decoded */
  badge: number;
  /** +0x47 — which of the four effect clip runs plays over the card */
  effect: number;
  /** +0x48 — flag bits set by the summon intro */
  flags: number;
}

/** What one step did, so a caller can react without reading state bytes. */
export interface CardStepResult {
  /** the sprite is mid-animation (the original ORs 1 into the screen's
   * `unk54` for exactly these states) */
  busy: boolean;
  /** this step finished an animation */
  finished: boolean;
  /** the summon reached its apex and handed over to its return leg (the
   * original ORs 2 into `unk54` here) */
  summonLanded: boolean;
  /** a sound the original plays at this instant, by its argument value */
  sfx: number | null;
}

// ---------------------------------------------------------------------------
// rsin
// ---------------------------------------------------------------------------
// The console's signed sine now lives in engine/dw3/rsin.ts, because the title
// screen's dim reads the same table. Its approximation note travelled with it.
import { rsin } from "../dw3/rsin.ts";
export { rsin };

/** C integer division: truncate toward zero, as the MIPS `div` does. */
function idiv(n: number, d: number): number {
  return d === 0 ? 0 : Math.trunc(n / d);
}

// ---------------------------------------------------------------------------
// decoded constants
// ---------------------------------------------------------------------------

/** The x-shake offset table at 0x800A5AC8, 8 signed halfwords indexed `& 7`,
 * in 8.8. */
export const SHAKE_X_TABLE = [-256, 768, -768, 256, -1024, 512, -512, 1024];

/** The xy-shake offset table at 0x800A5AD0. It OVERLAPS the one above by four
 * halfwords — 0x800A5AC8 + 8 == 0x800A5AD0 — so this table's first four
 * entries are that one's last four. Its own last four are copied verbatim
 * rather than trimmed to the "nice" values: the index is masked `& 7`, so the
 * original really does read all eight, giving a shake that swings and then
 * sits still for four frames. */
export const SHAKE_XY_TABLE = [-1024, 512, -512, 1024, 12, 0, 28, 0];

/** Sound argument values, by the animation that plays them. Their player-facing
 * identities are not decoded; these are the literal arguments passed to the
 * resident player at (*0x80055C48)(). */
export const CARD_SFX = {
  moveEnd: 0x800460BD,
  moveStart: 0x8004603C,
  flip: 0x8004613E,
  shake: 0x009C0003,
  hold: 0x00040014,
  settle: 0x0004001C,
} as const;

const FLIP_DURATION = 0xC;
const FLIP_SWAP_AT = 7;
export const SHAKE_DURATION = 0xC;
const HOLD_DURATION = 0xA;
const SETTLE_DURATION = 0xB;
const EFFECT_LONG_DURATION = 0x24;
const EFFECT_SHORT_DURATION = 0x1C;
const SUMMON_INTRO_SCALE = 0x1C00;
const SUMMON_INTRO_STEP = 0xC0;
const SUMMON_REST_SCALE = 0x1200;
const SUMMON_ARC = 0x1C00;

// ---------------------------------------------------------------------------
// the fan-out
// ---------------------------------------------------------------------------

/** F0x80098864: the x offset of card `index` in a row of `count`.
 *
 * Up to six cards the pitch is a flat 0x2900 (41.0 px). From seven the row is
 * squeezed into a fixed 0xF600 (246.0 px) total, so the cards overlap instead
 * of running off the board. */
export function cardFanOut(count: number, index: number): number {
  const pitch = count < 7 ? 0x2900 : idiv(0xF600, count);
  return pitch * index;
}

/** The board's geometry and the deal's timing, recovered from the 2026-08-05
 * rig captures rather than from the overlay — the row-layout helper 0x8009CE94
 * has no identified caller, so these were never legible statically.
 * See docs/research/card/cardduel-choreography-2026-08-06.md and the claims
 * cardduel-board-rows-38-97-156, cardduel-deal-enters-from-offscreen-right,
 * cardduel-flip-wave-follows-last-landing and
 * cardduel-opponent-hand-dealt-then-collapsed.
 *
 * All values are whole pixels; the sprites carry position as 8.8 fixed point. */
export const DUEL_BOARD = {
  /** Both hand rows start here and step by the 41px cardFanOut pitch. */
  rowX: 24,
  /** The opponent's hand. */
  oppHandY: 38,
  /** The single shared centre row. There is no per-player field row. */
  centreY: 97,
  /** The player's hand. */
  handY: 156,
  /** Six slots per hand: x = 24, 65, 106, 147, 188, 229. */
  handSlots: 6,
  /** The persistent centre card. */
  centreX: 81,
  /** The static board-slot table at 0x800A5978, which lies on the centre row. */
  boardSlots: [[73, 97], [123, 97], [173, 97]] as const,
} as const;

/** The deal: a card starts off the right edge of the 320px screen, already on
 * its destination row's y, and crosses in DEAL_DURATION frames while growing
 * from nothing. Card `i` starts DEAL_STAGGER frames after card `i - 1`. */
export const DEAL_START_X = 352;
export const DEAL_DURATION = 20;
export const DEAL_STAGGER = 6;

/** The flip wave that follows: it begins only once the LAST card has landed,
 * then runs one card at a time in the same stagger. */
export const DEAL_FLIP_STAGGER = DEAL_STAGGER;

/** A pile animation's length scales with how many cards the pile holds:
 * F0x8009DF68 takes the count from the side's counter at +0x5A6 / +0x5A2 /
 * +0x5A4 (selected by the caller's code 0, 1 or 2) and sets the duration to
 * `count * 4 + 10` — ten units of fixed overhead plus four per card, so a full
 * six-card pile runs 34 and an empty one still runs 10.
 *
 * This governs the PILE widget only. It must not be applied to the deal, whose
 * DEAL_DURATION / DEAL_STAGGER above are authority-1 rig captures of a
 * different animation.
 * — cardgame-pile-animation-duration-scales-with-count */
export const PILE_OVERHEAD = 10;
export const PILE_PER_CARD = 4;
/** The pile FAN widget's whole window: `count` cards revealed one every
 *  `PILE_PER_CARD` frames, each over PILE_OVERHEAD frames, so the last card's
 *  tween ends here (F0x8009DBE8/F0x8009DF68 write count*4+10 into duel+0x4D8).
 *  NOT a HUD deck/trash pile lift: the widget is the centre-row fan a pile
 *  picker shows (claim `pile-fan-reveals-one-card-every-four-frames-2026-09-14`
 *  correction). */
export function pileAnimDuration(count: number): number {
  return Math.max(0, count) * PILE_PER_CARD + PILE_OVERHEAD;
}

// ---- the two-sided banner slide (F0x80099440) -------------------------------
// One side's name banner sliding on and off. The function picks between two
// hard-coded coordinate sets by its side argument and interpolates linearly on
// a countdown timer. Decoded from exe-decomp/cardgame_c/F0x80099440.c.
//
// Three of the fields it lerps have IDENTICAL endpoints in both coordinate sets
// (0x8F->0x8F and 0x50->0x50 for the hold axis, T->T for the tail, 0->0 for the
// cross axis), so they are constants, not animation. What actually moves is the
// slide axis and a pair — an edge and an extent — that always travel together
// by exactly 0x27.
// — cardgame-f80099440-is-the-two-sided-banner-slide

/** Per-side endpoints. Side 0 travels 0x8D -> 0xF1 and side 1 travels
 *  0 -> -0x64: both cover 0x64 but in opposite senses, which is why the two
 *  players' banners enter from opposite directions instead of mirroring. */
export const BANNER_SIDES = [
  { shown: 0x8d, hidden: 0xf1, hold: 0x8f, tail: 0xbd },
  { shown: 0x00, hidden: -0x64, hold: 0x50, tail: 0x26 },
] as const;

/** The edge/extent pair, shared by both sides and 0x27 apart. */
export const BANNER_EDGE_SHOWN = 0x120;
export const BANNER_EDGE_HIDDEN = 0x147;
export const BANNER_EXTENT_SHOWN = 0x113;
export const BANNER_EXTENT_HIDDEN = 0x13a;

export const BannerPhase = {
  idle: 0,
  slideIn: 1,
  shown: 2,
  slideOut: 3,
  /** 4 and 5 move the slide axis only, holding edge/extent at their hidden
   *  values — the variants used when the banner's plate is already parked. */
  slideInFlat: 4,
  slideOutFlat: 5,
} as const;

export interface BannerSlide {
  phase: number;
  /** counts DOWN to zero; the interpolation arrives at its destination at 0 */
  t: number;
  duration: number;
  /** set when a slide-out completes, consumed on the next step */
  done: boolean;
  pos: number;
  edge: number;
  extent: number;
  hold: number;
  tail: number;
}

export function createBannerSlide(side: 0 | 1): BannerSlide {
  const p = BANNER_SIDES[side];
  return {
    phase: BannerPhase.idle,
    t: 0,
    duration: 0,
    done: false,
    pos: p.hidden,
    edge: BANNER_EDGE_HIDDEN,
    extent: BANNER_EXTENT_HIDDEN,
    hold: p.hold,
    tail: p.tail,
  };
}

/** The original's lerp: `start - ((start - end) * t) / duration`, with t running
 *  down from `duration` to 0 so the value arrives at `start`. C integer
 *  division truncates toward zero, so this uses Math.trunc, not Math.floor. */
function bannerLerp(start: number, end: number, t: number, duration: number): number {
  if (duration === 0) return start;
  return start - Math.trunc(((start - end) * t) / duration);
}

export function startBannerSlide(
  b: BannerSlide, phase: number, duration: number,
): void {
  b.phase = phase;
  b.duration = duration;
  b.t = duration;
}

/** Advance one banner by `delta` timer units (the resident frame delta). */
export function stepBannerSlide(b: BannerSlide, side: 0 | 1, delta = 1): void {
  const p = BANNER_SIDES[side];
  // The entry guard consumes a finished flag before doing anything else.
  if (b.phase === BannerPhase.idle && b.done) b.done = false;

  const moving = b.phase === BannerPhase.slideIn || b.phase === BannerPhase.slideOut
    || b.phase === BannerPhase.slideInFlat || b.phase === BannerPhase.slideOutFlat;
  if (!moving) return;

  const flat = b.phase === BannerPhase.slideInFlat || b.phase === BannerPhase.slideOutFlat;
  const going = b.phase === BannerPhase.slideIn || b.phase === BannerPhase.slideInFlat;

  // The flat variants park the plate at its hidden edge for the whole move.
  if (flat) {
    b.edge = BANNER_EDGE_HIDDEN;
    b.extent = BANNER_EXTENT_HIDDEN;
  }

  b.t -= delta;
  if (b.t > 0) {
    const [from, to] = going ? [p.shown, p.hidden] : [p.hidden, p.shown];
    b.pos = bannerLerp(from, to, b.t, b.duration);
    if (!flat) {
      const [eFrom, eTo] = going
        ? [BANNER_EDGE_SHOWN, BANNER_EDGE_HIDDEN]
        : [BANNER_EDGE_HIDDEN, BANNER_EDGE_SHOWN];
      const [xFrom, xTo] = going
        ? [BANNER_EXTENT_SHOWN, BANNER_EXTENT_HIDDEN]
        : [BANNER_EXTENT_HIDDEN, BANNER_EXTENT_SHOWN];
      b.edge = bannerLerp(eFrom, eTo, b.t, b.duration);
      b.extent = bannerLerp(xFrom, xTo, b.t, b.duration);
    }
    return;
  }

  // Expiry snaps to the exact destination and hands over to the next phase.
  b.t = 0;
  b.duration = 0;
  if (going) {
    b.phase = BannerPhase.shown;
    b.pos = p.shown;
    if (!flat) {
      b.edge = BANNER_EDGE_SHOWN;
      b.extent = BANNER_EXTENT_SHOWN;
    }
  } else {
    b.phase = BannerPhase.idle;
    b.done = true;
    b.pos = p.hidden;
    if (!flat) {
      b.edge = BANNER_EDGE_HIDDEN;
      b.extent = BANNER_EXTENT_HIDDEN;
    }
  }
}

/** An opponent hand card is never flipped. After landing it squeezes edge-on
 * over this many frames and stays zero-width for the rest of the duel. */
export const HAND_COLLAPSE_DURATION = 5;

/** The in-place reveal (cardduel-row-reveal-is-a-ten-frame-scale-ramp): a row
 * is turned face-on where it stands by ramping sx to unity over ten frames with
 * sy held, cards starting about three frames apart. */
export const REVEAL_DURATION = 10;
export const REVEAL_STAGGER = 3;

/** The centre-row pile fan/reveal's own cadence (claim
 *  `pile-fan-reveals-one-card-every-four-frames-2026-09-14`). When a pile
 *  picker shows a pile, every card is placed edge-on at its final fan position
 *  and card `i` ramps sx 0 -> 1 over `REVEAL_DURATION` frames starting at
 *  `i * PILE_REVEAL_STAGGER`; the whole window is `pileAnimDuration(count)`.
 *  This is the pile widget's `+0x4D0` cadence (F0x8009E668: a card may start
 *  only once `+0x4D0 >= 4`, which is then reduced by 4), not the row reveal's
 *  three. The collapse family uses HAND_COLLAPSE_DURATION instead. */
export const PILE_REVEAL_STAGGER = 4;

/** Start the in-place reveal on one card.
 *
 * This drives it through the decoded scale-tween command 0x8009C898, whose
 * position lerp is skipped because the destination is the current position, so
 * the on-screen result is the captured ramp exactly. Note the capture shows the
 * original holding state 45 = 1 throughout, whereas 0x8009C898 sets state 2 —
 * whatever the original issues here is a command we have not identified, and
 * only its visible effect is reproduced. */
export function revealCard(s: CardSprite): void {
  s.scaleX = 0;
  s.scaleY = SCALE_ONE;
  scaleCard(s, REVEAL_DURATION, SCALE_ONE, SCALE_ONE);
}

/** Where card `i` of a `count`-card row sits, in 8.8 fixed point. */
export function cardRowSlot(rowY: number, count: number, index: number): [number, number] {
  return [(DUEL_BOARD.rowX << 8) + cardFanOut(count, index), rowY << 8];
}

// ---------------------------------------------------------------------------
// commands — one per animation, mirroring 0x8009C510..0x8009CE94
// ---------------------------------------------------------------------------

/** F0x8009c510: build a sprite at rest. The original memsets the whole 0x4C
 * bytes first, so every field not named here starts at zero. */
export function createCardSprite(slot: number, x: number, y: number): CardSprite {
  return {
    x, y,
    destX: 0, destY: 0,
    startX: 0, startY: 0,
    scaleX: SCALE_ONE, scaleY: SCALE_ONE,
    destScaleX: SCALE_ONE, destScaleY: SCALE_ONE,
    startScaleX: 0, startScaleY: 0,
    slot,
    layer: 0,
    timer: 0,
    duration: 0,
    introTimer: 0,
    state: CardAnimState.idle,
    renderKind: CardRenderKind.digimon,
    badge: 0,
    effect: 0,
    flags: 0,
  };
}

/** 0x8009CDFC: take the sprite off the board entirely. */
export function despawnCard(s: CardSprite): void {
  s.state = CardAnimState.hidden;
  s.renderKind = CardRenderKind.none;
}

/** 0x8009C9A0 (audible) and 0x8009CA3C (silent): tween the card to (destX,
 * destY) over `duration` frames. The silent form is state 3, which differs from
 * state 2 only in that it does not play the landing sound.
 *
 * `scaleFrom` arms the scale ramp that stepMove already lerps alongside the
 * position: the card starts at that scale on both axes and reaches full size
 * exactly as it lands. The deal issues its move this way — run 2 slot 00 logs
 * sx = sy = 205, 410, 615, 1024 against timer 19, 18, 17, 15 of dur 20, which is
 * 0x1000 * (dur - timer) / dur from zero (cardduel-deal-enters-from-offscreen-
 * right). */
export function moveCard(
  s: CardSprite, duration: number, destX: number, destY: number,
  opts: { silent?: boolean; scaleFrom?: number } = {},
): void {
  s.state = opts.silent ? CardAnimState.moveSilent : CardAnimState.move;
  s.destX = destX;
  s.destY = destY;
  s.startX = s.x;
  s.startY = s.y;
  s.duration = duration;
  s.timer = duration;
  if (opts.scaleFrom !== undefined) {
    s.scaleX = opts.scaleFrom;
    s.scaleY = opts.scaleFrom;
    s.startScaleX = opts.scaleFrom;
    s.startScaleY = opts.scaleFrom;
    s.destScaleX = SCALE_ONE;
    s.destScaleY = SCALE_ONE;
  }
}

/** 0x8009C898: tween the card's SCALE, leaving its position alone (the command
 * sets the destination to the current position so the position lerp is skipped).
 * With `hold` the destination scale is armed without starting the tween. */
export function scaleCard(
  s: CardSprite, duration: number, destScaleX: number, destScaleY: number,
  opts: { hold?: boolean } = {},
): void {
  s.destScaleX = destScaleX;
  s.destScaleY = destScaleY;
  s.startScaleX = s.scaleX;
  s.startScaleY = s.scaleY;
  if (opts.hold) return;
  s.duration = duration;
  s.timer = duration;
  s.state = CardAnimState.move;
  s.layer = 1;
  s.destX = s.x;
  s.destY = s.y;
}

/** 0x8009C5D8: flip the card over. Half way through, the render kind is XORed
 * with 3, turning a face into its back and back again. */
export function flipCard(s: CardSprite): void {
  s.state = CardAnimState.flip;
  s.timer = 0;
  s.duration = 0;
  s.scaleX = SCALE_ONE;
  s.scaleY = SCALE_ONE;
  s.layer = 0;
}

/** 0x8009C654 (both axes) and 0x8009C6E8 (x only): the hit shakes. Both run
 * effect clip run 1 over the card while they play. */
export function shakeCard(s: CardSprite, opts: { bothAxes?: boolean } = {}): void {
  s.state = opts.bothAxes ? CardAnimState.shakeXY : CardAnimState.shakeX;
  s.timer = 0;
  s.duration = 0;
  s.effect = 1;
  s.layer = 0;
  s.startX = s.x;
  s.startY = s.y;
  if (opts.bothAxes) {
    s.scaleX = SCALE_ONE;
    s.scaleY = SCALE_ONE;
  }
}

/** 0x8009C770: hold for 10 frames under effect run 2, then settle. */
export function holdCard(s: CardSprite): void {
  s.state = CardAnimState.hold;
  s.timer = 0;
  s.duration = 0;
  s.effect = 2;
  s.layer = 0;
  s.startX = s.x;
  s.startY = s.y;
}

/** 0x8009C7F8: play one of the two long-form effect runs over the card —
 * run 3 for 0x24 frames, or run 4 for 0x1C when `short` is set. The durations
 * are exactly the end points of those two clip runs. */
export function playCardEffect(s: CardSprite, opts: { short?: boolean } = {}): void {
  if (opts.short) {
    s.state = CardAnimState.effectShort;
    s.effect = 4;
  } else {
    s.state = CardAnimState.effectLong;
    s.effect = 3;
  }
  s.timer = 0;
  s.duration = 0;
  s.layer = 0;
  s.startX = s.x;
  s.startY = s.y;
}

/** 0x8009CE28: the settle state on its own — an 11-frame tail during which the
 * active border cycles its CLUT rows. */
export function settleCard(s: CardSprite): void {
  s.state = CardAnimState.settle;
  s.timer = 0;
  s.duration = 0;
}

/** 0x8009CA80: the summon. Grows the card in over `intro` frames, arcs it to
 * its destination, then runs a slower return leg that settles it flat. */
export function summonCard(
  s: CardSprite, duration: number, destX: number, destY: number,
  opts: { intro?: number } = {},
): void {
  s.state = CardAnimState.summon;
  s.destX = destX;
  s.destY = destY;
  s.startX = s.x;
  s.startY = s.y;
  s.duration = duration;
  s.timer = duration;
  s.introTimer = opts.intro ?? 0;
  s.layer = 0;
}

// ---------------------------------------------------------------------------
// the step — F0x8009b890's switch, state for state
// ---------------------------------------------------------------------------

const NOTHING: CardStepResult = {
  busy: false, finished: false, summonLanded: false, sfx: null,
};

/**
 * Advance one card sprite by `dt` frames.
 *
 * `frame` is the global frame counter the original reads from (*0x8004DC0C)();
 * only the both-axes shake uses it, for its vertical jitter, which is why that
 * shake is not a pure function of the sprite's own timer.
 */
export function stepCardSprite(
  s: CardSprite, dt = 1, frame = 0,
): CardStepResult {
  switch (s.state) {
    case CardAnimState.hidden:
      s.renderKind = CardRenderKind.none;
      return NOTHING;

    case CardAnimState.move:
    case CardAnimState.moveSilent:
      return stepMove(s, dt);

    case CardAnimState.flip:
      return stepFlip(s, dt);

    case CardAnimState.summon:
      return stepSummon(s, dt);

    case CardAnimState.shakeXY:
      return stepShake(s, dt, frame, true);

    case CardAnimState.shakeX:
      return stepShake(s, dt, frame, false);

    case CardAnimState.hold:
      return stepTimed(s, dt, HOLD_DURATION, CardAnimState.settle);

    case CardAnimState.effectLong:
      return stepTimed(s, dt, EFFECT_LONG_DURATION, CardAnimState.idle);

    case CardAnimState.effectShort:
      return stepTimed(s, dt, EFFECT_SHORT_DURATION, CardAnimState.idle);

    case CardAnimState.settle: {
      // The original counts this one in `duration`, not `timer` — and the
      // active border's CLUT row is (duration / 2) % 5, so the field the
      // counter lives in is load-bearing for the visuals, not incidental.
      s.duration += dt;
      if (s.duration >= SETTLE_DURATION) {
        s.state = CardAnimState.idle;
        return { busy: true, finished: true, summonLanded: false, sfx: null };
      }
      return { busy: true, finished: false, summonLanded: false, sfx: null };
    }

    default:
      return NOTHING;
  }
}

/** F0x80099ffc — the linear tween shared by states 2 and 3. */
function stepMove(s: CardSprite, dt: number): CardStepResult {
  s.timer -= dt;
  if (s.timer > 0) {
    if (s.x !== s.destX || s.y !== s.destY) {
      s.x = s.destX - idiv((s.destX - s.startX) * s.timer, s.duration);
      s.y = s.destY - idiv((s.destY - s.startY) * s.timer, s.duration);
    }
    if (s.scaleX !== s.destScaleX) {
      s.scaleX = s.destScaleX
        - idiv((s.destScaleX - s.startScaleX) * s.timer, s.duration);
      s.scaleY = s.destScaleY
        - idiv((s.destScaleY - s.startScaleY) * s.timer, s.duration);
    }
    return { busy: true, finished: false, summonLanded: false, sfx: null };
  }
  const silent = s.state === CardAnimState.moveSilent;
  s.state = CardAnimState.idle;
  s.timer = 0;
  s.duration = 0;
  s.x = s.destX;
  s.y = s.destY;
  s.scaleX = s.destScaleX;
  s.scaleY = s.destScaleY;
  if (s.flags === 0) s.layer = 0;
  return {
    busy: true, finished: true, summonLanded: false,
    sfx: silent ? null : CARD_SFX.moveEnd,
  };
}

/** F0x8009a75c — the flip. */
function stepFlip(s: CardSprite, dt: number): CardStepResult {
  s.scaleX = SCALE_ONE - rsin(idiv(s.timer << 12, 24));
  s.timer += dt;
  if (s.duration === 0 && s.timer >= FLIP_SWAP_AT) {
    s.duration = 1;
    s.renderKind ^= 3;
  }
  if (s.timer >= FLIP_DURATION) {
    s.state = CardAnimState.idle;
    s.layer = 0;
    s.scaleX = SCALE_ONE;
    return { busy: true, finished: true, summonLanded: false, sfx: null };
  }
  return { busy: true, finished: false, summonLanded: false, sfx: null };
}

/** F0x8009a62c (both axes) and F0x8009a454 (x only). */
function stepShake(
  s: CardSprite, dt: number, frame: number, bothAxes: boolean,
): CardStepResult {
  const table = bothAxes ? SHAKE_XY_TABLE : SHAKE_X_TABLE;
  s.x = s.startX + table[s.timer & 7]!;
  if (bothAxes) s.y = s.startY + table[frame & 7]!;

  let v = rsin(idiv(s.timer << 12, 24));
  if (bothAxes) {
    if (v < 0) v += 7;
    s.scaleY = SCALE_ONE - (v >> 3);
  } else {
    if (v < 0) v += 0xF;
    s.scaleY = (v >> 4) + SCALE_ONE;
  }

  s.timer += dt;
  if (s.timer >= SHAKE_DURATION) {
    s.state = CardAnimState.idle;
    s.layer = 0;
    s.scaleY = SCALE_ONE;
    s.effect = 0;
    s.x = s.startX;
    if (bothAxes) s.y = s.startY;
    return { busy: true, finished: true, summonLanded: false, sfx: null };
  }
  return { busy: true, finished: false, summonLanded: false, sfx: null };
}

/** F0x8009a540 and F0x8009a5b0 — the plain holds, which differ only in their
 * length and in what they hand over to. */
function stepTimed(
  s: CardSprite, dt: number, duration: number, next: number,
): CardStepResult {
  s.timer += dt;
  if (s.timer >= duration) {
    s.state = next;
    s.duration = 0;
    s.timer = 0;
    s.layer = 0;
    s.effect = 0;
    return { busy: true, finished: true, summonLanded: false, sfx: null };
  }
  return { busy: true, finished: false, summonLanded: false, sfx: null };
}

/** F0x8009a1a0 — the summon, in two parts.
 *
 * While `introTimer` is running the card swells from nothing to 0x1C00 on both
 * axes. When it expires the card is pinned at that size, its resting scale is
 * armed to 0x1200, and the travel leg begins: a linear tween with a half-sine
 * ARC added to y, whose direction is inverted when the card is travelling
 * downwards so the hop always bows away from the board. At the end the start
 * and destination swap and a return leg runs at 2.5x the duration, settling the
 * card flat at 1.0 — which is the moment the original reports back to the duel
 * by ORing 2 into the screen's `unk54`. */
function stepSummon(s: CardSprite, dt: number): CardStepResult {
  if (s.introTimer > 0) {
    s.introTimer -= dt;
    s.scaleX = SUMMON_INTRO_SCALE - s.introTimer * SUMMON_INTRO_STEP;
    s.scaleY = s.scaleX;
    if (s.introTimer <= 0) {
      s.flags |= 5;
      s.destScaleX = SUMMON_REST_SCALE;
      s.destScaleY = SUMMON_REST_SCALE;
      s.scaleX = SUMMON_INTRO_SCALE;
      s.scaleY = SUMMON_INTRO_SCALE;
      s.startScaleX = SUMMON_INTRO_SCALE;
      s.startScaleY = SUMMON_INTRO_SCALE;
      s.introTimer = 0;
      return {
        busy: true, finished: false, summonLanded: false,
        sfx: CARD_SFX.moveStart,
      };
    }
    return { busy: true, finished: false, summonLanded: false, sfx: null };
  }

  s.timer -= dt;
  if (s.timer > 0) {
    const dx = s.destX - s.startX;
    const dy = s.destY - s.startY;
    s.x = s.destX - idiv(dx * s.timer, s.duration);
    s.y = s.destY - idiv(dy * s.timer, s.duration);

    let arc = rsin(idiv(s.timer << 12, s.duration * 2)) * SUMMON_ARC;
    if (dy > 0) arc = -arc;
    if (arc < 0) arc += 0xFFF;
    s.y += arc >> 12;

    s.scaleX = s.destScaleX
      - idiv((s.destScaleX - s.startScaleX) * s.timer, s.duration);
    s.scaleY = s.destScaleY
      - idiv((s.destScaleY - s.startScaleY) * s.timer, s.duration);
    return { busy: true, finished: false, summonLanded: false, sfx: null };
  }

  // The return leg: swap the endpoints, flatten the scale, run 2.5x as long.
  const sx = s.startX, sy = s.startY;
  const dx = s.destX, dy = s.destY;
  const scaleX = s.destScaleX, scaleY = s.destScaleY;
  s.state = CardAnimState.move;
  s.startX = dx;
  s.x = dx;
  s.startY = dy;
  s.y = dy;
  s.destX = sx;
  s.destY = sy;
  s.destScaleX = SCALE_ONE;
  s.destScaleY = SCALE_ONE;
  s.scaleX = scaleX;
  s.scaleY = scaleY;
  s.startScaleX = scaleX;
  s.startScaleY = scaleY;
  s.flags &= 0xFA;
  const next = s.duration * 2 + (s.duration >> 1);
  s.duration = next;
  s.timer = next;
  return { busy: true, finished: false, summonLanded: true, sfx: null };
}

/** Which effect clip run, if any, should be drawn over this sprite this frame —
 * the sprite's `unk47`, which F0x8009a998 switches on. Every animator that sets
 * it clears it again on completion, so a zero here means "no effect". */
export function cardEffectRun(s: CardSprite): number {
  return s.effect;
}

/** The frame index within effect run `run` at animation time `t`, following
 * F0x8009a998: runs 1 and 2 step every 4 frames through a 4-entry authored
 * order, runs 3 and 4 step every 2 frames through a plain cycle. `order` is the
 * run's table from the extracted UI json for runs 1 and 2. */
export function cardEffectFrame(
  run: number, t: number, order?: readonly number[],
): number {
  if (run === 1 || run === 2) {
    const k = Math.floor(t / 4) & 3;
    return order ? order[k]! : k;
  }
  const frames = run === 3 ? 9 : 7;
  return (t >> 1) % frames;
}

/** True while the sprite is running any animation — the original's test for
 * ORing 1 into the screen's `unk54`, i.e. "the board is busy, do not accept
 * input yet". */
export function cardBusy(s: CardSprite): boolean {
  return s.state !== CardAnimState.hidden && s.state !== CardAnimState.idle;
}
