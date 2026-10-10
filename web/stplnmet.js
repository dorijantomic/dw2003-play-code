// web/stplnmet.js — "Choose a Starter Pack" screen (the s785 Account Clerk
// registration wizard, step 2). Replaces the plain choice-list pack picker
// with the authentic native layout.
//
// Layout decoded in docs/research/ui/stplnmet-decoded-2026-07-11.md and
// web/assets/data/stplnmet_ui.json (chrome.pack_list_screen, F0x80086fc0);
// panel bounds + geometry cross-checked against the live rig framebuffer
// (save state 6, SLES03936.sstate6). All text is real esnameet.toml content
// (authority=4). F0x80087444 draws NAMEDTCS (0x07700000) clips on clip 7's
// pink pedestals — 32x32 animation rows from the table at 0x80089a8c, not a
// separate 3D model pass. stdglabo portraits remain the fallback when the
// NAMEDT sheet has not loaded.
//
// Chrome clips are STNMET (handle 0x028A0000), extracted from the disc as
// web/assets/ui/stnmet_sheet.* (LBA 650/651). F0x80087444 draws clip 7
// (window + A/B/C tabs + pink pedestals) and clip 8 (row plates) at (16,44),
// clip 0x32 (selected-tab cursor) at (16, sel*24+48). F0x80088070 draws the
// 1-2-3 title bar (clip 13 on this step) at (24,21).
import { drawText } from "./uifont.js";
import { PACKS } from "./packs.js";
import { loadPack, drawClip, packReady } from "./screenpack.js";
import { CHARID_TO_DIGID } from "./party.js";
import { starterPortraitClip, DIGIMON_PICTURE_TABLE } from "./portraits.js";
import { createStatusBackdrop } from "./status-backdrop.js";

// Real Digimon figures = the SAME stdglabo portrait sprites the DRI desk,
// status screen and gym draw, via the CORRECTED starter mapping in
// portraits.js (the game resolver's own order was scrambled vs our ids).
// Verified against the pack-A trio in the rig framebuffer (save state 6).
const DGLAB = loadPack("stdglabo");
const NAMEDT = loadPack("namedt");
const STNMET = loadPack("stnmet");
let UI = null;
if (typeof fetch === "function") {
  fetch("assets/data/stplnmet_ui.json").then((r) => r.json())
    .then((j) => { UI = j; }).catch(() => {});
}
function portraitClip(charId, frame) {
  return starterPortraitClip(CHARID_TO_DIGID[charId], frame);
}

// NAMEDT figure rows. Overlay table at 0x80089a8c, 0x1C bytes per roster id,
// s32 clips until -1 — the same eight rows the disc copies into every overlay, so
// the rows come from the engine's one table (see NAMEDT_FIGURE_CLIPS below).
// Pack membership at 0x80089b6c is three records of three roster ids:
// {0,6,7}/{2,3,6}/{1,5,7} (UI-STPLNMET-PACKTABLE-001). F0x80087444 indexes
// clip = table[rosterId][unk5C] and advances unk5C every 0xD vsync.
export const PACK_FIGURE_ROSTER = [
  [0, 6, 7],
  [2, 3, 6],
  [1, 5, 7],
];
// The overlay's 0x80089A8C copy of the disc's one eight-row picture table, read
// from the engine module rather than written out a fifth time here. The row is the
// ROSTER SLOT (ledger claim digimon-picture-row-is-the-roster-slot-2026-10-03),
// which is why PACK_FIGURE_ROSTER below holds roster ids and not names.
export const NAMEDT_FIGURE_CLIPS = DIGIMON_PICTURE_TABLE.map((row) => row.filter((w) => w >= 0));
const FIGURE_FRAME_VSYNC = 13;

function namedtFigureClip(packIdx, memberIdx, timeSec) {
  const roster = PACK_FIGURE_ROSTER[packIdx]?.[memberIdx];
  const row = NAMEDT_FIGURE_CLIPS[roster];
  if (!row?.length) return null;
  const frame = Math.floor(Math.max(0, timeSec) * 60 / FIGURE_FRAME_VSYNC) % row.length;
  return row[frame];
}

const NATIVE_W = 320;

