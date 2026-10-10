// web/shop.js — the item shop, rebuilt to the REAL stitshop flow + chrome.
//
// Ground truth: live rig walks (armory/item/pawn 2026-09-09) + full stitshop
// decode (docs/research/ui/shop-system-decompiled.md, incl. the 2026-09-09
// SFX census and render-helpers pass). Flow:
//   root BUY/SELL -> BUY: stock list -> qty -> Buy/No -> (equipment only:
//     Equip? -> Equip who? -> "Equipped.") -> list.
//   root SELL: 4-category menu (Items/Weapons/Armor/Accessories; empty shelf
//     says "Don't have {X}.") -> sell list -> qty -> Sell/No
//     -> remaining-item list or category menu. Rejects: full bag "Too many items", broke
//     "Not enough BIT." (both dismissed with X).
// Sounds (7, not 3): system00 confirm, system01 cancel, system02 cursor,
// system03 fold-open, system04 fold-close, system06 stepper tick (qty change,
// equip-member move), system07 apply tick (qty confirms, equip assign,
// message dismissals). CIRCLE toggle is silent; member moves onto members
// who cannot equip are silent too.
//   - The BUY list is 4 rows × 2 cols per page (8/page); the SELL list is
//     7 rows × 2 cols (14/page) with no held counts or Effects prompt — both
//     with a real per-item ICON (cmfont clip, see web/itemicons.js) and an
//     ICON (cmfont clip, see web/itemicons.js) and an underline per cell;
//     "N / M" page indicator + L1/R1 tabs (clips 16/17).
//   - The BIT balance renders with a "'" thousands separator (rig: 129'781).
//
// Chrome geometry (2026-07-10b): fully static-decoded from the overlay draw
// fns — including the three m2c FAILED (asm-transcribed) — see
// web/assets/data/shop_ui.json `chrome` (tools/extract_shop_ui.py) and
// docs/research/ui/shop-system-decompiled.md §3d. Key corrections over the
// first rig-eyeballed pass:
//   - The list sits on a full-width deep-blue WINDOW: clip 6 (BUY, 320×85 at
//     y=29) / clip 7 (SELL, 320×127).
//   - Clip 14 (not 3) is the info band at (15, 108+42·mode) — its right
//     section IS the price plate (gold "{n} BIT" inside it).
//   - Clip 3 (not 14) is the description window at (0, 156+40·mode).
//   - Clip 9 at (0,129) is the "[circle] Button: Effects" prompt plate
//     (drawn by the cards fn F0x8008a450; BUY only); text at (19,135).
//   - L1/R1 tabs: clips 16/17 at x=30/253, y=95+42·mode (CLUT-blink).
//   - Qty: "How many?" plate clip 10 @ (154,52), spinner clip 11 @ (246,79),
//     arrows 18/19 @ (290,81)/(290,91). Confirm: total plate clip 21 @
//     (123,38) + window clip 12 @ (175,67). Message plate: clip 21 @ (123,132).
// All strings are the real esitshop.toml entries.
import { paintScreenDim } from "./screendim.js";
import { asButton } from "./input.js";
import {
  ITEM_BY_ID, EQUIPMENT_BY_ID, storeAddItem, storeRemoveItem, heldCount, wornCount,
  commitEquipEvent, createShopManager,
  computeEquipPreview, gearAccessibleForLine, shopEquipSwap, rosterSlotOfCharId, ui,
  shopBuyRefusal, shopBuyQuantityCeiling, shopBuyCommit, shopBuyAfterEquip,
} from "./vendor/engine.js";
import { drawText, textWidth, drawIconGlyph } from "./uifont.js";
import { loadPack, drawClip, drawPackBackdrop } from "./screenpack.js";
import { drawItemIcon } from "./itemicons.js";
import { formatBits } from "./itemicons-data.js";
import { partyRosterView, syncLeadEquipBonuses } from "./party.js";
import shopLayout from "./assets/data/shop_ui.json" with { type: "json" };

const SELL_RATIO = 0.5; // fallback only — decoded items carry a real `sell` price
const sellUnit = (item) => item?.sell ?? Math.floor((item?.price ?? 0) * SELL_RATIO);

// Real esitshop.toml strings.
const STR_BUY = "BUY", STR_SELL = "SELL";              // 3/4
const STR_BACK = "[triangle] Button: Back";            // 5
const STR_EQUIP = "Equip", STR_ITEMS = "Items";        // 6/7
const STR_FX = "[circle] Button: Effects";             // 10
const STR_DETAILS = "[circle] Button: Details";        // 11
const CURSOR = "[arrow-right]";                        // 12
const STR_HOWMANY = "How many?";                       // 17
const STR_NO_BIT = "Not enough BIT.";                  // 27
const STR_TOO_MANY = "Too many items";                 // reject, full bag
const STR_EQUIPPED = "Equipped.";                      // post-equip message
const STR_EQUIP_Q = "Equip?";                          // 21
const STR_YES = "Yes", STR_NO = "No";                  // 22/23/20
const SELL_CATS = ["Items", "Weapons", "Armor", "Accessories"];
// stitshop's 0x8008CB1C class-label table selects these ESITSHOP lines from
// the item's descriptor byte +2. The detail panel prints the extra line for
// item classes 2..13 (exe-decomp/stitshop_c/F0x8008a0d0.c:11-21).
const WEAPON_CLASS_LINES = {
  2: "Left Hand", 3: "Right or Left", 4: "Head", 5: "Body",
  6: "Accessory", 7: "Both Hands", 8: "Accessory",
};
const BIT_CAP = 0x98967f;                              // 9,999,999

const NATIVE_W = 320;
const ROW_H = 14;      // list row pitch (0x0E)
// shop_ui.json chrome.cards.stat_rows — the effect card's four stat rows, as
// F0x80089a44 builds them. Rows 0 and 1 are the item's own two stats and carry
// the arrow glyph; rows 2 and 3 are whatever else it changes and do not.
const CARD_STAT_ROWS = [
  { y: 0xAC, beforeX: 0x39, arrowX: 0x3C, afterX: 0x5A },
  { y: 0xBA, beforeX: 0x39, arrowX: 0x3C, afterX: 0x5A },
  { y: 0xC8, beforeX: 0x39, arrowX: null, afterX: 0x63 },
  { y: 0xD6, beforeX: 0x39, arrowX: null, afterX: 0x63 },
];
const GRID_COLS = shopLayout.chrome.list.cell.cols;
const COL_W = 0x83;    // 131 (decoded column stride)
// F0x80087cfc.c:12-24 selects 8 BUY entries and 14 SELL entries per page;
// F0x80087428.c:12-25 creates fourteen two-column row positions.
const pageSize = (mode) => shopLayout.chrome.list.cell.per_page[mode === 0 ? "buy" : "sell"];

