import { drawClip } from "../screenpack.js";
import { drawText, drawCursor, textWidth } from "../uifont.js";
import { drawItemIcon } from "../itemicons.js";
import {
  ITEM_BY_ID,
  rosterSlotOfCharId,
  EQUIPMENT_BY_ID,
  EQUIP_SLOTS as EQUIP_ROW_SLOTS,
  pauseEquipRowAdmits,
  heldCount,
} from "../vendor/engine.js";
import { weaponEffectLine } from "../weapon-lab.js";
import { MS } from "./state.js";
import {
  _drawCard,
  _drawFooter,
  _drawHeader,
  _drawHome,
  _drawHomeBit,
  _drawSidebar,
  gold,
  sheetPreviewFace,
  valueText,
  white,
} from "./draw-common.js";
import {
  EQUIP_SCROLLBAR,
  EQUIP_SLOT_KEYS,
  ITEM_CATS,
  ITEM_CAT_ACTIONS,
  ITEM_CAT_EMPTY,
  RES_ROWS,
  STAT_ROWS,
  VSYNC,
  cmfont,
  equipScrollbarThumb,
  ststat,
} from "./pure.js";
import {
  ensureEquipment,
  equipPickOptions,
  equippedCountOf,
  previewEquipment,
  sheetResValue,
  sheetStatValue,
  wieldNameFor,
} from "./logic.js";
import type { MenuState } from "./types.js";

