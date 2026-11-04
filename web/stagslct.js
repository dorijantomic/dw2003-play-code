// web/stagslct.js — the developers' own STAGSLCT launcher screen.
//
// Decode: docs/research/ui/stagslct-full-decode-2026-08-05.md (the complete
// August 2026 decode; supersedes the July 2026 239-row reading). The table at
// RAM 0x80085eec holds 297 records of a fixed 0x10 bytes —
// {char *label_left, char *label_right, s32 type, s32 value} — terminated by a
// record whose `type` is -1. 270 records are launchable: 239 FIELDSTG screens
// plus 31 developer overlays (the screen itself, card game, battle result,
// shops, gyms, status, album, save/load, title, lab, country select, ending...).
// A launch is D0x8004b440(row.type, row.value) — `type` is the launch code the
// resident screen launcher takes, NOT a screen id, and it is NOT written to the
// master story ordinal. The other 27 records have type 0: 20 horizontal rules
// and 7 section headings, skipped by the original mover F0x80084a5c. Cursor and
// scroll survive leaving and re-entering in D0x80048d5c / D0x80048d60.
//
// The extracted asset (web/assets/data/stagslct_ui.json, built by
// tools/extract_stagslct_ui.py and git-ignored) keeps the 297 records in
// `menuRows` and the 31 developer-overlay rows in their own `categories` list.
// v2 interleaves each category row at its record index, which restores the
// developers' 328-row table: 270 entry + 31 category + 7 heading + 20 separator
// rows, in the table's own order.
//
// F10 is a walker-authored debug entry point: the retail build has no shipped
// way into this screen (the hub's own launch code 0x1500 tears a live field
// down and is never consumed; only Sound Test passes 0x1500 back here).
//
// F2 -> Extras -> "Stage select (dev)" (window.__fx.stageselect) turns on v2:
// the 14-row window from the build routine F0x80084d9c (chrome.list), the table
// in its own order, category tags/headings/rules drawn but skipped by the
// cursor, and cursor+scroll remembered in localStorage `dw.stagslct.v2`. With
// the switch off the screen draws exactly as it did before: one flat list of
// the launchable rows, the window centred on the cursor, no stored state.

import { drawText } from "./uifont.js";

