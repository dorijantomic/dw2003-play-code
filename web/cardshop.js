// web/cardshop.js — the Card Shop (STCRDSHP overlay), walker recreation.
//
// Identity (decoded 2026-07-12, docs/research/ui/stcrdshp-decoded-2026-07-12.md):
// STCRDSHP is the DW3 CARD BATTLE minigame's shop, not the item shop. Its root
// menu offers 3 options (escrdshp.toml strings 5/6/7): "Buy One Card", "Open
// Booster", "Edit Folder". Chrome (window/cursor/BIT-balance geometry) is a
// literal transcription of the decompiled ctor F0x80087d00 — see the doc for
// every cited coordinate.
//
// SCOPE: the card CATALOG and its ARTWORK are decoded (316 records from
// CARDPAK0..4.BIN, each carrying a 32x32 8bpp TIM at +0x0C —
// tools/extract_card_catalog.py), so the shop sells real cards with their real
// icons. The booster pools are decoded too: the 0x1C-stride set table at
// 0x8008C708 carves that region into 35 sets of six ordered per-slot pools of
// sixteen ids (web/assets/data/card_boosters.json), and packs are EARNED by
// winning duels rather than bought. The PRICE list is decoded too (2026-08-08):
// 44 (cardId, price) pairs at 0x8008CD20, reached through the function pointer
// at 0x8008CB9C, with a card absent from the list costing 1 — see cardPrice in
// web/cardstate.js.
// The nine-copy purchase refusal below is the disc's (F0x80086DC4, message
// 0x14), separate from the cannot-afford refusal (0x13).
// "Edit Folder" now hands off to the stcrddek deck editor.
import { paintScreenDim } from "./screendim.js";
import { asButton } from "./input.js";
import { drawText } from "./uifont.js";
import { loadPack, drawClip, packReady, drawPackBackdrop } from "./screenpack.js";
import {
  loadCatalog, catalog, cards, grantCard, ownedCount, COLLECTION_CAP,
  cardPrice, loadCardPrices, shopStock, loadCardShops, cardById,
  openBooster, loadBoosters, heldPackSets, packCount,
  loadCardIcons, drawCardIcon,
} from "./cardstate.js";

const stcdsp = loadPack("stcdsp");
// Card detail popup bottom line, decoded 2026-08-14 (stcrdshp.s
// L0x00001558-L0x000015f4). Normally the card's price; for these five ids the
// "R1" hint instead, on the left. The five are RosemonII, MarineAngemon,
// SaberLeomon, Gryphonmon and Creepymon — one per colour, the five the
// catalogue ranks highest, and the only cards no shop, booster or starter deck
// carries. Fallback for when stcrdshp_ui.json has not loaded.
const BOTTOM_LINE = {
  y: 146, priceString: "bitTotal", priceX: 199,
  hintString: "explainHint", hintX: 74,
  hintCardIds: [0x45, 0x70, 0x9b, 0xc6, 0xf1],
};
let LAYOUT = null;
if (typeof Image !== "undefined") {
  fetch("assets/data/stcrdshp_ui.json").then((r) => r.json()).then((j) => { LAYOUT = j; }).catch(() => {});
}

/** Test seam: install the layout json without a browser fetch. */
export function __setLayout(json) { LAYOUT = json; }

// Leave dim (SCREEN-OBJECT-METHODS-001, fadeStart_stcrdshp). Root-menu
// triangle runs direction 0, duration 0x1E: the 8.8 dim word goes
// 0 → 0xFF00 in 30 frames, then the shop is gone. shop_root_tick case 0x32.
const COLOUR_FRAMES = ["white", "blue", "green", "red", "black", "brown"];
const VSYNC_MS = 20;
const LEAVE_FADE_FRAMES = 0x1E;
const LEAVE_FADE_MAX = 0xFF00;
const LEAVE_FADE_DELTA = Math.trunc(LEAVE_FADE_MAX / LEAVE_FADE_FRAMES);
// Pack reveal deals one slot every two vsyncs (pack_reveal_tick /
// pack_reveal_delay_tick: frame delta >= 2).
const REVEAL_FRAMES_PER_CARD = 2;


