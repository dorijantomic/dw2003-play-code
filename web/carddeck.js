// web/carddeck.js — the Card Folder editor (STCRDDEK overlay), walker
// recreation.
//
// Decoded 2026-08-14, docs/research/ui/card-folder-editor-2026-08-14.md.
// Reached from the pause menu: Card Folders -> Edit Folder (row 1 launches
// code 0x400 = ＳＴＤＥＣＫ).
//
// The screen is three surfaces, and this file follows the disc's own order:
//   - "folders": three folders, each shown as its name plus six colour
//     counters, prompt "Choose a folder." (F0x80089354 / F0x80088e74).
//   - "options": the two-row submenu, "Edit Folder" / "Change name".
//   - "editor": the chosen folder's forty slots, nine across, four rows of
//     nine plus a last row of four (F0x800835d8). Confirming opens an eight-row
//     swap list of the cards you may still place; picking one REPLACES the
//     highlighted slot. A fifth copy of one card in one folder is refused with
//     the disc's own wording (F0x80085210).
//   - "rename": the shared NAMEDT keyboard, ten characters.
//
// Every label on this screen comes from the CARD SHOP's string bank; the
// overlay has none of its own. The 2026-07-12 pass built a picker over
// escrddek.toml's 87 preset folder names — that screen does not exist, and
// this file no longer has it (§7 of the doc).
import { paintScreenDim } from "./screendim.js";
import { asButton } from "./input.js";
import { drawWindow } from "./uiRects.js";
import { drawText, textWidth } from "./uifont.js";
import { loadPack, drawClip, packReady, drawPackBackdrop } from "./screenpack.js";
import { createNameEntry, drawNameEntry, drawNameEntryMessage } from "./nameentry.js";
import {
  renameFolder, swapIntoFolder, sortFolder, folderColourCounts,
  FOLDER_NAME_LEN, MAX_COPIES_PER_FOLDER, listScrollbarThumb, ui,
} from "./vendor/engine.js";
import {
  loadCatalog, catalog, cardById, cards,
  spareCount, FOLDER_SIZE, loadCardIcons, drawCardIcon,
} from "./cardstate.js";

const stcdsp = loadPack("stcdsp");
let LAYOUT = null;
if (typeof Image !== "undefined") {
  fetch("assets/data/stcrddek_ui.json").then((r) => r.json()).then((j) => { LAYOUT = j; }).catch(() => {});
}

/** Test seam: install the layout json without a browser fetch. */
export function __setLayout(json) { LAYOUT = json; }

const GRID_COLS = 9;
const LIST_ROWS = 8;

// The swap list's scroll bar. SCREEN-OBJECT-NAME-AUDIT-001: the four setters
// this screen installs are the shared list bar, not the "scroll tween" the
// first naming pass called them. The screen builds the bar only from nine
// entries up, and configures it with these numbers at the call site
// exe-decomp/stcrddek_c/F0x80085210.c:288-297 — the same bar and the same
// width as the pause menu's bag, on its own track.
export const SWAP_SCROLLBAR = Object.freeze({
  x: 0x125, width: 0xC, y0: 0x2A, y1: 0x8F, visible: 8, minRows: 9,
});
export function swapScrollbarThumb(entries, topEntry, geom = SWAP_SCROLLBAR) {
  return listScrollbarThumb(entries, topEntry, geom);
}
const PAGE_STEP = 7;

// Leave dim (SCREEN-OBJECT-METHODS-001, fadeStart_stcrddek). The folder
// list's exit band starts direction 0, duration 0xA: the 8.8 dim word
// runs 0 → 0xFF00 in 10 frames, then the screen is gone. F0x80089354
// case 0x64.
const VSYNC_MS = 20;
// The shared window-fold family: ten vsyncs to open, SYSTEM03 as a window
// starts opening and SYSTEM04 as it starts shutting
// (window-fold-tween-homolog-family-2026-08-04). Edit Folder had neither the
// tween nor the sound; the pivots below are the decoded ones out of
// stcrddek_ui.json, not new numbers.
const ANIM_T = 0.2;
const LEAVE_FADE_FRAMES = 0xA;
const LEAVE_FADE_MAX = 0xFF00;
const LEAVE_FADE_DELTA = Math.trunc(LEAVE_FADE_MAX / LEAVE_FADE_FRAMES);