// rig-sampled value colors for the effect cards
const COL_UP = "rgb(96,176,248)";
const COL_DOWN = "rgb(208,80,72)";

// Window open FOLD animation — the native tween is DECODED (stitshop
// 0x8008c42c/c46c, the [0x8008D1B8/D1BC] helpers): a generic linear 8.8
// fixed-point tween, value from→to over `steps` vsyncs, no easing; shop
// windows use steps=0xA → 10 vsyncs = 0.2 s PAL. The value feeds sp9C as an
// x- or y-scale around the spA4 pivot; labels draw only once the window
// reports ready (tween landed).
const ANIM_T = 0.2;
const VSYNC_S = 0.02; // PAL 50 Hz, same beat ANIM_T counts in

// Leave dim (SCREEN-OBJECT-METHODS-001, fade_object_start). Home-screen
// triangle runs direction 0, duration 0x1E: the 8.8 dim word goes
// 0 → 0xFF00 in 30 frames, then the shop is gone. F0x8008b908 case 20.
const LEAVE_FADE_FRAMES = 0x1E;
const LEAVE_FADE_MAX = 0xFF00;
const LEAVE_FADE_DELTA = Math.trunc(LEAVE_FADE_MAX / LEAVE_FADE_FRAMES);

const stshop = loadPack("stshop");

let digimonDB = null;
fetch("assets/data/digimon.json")
  .then((r) => r.json())
  .then((j) => { digimonDB = Object.fromEntries(j.digimon.map((d) => [d.id, d])); })
  .catch(() => {});

// stat key -> uifont icon-glyph name ("elem_fire" -> "fire")
const iconNameFor = (stat) => (stat.startsWith("elem_") ? stat.slice(5) : stat);

