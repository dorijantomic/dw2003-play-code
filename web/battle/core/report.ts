import { drawClip, drawClipAtPaletteRow, packReady, loadPack } from "../../screenpack.js";
import {
  fightReportPortraitClip,
  fightReportCycleRow,
  fightReportRampRow,
  fightReportGroupCount,
  fightReportGroupGeom,
  fightReportMarkedSlot,
  expCountDisplayed,
} from "../report.js";
import { drawText as uiDrawText, fontReady as uiFontReady } from "../../uifont.js";
import { stfrptChrome, REPORT_LAYOUT } from "../../battle.js";

// moved by tools/rewrite/split-closure.mjs
export function makeReport(B) {
// STFGTREP chrome from stfgtrep_ui.json. header.rowStepY (50) is page pitch
  // (F0x80083260 unk5C*0x32), not partner-card pitch. Walker draws one page
  // at base 0. victory_exact (2026-07-18) is not in this tree.
  // One partner's group: its plate, its name, its level, its EXP, and the
  // three digivolve bars beside it. A bar carries the form's name and its form
  // level once that Digimon has the form; an empty bar stays empty, which is
  // what the capture of the original shows at the start of the game.
  //
  // The portrait animates: one frame every 13 vsyncs, from the table read off
  // the running game (claim FIGHT-REPORT-PORTRAIT-FRAMES-001).
  function drawFightReportGroup(ctx, G, row, opts = {}) {
    if (!G || !row) return;
    const t = opts.seconds ?? 0;
    // The plate is drawn plain. The screen's own code hands it the arrow's
    // palette row, but our cut of that row paints it cream, and the capture
    // shows the levelled partner's plate the same blue as everyone else's --
    // only its picture box and its name strip change. Either our palette cut is
    // wrong or the row means something else here; not settled, so not shipped.
    drawClip(ctx, stfrptChrome, G.plate.clip, G.plate.x, G.plate.y);
    const face = fightReportPortraitClip(G.portrait, row.rookieId, t);
    if (face != null) drawClip(ctx, stfrptChrome, face, G.portrait.x, G.portrait.y);
    // The bracketed frame and the white name strip mark the page's partner.
    if (opts.marked && G.highlight) {
      drawClipAtPaletteRow(ctx, stfrptChrome, G.highlight.clip,
        fightReportCycleRow(G.highlight, t), G.highlight.x, G.highlight.y);
    }
    if (opts.levelling && G.levelArrow) {
      drawClipAtPaletteRow(ctx, stfrptChrome, G.levelArrow.clip,
        fightReportRampRow(G.levelArrow, t), G.levelArrow.x, G.levelArrow.y);
    }
    uiDrawText(ctx, row.name ?? "", G.name.x, G.name.y, { kind: 1 });
    uiDrawText(ctx, G.levelLabel.str, G.levelLabel.x, G.levelLabel.y, { kind: 3 });
    uiDrawText(ctx, String(row.level ?? 1), G.levelValue.x, G.levelValue.y,
      { kind: 3, alignRight: true });
    const xp = opts.countingXp ?? row.xp ?? 0;
    uiDrawText(ctx, String(xp), G.xpValue.x, G.xpValue.y, { kind: 3, alignRight: true });
    uiDrawText(ctx, G.xpLabel.str, G.xpLabel.x, G.xpLabel.y, { kind: 3 });
    G.slots.forEach((slot, j) => {
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
          fightReportCycleRow(G.highlight, t), slot.highlightX, slot.highlightY);
      }
    });
  }
