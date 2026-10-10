// web/nameentry.js — STDGNAME / STPLNMET name-entry keyboard (new-game
// character naming AND the DRI Digimon-rename desk both reuse this — see
// web/game.js `kind === "nameentry"` and bank 0x7c index 1 call sites).
//
// VERIFIED 2026-07-14 against the live rig framebuffer (save state 5,
// SLES03936.sstate5) — docs/research/ui/stdgname-decoded-2026-07-11.md,
// web/assets/data/stdgname_ui.json `grid.interactive`:
//   - Single 15-col x 7-row keyboard. All three character sets are shown at
//     ONCE as 3 column-groups (cols 0-4 uppercase, 5-9 lowercase, 10-14
//     digits/symbols + DEL/SPC/arrow/OK action keys). There are NO charset
//     pages — the old paged model was falsified by the framebuffer.
//   - Cell geometry (pixel-exact, measured on the framebuffer):
//       x = col*14 + floor(col/5)*8 + 47      (8px gap between the 3 groups)
//       y = row*18 + 90
//     Confirmed: rows y=90,108,126,144,162,180,198; uppercase cols
//     x=47,61,75,89,103; lowercase group starts at x=125.
//   - Glyph inventory = real esnamedt.toml strings (authority=4).
// ACTION KEYS DECODED 2026-08-14 — stdgname_ui.json `grid.interactive
// .action_keys`, from F0x80083994's action-region branch (stdgname.s
// L0x00000dc4-L0x00000fa0). The five keys, their origin cells, their spans and
// their exact sprite positions are now read from the overlay's own two tables
// instead of guessed. Three corrections landed with it: the keys sit on cell
// rows 4/5/6 (not 3/4/5 — the old numbers came from transcribing a capture by
// eye, and each button straddles two character rows); the arrows use the 16x17
// highlight boxes 0x2c/0x2d, not the 36x22 clips the walker had; and the cell
// cursor is clip 0x27, not 0x28. Clip 0x28 is the NAME insertion cursor
// (F0x8008438c).
// NAMEDT CHROME 2026-08-19 — stplnmet F0x8008438c (exe-decomp/stplnmet_c/
// F0x8008438c.c) draws the title bar, partner portrait, name-letter boxes
// and insertion cursor from the same NAMEDTCS pack as the keyboard. Every
// clip+xy below is a constructor immediate from that function (or the
// matching stdgname label/hint-icon table). Wizard step tabs 1-2-3 are
// NOT this widget: they are F0x80087b14 text labels in stplnmet.
// STDGNM clip 36 (0x24) is the MAGAMI diamond wall F0x80086368 scrolls
// (x==y, 0..0x5F). Keyboard cells stay NAMEDT clip 37. Letters are kind-1
// CMFONT with CLUT offset 1 (cyan; F0x800197a4 adds widget +0xC0 to clut_y).
// Title is kind 1 + unk138(4) = green. Glyphs are not a separate atlas.
// Name-insertion-cursor edge behaviour (what the arrows do at the ends) is
// still not traced.
import { drawText, textWidth } from "./uifont.js";
import { loadPack, drawClip, packReady, drawPackBackdrop } from "./screenpack.js";

// Real NAMEDTCS chrome art (web/assets/ui/namedt_sheet.*). See
// tools/extract_screen_packs.py. Title bar / portrait / name boxes /
// insertion cursor are F0x8008438c immediates (handle 0x07700000).
const ART = loadPack("namedt");
const WALL = loadPack("stdgnm");
export const BACKDROP_CLIP = 36;
const CLIP = {
  GRID: 37,
  CURSOR: 0x27,
  TITLE_BAR: 0x1D,          // clip 29, 272x24 header plate
  PORTRAIT_FRAME: 0x1E,     // clip 30, 40x38 rounded box
  PORTRAIT_SHIMMER: 0x1F,   // clip 31, 36x36 additive hatch
  PORTRAIT_FALLBACK: 0x36,  // clip 54, used when unk64 == -1
  NAME_BOXES: 0x37,         // clip 55, 8 English letter boxes
  NAME_BOXES_JP: 0x34,      // clip 52, 5 Japanese letter boxes
  NAME_BOXES_TEN: 0x35,     // clip 53, 10 letter boxes (the folder name)
  NAME_CURSOR: 0x28,        // clip 40, 16x18 insertion highlight
};

