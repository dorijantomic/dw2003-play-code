import { residentStorage } from "./vendor/engine.js";
// web/save.js — the MEMORY CARD save/load screen (STGMCARD overlay).
//
// Identity (decoded 2026-08-05, docs/research/ui/stgmcard-decoded-2026-08-05.md):
// pro/stgmcard is the memory-card SAVE/LOAD screen, NOT the card battle game
// the master-plan census guessed. Its string bank is esmemcrd (bank base 0x78
// = LBA_MSMEMCRD 120) and its chrome pack is STMCRDCS/TM (handles
// 0x029D0000/0x029E0000 = LBA 669/670) whose art is literally three PS1
// memory cards, a console with its card slots, and eight per-starter save
// nameplates.
//
// EVERY coordinate, clip id, animation cadence and string on this screen comes
// from web/assets/data/stgmcard_ui.json, emitted by tools/extract_stgmcard_ui.py
// out of the overlay's own data section and decompiled draw functions. Nothing
// here is pixel-measured. The layout json is the single shared source of
// geometry for drawing, text and cursor hit positions.
//
// SCOPE / honesty: the walker has no PlayStation memory card. The original
// screen's three card columns are mapped onto three localStorage save slots,
// and the file record's fields (name / area / place / BIT / three party
// starters + levels / play time) are filled from the walker's own live state.
// The card-insert, format, block-count and read-error paths of the original
// flow have no walker equivalent and are not faked — their strings ship in the
// layout json but the screen never enters those states.
import { paintScreenDim } from "./screendim.js";
import { asButton } from "./input.js";
import { ui } from "./vendor/engine.js";
import { drawText } from "./uifont.js";
import { loadPack, drawClip, packReady, drawPackBackdrop, drawClipAtPaletteRow } from "./screenpack.js";
import { CHARID_TO_DIGID } from "./party.js";

const mcard = loadPack("stmcrd");
const cmfont = loadPack("cmfont");

let LAYOUT = null;
// Guarded so this module stays importable under `node --test` (no DOM there) —
// the same pattern as uifont.js / screenpack.js.
if (typeof Image !== "undefined") {
  fetch("assets/data/stgmcard_ui.json")
    .then((r) => r.json())
    .then((j) => { LAYOUT = j; })
    .catch(() => {});
}

/** Test seam: install the layout json without a browser fetch. */
export function __setLayout(json) { LAYOUT = json; }

/**
 * Test seams for the storage shim: seed and inspect raw slot bytes without a
 * browser. The save contract under test is byte preservation — every key the
 * snapshot is given, including keys no screen understands, must round-trip
 * unchanged — so the test needs raw string access, not parsed values.
 */
export function __setStoreItem(k, v) { store.setItem(k, String(v)); }
export function __getStoreItem(k) { return store.getItem(k); }
export function __clearStore() {
  for (let i = store.length - 1; i >= 0; i--) store.removeItem(store.key(i));
  memoryStore.clear();
}
export function __readSlotRaw(i) { return store.getItem(SLOT_KEY(i)); }

// Slot storage. Falls back to an in-memory map outside a browser so the
// save/load round trip is unit-testable.
const memoryStore = new Map();
const store = typeof localStorage !== "undefined" ? localStorage : {
  get length() { return memoryStore.size; },
  key: (i) => [...memoryStore.keys()][i] ?? null,
  getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
  setItem: (k, v) => { memoryStore.set(k, String(v)); },
  removeItem: (k) => { memoryStore.delete(k); },
};

export const SLOT_COUNT = 3;
const SLOT_KEY = (i) => `mcardSlot${i}`;
const LAST_SLOT_KEY = "mcardLastSlot";

// Leave dim (SCREEN-OBJECT-METHODS-001, fadeStart_stgmcard). The only
// overlay call is direction 0, duration 0x1E: the 8.8 dim word runs
// 0 → 0xFF00 in 30 frames, then the screen is gone.
const VSYNC_S = 0.02;
const LEAVE_FADE_FRAMES = 0x1E;
const LEAVE_FADE_MAX = 0xFF00;
const LEAVE_FADE_DELTA = Math.trunc(LEAVE_FADE_MAX / LEAVE_FADE_FRAMES);