// Fallbacks match chrome.pack_list_screen in stplnmet_ui.json so node tests
// (no fetch) still land on the decoded anchors.
const FALLBACK_SCREEN = {
  title: { x: 32, y: 26, kind: 1, clut: 4 },
  pack_rows: { count: 3, x: 26, y_start: 52, y_step: 24, kind: 1, clut: 1 },
  digimon_list_header: { x: 58, y: 50, kind: 1, clut: 4 },
  digimon_list_header2: { x: 58, y: 194, kind: 1, clut: 1 },
  digimon_rows: {
    count: 3, x: 114, y_step: 42, name_y_start: 67, name_kind: 2, name_clut: 5,
    desc_y_start: 79, desc_kind: 1, desc_clut: 1,
  },
  step_tabs: { count: 3, y: 18, x: [228, 256, 284] },
  sprites: {
    window: { pack: "stnmet", clip: 7, x: 16, y: 44 },
    row_plates: { pack: "stnmet", clip: 8, x: 16, y: 44 },
    pack_cursor: { pack: "stnmet", clip: 50, x: 16, y_base: 48, y_step: 24 },
    title_bar: { pack: "stnmet", clip: 13, x: 24, y: 21 },
    figures: { pack: "namedt", x: 65, y_start: 64, y_step: 42 },
  },
};

function packListScreen() {
  return UI?.chrome?.pack_list_screen ?? FALLBACK_SCREEN;
}

function esnameet() {
  return UI?.strings?.esnameet ?? {};
}

function packForName(name) {
  if (name === "stnmet") return STNMET;
  if (name === "namedt") return NAMEDT;
  return null;
}

function drawLayoutClip(ctx, spec) {
  if (!spec) return false;
  const pack = packForName(spec.pack);
  if (!packReady(pack)) return false;
  return drawClip(ctx, pack, spec.clip, spec.x, spec.y);
}

// Per-Digimon blurbs — real esnameet.toml strings (member_desc_*). The three
// in the Balanced Pack (Kotemon / Renamon / Patamon) are framebuffer-verified
// against save state 6; the rest are matched by their unmistakable content
// (Agumon = fire, Monmon = guns) — see stplnmet-decoded doc.
const DESC = {
  Kotemon: "Balanced swordsman.\nAlso learn to heal.",
  Renamon: "Gets the enemy with\nlightning and ice.",
  Patamon: "Healing specialist.\nVery likable.",
  Agumon: "Likes to spew fire.\nVery aggressive.",
  Monmon: "Has various guns.\nExpert marksman.",
  Kumamon: "Powerful martial artist\nwho's pretty fast.",
  Guilmon: "Mischievious Digimon.\nHe'll learn odd moves.",
};

// Bottom summary line per pack — real esnameet pack_desc_* strings.
const PACK_DESC = {
  A: "Weapon, magic attacks and\nhealing. Best pack for team work.",
  B: "For the fearless who think that\noffense is the best defense.",
  C: "They're all quirky and difficult.\nYou can only count on Patamon.",
};

function confirmScreen() {
  return UI?.chrome?.confirm_screen ?? {
    title: { x: 32, y: 26, kind: 1, clut: 4 },
    name: { x: 97, y: 66, kind: 1 },
    pack_name: { x: 64, y: 96, kind: 1 },
    register_question: { x: 90, y: 169, kind: 1 },
    subtitle: { x: 97, y: 66, kind: 1 },
    question: { x: 64, y: 96, kind: 1 },
    option_yes: { x: 107, y: 185, kind: 1 },
    option_no: { x: 107, y: 199, kind: 1 },
    cursor: { x: 90, y: 185, y_step: 14 },
  };
}

export function createPackSelect({ accountName = "" } = {}) {
  let sel = 0, done = false;
  // SCREEN-OBJECT-METHODS-001: pack_list_show_or_hide / confirm_reset.
  // Circle on a pack hides the list text and puts up Register account?;
  // YES closes that panel, NO brings the list text back.
  let phase = "pack"; // pack | confirm
  let confirmSel = 0; // 0 YES, 1 NO
  let packListVisible = true;
  const backdrop = createStatusBackdrop();

  function showPackList(on) {
    packListVisible = on;
  }
  function showConfirm(on) {
    phase = on ? "confirm" : "pack";
    if (on) confirmSel = 0;
  }

  return {
    sel: () => sel,
    pack: () => PACKS[sel],
    accountName: () => accountName,
    isDone: () => done,
    phase: () => phase,
    confirmSel: () => confirmSel,
    packListVisible: () => packListVisible,
    update(dt) { backdrop.update(dt); },
    time: () => backdrop.time(),
    drawBackground(ctx, viewW, viewH) { backdrop.draw(ctx, viewW, viewH); },
    moveUp() {
      if (phase === "confirm") { confirmSel = 0; return; }
      // F0x80087774: sel-1, clamp at 0. Does not wrap.
      if (sel > 0) sel -= 1;
    },
    moveDown() {
      if (phase === "confirm") { confirmSel = 1; return; }
      if (sel < PACKS.length - 1) sel += 1;
    },
    cancel() {
      // Triangle on the pack list leaves the list and puts the cursor back
      // on A (F0x80087774 unk10=0xC8, unk6C=0). Isolated pack-select has
      // no previous pane, so it only resets the row.
      if (phase === "confirm") {
        showConfirm(false);
        showPackList(true);
        return;
      }
      sel = 0;
    },
    confirm() {
      if (phase === "pack") {
        showPackList(false);
        showConfirm(true);
        return;
      }
      if (confirmSel === 0) {
        showConfirm(false);
        done = true;
        return;
      }
      showConfirm(false);
      showPackList(true);
    },
  };
}