function drawFightReport(b) {
    const L = REPORT_LAYOUT;
    const groups = L
      ? Array.from({ length: fightReportGroupCount(L) },
          (_, i) => fightReportGroupGeom(L, i))
      : [];
    const G = groups[0] ?? null;
    const chromeReady = G && packReady(stfrptChrome);
    const pages = b._winPages?.length ? b._winPages
      : [{ label: "EXP gained", value: b._winReward?.xp ?? 0 }];
    const pageIdx = Math.min(pages.length - 1, b._winPageIndex ?? 0);
    const page = pages[pageIdx];

    if (!chromeReady || !L) {
      B.ctx.fillStyle = "#000018";
      B.ctx.fillRect(0, 0, 320, 240);
      B.ctx.fillStyle = "#fff";
      B.ctx.font = "bold 14px monospace";
      B.ctx.textAlign = "center";
      B.ctx.fillText(page.message ?? `${page.label}: ${page.value}`, 160, 210);
      return;
    }

    // Brief black cut before the first report page only.
    if (pageIdx === 0 && b.timer < 0.42) {
      B.ctx.fillStyle = "#000";
      B.ctx.fillRect(0, 0, 320, 240);
      return;
    }

    // F0x80084c20: ambient background diagonal wipe — draw-position k ramps
    // 0..95 (2 vsyncs/step, ~40ms PAL) then resets, per the decoded cadence.
    const ak = Math.floor(performance.now() / L.ambient_bg.animated.stepMs) % (L.ambient_bg.animated.max + 1);
    drawClip(B.ctx, stfrptChrome, L.ambient_bg.clip, ak, ak);
    // The corner badge carries the battle's EXP total. It is absent from the
    // BIT page in the capture, so picture and text come and go together.
    const badgeOn = (L.corner_badge.pages ?? []).includes(page.kind);
    if (badgeOn) {
      drawClip(B.ctx, stfrptChrome, L.corner_badge.clip, L.corner_badge.x, L.corner_badge.y);
    }
    drawClip(B.ctx, stfrptChrome, L.message_bar.clip, L.message_bar.x, L.message_bar.y);

    const MSG = G.message;
    const active = page.index ?? 0;
    const frames = Math.max(0, Math.floor((b.timer - 0.42) * 50));
    if (uiFontReady()) {
      if (badgeOn) {
        const CB = L.corner_badge;
        uiDrawText(B.ctx, String(b._winReward?.xp ?? 0), CB.value.x, CB.value.y,
          { kind: CB.value.kind, alignRight: true });
        uiDrawText(B.ctx, CB.label.str, CB.label.x, CB.label.y, { kind: CB.label.kind });
      }
      (b._winReportRows ?? []).slice(0, groups.length).forEach((row, i) => {
        const g = groups[i];
        drawFightReportGroup(B.ctx, g, row, {
          seconds: b.timer,
          // The page names one partner, and that partner is marked. A page
          // about the party's money names nobody and marks nobody.
          marked: page.index != null && i === active,
          levelling: i === active && (g.levelArrow?.pages ?? []).includes(page.kind),
          markedSlot: i === active ? fightReportMarkedSlot(page, row) : null,
          countingXp: page.kind === "exp" && i === active && page.startXp != null
            ? expCountDisplayed(page.startXp, page.targetXp ?? row.xp, frames)
            : null,
        });
      });
      const message = page.message ?? `${page.label}:\n${page.value ?? ""}`;
      const chars = Math.max(0, Math.floor((b.timer - 0.55) * 18));
      message.slice(0, chars).split("\n").forEach((line, i) =>
        uiDrawText(B.ctx, line, MSG.x, MSG.y + i * 13, { kind: MSG.kind }));
    } else {
      B.ctx.fillStyle = "#fff";
      B.ctx.font = "bold 12px monospace";
      B.ctx.textAlign = "left";
      B.ctx.fillText(page.message ?? `${page.label}: ${page.value}`, 20, 44);
    }

    // Shared cmfont blink cursor (CLUT-cycled, 5 frames — same clip every
    // other decoded menu screen reuses).
    const cur = loadPack(L.blink_cursor.pack);
    if (packReady(cur)) {
      const k = Math.floor(performance.now() / 120) % 5;
      drawClipAtPaletteRow(B.ctx, cur, L.blink_cursor.clip, k, L.blink_cursor.x, L.blink_cursor.y);
    }

  }
  return { drawFightReportGroup, drawFightReport };
}