import type { GameState } from "../game/types.js";
// ITEMS: "Which one?" category picker, then the 8x2 bag (F0x80092fac).
export function _drawItems(ctx: CanvasRenderingContext2D, state: GameState, m: MenuState, roster, t: number, fold = null) {
  const I = MS.UI.screens.items;
  if (m.itemMode === "use_target") {
    _drawHeader(ctx, "Use it on who?", fold);
    _drawSidebar(ctx, roster, m, t, m.itemTarget, null, fold);
    _drawFooter(ctx, state, t, "[triangle] Button: Back to Menu", null, fold, { hideBit: true });
    return;
  }
  if (m.itemMode === "cats" || m.itemMode == null) {
    _drawHeader(ctx, "Which one?", fold);
    _drawSidebar(ctx, roster, m, t, -1, null, fold);
    _drawHomeBit(ctx, state);
    _drawHome(ctx, { ...m, mainCursor: m.itemCat, cardFolderUnlocked: () => false }, t, fold,
      ITEM_CATS);
    // §4.1: the label beside the highlighted category is esstatus 0x1B+cat
    // ("Use Item" … "All Important Items") whatever the tab holds — the empty
    // line ("No Items." …) is esstatus 0x64+cat and appears only on the confirm
    // press (see the cats arm in handleKey). It used to stand in here.
    const line1 = ITEM_CAT_ACTIONS[m.itemCat];
    _drawFooter(ctx, state, t, line1, "[triangle] Button: Back to Menu", fold, { hideBit: true });
    return;
  }

  const clipAt = (c) => () => drawClip(ctx, ststat, c.clip, c.x, c.y);
  const winP = fold ? fold("itemsList", ...(I.list_window.pivot ?? [0xA0, 0x60]), "xy", clipAt(I.list_window)) : (clipAt(I.list_window)(), 1);
  if ((fold ? fold("itemsTitle", ...(I.title_plate.pivot ?? [0xC, 0x17]), "x", clipAt(I.title_plate)) : (clipAt(I.title_plate)(), 1)) >= 1) {
    drawText(ctx, ITEM_CATS[m.itemCat], I.title_text.x, I.title_text.y);
  }
  const list = m.itemList!(state);
  const G = I.grid;
  const perPage = G.cols * G.rows;
  const page = Math.floor((list.length ? m.itemCursor : 0) / perPage);
  const pageCount = Math.max(1, Math.ceil(list.length / perPage));
  if (fold) fold("itemsCat", ...(I.cat_plate.pivot ?? [0x140, 0x26]), "x", clipAt(I.cat_plate));
  else clipAt(I.cat_plate)();
  if (winP < 1) return;

  if (!list.length) {
    drawText(ctx, ITEM_CAT_EMPTY[m.itemCat], G.label_x, G.y_base);
  }
  const start = page * perPage;
  list.slice(start, start + perPage).forEach((slot, vi) => {
    const col = vi % G.cols, row = (vi / G.cols) | 0;
    const x = col * G.col_pitch, y = G.y_base + row * G.row_pitch;
    drawClip(ctx, ststat, G.cell_band_clip, G.icon_x + x, y);
    drawItemIcon(ctx, slot.id, G.icon_x + x, y - 1);
    if (start + vi === m.itemCursor) drawCursor(ctx, t * VSYNC, G.cursor_x + x, y, gold);
    const item = ITEM_BY_ID[slot.id];
    drawText(ctx, item?.name ?? `Item ${slot.id}`, G.label_x + x, y);
  });
  const k = Math.floor(t * VSYNC / MS.UI.timings_vsync.items_arrow_cycle) % 4;
  const suffix = k === 0 ? "" : `#${k}`;
  if (page > 0) drawClip(ctx, ststat, `${I.page_arrows[0].clip}${suffix}`, I.page_arrows[0].x, I.page_arrows[0].y);
  if (start + perPage < list.length) drawClip(ctx, ststat, `${I.page_arrows[1].clip}${suffix}`, I.page_arrows[1].x, I.page_arrows[1].y);

  // The bottom of the bag is a PAGE COUNTER ("3 / 7"), with the shoulder
  // hints beside the two page arrows: L1 only when a page is behind you, R1
  // only when one is ahead. (F0x80091e94 builds the five widgets;
  // F0x80092340 fills them and hides the two hints at the ends.)
  const PC = I.page_counter;
  valueText(ctx, page + 1, PC.current_x, PC.y);
  drawText(ctx, PC.sep, PC.sep_x, PC.y, gold);
  valueText(ctx, pageCount, PC.total_x, PC.y);
  if (page > 0) drawText(ctx, I.page_hint_l1.str, I.page_hint_l1.x, I.page_hint_l1.y, gold);
  if (start + perPage < list.length) {
    drawText(ctx, I.page_hint_r1.str, I.page_hint_r1.x, I.page_hint_r1.y, gold);
  }

  // The band under the bag. All three things on it belong to the HIGHLIGHTED
  // row: its name, how many of it the party is wearing, and how many are in
  // the bag. F0x8008f0dc fills the five widgets built by F0x8008e94c:89-93 --
  // name from bank +0x6A by item id, then esstatus 0x20 "Equip" with the
  // +0x20F count, then esstatus 0x16 "Items" with the +0x7C count, both
  // numbers right-anchored. Every coordinate is from status_ui.json.
  const DB = I.detail_band;
  const held = list[m.itemCursor];
  if (DB && held) {
    const item = ITEM_BY_ID[held.id];
    drawText(ctx, item?.name ?? `Item ${held.id}`, DB.name.x, DB.name.y);
    drawText(ctx, DB.equip_label.str, DB.equip_label.x, DB.equip_label.y);
    // The two numbers are the same white face as the labels beside them:
    // F0x8008e94c builds all five widgets with kind 1 and F0x8008f0dc never
    // sets a CLUT on them, and the rig capture has the whole line in white.
    valueText(ctx, equippedCountOf(state, held.id), DB.equip_value_x, DB.equip_label.y, white);
    drawText(ctx, DB.held_label.str, DB.held_label.x, DB.held_label.y);
    valueText(ctx, held.qty ?? 1, DB.held_value_x, DB.held_label.y, white);
  }
}

// The FULL equip screen (draw F0x80086dd4 + ctor F0x80086498 + fillers
// F0x80086680/F0x80086900/F0x800867b8/F0x80086c78, all values decoded):
// header plate + "Change which one?" (esstatus 0x3f); slots window ststat
// 0x2a @ (157,40) with 6 slot rows (icon x=178, name x=192, y=49+14i, empty
// slot = grey name from 0x8009a7ac); bag-list window 0x2b @ (119,57) with 8
// visible rows (plate 0x31 + icon x=145, name x=160, grey "X" right-aligned
// at 269, bag count right-aligned at 288, y=75+14i), blinking scroll arrows
// 0x32/0x33 at x=294 when >8 rows; current-equipment panel 0x2c @ (160,17);
// footer plate with item desc + wield-slot line. Grey = native palette+0xb0.
export const GREY = { color: "rgb(136,136,152)" };

