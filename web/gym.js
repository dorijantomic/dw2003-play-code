// web/gym.js — the training gym (stgtrain overlay), walker recreation.
//
// Decoded flow + numerics: docs/research/battle/exp-levelup-rewards-decoded-2026-07-10.md §4
// (stgtrain drill tables @0x8008c4e4, TP costs [1,5,10], gain/loss rows, ultra variants).
// Strings are the real estraini.toml bank ("Which training?", "Pick TP amount to use.",
// "Ultra Training Chance!", "Failed...", drill names 19-42).
//
// Ultra Training Chance (decoded 2026-07-10, stgtrain states 35/63-65/69/73 + the 0x134
// challenge session): the OFFER is earned mid-training — the session runs 3 rep widget
// polls at percent 75 (+3 TrainingBook / +6 PowerBrace in an accessory slot, helper
// 0x80086abc — book takes priority, no stacking); the banner + Challenge/As-is menu
// appears iff all three reps succeed (@0x45a0; runtime-confirmed screenshot). TP choice
// is NOT an offer gate (TP table 0x8008c4d8 is only affordability/spend). Choosing
// Challenge runs the decoded WIN roll (fn 0x7074): rand%100 <= percent, percent 50 —
// forced 0 when the drill equals the last WON challenge's drill (roster byte +0x3cc).
// Losing shows "Failed..." (estraini 71) and applies the NORMAL tables. There is NO
// button-timing minigame — the old "±12 window @0x1cb8" note was a misread
// sprite-animation ticker (see docs/research/infra/falsified-hypotheses.md).
//
// Gym RANK (1..14, indexes rank_menus): the greeter writes bank-0x94 with the
// 0-based group (GYM-Q001, gym_ranks.json / gymGroupFor). Lab and debug open
// with no greeter, so gymRankFor is the ID-card fallback used only on that path.
import { paintScreenDim } from "./screendim.js";
import { asButton } from "./input.js";
import { drawWindow } from "./uiRects.js";
import { assignAssetImage } from "./assets.js";
import { drawText, textWidth } from "./uifont.js";
import { loadPack, drawClip, packReady, drawPackBackdrop } from "./screenpack.js";
import { starterPortraitClip } from "./portraits.js";
import {
  gymDrillsForRank, gymTrainingResult, ultraChanceRoll, applyGymEffects,
  gymRepPercent, gymRepResults, gymSessionResult, ensureStoredStats,
  gymStatForId,
} from "./battle.js";
import { ensureDriPartyStats, driRoster, driStatsAt, driDigimonAt } from "./dri-model.js";
import { elementValue, equipmentBonuses, ui } from "./vendor/engine.js";

// Native chrome layout (tools/extract_stgtrain_ui.py -> stgtrain_ui.json).
// Pack STTRNGCS/STTRNGTM (LBA 0x28c/0x28d, disc-only, extracted the same way
// as stdglabo). See docs/research/ui/stgtrain-decoded-2026-07-11.md.
const sttrngDrills = loadPack("sttrng0");
const sttrngChrome = loadPack("sttrng3");
let LAYOUT = null;
fetch("assets/data/stgtrain_ui.json").then((r) => r.json()).then((j) => { LAYOUT = j; }).catch(() => {});

// Pod-select screen ("Train which Digimon?") — docs/research/ui/
// stgtrain-pod-select-decoded-2026-07-12.md. stgtrain's OWN sprite-category
// resolver (which of 8 categories a given party member's pod shows) is a
// resident runtime cache with no located species->category master table
// (searched, not found — the 3 empirically-confirmed values aren't enough
// to cover the full roster without guessing, which this project's evidence
// rules forbid). Real, verified geometry (pod row x=164+48*i,y=129; cursor
// beam x=164+48*sel,y=101, cmfont clip 0xd) is stgtrain's own; the pod
// SPRITE CONTENT reuses the already-decoded, broader-coverage DRI portrait
// system (web/dri.js's animClipFor, dri_tables.json, stdglabo pack) as a
// documented substitution rather than guessing stgtrain's own resolver.
const dglab = loadPack("stdglabo");
const cmfont = loadPack("cmfont");
let DRI_TABLES = null;
fetch("assets/data/dri_tables.json").then((r) => r.json()).then((j) => { DRI_TABLES = j; }).catch(() => {});

function podAnimClipFor(digimonId, frame) {
  // A starter reads the ONE shared table through portraits.js; anything else falls
  // back to the resolver's own clip list, which is indexed by the game's DigimonId.
  const starter = starterPortraitClip(digimonId, frame);
  if (starter != null) return starter;
  const row = DRI_TABLES?.portrait_animation_clips?.[Number(DRI_TABLES?.portrait_clip_by_digimon_id?.[digimonId] ?? -1)];
  const valid = row?.filter((v) => v >= 0) ?? [];
  return valid.length ? valid[frame % valid.length] : null;
}

// stgtrain's OWN sprite-category system, resolved 2026-07-12c: the 8 category
// anim rows (table 0x8008C224, RAM-read in the pod-select session) index
// sttrng3 clips 0-28, which turn out to be per-STARTER workout sprites (all
// parties are starters-only, so species->category == starter identity).
// Slot categories were RAM-verified for 3 of 8 (Renamon->6, Veemon->4,
// Kotemon->0, live savestate); the other 5 are identified by the sprite art
// itself (each row is an unmistakable starter: Guilmon red, Agumon yellow
// dino, Monmon green monkey, Kumamon capped bear, Patamon).
export const TRAIN_CATEGORY_BY_NAME = {
  Kotemon: 0, Kumamon: 1, Monmon: 2, Agumon: 3,
  Veemon: 4, Guilmon: 5, Renamon: 6, Patamon: 7,
};
const TRAIN_CATEGORY_CLIPS = [
  [7, 8, 9, 10, 9, 8], [14, 15, 16, 15], [11, 12, 13, 12], [3, 4, 5, 6, 5, 4],
  [25, 26, 27, 28, 27, 26], [0, 1, 2, 1], [17, 18, 19, 20, 19, 18], [21, 22, 23, 24, 23, 22],
];
function trainSpriteClip(member, frame) {
  const cat = TRAIN_CATEGORY_BY_NAME[member?.profile?.name];
  const row = cat != null && TRAIN_CATEGORY_CLIPS[cat];
  return row ? row[frame % row.length] : null;
}

// TRANIN training-scene packs (DAT/TRAINING/TRANIN00-16, extracted by
// tools/extract_tranin.py — see the extractor header for the decoded format
// and docs/research/ui/stgtrain-decoded-2026-07-11.md for how they were
// found). One file per drill family; subdirs 0-7 = per-starter large workout
// animation sets (same order as the sprite-category table), subdir 8 = the
// shared props (punching bag/chain/mount/dust for Punch; per-drill props for
// the others). Clips carry their native scene draw offsets (ox,oy); anim
// script 0 is the looping workout cycle, durations in vsyncs.
const TRANIN_CACHE = {};
export function traninEntry(key) {
  let e = TRANIN_CACHE[key];
  if (e) return e;
  e = TRANIN_CACHE[key] = { img: new Image(), meta: null };
  assignAssetImage(e.img, `assets/ui/tranin/t${key}.png`);
  fetch(`assets/ui/tranin/t${key}.json`).then((r) => r.json())
    .then((j) => { e.meta = j; }).catch(() => {});
  return e;
}
// Compact drill id -> TRANIN file suffix (00-04 physical incl. supers,
// 10-16 tolerances incl. S variants — supers reuse the base scenes).
export function traninFamily(drill) {
  if (drill >= 1 && drill <= 5) return `0${drill - 1}`;
  if (drill >= 6 && drill <= 12) return `1${drill - 6}`;
  if (drill >= 13 && drill <= 17) return `0${drill - 13}`;
  if (drill >= 18 && drill <= 24) return `1${drill - 18}`;
  return "00";
}
function traninReady(e) {
  return !!(e?.meta && e.img.complete && e.img.naturalWidth);
}
// Anim-script semantics, decoded 2026-07-12d from the rep widget task F0x800897b8
// + rep dispatcher F0x800871ac (both re-decompiled via m2c): each subdir carries
// EXACTLY 6 scripts and the game plays them by fixed index —
//   0 = intro/ready stance (played once when the round starts),
//   1 = per-rep wind-up (widget case 4, unk5C 0→1: D2EC(cat,1)),
//   2 = HIT — punch connects (success roll: D2EC(cat,2)),
//   3 = MISS — the bag swings back and hits you (fail roll: D2EC(cat,3)),
//   4 = WIN pose / 5 = LOSE pose (widget case 8: unk60 ? 4 : 5).
// The trainee (subdir = sprite category) and the props (subdir 8: bag/chain/mount)
// play the SAME index in lockstep, so the bag reacts on the same beat as the punch.
export const TR_INTRO = 0, TR_WINDUP = 1, TR_HIT = 2, TR_MISS = 3, TR_WIN = 4, TR_LOSE = 5;

// Per-drill-family scene anchor — ONE anchor shared by the trainee (subdir =
// category) and the props (subdir 8); the actors' relative placement is fully
// baked into the clips' native draw offsets. Both calibrated families land on
// the identical point (runtime captures 2026-07-13):
//   "00" Punch (82,31): rig framebuffer template match + user PS1 capture
//        (bag-relative Kotemon bbox agrees within ~2px). The old separate
//        digi anchor (71,46) — "matched within 1-2px" — was WRONG.
//   "03" Study (79,24): user PS1 capture, edge/color-NCC lock 0.73-0.85
//        (an earlier (79,27) digi reading was an NCC argmax clipped at the
//        search-radius edge).
//   "14" Thunder Defense (47,35): user PS1 capture, calibrated visually in
//        gym-lab (auto-registered overlay).
// Native DRAW ORDER is trainee first, props on top (subdir order): the real
// game occludes Kotemon's extended sword behind the punching bag.
// The native anchor source is the resident anim-actor system (0x8008cfcc
// runtime-populated vtable, not stgtrain-local); other families are
// UNCALIBRATED and fall back to the Punch value — calibrate each with one
// real capture in web/gym-lab.html.
export const TRANIN_ANCHORS = { default: [82, 31], "03": [79, 24], "14": [47, 35] };
export function traninAnchors(fam) {
  return TRANIN_ANCHORS[fam] ?? TRANIN_ANCHORS.default;
}