export function createCardDeck(sfx = null) {
  const c = {
    _open: false,
    screen: "folders", // folders | options | editor | swap | rename
    folderCursor: 0,
    optionCursor: 0,
    slot: 0,            // 0..39, the highlighted folder slot
    dealt: 0,
    dealTick: 0,
    listCursor: 0,      // 0..7, the row inside the visible swap list
    listScroll: 0,
    explain: false,
    message: null,
    nameEntry: null,
    tick: 0,
    fadeLeaving: false,
    fadeT0: 0,
    onClose: null,
  };

  c.isOpen = () => c._open;

  c.open = (onClose = null) => {
    c._open = true;
    loadCatalog();
    loadCardIcons();
    c.screen = "folders";
    c.folderCursor = 0;
    c.optionCursor = 0;
    c.slot = 0;
    c.dealt = 0;
    c.dealTick = 0;
    c.listCursor = 0;
    c.listScroll = 0;
    c.explain = false;
    c.message = null;
    c.nameEntry = null;
    c.fadeLeaving = false;
    c.foldT0 = 0;
    c._foldSounded = {};
    c.onClose = onClose;
  };

  // A press that cannot move the cursor is silent -- the same guard the pause
  // menu's lists use, and for the same reason: the original only sounds a
  // cursor move when the cursor index actually changed (F0x8001270c.c:168,
  // F0x80092524.c:63,126). These lists clamp, so their ends were sounding.
  /** The move blip a list's cursor plays. The three-folder list and the
   *  editor/rename cursors use the stepper tick 0x0004001B (SYSTEM06), while
   *  the two-row submenu and the swap list use the list blip 0x8004513E
   *  (SYSTEM02) — folder-picker-tick case 4 vs case 0xD and folder-card-grid
   *  case 0x18 (stcrddek F0x80089354 / F0x80085210). Corrected 2026-10-14
   *  (audit/sfx-triggers-vs-decode): the swap list and submenu used to play
   *  the shifted names' blip. */
  function movedSound(before, after, cue = "system06") {
    if (before !== after) sfx?.play(cue);
    return after;
  }

  // Start (or restart) a window's fold, sounding it once as it begins.
  function beginFold(key) {
    c.foldT0 = performance.now() / 1000;
    if (!c._foldSounded[key]) { c._foldSounded[key] = 1; sfx?.play("system03"); }
  }

  function folders() { return cards().folders ?? []; }
  // U-25: Edit Folder's cursor is local. It does not write the duel folder.
  function folder() { return folders()[c.folderCursor] ?? null; }
  function colourOf(id) { return cardById(id)?.colour ?? ""; }

  /** The cards you may still place, and how many of each — the disc's working
   *  table: every owned count, minus what this folder already holds, keeping
   *  only what is left over (F0x800847c0). */
  function placeable() {
    const cat = catalog();
    if (!cat) return [];
    const col = cards();
    return cat.cards
      .filter((card) => spareCount(col, card.id, c.folderCursor) > 0)
      .map((card) => ({ card, left: spareCount(col, card.id, c.folderCursor) }));
  }

  function close() {
    c._open = false;
    c.fadeLeaving = false;
    c.onClose?.();
  }

  function requestLeave() {
    if (c.fadeLeaving) return;
    c.fadeLeaving = true;
    c.fadeT0 = performance.now();
    // The leave is the dim fade (F0x80089354 case 0x64), which is silent; the
    // cancel blip that starts it is played by the caller. Corrected 2026-10-14
    // (audit/sfx-triggers-vs-decode): a window-close cue (system04) used to play
    // here although the dim starts no fold.
  }

  function paintLeaveFade(ctx) {
    if (!c.fadeLeaving) return;
    const frames = Math.max(0, Math.floor((performance.now() - c.fadeT0) / VSYNC_MS));
    const a = Math.min(255, (frames * LEAVE_FADE_DELTA) >> 8) / 255;
    if (a <= 0) return;
    paintScreenDim(ctx, a * 255, 320, 240);
  }

  /** The grid's clamps: the last row holds four, so a column past three cannot
   *  reach row four. Slot index is row * 9 + col. */
  function moveGrid(dCol, dRow) {
    let col = c.slot % GRID_COLS;
    let row = Math.floor(c.slot / GRID_COLS);
    col += dCol; row += dRow;
    if (col < 0) col = 0;
    if (row < 0) row = 0;
    const lastRowCols = LAYOUT?.folder_grid?.lastRowCols ?? (FOLDER_SIZE - GRID_COLS * 4);
    if (row >= 4) { row = 4; if (col >= lastRowCols) col = lastRowCols - 1; }
    if (col >= GRID_COLS) { col = GRID_COLS - 1; }
    if (row === 4 && col >= lastRowCols) col = lastRowCols - 1;
    c.slot = Math.min(FOLDER_SIZE - 1, row * GRID_COLS + col);
  }

  c.handleKey = (rawKey) => {
    if (!c._open) return false;
    if (c.fadeLeaving) return true;
    const k = asButton(rawKey);
    // The three face buttons are the screen's own legend, read as the game's
    // LOGICAL ids (docs/research/ui/card-folder-editor-2026-08-14.md §3):
    // Circle `0xC` sorts the folder, Cross `0xD` opens the swap list, Triangle
    // `0xE` leaves. Logical 0xD/0xE are word bits 0x2000/0x4000, which every
    // screen in the game reads as confirm/cancel, so they are the names "circle"
    // and "cross" here; the sort sits on logical 0xC = 0x1000 = "triangle".
    const confirm = k === "circle";
    const back = k === "cross";

    if (c.message) {
      // The warning plate's dismissal plays the apply tick 0x0004001C
      // (SYSTEM07; folder-card-grid case 0x3E, `pressed(host, 0xd)` ->
      // playSound(0x4001C)), then the plate folds shut (0x0004001A, SYSTEM04).
      if (confirm || back) { sfx?.play("system07"); c.message = null; delete c._foldSounded.message; sfx?.play("system04"); }
      return true;
    }

    if (c.screen === "folders") {
      const n = Math.max(1, folders().length);
      if (k === "up") { c.folderCursor = movedSound(c.folderCursor, Math.max(0, c.folderCursor - 1)); return true; }
      if (k === "down") { c.folderCursor = movedSound(c.folderCursor, Math.min(n - 1, c.folderCursor + 1)); return true; }
      if (confirm) {
        if (!folders().length) return true;
        // Confirm on the folder list plays 0x0004001C (SYSTEM07) —
        // folder-picker-tick case 4 (`pressed 0xD` -> playSound(0x4001C)).
        sfx?.play("system07");
        c.optionCursor = 0;
        c.screen = "options";
        return true;
      }
      if (back) { sfx?.play("system01"); requestLeave(); return true; }
      return true;
    }

    if (c.screen === "options") {
      if (k === "up") { c.optionCursor = movedSound(c.optionCursor, 0, "system02"); return true; }
      if (k === "down") { c.optionCursor = movedSound(c.optionCursor, 1, "system02"); return true; }
      if (confirm) {
        // The two-row submenu: confirm 0x8004503C (SYSTEM00), cancel
        // 0x800450BD (SYSTEM01) — folder-picker-tick case 0xD.
        sfx?.play("system00");
        if (c.optionCursor === 0) {
          c.slot = 0; c.explain = false; c.explainTick = c.tick; c.dealt = 0;
          c.dealTick = c.tick; c.screen = "editor"; beginFold("editor");
        } else {
          c.nameEntry = createNameEntry({ initial: folder()?.name ?? "", maxLen: FOLDER_NAME_LEN });
          c.screen = "rename";
        }
        return true;
      }
      if (back) { sfx?.play("system01"); c.screen = "folders"; return true; }
      return true;
    }

    if (c.screen === "editor") {
      const gridMove = (dx, dy) => { const b = c.slot; moveGrid(dx, dy); movedSound(b, c.slot); };
      if (k === "up") { gridMove(0, -1); return true; }
      if (k === "down") { gridMove(0, 1); return true; }
      if (k === "left") { gridMove(-1, 0); return true; }
      if (k === "right") { gridMove(1, 0); return true; }
      if (k === "r1") { sfx?.play("system06"); c.explain = !c.explain; c.explainTick = c.tick; return true; }
      // Circle sorts the folder (card-folder-editor-2026-08-14.md:108): logical
      // 0x0C, which is word bit 0x1000. The sort transition plays the cancel
      // blip 0x800450BD (SYSTEM01) — folder-card-grid, `pressed(host, 0xc)` ->
      // playSound(0x800450BD), state 0x1E.
      if (k === "triangle") { sfx?.play("system01"); sortFolder(cards(), c.folderCursor); return true; }
      if (confirm) {
        // Confirm opens the swap list only when a card is placeable; the gate's
        // empty arm is SILENT (folder-card-grid: `if (listCount !== 0)` with no
        // else). A live confirm plays 0x0004001C (SYSTEM07).
        if (!placeable().length) return true;
        sfx?.play("system07");
        c.listCursor = 0; c.listScroll = 0; c.screen = "swap";
        return true;
      }
      if (back) { sfx?.play("system01"); c.screen = "folders"; return true; }
      return true;
    }

    if (c.screen === "swap") {
      const list = placeable();
      const last = Math.max(0, list.length - 1);
      const rows = LAYOUT?.editor?.swapList?.rows ?? LIST_ROWS;
      const pageStep = LAYOUT?.editor?.swapList?.pageStep ?? PAGE_STEP;
      const index = () => Math.min(last, c.listScroll + c.listCursor);
      if (k === "up") {
        sfx?.play("system02");
        if (c.listCursor > 0) c.listCursor -= 1;
        else c.listScroll = Math.max(0, c.listScroll - 1);
        return true;
      }
      if (k === "down") {
        sfx?.play("system02");
        if (c.listCursor < Math.min(rows, list.length) - 1) c.listCursor += 1;
        else c.listScroll = Math.min(Math.max(0, list.length - rows), c.listScroll + 1);
        return true;
      }
      if (k === "l1") { c.listScroll = movedSound(c.listScroll, Math.max(0, c.listScroll - pageStep), "system02"); return true; }
      if (k === "r1") {
        sfx?.play("system02");
        c.listScroll = Math.min(Math.max(0, list.length - rows), c.listScroll + pageStep);
        return true;
      }
      if (confirm) {
        const pick = list[index()];
        if (!pick) return true;
        const outcome = swapIntoFolder(cards(), c.slot, pick.card.id, c.folderCursor);
        if (outcome === "limit") {
          // The refusal arm (state 0x3C) starts the warning fold with no cue of
          // its own — the apply tick belongs to the plate's dismissal.
          beginFold("message");
          c.message = LAYOUT?.strings?.tooManyCopies
            ?? `Only ${MAX_COPIES_PER_FOLDER} of the same card\nin one folder.`;
          return true;
        }
        if (outcome === "ok" || outcome === "unchanged") {
          // The swap's confirm plays 0x8004503C (SYSTEM00) — folder-card-grid
          // case 0x18 (`pressed(host, 0xd)` -> playSound(0x8004503C)).
          sfx?.play("system00");
          c.screen = "editor";
          // The displaced card is available again at once, so the list the
          // player comes back to is a different list.
          c.listCursor = 0; c.listScroll = 0;
        } else sfx?.play("system02");
        return true;
      }
      if (back) { sfx?.play("system01"); c.screen = "editor"; return true; }
      return true;
    }

    if (c.screen === "rename") {
      const ne = c.nameEntry;
      if (!ne) { c.screen = "options"; return true; }
      if (k === "up") { ne.moveUp(); return true; }
      if (k === "down") { ne.moveDown(); return true; }
      if (k === "left") { ne.moveLeft(); return true; }
      if (k === "right") { ne.moveRight(); return true; }
      if (confirm) {
        ne.press();
        if (ne.isDone()) {
          if (renameFolder(cards(), c.folderCursor, ne.value())) {
            c.nameEntry = null;
            c.screen = "folders";
            // The keyboard's commit plays 0x0004001C (SYSTEM07) — the shared
            // NAMEDT keyboard's SFX_OK (name-keyboard.ts:363,575).
            sfx?.play("system07");
          } else {
            sfx?.play("system01");
            beginFold("message");
            c.message = LAYOUT?.strings?.nameNotAllowed ?? "That name is not allowed.";
            c.nameEntry = createNameEntry({ initial: ne.value(), maxLen: FOLDER_NAME_LEN });
          }
        }
        return true;
      }
      if (back) { sfx?.play("system01"); c.nameEntry = null; c.screen = "options"; return true; }
      return true;
    }
    return true;
  };

  c.draw = (ctx, w, h) => {
    if (!c._open) return;
    const now = performance.now();
    if (c.fadeLeaving) {
      const frames = Math.max(0, Math.floor((now - c.fadeT0) / VSYNC_MS));
      if (frames * LEAVE_FADE_DELTA >= LEAVE_FADE_MAX) { close(); return; }
    }
    c.tick += 1;
    const s = Math.max(1, Math.min(w / 320, h / 240));
    ctx.save();
    ctx.scale(s, s);
    const vw = w / s, vh = h / s;
    const L = LAYOUT;
    // One window, folded about its own decoded pivot. `piece.pivot` comes
    // straight out of stcrddek_ui.json — no pivot is invented here, so a
    // window whose pivot was never decoded simply draws whole, as before.
    const foldNow = now / 1000;
    const foldPiece = (piece, axis, fn) => {
      if (!piece?.pivot || !c.foldT0) { fn(); return 1; }
      const tr = ui.foldTransformAtTime(foldNow, c.foldT0, piece.pivot[0], piece.pivot[1],
        axis, ANIM_T);
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
    const S = L?.strings ?? {};
    const chromeReady = L && packReady(stcdsp);

    // The corner icon (clip 8) drifts down-right half a pixel per vsync and
    // resets at 0x60 — F0x80088e74.
    ctx.fillStyle = "#0a0a20";
    ctx.fillRect(0, 0, vw, vh);
    if (chromeReady) drawPackBackdrop(ctx, stcdsp, 8, 320, 240);

    // Bank string 0x4 is the editor's first label, which the ctor places at
    // header0 (193,23) — a top-right legend, not a footer.
    const backXY = L?.editor?.header0 ?? [193, 23];
    const drawBack = (x = backXY[0], y = backXY[1]) => drawText(ctx, S.back ?? "[triangle] Button:Back", x, y, { scale: 0.7 });

    if (c.screen === "folders" || c.screen === "options") {
      const fl = L?.folder_list ?? {};
      if (chromeReady) {
        if (fl.headerClipA != null) drawClip(ctx, stcdsp, fl.headerClipA, fl.headerXYA[0], fl.headerXYA[1]);
        if (fl.headerClipB != null) drawClip(ctx, stcdsp, fl.headerClipB, fl.headerXYB[0], fl.headerXYB[1]);
      }
      drawText(ctx, S.chooseFolder ?? "Choose a folder.", fl.prompt?.[0] ?? 151, fl.prompt?.[1] ?? 34);
      const list = folders();
      for (let g = 0; g < (fl.rows ?? 3); g++) {
        const f = list[g];
        const y = (fl.nameY0 ?? 83) + g * (fl.nameYStep ?? 45);
        const iconY = (fl.rowIconY0 ?? 80) + g * (fl.rowIconYStep ?? 45);
        if (chromeReady) {
          drawClip(ctx, stcdsp, fl.rowIconClip ?? 0x41, fl.rowIconX ?? 23, iconY);
          if (g === c.folderCursor) {
            const hi = c.screen === "options"
              ? (fl.highlightClipStatic ?? 0x44)
              : (fl.highlightClipPulse ?? 0x42);
            drawClip(ctx, stcdsp, hi, fl.rowIconX ?? 23, iconY);
          }
        } else if (g === c.folderCursor) {
          drawText(ctx, ">", (fl.nameX ?? 28) - 12, y);
        }
        drawText(ctx, f?.name ?? `Folder ${g + 1}`, fl.nameX ?? 28, y);
        if (!f) continue;
        const counts = folderColourCounts(f.cards, colourOf);
        for (let i = 0; i < counts.length; i++) {
          const x = (fl.counterX0 ?? 59) + i * (fl.counterXStep ?? 35);
          const cy = (fl.counterY0 ?? 100) + g * (fl.counterYStep ?? 45);
          // No colour tag here: the row's own art (clip 0x41) is a strip of six
          // coloured cubes, one per counter, so the disc labels them itself.
          drawText(ctx, String(counts[i]), x, cy, { scale: 0.7 });
        }
      }
      if (c.screen === "options") {
        const opts = fl.options ?? [[167, 35], [167, 49]];
        drawText(ctx, S.editFolder ?? "Edit Folder", opts[0][0], opts[0][1], { scale: 0.7 });
        drawText(ctx, S.changeName ?? "Change name", opts[1][0], opts[1][1], { scale: 0.7 });
        const cur = fl.optionCursor ?? [154, 35];
        drawText(ctx, ">", cur[0], cur[1] + c.optionCursor * (fl.optionCursorYStep ?? 14), { scale: 0.7 });
      }
      drawBack();
      paintLeaveFade(ctx);
      ctx.restore();
      return;
    }

    if (c.screen === "rename") {
      if (c.nameEntry) {
        c.nameEntry.advance?.(1);
        drawNameEntry(ctx, c.nameEntry, vw, vh);
      }
      if (c.message) drawNameEntryMessage(ctx, c.message);
      paintLeaveFade(ctx);
      ctx.restore();
      return;
    }

    // The editor and the swap list share the grid, so both draw it.
    const fg = L?.folder_grid ?? { cols: 9, cellW: 32, cellH: 32, x0: 16, y0: 58 };
    const ed = L?.editor ?? {};
    // The editor's own window sits under everything it holds — F0x80084890
    // draws clip 0x40 at (16,21) before the grid, scaled about the screen
    // centre so it opens and shuts from there. That "scaled about the centre"
    // IS the shared window fold, and until now the walker only wrote it down:
    // the plate appeared whole. It now folds open about the decoded pivot.
    if (chromeReady && ed.window) {
      foldPiece(ed.window, "xy",
        () => drawClip(ctx, stcdsp, ed.window.clip, ed.window.x, ed.window.y));
    }
    const f = folder();
    const slots = f?.cards ?? [];
    drawText(ctx, f?.name ?? "", ed.header1?.[0] ?? 21, ed.header1?.[1] ?? 24);

    const counts = folderColourCounts(slots, colourOf);
    const cc = ed.colourCounters ?? { x0: 52, xStep: 35, count: 6, y: 41 };
    for (let i = 0; i < counts.length; i++) {
      drawText(ctx, String(counts[i]), cc.x0 + i * cc.xStep, cc.y, { scale: 0.7 });
    }

    const dealt = Math.min(FOLDER_SIZE, Math.max(0, c.tick - (c.dealTick ?? 0)));
    for (let i = 0; i < dealt; i++) {
      const col = i % (fg.cols ?? 9), row = Math.floor(i / (fg.cols ?? 9));
      const x = (fg.x0 ?? 16) + col * (fg.cellW ?? 32);
      const y = (fg.y0 ?? 58) + row * (fg.cellH ?? 32);
      const card = cardById(slots[i]);
      if (card) drawCardIcon(ctx, card.id, x, y, 24);
      if (c.screen === "editor" && i === c.slot) {
        // Clip 0x43, a six-frame pulse advanced every fifth tick.
        if (chromeReady) {
          drawClip(ctx, stcdsp, fg.cursorClip ?? 0x43, x, y);
        } else {
          const frames = fg.cursorFrames ?? 6;
          const ticks = fg.cursorTicks ?? 5;
          ctx.save();
          ctx.globalAlpha = 0.5 + 0.5 * Math.abs(((Math.floor(c.tick / ticks) % frames) / (frames - 1)) * 2 - 1);
          ctx.strokeStyle = "#ffe066";
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 1, y - 1, (fg.cellW ?? 32) - 2, (fg.cellH ?? 32) - 2);
          ctx.restore();
        }
      }
    }

    if (c.screen === "editor") {
      const held = cardById(slots[c.slot]);
      // The card under the cursor is named under the grid whatever else is on
      // screen (F0x80083d28 fills widget +0x24 at (150,189) before it decides
      // anything about the explain panel).
      if (held) drawText(ctx, held.name, ed.cardName?.[0] ?? 150, ed.cardName?.[1] ?? 189);
      if (c.explain && held) {
        const d = ed.detailTop ?? { labels: [[259, 36], [252, 34]] };
        if (chromeReady && d.frameClipA != null) {
          drawClip(ctx, stcdsp, d.frameClipA, d.xyA[0], d.xyA[1]);
          if (d.frameClipB != null) drawClip(ctx, stcdsp, d.frameClipB, d.xyB[0], d.xyB[1]);
        } else {
          drawWindow(ctx, null, null, 60, 12, 240, 34);
        }
        // The top panel's seven widgets, and the rule F0x80083d28 switches
        // them by: a Program card shows only its text; the five Digimon in
        // bottomLineCardIds show text instead of AP/HP; every other Digimon
        // shows the cost pair and the AP/HP pairs.
        const t = ed.statTop ?? {};
        const at = (pt, str) => {
          if (!pt) return;
          String(str).split("\n").forEach((line, i) => drawText(ctx, line, pt[0], pt[1] + i * 14));
        };
        const program = held.kind !== "digimon";
        const special = (ed.detailBottom?.bottomLineCardIds ?? []).includes(held.id);
        if (!program) {
          at(t.pairA, S.countX ?? "X");
          at(t.pairB, held.summonCost ?? 0);
        }
        if (program || special) {
          at(t.quadA, held.effect ?? "");
        } else {
          at(t.quadB, S.ap ?? "AP");
          at(t.quadC, held.ap);
          at(t.quadD, S.hp ?? "HP");
          at(t.quadE, held.hp);
        }
      }
      // The footer line steadies on the sort hint and shows the explain hint
      // for footerMessageVsync frames after R1 is pressed.
      const since = c.tick - (c.explainTick ?? -9999);
      const footer = since < (ed.footerMessageVsync ?? 0x3C)
        ? (c.explain ? (S.explainOff ?? "R1: Don't explain card") : (S.explainOn ?? "R1: Explain Card"))
        : (S.sort ?? "[circle] Button:Sort");
      drawText(ctx, footer, ed.footerLine?.[0] ?? 150, ed.footerLine?.[1] ?? 204);
      drawBack();
      paintLeaveFade(ctx);
      ctx.restore();
      return;
    }

    // The swap list, over the grid.
    const sl = ed.swapList ?? { cols: [163, 273, 288], y0: 39, yStep: 14, rows: 8, iconX: 148 };
    const list = placeable();
    if (chromeReady && sl.headerClip != null) {
      drawClip(ctx, stcdsp, sl.headerClip, sl.headerXY[0], sl.headerXY[1]);
    }
    for (let i = 0; i < sl.rows; i++) {
      const idx = c.listScroll + i;
      const row = list[idx];
      const y = sl.y0 + i * sl.yStep;
      if (!row) continue;
      if (chromeReady) drawClip(ctx, stcdsp, sl.cellFrameClip ?? 0x31, sl.iconX, y);
      drawCardIcon(ctx, row.card.id, sl.iconX - 6, y - 9, 12);
      drawText(ctx, row.card.name.slice(0, 17), sl.cols[0], y, { scale: 0.6 });
      drawText(ctx, S.countX ?? "X", sl.cols[1], y, { scale: 0.7 });
      drawText(ctx, String(row.left), sl.cols[2], y, { scale: 0.7 });
      if (i === c.listCursor) drawText(ctx, ">", sl.cols[0] - 10, y, { scale: 0.7 });
    }
    // The bar beside the list, from nine entries up (the call site's own gate).
    {
      const bar = swapScrollbarThumb(list.length, c.listScroll,
        LAYOUT?.editor?.swapList?.scrollbar ?? SWAP_SCROLLBAR);
      if (bar) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
      }
    }
    // The arrows appear only from nine entries up, and blink every ninth tick.
    const blink = sl.scrollBlinkTicks ?? 9;
    const rows = sl.rows ?? LIST_ROWS;
    if (list.length >= (sl.scrollArrowsFrom ?? 9) && (Math.floor(c.tick / blink) % 2) && chromeReady) {
      if (c.listScroll > 0) drawClip(ctx, stcdsp, sl.scrollUpClip ?? 0x45, sl.scrollUpXY[0], sl.scrollUpXY[1]);
      if (c.listScroll < list.length - rows) drawClip(ctx, stcdsp, sl.scrollDownClip ?? 0x46, sl.scrollDownXY[0], sl.scrollDownXY[1]);
    }
    const sel = list[Math.min(Math.max(0, list.length - 1), c.listScroll + c.listCursor)];
    if (sel) {
      const d = ed.detailBottom ?? { labels: [[259, 159], [252, 157]] };
      if (chromeReady && d.frameClipA != null) {
        drawClip(ctx, stcdsp, d.frameClipA, d.xyA[0], d.xyA[1]);
        if (d.frameClipB != null) drawClip(ctx, stcdsp, d.frameClipB, d.xyB[0], d.xyB[1]);
      }
      drawText(ctx, sel.card.name, 70, d.labels[1][1], { scale: 0.7 });
      const line = sel.card.kind === "program"
        ? (sel.card.effect ?? "").replace(/\n/g, " ")
        : `${sel.card.colour}  ${S.ap ?? "AP"} ${sel.card.ap}  ${S.hp ?? "HP"} ${sel.card.hp}`;
      drawText(ctx, line.slice(0, 46), 70, d.labels[0][1] + 12, { scale: 0.55 });
    }
    drawBack();

    // The refusal plate: stcdsp clip 0x36 at (0,100), the bar F0x80084890
    // folds up one depth bucket in front of everything else. The walker drew
    // an invented 224x60 box here until 2026-09-03.
    if (c.message) {
      const mb = ed.messageBar;
      if (chromeReady && mb) foldPiece(mb, "x", () => drawClip(ctx, stcdsp, mb.clip, mb.x, mb.y));
      else drawWindow(ctx, null, null, 48, 88, 224, 60);
      const lines = String(c.message).split("\n");
      const y0 = (mb?.y ?? 100) + 8;
      for (let i = 0; i < lines.length; i++) {
        const str = lines[i];
        drawText(ctx, str, (320 - textWidth(str)) / 2, y0 + i * 14);
      }
    }

    paintLeaveFade(ctx);
    ctx.restore();
  };

  return c;
}