let DATA = null;
if (typeof fetch !== "undefined" && typeof location !== "undefined") {
  fetch("assets/data/stagslct_ui.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { DATA = j; })
    .catch(() => {});
}

// Layout below is traced, not guessed: every number comes from the overlay's
// own build routine F0x80084d9c and is carried in stagslct_ui.json `chrome`.
// See the 2026-08-05 section of the decode doc.
const CH = (data) => (data && data.chrome) || null;
export const VISIBLE_ROWS = 14; // chrome.list.rows_visible — row count clamp at file 0x21f4
export const STAGE_SELECT_V2_STORE = "dw.stagslct.v2"; // cursor+scroll across visits (original D0x80048d5c/d60)

/** Is the v2 rendering on? (F2 -> Extras -> Stage select (dev), off by default.) */
const v2On = () => typeof window !== "undefined" && window.__fx?.stageselect === true;

// The cursor step rule of the original mover F0x80084a5c (claim
// `stagslct-movecursor-address-2026-10-11`): the step is refused at either end
// of the list — it restores the entry position rather than wrapping, so a press
// that cannot move leaves the cursor where it is. This screen's cursor indexes
// the selectable entries, so the original's skip loop reduces to a clamp here.
// The full mover is ported in engine/dw3/ui/native/stage-select.ts
// (`stageSelectMoveCursor`) and proved against the original by
// tests/lane-b/stage-select-move-cursor.test.js.
export function cursorStep(cursor, count, delta) {
  if (!(count > 0)) return 0;
  return Math.max(0, Math.min(count - 1, (cursor | 0) + (delta | 0)));
}

/**
 * The nearest entry row in `rows`, starting at `from` (inclusive) and walking in
 * `delta`'s direction. The original mover re-moves in the same direction while
 * it lands on a type-0 record, so headings and rules can never be selected; v2
 * draws the 31 category tags as their own rows too and skips those the same way.
 * Returns -1 when there is no entry left in that direction.
 */
export function nextEntryRow(rows, from = 0, delta = 1) {
  if (!Array.isArray(rows) || !rows.length) return -1;
  const step = delta < 0 ? -1 : 1;
  let i = Math.trunc(from) || 0;
  if (i < 0) i = step > 0 ? 0 : rows.length - 1;
  if (i >= rows.length) i = step > 0 ? rows.length - 1 : 0;
  for (; i >= 0 && i < rows.length; i += step) {
    if (rows[i]?.kind === "entry") return i;
  }
  return -1;
}

/**
 * The developers' 328-row table: `menuRows` in its own order with each
 * `categories` row inserted before the record it tags. Pure so the test can
 * prove the four kind counts against the shipped asset.
 */
export function v2Rows(data) {
  const records = Array.isArray(data?.menuRows) ? data.menuRows : [];
  const categories = new Map();
  for (const c of Array.isArray(data?.categories) ? data.categories : []) {
    if (c && Number.isInteger(c.index)) categories.set(c.index, c);
  }
  const out = [];
  records.forEach((row, at) => {
    const c = categories.get(row.index ?? at);
    if (c) out.push({ ...c, kind: "category" });
    out.push(row);
  });
  return out;
}

/**
 * Keep `cursor` visible in a `rows`-high window whose top is `scroll` (both in
 * entry index space, like the original's +0x50/+0x54 pair): scroll up when the
 * cursor goes above the window, down one entry at a time when it leaves the
 * bottom, so cursor 40 in a 14-row window sits on scroll 27.
 */
export function clampScroll(cursor, scroll, rows = VISIBLE_ROWS) {
  if (!(rows > 0)) return 0;
  const c = Math.max(0, Math.trunc(cursor) || 0);
  let s = Math.max(0, Math.min(Math.trunc(scroll) || 0, c));
  if (c >= s + rows) s = c - rows + 1;
  return s;
}

export function createStagslctMenu(data = null) {
  const d = { open: false, cursor: 0, scroll: 0, onPick: null };
  const src = () => (data && typeof data === "object" ? data : DATA);

  d.show = (onPick) => {
    d.open = true;
    d.onPick = onPick || null;
    const count = selectable().length;
    const saved = v2On() ? readView() : null;
    if (saved && count > 0) {
      d.cursor = Math.max(0, Math.min(count - 1, saved.cursor));
      d.scroll = clampScroll(d.cursor, saved.scroll, VISIBLE_ROWS);
    } else {
      d.cursor = 0;
      d.scroll = 0;
    }
  };
  d.hide = () => { saveView(); d.open = false; };

  // The original list is the overlay's own record table in table order, not a
  // sorted view: launcher entries first (card game, status, save/load, the
  // gyms...), then every field screen, with rule rows between sections. Only
  // `entry` rows are selectable; separators and headings are drawn but skipped
  // by the cursor, which is how the record `type` of 0 behaves natively.
  function rows() {
    const d0 = src();
    if (!d0 || !Array.isArray(d0.menuRows)) return [];
    return d0.menuRows;
  }

  // The 328-row v2 table (entries + the 31 category tags + headings + rules).
  function v2RowList() {
    const d0 = src();
    return d0 ? v2Rows(d0) : [];
  }

  function stageOf(row, from = src()) {
    if (!from || !row || row.kind !== "entry") return null;
    const hits = Array.isArray(from.destinations) ? from.destinations : [];
    const hit = hits.find((dst) => dst.type === row.type);
    return hit && hit.stage != null ? hit : null;
  }

  function selectable() {
    return rows().filter((r) => r.kind === "entry");
  }

  // cursor+scroll across visits: the original's D0x80048d5c / D0x80048d60,
  // held here in localStorage so a reload remembers the position too.
  function readView() {
    const store = storage();
    if (!store) return null;
    try {
      const j = JSON.parse(store.getItem(STAGE_SELECT_V2_STORE) || "null");
      if (!j || !Number.isFinite(j.cursor)) return null;
      return {
        cursor: Math.trunc(j.cursor),
        scroll: Number.isFinite(j.scroll) ? Math.trunc(j.scroll) : 0,
      };
    } catch { return null; }
  }
  function saveView() {
    if (!v2On()) return;
    const store = storage();
    if (!store) return;
    try {
      store.setItem(STAGE_SELECT_V2_STORE, JSON.stringify({ cursor: d.cursor, scroll: d.scroll }));
    } catch { /* private mode: the screen still works, it just forgets */ }
  }

  d.handleKey = (k) => {
    if (!d.open) return false;
    const list = selectable();
    if (!list.length) return true;
    if (k === "arrowup") {
      d.cursor = cursorStep(d.cursor, list.length, -1);
    } else if (k === "arrowdown") {
      d.cursor = cursorStep(d.cursor, list.length, 1);
    } else if (k === "pageup") {
      d.cursor = Math.max(0, d.cursor - VISIBLE_ROWS);
    } else if (k === "pagedown") {
      d.cursor = Math.min(list.length - 1, d.cursor + VISIBLE_ROWS);
    } else if (k === "enter" || k === " ") {
      const dst = stageOf(list[d.cursor]);
      if (dst) {
        saveView();
        d.open = false;
        if (d.onPick) d.onPick("s" + dst.stage, dst);
      }
      return true;
    } else if (k === "escape") {
      saveView();
      d.open = false;
      return true;
    } else {
      return true;
    }
    d.scroll = clampScroll(d.cursor, d.scroll, VISIBLE_ROWS);
    saveView();
    return true;
  };

  // ── the old rendering (unchanged; the F2 switch selects v2 instead) ──────
  function drawV1(ctx, W, H) {
    if (!d.open) return;
    ctx.save();
    // The original draws plain text over whatever is already on screen: this
    // overlay loads no screen pack at all, so there is no authentic backdrop
    // to reproduce. The dim fill is walker-added for legibility only.
    ctx.fillStyle = "rgba(8,12,24,0.92)";
    ctx.fillRect(0, 0, W, H);
    const d0 = src();
    if (!d0) {
      drawText(ctx, "loading...", 16, 32, { kind: 3 });
      ctx.restore();
      return;
    }
    const c = CH(d0);
    const title = c ? c.header.title : { x: 16, y: 32 };
    const L = c ? c.list : { y_base: 45, row_pitch: 12, col_left_x: 24, col_right_x: 152 };
    const cur = c ? c.cursor : { x: 14, y_base: 45, row_pitch: 12 };

    drawText(ctx, d0.identity.header_text_en, title.x, title.y, { kind: 1 });

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
      const dst = stageOf(row, d0);
      drawText(ctx, (dst && dst.name) || row.name_jp || "", L.col_right_x, y,
               { kind: 1 });
      if (row === active) {
        drawText(ctx, d0.identity.cursor_glyph || "＞", cur.x, y, { kind: 3 });
      }
    }
    drawText(ctx, "↑↓ select  Enter warp  Esc close",
             c ? c.footer.slots_x[0] : 16, c ? c.footer.y : H - 20, { kind: 3 });
    ctx.restore();
  }

  // ── v2: the developers' 328-row table as the August decode reads it ──────
  function drawV2(ctx, W, H) {
    if (!d.open) return;
    ctx.save();
    ctx.fillStyle = "rgba(8,12,24,0.92)";
    ctx.fillRect(0, 0, W, H);
    const d0 = src();
    if (!d0) {
      drawText(ctx, "loading...", 16, 32, { kind: 3 });
      ctx.restore();
      return;
    }
    const c = CH(d0);
    const title = c ? c.header.title : { x: 16, y: 32 };
    const extra = c && c.header.extra && c.header.extra[0] ? c.header.extra[0].x : 144;
    const L = c ? c.list : { y_base: 45, row_pitch: 12, col_left_x: 24, col_right_x: 152 };
    const cur = c ? c.cursor : { x: 14, y_base: 45, row_pitch: 12 };

    drawText(ctx, d0.identity.header_text_en, title.x, title.y, { kind: 1 });
    // On a debug screen the second header slot (the language name in the
    // original) names the decode this rendering follows, so the numbers on it
    // can be traced back to the research doc.
    drawText(ctx, "August 2026 decode", extra, title.y, { kind: 3, color: "#7f9cc8" });

    const all = v2RowList();
    const picks = all.filter((r) => r.kind === "entry");
    const active = picks[d.cursor] || null;
    const activeRow = active ? all.indexOf(active) : -1;
    // A fixed 14-row window from the remembered scroll entry (no centring). The
    // remembered scroll is an entry index; start at the row that holds it, then
    // nudge only if the active row would fall outside the window.
    let top = 0;
    if (picks.length) {
      const topEntry = picks[Math.max(0, Math.min(picks.length - 1, d.scroll))];
      top = all.indexOf(topEntry);
      if (top < 0) top = 0;
    }
    const maxTop = Math.max(0, all.length - VISIBLE_ROWS);
    if (top > maxTop) top = maxTop;
    if (activeRow >= 0 && (activeRow < top || activeRow >= top + VISIBLE_ROWS)) {
      top = Math.max(0, Math.min(activeRow - VISIBLE_ROWS + 1, maxTop));
    }

    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const row = all[top + i];
      if (!row) break;
      const y = L.y_base + i * L.row_pitch;
      // Non-entry rows: the 31 category tags (their launch code), the 7 section
      // headings and the 20 horizontal rules. The cursor never lands on them.
      if (row.kind === "category") {
        drawText(ctx, String(row.type || ""), L.col_left_x, y, { kind: 3, color: "#7f9cc8" });
        drawText(ctx, row.overlay_label || "", L.col_right_x, y, { kind: 3, color: "#7f9cc8" });
        continue;
      }
      if (row.kind === "heading") {
        drawText(ctx, row.overlay_label || row.name_jp || "", L.col_left_x, y, { kind: 2, color: "#f0d48a" });
        continue;
      }
      if (row.kind === "separator") {
        drawText(ctx, row.overlay_label || "", L.col_left_x, y, { kind: 2, color: "#5c6680" });
        continue;
      }
      drawText(ctx, row.overlay_label ?? "", L.col_left_x, y, { kind: 1 });
      const dst = stageOf(row, d0);
      drawText(ctx, (dst && dst.name) || row.name_jp || "", L.col_right_x, y,
               { kind: 1 });
      if (row === active) {
        drawText(ctx, d0.identity.cursor_glyph || "＞", cur.x, y, { kind: 3 });
      }
    }
    const place = picks.length ? `   row ${d.cursor + 1}/${picks.length}` : "";
    drawText(ctx, `↑↓ select  Enter warp  Esc close${place}`,
             c ? c.footer.slots_x[0] : 16, c ? c.footer.y : H - 20, { kind: 3 });
    ctx.restore();
  }

  d.draw = (ctx, W, H) => {
    if (!d.open) return;
    if (v2On()) drawV2(ctx, W, H);
    else drawV1(ctx, W, H);
  };

  return d;
}

/** localStorage if the host has one (guarded: node tests and private mode). */
function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