// Sprite grow-in (SCREEN-OBJECT-METHODS-001, gym_sprite_actor_scale_in /
// snap_scale). The actor's scale word is 0x1000 at full size. Opening a
// session snaps it to 0 and adds 0x199 per vsync until it hits unity
// (~10 frames). Scale-out (delta -0x333) has no overlay call, so it is
// not wired. PAL vsync is 20ms, the same beat the TRANIN scripts use.
const ACTOR_SCALE_UNITY = 0x1000;
const ACTOR_SCALE_IN_DELTA = 0x199; // F0x8008a200 unk68
const VSYNC_MS = 20;

// Leave dim (SCREEN-OBJECT-METHODS-001, screenFadeStart_stgtrain). The
// only overlay call is direction 0, duration 0x1E: the 8.8 dim word runs
// 0 → 0xFF00 in 30 frames, then the gym is gone.
const LEAVE_FADE_FRAMES = 0x1E;
const LEAVE_FADE_MAX = 0xFF00;
const LEAVE_FADE_DELTA = Math.trunc(LEAVE_FADE_MAX / LEAVE_FADE_FRAMES);
const ANIM_T = 0.2; // window fold, 10 PAL vsyncs (window-fold-tween homolog)

// HUD number colours after a session (SCREEN-OBJECT-METHODS-001,
// gym_hud_delta_fill). Widget +0x138 palette: 1 when the snapshot was
// lower (the stat rose), 5 when it was higher (the stat fell), 0 when
// equal. A failed session (no effects) refreshes with no colour. Same
// pair as the equipment sheet.
const HUD_CLUT_UP = 1;
const HUD_CLUT_DOWN = 5;

// Total run length of one anim script, in ms (PAL vsync = 20ms/step). 0 if absent.
export function traninScriptMs(e, idx) {
  const steps = traninReady(e) && e.meta.anims[idx];
  if (!steps?.length) return 0;
  return steps.reduce((s, x) => s + x.dur, 0) * 20;
}
// Draw one clip: the opaque cell, then the clip's semi-transparent cell
// blended over it (PS1 semi-transparency, c bit15 — the Thunder flash, Yoga
// spotlight cone, Heat explosion glow, the Ice frost encasing; the real game
// shows the trainee THROUGH these). 50/50 (PS1 mode 0) is used for all semi
// layers — matches the thunder capture. The clip record's d&3 is exported as
// semi.abr but its mapping to PS1 ABR modes is UNRESOLVED (the falling-snow
// sheets carry d&3=2, which as ABR would be subtractive black snow — the
// runtime frames show white; do not wire d&3 as ABR without per-mode runtime
// comparison).
function drawClipCell(ctx, e, clip, ax, ay) {
  const c = e.meta.clips[clip];
  if (!c) return false;
  if (c.w) ctx.drawImage(e.img, c.x, c.y, c.w, c.h, ax + c.ox, ay + c.oy, c.w, c.h);
  if (c.semi) {
    const s = c.semi;
    ctx.save();
    ctx.globalAlpha *= 0.5;
    ctx.drawImage(e.img, s.x, s.y, s.w, s.h, ax + s.ox, ay + s.oy, s.w, s.h);
    ctx.restore();
  }
  return true;
}

// Resolve which step of an anim script is showing at an absolute elapsed time.
// `loop` cycles forever; otherwise the script plays once and holds the final
// frame (so a resolved punch/pose stays put until the state machine advances).
function traninResolve(e, idx, elapsedMs, loop) {
  if (!traninReady(e)) return null;
  let steps = e.meta.anims[idx];
  if (!steps?.length) steps = e.meta.anims[TR_INTRO];
  if (!steps?.length) return null;
  const total = steps.reduce((s, x) => s + x.dur, 0) || 1;
  let t = Math.floor(Math.max(0, elapsedMs) / 20);
  t = loop ? t % total : Math.min(t, total - 1);
  let curIdx = steps.length - 1, acc = 0;
  for (let i = 0; i < steps.length; i++) { if (t < acc + steps[i].dur) { curIdx = i; break; } acc += steps[i].dur; }
  return steps[curIdx];
}

// Draw one actor's anim script at an absolute elapsed time, at the scene
// anchor plus the step's own signed movement offset (the native a/b fields —
// punch lunge, knockback, the Study desk run).
export function drawTraninScript(ctx, e, idx, elapsedMs, ax, ay, loop = false) {
  const f = traninResolve(e, idx, elapsedMs, loop);
  if (!f) return false;
  return drawClipCell(ctx, e, f.clip, ax + (f.dx ?? 0), ay + (f.dy ?? 0));
}

// Draw the full two-actor training scene: trainee first, props on top
// (native subdir order — the bag occludes the extended sword), both at the
// shared scene anchor + their step's movement offset; semi-transparent
// layers blend inside drawClipCell. No size heuristics — what the scripts
// say is what draws (the wide props panoramas already contain every prop,
// and the Yoga spotlight clip contains the meditating trainee).
// digiOff is the gym-lab exploration offset (0 in the game).
export function drawTraninScene(ctx, digi, props, idx, elapsedMs, ax, ay, loop = false, digiOff = null) {
  const dF = traninResolve(digi, idx, elapsedMs, loop);
  const pF = traninResolve(props, idx, elapsedMs, loop);
  if (dF) drawClipCell(ctx, digi, dF.clip,
    ax + (digiOff?.[0] ?? 0) + (dF.dx ?? 0), ay + (digiOff?.[1] ?? 0) + (dF.dy ?? 0));
  if (pF) drawClipCell(ctx, props, pF.clip, ax + (pF.dx ?? 0), ay + (pF.dy ?? 0));
  return { drewDigi: !!dF, drewProps: !!pF, digiF: dF ?? null, propsF: pF ?? null };
}

// Compact drill id (1-24, progression.json rank_menus order) -> estraini
// string-bank index (19-42). The two orders DIFFER: estraini puts the 5
// super-physical drills (24-28) right after the 5 normals, while the compact
// order puts the 7 tolerances there. The RAM-read drill-icon frame table
// (DRILL_ICON_FRAMES in extract_stgtrain_ui.py) is keyed by the RAW estraini
// id, so every frames[] lookup must go through this map — the old `+18`
// shortcut was only correct for drills 1-5 (all that had been visually
// verified when it shipped).
const ESTRAINI_IDX = [null,
  19, 20, 21, 22, 23,          // Punch..Jump Rope
  29, 30, 31, 32, 33, 34, 35,  // Heat..Missile Defense, Haunting
  24, 25, 26, 27, 28,          // Super Punch..Super Jump Rope
  36, 37, 38, 39, 40, 41, 42,  // S tolerances, Super Missile DF, Super Haunting
];
// Every word this screen shows comes out of the game's own message bank
// (stgtrain_ui.json `strings`, extracted from the language file the screen asks
// for at bank 0x10B). The walker used to carry its own English copies of the
// names, the descriptions, the prompts and the amounts, and every delivery had
// to say "the wording is not established". It is: same file, same indices, and
// `strings.roles` says which index each place asks for.
const say = (i) => (typeof i === "number" ? LAYOUT?.strings?.all?.[i] ?? "" : "");
const ROLE = (k) => LAYOUT?.strings?.roles?.[k];
const drillName = (drill) => say(ESTRAINI_IDX[drill]);
const drillDesc = (drill) =>
  ESTRAINI_IDX[drill] == null ? ""
    : say(ESTRAINI_IDX[drill] + (ROLE("drill_desc_offset") ?? 24));
const tpAmountLabel = (sel) => say((ROLE("tp_amounts") ?? [14, 15, 16])[sel]);

// Fallbacks used only until stgtrain_ui.json arrives; the file is the
// authority. tp_amount_menu is three boxes in a row with the amount inside
// each; ultra_menu is the two-way offer the session shows.
const TP_AMOUNT_MENU = {
  labelsX: [152, 192, 230], labelY: 102,
  boxClip: 0x2a, boxX0: 148, boxStepX: 40, boxY: 99, cursorClip: 0x29,
  headerX: 162, headerY: 73, titleX: 188, titleY: 20,
};
const CONFIRM_PROMPT = {
  headerX: 162, headerY: 73, amountX: 192, amountY: 41,
  rowsX: 162, rowsY: [100, 116], cursorX: 148, cursorY0: 100, cursorStepY: 16,
};
const ULTRA_MENU = {
  bannerX: 162, bannerY: 117, rowsX: 162, rowsY: [145, 161],
  cursorX: 148, cursorY0: 145, cursorStepY: 16,
};
// Same rows/order as the status screen (web/menu.js) — cmfont clip 0xF is the
// shared 6-core + 7-resistance icon composite both screens draw.
// Left-HUD text geometry, used only until stgtrain_ui.json arrives; the file
// is the authority (hud_text, from F0x80083aec).
const HUD_TEXT = {
  name: { x: 51, y: 19, kind: 1 },
  level: { labelX: 51, y: 34, valueX: 80, kind: 3 },
  hp: { labelX: 51, y: 44, curX: 93, sepX: 95, maxX: 128, kind: 3 },
  mp: { labelX: 51, y: 53, curX: 93, sepX: 95, maxX: 128, kind: 3 },
  core: { x: 51, y0: 79, stepY: 14, rows: 6, kind: 1 },
  res: { x: 93, y0: 79, stepY: 14, rows: 7, kind: 1 },
  tp: { labelX: 16, valueX: 44, y: 187, kind: 1 },
};

const CORE_ROWS = ["str", "def", "spt", "wis", "spd", "chr"];
const RES_ROWS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const STAT_LABELS = {
  str: "STR", def: "DEF", spt: "SPT", wis: "WIS", spd: "SPD", chr: "CHR",
  maxHp: "HP", maxMp: "MP", fire: "Fire", water: "Water", ice: "Ice",
  wind: "Wind", thunder: "Thunder", machine: "Machine", dark: "Dark",
};

export const SILVERID_ID = 40, GOLDID_ID = 41, PLATINUMID_ID = 42;

// DECODED per-gym rank group (GYM-Q001, 2026-07-26): the greeter's on_close
// bank-0x94 write carries the 0-based rank_menus group, chosen by which ID cards
// the player owns (gym_ranks.json, tools/extract_gym_ranks.py). Returns the group
// index, or null when no option is satisfied — in the original that means no
// bank-0x94 write fires at all, i.e. the greeter never opens training.
// `gymRanks` = gym_ranks.json; `stage` = current map id. Pure.
export function gymGroupFor(stage, inventory, gymRanks) {
  const has = (id) => !!inventory?.some((s) => s.id === id && s.qty > 0);
  const gym = gymRanks?.gyms?.find((g) => g.stage === stage);
  if (!gym) return null;
  for (const opt of gym.options)
    if (opt.requires.every((r) => has(r.item) === r.owned)) return opt.group;
  return null;
}

