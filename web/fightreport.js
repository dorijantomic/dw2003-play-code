// web/fightreport.js — the post-fight results screen (stfgtrep).
//
// Row/page builders stay in web/battle.js; this file is the screen a player
// meets after a fight. Geometry is stfgtrep_ui.json
// (tools/extract_stfgtrep_ui.py plus F0x80083744 sparkle/flourish).
//
// SCREEN-OBJECT-METHODS-001 (stfgtrep), names as re-read by
// SCREEN-OBJECT-NAME-AUDIT-001:
//   start_report_fade  — the shared fade start; the thirty frames are this
//                        screen's call, not a property of the routine
//   start_row_open/close — partner panel fold start (states 1 / 0xB)
//   start_learned_move_announcements — the row object's state 0x14. The audit
//                        reads it as the per-partner learned-move announcement
//                        loop, with experience applied after the loop ends. Our
//                        page builder still emits the EXP page first; whether
//                        the disc shows a page before that loop is NOT settled.
//   row_exp_share_once — a fifth larger if either accessory slot holds the EXP
//                        Adapter, applied on the FIRST call only. Our reward
//                        maths recomputes from the base, so it is idempotent and
//                        needs no latch.
//   enable_row_flourish — the overlay's colour cycle: four steps at five frames
//                        each, twenty frames to a loop (NOT a four-frame cycle)
//
// Partner-card slide pixel path: the open/close slots only write those state
// ids; the motion itself is a resident fold widget at +0x148 whose pivot is
// not in the layout table. Rows therefore sit at the decoded rest positions
// once the open wait has landed. Do not invent an offset.

import { paintScreenDim } from "./screendim.js";
import { loadPack, drawClip, packReady, drawClipAtPaletteRow } from "./screenpack.js";
import { fitNativeScreen } from "./canvas-resolution.js";
import { drawText as uiDrawText, fontReady as uiFontReady } from "./uifont.js";
import { ui } from "./vendor/engine.js";
import {
  buildFightReportRows,
  buildFightReportPages,
  fightReportGroupGeom,
  fightReportGroupCount,
  fightReportPortraitClip,
  fightReportCycleRow,
  fightReportRampRow,
  fightReportMarkedSlot,
  expCountDisplayed,
  EXPADAPTER_ID,
} from "./battle.js";

const NATIVE_W = 320;
const NATIVE_H = 240;
const VSYNC_S = 0.02; // PAL 50 Hz, same beat as shop/gym leave fades

// start_report_fade: 8.8 dim word 0 → 0xFF00 in 30 frames, then the screen
// is gone. Same shape as the shop/gym leave dim.
const LEAVE_FADE_FRAMES = 0x1E;
const LEAVE_FADE_MAX = 0xFF00;
const LEAVE_FADE_DELTA = Math.trunc(LEAVE_FADE_MAX / LEAVE_FADE_FRAMES);

// F0x80085c90: panel open is 10 vsyncs; close runs at twice that speed.
const ROW_OPEN_FRAMES = 10;
const ROW_CLOSE_FRAMES = 5;

// F0x80083744 unk68: the CLUT wraps 0..3, one step every 5 vsyncs — four steps
// of five frames, twenty frames to a loop.
const FLOURISH_FRAMES = 4;
const FLOURISH_STEP_VSYNC = 5;
const EXP_CAP = 999999;
const CHROME_FOLD_S = ROW_OPEN_FRAMES * VSYNC_S;

// Row object +0x10 (F0x80084a08 / 84a14 / 84a20).
const ROW_STATE = Object.freeze({
  OPEN: 1,
  OPEN_WAIT: 2,
  SETTLED: 5,
  CLOSE: 0xB,
  CLOSE_WAIT: 0xC,
  CLOSED: 0xF,
  COUNTUP: 0x14,
});

const stfrptChrome = loadPack("stfrpt");