// Keys the snapshot deliberately leaves alone: they describe the browser
// session (which renderer/asset mode the player picked, which slots exist),
// not the saved game.
const NON_GAME_KEYS = new Set([
  "assetMode", "mcardSlot0", "mcardSlot1", "mcardSlot2",
]);

function snapshotStorage() {
  const out = {};
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!NON_GAME_KEYS.has(k)) out[k] = store.getItem(k);
  }
  return out;
}

function restoreStorage(data) {
  for (let i = store.length - 1; i >= 0; i--) {
    const k = store.key(i);
    if (!NON_GAME_KEYS.has(k)) store.removeItem(k);
  }
  for (const [k, v] of Object.entries(data ?? {})) store.setItem(k, v);
}

/**
 * Write one walker save slot. Both screens use this so a file written by the
 * native pro/stgmcard route (web/save-native.js) is the same record the
 * hand-authored screen reads back, and vice versa:
 *   record — the 0x44 summary fields from buildRecord
 *   image  — the screen's own 0x26C4 save image, when it produced one (the
 *            native route's load path hands it back through the card host)
 *   data   — the localStorage snapshot the slot restores on load
 */
export function writeSlot(i, { record, image = null, data = null, playSeconds = null, residentImageVersion = 0, state = null } = {}) {
  if (!(i >= 0 && i < SLOT_COUNT)) return false;
  // The name on a save is the tamer's registered name — the account name the
  // player typed at the Online Center clerk (web/game.js takes it from the
  // registration wizard or the naming keyboard and reads it back here) — so a
  // new save persists it. Written BEFORE the snapshot is taken, so the slot the
  // player loads later restores the same name and the live session keeps
  // showing the name on its file card. The title's Continue does NOT read it:
  // Continue always opens this screen in LOAD mode, saved or not.
  if (record?.name) store.setItem("playerName", String(record.name));
  const entry = {
    record: record ?? null,
    data: data ?? snapshotStorage(),
    savedAt: Date.now(),
  };
  if (state) {
    for (const key of ["playerName", "bits", "playSeconds", "rosterOwned", "progressOrdinal", "packId", "charId", "party", "partyStats", "partnerStats", "equipment", "reserveStats", "reserveEquipment", "digimonNames", "inventory", "worn"]) {
      const value = state[key];
      if (value !== undefined) entry.data[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
    }
  }
  if (image) { entry.image = Array.from(image); if (residentImageVersion) entry.residentImageVersion = residentImageVersion; }
  if (playSeconds !== null) store.setItem("playSeconds", String(Math.floor(playSeconds)));
  store.setItem(SLOT_KEY(i), JSON.stringify(entry));
  store.setItem(LAST_SLOT_KEY, String(i));
  return true;
}

/** Restore a slot's localStorage snapshot into the live store. */
export function restoreSlotData(i, profiles = null) {
  const slot = readSlot(i);
  if (!slot) return false;
  restoreStorage(slot.residentImageVersion === 1 && profiles
    ? residentStorage(slot.image, profiles, slot.data) : slot.data);
  return true;
}

export function readSlot(i) {
  try {
    const raw = store.getItem(SLOT_KEY(i));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Build the save record the original screen displays. Field names mirror the
 * decoded per-slot record (stride 0x44) so the mapping stays legible:
 *   +0x00 name, +0x18 area string idx, +0x1C place string idx, +0x20 BIT,
 *   +0x28/+0x2A/+0x2C play h/m/s, +0x30.. party starter types,
 *   +0x3C.. party levels.
 */
export function buildRecord(state, opts = {}) {
  const L = LAYOUT;
  const byType = L?.file_card?.party?.digimonIdByType ?? {};
  const typeOf = (digimonId) => {
    for (const [t, id] of Object.entries(byType)) {
      if (id === digimonId) return Number(t);
    }
    return -1;
  };
  const party = (state?.party ?? []).slice(0, 3);
  const stats = state?.partyStats ?? [];
  const seconds = Math.max(0, Math.floor(opts.playSeconds ?? 0));
  // The record stores bank INDICES, not text. Resolve the caller's names
  // against the two banks the original indexes (esstarea for the city, and
  // esshpnam -- whose tail is every inn/save point -- for the place). An
  // unmatched name keeps index 0, whose string is "" and therefore leaves the
  // descriptor's dash placeholder standing rather than inventing an entry.
  // Walker map names combine two things the area bank lists separately
  // ("Central Sector  Asuka City" -- both "Central Sector" and "Asuka City"
  // are esstarea entries). An exact hit wins; otherwise the LAST contained
  // entry wins, which picks the trailing, more specific component.
  const bankIndex = (bank, name) => {
    if (!name) return 0;
    const entries = bank ?? [];
    const exact = entries.indexOf(name);
    if (exact > 0) return exact;
    let best = 0, bestAt = -1;
    for (let i = 1; i < entries.length; i++) {
      if (!entries[i]) continue;
      const at = name.lastIndexOf(entries[i]);
      if (at < 0) continue;
      if (at > bestAt || (at === bestAt && entries[i].length > entries[best].length)) {
        best = i;
        bestAt = at;
      }
    }
    return best;
  };
  return {
    name: state?.playerName || "",
    areaIndex: opts.areaIndex
      ?? bankIndex(L?.strings?.areaBank?.all, opts.areaName),
    placeIndex: opts.placeIndex
      ?? bankIndex(L?.strings?.placeBank?.all, opts.placeName),
    // Kept for the CITY row only, so an unmatched walker map still names where
    // the file was saved. The place row has no fallback: its bank is the
    // specific save-point list, and inventing an entry for it would be a
    // guess, so an unmatched map leaves the descriptor's dash placeholder.
    areaText: opts.areaName ?? "",
    bits: Math.max(0, Number(state?.bits) || 0),
    hours: Math.min(99, Math.floor(seconds / 3600)),
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
    // state.party holds manifest character ids ("p003pken"); CHARID_TO_DIGID
    // is the single source of truth for the digimon.json id behind each.
    partyTypes: [0, 1, 2].map((i) => typeOf(CHARID_TO_DIGID[party[i]] ?? -1)),
    partyLevels: [0, 1, 2].map((i) => Number(stats[i]?.level) || 0),
  };
}

export function createSaveScreen(sfx = null) {
  const s = {
    _open: false,
    mode: "save",          // "save" | "load"
    screen: "slots",       // "slots" | "file" | "confirm" | "message"
    slot: 0,
    yesNo: 0,              // 0 = YES, 1 = NO
    message: "",
    messageIndex: null,
    fold: 0,               // 8.8 tween value, esmemcrd window slide-in
    foldTween: ui.createFoldTween(),
    showQuad: false,       // the card-access transition quad; lab-only, see
                           // transition.quad.unwired_note
    quadAngle: 0,
    closing: false,        // screen+0x5C -- frame/party icons still drawing
    showRecordText: true,  // screen+0x60 -- the 19 record text widgets
    time: 0,
    fadeLeaving: false,
    fadeT0: 0,
    record: null,
    state: null,
    onClose: null,
  };

  s.isOpen = () => s._open;
  /** Lab seam: raise the decoded card-access transition quad. */
  s.showTransitionQuad = (on = true) => { s.showQuad = !!on; s.quadAngle = 0; };

  /**
   * @param opts { areaName, placeName, playSeconds } — the city and save-point
   * names to resolve against the original's own banks, and the play clock.
   */
  s.open = (gameState, mode = "save", onClose = null, opts = {}) => {
    s._open = true;
    s.saveOpts = opts;
    s.mode = mode === "load" ? "load" : "save";
    s.screen = "slots";
    const last = Number(store.getItem(LAST_SLOT_KEY));
    s.slot = Number.isInteger(last) && last >= 0 && last < SLOT_COUNT ? last : 0;
    s.yesNo = 0;
    s.message = "";
    s.messageIndex = null;
    s.time = 0;
    s.fadeLeaving = false;
    s.state = gameState ?? null;
    s.onClose = onClose;
  };

  s.close = () => {
    s._open = false;
    s.closing = false;
    s.fadeLeaving = false;
    s.showRecordText = true;
    s.onClose?.();
    s.onClose = null;
  };

  function requestLeave() {
    if (s.fadeLeaving) return;
    s.fadeLeaving = true;
    s.fadeT0 = s.time;
  }

  // The overlay's window slide-in is the generic linear 8.8 tween
  // (F0x80087fdc start / F0x8008801c tick). It is now the SHARED class in
  // engine/dw3/ui/fold-tween.ts rather than a copy local to this screen —
  // same integer arithmetic, and its clamp lands exactly on the target instead
  // of stepping one past it first.
  function startFold() {
    const f = LAYOUT?.file_card?.fold ?? { from: 0x97, to: 0, steps: 10 };
    ui.startFold(s.foldTween, f.from, f.to, f.steps);
  }

  // Closing runs the same tween the other way. DECODED 2026-08-14
  // (ledger UI-STGMCARD-CLOSE-STAGGER-2026-08-14): F0x800836c4's exit band
  // clears the record-text flag (screen+0x60) AND starts the fold closing in
  // the same step, then clears the frame/party-icon flag (screen+0x5C) only
  // once the fold reports done. So the file card's text goes first, the frame
  // rides the window shut, and only then does the whole card stop drawing.
  function startFoldOut() {
    const f = LAYOUT?.file_card?.fold ?? { from: 0x97, to: 0, steps: 10 };
    ui.startFold(s.foldTween, f.to, f.from, f.steps);
    s.showRecordText = false;   // screen+0x60
    s.closing = true;           // screen+0x5C stays set until the fold lands
  }

  function tickFold() {
    ui.tickFold(s.foldTween);
  }

  // This screen is the one member of the fold family that ADDS the value to a
  // window's Y instead of scaling by it (UI-STGMCARD-FOLD-AND-TABLES-001): a
  // 0x97-pixel vertical slide-in over 10 vsyncs.
  const foldY = () => (s.screen === "slots" ? 0 : s.foldTween.value);
  // screen+0x5C: the frame and party icons keep drawing through the fold-out,
  // and stop only once the tween reports done — which is exactly when the
  // original clears that flag.
  const showCard = () => !(s.closing && ui.foldComplete(s.foldTween));
  // screen+0x60: the record's 19 text widgets stop the moment closing starts.
  const showRecordText = () => s.showRecordText !== false;

  function enterFile() {
    s.record = readSlot(s.slot)?.record ?? null;
    s.screen = "file";
    startFold();
  }

  function commit() {
    const str = LAYOUT?.strings?.all ?? [];
    if (s.mode === "save") {
      const opts = { ...(s.saveOpts ?? {}) };
      opts.playSeconds = opts.playSeconds ?? s.state?.playSeconds ?? 0;
      // Fold the live play clock in BEFORE the write, so the snapshot the slot
      // keeps carries it. writeSlot is the single writer for every save route
      // (this screen and both native cards), so the name it persists is the
      // same one the original-code and translated cards persist.
      store.setItem("playSeconds", String(Math.floor(opts.playSeconds ?? 0)));
      writeSlot(s.slot, { record: buildRecord(s.state, opts) });
      s.message = str[9] ?? "Saved.";              // esmemcrd 9 "Saved."
      s.messageIndex = 9;
    } else {
      const slot = readSlot(s.slot);
      if (!slot) { s.message = str[24] ?? "No data here."; s.messageIndex = 24; }
      else {
        restoreStorage(slot.data);
        store.setItem(LAST_SLOT_KEY, String(s.slot));
        s.message = str[18] ?? "LOADED.";          // esmemcrd 18 "LOADED."
        s.messageIndex = 18;
        s.reloadOnClose = true;
      }
    }
    s.screen = "message";
    sfx?.play("system01");
  }

  s.handleKey = (rawKey) => {
    // Accept either a pad button name from the dispatcher or the raw key it
    // stands for, so a caller (and a test) may use whichever it has.
    const k = asButton(rawKey);
    if (!s._open) return false;
    if (s.fadeLeaving) return true;
    const back = k === "cross";
    if (s.screen === "slots") {
      if (k === "left") { s.slot = Math.max(0, s.slot - 1); sfx?.play("system06"); return true; }
      if (k === "right") { s.slot = Math.min(SLOT_COUNT - 1, s.slot + 1); sfx?.play("system06"); return true; }
      if (k === "circle") { sfx?.play("system01"); enterFile(); return true; }
      if (back) { sfx?.play("system02"); requestLeave(); return true; }
      return true;
    }
    if (s.screen === "file") {
      if (k === "circle") {
        if (s.mode === "load" && !s.record) {
          // esmemcrd 24 "No data here." — empty load is a message, not a no-op.
          s.message = (LAYOUT?.strings?.all ?? [])[24] ?? "No data here.";
          s.messageIndex = 24;
          s.screen = "message";
          sfx?.play("system01");
          return true;
        }
        s.yesNo = 0;
        s.screen = "confirm";
        sfx?.play("system01");
        return true;
      }
      if (back) { sfx?.play("system02"); startFoldOut(); return true; }
      return true;
    }
    if (s.screen === "confirm") {
      if (k === "up" || k === "down") { s.yesNo ^= 1; sfx?.play("system06"); return true; }
      if (k === "circle") {
        if (s.yesNo === 0) commit();
        else { s.screen = "file"; sfx?.play("system02"); }
        return true;
      }
      if (back) { sfx?.play("system02"); s.screen = "file"; return true; }
      return true;
    }
    // message
    if (k === "circle" || back) {
      if (s.reloadOnClose) {
        // A load swaps the whole persisted state under the running game, so the
        // page is reloaded to rebuild every module from it.
        s.reloadOnClose = false;
        if (typeof location !== "undefined") location.reload();
        else requestLeave();
        return true;
      }
      requestLeave();
      return true;
    }
    return true;
  };

  // ---- drawing ---------------------------------------------------------
  // The rotating transition quad (F0x80083c50). DECODED 2026-08-14, ledger
  // UI-STGMCARD-TRANSITION-QUAD-2026-08-14: one POLY_G4 per frame — the
  // gouraud-shaded untextured quad — whose FOUR vertex colours are really two,
  // vertices 0 and 2 taking one triple and 1 and 3 the other, so it shades
  // across a single axis. The two triples come from the object's own colour
  // setters and the only call site passes violet and magenta. Its rectangle is
  // the constructor's four arguments.
  //
  // A canvas linear gradient across the quad's own width is the closest thing
  // to a two-colour gouraud fill; the rotation is the decoded angle ramp.
  function drawTransitionQuad(ctx, tr) {
    const q = tr.quad;
    if (!q) return;
    // The angle ramps toward a full turn and clamps just short of it.
    const turn = Math.min(s.quadAngle, q.rotation.clamp) / q.rotation.full_turn;
    ctx.save();
    ctx.translate(q.x + q.w / 2, q.y + q.h / 2);
    ctx.rotate(turn * Math.PI * 2);
    const g = ctx.createLinearGradient(-q.w / 2, 0, q.w / 2, 0);
    g.addColorStop(0, q.colorA_hex);
    g.addColorStop(1, q.colorB_hex);
    ctx.fillStyle = g;
    ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
    ctx.restore();
  }

  function drawSlotSelect(ctx) {
    const L = LAYOUT;
    const sel = L.slot_select;
    // Purple header bar (clip 0x20) then the three cards (clip 0x22) and the
    // console (clip 0x23), whose CLUT row pulses 0..0xC every 3 ticks.
    drawClip(ctx, mcard, sel.bar.clip, sel.bar.x, sel.bar.yOffset);
    drawClip(ctx, mcard, sel.cards.clip, sel.cards.xOffset, sel.cards.y);
    const pulse = Math.floor(s.time * 20) % (sel.console.clutPulse[1] * 2);
    const row = pulse <= sel.console.clutPulse[1] ? pulse : sel.console.clutPulse[1] * 2 - pulse;
    drawClipAtPaletteRow(ctx, mcard, sel.console.clip, row, sel.slotX[s.slot], sel.console.y);

    // Per-card starter nameplate, drawn only for a card that holds data.
    for (let i = 0; i < sel.slots; i++) {
      const rec = readSlot(i)?.record;
      const type = rec?.partyTypes?.[0] ?? -1;
      const idx = type - sel.typeBase;
      if (idx < 0 || idx >= sel.plateClipByType.length) continue;
      drawClip(ctx, mcard, sel.plateClipByType[idx], sel.slotX[i], sel.plateY);
    }
    const header = (L.strings.all[sel.header.string] ?? "{1}")
      .replace("{1}", String(s.slot + 1));
    drawText(ctx, header, sel.header.xy[0], sel.header.xy[1]);
  }

  function drawFileCard(ctx) {
    const L = LAYOUT;
    const fc = L.file_card;
    const dy = foldY();
    // The window frame (clip 0x21, F0x80087368) is up in every state of this
    // window. The inner record frame (clips 0x24/0x25, F0x800836c4) sits
    // directly under the 19 record widgets and the party icons, and it is
    // gated on the screen's OWN flag (+0x5C), not the widget-hiding flag
    // (+0x60). DECODED 2026-08-14: the two are staggered on the way out, so
    // this frame outlives the record text by the whole length of the fold.
    drawClip(ctx, mcard, fc.window.clip, fc.window.xy[0], fc.window.xy[1] + dy);
    if ((s.screen === "file" || s.closing) && showCard()) {
      drawClip(ctx, mcard, fc.layers.front, fc.layers.xy[0], fc.layers.xy[1] + dy);
      drawClip(ctx, mcard, fc.layers.back, fc.layers.xy[0], fc.layers.xy[1] + dy);
    }

    // F0x8008316c's first branch (`arg0->unk60 == 0`) calls +0x144(0) on every
    // one of the 19 record widgets, i.e. the card's contents are HIDDEN while
    // the window is showing a message or a confirm prompt. Only the window
    // chrome stays up. So the record pass is skipped in those states.
    if (s.screen !== "file" || !showRecordText()) return;

    const rec = s.record;
    const str = L.strings.all;
    const area = L.strings.areaBank.all;
    const place = L.strings.placeBank.all;

    // Widget pass. Each widget's placeholder string, kind, position and
    // right-alignment flag come from the overlay's own descriptor table; the
    // roles come from the populate function F0x8008316c.
    for (const w of fc.widgets) {
      let text = w.text ?? "";
      if (rec) {
        switch (w.role) {
          case "fileName": text = rec.name || text; break;
          case "areaName": text = area[rec.areaIndex] || rec.areaText || text; break;
          case "placeName": text = place[rec.placeIndex] || text; break;
          case "bitValue": text = String(rec.bits); break;
          case "lvValue0": case "lvValue1": case "lvValue2": {
            const i = Number(w.role.slice(-1));
            text = rec.partyTypes[i] >= 0 ? String(rec.partyLevels[i]) : (str[0x23] ?? "--");
            break;
          }
          // The "LV" labels stay up for every slot: F0x8008316c's per-slot loop
          // sets widget 6+i to esmemcrd 0x14 unconditionally and only the VALUE
          // falls back to "--", so an empty party slot reads "LV --".
          case "timeHours": text = String(rec.hours); break;
          case "timeMinutes": text = String(rec.minutes); break;
          case "timeSeconds": text = String(rec.seconds); break;
          case "timeMinutesLeadingZero": text = rec.minutes < 10 ? "0" : ""; break;
          case "timeSecondsLeadingZero": text = rec.seconds < 10 ? "0" : ""; break;
          default: break;
        }
      } else if (w.role.startsWith("time") && w.role.endsWith("LeadingZero")) {
        text = "";
      }
      if (!text) continue;
      // +0x148 justification: the widget shifts left by its own measured
      // width, i.e. the descriptor x is the RIGHT edge for numeric fields.
      drawText(ctx, text, w.x, w.y + dy,
        { kind: w.kind, alignRight: !!w.numeric });
    }

    // Party icons: per-starter ping-pong animation from the overlay's own
    // frame table, one row per starter type.
    if (rec) {
      const p = fc.party;
      for (let i = 0; i < p.count; i++) {
        const idx = (rec.partyTypes[i] ?? -1) - p.typeBase;
        if (idx < 0 || idx >= p.frames.length) continue;
        const frames = p.frames[idx];
        const f = frames[Math.floor(s.time * (60 / p.frameTicks)) % frames.length];
        drawClip(ctx, mcard, f, p.iconXY[i][0], p.iconXY[i][1] + dy);
      }
    }
    // An empty card shows nothing beyond the descriptor placeholders — that
    // dashed layout IS the original's "no data" state (F0x8008316c's
    // `var_s3->unk0 == 0` branch sets every widget to its descriptor string
    // and binds no message), so no extra label is drawn here.
  }

  // Line pitch inside a multi-line widget. Not separately decoded; taken from
  // the card's own descriptor rows, which the overlay places 14/15px apart
  // (0x6D, 0x7B, 0x8A at 0x80088088+). Flagged in the layout json's open_gaps.
  const LINE_PITCH = 14;

  // The message window owns two body boxes, and which one a given string goes
  // in is decoded (2026-08-14, message_window.binding): the FIVE-line box at
  // (20,129) takes the waiting messages and the memory card's own result, and
  // the TWO-line box at (20,192) takes the prompts and the outcomes. The
  // walker used to put everything in the five-line box.
  //
  // lines[0] (20,113) is bound by none of F0x80084dcc's sixteen string sites,
  // so the SAVE/LOAD title drawn there is still an assumption, not a decode.
  function bodyBoxFor(stringIndex) {
    const mw = LAYOUT.message_window;
    const bind = mw.binding;
    if (bind && Number.isInteger(stringIndex)) {
      if (bind["lines[2]"]?.strings?.includes(stringIndex)) return mw.lines[2];
      if (bind["lines[1]"]?.strings?.includes(stringIndex)) return mw.lines[1];
    }
    return mw.lines[1];
  }

  function drawWindowText(ctx, title, body, stringIndex = null) {
    const mw = LAYOUT.message_window;
    if (title) drawText(ctx, title, mw.lines[0].xy[0], mw.lines[0].xy[1]);
    const box = bodyBoxFor(stringIndex);
    let ly = box.xy[1];
    for (const line of String(body ?? "").split("\n")) {
      drawText(ctx, line, box.xy[0], ly);
      ly += LINE_PITCH;
    }
  }

  const modeTitle = () => (LAYOUT.strings.all[s.mode === "save" ? 1 : 14] ?? "");

  function drawConfirm(ctx) {
    const L = LAYOUT;
    const mw = L.message_window;
    const str = L.strings.all;
    drawClip(ctx, mcard, mw.yesNoPlate.clip, mw.yesNoPlate.xy[0], mw.yesNoPlate.xy[1]);
    drawText(ctx, str[22] ?? "YES", mw.yes.xy[0], mw.yes.xy[1]);
    drawText(ctx, str[23] ?? "NO", mw.no.xy[0], mw.no.xy[1]);
    const cy = s.yesNo === 0 ? mw.yes.xy[1] : mw.no.xy[1];
    drawText(ctx, "[arrow-right]", mw.cursor.xy[0] - 12, cy);
    // Prompt: "Save here?" / "Writing over previous data. Proceed?" / "Load
    // which game?" -- the original's own strings, chosen by mode and whether
    // the card already holds a file.
    // Only the overwrite prompt (esmemcrd 7) is a traced binding; 6 and
    // 0x10 are set somewhere other than a +0x114 site and were not traced, so
    // they keep the default box.
    const promptIdx = s.mode === "save" ? (s.record ? 7 : 6) : 16;
    drawWindowText(ctx, modeTitle(), str[promptIdx], promptIdx);
  }

  function drawMessage(ctx) {
    const mw = LAYOUT.message_window;
    drawWindowText(ctx, modeTitle(), s.message, s.messageIndex);
    // Footer blink arrow: cmfont clip 0x0A, CLUT row cycling 0..4 every 3
    // ticks (F0x80087368).
    const a = mw.blinkArrow;
    const row = Math.floor(s.time * (60 / a.frameTicks)) % a.clutRows;
    drawClipAtPaletteRow(ctx, cmfont, a.clip, row, a.xy[0], a.xy[1]);
  }

  s.draw = (ctx, w, h, _state, dt = 1 / 60) => {
    if (!s._open) return;
    s.time += dt;
    if (s.fadeLeaving) {
      const frames = Math.max(0, Math.floor((s.time - s.fadeT0) / VSYNC_S));
      if (frames * LEAVE_FADE_DELTA >= LEAVE_FADE_MAX) { s.close(); return; }
    }
    tickFold();
    // The fold-out landing is what finally drops the card, mirroring
    // F0x800836c4 clearing screen+0x5C on its fold-done poll. Only then does
    // the screen fall back to the slot list.
    if (s.showQuad) {
      const q = LAYOUT?.transition?.quad;
      if (q) s.quadAngle = Math.min(q.rotation.clamp, s.quadAngle + q.rotation.full_turn / 60);
    }
    if (s.closing && ui.foldComplete(s.foldTween)) {
      s.closing = false;
      s.showRecordText = true;
      s.screen = "slots";
    }
    const scale = Math.max(1, Math.min(w / 320, h / 240));
    ctx.save();
    ctx.scale(scale, scale);
    const vw = w / scale, vh = h / scale;

    ctx.fillStyle = "#000010";
    ctx.fillRect(0, 0, vw, vh);

    if (!LAYOUT || !packReady(mcard)) {
      drawText(ctx, "MEMORY CARD", 24, 24);
      ctx.restore();
      return;
    }

    // Scrolling tiled backdrop + vertical bar (F0x800877f0): the tile clip is
    // drawn at (t, t) with t cycling 0..0x5F.
    //
    // RATE CORRECTED 2026-08-14. This used to advance t at 60px/s (one pixel
    // per vsync). stgmcard.s L4950-L4977 shows the same alternate-frame gate
    // every other scrolling wall in the game has: the counter at +0x58 is
    // incremented ONLY on frames where the +0x5c toggle is already set, so it
    // is half a pixel per vsync = 25px/s at PAL 50Hz — the rate the shared
    // renderer already implements. The hand-rolled tiling loop that used to
    // live here (to cover a viewport wider than 320) is what drawPackBackdrop
    // does natively, so it goes through that instead of keeping a second copy.
    const tr = LAYOUT.transition;
    drawPackBackdrop(ctx, mcard, tr.background.clip, 320, 240, s.time);
    drawClip(ctx, mcard, tr.bar.clip, tr.bar.xy[0], tr.bar.xy[1]);
    if (s.showQuad) drawTransitionQuad(ctx, tr);

    if (s.screen === "slots") drawSlotSelect(ctx);
    else {
      drawFileCard(ctx);
      if (s.screen === "confirm") drawConfirm(ctx);
      else if (s.screen === "message") drawMessage(ctx);
    }

    if (s.fadeLeaving) {
      const frames = Math.max(0, Math.floor((s.time - s.fadeT0) / VSYNC_S));
      const a = Math.min(255, (frames * LEAVE_FADE_DELTA) >> 8) / 255;
      paintScreenDim(ctx, a * 255, 320, 240);
    }

    ctx.restore();
  };

  return s;
}