// Decoded action column. `clip` is the `eng` variant — the overlay builds it as
// clip_base + [0x8005cca8], and language index 2 is the eng pack the walker
// ships. `x`/`y` are the sprite's own top-left, which do NOT follow the
// character grid's 18px row pitch. Used verbatim when stdgname_ui.json is
// loaded, and as the fallback for the node tests, which have no fetch.
const ACTION_KEYS = [
  { role: "delete", act: "DEL", label: "DEL", row: 4, col: 10, colSpan: [10, 14], x: 203, y: 153, clip: 0x3e, w: 72, h: 17 },
  { role: "space", act: "SPC", label: "SPC", row: 5, col: 10, colSpan: [10, 14], x: 203, y: 174, clip: 0x46, w: 72, h: 17 },
  { role: "cursor_left", act: "LEFT", label: "<", row: 6, col: 10, colSpan: [10, 10], x: 203, y: 195, clip: 0x2c, w: 16, h: 17 },
  { role: "cursor_right", act: "RIGHT", label: ">", row: 6, col: 11, colSpan: [11, 12], x: 222, y: 195, clip: 0x2d, w: 16, h: 17 },
  { role: "confirm", act: "OK", label: "OK", row: 6, col: 13, colSpan: [13, 14], x: 246, y: 195, clip: 0x4e, w: 40, h: 17 },
];
// role -> the command the walker runs when the key is pressed.
const ROLE_ACT = {
  delete: "DEL", space: "SPC", cursor_left: "LEFT",
  cursor_right: "RIGHT", confirm: "OK",
};
const ROLE_LABEL = { delete: "DEL", space: "SPC", cursor_left: "<", cursor_right: ">", confirm: "OK" };
// The arrow keys' glyph is a string, not part of their sprite: esnamedt 13/14.
const ARROW_GLYPH = { cursor_left: "hint_arrow_left", cursor_right: "hint_arrow_right" };
const DEFAULT_ARROW = { cursor_left: "[arrow-left]", cursor_right: "[arrow-right]" };

// The decoded table once the JSON lands, else the literals above.
function actionKeys() {
  const decoded = UI?.grid?.interactive?.action_keys?.keys;
  if (!Array.isArray(decoded) || decoded.length === 0) return ACTION_KEYS;
  return decoded.map((k) => ({
    role: k.role,
    act: ROLE_ACT[k.role] ?? k.role,
    label: ROLE_LABEL[k.role] ?? k.label_eng,
    row: k.row, col: k.col, colSpan: k.col_span,
    x: k.x, y: k.y, clip: k.clip_english ?? k.clip,
    w: k.w, h: k.h,
  }));
}
// #37 grid origin, calibrated so the clip's OWN cell lines (left group verticals
// at clip-x 18/32/46/60/74; row lines at clip-y 6/24/42/60/78/96/114) land on
// the verified game cell borders (cols x=47,61,75,89,103; rows y=90,108,...).
// GRID_X + 18 = 47  ->  GRID_X = 29 ;  GRID_Y + 6 = 90  ->  GRID_Y = 84.
// F0x8008438c draws the same clip at (0x1D, 0x54).
const GRID_X = 29, GRID_Y = 84;

// Upper chrome. All numbers are F0x8008438c immediates (also the stdgname
// title/subtitle/hint_icon_0 anchors, which match). The name-field widget
// is told pitch 0x13 via unk140 (F0x80083e70 / F0x80083478).
export const TITLE_BAR = { clip: CLIP.TITLE_BAR, x: 0x18, y: 0x15 };
export const PORTRAIT_FRAME = { clip: CLIP.PORTRAIT_FRAME, x: 0x20, y: 0x2E, w: 40, h: 38 };
export const PORTRAIT_ANIM = { x: 0x22, y: 0x30 };
export const NAME_BOXES = {
  clip: CLIP.NAME_BOXES, x: 0x4B, y: 0x40, pitch: 0x13, w: 20, h: 20, count: 8,
};
export function nameCursorX(pos) { return NAME_BOXES.x + pos * NAME_BOXES.pitch; }

let UI = null;
if (typeof fetch === "function") {
  fetch("assets/data/stdgname_ui.json")
    .then((r) => r.json())
    .then((j) => { UI = j; })
    .catch(() => {});
}

const NATIVE_W = 320, NATIVE_H = 240;
const COLS = 15, ROWS = 7;