let LAYOUT = null;
if (typeof fetch !== "undefined") {
  fetch("assets/data/stfgtrep_ui.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { LAYOUT = j; })
    .catch(() => {});
}

export {
  buildFightReportRows,
  buildFightReportPages,
  fightReportGroupGeom,
  fightReportGroupCount,
  fightReportPortraitClip,
  fightReportCycleRow,
  fightReportRampRow,
  fightReportMarkedSlot,
  expCountDisplayed,
  EXPADAPTER_ID,
  LEAVE_FADE_FRAMES,
  FLOURISH_FRAMES,
  ROW_STATE,
  EXP_CAP,
};

// row_exp_share: n + n/5 when accessory 0x141 (321) is on, else n.
// gcc signed /5 via 0x66666667, then add the original — for a positive
// share that is n + trunc(n/5).
export function rowExpShare(share, wearingAdapter) {
  const n = Number(share) || 0;
  if (!wearingAdapter) return n;
  return n + (n / 5 | 0);
}

export function wearingExpAdapter(equipment) {
  const eq = equipment ?? {};
  return eq.acc0 === EXPADAPTER_ID || eq.acc1 === EXPADAPTER_ID;
}

export function createFightReport(sfx = null) {
  const r = {
    _open: false,
    vsync: 0,
    time: 0,
    rows: [],
    pages: [],
    pageIndex: 0,
    rowPhase: [],
    rowAge: [],
    countFrames: 0,
    flourishOn: false,
    flourishFrame: 0,
    flourishAge: 0,
    fadeLeaving: false,
    fadeFrames: 0,
    onClose: null,
  };

  r.isOpen = () => r._open;

  r.open = (opts = {}) => {
    r._open = true;
    r.vsync = 0;
    r.time = 0;
    r.pageTime = 0;
    r.rows = Array.isArray(opts.rows) ? opts.rows : [];
    // The corner badge shows the battle's EXP total, not one partner's share.
    r.rewardXp = Number(opts.rewardXp) || 0;
    const adapterByIndex = opts.adapterByIndex ?? {};
    r.pages = (opts.pages ?? []).map((page) => {
      if (page?.kind !== "exp") return { ...page };
      const share = Number(page.value) || 0;
      const boosted = rowExpShare(share, !!adapterByIndex[page.index]);
      const startXp = Math.min(EXP_CAP, Number(page.startXp) || 0);
      const targetXp = Math.min(EXP_CAP, startXp + boosted);
      return {
        ...page,
        value: boosted,
        startXp,
        targetXp,
        message: `EXP gained:\n${boosted} EXP`,
      };
    });
    if (!r.pages.length) {
      r.pages = [{ kind: "exp", value: 0, startXp: 0, targetXp: 0, message: "EXP gained:\n0 EXP" }];
    }
    r.pageIndex = 0;
    r.pageTime = 0;
    const n = Math.max(r.rows.length, 1);
    r.rowPhase = Array.from({ length: n }, (_, i) => (i === 0 ? ROW_STATE.OPEN : 0));
    r.rowAge = Array.from({ length: n }, () => 0);
    r.chromeFoldAt = 0;
    // The report chrome/header folds open (stfgtrep start-family member
    // F0x80085c90); the family start plays packed cue 0x40019 (system03).
    sfx?.play?.("system03");
    r.countFrames = 0;
    r.flourishOn = false;
    r.flourishFrame = 0;
    r.flourishAge = 0;
    r.fadeLeaving = false;
    r.fadeFrames = 0;
    r.onClose = opts.onClose ?? null;
    playPageJingle();
  };

  r.close = () => {
    r._open = false;
    r.fadeLeaving = false;
    if (r.onClose) {
      const cb = r.onClose;
      r.onClose = null;
      cb();
    }
  };

  function requestLeave() {
    if (r.fadeLeaving) return;
    r.fadeLeaving = true;
    r.fadeFrames = 0;
    for (let i = 0; i < r.rowPhase.length; i++) {
      if (r.rowPhase[i] !== ROW_STATE.CLOSED) {
        r.rowPhase[i] = ROW_STATE.CLOSE;
        r.rowAge[i] = 0;
      }
    }
  }

  r.leaveFadeAlpha = () => {
    if (!r.fadeLeaving) return 0;
    return Math.min(255, (r.fadeFrames * LEAVE_FADE_DELTA) >> 8) / 255;
  };

  function currentPage() {
    return r.pages[Math.min(r.pages.length - 1, r.pageIndex)] ?? null;
  }

  // Each page that carries one plays its own short tune. The screen stops the
  // tune it started before it starts the next, so two never overlap on a fast
  // page turn -- which is why these go through the player's own-slot path
  // rather than a plain one-shot.
  //
  // Which tune belongs to which page was closed on 2026-09-04 from the overlay
  // (claim FIGHT-REPORT-MARKS-AND-JINGLES-001): the partner's level page and
  // the digivolution page each have their own.
  function playPageJingle() {
    const j = currentPage()?.jingle;
    if (r._jingle) sfx?.stopSustained?.(r._jingle);
    r._jingle = j ?? null;
    if (j) sfx?.playSustained?.(j);
  }

  function startCountupIfNeeded() {
    const page = currentPage();
    r.countFrames = 0;
    r.flourishOn = false;
    r.flourishFrame = 0;
    r.flourishAge = 0;
    if (page?.kind === "exp" && page.index != null && r.rowPhase[page.index] === ROW_STATE.SETTLED) {
      r.rowPhase[page.index] = ROW_STATE.COUNTUP;
      r.flourishOn = true;
    }
  }

  function rowVisible(i) {
    const st = r.rowPhase[i];
    return st === ROW_STATE.SETTLED || st === ROW_STATE.COUNTUP
      || st === ROW_STATE.CLOSE || st === ROW_STATE.CLOSE_WAIT;
  }

  r.tick = () => {
    if (!r._open) return;
    r.vsync += 1;
    if (r.fadeLeaving) {
      r.fadeFrames += 1;
      for (let i = 0; i < r.rowPhase.length; i++) advanceRow(i);
      if (r.fadeFrames * LEAVE_FADE_DELTA >= LEAVE_FADE_MAX) r.close();
      return;
    }
    for (let i = 0; i < r.rowPhase.length; i++) advanceRow(i);
    const page = currentPage();
    if (page?.kind === "exp" && page.index != null
        && r.rowPhase[page.index] === ROW_STATE.SETTLED) {
      startCountupIfNeeded();
    }
    if (page?.kind === "exp" && (page.index == null
        || r.rowPhase[page.index] === ROW_STATE.COUNTUP)) {
      r.countFrames += 1;
    }
    if (r.flourishOn) {
      r.flourishAge += 1;
      if (r.flourishAge >= FLOURISH_STEP_VSYNC) {
        r.flourishAge = 0;
        r.flourishFrame = (r.flourishFrame + 1) % FLOURISH_FRAMES;
      }
    }
  };

  function advanceRow(i) {
    const st = r.rowPhase[i];
    if (st === 0) {
      const prev = r.rowPhase[i - 1];
      if (i > 0 && prev !== ROW_STATE.SETTLED && prev !== ROW_STATE.COUNTUP) return;
      r.rowPhase[i] = ROW_STATE.OPEN;
      r.rowAge[i] = 0;
      return;
    }
    r.rowAge[i] += 1;
    if (st === ROW_STATE.OPEN) {
      r.rowPhase[i] = ROW_STATE.OPEN_WAIT;
      r.rowAge[i] = 0;
    } else if (st === ROW_STATE.OPEN_WAIT) {
      if (r.rowAge[i] >= ROW_OPEN_FRAMES) {
        r.rowPhase[i] = ROW_STATE.SETTLED;
        r.rowAge[i] = 0;
      }
    } else if (st === ROW_STATE.CLOSE) {
      r.rowPhase[i] = ROW_STATE.CLOSE_WAIT;
      r.rowAge[i] = 0;
    } else if (st === ROW_STATE.CLOSE_WAIT) {
      if (r.rowAge[i] >= ROW_CLOSE_FRAMES) {
        r.rowPhase[i] = ROW_STATE.CLOSED;
        r.rowAge[i] = 0;
      }
    }
  }

  r.update = (dt) => {
    if (!r._open) return;
    r.time += dt;
    r.pageTime += dt;
    const target = Math.floor(r.time / VSYNC_S);
    while (r._open && r.vsync < target) r.tick();
  };

  r.handleKey = (k) => {
    if (!r._open) return false;
    if (r.fadeLeaving) return true;
    if (k === "circle") {
      const page = currentPage();
      const message = page?.message ?? "";
      const typed = Math.max(0, Math.floor(r.vsync / 3));
      if (typed < message.length) {
        r.vsync = message.length * 3;
        return true;
      }
      // unk16C row_skip_countup: confirm while the gold digits are counting
      // jumps them straight to the target (expCountDisplayed returns the target
      // at 10 frames) instead of being swallowed; the next confirm advances.
      if (page?.kind === "exp" && r.countFrames < 10) {
        r.countFrames = 10;
        return true;
      }
      sfx?.play("system07");
      if (r.pageIndex < r.pages.length - 1) {
        r.pageIndex += 1;
        r.pageTime = 0;
        startCountupIfNeeded();
        playPageJingle();
      } else {
        sfx?.play("system10");
        requestLeave();
      }
      return true;
    }
    if (k === "cross") {
      requestLeave();
      return true;
    }
    return true;
  };

  // One partner's group: plate, name, level, EXP, then the three digivolve
  // bars. A bar fills with the form's name and form level once that Digimon
  // has the form; before that it stays empty, as the capture of the original
  // shows. The portrait animates one frame every 13 vsyncs, from the table read
  // off the running game (claim FIGHT-REPORT-PORTRAIT-FRAMES-001).
  function drawGroup(ctx, g, row, opts = {}) {
    if (!g || !row) return;
    // The marks restart with each page, so a level arrow rises when its page
    // appears. The portrait keeps turning across the whole screen.
    const t = r.pageTime;
    // The plate is drawn plain. The screen's own code hands it the arrow's
    // palette row, but our cut of that row paints it cream, and the capture
    // shows the levelled partner's plate the same blue as everyone else's --
    // only its picture box and its name strip change. Either our palette cut is
    // wrong or the row means something else here; not settled, so not shipped.
    drawClip(ctx, stfrptChrome, g.plate.clip, g.plate.x, g.plate.y);
    const face = fightReportPortraitClip(g.portrait, row.rookieId, r.time);
    if (face != null) drawClip(ctx, stfrptChrome, face, g.portrait.x, g.portrait.y);
    // The bracketed frame and the white name strip mark the page's partner.
    if (opts.marked && g.highlight) {
      drawClipAtPaletteRow(ctx, stfrptChrome, g.highlight.clip,
        fightReportCycleRow(g.highlight, t), g.highlight.x, g.highlight.y);
    }
    if (opts.levelling && g.levelArrow) {
      drawClipAtPaletteRow(ctx, stfrptChrome, g.levelArrow.clip,
        fightReportRampRow(g.levelArrow, t), g.levelArrow.x, g.levelArrow.y);
    }
    uiDrawText(ctx, row.name ?? "", g.name.x, g.name.y, { kind: 1 });
    uiDrawText(ctx, g.levelLabel.str, g.levelLabel.x, g.levelLabel.y, { kind: 3 });
    uiDrawText(ctx, String(row.level ?? 1), g.levelValue.x, g.levelValue.y,
      { kind: 3, alignRight: true });
    const xp = opts.countingXp ?? row.xp ?? 0;
    uiDrawText(ctx, String(xp), g.xpValue.x, g.xpValue.y, { kind: 3, alignRight: true });
    uiDrawText(ctx, g.xpLabel.str, g.xpLabel.x, g.xpLabel.y, { kind: 3 });
    g.slots.forEach((slot, j) => {
      const barMarked = opts.markedSlot === j;
      if (barMarked) {
        // The bar picture is drawn plain, for the same reason as the plate.
        drawClip(ctx, stfrptChrome, slot.barClip, slot.barX, slot.barY);
        if (slot.markerClip != null) {
          drawClipAtPaletteRow(ctx, stfrptChrome, slot.markerClip,
            fightReportRampRow(slot.markerRamp, t), slot.markerX, slot.markerY);
        }
      } else {
        drawClip(ctx, stfrptChrome, slot.barClip, slot.barX, slot.barY);
      }
      const form = row.forms?.[j];
      if (form?.name) {
        uiDrawText(ctx, form.name, slot.nameX, slot.nameY, { kind: 1 });
        uiDrawText(ctx, String(form.level ?? 1), slot.valueX, slot.valueY,
          { kind: 3, alignRight: true });
      }
      if (barMarked && slot.highlightClip != null) {
        drawClipAtPaletteRow(ctx, stfrptChrome, slot.highlightClip,
          fightReportCycleRow(g.highlight, t), slot.highlightX, slot.highlightY);
      }
    });
  }

  r.draw = (ctx, _viewW, _viewH) => {
    if (!r._open) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // Framebuffer takeover: fill and fit the native 320x240 image to the whole
    // canvas (the shared rule), not the caller's logical view size — otherwise
    // a fullscreen battle canvas draws the report small in the top-left corner.
    fitNativeScreen(ctx);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, NATIVE_W, NATIVE_H);

    const L = LAYOUT ?? optsLayoutFallback();
    // One group per party slot, 50px apart. The three rows inside a group are
    // that Digimon's digivolve bars.
    const groups = L
      ? Array.from({ length: fightReportGroupCount(L) },
          (_, i) => fightReportGroupGeom(L, i))
      : [];
    const G = groups[0] ?? null;
    const chromeReady = G && packReady(stfrptChrome);
    const page = currentPage();
    const pageIdx = r.pageIndex;

    if (!chromeReady || !L || !G) {
      ctx.fillStyle = "#000018";
      ctx.fillRect(0, 0, NATIVE_W, NATIVE_H);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px monospace";
      ctx.textAlign = "center";
      ctx.fillText(page?.message ?? "", 160, 210);
      paintLeave(ctx);
      ctx.restore();
      return;
    }

    // Ambient wall: +1 every second vsync, wrap 0..95, drawn at (k,k).
    const ak = Math.floor(r.vsync / 2) % (L.ambient_bg.animated.max + 1);
    drawClip(ctx, stfrptChrome, L.ambient_bg.clip, ak, ak);
    const foldClip = (entry, axis) => {
      const [px, py] = entry.pivot ?? [entry.x, entry.y];
      const tr = ui.foldTransformAtTime(r.time, r.chromeFoldAt, px, py, axis, CHROME_FOLD_S);
      if (tr.progress <= 0) return;
      ctx.save();
      ctx.translate(tr.pivotX, tr.pivotY);
      ctx.scale(tr.scaleX, tr.scaleY);
      ctx.translate(-tr.pivotX, -tr.pivotY);
      drawClip(ctx, stfrptChrome, entry.clip, entry.x, entry.y);
      ctx.restore();
    };
    // The corner badge carries the battle's EXP total, and the capture shows
    // it absent from the BIT page: picture and text come and go together.
    const badgeOn = (L.corner_badge.pages ?? []).includes(page?.kind);
    if (badgeOn) foldClip(L.corner_badge, "y");
    foldClip(L.message_bar, "y");
    if (uiFontReady()) {
      if (badgeOn) {
        const CB = L.corner_badge;
        uiDrawText(ctx, String(r.rewardXp ?? 0), CB.value.x, CB.value.y,
          { kind: CB.value.kind, alignRight: true });
        uiDrawText(ctx, CB.label.str, CB.label.x, CB.label.y, { kind: CB.label.kind });
      }
      (r.rows ?? []).slice(0, groups.length).forEach((row, i) => {
        if (!rowVisible(i)) return;
        const g = groups[i];
        const onThisPartner = page?.index != null && i === page.index;
        const counting = page?.kind === "exp" && i === (page.index ?? 0);
        drawGroup(ctx, g, row, {
          // The page names one partner, and that partner is marked. A page
          // about the party's money names nobody and marks nobody.
          marked: onThisPartner,
          levelling: onThisPartner && (g.levelArrow?.pages ?? []).includes(page?.kind),
          markedSlot: onThisPartner ? fightReportMarkedSlot(page, row) : null,
          countingXp: counting && page.startXp != null
            ? expCountDisplayed(page.startXp, page.targetXp ?? row.xp, r.countFrames)
            : null,
        });
      });
      const MSG = G.message;
      const message = page?.message ?? "";
      const chars = Math.max(0, Math.floor(r.vsync / 3));
      message.slice(0, chars).split("\n").forEach((line, i) =>
        uiDrawText(ctx, line, MSG.x, MSG.y + i * 13, { kind: MSG.kind }));
    }

    const cur = loadPack(L.blink_cursor.pack);
    if (packReady(cur)) {
      const k = Math.floor(r.vsync / 5) % 5;
      drawClipAtPaletteRow(ctx, cur, L.blink_cursor.clip, k, L.blink_cursor.x, L.blink_cursor.y);
    }

    paintLeave(ctx);
    ctx.restore();
    void pageIdx;
  };

  function paintLeave(ctx) {
    const a = r.leaveFadeAlpha();
    if (a <= 0) return;
    paintScreenDim(ctx, a * 255, NATIVE_W, NATIVE_H);
  }

  function optsLayoutFallback() {
    return LAYOUT;
  }

  return r;
}
