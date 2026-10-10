// web/stagslct.js — native STAGSLCT gate/area-travel menu.
//
// Decode: docs/research/ui/stagslct-decoded-2026-07-11.md. Source overlay
// ~/ddw3/asm/dw2003/pro/stagslct.s enumerates a 239-entry destination table
// (RAM 0x80085eec) covering EVERY FIELDSTG screen id in the game (1:1 with
// data/screen_table.json, zero misses/dupes — tools/extract_stagslct_ui.py).
// Selecting a row writes the screen id into the master story ordinal
// [0x8004b370] and tail-calls the resident transition trampoline
// F0x800855d4 (stagslct.s L2620-2637) — the same primitive ordinary map
// warps use, which is why this is a "travel anywhere" gate menu and not a
// debug/data screen.
//
// OPEN GAPS (do not fill with guesses):
//  - The table also carries 31 "category" rows (type tags like 0xf00/0xa00
//    with sub-indices) that most likely group the 239 destinations into a
//    real top-level menu (region/sector picker). Which destinations belong
//    under which category was NOT recovered (m2c could not decompile this
//    overlay — every entry it split out was a spurious function carved from
//    this same data table, 256/256 failures; see exe-decomp/stagslct_c/).
//    This screen therefore renders one FLAT sorted list, not the original
//    two-level menu.
//  - No screen-pack load (`lui $a0, 0x<pack-hi>`) exists anywhere in
//    stagslct.s, and no chrome vtable draw-ctx call (F0x8001f648) was found
//    either — the real widget draws through a shared, un-transcribed
//    resident list-widget object (D0x8004b7d0 / F0x800143dc, ~9 vtable
//    slots). Exact original background/window art and per-row pixel
//    geometry are UNRESOLVED; this renders a plain panel + the real
//    decoded UI font instead of guessed chrome.
//  - The real in-game trigger for loading STAGSLCT.PRO (which flag, menu,
//    or NPC opens it) was NOT found in this session — no set_flag launcher
//    bank (F0x800165ac) targets it, and it has no data/screen_table.json
//    warp entry. It is wired here behind a walker-authored debug entry
//    point only (not a claim about the original trigger).

import { drawText } from "./uifont.js";

let DATA = null;
if (typeof fetch !== "undefined") {
  fetch("assets/data/stagslct_ui.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { DATA = j; })
    .catch(() => {});
}

// Layout below is traced, not guessed: every number comes from the overlay's
// own build routine F0x80084d9c and is carried in stagslct_ui.json `chrome`.
// See the 2026-08-05 section of the decode doc.
const CH = () => (DATA && DATA.chrome) || null;
const VISIBLE_ROWS = 14; // chrome.list.rows_visible — row count clamp at file 0x21f4

export function createStagslctMenu() {
  const d = { open: false, cursor: 0, scroll: 0, onPick: null };

  d.show = (onPick) => {
    d.open = true;
    d.cursor = 0;
    d.scroll = 0;
    d.onPick = onPick || null;
  };
  d.hide = () => { d.open = false; };

  // The original list is the overlay's own record table in table order, not a
  // sorted view: launcher entries first (card game, status, save/load, the
  // gyms...), then every field screen, with rule rows between sections. Only
  // `entry` rows are selectable; separators and headings are drawn but skipped
  // by the cursor, which is how the record `type` of 0 behaves natively.
  function rows() {
    if (!DATA || !Array.isArray(DATA.menuRows)) return [];
    return DATA.menuRows;
  }

  function stageOf(row) {
    if (!DATA || !row || row.kind !== "entry") return null;
    const hit = DATA.destinations.find((dst) => dst.type === row.type);
    return hit && hit.stage != null ? hit : null;
  }

  function selectable() {
    return rows().filter((r) => r.kind === "entry");
  }

  d.handleKey = (k) => {
    if (!d.open) return false;
    const list = selectable();
    if (!list.length) return true;
    if (k === "arrowup") {
      d.cursor = (d.cursor - 1 + list.length) % list.length;
    } else if (k === "arrowdown") {
      d.cursor = (d.cursor + 1) % list.length;
    } else if (k === "pageup") {
      d.cursor = Math.max(0, d.cursor - VISIBLE_ROWS);
    } else if (k === "pagedown") {
      d.cursor = Math.min(list.length - 1, d.cursor + VISIBLE_ROWS);
    } else if (k === "enter" || k === " ") {
      const dst = stageOf(list[d.cursor]);
      if (dst) {
        d.open = false;
        if (d.onPick) d.onPick("s" + dst.stage, dst);
      }
      return true;
    } else if (k === "escape") {
      d.open = false;
      return true;
    } else {
      return true;
    }
    if (d.cursor < d.scroll) d.scroll = d.cursor;
    if (d.cursor >= d.scroll + VISIBLE_ROWS) d.scroll = d.cursor - VISIBLE_ROWS + 1;
    return true;
  };

  d.draw = (ctx, W, H) => {
    if (!d.open) return;
    ctx.save();
    // The original draws plain text over whatever is already on screen: this
    // overlay loads no screen pack at all, so there is no authentic backdrop
    // to reproduce. The dim fill is walker-added for legibility only.
    ctx.fillStyle = "rgba(8,12,24,0.92)";
    ctx.fillRect(0, 0, W, H);
    if (!DATA) {
      drawText(ctx, "loading...", 16, 32, { kind: 3 });
      ctx.restore();
      return;
    }
    const c = CH();
    const title = c ? c.header.title : { x: 16, y: 32 };
    const L = c ? c.list : { y_base: 45, row_pitch: 12, col_left_x: 24, col_right_x: 152 };
    const cur = c ? c.cursor : { x: 14, y_base: 45, row_pitch: 12 };

    drawText(ctx, DATA.identity.header_text_en, title.x, title.y, { kind: 1 });

    const picks = selectable();
    const active = picks[d.cursor] || null;
    const all = rows();
    // Scroll by selectable index, then page from the row that holds it, so
    // separators and headings ride along with their section as they do natively.
    const anchor = active ? all.indexOf(active) : 0;
    const top = Math.max(0, Math.min(anchor - Math.floor(VISIBLE_ROWS / 2),
                                     all.length - VISIBLE_ROWS));
    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const row = all[top + i];
      if (!row) break;
      const y = L.y_base + i * L.row_pitch;
      drawText(ctx, row.overlay_label ?? "", L.col_left_x, y, { kind: 1 });
      // Right column is the row's own name. The original prints it in
      // Japanese; where we have resolved the row to a stage we print that
      // stage's English name instead, which is a deliberate translation of
      // authentic content, not invented text.
      const dst = stageOf(row);
      drawText(ctx, (dst && dst.name) || row.name_jp || "", L.col_right_x, y,
               { kind: 1 });
      if (row === active) {
        drawText(ctx, DATA.identity.cursor_glyph || "＞", cur.x, y, { kind: 3 });
      }
    }
    drawText(ctx, "↑↓ select  Enter warp  Esc close",
             c ? c.footer.slots_x[0] : 16, c ? c.footer.y : H - 20, { kind: 3 });
    ctx.restore();
  };

  return d;
}