// The card detail panel's text, at the places the two constructors state.
// Program cards show their card text and no cost; the five special Digimon
// show their card text instead of AP and HP; every other Digimon card shows
// the cost pair and the AP and HP pairs. Same rule as the Card Album's popup.
function drawDetailText(ctx, L, card, held) {
  const T = L?.card_detail_text;
  if (!T || !card) return;
  const st = L?.strings ?? {};
  const times = st.times ?? "X";
  const at = (w, str) => {
    if (!w) return;
    String(str).split("\n").forEach((line, i) => drawText(ctx, line, w.x, w.y + i * 14));
  };
  at(T.name, card.name);
  at(T.heldLabel, times);
  at(T.held, held);
  const program = card.kind !== "digimon";
  const special = (L?.card_detail_popup?.bottomLine?.hintCardIds ?? []).includes(card.id);
  if (!program) {
    at(T.costLabel, times);
    at(T.cost, card.summonCost ?? 0);
  }
  if (program || special) {
    at(T.effect, card.effect ?? "");
  } else {
    at(T.apLabel, st.ap ?? "AP");
    at(T.ap, card.ap);
    at(T.hpLabel, st.hp ?? "HP");
    at(T.hp, card.hp);
  }
}

export function createCardShop(sfx = null) {
  const c = {
    _open: false,
    screen: "root",   // root -> buy | booster | reveal | folder (placeholder)
    rootSel: 0,
    packSel: 0,
    shownBits: 0,
    fadeLeaving: false,
    fadeT0: 0,
    lastPull: null,
    prevPull: null,
    revealT0: 0,
    revealActive: false,
    onClose: null,
  };

  c.isOpen = () => c._open;

  /** `shopId` selects the stock set (0x31..0x43, 0x46..0x4A). WALKER RULE: which
   *  id belongs to which physical shop and story state is NOT decoded — the
   *  D0x8008c000 launcher and flag-bank 0x1e..0x30 are the open lead — so
   *  callers that do not know pass none and get record 0, the same fallback the
   *  disc's lookup uses for an unknown id. */
  c.open = (state, onClose = null, onEditFolder = null, shopId = null) => {
    c._open = true;
    c.shopId = shopId;
    loadCatalog();
    loadBoosters();
    loadCardPrices();
    loadCardShops();
    loadCardIcons();
    c.state = state;
    c.onClose = onClose;
    c.onEditFolder = onEditFolder;
    c.screen = "root";
    c.rootSel = 0;
    c.buyCursor = 0;
    c.packSel = 0;
    c.shownBits = state?.bits ?? 0;
    c.fadeLeaving = false;
    c.lastPull = null;
    c.prevPull = null;
    c.revealActive = false;
    c.message = "";
  };

  /** The cards this shop offers. DECODED: a stock set is six card ids from the
   *  0xC-stride table at 0x8008CDD4, chosen by shop id, NOT the whole catalog.
   *  `c.shopId` is set by the caller; an id the table does not know falls back
   *  to record 0, which is what the disc's lookup does. */
  function buyList() {
    const cat = catalog();
    if (!cat) return [];
    const ids = shopStock(c.shopId);
    // Before card_shops.json has loaded there is no stock to show. Showing the
    // whole catalog instead — the old behaviour — invented inventory.
    return ids.map((id) => cardById(id)).filter(Boolean);
  }

  function close() {
    c._open = false;
    c.fadeLeaving = false;
    c.revealActive = false;
    c.onClose?.();
  }

  function requestLeave() {
    if (c.fadeLeaving) return;
    c.fadeLeaving = true;
    c.fadeT0 = performance.now();
  }

  function leaveFadeAlpha(nowMs = performance.now()) {
    if (!c.fadeLeaving) return 0;
    const frames = Math.max(0, Math.floor((nowMs - c.fadeT0) / VSYNC_MS));
    return Math.min(255, (frames * LEAVE_FADE_DELTA) >> 8) / 255;
  }

  function paintLeaveFade(ctx, nowMs) {
    const a = leaveFadeAlpha(nowMs);
    if (a <= 0) return;
    paintScreenDim(ctx, a * 255, 320, 240);
  }

  function refreshBits() {
    // SCREEN-OBJECT-METHODS-001, shop_refresh_bits: the Bits number in the
    // shop corner updates after you pay.
    c.shownBits = c.state?.bits ?? 0;
  }

  function beginReveal(pull) {
    c.prevPull = c.lastPull;
    c.lastPull = pull;
    c.revealActive = true;
    c.revealT0 = performance.now();
    c.screen = "reveal";
  }

  function revealCount(nowMs = performance.now()) {
    if (!c.revealActive) return 6;
    const frames = Math.max(0, Math.floor((nowMs - c.revealT0) / VSYNC_MS));
    const n = Math.min(6, Math.floor(frames / REVEAL_FRAMES_PER_CARD));
    if (n >= 6) c.revealActive = false;
    return n;
  }

  c.handleKey = (rawKey) => {
    // Accept either a pad button name from the dispatcher or the raw key it
    // stands for, so a caller (and a test) may use whichever it has.
    const k = asButton(rawKey);
    if (!c._open) return false;
    if (c.fadeLeaving) return true;
    const confirm = k === "circle";
    const back = k === "cross";

    if (c.screen === "root") {
      const n = LAYOUT?.root_menu?.optionCount ?? 3;
      if (k === "up") { sfx?.play("system02"); c.rootSel = Math.max(0, c.rootSel - 1); return true; }
      if (k === "down") { sfx?.play("system02"); c.rootSel = Math.min(n - 1, c.rootSel + 1); return true; }
      if (confirm) {
        sfx?.play("system00");
        c.message = "";
        if (c.rootSel === 2) {
          if (c.onEditFolder) { c.onEditFolder(); return true; }
          return true;
        }
        if (c.rootSel === 1 && !heldPackSets().length) {
          // The disc's root confirm has already played its cue and the popup
          // that follows is silent (F0x8008838C state 3 -> state 0x64/0x65).
          c.message = LAYOUT?.strings?.noBoosters ?? "No boosters";
          return true;
        }
        c.screen = c.rootSel === 0 ? "buy" : "booster";
        c.buyCursor = 0;
        c.packSel = 0;
        return true;
      }
      if (back) { sfx?.play("system01"); requestLeave(); return true; }
      return true;
    }

    if (c.screen === "buy") {
      const list = buyList();
      const step = (d) => { c.buyCursor = Math.max(0, Math.min(list.length - 1, c.buyCursor + d)); sfx?.play("system06"); };
      if (k === "left") { step(-1); return true; }
      if (k === "right") { step(1); return true; }
      if (k === "l1") { step(-6); return true; }
      if (k === "r1") { step(6); return true; }
      if (confirm) {
        if (!list.length) return true;
        sfx?.play("system07");
        c.screen = "confirm";
        c.confirmSel = 0;
        return true;
      }
      if (back) { sfx?.play("system01"); c.screen = "root"; return true; }
      return true;
    }

    if (c.screen === "confirm") {
      if (k === "up") { sfx?.play("system02"); c.confirmSel = 0; return true; }
      if (k === "down") { sfx?.play("system02"); c.confirmSel = 1; return true; }
      if (confirm) {
        if (c.confirmSel === 0) {
          // F0x80086DC4 makes two refusals in this order before the sale:
          // money at save+0x6C below the price (message 0x13), then the owned
          // count for that card already at nine (message 0x14).
          const card = buyList()[c.buyCursor];
          const price = cardPrice(card);
          if (card && (c.state?.bits ?? 0) < price) {
            // The refusal window's own cue (F0x80086DC4 file 0x4c5c / the
            // port's state 12 dismiss): 0x0004001C.
            sfx?.play("system07");
            c.message = LAYOUT?.strings?.notEnoughBit ?? "Not enough BIT.";
          } else if (card && ownedCount(cards(), card.id) >= COLLECTION_CAP) {
            sfx?.play("system07");
            c.message = LAYOUT?.strings?.tooManyCards ?? "Too many cards";
          } else if (card) {
            c.state.bits -= price;
            grantCard(cards(), card.id, 1);
            refreshBits();
            // The prompt's own confirm (file 0x4a34): 0x8004503C.
            sfx?.play("system00");
            c.message = "";
          } else {
            sfx?.play("system07");
            c.message = LAYOUT?.strings?.notEnoughBit ?? "Not enough BIT.";
          }
        } else sfx?.play("system00");
        c.screen = "buy";
        return true;
      }
      if (back) { sfx?.play("system01"); c.screen = "buy"; return true; }
      return true;
    }

    if (c.screen === "booster") {
      // Sets with no stock are not listed: you cannot open a pack you do not
      // hold, and there is no price — packs are won, not bought.
      const held = heldPackSets();
      if (held.length) {
        if (k === "up") { sfx?.play("system02"); c.packSel = Math.max(0, c.packSel - 1); return true; }
        if (k === "down") { sfx?.play("system02"); c.packSel = Math.min(held.length - 1, c.packSel + 1); return true; }
        if (k === "l1") { sfx?.play("system02"); c.packSel = Math.max(0, c.packSel - 8); return true; }
        if (k === "r1") { sfx?.play("system02"); c.packSel = Math.min(held.length - 1, c.packSel + 8); return true; }
      }
      if (confirm) {
        const setId = held[Math.min(c.packSel, held.length - 1)];
        const pull = setId === undefined ? null : openBooster(setId);
        if (pull) {
          beginReveal(pull);
          sfx?.play("system00"); // the booster list's confirm (F0x800844B8 file 0x1eac)
          c.message = LAYOUT?.strings?.openedBooster ?? "Opened booster.";
          if (c.packSel >= heldPackSets().length) c.packSel = 0;
        } else {
          sfx?.play("system00");
          c.message = LAYOUT?.strings?.noBoosters ?? "No boosters";
        }
        return true;
      }
      if (back) { sfx?.play("system01"); c.screen = "root"; c.lastPull = null; return true; }
      return true;
    }

    if (c.screen === "reveal") {
      if (back || confirm) {
        sfx?.play("system01"); // the reveal list's cancel (F0x800844B8 file 0x2350)
        c.screen = "booster";
        c.revealActive = false;
        return true;
      }
      return true;
    }

    return true;
  };

  c.draw = (ctx, w, h, state) => {
    if (!c._open) return;
    const nowMs = performance.now();
    if (c.fadeLeaving) {
      const frames = Math.max(0, Math.floor((nowMs - c.fadeT0) / VSYNC_MS));
      if (frames * LEAVE_FADE_DELTA >= LEAVE_FADE_MAX) { close(); return; }
    }
    const s = Math.max(1, Math.min(w / 320, h / 240));
    ctx.save();
    ctx.scale(s, s);
    const vw = w / s, vh = h / s;
    const L = LAYOUT;
    const chromeReady = L && packReady(stcdsp);
    const bits = c.shownBits ?? state?.bits ?? 0;

    // disasm: stcrdshp.s L5405-L5434 draws stcdsp clip 0x8 at (counter, counter) — the
    // counter at +0x58 advances by 1 only on frames where the +0x5c toggle is
    // already set and resets at 0x60, so the wall drifts down-right at half a
    // pixel per vsync. The flat fill stays as the colour behind it.
    ctx.fillStyle = "#0a0a20";
    ctx.fillRect(0, 0, vw, vh);
    if (chromeReady) drawPackBackdrop(ctx, stcdsp, 8, 320, 240);

    if (c.screen === "root") {
      const rm = L?.root_menu ?? {
        header: [29, 22], footerBack: [211, 204],
        bitDigits: [279, 28], bitLabel: [282, 28],
        optionsX: 167, optionsY0: 53, optionsStepY: 14,
        optionCount: 3, prompt: [154, 113],
      };
      const furn = L?.furniture;
      if (chromeReady && furn) {
        if (furn.titlePlate) drawClip(ctx, stcdsp, furn.titlePlate.clip, furn.titlePlate.xy[0], furn.titlePlate.xy[1]);
        if (furn.titlePlateB) drawClip(ctx, stcdsp, furn.titlePlateB.clip, furn.titlePlateB.xy[0], furn.titlePlateB.xy[1]);
        if (furn.optionPlate) drawClip(ctx, stcdsp, furn.optionPlate.clip, furn.optionPlate.xy[0], furn.optionPlate.xy[1]);
        if (furn.backPlate) drawClip(ctx, stcdsp, furn.backPlate.clip, furn.backPlate.xy[0], furn.backPlate.xy[1]);
      }
      drawText(ctx, String(bits), rm.bitDigits[0], rm.bitDigits[1]);
      drawText(ctx, L?.strings?.bit ?? "BIT", rm.bitLabel[0], rm.bitLabel[1]);
      const opts = rm.optionStrings
        ?? (L?.strings
          ? [L.strings.buyOneCard, L.strings.openBooster, L.strings.editFolder]
          : ["Buy One Card", "Open Booster", "Edit Folder"]);
      opts.forEach((t, i) => {
        const y = rm.optionsY0 + i * rm.optionsStepY;
        if (i === c.rootSel) drawText(ctx, ">", rm.optionsX, y);
        drawText(ctx, t, rm.optionsX + 12, y);
      });
      drawText(ctx, L?.strings?.back ?? "[triangle] Button:Back", rm.footerBack[0], rm.footerBack[1]);
      if (c.message) drawText(ctx, c.message, rm.prompt[0], rm.prompt[1], { scale: 0.7 });
    } else if (c.screen === "buy") {
      // Buy One Card is the 6-wide stock row (F0x80086dc4 case 2: unk5C
      // clamped 0..5). The 8-slot 2×4 grid belongs to Open Booster.
      const fg = L?.folder_grid ?? {
        cols: 6, cellW: 42, cellH: 54,
        cardBackX0: 35, cardBackY0: 68,
        cursorClip: 6, cursorX0: 35, cursorStepX: 42, cursorY0: 68, cursorStepY: 54,
      };
      const list = buyList();
      drawText(ctx, L?.strings?.buyOneCard ?? "Buy One Card", 24, 18);
      drawText(ctx, `${bits} BIT`, 230, 18, { scale: 0.8 });
      for (let i = 0; i < list.length && i < (fg.cols ?? 6); i++) {
        const x = (fg.cardBackX0 ?? 35) + i * (fg.cellW ?? 42);
        const y = fg.cardBackY0 ?? 68;
        const card = list[i];
        const frame = Math.max(0, COLOUR_FRAMES.indexOf(card.colour));
        if (chromeReady) drawClip(ctx, stcdsp, frame, x, y);
        if (i === c.buyCursor && chromeReady) {
          drawClip(ctx, stcdsp, fg.cursorClip ?? 6, x, y);
        }
      }
      if (c.message) drawText(ctx, c.message, 24, 200, { scale: 0.7 });
      drawText(ctx, L?.strings?.back ?? "[triangle] Button:Back", 16, vh - 16);
    } else if (c.screen === "confirm") {
      const dp = L?.card_detail_popup ?? {
        statOrWarnLabel: [259, 126], buyLabel: [252, 124], priceLabel: [130, 124],
        explainWindowClip: 44, explainWindowXY: [123, 51],
        explainSubClip: 45, explainSubXY: [175, 80],
        bottomLine: BOTTOM_LINE,
      };
      const bc = L?.buy_confirm ?? {
        buy: [197, 86], no: [197, 102], cursor: [184, 86], cursorStepY: 16,
      };
      const sel = buyList()[c.buyCursor];
      if (chromeReady) {
        drawClip(ctx, stcdsp, dp.explainWindowClip, dp.explainWindowXY[0], dp.explainWindowXY[1]);
        drawClip(ctx, stcdsp, dp.explainSubClip, dp.explainSubXY[0], dp.explainSubXY[1]);
      }
      if (sel) {
        // The detail panel's own fourteen text places (F0x8008300c and
        // F0x80086074) -- the Card Album's popup shape moved up. Until
        // 2026-09-03 the walker drew the price and an invented "ap/hp" string
        // at the panel's PICTURE anchors instead.
        drawDetailText(ctx, L, sel, ownedCount(cards(), sel.id));
        const bl = dp.bottomLine ?? BOTTOM_LINE;
        const noPrice = (bl.hintCardIds ?? []).includes(sel.id);
        if (noPrice) {
          drawText(ctx, L?.strings?.[bl.hintString] ?? "R1",
            bl.hintX, bl.y, { scale: 0.7 });
        } else {
          drawText(ctx, `${cardPrice(sel)} BIT`, bl.priceX, bl.y, { scale: 0.7 });
        }
      }
      drawText(ctx, L?.strings?.buy ?? "BUY", bc.buy[0], bc.buy[1]);
      drawText(ctx, L?.strings?.no ?? "NO", bc.no[0], bc.no[1]);
      drawText(ctx, ">", bc.cursor[0], bc.cursor[1] + c.confirmSel * bc.cursorStepY);
      drawText(ctx, L?.strings?.back ?? "[triangle] Button:Back", 16, vh - 16);
    } else if (c.screen === "booster") {
      // Open Booster uses the 8-slot 2×4 grid (F0x8008300c / F0x800832c8).
      const bl = L?.buy_list ?? {
        cols: 2, rows: 4, labelX0: 55, labelStepX: 131, labelY0: 57, labelStepY: 14,
        iconX0: 40, iconStepX: 131, iconY0: 57, iconStepY: 14, cellFrameClip: 49,
        cursor: [29, 57], scrollUpClip: 72, scrollUpXY: [30, 116],
        scrollDownClip: 71, scrollDownXY: [253, 116],
        l1Label: [45, 113], r1Label: [258, 113], infoPlateClip: 43, infoPlateXY: [0, 50],
      };
      const held = heldPackSets();
      const perPage = (bl.rows ?? 4) * (bl.cols ?? 2);
      const page = Math.floor(c.packSel / perPage);
      if (chromeReady) drawClip(ctx, stcdsp, bl.infoPlateClip, bl.infoPlateXY[0], bl.infoPlateXY[1]);
      drawText(ctx, L?.strings?.openWhichBooster ?? "Open which booster?", 24, 18);
      if (!held.length) {
        drawText(ctx, L?.strings?.noBoosters ?? "No boosters", bl.labelX0, bl.labelY0, { scale: 0.7 });
      } else {
        for (let i = 0; i < perPage; i++) {
          const idx = page * perPage + i;
          if (idx >= held.length) break;
          const col = Math.floor(i / bl.rows), row = i % bl.rows;
          const iconX = bl.iconX0 + col * bl.iconStepX;
          const y = bl.labelY0 + row * bl.labelStepY;
          if (chromeReady) drawClip(ctx, stcdsp, bl.cellFrameClip, iconX, bl.iconY0 + row * bl.iconStepY);
          const setId = held[idx];
          drawText(ctx, `Booster ${setId}  x${packCount(cards(), setId)}`,
            bl.labelX0 + col * bl.labelStepX, y, { scale: 0.65 });
          if (idx === c.packSel) {
            drawText(ctx, ">", bl.cursor[0] + col * bl.labelStepX, bl.cursor[1] + row * bl.labelStepY);
          }
        }
        if (chromeReady && held.length >= 2) {
          if (page > 0) drawClip(ctx, stcdsp, bl.scrollUpClip, bl.scrollUpXY[0], bl.scrollUpXY[1]);
          if ((page + 1) * perPage < held.length) {
            drawClip(ctx, stcdsp, bl.scrollDownClip, bl.scrollDownXY[0], bl.scrollDownXY[1]);
          }
        }
        if (page > 0) drawText(ctx, L?.strings?.l1 ?? "L1", bl.l1Label[0], bl.l1Label[1], { scale: 0.7 });
        if ((page + 1) * perPage < held.length) {
          drawText(ctx, L?.strings?.r1 ?? "R1", bl.r1Label[0], bl.r1Label[1], { scale: 0.7 });
        }
      }
      if (c.message) drawText(ctx, c.message, 24, 200, { scale: 0.7 });
      drawText(ctx, L?.strings?.back ?? "[triangle] Button:Back", 16, vh - 16);
    } else if (c.screen === "reveal") {
      // Six-card grid: same 0x2A × 0x36 cells the album uses. Coordinates
      // are stcrdshp_ui.json folder_grid (F0x800857b0 / F0x80085bac).
      // pack_reveal_begin keeps the previous faces in the slots until the
      // new six have been dealt, so they cross-fade rather than pop.
      const fg = L?.folder_grid ?? {
        cols: 6, cellW: 42, cellH: 54,
        cardArtX0: 39, cardArtY0: 101,
        cardBackX0: 35, cardBackY0: 68,
        cursorClip: 6, cursorX0: 35, cursorStepX: 42, cursorY0: 68, cursorStepY: 54,
      };
      const dealt = revealCount(nowMs);
      const prev = c.prevPull ?? [];
      const next = c.lastPull ?? [];
      drawText(ctx, L?.strings?.openedBooster ?? "Opened booster.", 24, 18);
      for (let i = 0; i < 6; i++) {
        const col = i % fg.cols;
        const row = Math.floor(i / fg.cols);
        const backX = fg.cursorX0 + col * fg.cursorStepX;
        const backY = fg.cursorY0 + row * (fg.cursorStepY ?? fg.cellH);
        if (i >= dealt) {
          if (chromeReady) drawClip(ctx, stcdsp, fg.cursorClip, backX, backY);
          continue;
        }
        const card = next[i] ?? prev[i];
        if (card) {
          const frame = Math.max(0, COLOUR_FRAMES.indexOf(card.colour));
          if (chromeReady) drawClip(ctx, stcdsp, frame, backX, backY);
        }
      }
      if (c.message) drawText(ctx, c.message, 24, 200, { scale: 0.7 });
      drawText(ctx, L?.strings?.back ?? "[triangle] Button:Back", 16, vh - 16);
    }

    paintLeaveFade(ctx, nowMs);
    ctx.restore();
  };

  return c;
}