// Debug/lab fallback only: __labOpen and the debug menu open the gym with no
// greeter, so there is no bank-0x94 index to carry. Approximates the group from
// the ID-card chain; never used on the real greeter path (gymGroupFor above).
export function gymRankFor(inventory) {
  const has = (id) => inventory?.some((s) => s.id === id && s.qty > 0);
  if (has(PLATINUMID_ID)) return 14;
  if (has(GOLDID_ID)) return 9;
  if (has(SILVERID_ID)) return 5;
  return 1;
}

export function createGym(sfx = null) {
  const g = {
    _open: false,
    screen: "select", // select -> drill -> tp -> confirm -> reps -> (ultra) -> result
    rank: 1,
    drills: [],
    roster: [],        // driRoster(state, digimonById) — up to 3 candidates
    trainSlot: 0,       // which state.party index is training (0 = lead)
    selSlot: 0,         // pod-select cursor, before confirming trainSlot
    drillSel: 0,
    tpSel: 0,
    confirmSel: 0,     // 0 = Yes, 1 = No
    ultraSel: 0,       // 0 = Challenge, 1 = As is
    ultraOffered: false,
    ultraWon: false,
    superDrill: false, // selected drill id >= 13 (starred/super) — gates the ultra menu
    challengeWon: null,// null = no bonus rep; true = won ultra roll; false = lost
    challengeShown: false, // the bonus/challenge rep's marker (4th slot) is revealed
    repResults: [],    // ordinary-rep booleans (widget polls +0x64/+0x68/+0x6c); 3 or 5
    repStage: "intro", // intro -> windup -> resolve (xN) -> endpose | ultra | challenge*
    repIdx: 0,         // rep currently animating
    repShown: 0,       // rep markers revealed so far (circles/X)
    repStageT0: 0,     // current-stage start time (ms)
    repScript: 0,      // TRANIN anim script index currently playing in the viewport
    resultPages: [],   // the finished session's message, one entry per page
    resultPage: 0,
    hudDeltas: {},     // stat -> signed delta; drives HUD palette 1/5 after a session
    actorScale: ACTOR_SCALE_UNITY,
    actorScaleT0: 0,
    fadeLeaving: false,
    fadeT0: 0,
    time: 0,
    _anim: {},
    tpWarn: false,
    progression: null, // { level_up, gym } — assets/data/progression.json
    onClose: null,
  };

  g.isOpen = () => g._open;

  // The party member currently selected for training (state.partnerStats for
  // the lead, else state.partyStats[trainSlot] — same "view" pattern menu.js's
  // useItem() already uses for non-lead item targets).
  function trainee(state) { return driStatsAt(state, g.trainSlot, g.digimonById); }

  // `group` = the greeter's decoded bank-0x94 rank-menu index (0-based). The
  // debug/lab path has no greeter, so it may pass `stage` instead and let the
  // decoded gym_ranks.json table resolve the group; with neither, the ID-card
  // approximation is used.
  g.open = async (state, onClose = null, group = null, stage = null) => {
    if (!g.progression) {
      try {
        g.progression = await (await fetch("assets/data/progression.json")).json();
        const dj = await (await fetch("assets/data/digimon.json")).json();
        g.digimonById = Object.fromEntries(dj.digimon.map((d) => [d.id, d]));
        g.gymRanks = await (await fetch("assets/data/gym_ranks.json")).json();
      } catch { return; } // no tables — gym can't run
    }
    if (group == null && stage != null)
      group = gymGroupFor(stage, state.inventory, g.gymRanks);
    g._open = true;
    g.onClose = onClose;
    // rank_menus is indexed 1..14 by gymDrillsForRank; the decoded launcher index
    // is 0-based, so group N is rank N+1.
    g.rank = group == null ? gymRankFor(state.inventory) : group + 1;
    ensureDriPartyStats(state, g.digimonById);
    g.roster = driRoster(state, g.digimonById).slice(0, 3);
    g.trainSlot = 0;
    g.selSlot = 0;
    g.drills = gymDrillsForRank(g.rank, g.progression.gym);
    // Skip the pod-select screen entirely for a single-member party (nothing
    // to choose between) — matches the real screen only appearing with >1
    // trainable party member.
    g.screen = g.roster.length > 1 ? "select" : "drill";
    g.drillSel = g.tpSel = g.confirmSel = g.ultraSel = 0;
    g.resultPages = [];
    g.resultPage = 0;
    g.hudDeltas = {};
    g.actorScale = ACTOR_SCALE_UNITY;
    g.fadeLeaving = false;
    g.tpWarn = false;
    g.time = performance.now() / 1000;
    g._anim = {};
    g._animStart = (...keys) => {
      const t = g.time || performance.now() / 1000;
      for (const k of keys) g._anim[k] = t;
      // Every window-fold start in the original plays the family cue -- open
      // 0x40019 (system03), close 0x4001A (system04); see
      // docs/research/ui/window-fold-tween-homolog-family-2026-08-04.md. The gym
      // only ever folds its windows open (leaving fades), so one open cue per
      // start call.
      sfx?.play?.("system03");
    };
    if (g.screen === "drill") g._animStart("drill");
    else g._animStart("select");
  };

  function close() {
    g._open = false;
    g.fadeLeaving = false;
    g.onClose?.();
  }

  // Triangle on the picker: dim in over 30 frames, then leave.
  function requestLeave() {
    if (g.fadeLeaving) return;
    g.fadeLeaving = true;
    g.fadeT0 = performance.now();
  }

  // Palette for a HUD number that moved this session. Unchanged stats
  // keep the caller's face (gold on HP/MP, default on the grid). A
  // colour tint would hide the palette row, so a delta drops `color`.
  function hudDeltaOpts(stat, extra = {}) {
    const d = g.hudDeltas[stat];
    if (!(d > 0) && !(d < 0)) return extra;
    const { color: _ignored, ...rest } = extra;
    return { ...rest, clut: d > 0 ? HUD_CLUT_UP : HUD_CLUT_DOWN };
  }

  function tpAvailable(state) { return trainee(state)?.tp ?? 0; }

  // Persist the trained slot's stats to the same localStorage keys menu.js's
  // useItem() uses for a non-lead target (tgt===0 -> "partnerStats", else
  // the whole partyStats array — there's no single-slot key).
  function persistTrainee(state) {
    if (g.trainSlot === 0) localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
    else localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
  }

  // Current live value of a trained stat: the HUD colouring uses it, and so
  // does the result line, which prints the amount the block actually moved by.
  function statValue(ps, stat) {
    if (stat === "maxHp" || stat === "maxMp") return ps[stat] ?? 0;
    if (stat in (ps.stats ?? {})) return ps.stats[stat];
    return ps.elemBonuses?.[stat] ?? 0;
  }

  // What the finished session says, in the game's own words.
  //
  // F0x8008706c case 5 sums the per-rep gains, then picks ONE message from the
  // bank: nothing gained at all -> the fixed "Nothing increased" line; a drill
  // whose stat id is 1..5 -> the core base plus that id, with one number; a
  // resistance drill that also moved a second stat -> the two-number base plus
  // the id; a resistance drill on its own -> the one-number base plus the id.
  // The message carries its own layout: `\n` starts the plate's second line,
  // [pause] waits for a press, and [clear] wipes the plate before what follows.
  // So a two-stat result is TWO pages -- "Results:", then the two lines.
  function resultPages(entry, effects, before, ps) {
    const r = LAYOUT?.strings?.roles;
    if (!r) return [];
    const total = (stat) => effects.reduce(
      (n, e) => n + (e.stat === stat ? e.delta : 0), 0);
    const pStat = gymStatForId(entry.primary), sStat = gymStatForId(entry.secondary);
    const rawP = total(pStat), rawS = total(sStat);
    // The printed figures: what the block actually moved by.
    const gotP = Math.abs(statValue(ps, pStat) - before.primary);
    const gotS = Math.abs(statValue(ps, sStat) - before.secondary);
    let index = r.result_none, numbers = [];
    if (rawP !== 0 || rawS !== 0) {
      if (entry.primary >= 1 && entry.primary <= 5) {
        index = r.result_core_base + entry.primary; numbers = [gotP];
      } else if (rawS !== 0) {
        index = r.result_two_base + entry.primary; numbers = [gotP, gotS];
      } else {
        index = r.result_elem_base + entry.primary; numbers = [gotP];
      }
    }
    let text = say(index);
    numbers.forEach((n, i) => { text = text.split(`{${i + 1}}`).join(String(n)); });
    // Split into pages on the message's own marks, then into lines on its own
    // line break. An empty page (the marks sit next to each other) is dropped.
    return text.split(/\[pause\]|\[clear\]/)
      .map((page) => page.split("\\n").map((l) => l.trim()).filter(Boolean))
      .filter((lines) => lines.length);
  }

  // Run the training with the chosen drill/TP/ultra outcome and bank the results.
  function runTraining(state) {
    const ps = trainee(state);
    // Resolve the species the way the panel and the DRI do -- through the
    // shared resolver, which falls back to the party slot's own starter when
    // the stored block has no species yet. Reading only ps.digimonId left
    // `prof` empty for a partner that had never evolved, so the seeding below
    // was skipped and the first training wrote the gain in as the WHOLE stat:
    // 48 became 3. The lab's stand-in partner is exactly that case.
    const prof = driDigimonAt(state, g.trainSlot, g.digimonById);
    // Seed the stored-stat block from the level-scaled base if it's missing (a
    // never-evolved partner has no ps.stats — baseStatsFor omits it and
    // seedStoredStats only runs on the DRI evolve path). Without this, the first
    // training writes str = 0 + delta and the panel/DRI (which read stats.stats
    // as the ABSOLUTE total) show the delta as the whole stat — the base is
    // wiped. Battle already does this at entry (battle.js ensureStoredStats).
    if (prof) ensureStoredStats(ps, prof);
    const gym = g.progression.gym;
    const entry = g.drills[g.drillSel];
    const dig = {
      elemGrowth: prof?.resistance_growth ?? {},
      elemCur: ps.elemBonuses ?? {},
    };
    // Sum the gains over every O rep (+ the won bonus rep), matching the native
    // per-hit accumulation (F0x800866cc/F0x80087334) — NOT a single roll.
    const res = gymSessionResult(entry, g.tpSel, g.repResults, g.challengeWon, dig, gym);
    ps.tp = Math.max(0, (ps.tp ?? 0) - res.tpCost);
    // What the screen says is the number that ACTUALLY landed, not the number
    // rolled: the native predicts its own cap (999 for a stat, 9999 for max HP
    // or MP, and a drop stops at what you have) and prints the capped figure.
    // Reading the stat either side of the write gives the same number.
    const before = { primary: statValue(ps, gymStatForId(entry.primary)),
                     secondary: statValue(ps, gymStatForId(entry.secondary)) };
    applyGymEffects(ps, res.effects, g.progression.level_up);
    // roster byte +0x3cc: a WON challenge remembers the drill; a lost one clears it
    // (native: sb at 0x51c8/0x5120). No bonus rep (challengeWon null) leaves it.
    if (g.challengeWon != null) ps.lastUltraDrill = g.challengeWon ? entry.drill : null;
    persistTrainee(state);
    g.hudDeltas = Object.fromEntries(res.effects.map(({ stat, delta }) => [stat, delta]));
    g.resultPages = resultPages(entry, res.effects, before, ps);
    g.resultPage = 0;
    g.screen = "result";
  }

  g.handleKey = (rawKey, state) => {
    // Accept either a pad button name from the dispatcher or the raw key it
    // stands for, so a caller (and a test) may use whichever it has.
    const k = asButton(rawKey);
    if (!g._open) return false;
    if (g.fadeLeaving) return true;

    if (g.screen === "select") {
      // Pod-select ("Train which Digimon?") — docs/research/ui/
      // stgtrain-pod-select-decoded-2026-07-12.md. Real screen navigates a
      // horizontal row of up to 3 pods with left/right only (F0x80084838 is
      // its render fn; the input arms are stgtrain.s .L0x00002720-.L0x000028a4,
      // RAM 0x800853d0-0x80085554). The cursor CLAMPS — left floors at 0
      // (.L0x00002798: sel-1, store 0 when negative) and right ceilings at
      // count-1 (.L0x00002824-.L0x00002844: sel+1, slt against count-1) — it
      // does not wrap; and the cursor word 0x4001B plays only when the slot
      // actually changed (`beq $s4,$v0` at .L0x00002850; the play is
      // .L0x0000285c-.L0x00002868). The walker used to wrap and blip on a
      // blocked press.
      const n = g.roster.length;
      const move = (d) => {
        const next = Math.max(0, Math.min(n - 1, g.selSlot + d));
        if (next !== g.selSlot) { g.selSlot = next; sfx?.play("system06"); }
      };
      if (k === "left")  { move(-1); return true; }
      if (k === "right") { move(1); return true; }
      if (k === "circle") {
        sfx?.play("system07"); g.trainSlot = g.selSlot; g.drillSel = 0;
        g.screen = "drill"; g._animStart("drill"); return true;
      }
      if (k === "cross") { sfx?.play("system01"); requestLeave(); return true; }
      return true;
    }
    if (g.screen === "drill") {
      // 4x2 grid, col=unk68 clamped 0..3, row=unk6C clamped 0..1, empty cells
      // skipped in that direction (F0x8008aad4 case 0xA). L1/R1 flip page
      // unk70. Confirm is logical 0xD = Cross.
      const n = g.drills.length;
      const occupied = (i) => i >= 0 && i < n;
      const pageOf = (i) => Math.floor(i / 8);
      const colOf = (i) => i % 4;
      const rowOf = (i) => Math.floor((i % 8) / 4);
      const at = (page, col, row) => page * 8 + row * 4 + col;
      const step = (dcol, drow) => {
        const page = pageOf(g.drillSel);
        let col = colOf(g.drillSel) + dcol;
        let row = rowOf(g.drillSel) + drow;
        while (col >= 0 && col < 4 && row >= 0 && row < 2) {
          const i = at(page, col, row);
          if (occupied(i)) { g.drillSel = i; sfx?.play("system06"); return; }
          col += dcol; row += drow;
        }
      };
      if (k === "left")  { step(-1, 0); return true; }
      if (k === "right") { step(1, 0); return true; }
      if (k === "up")    { step(0, -1); return true; }
      if (k === "down")  { step(0, 1); return true; }
      if (k === "r1" && n > 8) {
        const next = Math.min(g.drillSel + 8, n - 1);
        if (next !== g.drillSel) { sfx?.play("system06"); g.drillSel = next; }
        return true;
      }
      if (k === "l1" && n > 8) {
        const next = Math.max(g.drillSel - 8, 0);
        if (next !== g.drillSel) { sfx?.play("system06"); g.drillSel = next; }
        return true;
      }
      if (k === "circle") { sfx?.play("system06"); g.tpWarn = false; g.screen = "tp"; g._animStart("tp"); return true; }
      if (k === "cross") { sfx?.play("system01"); requestLeave(); return true; }
      return true;
    }
    if (g.screen === "tp") {
      // The three amounts sit side by side, so the choice moves LEFT and RIGHT
      // (F0x800888bc case 6 reads the pad's left and right bits, not up/down).
      if (k === "left")  { sfx?.play("system06"); g.tpSel = Math.max(0, g.tpSel - 1); g.tpWarn = false; return true; }
      if (k === "right") { sfx?.play("system06"); g.tpSel = Math.min(2, g.tpSel + 1); g.tpWarn = false; return true; }
      if (k === "circle") {
        const cost = g.progression.gym.tp_costs[g.tpSel];
        if (tpAvailable(state) < cost) { sfx?.play("system07"); g.tpWarn = true; return true; }
        sfx?.play("system07"); g.tpWarn = false; g.confirmSel = 0; g.screen = "confirm"; g._animStart("confirm"); return true;
      }
      if (k === "cross") { sfx?.play("system01"); g.tpWarn = false; g.screen = "drill"; g._animStart("drill"); return true; }
      return true;
    }
    if (g.screen === "confirm") { // "Is this ok?" Yes/No
      if (k === "up" || k === "down") { sfx?.play("system02"); g.confirmSel ^= 1; return true; }
      if (k === "circle") {
        if (g.confirmSel === 1) { sfx?.play("system00"); g.screen = "tp"; g._animStart("tp"); return true; }
        sfx?.play("system00");
        // Mid-training rep phase: widget polls at 75/78/81% (TrainingBook/PowerBrace
        // accessory bonus, helper 0x80086abc). Three ordinary polls for basic drills;
        // a super/starred drill (id >= 13) that doesn't sweep extends to five
        // (F0x800871ac unk18 2->4). A clean first-three sweep instead opens the Ultra
        // bonus (state 0xA): basic drills auto-run one high-value bonus rep, super
        // drills show the Challenge / As-is menu.
        g.superDrill = (g.drills[g.drillSel]?.drill ?? 0) >= 13;
        g.repResults = gymRepResults(gymRepPercent(state.equipment?.[g.trainSlot] ?? state.equipment?.[0]), g.superDrill);
        g.ultraOffered = g.repResults.length === 3 && g.repResults.every(Boolean);
        g.ultraWon = false;
        g.challengeWon = null;
        g.challengeShown = false;
        g.repStage = "intro";
        g.repIdx = 0;
        g.repShown = 0;
        g.repScript = TR_INTRO;
        g.repStageT0 = performance.now();
        // Session start: trainee and bag snap to scale 0, then grow in.
        g.actorScale = 0;
        g.actorScaleT0 = g.repStageT0;
        g.screen = "reps";
        return true;
      }
      if (k === "cross") { sfx?.play("system01"); g.screen = "tp"; return true; }
      return true;
    }
    if (g.screen === "reps") return true; // training runs itself (advanced in draw)
    if (g.screen === "ultra") { // "Ultra Training Chance!" Challenge / As is
      if (k === "up" || k === "down") { sfx?.play("system02"); g.ultraSel ^= 1; return true; }
      if (k === "circle") {
        sfx?.play("system00");
        if (g.ultraSel === 0) {
          // Challenge (F0x80087cf4 unk18==0 -> state 20 F0x80087e18): ONE high-value
          // bonus rep. 50% win, forced 0 on the last-won drill; decided before the
          // animation (native rolls, then the widget plays the beat). Won -> the bonus
          // rep uses the ultra tables; lost -> it adds nothing (its X).
          const entry = g.drills[g.drillSel];
          g.challengeWon = ultraChanceRoll(entry.drill, trainee(state)?.lastUltraDrill ?? null);
          g.ultraWon = g.challengeWon;
          g.repStage = "challenge-windup";
          g.repStageT0 = performance.now();
          g.repScript = TR_WINDUP;
          g.screen = "reps";
        } else {
          // As is (F0x80087cf4 unk18==4 -> state 2, rep target still 4): run TWO more
          // ordinary reps for a bigger accumulated gain (5 total), no ultra tables.
          g.challengeWon = null;
          g.ultraWon = false;
          const pct = gymRepPercent(state.equipment?.[g.trainSlot] ?? state.equipment?.[0]);
          g.repResults.push(...gymRepResults(pct, false).slice(0, 2));
          g.repStage = "windup"; // continue the ordinary rep loop at repIdx (=3)
          g.repStageT0 = performance.now();
          g.repScript = TR_WINDUP;
          g.screen = "reps";
        }
        return true;
      }
      return true;
    }
    if (g.screen === "result") {
      if (k === "circle") {
        sfx?.play("system07");
        // The message pauses between its pages, so a press turns the page
        // first and only closes the session on the last one.
        if (g.resultPage < g.resultPages.length - 1) { g.resultPage += 1; return true; }
        g.resultPages = [];
        g.resultPage = 0;
        g.ultraOffered = g.ultraWon = g.challengeShown = false;
        g.challengeWon = null;
        g.screen = "drill";
        g._animStart("drill");
      }
      return true;
    }
    return true;
  };

  // Large animated drill-icon header shown on the TP-picker and confirm
  // ("Is this ok?") screens — F0x80088348's arg0->unkA0 block: reads the
  // SAME per-drill frame table as the drill grid (0x8008D2A8 == 0x8008cfcc
  // +0x2dc, live rig RAM read 2026-07-12, stgtrain_ui.json
  // drill_icon_grid.frames), drawn at (0x94,0x14)=(148,20), 4-frame cycle
  // every 0x10=16 vsyncs (~267ms). Unlike the grid's per-cell icons this one
  // always shows the currently-confirmed drill, continuously animating.
  function drawLargeDrillIcon(ctx) {
    const dig = LAYOUT?.drill_icon_grid;
    const sel = g.drills[g.drillSel];
    const iconFrames = sel && dig?.frames?.[ESTRAINI_IDX[sel.drill]];
    if (iconFrames && packReady(sttrngDrills)) {
      const f = iconFrames[Math.floor(performance.now() / (dig.frameStepMs ?? 320)) % iconFrames.length];
      drawClip(ctx, sttrngDrills, f, 148, 20);
    }
  }

  // The plates the confirm and TP screens sit on (stgtrain_ui.json
  // confirm_chrome.plates, F0x80088348). Each one is a separate fold on the
  // real screen, so the caller names the roles this screen shows. Returns true
  // when at least one plate was drawn, so a caller can fall back to a box.
  function confirmPlates(ctx, roles) {
    const plates = LAYOUT?.confirm_chrome?.plates;
    if (!plates || !packReady(sttrngChrome)) return false;
    let drew = false;
    for (const role of roles) {
      const pl = plates.find((q) => q.role === role);
      if (!pl) continue;
      drawClip(ctx, sttrngChrome, pl.clip, pl.x, pl.y);
      drew = true;
    }
    return drew;
  }

  // Mid-training viewport ("[image] your Digimon working out against a bag").
  // stgtrain.s has NO dedicated spawn/draw code for this in its own overlay —
  // exhaustively checked: only 5 resident (sub-0x80082cb0) calls exist in the
  // whole file (alloc, cursor glyph, vtable-populate ×2), only 6 vtable draw
  // slots exist (all already accounted for by the chrome functions above),
  // and the only extra pack handle (0x286) resolves to LBA_CMFONTCS_BIN_IDX
  // (cmfont — generic UI glyphs), not a character asset. So the sprite is
  // not spawned by stgtrain code at all; live RAM diffing during the actual
  // animation (savestate captured 2026-07-12) instead shows the same
  // resident particle/actor-pool activity this project already documented
  // for other field effects — consistent with stgtrain repositioning the
  // ALREADY-RESIDENT party-follower sprite actor rather than owning it.
  // Box geometry below is NOT measured (corrected 2026-08-05): the rep-loop
  // function F0x80086c0c draws chrome clip 0x28 at (114,75) outright, and the
  // box extends to 299,178 by that clip's own 186x104 size. The 2026-07-12
  // screenshot measurement landed on the same numbers, which is why nobody
  // caught that the draw call was there all along.
  // Sprite content: TRANIN packs (drawTraninScene) — trainee plus the shared
  // props actor (punching bag / desk / etc). Fallback while those packs load:
  // the small sttrng3 category sprite, then the field walk sheet. Neither
  // fallback invents a punch clip; TRANIN already owns the bag and the
  // idle/hit/miss scripts.
  // TRANIN scene anchors are PER DRILL FAMILY — see TRANIN_ANCHORS above.
  // (Punch verified via rig framebuffer; Study via a real PS1 capture; the
  // rest use the Punch anchor pending calibration in gym-lab.html.)

  // anim = { script, elapsed } to play a specific beat once (and hold the last
  // frame); omit it to loop the ready stance (script 0), used on the ultra
  // banner screen where the scene idles behind the menu.
  function drawTrainingViewport(ctx, state, anim = null) {
    const box = LAYOUT?.training_viewport ?? {
      x0: 114, y0: 75, x1: 299, y1: 178, window_clip: 0x28,
    };
    // F0x80086c0c draws chrome clip 0x28 at (114,75) — training_viewport in
    // stgtrain_ui.json. The Digimon sprite inside is not stgtrain-owned.
    if (packReady(sttrngChrome)) {
      drawClip(ctx, sttrngChrome, box.window_clip ?? 0x28, box.x0, box.y0);
    }
    else drawWindow(ctx, null, null, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    // Full native training scene from the TRANIN packs: the shared props actor
    // (punching bag/chain/mount + per-drill props, subdir 8) plus the trainee's
    // large per-starter workout animation (subdir = sprite category), playing in
    // lockstep with their native per-clip scene offsets. The rep state machine
    // feeds `anim` (wind-up / hit / miss / win / lose); with no anim they loop the
    // ready stance.
    const member = g.roster[g.trainSlot];
    const cat = TRAIN_CATEGORY_BY_NAME[member?.profile?.name];
    const fam = traninFamily(g.drills[g.drillSel]?.drill ?? 1);
    if (cat != null) {
      const props = traninEntry(`${fam}_s8`);
      const digi = traninEntry(`${fam}_s${cat}`);
      const anch = traninAnchors(fam);
      const idx = anim ? anim.script : TR_INTRO;
      const el = anim ? anim.elapsed : performance.now();
      const loop = !anim;
      const sc = g.actorScale / ACTOR_SCALE_UNITY;
      if (sc <= 0) return;
      const scaled = sc < 1;
      if (scaled) {
        ctx.save();
        ctx.translate(anch[0], anch[1]);
        ctx.scale(sc, sc);
        ctx.translate(-anch[0], -anch[1]);
      }
      const { drewDigi, drewProps } = drawTraninScene(ctx, digi, props, idx, el, ...anch, loop);
      if (scaled) ctx.restore();
      if (drewDigi) return;
      if (drewProps) { /* fall through to small-sprite digimon below */ }
    }
    // Fallback while TRANIN assets load: stgtrain's small per-starter
    // category sprite (the pods/card clips), position pixel-measured.
    const nat = trainSpriteClip(member, Math.floor(performance.now() / 260));
    if (nat != null && packReady(sttrngChrome)) {
      drawClip(ctx, sttrngChrome, nat, 190, 148);
      return;
    }
    const charId = state.party?.[g.trainSlot];
    const meta = charId && state.manifest?.characters?.find((c) => c.id === charId);
    const sheet = charId && state.charImgs?.[charId];
    if (!meta || !(sheet instanceof Image)) return;
    const row = meta.rows.indexOf("right");
    if (row === -1) return;
    const x = 190, y = 172, frame = Math.floor(performance.now() / 200) % (meta.frameCounts?.right ?? 5);
    ctx.drawImage(
      sheet, frame * meta.frameW, row * meta.frameH, meta.frameW, meta.frameH,
      Math.round(x - meta.frameW / 2), Math.round(y - meta.frameH), meta.frameW, meta.frameH,
    );
  }

  g.draw = (ctx, w, h, state) => {
    if (!g._open) return;
    const now = performance.now();
    g.time = now / 1000;
    if (g.actorScale < ACTOR_SCALE_UNITY) {
      const frames = Math.max(0, Math.floor((now - g.actorScaleT0) / VSYNC_MS));
      g.actorScale = Math.min(ACTOR_SCALE_UNITY, frames * ACTOR_SCALE_IN_DELTA);
    }
    if (g.fadeLeaving) {
      const frames = Math.max(0, Math.floor((now - g.fadeT0) / VSYNC_MS));
      if (frames * LEAVE_FADE_DELTA >= LEAVE_FADE_MAX) { close(); return; }
    }
    const s = Math.max(1, Math.min(w / 320, h / 240));
    ctx.save();
    ctx.scale(s, s);
    const vw = w / s, vh = h / s;
    const L = LAYOUT;
    const chromeReady = L && packReady(sttrngChrome);
    const fold = (key, px, py, axis, fn) => {
      const tr = ui.foldTransformAtTime(g.time, g._anim[key] ?? null, px, py, axis, ANIM_T);
      if (tr.progress <= 0) return 0;
      if (tr.ready) { fn(); return 1; }
      ctx.save();
      ctx.translate(tr.pivotX, tr.pivotY);
      ctx.scale(tr.scaleX, tr.scaleY);
      ctx.translate(-tr.pivotX, -tr.pivotY);
      fn();
      ctx.restore();
      return tr.progress;
    };

    // Native cave-wall training-ground backdrop, and it SCROLLS — the extractor
    // recorded it as a "static first frame; toggle cadence open gap", and the
    // cadence is now decoded. stgtrain.s L1866-L1893: the counter at +0x5c is
    // incremented by 1 only on frames where the +0x60 toggle is already set,
    // resets at 0x60, and is passed as both x and y of the draw (`move_ $a3,
    // $a2` in the jalr delay slot) — the same shape all nine scrolling walls
    // share, so it goes through the shared renderer.
    //
    // STILL OPEN: that draw takes its CLIP from the object field +0x58, not an
    // immediate, so the wall is chosen when the screen object is built (the
    // constructor stores it at stgtrain.s L246). sttrng3 holds eight of these
    // mosaics (0x2d..0x34), presumably one per training ground, but which
    // ground selects which is NOT established. The clip stays the layout's
    // recorded value.
    // Falls back to a plain fill until the pack/layout finish loading.
    if (chromeReady) {
      drawPackBackdrop(ctx, sttrngChrome, L.cave_backdrop.clip, 320, 240);
    } else {
      ctx.fillStyle = "#101018";
      ctx.fillRect(0, 0, vw, vh);
    }

    // ── Persistent left HUD (F0x80084838, ALL native stgtrain chrome) ──
    // Card: sttrng3 0x1F + cmfont 0xE @(0,0xF), category sprite @(0x10,0x16).
    // Stat panel: sttrng3 0x20 + cmfont 0xF (the shared 6-core/7-res stat-icon
    // composite the status screen also draws) @(0,0x4B).
    // TP plate: sttrng3 0x21 @(0,0xB6). hud.tp_plate — x=0 with the left column.
    // Sprite content on the card reuses the DRI portrait table (documented
    // substitution — stgtrain's own species->category resolver is unlocated;
    // see podAnimClipFor comment). Values mirror menu.js's status screen
    // (live stats with profile fallback; resistances + gym elem bonuses).
    {
      const member = g.roster[g.screen === "select" ? g.selSlot : g.trainSlot];
      const frame = Math.floor(performance.now() / 200);
      const fontReady = packReady(cmfont);
      if (chromeReady) drawClip(ctx, sttrngChrome, 0x1f, 0, 0x0f);
      if (fontReady) drawClip(ctx, cmfont, 0x0e, 0, 0x0f);
      if (member) {
        const natClip = trainSpriteClip(member, Math.floor(performance.now() / 260));
        const cardClip = podAnimClipFor(member.profile?.id ?? -1, frame);
        if (natClip != null && chromeReady) drawClip(ctx, sttrngChrome, natClip, 0x10, 0x16);
        else if (cardClip != null && packReady(dglab)) drawClip(ctx, dglab, cardClip, 0x10, 0x16);
        // One widget per field, at the native place, with the numbers right-
        // aligned on their own column (stgtrain_ui.json hud_text; ctor
        // F0x80083aec, fill F0x80083d10). The walker used to glue each label
        // and its padded number into one left-aligned string, which put every
        // digit in the wrong column and both lower rows on the wrong line.
        const HT = L?.hud_text ?? HUD_TEXT;
        const num = (v, x, y, opts) =>
          drawText(ctx, String(v ?? 0), x, y, { alignRight: true, ...opts });
        drawText(ctx, member.name, HT.name.x, HT.name.y, { kind: HT.name.kind });
        const lv = HT.level, gold = { kind: lv.kind, color: "#ffd840" };
        drawText(ctx, say(ROLE("hud_labels")?.level), lv.labelX, lv.y, gold);
        num(member.level, lv.valueX, lv.y, gold);
        const pair = (row, label, cur, max, curOpts, maxOpts) => {
          drawText(ctx, label, row.labelX, row.y, { kind: row.kind });
          num(cur, row.curX, row.y, { kind: row.kind, ...curOpts });
          drawText(ctx, say(ROLE("hud_labels")?.separator), row.sepX, row.y, { kind: row.kind });
          num(max, row.maxX, row.y, { kind: row.kind, ...maxOpts });
        };
        pair(HT.hp, say(ROLE("hud_labels")?.hp), member.hp, member.maxHp,
          hudDeltaOpts("hp"), hudDeltaOpts("maxHp", { color: "#ffd840" }));
        pair(HT.mp, say(ROLE("hud_labels")?.mp), member.mp, member.maxMp,
          hudDeltaOpts("mp"), hudDeltaOpts("maxMp", { color: "#ffd840" }));
      }
      if (chromeReady) drawClip(ctx, sttrngChrome, 0x20, 0, 0x4b);
      if (fontReady) drawClip(ctx, cmfont, 0x0f, 0, 0x4b);
      if (member) {
        // Six core numbers and seven resistance numbers, each right-aligned on
        // its own column (stgtrain_ui.json hud_text.core / hud_text.res, fill
        // F0x80084064). The old x=56/x=100 were measured off a screenshot; the
        // native columns are 51 and 93.
        const HT2 = L?.hud_text ?? HUD_TEXT;
        const prof = member.profile, st = member.stats;
        const core = HT2.core, resC = HT2.res;
        CORE_ROWS.slice(0, core.rows).forEach((stat, i) => {
          drawText(ctx, String(st?.stats?.[stat] ?? prof?.[stat] ?? 0),
            core.x, core.y0 + i * core.stepY,
            hudDeltaOpts(stat, { alignRight: true, kind: core.kind }));
        });
        RES_ROWS.slice(0, resC.rows).forEach((res, i) => {
          // The HUD's seven resist rows are the F0x80017174 scratch halfwords the
          // original's own fill reads (stgtrain's `[ctx+0x2734]` call), so they
          // come from the one shared helper: the species base plus every trained
          // point plus the worn gear's coded resist, capped at 999. The worn
          // slots are the ones the original reads for this member.
          const slot = state.equipment?.[member.index ?? g.trainSlot] ?? {};
          const worn = equipmentBonuses(slot).elemResists ?? {};
          const v = elementValue(prof, { ...(st?.elemBonuses ?? {}), ...worn }, res);
          drawText(ctx, String(v), resC.x, resC.y0 + i * resC.stepY,
            hudDeltaOpts(res, { alignRight: true, kind: resC.kind }));
        });
      }
      if (chromeReady) drawClip(ctx, sttrngChrome, 0x21, 0, 0xb6);
      else drawWindow(ctx, null, null, 0, 182, 76, 25);
      // TP label and its number are two widgets, the number right-aligned
      // (hud_text.tp; ctor F0x80083aec +0x60/+0x64, fill F0x80084270).
      const tpL = (L?.hud_text ?? HUD_TEXT).tp;
      drawText(ctx, say(ROLE("hud_labels")?.tp), tpL.labelX, tpL.y, { kind: tpL.kind });
      drawText(ctx, String(member?.stats?.tp ?? 0), tpL.valueX, tpL.y,
        { kind: tpL.kind, alignRight: true });
    }

    if (g.screen === "select") {
      // Pod-select row (F0x80084838, live rig-verified 2026-07-12 + full
      // chrome decompiled 2026-07-12b — ALL of it stgtrain's own clips now,
      // no DRI-pack substitution left except the pod sprite CONTENT, whose
      // species->category resolver is still unlocated):
      //   top plate  sttrng3 0x27 @(0x8F,0xF), text @(0xA5,0x16)
      //   banner     sttrng3 0x22 @(0x92,0x43), text @(0xAE,0x49)
      //   window     sttrng3 0x24 @(0x8F,0x5F)
      //   towers     cmfont 0x11 @(0x8F,0x5F) behind, glint 0x10 in front
      //   pods       category sprite @(0xA4+0x30*i, 0x81)
      //   cursor     cmfont 0xD @(0xA4+0x30*sel, 0x65), CLUT-cycled
      const podReady = chromeReady && packReady(cmfont);
      const frame = Math.floor(performance.now() / 200);
      const SC = L?.select_chrome;
      if (podReady && SC) {
        drawClip(ctx, sttrngChrome, SC.top_plate.clip, SC.top_plate.x, SC.top_plate.y);
        // textX/textY come from the file now: the native anchor is (161,23),
        // not the (165,22) this line used to carry.
        drawText(ctx, say(ROLE("stop_training")),
          SC.top_plate.textX, SC.top_plate.textY);
        drawClip(ctx, sttrngChrome, SC.banner.clip, SC.banner.x, SC.banner.y);
        drawText(ctx, say(ROLE("train_which_digimon")), SC.banner.textX, SC.banner.textY);
        drawClip(ctx, sttrngChrome, SC.window.clip, SC.window.x, SC.window.y);
        drawClip(ctx, cmfont, SC.towers.cmfont_clip, SC.towers.x, SC.towers.y);
      } else {
        drawWindow(ctx, null, null, 143, 60, 170, 22);
        drawText(ctx, say(ROLE("train_which_digimon")), 150, 66);
      }
      g.roster.forEach((member, i) => {
        const pods = SC?.pods ?? { x0: 164, stepX: 48, y: 129 };
        const x = pods.x0 + i * pods.stepX, y = pods.y;
        // Native sttrng3 category sprite (13-vsync cadence); DRI portrait
        // only as fallback for non-starter edge cases.
        const nat = trainSpriteClip(member, Math.floor(performance.now() / 260));
        const clip = nat ?? podAnimClipFor(member.profile?.id ?? -1, frame);
        if (nat != null && chromeReady) drawClip(ctx, sttrngChrome, nat, x, y);
        else if (clip != null && packReady(dglab)) drawClip(ctx, dglab, clip, x, y);
        else { ctx.fillStyle = "#335"; ctx.fillRect(x - 12, y - 16, 24, 32); }
      });
      if (podReady) drawClip(ctx, cmfont, 0x10, 0x8f, 0x5f); // glass glint (front)
      if (packReady(cmfont)) {
        const pc = SC?.pod_cursor ?? { x0: 164, stepX: 48, y: 101 };
        const beamX = pc.x0 + g.selSlot * pc.stepX;
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.45 * (Math.floor(performance.now() / 165) % 4) / 3;
        drawClip(ctx, cmfont, pc.cmfont_clip ?? 0x0d, beamX, pc.y);
        ctx.restore();
      }
    }

    if (g.screen !== "select") {

    // Header banner — the native banner slot (sttrng3 0x22 @(0x92,0x43),
    // F0x8008a524 line "sp94(chrome,0x22,0x92,0x43)"; text at the DRI-style
    // (0xAE,0x49) anchor). Not drawn mid-training: the live mid-training
    // screenshot shows no title there and the slot overlaps the viewport.
    // Not drawn while the training scene is up. The result page keeps that
    // scene, and the session object draws no banner over it, so "result"
    // belongs in this list beside "reps" and "ultra" -- it used to fall
    // through and print "Which training?" over the finished session.
    // Only the drill grid uses this banner. The TP picker and the "Is this
    // ok?" prompt belong to the OTHER object (F0x80088348), which carries its
    // own wider banner plate (confirm_chrome role "banner", clip 0x26 at
    // (133,67)) and draws it as part of its own plate stack below. Until
    // 2026-09-04 both screens drew this plate here and then covered the line
    // with their own plates, which is why the prompt was blank.
    if (g.screen === "drill") {
      if (chromeReady) drawClip(ctx, sttrngChrome, 0x22, 0x92, 0x43);
      else drawWindow(ctx, null, null, 146, 62, 170, 20);
      drawText(ctx, say(ROLE("which_training")), 0xae, 0x49);
    }

    if (g.screen === "drill") {
      // Drill icon grid — fully native (F0x8008a524, re-read 2026-07-12b):
      //   window   sttrng3 0x24 @(0x8F,0x5F)
      //   icons    sttrng0 anim frames @(0x94+40*col, 0x64+40*row) — the old
      //            (168,118) numbers were the SCALE-PIVOT spA4 args (cell
      //            centers), not draw positions; every clip is 36x36 dx=0.
      //            Selected icon animates (4 frames, 16-vsync step) on CLUT
      //            row 0; non-selected are STATIC first-frame on CLUT row 1
      //            (dimmed) — approximated here with a brightness filter.
      //   cursor   sttrng3 0x1E (the gold frame) at the SAME cell origin,
      //            CLUT-cycled every 11 vsyncs. (The old code drew sttrng0
      //            0x1E — an ice-drill sprite — the "polar bear" artifact.)
      //   empty    slots whose table entry is -1 get sttrng3 0x5F (wooden X).
      //   paging   page 0 shows R1 (sttrng3 0x2C @(0xE4,0xA0)); later pages
      //            L1 (0x2B @(0x94,0xA0)); estraini "L1"/"R1" text labels.
      //   descr    plate sttrng3 0x23 @(0x46,0xBA); name + estraini
      //            description text at (116,192)/(116,206), traced 2026-08-05
      //            from the label ctor F0x8008a354.
      const dig = L?.drill_icon_grid ?? { cols: 4, cellW: 40, cellH: 40, iconX: 148, iconY: 100 };
      const gx = dig.iconX ?? 148, gy = dig.iconY ?? 100;
      const page = Math.floor(g.drillSel / 8);
      const pageStart = page * 8;
      const pageDrills = g.drills.slice(pageStart, pageStart + 8);
      if (chromeReady) fold("drill", 0x140, 0x8c, "y", () => drawClip(ctx, sttrngChrome, 0x24, 0x8f, 0x5f));
      else drawWindow(ctx, null, null, 143, 95, 177, 89);
      for (let i = 0; i < 8; i++) {
        const col = i % 4, row = Math.floor(i / 4);
        const x = gx + col * dig.cellW, y = gy + row * dig.cellH;
        const d = pageDrills[i];
        if (!d) {
          // Empty page-table entry: sttrng3 0x5F wooden X (F0x8008a524).
          if (chromeReady) drawClip(ctx, sttrngChrome, 0x5f, x, y);
          continue;
        }
        const iconFrames = dig.frames?.[ESTRAINI_IDX[d.drill]];
        if (iconFrames && packReady(sttrngDrills)) {
          const selected = pageStart + i === g.drillSel;
          const f = selected
            ? iconFrames[Math.floor(performance.now() / (dig.frameStepMs ?? 320)) % iconFrames.length]
            : iconFrames[0];
          if (!selected) { ctx.save(); ctx.filter = "brightness(0.55)"; }
          drawClip(ctx, sttrngDrills, f, x, y);
          if (!selected) ctx.restore();
        }
      }
      if (pageDrills.length) {
        const localSel = g.drillSel - pageStart;
        const cx = gx + (localSel % 4) * dig.cellW, cy = gy + Math.floor(localSel / 4) * dig.cellH;
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.45 * (Math.floor(performance.now() / 220) % 4) / 3;
        if (chromeReady) drawClip(ctx, sttrngChrome, 0x1e, cx, cy);
        else { ctx.strokeStyle = "#ffd24a"; ctx.lineWidth = 2; ctx.strokeRect(cx, cy, 36, 36); }
        ctx.restore();
      }
      if (g.drills.length > 8) {
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.45 * (Math.floor(performance.now() / 220) % 4) / 3;
        // grid_chrome.page_arrow (F0x8008a524 for the clip, F0x8008aad4 for
        // the label): page 0 shows R1 on the right, a later page shows L1 on
        // the left, and the label moves with it.
        const pa = L?.grid_chrome?.page_arrow;
        const side = page === 0 ? pa?.first : pa?.later;
        if (side) {
          if (chromeReady) drawClip(ctx, sttrngChrome, side.clip, side.x, side.y);
          drawText(ctx, say(ROLE("page_labels")?.[page === 0 ? "next" : "prev"]),
            side.labelX, side.labelY);
        }
        ctx.restore();
      }
      const sel = g.drills[g.drillSel];
      const dp = L?.grid_chrome?.description_plate ?? { clip: 0x23, x: 70, y: 186 };
      if (chromeReady) drawClip(ctx, sttrngChrome, dp.clip, dp.x, dp.y);
      else drawWindow(ctx, null, null, dp.x, dp.y, 250, 40);
      if (sel) {
        const dt = dig.description_text ?? {
          nameX: 116, nameY: 192, descX: 116, descY: 206,
        };
        drawText(ctx, drillName(sel.drill), dt.nameX, dt.nameY);
        drawText(ctx, drillDesc(sel.drill), dt.descX, dt.descY);
      }
    }
    if (g.screen === "tp") {
      // Three boxes side by side, each with its amount written INSIDE it, and
      // a gold frame around the chosen one (stgtrain_ui.json tp_amount_menu).
      // Until 2026-09-04 the walker drew the amounts down the right-hand side
      // on the Ultra offer's rows, so they sat well below their boxes.
      //
      // PLATES FIRST, then everything that sits on them. The chosen drill is
      // still on screen while you pick the amount: its large animated icon on
      // the header plate at (148,20) and its NAME beside it at the header
      // widget's own anchor (tp_amount_menu.titleX/titleY = (188,20)) — the
      // same pair the running session shows. Both were being drawn BEFORE the
      // title plate and painted over by it, and the prompt line was lost the
      // same way, so the whole right-hand side came up as three bare boxes.
      // The row plate under the boxes is confirm_chrome role "question"
      // (clip 0x27 at (130,94)); the boxes sit on it at y=99.
      const tm = L?.tp_amount_menu ?? TP_AMOUNT_MENU;
      if (chromeReady) confirmPlates(ctx, ["title", "banner", "question"]);
      else {
        drawWindow(ctx, null, null, 143, 15, 177, 48);
        drawWindow(ctx, null, null, 133, 67, 187, 25);
        drawWindow(ctx, null, null, 130, 94, 190, 30);
      }
      drawLargeDrillIcon(ctx);
      const tpDrill = g.drills[g.drillSel];
      if (tpDrill)
        drawText(ctx, drillName(tpDrill.drill), tm.titleX, tm.titleY);
      drawText(ctx, say(ROLE("pick_tp_amount")), tm.headerX, tm.headerY);
      for (let i = 0; i < 3; i++) {
        const bx = tm.boxX0 + i * tm.boxStepX;
        if (chromeReady) drawClip(ctx, sttrngChrome, tm.boxClip, bx, tm.boxY);
        if (i === g.tpSel && chromeReady)
          drawClip(ctx, sttrngChrome, tm.cursorClip, bx, tm.boxY);
        drawText(ctx, tpAmountLabel(i), tm.labelsX[i], tm.labelY);
      }
      // Not enough TP: the state machine (F0x800888bc cases 0xA-0xD) opens the
      // PROMPT plate (0x27 at (130,127)) and writes message 0x12 into the
      // widget the ctor puts at (148,135) -- the "spare" anchor
      // confirm_prompt.spare recorded. The walker used to print the line bare
      // on the cave wall just under the boxes. Wording is the walker's own:
      // the message file is not extracted.
      if (g.tpWarn) {
        const warn = (L?.confirm_prompt ?? CONFIRM_PROMPT).spare?.[0] ?? [148, 135];
        if (chromeReady) confirmPlates(ctx, ["prompt"]);
        else drawWindow(ctx, null, null, 130, 127, 190, 30);
        drawText(ctx, say(ROLE("not_enough_tp")), warn[0], warn[1]);
      }
    }
    if (g.screen === "reps") {
      // ── Authentic rep loop (rep task F0x800871ac + widget F0x800897b8) ──
      // Reps resolve ONE AT A TIME, each gated on its animation finishing (the
      // native widget poll returns -1 until the punch anim completes, then 0/1).
      // Per rep: wind-up (script 1) → resolve. A HIT (script 2, roll success)
      // reveals a ring marker + plays 0x840001; a MISS (script 3, the bag swings
      // back and hits you) reveals an X + plays 0x840000. After the final rep a
      // win pose (script 4) or lose pose (5) plays per the last outcome. The Ultra
      // Challenge, if offered and accepted, animates one more rep before the result.
      const member = g.roster[g.trainSlot];
      const cat = TRAIN_CATEGORY_BY_NAME[member?.profile?.name];
      const fam = traninFamily(g.drills[g.drillSel]?.drill ?? 1);
      const digi = cat != null ? traninEntry(`${fam}_s${cat}`) : null;
      const props = cat != null ? traninEntry(`${fam}_s8`) : null;
      // Beat length in ms; a fixed pace before assets load keeps the flow moving.
      const FALLBACK = { [TR_INTRO]: 450, [TR_WINDUP]: 360, [TR_HIT]: 520, [TR_MISS]: 560, [TR_WIN]: 700, [TR_LOSE]: 700 };
      const durMs = (i) => Math.max(traninScriptMs(digi, i), traninScriptMs(props, i)) || FALLBACK[i] || 450;
      const now = performance.now();
      const el = now - g.repStageT0;
      const results = g.repResults;
      const advance = (stage) => { g.repStage = stage; g.repStageT0 = now; };
      switch (g.repStage) {
        case "intro":
          g.repScript = TR_INTRO;
          if (el >= durMs(TR_INTRO)) { g.repIdx = 0; advance("windup"); }
          break;
        case "windup":
          g.repScript = TR_WINDUP;
          if (el >= durMs(TR_WINDUP)) { g.repScript = results[g.repIdx] ? TR_HIT : TR_MISS; advance("resolve"); }
          break;
        case "resolve":
          // Play the punch/bag beat; on completion the native poll returns the
          // result — that is when the marker appears and the hit/miss SFX plays
          // (F0x800871ac plays 0x840001/0x840000 the frame unkC4 != -1), then the
          // next rep's poll starts.
          g.repScript = results[g.repIdx] ? TR_HIT : TR_MISS;
          if (el >= durMs(g.repScript)) {
            const ok = results[g.repIdx];
            sfx?.play(ok ? "system07" : "system02");
            g.repShown = g.repIdx + 1;
            g.repIdx += 1;
            if (g.repIdx >= results.length) {
              // First three all O's (no extension yet) -> the Ultra bonus (state 0xA):
              // super/starred drills show the Challenge/As-is menu, basic drills auto-
              // run one high-value bonus rep. Otherwise finish.
              const perfect3 = results.length === 3 && results.every(Boolean);
              if (perfect3 && g.ultraOffered) {
                if (g.superDrill) { sfx?.play("system07"); g.ultraSel = 0; g.screen = "ultra"; }
                else {
                  const entry = g.drills[g.drillSel];
                  g.challengeWon = ultraChanceRoll(entry.drill, trainee(state)?.lastUltraDrill ?? null);
                  g.ultraWon = g.challengeWon;
                  g.repScript = TR_WINDUP; advance("challenge-windup");
                }
              } else advance("endpose");
            } else advance("windup");
          }
          break;
        case "endpose":
          g.repScript = results[results.length - 1] ? TR_WIN : TR_LOSE;
          if (el >= durMs(g.repScript)) runTraining(state);
          break;
        case "challenge-windup":
          g.repScript = TR_WINDUP;
          if (el >= durMs(TR_WINDUP)) { g.repScript = g.challengeWon ? TR_HIT : TR_MISS; advance("challenge-resolve"); }
          break;
        case "challenge-resolve":
          g.repScript = g.challengeWon ? TR_HIT : TR_MISS;
          if (el >= durMs(g.repScript)) {
            sfx?.play(g.challengeWon ? "system07" : "system02");
            g.challengeShown = true; // the bonus rep's 4th marker
            advance("challenge-pose");
          }
          break;
        case "challenge-pose":
          g.repScript = g.challengeWon ? TR_WIN : TR_LOSE;
          if (el >= durMs(g.repScript)) runTraining(state);
          break;
      }
      drawTrainingViewport(ctx, state, { script: g.repScript, elapsed: el });
      // Mid-training header (F0x80088348: plate sttrng3 0x25 @(0x8F,0xF),
      // large drill icon @(0x94,0x14), TP box 0x2A @(0xBC,0x26)) — live
      // capture shows icon + drill name + "TP n" on the top-right plate.
      if (chromeReady) confirmPlates(ctx, ["title"]);
      drawLargeDrillIcon(ctx);
      drawText(ctx, drillName(g.drills[g.drillSel]?.drill), 0xbe, 0x14);
      if (chromeReady) confirmPlates(ctx, ["icon_frame"]);
      drawText(ctx, tpAmountLabel(g.tpSel), 0xc2, 0x29);
      // The description plate stays on screen for the whole session, with the
      // drill's name and description on it: F0x8008706c opens the viewport
      // fold (+0xF4) and the plate fold (+0x104) together when the session
      // starts, and F0x80086c0c draws clip 0x23 at (70,186) while it is open.
      // The walker used to show nothing along the bottom edge during reps.
      {
        const sdp = L?.session_chrome?.description_plate;
        const sd = g.drills[g.drillSel];
        if (chromeReady && sdp) drawClip(ctx, sttrngChrome, sdp.clip, sdp.x, sdp.y);
        if (sd && sdp) {
          const dt = (L?.drill_icon_grid ?? {}).description_text
            ?? { nameX: 116, nameY: 192, descX: 116, descY: 206 };
          drawText(ctx, drillName(sd.drill), dt.nameX, dt.nameY);
          drawText(ctx, drillDesc(sd.drill), dt.descX, dt.descY);
        }
      }
      // Rep-marker row (F0x80086c0c): 5 slots at x=128+17*i, y=88; a resolved
      // rep draws ring clip 0x45 (hit) or X clip 0x46 (miss), an unresolved one
      // is NOT drawn — so markers appear one-by-one exactly on each resolve beat,
      // synced to the animation. The newest CLUT-pulses (rows 1/2 every 3 vsyncs).
      const rr = L?.rep_row ?? { x: 128, y: 88, stepX: 17, count: 5, iconOk: 69, iconFail: 70 };
      const slots = rr.count ?? 5;
      if (!chromeReady) drawWindow(ctx, null, null, rr.x - 16, rr.y - 15, rr.stepX * slots + 32, 30);
      const drawMark = (i, ok, pulse) => {
        const x = rr.x + i * rr.stepX, y = rr.y;
        ctx.save();
        if (pulse) ctx.globalAlpha = 0.55 + 0.45 * (Math.floor(now / 60) % 2);
        if (chromeReady) drawClip(ctx, sttrngChrome, ok ? rr.iconOk : rr.iconFail, x - 8, y - 8);
        else {
          ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.strokeStyle = ok ? "#4aa3ff" : "#c33"; ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.restore();
      };
      for (let i = 0; i < g.repShown; i++) drawMark(i, results[i], !g.challengeShown && i === g.repShown - 1);
      // The bonus/challenge rep occupies the next slot (4th after a perfect three).
      if (g.challengeShown) drawMark(results.length, g.challengeWon, true);
    }
    if (g.screen === "confirm") {
      // Native confirm chrome (stgtrain_ui.json confirm_chrome, F0x80088348):
      // the title plate, its banner, the box holding the chosen amount, the
      // question plate the Yes/No row sits on, and the prompt plate under it.
      // PLATES FIRST — the icon and the drill name go ON the title plate, and
      // drawing them first (until 2026-09-04) meant the plate covered them,
      // leaving the header showing only the amount box.
      const cp = L?.confirm_prompt ?? CONFIRM_PROMPT;
      const tmC = L?.tp_amount_menu ?? TP_AMOUNT_MENU;
      // The Yes/No pair sits on the TALL plate (confirm_chrome role "result",
      // clip 0x1D at (130,94), 42 rows deep), not on the 30-deep "question"
      // plate the TP boxes use: F0x800888bc case 0x10 shuts the question fold
      // (+0xC8) and opens +0xB8 instead before case 0x11 writes "Yes"/"No".
      // Sitting the rows on the short plate is why "No" hung over its edge.
      if (chromeReady)
        confirmPlates(ctx, ["title", "banner", "icon_frame", "result"]);
      else {
        drawWindow(ctx, null, null, 143, 15, 177, 48);
        drawWindow(ctx, null, null, 133, 67, 187, 25);
        drawWindow(ctx, null, null, 130, 94, 190, 42);
      }
      drawLargeDrillIcon(ctx);
      const cDrill = g.drills[g.drillSel];
      if (cDrill)
        drawText(ctx, drillName(cDrill.drill), tmC.titleX, tmC.titleY);
      drawText(ctx, say(ROLE("is_this_ok")), cp.headerX, cp.headerY);
      // Option rows at the native F0x80088214 text anchors ((0xA2,0x64) and
      // (0xA2,0x74) = (162,100)/(162,116)), cursor in the same x=148 column
      // the TP menu uses. Glyph is the shared [arrow-right] (F0x8001b364).
      drawText(ctx, tpAmountLabel(g.tpSel), cp.amountX, cp.amountY);
      [say(ROLE("yes")), say(ROLE("no"))].forEach((t, i) => {
        const y = cp.rowsY[i] ?? cp.rowsY[0] + i * cp.cursorStepY;
        if (i === g.confirmSel)
          drawText(ctx, "[arrow-right]", cp.cursorX,
            cp.cursorY0 + i * cp.cursorStepY);
        drawText(ctx, t, cp.rowsX, y);
      });
    }
    if (g.screen === "ultra") {
      // The Ultra offer appears OVER the mid-training viewport: native
      // plates sttrng3 0x26 @(0x85,0x70) and 0x1D @(0x82,0x8B) (F0x80086c0c
      // unk11C/unk12C blocks) with the banner text + Challenge/As-is choice.
      drawTrainingViewport(ctx, state);
      // session_chrome.bar / .panel (F0x80086c0c unk11C/unk12C).
      const sch = L?.session_chrome;
      if (chromeReady && sch) {
        drawClip(ctx, sttrngChrome, sch.bar.clip, sch.bar.x, sch.bar.y);
        drawClip(ctx, sttrngChrome, sch.panel.clip, sch.panel.x, sch.panel.y);
      } else {
        drawWindow(ctx, null, null, 130, 108, 180, 60);
      }
      // ultra_menu: the banner and the two answers this object really owns
      // (the walker used to place them by eye a few pixels off).
      const um = L?.ultra_menu ?? ULTRA_MENU;
      drawText(ctx, say(ROLE("ultra_chance")), um.bannerX, um.bannerY);
      [say(ROLE("challenge")), say(ROLE("as_is"))].forEach((t, i) => {
        const y = um.rowsY[i] ?? um.rowsY[0] + i * um.cursorStepY;
        if (i === g.ultraSel)
          drawText(ctx, "[arrow-right]", um.cursorX,
            um.cursorY0 + i * um.cursorStepY);
        drawText(ctx, t, um.rowsX, y);
      });
    }
    if (g.screen === "result") {
      // The training scene stays on screen with the result, frozen on the final
      // win/lose pose (native: the result window opens OVER the still-running
      // viewport actor — the scene doesn't get torn down until you leave). Draw
      // it held on its last frame (large elapsed clamps drawTraninScript to the
      // final frame) BEFORE the result box, same as the ultra screen does.
      drawTrainingViewport(ctx, state, { script: g.repScript ?? TR_WIN, elapsed: 1e7 });
      // What a finished session says goes into ONE message widget on the
      // bottom plate, with the plate's second text widget hidden
      // (stgtrain_ui.json session_result; F0x8008706c case 5 sets the message,
      // its one or two numbers, then the plate's palette byte to 0 (+0x138(0),
      // the +0xC0 row drawText reads as `clut`) and its text reveal rate to 6
      // (+0x130(6), the +0xAA the widget tick counts between characters).
      // CORRECTED 2026-10-06: the 6 was filed here as a palette; the palette
      // is 0 and the 6 is the reveal rate. The message brings its own line
      // break and its own pauses, so it can run to two lines and two pages --
      // see resultPages above.
      //
      // CORRECTION 2026-09-04: this used to draw a before / arrow / after
      // table at y=102, on the reading that F0x80088214's three widgets there
      // were the result columns. They are the three TP amount labels, one
      // inside each amount box, so the table was both in the wrong place and
      // the wrong shape. The walker then wrote its own English ("STR +3") for
      // one pass; it now says what the game says.
      const sr = L?.session_result ?? { lineX: 116, lineY: 192, clut: 0, revealRate: 6 };
      const sdp2 = L?.session_chrome?.description_plate;
      if (chromeReady && sdp2) drawClip(ctx, sttrngChrome, sdp2.clip, sdp2.x, sdp2.y);
      else drawWindow(ctx, null, null, 70, 186, 250, 40);
      // The second line steps by the same 14 the plate's own two lines use
      // (drill_icon_grid.description_text, 192 and 206). NOT separately
      // measured: the message widget owns its line spacing.
      const step = sr.lineStepY ?? 14;
      (g.resultPages[g.resultPage] ?? []).forEach((line, i) => {
        drawText(ctx, line, sr.lineX, sr.lineY + i * step, { clut: sr.clut });
      });
    }
    } // g.screen !== "select"
    // Mid-training page-turn glyph: cmfont 0xA at (292,205), CLUT 0-4 every
    // 4 vsyncs (F0x80086c0c). The old generic "Stop training" footer is not
    // this slot — triangle does not leave during reps.
    if (g.screen === "reps" || g.screen === "ultra" || g.screen === "result") {
      if (packReady(cmfont)) {
        const pg = L?.session_chrome?.page_glyph
          ?? { clip: 0x0a, x: 292, y: 205, frames: 5 };
        const row = Math.floor(now / 80) % (pg.frames ?? 5);
        drawClip(ctx, cmfont, `${pg.clip}#${row}`, pg.x, pg.y)
          || drawClip(ctx, cmfont, pg.clip, pg.x, pg.y);
      }
    }
    if (g.fadeLeaving) {
      const frames = Math.max(0, Math.floor((now - g.fadeT0) / VSYNC_MS));
      const a = Math.min(255, (frames * LEAVE_FADE_DELTA) >> 8) / 255;
      paintScreenDim(ctx, a * 255, 320, 240);
    }
    ctx.restore();
  };

  return g;
}