// Character inventory from the decoded esnamedt strings (fall back to the
// verified literals if the JSON hasn't loaded). Each group fills its 5-wide
// column block left-to-right, top-to-bottom.
const FALLBACK = {
  upper: ["ABCDE", "FGHIJ", "KLMNO", "PQRST", "UVWXY", "Z"],
  lower: ["abcde", "fghij", "klmno", "pqrst", "uvwxy", "z"],
  symbol: ["01234", "56789", "-~・?!"],
};

// Verified cell geometry (native 320x240 pixel space).
export function cellX(col) { return col * 14 + Math.floor(col / 5) * 8 + 47; }
export function cellY(row) { return row * 18 + 90; }

function buildGrid() {
  const src = UI?.grid?.pages ?? FALLBACK;
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const fill = (rows, col0) => {
    const chars = [...(rows ?? []).join("")];
    chars.forEach((ch, i) => {
      const r = Math.floor(i / 5), c = col0 + (i % 5);
      if (r < ROWS && c < COLS) g[r][c] = { ch };
    });
  };
  fill(src.upper, 0);
  fill(src.lower, 5);
  fill(src.symbol, 10);
  // Action column. The overlay dispatches each key from its ORIGIN cell — a
  // key wider than one column resolves leftward onto that cell — so the origin
  // carries the entry and the spanned columns stay null, which is also what
  // makes cursor nav land on the origin. Row 3 of cols 10-14 is the decoded
  // spacer and stays empty.
  for (const k of actionKeys()) {
    if (k.row >= ROWS || k.col >= COLS) continue;
    g[k.row][k.col] = {
      act: k.act, label: k.label, role: k.role,
      span: (k.colSpan?.[1] ?? k.col) - k.col + 1,
      x: k.x, y: k.y, clip: k.clip, w: k.w, h: k.h,
    };
  }
  return g;
}

const LANGUAGE_JPN = 0;
const BLANK = "";

// The closing fade. SCREEN-OBJECT-NAME-AUDIT-001: this screen builds a fade
// object and starts it with direction 0 over 30 frames, both when a name is
// confirmed and when the partner list is cancelled. The screen holds until the
// fade lands, so the caller must not act on the name before then.
export const CLOSE_FADE_FRAMES = 0x1E;
/** 0 before the fade starts, 1 when the screen is fully black. */
export function closeFadeLevel(frame) {
  if (frame < 0) return 0;
  return Math.min(1, frame / CLOSE_FADE_FRAMES);
}

