// web/cardalbum.js — the Card Album (STCRDABM overlay), walker recreation.
//
// Identity (decoded 2026-07-12, docs/research/ui/stcrdabm-decoded-2026-07-12.md):
// STCRDABM is the DW3 CARD BATTLE minigame's browse-only "Card Album" — a
// 6-column grid over the 314-card collection the album addresses (ids 1..314;
// its loops test `id < 0x13B`, stcrdabm.s:259,277,381,634,689,2008), paged 12
// cards (2 rows x 6 cols) at a time. The raw CARDPAK0..4 catalog holds 316
// records; ids 315 (Calumon) and 316 (Impmon) are named out-of-collection
// specials past the bound and are unreachable in play. Every card slot shows an
// AP/HP readout
// if owned or a placeholder silhouette if not. There is no menu — the album
// IS the grid screen (escrdabm.toml has no option strings, only chrome
// labels). Chrome geometry below is a literal transcription of the
// decompiled ctor F0x80083bfc / label-fill F0x80083e14 / grid draw
// F0x80083174 / selection overlay F0x800835bc / page chrome F0x80084500 —
// see the doc for every cited coordinate.
//
// SCOPE: chrome (grid cells, page/L1/R1 header, cursor, popup frame) is
// complete, and the catalog it browses is the real decoded one — 316 records
// from CARDPAK0..4.BIN (tools/extract_card_catalog.py). Card ARTWORK is now
// decoded too: each record carries its own 32x32 8bpp TIM at +0x0C, extracted
// to the assets/cards/card_icons.png atlas, so owned cells show the card's
// real art and unowned cells keep the placeholder frame.
import { paintScreenDim } from "./screendim.js";
import { asButton } from "./input.js";
import { drawText } from "./uifont.js";
import { loadPack, drawClip, packReady, drawPackBackdrop } from "./screenpack.js";
import { loadCatalog, cardById, cards, ownedCount, seenCard } from "./cardstate.js";
import { ui } from "./vendor/engine.js";

const stalbm = loadPack("stalbm");
let LAYOUT = null;
if (typeof Image !== "undefined") {
  fetch("assets/data/stcrdabm_ui.json").then((r) => r.json()).then((j) => { LAYOUT = j; }).catch(() => {});
}

/** Test seam: install the layout json without a browser fetch. */
export function __setLayout(json) { LAYOUT = json; }

const COLS = 6;
const ROWS = 2;
const PAGE_SIZE = COLS * ROWS;
// Loops test id < 0x13B. Ids 315 and 316 are out-of-collection specials.
const CARD_COUNT_ABS = 0x13B; // ids 1..0x13A
const COLOUR_FRAMES = ["white", "blue", "green", "red", "black", "brown"];

// Page-chrome fold. The plates and pivots are stcrdabm_ui.json
// page_popups.foldWindow. WHICH axis the fold drives is not in that
// file; the walker scales on x, the same convention the item shop's
// header uses when the axis is unread.
const ANIM_T = 0.2;
const VSYNC_MS = 20;
const REVEAL_FRAMES_PER_CELL = 2;

// Leave / enter dim (SCREEN-OBJECT-METHODS-001, fadeStart_stcrdabm).
// Triangle starts direction 0, duration 0xA: the 8.8 dim word runs
// 0 → 0xFF00 in 10 frames, then the album is gone. Entry is the same
// duration the other way. F0x80084c38 case at unk10=0x32.
const LEAVE_FADE_FRAMES = 0xA;
const LEAVE_FADE_MAX = 0xFF00;
const LEAVE_FADE_DELTA = Math.trunc(LEAVE_FADE_MAX / LEAVE_FADE_FRAMES);

function albumId(page, cell) {
  return page * PAGE_SIZE + cell + 1;
}

function albumCellOwned(album, cell) {
  const id = albumId(album.page, cell);
  return id < CARD_COUNT_ABS && seenCard(id);
}

function pageHasSeen(page) {
  for (let i = 0; i < PAGE_SIZE; i++) {
    const id = albumId(page, i);
    if (id < CARD_COUNT_ABS && seenCard(id)) return true;
  }
  return false;
}