export function createShop(sfx = null) {
  const sh = {
    _open: false,
    stock: [],
    name: "",
    // Rig-verified flow: root BUY/SELL -> list -> qty -> confirm.
    screen: "root",
    mode: 0,          // 0=buy 1=sell
    bsIdx: 0,
    catIdx: 0,        // sell-category cursor (Items/Weapons/Armor/Accessories)
    cursor: 0,        // linear index into the list (row-major over the grid)
    page: 0,
    qty: 1,
    confirmIdx: 0,    // 0 = Buy/Sell, 1 = No
    equipIdx: 0,      // Equip? cursor (0=Yes, 1=No)
    equipWhoIdx: 0,   // Equip-who member cursor
    infoView: "desc", // "desc" | "effects" (CIRCLE toggle, equipment only)
    feedbackMsg: null,
    feedbackNext: null,
    time: 0,
    fadeLeaving: false,
    fadeT0: 0,
    onClose: null,
  };

  sh.isOpen = () => sh._open;

  // per-window fold-anim start times ("never started" = already open)
  sh._anim = {};
  sh._animStart = (...keys) => { for (const k of keys) sh._anim[k] = sh.time; };
  // Progress now comes from the shared fold class (engine/dw3/ui/fold-tween.ts),
  // not a local formula. `null` start = never animated = already open.
  sh._animP = (key) =>
    ui.foldTransformAtTime(sh.time, sh._anim[key] ?? null, 0, 0, "x", ANIM_T).progress;

  // Backing out of a plate state returns to the list and re-runs the list
  // window's fold-open; the overlay's qty-cancel path starts that animation
  // before the cursor comes back (F0x80083eb0 states 9/10 call the list
  // window's open method on arg0+0x88).
  const backToList = () => { sh.screen = "list"; sh._animStart("list"); };

  sh.open = (stock, onClose = null, opts = {}) => {
    sh._open = true;
    sh._anim = {};
    sh._animStart("rootName", "rootBit", "rootMenu", "rootFooter");
    sh.stock = stock;
    sh.name = opts.name ?? "";
    sh.screen = "root";
    sh.mode = 0;
    sh.bsIdx = 0;
    sh.catIdx = 0;
    sh.cursor = 0;
    sh.page = 0;
    sh.qty = 1;
    sh.confirmIdx = 0;
    sh.equipIdx = 0;
    sh.equipWhoIdx = 0;
    sh.infoView = "desc";
    sh.feedbackMsg = null;
    sh.feedbackNext = null;
    sh.fadeLeaving = false;
    sh.leaveFoldT0 = null;
    sh.onClose = onClose;
  };

  sh.close = () => {
    sh._open = false;
    sh.fadeLeaving = false;
    sh.leaveFoldT0 = null;
    if (sh.onClose) { const cb = sh.onClose; sh.onClose = null; cb(); }
  };

  function requestLeave() {
    if (sh.fadeLeaving) return;
    // The native teardown folds the windows shut (close runs double speed:
    // ~5 frames) before the 30-frame dim. Play the fold-close whoosh here.
    sfx?.play("system04");
    sh.fadeLeaving = true;
    sh.leaveFoldT0 = sh.time;
    sh.fadeT0 = sh.time;
  }

  // Fold-shut progress 1 -> 0 over the first 5 frames of leaving (decoded
  // close step = (0x1000/0xA)*2 per frame); then the dim runs alone.
  function leaveFoldP() {
    if (!sh.fadeLeaving || sh.leaveFoldT0 == null) return 1;
    return Math.max(0, 1 - (sh.time - sh.leaveFoldT0) / (5 * VSYNC_S));
  }

  // Fold-shut takes 5 frames; the 30-frame dim starts after it lands.
  const LEAVE_FOLD_FRAMES = 5;

  function leaveFadeAlpha() {
    if (!sh.fadeLeaving) return 0;
    const t = sh.time - sh.fadeT0 - LEAVE_FOLD_FRAMES * VSYNC_S;
    const frames = Math.max(0, Math.floor(t / VSYNC_S));
    return Math.min(255, (frames * LEAVE_FADE_DELTA) >> 8) / 255;
  }

  function paintLeaveFade(ctx) {
    const a = leaveFadeAlpha();
    if (a <= 0) return;
    paintScreenDim(ctx, a * 255, NATIVE_W, 240);
  }

  sh._currentList = (state) => {
    if (sh.mode === 1) {
      // The resident item provider scans the category's original item-ID
      // directory in table order, then the shop omits zero-price entries. The
      // SELL side asks it for a POSITIVE kind — its category cursor is clamped to
      // 0..3 and the four kinds it then asks for are stitshop 0x8008CAA8's first
      // four words, 1/2/3/4 — and a positive kind never consults the worn byte
      // (`exe/f3.s`), so a piece that is only on a partner's hand is NOT on this
      // shelf. Take it off first (the merchant's equip-apply, 0x8008C880) and it
      // becomes sellable, which is the original's order of operations.
      return shopLayout.sell_catalog[sh.catIdx]
        .filter((id) => heldCount(state, id) > 0 && sellUnit(ITEM_BY_ID[id]) > 0)
        .map((id) => ({ id, qty: null }));
    }
    return sh.stock.map((id) => ({ id, qty: null }));
  };

  sh._selected = (state) => {
    const list = sh._currentList(state);
    return list[sh.cursor] ?? null;
  };

  sh._unitPrice = (item) => (sh.mode === 0 ? (item?.price ?? 0) : sellUnit(item));

  sh._maxQty = (state, item) => {
    if (sh.mode === 1) return Math.max(1, heldCount(state, item?.id ?? 0));
    // The original's ceiling is 99 - held (stitshop's quantity selector), paid for
    // out of the wallet; both are the shared store's count and the BIT total.
    return Math.max(1, shopBuyQuantityCeiling(heldCount(state, item?.id ?? 0),
      state.bits ?? 0, item?.price ?? 0));
  };

  sh.handleKey = (rawKey, state) => {
    // Accept either a pad button name from the dispatcher or the raw key it
    // stands for, so a caller (and a test) may use whichever it has.
    const key = asButton(rawKey);
    if (sh.fadeLeaving) return;
    // Refusals accept the confirm or the back bit; Equipped. waits for the confirm.
    if (sh.feedbackMsg) {
      if (key === "circle" || (key === "cross" && sh.feedbackMsg !== STR_EQUIPPED)) {
        sfx?.play("system07");
        sh.feedbackMsg = null;
        if (sh.feedbackNext === "list") {
          sh.infoView = "desc";
          backToList();
          sh._animStart("desc");
        }
        sh.feedbackNext = null;
      }
      return;
    }

    // UI blips per the 2026-09-09 stitshop SFX census: system00 confirm,
    // system01 cancel, system02 cursor, system06 stepper tick, system07 apply
    // tick. (The old build played system00 on CIRCLE and system02 on the qty
    // stepper — both wrong: CIRCLE is silent, the stepper ticks system06.)
    if (sh.screen === "root") {
      const cur = sh.bsIdx;
      if (key === "up") sh.bsIdx = 0;
      else if (key === "down") sh.bsIdx = 1;
      else if (key === "circle") {
        sfx?.play("system00");
        sh.mode = sh.bsIdx;
        if (sh.mode === 1) {
          // Fresh SELL entry resets the category cursor (rig: full36).
          sh.screen = "sellcat"; sh.catIdx = 0;
          sh._animStart("sellcat");
        } else {
          sh.screen = "list";
          sh.cursor = 0; sh.page = 0;
          sfx?.play("system03"); // list + band fold open
          sh._animStart("list", "band", "desc", "prompt");
        }
        return;
      } else if (key === "cross") { sfx?.play("system01"); requestLeave(); return; }
      if (sh.bsIdx !== cur) sfx?.play("system02");
      return;
    }

    if (sh.screen === "sellcat") {
      const cur = sh.catIdx;
      if (key === "up") sh.catIdx = Math.max(0, sh.catIdx - 1);
      else if (key === "down") sh.catIdx = Math.min(SELL_CATS.length - 1, sh.catIdx + 1);
      else if (key === "circle") {
        const stock = sh._currentList(state);
        if (stock.length === 0) {
          // Empty shelf: "Don't have {X}." over the category menu.
          sh._feedback(`Don't have ${SELL_CATS[sh.catIdx]}.`);
          return;
        }
        sfx?.play("system00");
        sh.screen = "list";
        sh.cursor = 0; sh.page = 0;
        sfx?.play("system03"); // list + band fold open
        sh._animStart("list", "band", "desc", "prompt");
        return;
      } else if (key === "cross") {
        sfx?.play("system01");
        sh.screen = "root";
        sh._animStart("rootMenu");
        return;
      }
      if (sh.catIdx !== cur) sfx?.play("system02");
      return;
    }

    // The shop's three face buttons are the game's LOGICAL ids, which is what
    // the decompiled handler reads: 0x0D confirm, 0x0E cancel
    // (docs/research/ui/shop-system-decompiled.md:497, and the ported machines
    // at shop-root-machine.ts:90/94). Word bits, not raw pad bits: 0x0D is
    // 0x2000 and 0x0E is 0x4000, so here they are the names "circle" and
    // "cross". The rig's live button walk (shop-system-decompiled.md:255) names
    // the same three by the buttons an English disc puts on those bits - X
    // confirms, TRIANGLE goes back, CIRCLE is the Details/Effects toggle - and
    // that toggle is logical 0x0C = 0x1000 = the name "triangle".

    // The BUY band accepts logical 0x0C (Effects) while the list, quantity
    // spinner, or Buy/No plate is open (F0x80083eb0 cases 3, 8 and 17).
    // It is SILENT on the real screen (no SFX call on the 0xC arm).
    if (key === "triangle") {
      // Effects cards exist only on the BUY side (the SELL band object never
      // instantiates the cards fn — decoded F0x8008af50 mode split).
      const item = ITEM_BY_ID[sh._selected(state)?.id];
      if (sh.mode === 0 && ["list", "qty", "confirm"].includes(sh.screen)
        && item && EQUIPMENT_BY_ID[item.id]) {
        sh.infoView = sh.infoView === "desc" ? "effects" : "desc";
        sh._animStart(sh.infoView === "effects" ? "cards" : "desc");
      }
      return;
    }

    if (sh.screen === "qty") {
      const item = ITEM_BY_ID[sh._selected(state)?.id];
      const max = sh._maxQty(state, item);
      const q = sh.qty;
      // F0x80083eb0 case 8 / sell case 0x17: up/down ±1, left −10 (floor 1),
      // right +10 (clamp ceiling). Every change ticks system06.
      if (key === "up") sh.qty = Math.min(max, sh.qty + 1);
      else if (key === "down") sh.qty = Math.max(1, sh.qty - 1);
      else if (key === "left") sh.qty = sh.qty - 10 < 10 ? 1 : sh.qty - 10;
      else if (key === "right") sh.qty = Math.min(max, sh.qty + 10);
      else if (key === "circle") {
        sfx?.play("system07"); sh.screen = "confirm"; sh.confirmIdx = 0;
        sh._animStart("cfmPlate", "cfm");
        return;
      }
      else if (key === "cross") { sfx?.play("system01"); backToList(); return; }
      if (sh.qty !== q) sfx?.play("system06");
      return;
    }

    if (sh.screen === "confirm") {
      const c = sh.confirmIdx;
      if (key === "up") sh.confirmIdx = 0;
      else if (key === "down") sh.confirmIdx = 1;
      else if (key === "circle") {
        sfx?.play("system00");
        if (sh.confirmIdx === 0) sh._commit(state);
        else backToList();
        return;
      } else if (key === "cross") { sfx?.play("system01"); backToList(); return; }
      if (sh.confirmIdx !== c) sfx?.play("system02");
      return;
    }

    // Both lists use two columns; BUY has four rows, SELL has seven.
    if (sh.screen === "list") {
    const list = sh._currentList(state);
    const cur = sh.cursor, pg = sh.page;
    const last = Math.max(0, list.length - 1);
    const step = GRID_COLS;
    if (key === "up") sh.cursor = Math.max(0, sh.cursor - step);
    else if (key === "down") sh.cursor = Math.min(last, sh.cursor + step);
    else if (key === "left") sh.cursor = Math.max(0, sh.cursor - 1);
    else if (key === "right") sh.cursor = Math.min(last, sh.cursor + 1);
    else if (key === "l1") sh.page = Math.max(0, sh.page - 1);
    else if (key === "r1") sh.page = Math.min(Math.floor(last / pageSize(sh.mode)), sh.page + 1);
    else if (key === "circle") {
      if (list.length > 0) {
        if (sh.mode === 0) {
          // The confirm blip plays first; then full-bag (0x1C) and broke
          // (0x1B) rejects fire before the quantity box (buy state 3).
          sfx?.play("system00");
          const sel = ITEM_BY_ID[list[sh.cursor]?.id];
          const held = heldCount(state, sel?.id ?? 0);
          const refusal = shopBuyRefusal(held, state.bits ?? 0, sel?.price ?? 0);
          if (refusal === "too-many") { sh._feedback(STR_TOO_MANY); return; }
          if (refusal === "not-enough") { sh._feedback(STR_NO_BIT); return; }
        } else {
          sfx?.play("system00");
        }
        sh.screen = "qty"; sh.qty = 1;
        sh._animStart("qty", "qtySpin");
      }
      return;
    } else if (key === "cross") {
      sfx?.play("system01");
      // BUY triangles to the root; SELL triangles back to the category menu.
      sh.screen = sh.mode === 0 ? "root" : "sellcat";
      sh._animStart("rootMenu");
      return;
    }
    if (sh.page !== pg) sh.cursor = Math.min(last, sh.page * pageSize(sh.mode));
    else if (sh.cursor !== cur) sh.page = Math.floor(sh.cursor / pageSize(sh.mode));
    if (sh.cursor !== cur || sh.page !== pg) sfx?.play("system02");
    return;
    }

  if (sh.screen === "equip") {
    // Equip? Yes/No with the member cards up (buy state 0x1B).
    const c = sh.equipIdx;
    if (key === "up") sh.equipIdx = 0;
    else if (key === "down") sh.equipIdx = 1;
    else if (key === "circle") {
      if (sh.equipIdx === 0) {
        sfx?.play("system00");
        const first = sh._equipCards(state).findIndex((card) => card.preview?.slot && card.accessible);
        if (first < 0) { backToList(); return; }
        sh.screen = "equipwho"; sh.equipWhoIdx = first;
        sh._animStart("cfm");
      } else {
        // Live: No returns to the list with the cursor kept.
        sfx?.play("system01"); backToList();
      }
      return;
    } else if (key === "cross") { sfx?.play("system01"); backToList(); return; }
    if (sh.equipIdx !== c) sfx?.play("system02");
    return;
  }

  if (sh.screen === "equipwho") {
    // "Equip who?" member select (buy state 0x20): LEFT/RIGHT move, skipping
    // members who cannot wear the item; moves onto a valid member tick
    // system06, dead moves are silent; X assigns with system07 and shows
    // "Equipped.", then offers the next member; TRIANGLE cancels to the list.
    const cards = sh._equipCards(state);
    const canWear = (i) => !!cards[i]?.preview?.slot && !!cards[i]?.accessible;
    const cur = sh.equipWhoIdx;
    if (key === "left" || key === "right") {
      const dir = key === "right" ? 1 : -1;
      let i = cur;
      for (;;) {
        const n = i + dir;
        if (n < 0 || n >= cards.length) break; // clamped, silent
        i = n;
        if (canWear(i)) break;
      }
      sh.equipWhoIdx = canWear(i) ? i : cur;
    } else if (key === "circle") {
      if (canWear(sh.equipWhoIdx) && sh._equipOn(state, sh.equipWhoIdx)) {
        sfx?.play("system07");
        sh._feedback(STR_EQUIPPED);
        // BUY state 40 returns to the list if the last copy was equipped;
        // otherwise the member picker stays open for another copy.
        const held = heldCount(state, sh._selected(state)?.id ?? 0);
        sh.feedbackNext = shopBuyAfterEquip(held);
      }
      return;
    } else if (key === "cross") { sfx?.play("system01"); backToList(); return; }
    if (sh.equipWhoIdx !== cur) sfx?.play("system06");
    return;
  }
};

  sh._commit = (state) => {
    const slot = sh._selected(state);
    if (!slot) { backToList(); return; }
    const item = ITEM_BY_ID[slot.id];
    if (!item) { backToList(); return; }

    const mgr = createShopManager({
      getGold: () => state.bits,
      setGold: (n) => {
        state.bits = Math.max(0, Math.min(BIT_CAP, n));
        if (typeof localStorage !== "undefined") localStorage.setItem("bits", String(state.bits));
      },
      // The merchant's own commit is the original's: both directions go through
      // the shared store, so the 99 cap and the remove floor are the store's and
      // not a second copy of them.
      addItem: (id, n) => storeAddItem(state, id, n),
      removeItem: (id, n) => storeRemoveItem(state, id, n),
    });

    if (sh.mode === 0) {
      const held = heldCount(state, item.id);
      const next = shopBuyCommit(held, state.bits ?? 0, item.price, sh.qty);
      state.bits = next.bits;
      storeAddItem(state, item.id, next.held - held);
      if (typeof localStorage !== "undefined") localStorage.setItem("bits", String(state.bits));
      sh.qty = 1;
      if (EQUIPMENT_BY_ID[item.id]) {
        // EQUIP-C028 (live, Asuka Armory 2026-09-10): the Equip? plate appears
        // only when at least one present member can wear the item. A wear-mask
        // miss (e.g. LeatherGlove, Kumamon-only) returns straight to the list
        // with the item in the bag.
        const wearable = sh._equipCards(state).some((c) => c.preview?.slot && c.accessible);
        if (!wearable) { backToList(); return; }
        sh.screen = "equip"; sh.equipIdx = 0;
        sh.infoView = "effects";
        sh._animStart("cfm", "cards");
      } else {
        backToList();
      }
    } else {
      // The SELL commit takes CARRIED copies only and stores nothing in the worn
      // array (stitshop states 0x1E-0x22: money up, `bag -= qty` floored at 0). A
      // worn piece is not on this shelf at all, so selling the last carried copy
      // of something a partner is wearing leaves "Equip n" reading n.
      const sellQty = Math.min(sh.qty, heldCount(state, slot.id));
      if (sellQty <= 0) { backToList(); return; }
      mgr.sell(item, sellQty, SELL_RATIO);
      sh.qty = 1;
      // The SELL controller rebuilds the held-item list after a sale. It
      // returns to the category choices only when that list is now empty.
      const remaining = sh._currentList(state);
      if (remaining.length > 0) {
        sh.cursor = Math.min(sh.cursor, remaining.length - 1);
        sh.page = Math.floor(sh.cursor / pageSize(sh.mode));
        backToList();
      } else {
        sh.screen = "sellcat";
        sh.cursor = 0; sh.page = 0;
        sh._animStart("sellcat");
      }
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("inventory", JSON.stringify(state.inventory));
      localStorage.setItem("worn", JSON.stringify(state.worn ?? {}));
    }
  };

  // Equip the selected equipment on party member `mi` (Equip-who confirm):
  // bag −1, replaced unit back to the bag, slot filled (F0x8008c800).
  sh._equipOn = (state, mi) => {
    const slot = sh._selected(state);
    const item = slot && ITEM_BY_ID[slot.id];
    if (!item || !EQUIPMENT_BY_ID[item.id]) return false;
    const members = state.party ?? [];
    if (mi < 0 || mi >= 3 || mi >= members.length) return false;
    if (!state.equipment) state.equipment = [];
    while (state.equipment.length <= mi) state.equipment.push({});
    const cards = partyRosterView(
      state.party, state.partnerStats, state.partyStats, digimonDB ?? {}, state.digimonNames,
    ).slice(0, 3);
    const base = {};
    for (const k of ["str", "def", "spt", "wis", "spd", "chr"]) {
      base[k] = cards[mi]?.stats?.[k] ?? cards[mi]?.profile?.[k] ?? 0;
    }
    const preview = computeEquipPreview(base, state.equipment[mi] ?? {}, item.id);
    if (!preview || !preview.slot) return false; // nobody can wear it here
    // Starter-line gear-access gate (claim EQUIP-C015-shop-gear-access-bitmask).
    if (!gearAccessibleForLine(item.id, rosterSlotOfCharId(cards[mi]?.charId ?? members[mi]) ?? -1)) {
      return false;
    }
    const swap = shopEquipSwap(state.equipment[mi] ?? {}, item.id);
    if (!swap) return false;
    // The original's equip move is worn += 1 / bag -= 1 (ststatus 0x8009A5E4),
    // with whatever it displaced coming back to the bag (0x8009A504). The whole
    // slot map goes through the shared store's one record writer, so the two count
    // arrays move together, a stack cannot pass 99 on either side, and a
    // two-handed piece — which `shopEquipSwap` puts in BOTH hand halfwords — is
    // one worn copy, as in the original, where one writer call moves the byte once.
    if (heldCount(state, item.id) <= 0) return false;
    commitEquipEvent(state, mi, swap.equipment);
    // The lead's cached bonuses feed charisma and the persisted partnerStats;
    // battle.js derives combat stats from the slots directly, but keep the cache
    // honest on this path too (web/menu.js does the same).
    if (mi === 0) syncLeadEquipBonuses(state);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("inventory", JSON.stringify(state.inventory));
      localStorage.setItem("worn", JSON.stringify(state.worn ?? {}));
      // The counter's equip is a persistent state change like the pause menu's
      // (web/menu.js writes this same key), so Continue has to see the slot the
      // player just filled. Without this the money and the bag survived the
      // reload but the equipped item did not.
      localStorage.setItem("equipment", JSON.stringify(state.equipment ?? []));
    }
    return true;
  };

  // Party member cards for the Equip screens (null = cannot wear selected).
  sh._equipCards = (state) => {
    const slot = sh._selected(state);
    const item = slot && ITEM_BY_ID[slot.id];
    if (!item) return [];
    const cards = partyRosterView(
      state.party, state.partnerStats, state.partyStats, digimonDB ?? {}, state.digimonNames,
    ).slice(0, 3);
    return cards.map((member, i) => {
      const base = {};
      for (const k of ["str", "def", "spt", "wis", "spd", "chr"]) {
        base[k] = member.stats?.[k] ?? member.profile?.[k] ?? 0;
      }
      const preview = EQUIPMENT_BY_ID[item.id]
        ? computeEquipPreview(base, state.equipment?.[i] ?? {}, item.id)
        : null;
      // Wearable = has a target slot AND the member's STARTER LINE bit is set in
      // the item's wear mask (claim EQUIP-C015-shop-gear-access-bitmask).
      const accessible = !!preview?.slot
        && gearAccessibleForLine(item.id, rosterSlotOfCharId(state.party?.[i]) ?? -1);
      return { member, preview, accessible };
    });
  };

  sh._feedback = (msg) => {
    // Opening a message plate runs the window fold-open (SYSTEM03 whoosh);
    // dismissing one plays the apply tick (SYSTEM07) — see handleKey.
    sfx?.play("system03");
    sh.feedbackMsg = msg;
    sh._animStart("msg");
  };

  sh.update = (dt) => {
    if (!sh._open) return;
    sh.time += dt;
    if (sh.fadeLeaving) {
      const t = sh.time - sh.fadeT0 - LEAVE_FOLD_FRAMES * VSYNC_S;
      const frames = Math.max(0, Math.floor(t / VSYNC_S));
      if (frames * LEAVE_FADE_DELTA >= LEAVE_FADE_MAX) sh.close();
    }
  };

  // The info band's "Equip"/"Items" columns: the stored worn byte at
  // `base + 0x20F + id` and the carried byte at `base + 0x7C + id` (stitshop
  // 0x80089ECC, file 0x721C).
  sh._counts = (state, id) => ({ equip: wornCount(state, id), bag: heldCount(state, id) });

  sh.draw = (ctx, viewW, viewH, state) => {
    if (!sh._open) return;

    // Native 320-wide PS1 space scaled up, so decoded coordinates apply verbatim.
    const s = viewW / NATIVE_W;
    ctx.fillStyle = "rgb(0,0,24)";
    ctx.fillRect(0, 0, viewW, viewH);
    drawPackBackdrop(ctx, stshop, 20, viewW, viewH, sh.time);

    ctx.save();
    ctx.scale(s, s);
    const text = (str, x, y, gold = false) => drawText(ctx, String(str), x, y, { kind: gold ? 3 : 1 });
    // The list cursor slides right-and-back 1px @ ~6 vsync/step (PS1-style;
    // rig stills caught it mid-slide).
    // Cursor slide from the shared class (engine/dw3/ui/cursor.ts): the same
    // [0,1,2,1] ping-pong, now at the decoded 6 vsyncs per step rather than a
    // local 8-per-second constant. At PAL 50Hz those differ by 4%.
    const cursorAt = (x, y) => text(CURSOR, x + ui.cursorOffsetAtTime(sh.time), y, true);
    // Decoded window fold: sp9C x/y scale ramp 0..0x1000 around the spA4
    // pivot; returns progress so labels can wait for window-ready (p>=1).
    // The ramp and the pivot transform now come from the shared fold class
    // (engine/dw3/ui/fold-tween.ts) instead of a copy local to this screen.
    // While leaving, every open window folds SHUT (progress 1 -> 0 over the
    // first 5 frames — the decoded double-speed close) before the dim runs.
    const leaving = sh.fadeLeaving && sh.leaveFoldT0 != null;
    const fold = (key, px, py, axis, fn) => {
      const start = leaving
        ? sh.time - (1 - leaveFoldP()) * ANIM_T
        : (sh._anim[key] ?? null);
      const tr = ui.foldTransformAtTime(sh.time, start, px, py, axis, ANIM_T);
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

    // ── persistent chrome: header + BIT balance (every screen) ──
    if (fold("rootName", 0x57, 0x19, "x", () => drawClip(ctx, stshop, 1, 0x16, 0x12)) >= 1) {
      text(sh.name || "SHOP", 0x1D, 0x14);
    }
    if (fold("rootBit", 0x140, 0x18, "x", () => drawClip(ctx, stshop, 2, 0xD6, 0x0F)) >= 1) {
      const bitStr = formatBits(state.bits ?? 0);
      text(bitStr, 0x117 - textWidth(bitStr, 3), 0x17, true);
      text("BIT", 0x11A, 0x17, true);
    }

    // Message plate (clip 21 @ (123,132)). It must paint on every screen —
    // the early-return branches below call it too, or a "Don't have {X}."
    // rejection over the category menu sits in state but never reaches
    // the canvas.
    const paintMsg = () => {
      if (!sh.feedbackMsg) return;
      // message plate (clip 21 @ (123,132) — decoded F0x80085b18/83970)
      if (fold("msg", 0x140, 0x8F, "x", () => drawClip(ctx, stshop, 21, 0x7B, 0x84)) >= 1) {
        text(sh.feedbackMsg, 0x88, 0x8A);
      }
    };

    if (sh.screen === "sellcat") {
      // SELL 4-category window: clip 4 @ (169,38) — same slot as the root
      // clip 5. Rows x=0xBE, y=0x2F+0x0E·i; cursor x=0xB0.
      if (fold("sellcat", 0x140, 0x3B, "x", () => drawClip(ctx, stshop, 4, 0xA9, 0x26)) >= 1) {
        SELL_CATS.forEach((label, i) => {
          const ry = 0x2F + i * ROW_H;
          if (i === sh.catIdx) cursorAt(0xB0, ry);
          text(label, 0xBE, ry);
        });
      }
      if (fold("rootFooter", 0x140, 0xD2, "x", () => drawClip(ctx, stshop, 0, 0xC6, 0xC4)) >= 1) {
        text(STR_BACK, 0xD3, 0xCC);
      }
      paintMsg();
      paintLeaveFade(ctx);
      ctx.restore();
      return;
    }

    if (sh.screen === "root") {
      // clip 5 @ (169,38); rows (190,47)/(190,61); cursor x=176; footer plate.
      if (fold("rootMenu", 0x140, 0x3B, "x", () => drawClip(ctx, stshop, 5, 0xA9, 0x26)) >= 1) {
        [STR_BUY, STR_SELL].forEach((label, i) => {
          const ry = 0x2F + i * ROW_H;
          if (i === sh.bsIdx) cursorAt(0xB0, ry);
          text(label, 0xBE, ry);
        });
      }
      if (fold("rootFooter", 0x140, 0xD2, "x", () => drawClip(ctx, stshop, 0, 0xC6, 0xC4)) >= 1) {
        text(STR_BACK, 0xD3, 0xCC);
      }
      paintMsg();
      paintLeaveFade(ctx);
      ctx.restore();
      return;
    }

    // Decoded mode shifts (band object unk58: 0=BUY, 1=SELL): the info band
    // and its labels sit 42px lower on the SELL side, the desc window 40px.
    const m42 = sh.mode * 42;
    const m40 = sh.mode * 40;

    // ── the full-width deep-blue list WINDOW (clip 6 BUY / 7 SELL @ (0,29)) ──
    // Closed while a plate state (qty/confirm/equip) is up: live frames show
    // only the backdrop behind "How many?" and Buy/No, and the overlay's
    // list-to-quantity Cross arm tears the list controller down (F0x80083eb0
    // state 3 -> unk6F4). It draws again when the player returns to the list.
    const listP = sh.screen === "list"
      ? fold("list", 0xA0, 0x47, "y",
        () => drawClip(ctx, stshop, 6 + sh.mode, 0, 0x1D))
      : 0;

    // ── list grid (drawn with the list window; the native adds the cells
    // once the window anim hits 0x1000) ──
    // Both lists have two columns; SELL has seven rows and no Effects prompt.
    const list = sh._currentList(state);
    const perPage = pageSize(sh.mode);
    const start = sh.page * perPage;
    const pages = Math.max(1, Math.ceil(list.length / perPage));
    if (listP >= 1) list.slice(start, start + perPage).forEach((slot, vi) => {
      const i = start + vi;
      const col = vi % GRID_COLS;
      const row = (vi / GRID_COLS) | 0;
      const cx = col * COL_W;
      const ly = 0x24 + row * ROW_H;
      drawClip(ctx, stshop, 49, 0x28 + cx, ly);  // cell underline (dy baked in)
      drawItemIcon(ctx, ITEM_BY_ID[slot.id]?.id ?? slot.id, 0x28 + cx, ly);
      if (i === sh.cursor && sh.screen === "list") cursorAt(0x1D + cx, ly);
      text(ITEM_BY_ID[slot.id]?.name ?? "?", 0x37 + cx, ly);
    });
    if (listP >= 1 && list.length === 0) text("Don't have {1}.", 0x37, 0x24);

    // page indicator "N / M" (labels at x 0x9B/0x9C/0xB0) + L1/R1 tabs
    if (listP >= 1) {
      const tabY = 0x5F + m42, tabTextY = 0x5C + m42, pageY = 0x60 + m40;
      const nStr = String(sh.page + 1);
      text(nStr, 0x9B - textWidth(nStr, 1), pageY);
      text("/", 0x9C, pageY);
      text(String(pages), 0xB0, pageY);
      const blink = Math.floor(sh.time * 50 / 11) % 4;
      if (sh.page > 0) {
        drawClip(ctx, stshop, `16#${blink}`, 0x1E, tabY) || drawClip(ctx, stshop, 16, 0x1E, tabY);
        text("L1", 0x2D, tabTextY);
      }
      if (start + perPage < list.length) {
        drawClip(ctx, stshop, `17#${blink}`, 0xFD, tabY) || drawClip(ctx, stshop, 17, 0xFD, tabY);
        text("R1", 0x102, tabTextY);
      }
    }

    // ── info band: clip 14 @ (15, 108+42m) — right section = price plate ──
    const bandP = fold("band", 0x140, 0x81 + m40, "x",
      () => drawClip(ctx, stshop, 14, 0x0F, 0x6C + m42));
    const selItem = ITEM_BY_ID[sh._selected(state)?.id];
    if (bandP >= 1 && selItem) {
      const { equip, bag } = sh._counts(state, selItem.id);
      drawItemIcon(ctx, selItem.id, 0x16, 0x73 + m42);
      text(selItem.name, 0x25, 0x74 + m42);
      text(STR_EQUIP, 0xA1, 0x75 + m42);
      text(String(equip), 0xE1 - textWidth(String(equip), 1), 0x75 + m42);
      text(STR_ITEMS, 0xEA, 0x75 + m42);
      text(String(bag), 0x12A - textWidth(String(bag), 1), 0x75 + m42);
      // gold "{1} BIT" inside the band's price-plate section (rig: plain
      // digits, no thousands separator — only the balance uses one)
      const pd = String(sh._unitPrice(selItem));
      text(pd, 0x117 - textWidth(pd, 3), 0x8B + m42, true);
      text("BIT", 0x11A, 0x8B + m42, true);
    }

    // ── info view: description window OR per-Digimon effect cards (BUY only) ──
    // The Equip? / Equip-who? screens force the cards up (buy states 0x1B/0x20).
    const forceCards = sh.screen === "equip" || sh.screen === "equipwho";
    const isEquip = selItem && !!EQUIPMENT_BY_ID[selItem.id];
    const showCards = forceCards || (sh.mode === 0 && isEquip && sh.infoView === "effects");
    if (sh.mode === 0 && isEquip) {
      // prompt plate = clip 9 @ (0,129) (cards fn F0x8008a450); msg at (19,135)
      if (fold("prompt", 0x52, 0x8C, "x", () => drawClip(ctx, stshop, 9, 0, 0x81)) >= 1) {
        text(showCards ? STR_DETAILS : STR_FX, 0x13, 0x87);
      }
    }
    if (!showCards) {
      if (fold("desc", 0xA0, 0xAE + m40, "y", () => drawClip(ctx, stshop, 3, 0, 0x9C + m40)) >= 1) {
        if (selItem?.desc) text(selItem.desc, 0x14, 0xA1 + m40);
        const gear = selItem && EQUIPMENT_BY_ID[selItem.id];
        if (gear?.family >= 2 && gear.family < 14) {
          const classLine = WEAPON_CLASS_LINES[gear.statBytes?.[2]];
          if (classLine) text(classLine, 0x14, 0xAF + m40);
        }
      }
    } else {
      // effect cards — clip 8 @ (11+99i, 156), rig-verified content layout
      const roster = partyRosterView(
        state.party, state.partnerStats, state.partyStats, digimonDB ?? {}, state.digimonNames,
      ).slice(0, 3);
      roster.forEach((member, i) => {
        const x0 = 0x0B + 0x63 * i;
        // per-card y-fold, pivot (60+99i, 192) — decoded F0x8008a450
        if (fold("cards", 0x3C + 0x63 * i, 0xC0, "y",
          () => drawClip(ctx, stshop, 8, x0, 0x9C)) < 1) return;
        const frameK = Math.floor(sh.time * 50 / 9) % 8;
        drawClip(ctx, stshop, `15#${frameK}`, 16 + 99 * i, 0x9C)
          || drawClip(ctx, stshop, 15, 16 + 99 * i, 0x9C);
        text(member.name, x0 + 12, 0x9E);
        ctx.fillStyle = "rgb(160,160,224)";
        ctx.fillRect(x0 + 10, 0xAB, 80, 1);
        const prof = member.profile ?? {};
        const base = {};
        for (const k of ["str", "def", "spt", "wis", "spd", "chr"]) {
          base[k] = member.stats?.[k] ?? prof[k] ?? 0;
        }
        const preview = computeEquipPreview(base, state.equipment?.[i] ?? {}, selItem.id);
        // X (clip 22) also when the member's starter line may not wear this gear
        // (claim EQUIP-C015-shop-gear-access-bitmask), even though a slot preview exists.
        if (!preview || !preview.slot
          || !gearAccessibleForLine(
            selItem.id, rosterSlotOfCharId(member.charId ?? state.party?.[i]) ?? -1)) {
          drawClip(ctx, stshop, 22, 25 + 99 * i, 0xAD);
          return;
        }
        (preview?.rows ?? []).slice(0, 4).forEach((r, ri) => {
          // The four rows are NOT one shape. F0x80089a44 builds rows 0 and 1
          // with an arrow between a before at 57 and an after at 90, and rows
          // 2 and 3 with no arrow and an after at 99. All + 99 per member.
          const row = CARD_STAT_ROWS[ri];
          const y = row.y;
          const bx = row.beforeX + 0x63 * i;
          const ax = row.afterX + 0x63 * i;
          drawIconGlyph(ctx, iconNameFor(r.stat), x0 + 10, y);
          if (r.after < r.before) {
            // decrease: just the after-value in red, no arrow (rig-verified)
            drawText(ctx, String(r.after), bx - textWidth(String(r.after), 1), y, { kind: 1, color: COL_DOWN });
            return;
          }
          text(String(r.before), bx - textWidth(String(r.before), 1), y);
          if (row.arrowX != null) text("[arrow-right]", row.arrowX + 0x63 * i, y);
          const after = String(r.after);
          if (r.after > r.before) drawText(ctx, after, ax - textWidth(after, 1), y, { kind: 1, color: COL_UP });
          else text(after, ax - textWidth(after, 1), y);
        });
      });
    }

    if (sh.screen === "equip") {
      // Equip? Yes/No window: clip 12 @ (175,67); rows (0xC5,0x49)/(0xC5,0x59),
      // cursor x=0xB8 (F0x8008485c family; strings 21/22/23). The title reuses
      // the total-plate slot (clip 21 @ (123,38), gold right-aligned 0x140).
      if (fold("cfmPlate", 0x140, 0x32, "x", () => drawClip(ctx, stshop, 21, 0x7B, 0x26)) >= 1) {
        text(STR_EQUIP_Q, 0x140 - textWidth(STR_EQUIP_Q, 3), 0x2D, true);
      }
      if (fold("cfm", 0x140, 0x57, "x", () => drawClip(ctx, stshop, 12, 0xAF, 0x43)) >= 1) {
        [STR_YES, STR_NO].forEach((label, i) => {
          const ry = 0x49 + i * 0x10;
          if (i === sh.equipIdx) cursorAt(0xB8, ry);
          text(label, 0xC5, ry);
        });
      }
    } else if (sh.screen === "equipwho") {
      // "Equip who?" member select: selection frame clip 15 rides the member
      // cursor (CLUT-cycled on the real screen; same blink as the cards).
      // (The title plate position is undecoded, so no title text is drawn.)
      const frameK = Math.floor(sh.time * 50 / 9) % 8;
      drawClip(ctx, stshop, `15#${frameK}`, 16 + 99 * sh.equipWhoIdx, 0x9C)
        || drawClip(ctx, stshop, 15, 16 + 99 * sh.equipWhoIdx, 0x9C);
    }

    if (sh.screen === "qty") {
      // SELL-only extras (F0x80085b18): compound qty plate clip 13 @ (160,36)
      // and 4-row window clip 4 @ (169,38).
      if (sh.mode === 1) {
        fold("qty", 0x140, 0x32, "x", () => drawClip(ctx, stshop, 13, 160, 36));
        fold("qty", 0x140, 0x3B, "x", () => drawClip(ctx, stshop, 4, 169, 38));
      }
      // "How many?" plate clip 10 @ (154,52) + spinner clip 11 @ (246,79) + ▲/▼
      if (fold("qty", 0x140, 0x42, "x", () => drawClip(ctx, stshop, 10, 0x9A, 0x34)) >= 1) {
        text(STR_HOWMANY, 0xB4, 0x38);
      }
      if (fold("qtySpin", 0x140, 0x59, "x", () => drawClip(ctx, stshop, 11, 0xF6, 0x4F)) >= 1) {
        const qs = String(sh.qty);
        text(qs, 0x11E - textWidth(qs, 1), 0x55);
        const item = ITEM_BY_ID[sh._selected(state)?.id];
        if (sh.qty < sh._maxQty(state, item)) drawClip(ctx, stshop, 18, 0x122, 0x51);
        if (sh.qty > 1) drawClip(ctx, stshop, 19, 0x122, 0x5B);
      }
    } else if (sh.screen === "confirm") {
      // total plate clip 21 @ (123,38) + Buy/No window clip 12 @ (175,67)
      const item = ITEM_BY_ID[sh._selected(state)?.id];
      if (fold("cfmPlate", 0x140, 0x32, "x", () => drawClip(ctx, stshop, 21, 0x7B, 0x26)) >= 1) {
        const totalStr = `${sh._unitPrice(item) * sh.qty} BIT`;  // "{1} BIT" (plain digits)
        text(totalStr, 0x140 - textWidth(totalStr, 3), 0x2D, true);
      }
      if (fold("cfm", 0x140, 0x57, "x", () => drawClip(ctx, stshop, 12, 0xAF, 0x43)) >= 1) {
        [sh.mode === 0 ? "Buy" : "Sell", "No"].forEach((label, i) => {  // strings 19/34/20
          const ry = 0x49 + i * 0x10;
          if (i === sh.confirmIdx) cursorAt(0xB8, ry);
          text(label, 0xC5, ry);
        });
      }
    }

    paintMsg();
    paintLeaveFade(ctx);
    ctx.restore();
  };

  return sh;
}