export function createNameEntry({
  maxLen,
  initial = "",
  portraitClip = CLIP.PORTRAIT_FALLBACK,
  language = 2,
  // The partner naming screen goes dark as it hands the name over. The folder
  // editor's keyboard is a panel inside another screen and folds instead, so
  // callers opt in.
  closingFade = false,
} = {}) {
  const grid = buildGrid();
  let row = 0, col = 0, done = false;
  let closeFrame = -1;   // -1 until the closing fade starts
  // Language 0 is five slots and the Japanese letter-box clip; every other
  // language is eight (overlays/stdgname.md). A caller-supplied maxLen wins.
  const limit = maxLen ?? (language === LANGUAGE_JPN ? 5 : 8);
  const slots = Array.from({ length: limit }, () => BLANK);
  [...initial].slice(0, limit).forEach((ch, i) => { slots[i] = ch; });
  let pos = Math.min([...initial].length, Math.max(0, limit - 1));
  if (initial.length === 0) pos = 0;

  const cellAt = (r, c) => grid[r]?.[c] ?? null;
  const stepTo = (r, c, dr, dc) => {
    // walk in (dr,dc) until a non-null cell (bounded to grid size).
    for (let i = 0; i < ROWS * COLS; i++) {
      r = (r + dr + ROWS) % ROWS;
      c = (c + dc + COLS) % COLS;
      if (cellAt(r, c)) return [r, c];
    }
    return [row, col];
  };

  const ne = {
    cols: () => COLS,
    rows: () => ROWS,
    cursor: () => ({ row, col }),
    grid: () => grid,
    value() {
      // Export strips 0x4081 pads (empty slots) and keeps typed spaces.
      return slots.filter((ch) => ch !== BLANK).join("");
    },
    slots: () => slots.slice(),
    namePos: () => pos,
    maxLen: () => limit,
    language: () => language,
    portraitClip: () => portraitClip,
    // The name is only handed over once the screen has finished going dark.
    isDone: () => done && (!closingFade || closeFrame >= CLOSE_FADE_FRAMES),
    /** True from the moment the fade starts until it lands. */
    isClosing: () => closeFrame >= 0 && closeFrame < CLOSE_FADE_FRAMES,
    /** 0 while the screen is up, 1 when it is fully black. */
    fadeLevel: () => closeFadeLevel(closeFrame),
    /** Advance the closing fade by whole frames. No effect before it starts. */
    advance(frames = 1) {
      if (closeFrame < 0) return;
      closeFrame = Math.min(CLOSE_FADE_FRAMES, closeFrame + Math.max(0, frames));
    },
    /** Cancelling the partner list fades the screen out the same way. */
    startClosingFade() { if (closingFade && closeFrame < 0) closeFrame = 0; },
    currentCell: () => cellAt(row, col),
    currentChar() { return cellAt(row, col)?.ch ?? null; },
    moveUp() { [row, col] = stepTo(row, col, -1, 0); },
    moveDown() { [row, col] = stepTo(row, col, 1, 0); },
    moveLeft() { [row, col] = stepTo(row, col, 0, -1); },
    moveRight() { [row, col] = stepTo(row, col, 0, 1); },
    // Test/nav helper: jump the cursor onto a named action cell.
    gotoAction(act) {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (grid[r][c]?.act === act) { row = r; col = c; return true; }
      return false;
    },
    insert(ch) {
      if (done) return;
      slots[pos] = ch;
      const last = limit - 1;
      if (pos >= last) {
        pos = last;
        ne.gotoAction("OK");
        return;
      }
      pos += 1;
    },
    selectDel() {
      // F0x80084318 case 0x46: if the current slot is the blank pad, step
      // left first; then write a blank at the (possibly new) insert point.
      if (pos <= lastSlot() && slots[pos] === BLANK) {
        pos = Math.max(0, pos - 1);
      }
      slots[pos] = BLANK;
    },
    selectEnd() {
      if (slots.some((ch) => ch !== BLANK)) { done = true; if (closingFade && closeFrame < 0) closeFrame = 0; }
    },
    // press acts on the current cell: a character overwrites the insert
    // slot; an action key runs its command (DEL/SPC/LEFT/RIGHT/OK).
    press() {
      if (done) return;
      const cell = cellAt(row, col);
      if (!cell) return;
      if (cell.ch != null) { ne.insert(cell.ch); return; }
      switch (cell.act) {
        case "DEL": ne.selectDel(); break;
        case "SPC": ne.insert(" "); break;
        case "LEFT": pos = Math.max(0, pos - 1); break;
        case "RIGHT": pos = Math.min(limit - 1, pos + 1); break;
        case "OK": ne.selectEnd(); break;
      }
    },
  };
  function lastSlot() { return limit - 1; }
  return ne;
}

// Canvas renderer — native 320x240 scaled to viewW/viewH, so the verified
// cell coords and decoded label anchors apply verbatim.
// The keyboard's own message bar: NAMEDT clip 38 at (0,100), the plate the
// original folds up behind "That name is not allowed." (F0x80086e04 tail, and
// the folder editor's own clip 54 at the same place). The walker drew an
// invented 224x60 box here until 2026-09-03.
export function messageBar() {
  return UI?.chrome?.namedt_overlay?.message_bar ?? { clip: 38, x: 0, y: 100 };
}

export function drawNameEntryMessage(ctx, message) {
  const bar = messageBar();
  if (packReady(ART)) drawClip(ctx, ART, bar.clip, bar.x, bar.y);
  const lines = String(message).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const str = lines[i];
    drawText(ctx, str, (NATIVE_W - textWidth(str)) / 2, bar.y + 8 + i * 14);
  }
}