function colourFrameClip(card) {
  const i = COLOUR_FRAMES.indexOf(card?.colour);
  return i >= 0 ? i : 0;
}

function clampAlbumCell(album) {
  const maxId = CARD_COUNT_ABS - 1; // 0x13A
  const base = album.page * PAGE_SIZE;
  if (base + album.cursor >= maxId) album.cursor = Math.max(0, maxId - 1 - base);
  if (album.cursor < 0) album.cursor = 0;
  if (album.cursor > PAGE_SIZE - 1) album.cursor = PAGE_SIZE - 1;
}

function moveAlbumCell(album, delta) {
  const old = album.cursor;
  let next = old + delta;
  if (next < 0) next = 0;
  if (next >= PAGE_SIZE) next = PAGE_SIZE - 1;
  album.cursor = next;
  clampAlbumCell(album);
  const step = delta < 0 ? -1 : 1;
  while (album.cursor !== old && !albumCellOwned(album, album.cursor)) {
    const n = album.cursor + step;
    if (n < 0 || n >= PAGE_SIZE) { album.cursor = old; break; }
    album.cursor = n;
    clampAlbumCell(album);
  }
}

export function createCardAlbum(sfx = null) {
  const c = {
    _open: false,
    page: 0,
    totalPages: Math.ceil(CARD_COUNT_ABS / PAGE_SIZE),
    cursor: 0, // in-page index 0..11
    tick: 0,
    revealTick: 0,
    detailOpen: false,
    foldT0: 0,
    fadeLeaving: false,
    fadeEntering: false,
    fadeT0: 0,
    onClose: null,
  };

  c.isOpen = () => c._open;

  function beginPage(page) {
    c.page = page;
    c.revealTick = c.tick;
    clampAlbumCell(c);
  }

  c.open = (onClose = null) => {
    c._open = true;
    loadCatalog();
    c.page = 0;
    c.cursor = 0;
    c.tick = 0;
    c.revealTick = 0;
    c.detailOpen = false;
    c.foldT0 = performance.now() / 1000;
    c._foldSounded = false;
    c.fadeLeaving = false;
    c.fadeEntering = true;
    c.fadeT0 = performance.now();
    c.onClose = onClose;
    c.totalPages = Math.ceil(CARD_COUNT_ABS / PAGE_SIZE);
  };

  function close() {
    c._open = false;
    c.fadeLeaving = false;
    c.onClose?.();
  }

  function requestLeave() {
    if (c.fadeLeaving) return;
    c.fadeLeaving = true;
    c.fadeT0 = performance.now();
    sfx?.play("system04"); // the window-close half of the same fold family
  }

  function stepPage(dir) {
    let p = c.page + dir;
    while (p >= 0 && p < c.totalPages && !pageHasSeen(p)) p += dir;
    if (p < 0 || p >= c.totalPages || p === c.page) return false;
    sfx?.play("system06");
    c.detailOpen = false;
    beginPage(p);
    return true;
  }

  c.handleKey = (rawKey) => {
    // Accept either a pad button name from the dispatcher or the raw key it
    // stands for, so a caller (and a test) may use whichever it has.
    const k = asButton(rawKey);
    if (!c._open) return false;
    if (c.fadeLeaving || c.fadeEntering) return true;
    if (c.detailOpen) {
      if (k === "cross" || k === "circle") {
        sfx?.play("system02");
        c.detailOpen = false;
      }
      return true;
    }
    if (k === "l1") { stepPage(-1); return true; }
    if (k === "r1") { stepPage(1); return true; }
    // U-31: cell index clamps 0..11. Left/Right are cells, L1/R1 page.
    // U-30: Circle is a no-op.
    if (k === "left") { moveAlbumCell(c, -1); return true; }
    if (k === "right") { moveAlbumCell(c, 1); return true; }
    if (k === "up") { if (c.cursor >= COLS) moveAlbumCell(c, -COLS); return true; }
    if (k === "down") { if (c.cursor < COLS) moveAlbumCell(c, COLS); return true; }
    if (k === "circle") {
      if (albumCellOwned(c, c.cursor)) {
        sfx?.play("system01");
        c.detailOpen = true;
      }
      return true;
    }
    if (k === "cross") { sfx?.play("system02"); requestLeave(); return true; }
    return true;
  };

  c.draw = (ctx, w, h, state) => {
    if (!c._open) return;
    const nowMs = performance.now();
    if (c.fadeLeaving) {
      const frames = Math.max(0, Math.floor((nowMs - c.fadeT0) / VSYNC_MS));
      if (frames * LEAVE_FADE_DELTA >= LEAVE_FADE_MAX) { close(); return; }
    }
    c.tick += 1;
    const s = Math.max(1, Math.min(w / 320, h / 240));
    ctx.save();
    ctx.scale(s, s);
    const vw = w / s, vh = h / s;
    const L = LAYOUT;
    const chromeReady = L && packReady(stalbm);
    const now = nowMs / 1000;
    // The shared window-fold family plays SYSTEM03 as a window STARTS opening
    // and SYSTEM04 as it starts shutting (window-fold-tween-homolog-family-
    // 2026-08-04; the pause menu's own gate is web/menu.js:1338-1341). This
    // screen folds its three plates but had never sounded any of them.
    // They all start on the same `foldT0` here, so the sound fires once for the
    // fold rather than three times on one frame: the ORIGINAL's stagger for
    // this screen is not decoded, and three coincident plays would be a
    // stand-in for a sequence nobody has read.
    if (!c._foldSounded) { c._foldSounded = true; sfx?.play("system03"); }
    const foldPiece = (piece, axis, fn) => {
      if (!piece) { fn(); return 1; }
      const tr = ui.foldTransformAtTime(now, c.foldT0, piece.pivot[0], piece.pivot[1], axis, ANIM_T);
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

    // disasm: stcrdabm.s L1583-L1611 draws stalbm clip 0x8 at (counter, counter)
    // — the counter at +0x58 advances by 1 only on frames where the +0x5c toggle
    // is already set and resets at 0x60, so the wall drifts down-right at half a
    // pixel per vsync. The flat fill stays as the colour behind it.
    ctx.fillStyle = "#0a0a20";
    ctx.fillRect(0, 0, vw, vh);
    if (chromeReady) drawPackBackdrop(ctx, stalbm, 8, 320, 240);
    // Bounce icon, clip 8 at (n,n), n steps every other vsync and wraps at 96.
    const bounce = L?.page_popups ?? {};
    if (chromeReady && bounce.bounceIconClip != null) {
      const range = bounce.bounceIconRange ?? [0, 96];
      const n = range[0] + (Math.floor(c.tick / 2) % (range[1] - range[0]));
      drawClip(ctx, stalbm, bounce.bounceIconClip, n, n);
    }

    const pc = L?.page_chrome ?? {
      header: [16, 25], footerBack: [208, 25], pageDigits: [52, 158],
      pageSlash: [53, 158], pageTotalDigits: [74, 158],
      l1Label: [18, 108], r1Label: [289, 108],
    };
    const fw = L?.page_popups?.foldWindow ?? {};
    const titleReady = !chromeReady || !fw.clip9 ? 1 : foldPiece(fw.clip9, "x", () => {
      drawClip(ctx, stalbm, fw.clip9.clip, fw.clip9.xy[0], fw.clip9.xy[1]);
    });
    const backReady = !chromeReady || !fw.clip15 ? 1 : foldPiece(fw.clip15, "x", () => {
      drawClip(ctx, stalbm, fw.clip15.clip, fw.clip15.xy[0], fw.clip15.xy[1]);
    });
    const pageReady = !chromeReady || !fw.clip14 ? 1 : foldPiece(fw.clip14, "x", () => {
      drawClip(ctx, stalbm, fw.clip14.clip, fw.clip14.xy[0], fw.clip14.xy[1]);
    });
    if (titleReady >= 1) drawText(ctx, L?.strings?.title ?? "Card Album", pc.header[0], pc.header[1]);
    if (backReady >= 1) drawText(ctx, L?.strings?.back ?? "[triangle] Button: Back", pc.footerBack[0], pc.footerBack[1]);
    if (pageReady >= 1) {
      drawText(ctx, String(c.page + 1), pc.pageDigits[0], pc.pageDigits[1]);
      drawText(ctx, L?.strings?.slash ?? "/", pc.pageSlash[0], pc.pageSlash[1]);
      drawText(ctx, String(c.totalPages), pc.pageTotalDigits[0], pc.pageTotalDigits[1]);
    }
    if (c.page > 0) drawText(ctx, L?.strings?.l1 ?? "L1", pc.l1Label[0], pc.l1Label[1]);
    if (c.page < c.totalPages - 1) drawText(ctx, L?.strings?.r1 ?? "R1", pc.r1Label[0], pc.r1Label[1]);

    // Grid: real cell geometry over the decoded 316-card catalog, with each
    // card's own 32x32 TIM icon.
    const g = L?.grid ?? { cols: 6, cellW: 42, cellH: 54, familyFrameX0: 35, familyFrameY0: 50, unownedPlaceholderClip: 6 };
    const revealed = Math.min(PAGE_SIZE, Math.floor(Math.max(0, c.tick - c.revealTick) / REVEAL_FRAMES_PER_CELL));
    let pageSeen = false;
    for (let i = 0; i < revealed; i++) {
      const col = i % g.cols, row = Math.floor(i / g.cols);
      const cardId = albumId(c.page, i);
      if (cardId >= CARD_COUNT_ABS) break;
      const x = g.familyFrameX0 + col * g.cellW;
      const y = g.familyFrameY0 + row * g.cellH;
      const card = cardById(cardId);
      // The disc's cell draw (F0x80083174) tests the "ever obtained" byte, NOT
      // the copy count: a card you have spent down to zero stays revealed.
      // — UI-CARDALBUM-CELLS-KEY-ON-THE-SEEN-FLAG-2026-08-14
      const owned = cardId < CARD_COUNT_ABS && seenCard(cardId);
      if (owned) pageSeen = true;
      if (!chromeReady) continue;
      if (!owned) {
        drawClip(ctx, stalbm, g.unownedPlaceholderClip, x, y);
        continue;
      }
      // Colour-frame clip = record byte 0 minus 1, not the duel TIM.
      drawClip(ctx, stalbm, colourFrameClip(card), x, y);
      const cellX = (v) => x + v - (g.familyFrameX0 ?? 35);
      const statY = y + (g.statLineY ?? 83) - (g.familyFrameY0 ?? 50);
      if (!card) continue;
      if (card.kind !== "digimon") {
        drawClip(ctx, stalbm, g.programPlateClip ?? 0x1D, cellX(g.programPlateX0 ?? 39), statY);
        continue;
      }
      const base = g.digitClipBase ?? 0x1E;
      const step = g.apDigitStep ?? 7;
      const pair = (value, x0) => {
        const v = Math.max(0, Math.min(99, value | 0));
        const tens = Math.floor(v / 10);
        if (tens !== 0) drawClip(ctx, stalbm, base + tens, cellX(x0), statY);
        drawClip(ctx, stalbm, base + (v % 10), cellX(x0 + step), statY);
      };
      pair(card.ap, g.apDigitsX0 ?? 39);
      drawClip(ctx, stalbm, g.separatorClip ?? 0x1C, cellX(g.separatorX0 ?? 53), statY);
      pair(card.hp, g.hpDigitsX0 ?? 58);
    }
    if (chromeReady) {
      const ov = L?.grid_selection_overlay;
      if (ov) {
        // Original CLUT-cycles clip 6 over owned cells. Without a CLUT, an
        // opaque blit would hide the colour frame, so this is an alpha pulse.
        ctx.save();
        ctx.globalAlpha = 0.2 + 0.15 * Math.abs(((Math.floor(c.tick / 17) % 6) / 5) * 2 - 1);
        for (let i = 0; i < revealed; i++) {
          const col = i % g.cols, row = Math.floor(i / g.cols);
          if (!albumCellOwned(c, i)) continue;
          drawClip(ctx, stalbm, ov.clip, ov.x0 + col * g.cellW, ov.y0 + row * g.cellH);
        }
        ctx.restore();
      }
    }
    if (chromeReady) {
      const pop = L?.page_popups ?? {};
      const blink = pop.scrollBlinkTicks ?? 17;
      if (c.totalPages >= 2 && (Math.floor(c.tick / blink) % 2)) {
        if (c.page > 0 && pop.scrollUp) {
          drawClip(ctx, stalbm, pop.scrollUp.clip, pop.scrollUp.xy[0], pop.scrollUp.xy[1]);
        }
        if (c.page < c.totalPages - 1 && pop.scrollDown) {
          drawClip(ctx, stalbm, pop.scrollDown.clip, pop.scrollDown.xy[0], pop.scrollDown.xy[1]);
        }
      }
      // Grid cursor (F0x80084500 clip 7) — only when this page has a revealed card.
      if (pageSeen) {
        const cur = pop.cursor ?? { clip: 7, x0: 36, xStep: 42, y0: 50, yStep: 54 };
        const cCol = c.cursor % COLS, cRow = Math.floor(c.cursor / COLS);
        const pulse = 0.55 + 0.45 * Math.abs(((Math.floor(c.tick / 17) % 6) / 5) * 2 - 1);
        ctx.save();
        ctx.globalAlpha = pulse;
        drawClip(ctx, stalbm, cur.clip, cur.x0 + cCol * cur.xStep, cur.y0 + cRow * cur.yStep);
        ctx.restore();
      }
    }

    // Confirm opens the detail popup (state 0x10). F0x800840ac fills it only
    // for a revealed card; a silhouette switches every text slot off.
    if (c.detailOpen) {
      const sel = cardById(albumId(c.page, c.cursor));
      const pop = L?.page_popups?.cardDetailPopup;
      if (chromeReady && pop) {
        drawClip(ctx, stalbm, pop.frameClipA, pop.xyA[0], pop.xyA[1]);
        drawClip(ctx, stalbm, pop.frameClipB, pop.xyB[0], pop.xyB[1]);
      }
      // The popup's ten text widgets, at the places F0x80083bfc builds them
      // and under the rules F0x800840ac uses to switch each one on or off.
      const T = pop?.text;
      if (sel && seenCard(sel.id) && T) {
        const st = L?.strings ?? {};
        const times = st.close ?? "X";
        // Kind-1 text boxes keep the newline the card text ships with, one
        // line every 14 pixels (screen-rendering-model.md section 5).
        const at = (w, text) => {
          if (!w) return;
          String(text).split("\n").forEach((line, i) => drawText(ctx, line, w.x, w.y + i * 14));
        };
        at(T.name, sel.name);
        at(T.heldLabel, times);
        at(T.held, ownedCount(cards(), sel.id));
        const program = sel.kind !== "digimon";
        const special = (pop.classMagicNumbers ?? []).includes(sel.id);
        if (!program) {
          at(T.costLabel, times);
          at(T.cost, sel.summonCost ?? 0);
        }
        if (program || special) {
          at(T.effect, sel.effect ?? "");
        } else {
          at(T.apLabel, st.ap ?? "AP");
          at(T.ap, sel.ap);
          at(T.hpLabel, st.hp ?? "HP");
          at(T.hp, sel.hp);
        }
      }
    }

    if (c.fadeLeaving || c.fadeEntering) {
      const frames = Math.max(0, Math.floor((nowMs - c.fadeT0) / VSYNC_MS));
      let a = Math.min(255, (frames * LEAVE_FADE_DELTA) >> 8) / 255;
      if (c.fadeEntering) {
        a = 1 - a;
        if (a <= 0) c.fadeEntering = false;
      }
      if (a > 0) {
        paintScreenDim(ctx, a * 255, 320, 240);
      }
    }
    ctx.restore();
  };

  return c;
}