export function _drawEquip(ctx: CanvasRenderingContext2D, state: GameState, m: MenuState, p, t: number, fold: (key: string, ...rest: (number | string | (() => void))[]) => number) {
  const E = MS.UI.screens.equip;
  const sh = MS.UI.screens.shared;
  const D = MS.UI.screens.detail;
  ensureEquipment(state);
  const equipped = state.equipment[m.detailIdx] ?? {};
  const slotKey = EQUIP_SLOT_KEYS[m.equipCursor];
  const options = m.equipFocus === "list" ? equipPickOptions(state, m.detailIdx, slotKey) : null;
  const { snapshot, preview } = previewEquipment(state, m);
  // Same rule as the sheet behind it: the four-piece set bonus is keyed by the
  // roster slot, so the equip screen's live numbers use the same one.
  const wornSlot = rosterSlotOfCharId(String(state.party?.[m.detailIdx ?? 0] ?? ""));

  if (D?.stat_window) {
    drawClip(ctx, ststat, D.stat_window.clip, D.stat_window.x, D.stat_window.y);
    if (D.stat_icons) drawClip(ctx, cmfont, D.stat_icons.clip, D.stat_icons.x, D.stat_icons.y);
    STAT_ROWS.forEach((stat, i) => {
      const y = D.stat_values.y_base + i * D.stat_values.pitch;
      const after = sheetStatValue(p, preview, stat, wornSlot!);
      const before = sheetStatValue(p, snapshot, stat, wornSlot!);
      // These are the STATUS SHEET's own widgets, still on screen: the equip
      // screen's ctor F0x80086498 builds no stat widget and its draw F0x80086dd4
      // never lays down the stat window, so it draws over a sheet that is still
      // there. Same face, same right-hand anchor, same palette pair: the preview
      // paints palette 1 rose / 5 fell (F0x8008C460), not the sheet's grey mark.
      valueText(ctx, String(after), D.stat_values.x, y, sheetPreviewFace(before, after));
    });
    RES_ROWS.forEach((res, i) => {
      const y = D.res_values.y_base + i * D.res_values.pitch;
      const after = sheetResValue(p, preview, res);
      const before = sheetResValue(p, snapshot, res);
      valueText(ctx, String(after), D.res_values.x, y, sheetPreviewFace(before, after));
    });
  }

  // header plate + prompt (prompt shows while choosing a slot)
  const H = E.header_plate;
  const headerShown =
    fold("eqHeader", ...H.pivot, "x", () => drawClip(ctx, cmfont, H.clip, H.x, H.y)) >= 1;

  // The sheet is STILL THERE. This screen's own ctor F0x80086498 builds no card,
  // no EXP plate and no TP plate, and its draw F0x80086dd4 lays none of them
  // down -- the same reason the stat window above is the sheet's, not this
  // screen's. So the partner's card, its picture, the EXP plate and the TP plate
  // stay on screen where the sheet puts them. The archived proof is the sibling
  // sub-screen: captures/original-status-2026-09-03/03-choose-digivolve.png
  // keeps the card, LV/HP/MP, the picture and the stat window while its own
  // panels are up. The operator also showed a capture of THIS screen on
  // 2026-09-04 with Kotemon's plate, LV/HP/MP, the pedestal picture, "4 EXP" and
  // "TP 0" all behind "Change which one?"; that image was pasted in conversation
  // and is NOT archived here. Claim EQUIP-SHEET-WIDGETS-001. Until 2026-09-04
  // this screen drew none of them, and a comment here asserted there was no
  // card.
  //
  // The sheet's name tab is NOT among them. That clip is a full-width band
  // (x=20..320), and this screen lays its own header plate over the same rows,
  // so drawing both would bury the prompt. The card chrome carries the rounded
  // plate the partner's name sits in, and it goes down AFTER the header plate,
  // which is why the name reads over the band in the capture.
  _drawCard(ctx, p, 0, t);
  drawClip(ctx, cmfont, D.exp_plate.clip, D.exp_plate.x, D.exp_plate.y);
  valueText(ctx, p?.xp ?? 0, D.exp_value.x, D.exp_value.y);
  drawText(ctx, D.exp_label.str, D.exp_label.x, D.exp_label.y, gold);
  drawClip(ctx, ststat, D.tp_plate.clip, D.tp_plate.x, D.tp_plate.y);
  drawText(ctx, D.tp_label.str, D.tp_label.x, D.tp_label.y, white);
  valueText(ctx, p?.tp ?? 0, D.tp_value.x, D.tp_value.y, white);

  // The prompt goes down last: the card chrome ends at x=147 and the prompt
  // starts at x=152, so the two do not meet, but the text must survive the card.
  if (headerShown && m.equipFocus === "slots") {
    drawText(ctx, E.header_text.str, E.header_text.x, E.header_text.y, GREY);
  }

  // slots window (profile +0x3c0 order: Head/Body/Right/Left/Acc/Acc);
  // native closes it while the bag list is up (F0x80087890)
  const SW = E.slots_window;
  if (m.equipFocus === "slots" &&
      fold("eqSlots", ...SW.pivot, "x", () => drawClip(ctx, ststat, SW.clip, SW.x, SW.y)) >= 1) {
    for (let i = 0; i < E.slots.n; i++) {
      const y = E.slots.y_base + i * E.slots.pitch;
      const itemId = equipped[EQUIP_SLOT_KEYS[i]];
      if (m.equipFocus === "slots" && i === m.equipCursor) drawCursor(ctx, t * VSYNC, E.slots.cursor_x, y, gold);
      if (itemId != null) {
        drawItemIcon(ctx, itemId, E.slots.icon_x, y - 1);
        drawText(ctx, ITEM_BY_ID[itemId]?.name ?? EQUIPMENT_BY_ID[itemId]?.name ?? "?", E.slots.label_x, y);
      } else {
        drawText(ctx, E.slot_names[i], E.slots.label_x, y, GREY);
      }
    }
  }

  // bag-list window (only while picking an item for the chosen slot)
  if (m.equipFocus === "list") {
    const LW = E.list_window;
    // F0x80086900 .L0x00003d14-.L0x00003d50: for every row item the original
    // calls [0x8009b5f0] (= F0x8009A344, the row admission test the walker
    // ports as pauseEquipRowAdmits) and paints the row's NAME widget with
    // palette 0 when it admits the piece, palette 7 when it refuses. The
    // take-off row (id -1) is skipped by the `blez` at :3d04, so it keeps its
    // own grey. The refusal colour had been open since 2026-07-10.
    const listRow = EQUIP_ROW_SLOTS.indexOf(slotKey!);
    const listLine = rosterSlotOfCharId(String(state.party?.[m.detailIdx ?? 0] ?? ""));
    if (fold("eqList", ...LW.pivot, "x", () => drawClip(ctx, ststat, LW.clip, LW.x, LW.y)) >= 1) {
      const L = E.list;
      drawText(ctx, E.slot_names[m.equipCursor], L.header.x, L.header.y, GREY);
      options!.slice(m.equipScroll, m.equipScroll + L.rows).forEach((opt, vi) => {
        const y = L.y_base + vi * L.pitch;
        const idx = m.equipScroll + vi;
        drawClip(ctx, ststat, L.plate_clip, L.icon_x, y);
        if (idx === m.equipListCursor) drawCursor(ctx, t * VSYNC, L.cursor_x, y, gold);
        if (opt.unequip) {
          drawText(ctx, E.unequip_label, L.label_x, y, GREY);
        } else {
          drawItemIcon(ctx, opt.id, L.icon_x, y - 1);
          const refused = !pauseEquipRowAdmits(listLine, listRow, opt.id);
          drawText(ctx, opt.name, L.label_x, y, refused ? { clut: 7 } : undefined);
          const qty = heldCount(state, opt.id);
          drawText(ctx, E.x_label, L.x_label_x - textWidth(E.x_label), y, GREY);
          valueText(ctx, qty, L.qty_x, y);
        }
      });
      // blinking scroll arrows (toggle every 9 vsyncs) when >8 rows
      if (options!.length > L.rows) {
        const on = Math.floor(t * VSYNC / E.scroll_arrows.blink_vsync) % 2 === 0;
        if (on) {
          const A = E.scroll_arrows;
          if (m.equipScroll > 0) drawClip(ctx, ststat, A.up.clip, A.up.x, A.up.y);
          if (m.equipScroll < options!.length - L.rows) drawClip(ctx, ststat, A.down.clip, A.down.x, A.down.y);
        }
      }
      const bar = equipScrollbarThumb(options!.length, m.equipListCursor, E.scrollbar ?? EQUIP_SCROLLBAR);
      if (bar) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
      }
    }
  }

  // current-equipment panel (top right, list mode only): "Equip" +
  // selected slot's current item (F0x80086c78)
  const DW = E.detail_window;
  if (m.equipFocus === "list" &&
      fold("eqDetail", ...DW.pivot, "x", () => drawClip(ctx, ststat, DW.clip, DW.x, DW.y)) >= 1) {
    drawText(ctx, E.detail.label.str, E.detail.label.x, E.detail.label.y, GREY);
    const curId = equipped[slotKey];
    if (curId != null) {
      drawItemIcon(ctx, curId, E.detail.icon_x, E.detail.value_y - 1);
      drawText(ctx, ITEM_BY_ID[curId]?.name ?? EQUIPMENT_BY_ID[curId]?.name ?? "?", E.detail.value_x, E.detail.value_y);
    } else {
      drawText(ctx, E.slot_names[m.equipCursor], E.detail.value_x, E.detail.value_y, GREY);
    }
  }

  // footer plate + desc lines (list mode only — drawn inside the list
  // window's branch in F0x80086dd4)
  if (m.equipFocus === "list" &&
      fold("eqList", ...(sh.footer.pivot ?? [0, 0xD3]), "x",
        () => drawClip(ctx, ststat, sh.footer.clip, sh.footer.x, sh.footer.y)) >= 1) {
    const sel = options![m.equipListCursor];
    const [d1, d2] = E.desc_lines;
    if (sel?.unequip) {
      drawText(ctx, E.unequip_desc, d1.x, d1.y);
    } else if (sel) {
      const item = ITEM_BY_ID[sel.id];
      if (item?.desc) drawText(ctx, item.desc, d1.x, d1.y);
      // native line 2 = 0x8009a7c4[stat-record byte +0x2 - 1], the esstatus
      // wield string. Decoded from ststatus F0x800867b8 at 0x3bb4-0x3bc8 (the
      // 8-word table at file 0x17b14 = string ids 67,77,79,65,66,68,80,68 =
      // Right/Left/Left or Right/Head/Body/Accessory/Two-handed/Accessory).
      const eq = EQUIPMENT_BY_ID[sel.id];
      const wieldName = wieldNameFor(eq, E.wield_names);
      if (wieldName) drawText(ctx, wieldName, d2.x, d2.y, GREY);
      // F2 -> Extras -> "Weapon effects" (off by default): a signature weapon's
      // decoded on-hit effect as a third footer line. The footer plate (ststat
      // clip 32) is 38 px tall from y 194; line 2 sits at 0xD5, so the 8x9 face
      // at 0xD5 + 9 = 0xDE ends at 231, still inside the plate's 232 bottom.
      // With the switch off the footer keeps the original's two lines exactly.
      if (window.__fx?.weaponlab) {
        const effectLine = weaponEffectLine(sel.id);
        if (effectLine) drawText(ctx, effectLine, d2.x, d2.y + 9, { ...GREY, kind: 2 });
      }
    }
  }
}