export function drawNameEntry(ctx, ne, viewW, viewH) {
  const s = viewW / NATIVE_W;
  const labels = Object.fromEntries((UI?.chrome?.labels ?? []).map((l) => [l.role, l]));
  const L = (role, fx, fy) => labels[role] ?? { x: fx, y: fy };

  // F0x80086368: STDGNM clip 36 at (counter, counter). Cover the field so the
  // MAGAMI wall owns the screen the way the overlay does.
  if (!drawPackBackdrop(ctx, WALL, BACKDROP_CLIP, viewW, viewH)) {
    ctx.fillStyle = "rgba(0,0,32,0.9)";
    ctx.fillRect(0, 0, viewW, viewH);
  }

  ctx.save();
  ctx.scale(s, s);
  // Title constructor is F0x80083478 kind 1 then unk138(4) → CLUT y+4 (green).
  // Keyboard letters and the typed name match kind-1 CLUT offset 1 (cyan
  // 56,184,248) on the registered keyboard.png capture.
  const TITLE = { kind: 1, clut: 4 };
  const LETTER = { kind: 1, clut: 1 };
  const text = (str, x, y, face = LETTER) =>
    drawText(ctx, String(str), x, y, face);

  // Keyboard grid — VERIFIED geometry. Prefer the real NAMEDTCS cell-grid +
  // button sprites; fall back to vector boxes (and for node tests, where no
  // Image/canvas art loads).
  const grid = ne.grid(), cur = ne.cursor();
  const art = packReady(ART);
  const titleBar = UI?.chrome?.namedt_overlay?.title_bar ?? TITLE_BAR;
  const NO = UI?.chrome?.namedt_overlay;
  const jpnBoxes = ne.language?.() === LANGUAGE_JPN;
  // Three plates, and the caller's field length picks between them, not the
  // language alone: F0x80086e04 draws clip 0x35 when the screen's mode word is
  // 2 (the ten-character folder name), clip 0x34 for Japanese and clip 0x37
  // otherwise.
  const wantTen = (ne.maxLen?.() ?? 8) === (NO?.name_boxes_ten?.count ?? 10);
  const nameBox = wantTen
    ? (NO?.name_boxes_ten ?? { ...NAME_BOXES, clip: CLIP.NAME_BOXES_TEN, count: 10 })
    : jpnBoxes
      ? { ...NAME_BOXES, clip: CLIP.NAME_BOXES_JP, count: 5 }
      : (NO?.name_boxes_english ?? NAME_BOXES);
  const portraitFrame = UI?.chrome?.namedt_overlay?.portrait_frame ?? PORTRAIT_FRAME;
  const nm = ne.slots?.() ?? [...ne.value()];
  const posIdx = ne.namePos();
  const namePitch = nameBox.pitch ?? NAME_BOXES.pitch;
  const nameX = nameBox.x, nameY = nameBox.y;
  const boxCount = nameBox.count ?? NAME_BOXES.count;

  // Title bar clip 0x1D at (0x18, 0x15) — F0x8008438c, same xy as
  // stdgname hint_icons[0]. Then the "Enter Name" label on top of it.
  if (art) drawClip(ctx, ART, titleBar.clip ?? CLIP.TITLE_BAR, titleBar.x, titleBar.y);
  else {
    ctx.strokeStyle = "rgba(80,180,255,0.7)";
    ctx.lineWidth = 1;
    ctx.strokeRect(titleBar.x, titleBar.y, 272, 24);
  }
  const title = L("title", 0x20, 0x1A);
  text(UI?.strings?.title ?? "Enter Name", title.x, title.y, TITLE);

  // Partner portrait. Frame clip 0x1E at (0x20, 0x2E), figure either the
  // unk64==-1 fallback clip 0x36 at the same origin or a caller-supplied
  // species clip. Extracted clip 0x1E fills its interior (index-0 dark), so
  // the figure is drawn on top of the frame rather than under it.
  const pClip = ne.portraitClip?.() ?? CLIP.PORTRAIT_FALLBACK;
  if (art) {
    drawClip(ctx, ART, portraitFrame.clip ?? CLIP.PORTRAIT_FRAME,
      portraitFrame.x, portraitFrame.y);
    drawClip(ctx, ART, pClip, portraitFrame.x, portraitFrame.y);
    drawClip(ctx, ART, CLIP.PORTRAIT_SHIMMER, portraitFrame.x, portraitFrame.y);
  } else {
    ctx.strokeStyle = "rgba(80,180,255,0.7)";
    ctx.strokeRect(portraitFrame.x, portraitFrame.y,
      portraitFrame.w ?? 40, portraitFrame.h ?? 38);
  }

  // Name-letter boxes clip 0x37 at the subtitle anchor (0x4B, 0x40), pitch
  // 0x13. Letters are the name-field widget at that same origin.
  if (art) drawClip(ctx, ART, nameBox.clip ?? CLIP.NAME_BOXES, nameX, nameY);
  else {
    ctx.strokeStyle = "rgba(80,180,255,0.7)";
    for (let i = 0; i < boxCount; i++) {
      ctx.strokeRect(nameX + i * namePitch, nameY, NAME_BOXES.w, NAME_BOXES.h);
    }
  }
  for (let i = 0; i < nm.length; i++) text(nm[i], nameX + i * namePitch, nameY);
  const cursorX = nameX + posIdx * namePitch;
  if (art) drawClip(ctx, ART, CLIP.NAME_CURSOR, cursorX, nameY);
  else {
    ctx.fillStyle = "rgba(255,224,64,0.35)";
    ctx.fillRect(cursorX, nameY, NAME_BOXES.w, NAME_BOXES.h);
  }
  // Cell box for (r,c): left/top border = cellX(c),cellY(r); 14 wide x 18 tall.
  const cellCX = (c) => cellX(c) + 7;   // horizontal centre of a cell
  const cellMidY = (r) => cellY(r) + 9; // vertical centre of a cell
  if (art) {
    const gf = NO?.grid_frame;
    drawClip(ctx, ART, gf?.clip ?? CLIP.GRID, gf?.x ?? GRID_X, gf?.y ?? GRID_Y);
    // Action column — decoded sprite and position per key. These are not part
    // of clip #37 and do not sit on the character grid's row pitch.
    for (const k of actionKeys()) {
      drawClip(ctx, ART, k.clip, k.x, k.y);
      // DEL/SPC/OK carry their label inside the sprite, one clip per language.
      // The two arrows do not — 0x2c and 0x2d are the same blank 16x17 frame,
      // which is why neither is language-patched. Their glyph is the esnamedt
      // string the overlay owns for it.
      const glyph = ARROW_GLYPH[k.role];
      if (!glyph) continue;
      const str = UI?.strings?.[glyph] ?? DEFAULT_ARROW[k.role];
      const w = textWidth(str);
      text(str, k.x + ((k.w ?? 16) - w) / 2, k.y + 5);
    }
  }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (!cell) continue;
      const isCur = r === cur.row && c === cur.col;
      if (!art) {
        ctx.strokeStyle = "rgba(80,180,255,0.7)";
        ctx.lineWidth = 1;
        // An action key knows its own decoded rect; a character cell is the
        // 14x18 grid box.
        if (cell.act) ctx.strokeRect(cell.x, cell.y, cell.w ?? 16, cell.h ?? 17);
        else ctx.strokeRect(cellX(c) - 1, cellY(r) - 1, 15, 17);
      }
      if (isCur) {
        // A character cell takes the decoded 16x18 highlight clip 0x27 at
        // exactly (cellX, cellY). An action key is highlighted in the original
        // by redrawing its own sprite, which the walker already draws above —
        // with one CLUT row there is nothing to swap, so its selected state is
        // a translucent wash over the key's own decoded rect. Position and
        // size are decoded; the wash itself is the walker's stand-in.
        if (cell.act) {
          ctx.fillStyle = "rgba(255,224,64,0.35)";
          ctx.fillRect(cell.x, cell.y, cell.w ?? 16, cell.h ?? 17);
        } else if (art) {
          drawClip(ctx, ART, CLIP.CURSOR, cellX(c), cellY(r));
        } else {
          ctx.fillStyle = "rgba(255,224,64,0.6)";
          ctx.fillRect(cellX(c) - 1, cellY(r) - 1, 15, 17);
        }
      }
      // Character glyphs, centred in the cell. Action keys carry their label in
      // the sprite (art path); only draw a text label in the vector fallback.
      if (cell.ch != null) {
        const gx = cellCX(c) - textWidth(cell.ch) / 2;
        text(cell.ch, gx, cellMidY(r) - 4);
      } else if (!art) {
        text(cell.label, cell.x + 3, cell.y + 4);
      }
    }
  }
  ctx.restore();
  // The screen goes dark as it closes (SCREEN-OBJECT-NAME-AUDIT-001): the same
  // thirty-frame ramp the other screens use when they hand over.
  const veil = ne.fadeLevel?.() ?? 0;
  if (veil > 0) {
    ctx.save();
    ctx.globalAlpha = veil;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.restore();
  }

}