export function drawPackSelect(ctx, ps, viewW, viewH) {
  const s = viewW / NATIVE_W;
  ps.drawBackground(ctx, viewW, viewH);
  ctx.save();
  ctx.scale(s, s);
  const text = (str, x, y, face = {}) =>
    drawText(ctx, String(str), x, y, { kind: face.kind ?? 1, clut: face.clut ?? 0 });

  const L = packListScreen();
  const STR = esnameet();
  const sprites = L.sprites ?? FALLBACK_SCREEN.sprites;
  const rows = L.pack_rows ?? FALLBACK_SCREEN.pack_rows;
  const tabs = L.step_tabs ?? FALLBACK_SCREEN.step_tabs;
  const names = L.digimon_rows ?? FALLBACK_SCREEN.digimon_rows;
  const header = L.digimon_list_header ?? FALLBACK_SCREEN.digimon_list_header;
  const header2 = L.digimon_list_header2 ?? FALLBACK_SCREEN.digimon_list_header2;
  const title = L.title ?? FALLBACK_SCREEN.title;
  const figures = sprites.figures ?? FALLBACK_SCREEN.sprites.figures;
  const cursor = sprites.pack_cursor ?? FALLBACK_SCREEN.sprites.pack_cursor;

  const chromeReady = packReady(STNMET);
  const titleBar = sprites.title_bar ?? FALLBACK_SCREEN.sprites.title_bar;
  if (chromeReady) {
    drawLayoutClip(ctx, titleBar);
    drawLayoutClip(ctx, sprites.window);
    drawLayoutClip(ctx, sprites.row_plates);
    drawClip(ctx, STNMET, cursor.clip, cursor.x,
      (cursor.y_base ?? 48) + ps.sel() * (cursor.y_step ?? 24));
  } else {
    // Vector stand-ins for STNMET clips 7/8/0x32. Left until stnmet_sheet
    // is extracted. Coordinates here are the previous framebuffer-measured
    // boxes, not clip origins.
    PACKS.forEach((p, i) => {
      const y = (rows.y_start ?? 52) + i * (rows.y_step ?? 24);
      const on = i === ps.sel();
      ctx.strokeStyle = "rgba(80,180,255,0.8)";
      ctx.strokeRect(10, y - 12, 30, 20);
      if (on) { ctx.fillStyle = "rgba(200,120,255,0.55)"; ctx.fillRect(10, y - 12, 30, 20); }
    });
    ctx.strokeStyle = "rgba(80,180,255,0.85)";
    ctx.lineWidth = 1;
    ctx.strokeRect(49, 40, 254, 174);
  }

  // Title (esnameet choose_pack_title) + step labels "1-2-3".
  // The gold box around "2" is STNMET clip 13 (title_bar), not a vector.
  // F0x80086fc0: title kind 1 unk138(4); A/B/C kind 1 unk138(1).
  // F0x80087b14: 1-2-3 are kind 3.
  const packListOn = ps.packListVisible?.() ?? true;
  if (packListOn) {
    text(STR.choose_pack_title ?? "Choose a Starter Pack", title.x, title.y, title);
  }
  const stepXs = tabs.x ?? FALLBACK_SCREEN.step_tabs.x;
  const stepLabels = [
    STR.pack_index_1 ?? "1",
    STR.pack_index_2 ?? "2",
    STR.pack_index_3 ?? "3",
  ];
  stepLabels.forEach((t, i) => {
    const x = stepXs[i];
    if (!chromeReady) {
      ctx.strokeStyle = "rgba(80,180,255,0.8)";
      ctx.strokeRect(x - 2, 6, 16, 14);
      if (i === 1) { ctx.fillStyle = "rgba(255,224,64,0.8)"; ctx.fillRect(x - 2, 6, 16, 14); }
    }
    text(t, x + 2, tabs.y ?? 18, { kind: 3, clut: i === 1 ? 0 : 1 });
  });

  // A/B/C row labels (decoded pack_rows). Hidden with the rest of the
  // list text when Register account? is up (pack_list_show_or_hide).
  if (packListOn) {
    PACKS.forEach((p, i) => {
      const y = (rows.y_start ?? 52) + i * (rows.y_step ?? 24);
      text(p.id, rows.x ?? 26, y, rows);
    });
  }

  const pack = ps.pack();
  if (packListOn) text(pack.name, header.x, header.y, header);

  // 3 Digimon rows: NAMEDT animation clips on clip 7's pink pedestals.
  // F0x80087444: sp94(NAMEDTCS, clip, 0x41, 0x40+0x2A*i), clip from 0x80089a8c.
  const t = ps.time?.() ?? 0;
  const namedtReady = packReady(NAMEDT);
  const dglabReady = packReady(DGLAB);
  pack.members.forEach((m, i) => {
    const nameY = (names.name_y_start ?? 67) + i * (names.y_step ?? 42);
    const pcx = 78, pcy = nameY + 16;
    if (!chromeReady) {
      ctx.strokeStyle = "rgba(230,120,220,0.9)";
      ctx.beginPath();
      ctx.moveTo(pcx, pcy - 8); ctx.lineTo(pcx + 22, pcy);
      ctx.lineTo(pcx, pcy + 8); ctx.lineTo(pcx - 22, pcy);
      ctx.closePath(); ctx.stroke();
    }
    const figX = figures.x ?? 65;
    const figY = (figures.y_start ?? 64) + i * (figures.y_step ?? 42);
    let drew = false;
    if (namedtReady) {
      const clip = namedtFigureClip(ps.sel(), i, t);
      if (clip != null) drew = drawClip(ctx, NAMEDT, clip, figX, figY);
    }
    if (!drew && dglabReady) {
      const clip = portraitClip(m.charId, Math.floor(t * 5));
      if (clip != null) drew = drawClip(ctx, DGLAB, clip, figX, figY);
    }
    if (!drew) {
      ctx.fillStyle = "rgba(120,180,255,0.5)";
      ctx.fillRect(figX + 10, figY + 8, 12, 12);
    }
    if (packListOn) {
      text(m.name, names.x ?? 114, nameY,
        { kind: names.name_kind ?? 2, clut: names.name_clut ?? 5 });
      const [d1, d2] = (DESC[m.name] ?? "").split("\n");
      const descY = (names.desc_y_start ?? 79) + i * (names.y_step ?? 42);
      const descFace = { kind: names.desc_kind ?? 1, clut: names.desc_clut ?? 1 };
      text(d1 ?? "", names.x ?? 114, descY, descFace);
      text(d2 ?? "", names.x ?? 114, nameY + 22, descFace);
    }
  });

  if (packListOn) {
    const [s1, s2] = (PACK_DESC[pack.id] ?? "").split("\n");
    text(s1 ?? "", header2.x, header2.y, header2);
    text(s2 ?? "", header2.x, (header2.y ?? 194) + 10, header2);
  }

  if (ps.phase?.() === "confirm") {
    const C = confirmScreen();
    const yesOn = (ps.confirmSel?.() ?? 0) === 0;
    text(STR.confirmation_title ?? "Confirmation Screen", C.title.x, C.title.y, C.title);
    const accountName = ps.accountName?.() ?? "";
    if (accountName) {
      const nameAt = C.name ?? C.subtitle;
      text(accountName, nameAt.x, nameAt.y, nameAt);
    }
    const packAt = C.pack_name ?? C.question;
    text(pack.name, packAt.x, packAt.y, packAt);
    const qAt = C.register_question ?? { x: 90, y: 169, kind: 1 };
    text(STR.register_question ?? "Register account?", qAt.x, qAt.y, qAt);
    text(STR.yes ?? "YES", C.option_yes.x, C.option_yes.y, C.option_yes);
    text(STR.no ?? "NO", C.option_no.x, C.option_no.y, C.option_no);
    const curY = yesOn
      ? (C.cursor?.y ?? C.option_yes.y)
      : (C.cursor?.y ?? C.option_yes.y) + (C.cursor?.y_step ?? 14);
    text(">", C.cursor?.x ?? 90, curY, C.option_yes);
  }

  ctx.restore();
}
