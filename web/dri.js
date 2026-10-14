// Native stgdglab (DRI desk) flow. Geometry is transcribed from the overlay
// renderers/constructors named beside each draw block; screenshots are checks only.
import { paintScreenDim } from "./screendim.js";
import { asButton } from "./input.js";
import { drawIconGlyph, drawText } from "./uifont.js";
import { loadPack, drawClip, drawPackBackdrop } from "./screenpack.js";
import { starterPortraitClip } from "./portraits.js";
import { elementValue, equipmentBonuses, padRepeatFires, ui } from "./vendor/engine.js";
import {
  acquiredDriForms,
  driReserve,
  driRoster,
  driStarterAt,
  driSwitchSlots,
  driStatsAt,
  ensureDriPartyStats,
  ensureFormLedger,
  firstOpenEquipSlot,
  formLedgerRecord,
  setEquippedForm,
  setStandingForm,
  standingChoices,
  standingChoicesFromStats,
  switchInReservePartner,
  toggleLedgerTech,
} from "./dri-model.js";

const NATIVE_W = 320;
const ROOT_OPTIONS = ["Switch Digimon", "Digivolve", "Digivolve Chart"];

// Leave / action dim (SCREEN-OBJECT-METHODS-001, screenFadeStart_stgdglab /
// lab_root_start_dim_fade). Triangle on Select Action, and confirming a
// row, run the 8.8 dim word 0 → 0xFF00 in 30 frames (~a second at PAL).
const VSYNC_S = 0.02;
const LEAVE_FADE_FRAMES = 0x1E;
const LEAVE_FADE_MAX = 0xFF00;
const LEAVE_FADE_DELTA = Math.trunc(LEAVE_FADE_MAX / LEAVE_FADE_FRAMES);
// Select Action fold durations from F0x8008a51c: most panes 0xA vsyncs, a
// few 8. Close ramps twice as fast (F0x8008f22c). Pivots from F0x80089aec.
const FOLD_STEPS_BANNER = 0xA;
const FOLD_STEPS_MENU = 0xA;
const FOLD_STEPS_FOOTER = 8;
// Change-type message panel: fold +0xEC, F0x80085dd0 state 2 opens it and state
// 5 shuts it. Its two plates are F0x8008ad98-style: clip 0x2C at (0x95,0x7C)
// pivot (0x140,0x9D) and clip 0x2B at (0,0xBF) pivot (0,0xD0) (F0x80085dd0 draw
// tail, spA4).
const CHANGE_PANEL_FOLD_STEPS = 0xA;
// The ten-cell grid itself folds open on entry: fold +0xDC, 0xA steps, pivot
// (0x140,0x37); its cell frames (clip 0x3E) are drawn only once it lands
// (F0x80085dd0 draw tail).
const CHANGE_GRID_FOLD_STEPS = 0xA;
// The digivolve "Select Action" submenu's own windows fold, the way the root
// Select Action does. F0x800885ec installs the step counts +0x54=8, +0x64/+0x74/
// +0x84/+0x94=0xA, +0xA4=8; F0x8008820c draws each pane through the sp9C/spA4
// tween pair and F0x80087600 case 2 shuts them before the child runs (cases 3-4).
// Pivots are the spA4 immediates: left stat panel (0,0x7F), loaded-tech window
// (0x140,0x2A), banner (0x140,0x5C), option window (0x140,0x87), back plate
// (0x140,0xBE). The sixth object (+0xA4, 8 steps) is the same back plate.
const SUBMENU_FOLD_STEPS = { stat: 8, tech: 0xA, banner: 0xA, options: 0xA, back: 0xA, backAlt: 8 };
const PORTRAIT_PERIOD = 12 * VSYNC_S;
const CLUT_PERIOD = 10 * VSYNC_S;
// The chart's own cursor/pager CLUT row steps every 8 vsync over four rows
// (F0x8008365c: `frame - unk288 >= 8` then `unk28C = (unk28C + 1) % 4`), and
// the digivolve list's scroll arrows toggle on the same 8-vsync tick
// (F0x8008e4cc: `frame - unk164 >= 8` then `unk168 = 1 - unk168`).
const CHART_CLUT_PERIOD = 8 * VSYNC_S;
const ARROW_BLINK_PERIOD = 8 * VSYNC_S;
// The scrolling list's thumb, drawn as one flat white quad by the actor
// F0x8008a8c4 builds: setters F0x8008a670 (x, width), F0x8008a67c (track top,
// track bottom), F0x8008a690 (rows visible, item count), F0x8008a6a4 (scroll
// offset), tick F0x8008a6ac (GPU code 5 / GP0 0x28, RGB 0xFF,0xFF,0xFF).
// Call site F0x8008e018:51-57 installs x=0x122 w=0xC, track 0x35..0x55,
// 3 rows visible, and only when the list holds four or more entries.
const SCROLL_BAR_X = 0x122;
const SCROLL_BAR_W = 0x0C;
const SCROLL_BAR_TOP = 0x35;
const SCROLL_BAR_BOTTOM = 0x55;
const LIST_ROWS = 3;
const STAT_KEYS = ["str", "def", "spt", "wis", "spd", "chr"];
const ELEM_KEYS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];

const dglab = loadPack("stdglabo");
const chartPortraits = loadPack("stdglabo_portraits");
// The capsule/pedestal towers, tube cursor and card pedestal are cmfont
// (0x0286) clips: 0x10/0x11 = 3-tube row (glint overlay/towers), 0xb/0xc =
// single tube, 0xd = pulsing tube cursor, 0xe = card pedestal, 0x14 = the
// digivolve stat-glyph column. disasm: F0x80089aec / F0x8008ad98 / F0x8008e4cc.
const cmfont = loadPack("cmfont");

function clampCursor(value, length) {
  return Math.max(0, Math.min(Math.max(0, length - 1), value));
}

function fmt(value, width = 3) {
  return String(Math.max(0, Number(value) || 0)).padStart(width, " ");
}

export function persistDriState(state) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem("party", JSON.stringify(state.party ?? []));
  localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
  localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats ?? {}));
  localStorage.setItem("equipment", JSON.stringify(state.equipment ?? []));
  localStorage.setItem("reserveStats", JSON.stringify(state.reserveStats ?? {}));
  localStorage.setItem("reserveEquipment", JSON.stringify(state.reserveEquipment ?? {}));
  if (state.charId) localStorage.setItem("charId", state.charId);
}

export function createDriMenu() {
  const d = {
    _open: false,
    screen: "root",
    cursor: 0,
    page: 0,
    scroll: 0,
    selectedPartner: 0,
    switchFrom: null,
    details: false,
    feedback: null,
    time: 0,
    state: null,
    battle: null,
    onClose: null,
    fadeLeaving: false,
    fadeMode: null, // "leave" | "action"
    fadeT0: 0,
    pendingAction: null,
    prompt: null, // { message, yes } for Load? / Turn load off?
    folds: null,
    foldSfx: null,
    digimonById: {},
    digimonByName: {},
    skillsById: {},
    evolutions: null,
    tables: null,
    techTable: {},
  };

  d.dataReady = Promise.all([
    fetch("assets/data/digimon.json").then((r) => r.json()),
    fetch("assets/data/evolutions.json").then((r) => r.json()),
    fetch("assets/data/dri_tables.json").then((r) => r.json()),
    fetch("assets/data/fight_tech_table.json").then((r) => r.json()),
  ]).then(([digimon, evolutions, tables, techTable]) => {
    d.digimonById = Object.fromEntries(digimon.digimon.map((row) => [row.id, row]));
    d.digimonByName = Object.fromEntries(digimon.digimon.map((row) => [row.name, row]));
    d.skillsById = Object.fromEntries(digimon.skills.map((row) => [row.id, row]));
    d.evolutions = evolutions;
    d.tables = tables;
    d.techTable = techTable;
    if (d.state) ensureDriPartyStats(d.state, d.digimonById);
  });

  d.isOpen = () => d._open;

  function makeFold(steps, open) {
    const tween = ui.createFoldTween();
    if (open) ui.startFold(tween, 0, 0x1000, steps);
    else ui.startFold(tween, 0x1000, 0, Math.max(1, Math.trunc(steps / 2)));
    return tween;
  }

  function startRootFolds(open, sfx = null) {
    d.folds = {
      banner: makeFold(FOLD_STEPS_BANNER, open),
      menu: makeFold(FOLD_STEPS_MENU, open),
      footer: makeFold(FOLD_STEPS_FOOTER, open),
    };
    d.foldSfx = sfx;
    sfx?.play(open ? "system03" : "system04");
  }

  // The Switch-confirm panel's five fold objects and their open step counts
  // (F0x8008c060 sets +0x64/+0x84/+0x94 to 0xA and +0x74/+0xA4 to 8; close runs
  // at half, makeFold). F0x8008b798 cases 1-3 wait for them to open before the
  // reserve list takes input, and cases 5-8 fold them shut before the party
  // write. Pivots are the spA4 values in F0x8008ad98.
  const SWITCH_FOLD_STEPS = { topCard: 0xA, incoming: 0xA, banner: 0xA, tubes: 8, details: 8 };
  function startSwitchFolds(open, sfx = null) {
    d.folds = Object.fromEntries(
      Object.entries(SWITCH_FOLD_STEPS).map(([key, steps]) => [key, makeFold(steps, open)]),
    );
    sfx?.play(open ? "system03" : "system04");
  }

  // The digivolve "Select Action" submenu (F0x8008820c / F0x800885ec). Six fold
  // objects: the five visible panes plus the second back plate the original
  // installs at +0xA4 (drawn by unkAC). steps/pivots are the decoded ones.
  function startSubmenuFolds(open, sfx = null) {
    d.folds = Object.fromEntries(
      Object.entries(SUBMENU_FOLD_STEPS).map(([key, steps]) => [key, makeFold(steps, open)]),
    );
    sfx?.play(open ? "system03" : "system04");
  }

  function tickFolds() {
    if (!d.folds) return true;
    // Tick every pane: Array.every short-circuits on the first fold still in
    // flight, which left the later panes frozen at their start value.
    let done = true;
    for (const key of Object.keys(d.folds)) {
      if (!ui.tickFold(d.folds[key])) done = false;
    }
    return done;
  }

  function foldsReady() {
    if (!d.folds) return true;
    return Object.keys(d.folds).every((key) => ui.foldComplete(d.folds[key]));
  }

  d.open = (onPick = null, onClose = null, state = null) => {
    d._open = true;
    d.screen = "root";
    d.cursor = 0;
    d.scroll = 0;
    d.state = state;
    d.battle = null;
    d.onPick = onPick;
    d.onClose = onClose;
    d.fadeLeaving = false;
    d.fadeMode = null;
    d.pendingAction = null;
    d.prompt = null;
    startRootFolds(true);
    if (state && Object.keys(d.digimonById).length) ensureDriPartyStats(state, d.digimonById);
  };

  d.openAction = (action, state, battle, onClose = null) => {
    d._open = true;
    d.state = state;
    d.battle = battle;
    d.onClose = onClose;
    d.onPick = null;
    d.cursor = 0;
    d.scroll = 0;
    d.page = 0;
    d.selectedPartner = 0;
    d.switchFrom = null;
    d.details = false;
    d.feedback = null;
    if (Object.keys(d.digimonById).length) ensureDriPartyStats(state, d.digimonById);
    d.fadeLeaving = false;
    d.fadeMode = null;
    d.pendingAction = null;
    d.prompt = null;
    d.folds = null;
    d._switchLeave = null;
    d._menuLeave = null;
    d.panel = null;
    d.panelFold = null;
    d.panelLeaving = false;
    d.gridFold = null;
    d.screen = action === 0 ? "switch_from" : action === 1 ? "digivolve_picker" : "chart_picker";
  };

  // Verifier hook: what the Switch screen would offer right now (tools/verify_partner_handover.mjs).
  // Same call the screen itself makes, so it cannot drift from what is drawn.
  d.reserveRows = (state = null) => {
    if (state) d.state = state;
    return reserve();
  };

  // Verifier hook: the chart page exactly as the renderer will draw it, after
  // the F0x800842f4 build pass has skipped and packed the rows.
  d.chartGrid = () => chartNodeGrid();

  // Deterministic verifier hook; it uses the same state/render path as gameplay.
  d.openState = (screen, state, battle = null) => {
    d.openAction(0, state, battle);
    d.screen = screen;
    d.scroll = 0;
  };

  d.close = () => {
    d._open = false;
    d.fadeLeaving = false;
    d.fadeMode = null;
    d.pendingAction = null;
    const callback = d.onClose;
    d.onClose = null;
    d.onPick = null;
    if (callback) callback();
  };

  function requestFade(mode) {
    if (d.fadeLeaving) return;
    d.fadeLeaving = true;
    d.fadeMode = mode;
    d.fadeT0 = d.time;
  }

  function applyPendingAction() {
    const action = d.pendingAction ?? d.cursor;
    d.pendingAction = null;
    d.fadeLeaving = false;
    d.fadeMode = null;
    d.folds = null;
    if (d.onPick) {
      const callback = d.onPick;
      d.onPick = null;
      callback(action);
      return;
    }
    if (d.state) {
      d.screen = action === 0 ? "switch_from" : action === 1 ? "digivolve_picker" : "chart_picker";
      d.cursor = 0;
      d.scroll = 0;
    }
  }

  d.toRoot = () => {
    d.screen = "root";
    d.cursor = 0;
    d.scroll = 0;
    d.switchFrom = null;
    d.details = false;
    d.feedback = null;
    d.prompt = null;
    startRootFolds(true);
  };

  function roster() {
    return d.state && Object.keys(d.digimonById).length ? driRoster(d.state, d.digimonById) : [];
  }

  // The Switch screen's second list: obtained partners that are not deployed
  // (claim PARTY-C004). Empty until an NPC hands a fourth partner over.
  function reserve() {
    return d.state && Object.keys(d.digimonById).length ? driReserve(d.state, d.digimonById) : [];
  }

  // The Switch lists' first row is the three PEDESTALS, including the free ones
  // (F0x80089aec loops i < ctx+0x5C; F0x80088b5c case 5 gives the Switch picker
  // that same 3). The Digivolve/Chart pickers keep the standing-only roster.
  function switchSlots() {
    return d.state && Object.keys(d.digimonById).length ? driSwitchSlots(d.state, d.digimonById) : [];
  }

  function changeTypePool() {
    if (!d.state) return [];
    const starter = driStarterAt(d.state, d.selectedPartner, d.digimonById);
    return [
      ...acquiredDriForms(d.state, d.selectedPartner, d.digimonById),
      { profile: starter, doNothing: true },
    ];
  }

  function chartNodeGrid() {
    if (!d.state) return [];
    const starter = driStarterAt(d.state, d.selectedPartner, d.digimonById);
    const nativeRows = d.tables?.chart_layout_by_starter_id?.[starter?.id]?.[d.page] ?? [];
    const member = roster()[d.selectedPartner];
    const unlocked = new Set();
    unlocked.add(member?.profile?.name);
    for (const record of ensureFormLedger(member?.stats, d.digimonById))
      unlocked.add(d.digimonById[record.id]?.name);
    // F0x800842f4:117-134 builds the page one source row at a time.
    // F0x80083484 answers "is the row's FIRST listed form one this partner has
    // reached?" - it walks the row's five slots, takes the first non-zero one
    // and looks it up in the partner's acquired-form list. A row that answers
    // no is not drawn empty: it is skipped, and the next row that answers yes
    // takes its place, so the tree always packs to the top of the page.
    // F0x80083334 then copies that row across, keeping each form in its own
    // column and blanking the ones not yet reached.
    const owned = (node) => {
      const profile = node && node.node_id !== 0 ? d.digimonById[node.digimon_id] : null;
      return Boolean(profile && unlocked.has(profile.name));
    };
    const built = [];
    for (const nodes of nativeRows) {
      const first = nodes.find((node) => node && node.node_id !== 0);
      if (!first || !owned(first)) continue;
      built.push(nodes.map((node) => (owned(node) ? node : null)));
    }
    while (built.length < 4) built.push([]);
    return built;
  }

  function back(sfx = null) {
    d.feedback = null;
    d.prompt = null;
    if (d.screen === "root") d.close();
    else if (d.screen === "switch_to") {
      d.screen = "switch_from";
      d.cursor = d.switchFrom ?? 0;
      d.switchFrom = null;
    } else if (d.screen === "digivolve" || d.screen === "load_tech" || d.screen === "change_type") {
      // Returning from a child re-opens the submenu's windows (F0x8008820c's
      // show arm) instead of snapping them on.
      d.screen = "digivolve_menu";
      d.gridFold = null;
      d.cursor = 0;
      d.scroll = 0;
      startSubmenuFolds(true, sfx);
    } else if (d.screen === "digivolve_menu") {
      d.screen = "digivolve_picker";
      d.cursor = d.selectedPartner;
      d.folds = null;
    } else if (d.screen === "chart") {
      d.screen = "chart_picker";
      d.cursor = d.selectedPartner;
    } else d.toRoot();
  }

  // Change-type grid message panel (F0x80085dd0 state 4 / F0x80085470 widgets /
  // F0x80085c50 strings). It opens when the confirmed cell is the form the
  // partner already stands as (record+0x764), lists the three equipped forms
  // plus "Don't set.", and its confirm writes the standing form - the chosen
  // equipped form for the first three rows, 0 (rookie) for the fourth; the
  // cancel arm writes 0 as well. Rows at (0xA7, 0x83+0xE*i), cursor widget at
  // (0x9A, 0x83+0xE*i), hint at (0x14,0xC3). The fold +0xEC is not animated yet
  // because its pivot is not in the read evidence.
  function closeChangePanel() {
    // The original folds the panel away (state 5 starts the shut, state 6 waits
    // for it) before the grid takes input again.
    d.panelLeaving = true;
    d.panelFold = makeFold(CHANGE_PANEL_FOLD_STEPS, false);
  }

  function handleChangePanel(key, sfx = null) {
    const stats = driStatsAt(d.state, d.selectedPartner, d.digimonById);
    const forms = (stats?.equippedForms ?? []).map(Number);
    if (key === "left" || key === "up") {
      if (d.panel.cursor > 0) { d.panel.cursor -= 1; sfx?.play("system00"); }
    } else if (key === "right" || key === "down") {
      if (d.panel.cursor < 3) { d.panel.cursor += 1; sfx?.play("system00"); }
    } else if (key === "circle") {
      const formId = d.panel.cursor < 3 ? (forms[d.panel.cursor] ?? 0) : 0;
      setStandingForm(d.state, d.selectedPartner, formId, d.digimonById);
      persistDriState(d.state);
      sfx?.play("system00");
      closeChangePanel();
    } else if (key === "cross") {
      // The captured cancel arm writes 0 to record+0x764 before folding away.
      setStandingForm(d.state, d.selectedPartner, 0, d.digimonById);
      persistDriState(d.state);
      sfx?.play("system01");
      closeChangePanel();
    }
  }

  d.handleKey = (rawKey, sfx = null) => {
    // Accept either a pad button name from the dispatcher or the raw key it
    // stands for, so a caller (and a test) may use whichever it has.
    const key = asButton(rawKey);
    if (!d._open) return;
    if (d.fadeLeaving) return;
    // The confirm panel folds open before the reserve list takes input, and
    // folds away before the swap lands (F0x8008b798 cases 1-3 / 5-8).
    if (d.screen === "switch_to" && (d._switchLeave || !foldsReady())) return;
    // The digivolve submenu's windows fold open before it takes input, and shut
    // before its child runs (F0x80087600 cases 2-4).
    if (d.screen === "digivolve_menu" && (d._menuLeave || (d.folds && !foldsReady()))) return;
    // The grid folds in before it takes input (fold +0xDC).
    if (d.screen === "change_type" && d.gridFold && !ui.foldComplete(d.gridFold)) return;
    // The change-type grid's message panel owns input while it is up, but only
    // after its fold has opened (F0x80085dd0 state 2 -> 3 -> 4) and not while it
    // folds away.
    if (d.panel) {
      if (d.panelLeaving || (d.panelFold && !ui.foldComplete(d.panelFold))) return;
      handleChangePanel(key, sfx);
      return;
    }
    const confirm = key === "circle";
    const cancel = key === "cross";
    if (d.prompt) {
      if (key === "left" || key === "right") {
        d.prompt.yes = !d.prompt.yes;
        sfx?.play("system02");
      } else if (confirm) {
        if (d.prompt.yes) {
          const stats = driStatsAt(d.state, d.selectedPartner, d.digimonById);
          const record = formLedgerRecord(stats, stats?.digimonId, d.digimonById);
          const result = toggleLedgerTech(record, d.prompt.slot, d.prompt.load);
          if (result === "full") { sfx?.play("system01"); d.feedback = "Load up to 3."; }
          else sfx?.play("system00");
          persistDriState(d.state);
        } else sfx?.play("system01");
        d.prompt = null;
      } else if (cancel) {
        sfx?.play("system01");
        d.prompt = null;
      }
      return;
    }
    if (d.feedback) {
      if (key === "circle" || key === "cross" || key === "triangle") d.feedback = null;
      return;
    }
    const rows = d.screen === "switch_from" || d.screen === "switch_to" ? switchSlots() : roster();
    // Confirm is logical 0x0D and cancel 0x0E (F0x80088b5c; the same pair the
    // shop's decompiled handler reads, shop-system-decompiled.md:497), which are
    // word bits 0x2000 and 0x4000. The Details toggle on the switch lists is
    // logical 0x0C (docs/research/ui/dri-gap-2026-09-02.md C3), word bit 0x1000.
    const prev = d.cursor;

    if (cancel) {
      sfx?.play("system01");
      // The detail object owns Triangle while it is up (F0x8008b798 case 10
      // hides it); the switch cancel only runs once it is closed.
      if (d.details) {
        d.details = false;
        return;
      }
      if (d.screen === "root") {
        startRootFolds(false, sfx);
        requestFade("leave");
      } else if (d.screen === "switch_to") {
        // Cancel folds the panel away with no party write (case 4's 0xE arm).
        d._switchLeave = { kind: "cancel" };
        startSwitchFolds(false, sfx);
      } else if (d.screen === "digivolve_menu") {
        // F0x80087600 case 2's 0xE arm shuts the submenu windows before the back
        // transition (state 4 with unk14=1).
        d._menuLeave = { kind: "cancel" };
        startSubmenuFolds(false, sfx);
      } else back(sfx);
      return;
    }
    if (key === "triangle" && (d.screen === "switch_from" || d.screen === "switch_to")) {
      // The Details toggle (logical 0xC) plays 0x0004001C — F0x8008b798.c:112-116
      // (`unk408(0,0xC)` -> `0x80055C48(0x4001C)` when the highlighted entry is
      // valid). True name SYSTEM07. Corrected 2026-10-14
      // (audit/sfx-triggers-vs-decode): it played the pre-shift "system00".
      d.details = !d.details;
      sfx?.play("system07");
      return;
    }

    if (d.screen === "root") {
      if (key === "up") d.cursor = clampCursor(d.cursor - 1, 3);
      else if (key === "down") d.cursor = clampCursor(d.cursor + 1, 3);
      else if (confirm) {
        sfx?.play("system00");
        d.pendingAction = d.cursor;
        startRootFolds(false, sfx);
        requestFade("action");
        return;
      }
    } else if (d.screen === "switch_from" || d.screen.endsWith("_picker")) {
      if (key === "left" || key === "up")
        d.cursor = (d.cursor - 1 + rows.length) % Math.max(1, rows.length);
      else if (key === "right" || key === "down")
        d.cursor = (d.cursor + 1) % Math.max(1, rows.length);
      else if (confirm && rows.length) {
        // The switch lists' confirm (logical 0xD) plays 0x0004001C when the
        // highlighted entry is valid, and the resident cancel blip 0x800450BD
        // when the gate fails — F0x8008b798.c:117-121 (the else arm of the 0xD
        // test). True names SYSTEM07 / SYSTEM01. Corrected 2026-10-14
        // (audit/sfx-triggers-vs-decode).
        if (d.screen === "switch_from" && !reserve().length) {
          sfx?.play("system01");
          d.feedback = "No Digimon is waiting.";
          return;
        }
        sfx?.play("system07");
        d.selectedPartner = d.cursor;
        if (d.screen === "switch_from") {
          d.switchFrom = d.cursor;
          d.screen = "switch_to";
          d.cursor = 0;
          d.scroll = 0;
          startSwitchFolds(true, sfx);
        } else {
          // Real flow: the digivolve picker leads to the "Select Action"
          // submenu (F0x8008820c) before any list.
          d.screen = d.screen === "digivolve_picker" ? "digivolve_menu" : "chart";
          d.cursor = 0;
          d.scroll = 0;
          d.page = 0;
          if (d.screen === "digivolve_menu") startSubmenuFolds(true, sfx);
        }
        return;
      }
    } else if (d.screen === "switch_to") {
      // This list is the RESERVE, not the party: the original's candidate builder
      // walks the eight roster slots and offers the obtained partners that are not
      // among the three deployed (claim PARTY-C004). Re-ordering the deployed three
      // is the status menu's Sort, not this screen.
      const waiting = reserve();
      if (key === "left" || key === "up")
        d.cursor = (d.cursor - 1 + waiting.length) % Math.max(1, waiting.length);
      else if (key === "right" || key === "down")
        d.cursor = (d.cursor + 1) % Math.max(1, waiting.length);
      else if (confirm && waiting.length) {
        // Same 0xD gate as the "Switch who?" list: valid entry -> 0x0004001C
        // (SYSTEM07). F0x8008b798.c:117-121.
        sfx?.play("system07");
        const incoming = waiting[clampCursor(d.cursor, waiting.length)];
        d._switchLeave = { kind: "confirm", index: d.switchFrom, charId: incoming.charId, name: incoming.name };
        startSwitchFolds(false, sfx);
        return;
      }
    } else if (d.screen === "digivolve_menu") {
      // esdglabo 33/34: "Change digivolve type." / "Load technique."
      if (key === "up") d.cursor = clampCursor(d.cursor - 1, 2);
      else if (key === "down") d.cursor = clampCursor(d.cursor + 1, 2);
      else if (confirm) {
        sfx?.play("system00");
        // F0x80087600 case 2 branches on enumerate_acquired's count
        // (F0x80017898 counts the ledger records with form id >= 3): the grid
        // needs at least four acquired forms (three slots + one to swap in).
        // With fewer, state 0x1E writes string `cursor + 0x24` at (0xA4,0xB8)
        // IN PLACE - the folds do not shut for a refusal. A real pick queues the
        // child and shuts the submenu windows first (case 3 -> case 4).
        const acquired = acquiredDriForms(d.state, d.selectedPartner, d.digimonById);
        if (d.cursor === 0 && acquired.length < 4) {
          d.feedback = "Can't change digivolve.";
          return;
        }
        if (d.cursor === 1 && !acquired.length) {
          d.feedback = "Can't load technique.";
          return;
        }
        d._menuLeave = { kind: "confirm", cursor: d.cursor };
        startSubmenuFolds(false, sfx);
        return;
      }
    } else if (d.screen === "change_type") {
      const pool = changeTypePool();
      const pages = Math.max(1, Math.ceil(pool.length / 10));
      if (key === "l1") d.page = Math.max(0, d.page - 1);
      else if (key === "r1") d.page = Math.min(pages - 1, d.page + 1);
      else if (key === "left") d.cursor = d.cursor % 2 === 0 ? d.cursor : d.cursor - 1;
      else if (key === "right") d.cursor = d.cursor % 2 === 1 ? d.cursor : d.cursor + 1;
      else if (key === "up") d.cursor = Math.max(0, d.cursor - 2);
      else if (key === "down") d.cursor = Math.min(9, d.cursor + 2);
      else if (confirm) {
        const form = pool[d.page * 10 + d.cursor];
        if (!form) return;
        const stats = driStatsAt(d.state, d.selectedPartner, d.digimonById);
        if (form.doNothing) {
          sfx?.play("system00");
          setStandingForm(d.state, d.selectedPartner, 0, d.digimonById);
          persistDriState(d.state);
          return;
        }
        const current = rows[d.selectedPartner]?.profile?.id;
        const slot = firstOpenEquipSlot(stats);
        const result = setEquippedForm(stats, slot, form.profile.id, current);
        if (result === "current") {
          // Picking the form the partner already stands as folds the message
          // panel open (F0x80085dd0 state 2, fold +0xEC, 0xA steps) instead of
          // showing a floating line.
          sfx?.play("system00");
          d.panel = { cursor: 0 };
          d.panelLeaving = false;
          d.panelFold = makeFold(CHANGE_PANEL_FOLD_STEPS, true);
        } else if (result === "duplicate") {
          // The screen scans the triple first and rejects a form already in it
          // (set_equipped claim, 2026-09-13). It must not fall through to the
          // standing-form picker: that is the separate Digivolve row.
          sfx?.play("system01");
        } else {
          sfx?.play("system00");
          persistDriState(d.state);
        }
        return;
      }
    } else if (d.screen === "load_tech") {
      const member = rows[d.selectedPartner];
      const stats = driStatsAt(d.state, d.selectedPartner, d.digimonById);
      const record = formLedgerRecord(stats, member?.profile?.id, d.digimonById);
      const visibleSlots = (record?.techSlots ?? []).map((word, slot) => ({ word: Number(word), slot }))
        .filter(({ word }) => word & 0x1fff);
      if (key === "up") d.cursor = clampCursor(d.cursor - 1, visibleSlots.length);
      else if (key === "down") d.cursor = clampCursor(d.cursor + 1, visibleSlots.length);
      else if (confirm && visibleSlots[d.cursor]) {
        const selected = visibleSlots[d.cursor];
        const word = selected.word;
        // The decoded classification order (technique-loading-decoded.md): a
        // loaded row (0x4000) always offers "Turn load off?" FIRST; only then
        // the signature (0x8000), the not-yet-learned (no 0x2000), the
        // three-loaded cap, and finally "Load?".
        if (word & 0x4000) {
          sfx?.play("system00");
          d.prompt = {
            message: "Turn load off?",
            yes: true,
            slot: selected.slot,
            load: false,
          };
        } else if (word & 0x8000) {
          sfx?.play("system01"); d.feedback = "Cannot load technique.";
        } else if (!(word & 0x2000)) {
          sfx?.play("system01"); d.feedback = "Cannot load technique yet.";
        } else if ((record.techSlots ?? []).filter((w) => w & 0x4000).length >= 3) {
          sfx?.play("system01"); d.feedback = "Load up to 3.";
        } else {
          sfx?.play("system00");
          d.prompt = {
            message: "Load?",
            yes: true,
            slot: selected.slot,
            load: true,
          };
        }
        return;
      }
    } else if (d.screen === "digivolve") {
      const entries = standingChoices(d.state, d.selectedPartner, d.digimonById);
      if (key === "up") moveListCursor(-1, entries.length);
      else if (key === "down") moveListCursor(1, entries.length);
      else if (confirm && entries[d.cursor]) {
        sfx?.play("system00");
        const choice = entries[d.cursor];
        if (setStandingForm(d.state, d.selectedPartner, choice.formId, d.digimonById)) {
          persistDriState(d.state);
        }
        return;
      }
    } else if (d.screen === "chart") {
      // L1/R1 clamp, they do not wrap (F0x800842f4 unkC8 vs unkC4-1).
      if (key === "l1") d.page = Math.max(0, d.page - 1);
      else if (key === "r1") d.page = Math.min(3, d.page + 1);
      else {
        const grid = chartNodeGrid();
        const col = d.cursor % 5;
        const row = Math.floor(d.cursor / 5);
        let nc = col;
        let nr = row;
        if (key === "left") nc = Math.max(0, col - 1);
        else if (key === "right") nc = Math.min(4, col + 1);
        else if (key === "up") nr = Math.max(0, row - 1);
        else if (key === "down") nr = Math.min(3, row + 1);
        if (grid[nr]?.[nc]) d.cursor = nr * 5 + nc;
      }
    }
    // The move cue. The root desk's cursor plays the list blip 0x8004513E
    // (F0x80088b5c.c:169-182; dri-gap-2026-09-02.md B7), while the switch
    // lists' cursors play the stepper blip 0x0004001B (F0x8008b798.c:98-101,
    // the `temp_s4 != arg0->unk60` changed-gate). True names SYSTEM02 /
    // SYSTEM06. Corrected 2026-10-14 (audit/sfx-triggers-vs-decode): the
    // switch lists used to play the root desk's blip.
    if (d.cursor !== prev) {
      const switching = d.screen === "switch_from" || d.screen === "switch_to";
      sfx?.play(switching ? "system06" : "system02");
    }
  };

  // Held-direction repeat on the pad service's accelerating curve. The original
  // screens read BOTH the pressed word and the service's auto-repeat word for a
  // cursor move (F0x8008b798 case 4 reads the pressed bit and the repeat bit for
  // the reserve cursor), so a held direction walks the list instead of moving
  // one row per press. web/input.js already exposes the held Set and
  // padRepeatFires is the decoded edge/16/6/4 ladder (SHARED-INPUT-PAD-REPEAT);
  // the keydown path fires the edge, this fires the repeats.
  d._held = {};
  d._stepHeld = (heldKeys) => {
    if (!heldKeys) return;
    for (const dir of ["up", "down", "left", "right"]) {
      if (heldKeys.has?.(dir)) {
        const n = (d._held[dir] ?? 0) + 1;
        d._held[dir] = n;
        if (n > 1 && padRepeatFires(n) && d._open && !d.fadeLeaving) d.handleKey(dir);
      } else {
        d._held[dir] = 0;
      }
    }
  };

  // The swap itself waits for the shut folds: the original writes the party in
  // F0x8008b798 case 8, after cases 5-7 have folded the panel away.
  function serviceSwitchLeave() {
    if (!d._switchLeave || d.screen !== "switch_to" || !foldsReady()) return;
    const leave = d._switchLeave;
    d._switchLeave = null;
    if (leave.kind === "confirm" && switchInReservePartner(d.state, leave.index, leave.charId, d.digimonById)) {
      d.state.partnerStats.equipBonuses = equipmentBonuses(d.state.equipment?.[0] ?? {});
      persistDriState(d.state);
      d.feedback = `${leave.name} joined the party.`;
    }
    d.switchFrom = null;
    d.screen = "switch_from";
    d.cursor = 0;
    d.scroll = 0;
    d.folds = null;
  }

  // The submenu shuts its windows before the child runs (F0x80087600 cases 3-4).
  function serviceMenuLeave() {
    if (!d._menuLeave || d.screen !== "digivolve_menu" || !foldsReady()) return;
    const leave = d._menuLeave;
    d._menuLeave = null;
    d.folds = null;
    if (leave.kind === "cancel") {
      d.screen = "digivolve_picker";
      d.cursor = d.selectedPartner;
      return;
    }
    if (leave.cursor === 0) {
      d.cursor = 0;
      d.scroll = 0;
      d.page = 0;
      d.screen = "change_type";
      d.gridFold = makeFold(CHANGE_GRID_FOLD_STEPS, true);
    } else {
      d.screen = "load_tech";
      d.cursor = 0;
      d.scroll = 0;
    }
  }

  function serviceChangePanel() {
    if (!d.panelLeaving || !d.panelFold) return;
    if (!ui.foldComplete(d.panelFold)) return;
    d.panelLeaving = false;
    d.panelFold = null;
    d.panel = null;
  }

  d.update = (dt, heldKeys = null) => {
    if (!d._open) return;
    d.time += dt;
    tickFolds();
    if (d.gridFold) ui.tickFold(d.gridFold);
    if (d.panelFold) ui.tickFold(d.panelFold);
    serviceChangePanel();
    serviceSwitchLeave();
    serviceMenuLeave();
    d._stepHeld(heldKeys);
    if (!d.fadeLeaving) return;
    const frames = Math.max(0, Math.floor((d.time - d.fadeT0) / VSYNC_S));
    if (frames * LEAVE_FADE_DELTA >= LEAVE_FADE_MAX) {
      if (d.fadeMode === "action") applyPendingAction();
      else d.close();
    }
  };

  function backdrop(ctx) {
    // Overfill past the native rect on purpose: d.draw() letterboxes to 320x240
    // inside a wider canvas, and the wall has to own the side bars too or the
    // field map shows through them. Clip 0x37 already spans -96..336 natively,
    // so this matches what the static draw did.
    ctx.fillStyle = "rgb(0,0,24)";
    ctx.fillRect(-96, 0, NATIVE_W + 192, 240);
    // disasm: stgdglab backdrop = stdglabo clip 0x37, and it SCROLLS. F0x8008ed0c
    // (exe-decomp/stgdglab_c/F0x8008ed0c.c:35-48) keeps a counter in the state
    // object: +0x58 toggles every vsync and the counter at +0x54 is incremented
    // only when it is set, wrapping to 0 at 0x60 — so +1 every second vsync,
    // range 0..0x5F. The counter is then passed as BOTH x and y of the clip draw
    // (`sp94(pack, 0x37, counter, counter)`), i.e. the wall drifts one pixel
    // right and one pixel down per two vsync and loops every 0x60 px.
    // Clip 0x37 is built for exactly that: 63 tiles of 48x48 from three tile
    // pictures, spanning dx -96..288 / dy -96..192 (432x336) with a whole spare
    // tile past every screen edge, and a 96x96 checker period of [[2,1],[1,0]].
    // Same mechanism, rate and direction as the already-decoded ststat 0x1d /
    // stshop 0x14 fields, so it uses the shared renderer rather than a second
    // implementation.
    drawPackBackdrop(ctx, dglab, 0x37, NATIVE_W, 240, d.time);
  }

  // Tube-sprite animation row for a partner: the resolver record's second
  // field is both the chart-portrait clip AND the 7-frame animation-row index
  // (rows at 0x8008F4C4, indexed via [0x8005CCA0](id)->row in F0x8008ad98 /
  // F0x80089aec; the 8 starter records map exactly onto rows 0..7).
  function animClipFor(digimonId, frame = 0) {
    // A starter reads the ONE shared table through portraits.js; anything else
    // (evolutions, enemies) falls back to the resolver's own clip list, which is
    // indexed by the game's DigimonId and not by our starter ids.
    const starter = starterPortraitClip(digimonId, frame);
    if (starter != null) return starter;
    const row = d.tables?.portrait_animation_clips?.[Number(d.tables?.portrait_clip_by_digimon_id?.[digimonId] ?? -1)];
    const valid = row?.filter((value) => value >= 0) ?? [];
    return valid.length ? valid[frame % valid.length] : null;
  }

  function drawTubeSprite(ctx, member, x, y) {
    // disasm: F0x80089aec — frame steps when vsync delta >= 0xC.
    const frame = Math.floor(d.time / PORTRAIT_PERIOD);
    const clip = animClipFor(member?.profile?.id ?? -1, frame);
    if (clip != null) drawClip(ctx, dglab, clip, x, y);
  }

  function pulse() {
    // CLUT-cycle stand-in: F0x80089aec steps unk10C every 0xA vsync, four rows.
    return (Math.floor(d.time / CLUT_PERIOD) % 4) / 3;
  }

  // The chart draws its cursor and its two pagers through CLUT row `unk28C`,
  // which steps 0 -> 3 every 8 vsync (F0x8008365c). Canvas cannot swap a CLUT
  // row, so this is the same four-step ladder in alpha: the period and the step
  // count are the decoded ones, the colour ramp is the stand-in.
  function chartClut() {
    return (Math.floor(d.time / CHART_CLUT_PERIOD) % 4) / 3;
  }

  // F0x8008e4cc: both scroll arrows are drawn only on the lit half of an
  // 8-vsync toggle, and only when there is list left to reach in that
  // direction (up arrow while the offset is non-zero, down arrow while the
  // offset is short of count - 3).
  function arrowsLit() {
    return Math.floor(d.time / ARROW_BLINK_PERIOD) % 2 === 0;
  }

  // The list scrollbar (F0x8008a6ac). Thumb height is the visible fraction of
  // the track; the last offset pins the thumb to the bottom of the track.
  function drawScrollBar(ctx, count, offset) {
    if (count < LIST_ROWS + 1) return;
    const step = Math.trunc(((SCROLL_BAR_BOTTOM - SCROLL_BAR_TOP) << 8) / count);
    const height = (step * LIST_ROWS) >> 8;
    const bottom = SCROLL_BAR_BOTTOM - height;
    const y = offset < count - 1
      ? Math.min(SCROLL_BAR_TOP + ((offset * step) >> 8), bottom)
      : bottom;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(SCROLL_BAR_X, y, SCROLL_BAR_W, height);
    ctx.restore();
  }

  // F0x8008e018 case 2: the cursor walks the three visible rows first and only
  // then drags the offset, and both ends clamp - this list does not wrap.
  function moveListCursor(delta, count) {
    if (count <= 0) return;
    const row = d.cursor - d.scroll;
    if (delta < 0) {
      if (row > 0) d.cursor -= 1;
      else if (d.scroll > 0) { d.scroll -= 1; d.cursor -= 1; }
      return;
    }
    if (count >= LIST_ROWS) {
      if (row < LIST_ROWS - 1) d.cursor = Math.min(count - 1, d.cursor + 1);
      else if (d.scroll < count - LIST_ROWS) { d.scroll += 1; d.cursor += 1; }
      return;
    }
    d.cursor = Math.min(count - 1, d.cursor + 1);
  }

  function foldPane(ctx, tween, px, py, fn) {
    if (!tween) { fn(); return 1; }
    if (tween.value === 0) return 0;
    const tr = ui.foldTransform(tween, px, py, "x");
    if (tr.progress <= 0) return 0;
    if (tr.ready) { fn(); return 1; }
    ctx.save();
    ctx.translate(tr.pivotX, tr.pivotY);
    ctx.scale(tr.scaleX, tr.scaleY);
    ctx.translate(-tr.pivotX, -tr.pivotY);
    fn();
    ctx.restore();
    return tr.progress;
  }

  function drawPartnerCard(ctx, member, y = 0x13) {
    // disasm: F0x8008ad98 §unk6C / F0x80089aec §unk9C — stdglabo 0x1e@(0,y),
    // cmfont 0xe pedestal@(0,y), animated sprite@(0x10,y+3).
    drawClip(ctx, dglab, 0x1e, 0, y);
    drawClip(ctx, cmfont, 0x0e, 0, y);
    // The Switch list carries an entry per pedestal, and a free pedestal is a
    // placeholder with no partner: draw the empty frame and stop.
    if (!member || member.empty || member.name == null) return;
    drawTubeSprite(ctx, member, 0x10, y + 3);
    drawText(ctx, member.name, 0x33, y + 4);
    drawText(ctx, `LV${fmt(member.level, 2)}`, 0x33, y + 16, { color: "#ffd840" });
    drawText(ctx, `HP${fmt(member.hp, 4)}/${fmt(member.maxHp, 4)}`, 0x33, y + 27, { color: "#ffd840" });
    drawText(ctx, `MP${fmt(member.mp, 4)}/${fmt(member.maxMp, 4)}`, 0x33, y + 38, { color: "#ffd840" });
  }

  // The three-capsule row: cmfont 0x11 = towers (behind the sprites),
  // cmfont 0x10 = glass-glint overlay (front layer), sprites at
  // (0xa5+0x30*i, spriteY), pulsing cursor = cmfont 0xd at (0xa5+0x30*sel, curY).
  // disasm: F0x80089aec mode B (rowY=0x5f base) / F0x8008ad98 §unk9C (rowY=0x25).
  function drawTubeRow(ctx, rows, rowY, spriteY, curY, selected) {
    drawClip(ctx, cmfont, 0x11, 0x90, rowY);
    rows.slice(0, 3).forEach((member, index) => {
      drawTubeSprite(ctx, member, 0xa5 + index * 0x30, spriteY);
    });
    drawClip(ctx, cmfont, 0x10, 0x90, rowY);
    if (selected != null && selected >= 0) {
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * pulse();
      drawClip(ctx, cmfont, 0x0d, 0xa5 + selected * 0x30, curY);
      ctx.restore();
    }
  }

  function drawRoot(ctx) {
    // disasm: F0x80089aec mode A — banner 0x20@(0x92,0xf) pivot (0x140,0x15),
    // menu 0x21@(0x92,0x2a) pivot (0x140,0x45), back 0x24@(0xc6,0xc4)
    // pivot (0x140,0xd2). Labels from F0x80088b5c: header (0xae,0x15),
    // rows (0xa7, 0x31+0xe*i), back string (0xd3,0xcc).
    const bannerP = foldPane(ctx, d.folds?.banner, 0x140, 0x15, () => {
      drawClip(ctx, dglab, 0x20, 0x92, 0x0f);
    });
    if (bannerP >= 1) drawText(ctx, "Select Action", 0xae, 0x15);
    const menuP = foldPane(ctx, d.folds?.menu, 0x140, 0x45, () => {
      drawClip(ctx, dglab, 0x21, 0x92, 0x2a);
    });
    if (menuP >= 1) {
      ROOT_OPTIONS.forEach((label, index) => {
        const y = 0x31 + index * 0x0e;
        if (index === d.cursor) drawText(ctx, "[arrow-right]", 0x9a, y, { kind: 3 });
        drawText(ctx, label, 0xa7, y);
      });
    }
    const footP = foldPane(ctx, d.folds?.footer, 0x140, 0xd2, () => {
      drawClip(ctx, dglab, 0x24, 0xc6, 0xc4);
    });
    if (footP >= 1) drawText(ctx, "[triangle] Button: Back", 0xd3, 0xcc);
  }

  function drawPicker(ctx, rows, banner) {
    // disasm: F0x80089aec mode B — the "Switch who?"/"See whose digivolve?"/
    // "See whose chart?" capsule picker. Header string is esdglabo
    // [unk60+0x18] at (0xae,0x49) (F0x80088b5c). Card@0x13, plate 0x25@(0x8f,0xf),
    // banner 0x20@(0x92,0x43), tube window 0x27@(0x90,0x5f), sprites at
    // (0xa5+0x30*i,0x81), cursor 0xd at (0xa5+0x30*sel,0x65), details plate
    // 0x26@(0,0x4d).
    drawClip(ctx, dglab, 0x25, 0x8f, 0x0f);
    drawText(ctx, "[triangle] Button: Back to Menu", 0xa5, 0x16); // esdglabo idx 6
    drawClip(ctx, dglab, 0x20, 0x92, 0x43);
    drawText(ctx, banner, 0xae, 0x49); // F0x80089358: header widget @(0xAE,0x49)
    drawClip(ctx, dglab, 0x27, 0x90, 0x5f);
    drawTubeRow(ctx, rows, 0x5f, 0x81, 0x65, d.cursor);
    drawPartnerCard(ctx, rows[d.cursor], 0x13);
    return true;
  }

  function drawSwitch(ctx, rows) {
    const from = d.switchFrom ?? d.cursor;
    // The bottom half of "Switch with who?" shows the RESERVE candidate under the
    // cursor; the top capsule row stays the deployed party with the beam on the
    // member being replaced.
    const waiting = d.screen === "switch_to" ? reserve() : [];
    const incoming = waiting[clampCursor(d.cursor, waiting.length)] ?? null;
    if (d.screen !== "switch_to") {
      // s2 "Switch who?" uses the shared capsule picker plus the Details plate.
      drawPicker(ctx, rows, "Switch who?");
      drawClip(ctx, dglab, 0x26, 0, 0x4d);
      drawText(ctx, "[circle] Button: Details", 0x13, 0x54);
      return;
    }
    // s4 "Switch with who?" — disasm: F0x8008ad98. The five fold panes and
    // their pivots are the +0x6C/+0x7C/+0x8C/+0x9C/+0xAC fold objects:
    // +0x6C = outgoing card, pivot (0,0x2F); +0x7C = Details plate, (0,0xD1);
    // +0x8C = banner, (0x140,0x15); +0x9C = the s4 foreground/panel, the C
    // re-pivots its parts (0x140,0x85 then per element); +0xAC = the tube row
    // and pagers, pivoting each slot card at (0xB4+0x30i,0x4E). The canvas
    // groups each pane on one pivot — the same stand-in the DRI already uses
    // for the root panes.
    const folds = d.folds;
    // Back layer: pulsing double arrow 0x3b@(0x33,0x4a), then panel 0x2d@(0x90,0x2a).
    foldPane(ctx, folds?.incoming, 0x140, 0x85, () => {
      ctx.save();
      ctx.globalAlpha = 0.7 + 0.3 * pulse();
      drawClip(ctx, dglab, 0x3b, 0x33, 0x4a);
      ctx.restore();
      drawClip(ctx, dglab, 0x2d, 0x90, 0x2a);
      // Reserve capsule: cmfont 0xc tower @(0xd5,0x92), sprite@(0xd5,0xae), 0xb glint.
      drawClip(ctx, cmfont, 0x0c, 0xd5, 0x92);
      drawTubeSprite(ctx, incoming, 0xd5, 0xae);
      drawClip(ctx, cmfont, 0x0b, 0xd5, 0x92);
    });
    // Top capsule row (no cursor here; the beam highlights the outgoing slot),
    // the numbered 1/2/3 tag strip and the pulsing pagers all ride the +0xAC pane.
    foldPane(ctx, folds?.tubes, 0x140, 0x4e, () => {
      drawTubeRow(ctx, rows, 0x25, 0x47, null, null);
      drawClip(ctx, dglab, 0x33, 0xad, 0x66);
      // Selection beam clip 0x38+slot @(0xa5,0x41) — the pack declares semi=1
      // (additive, honored by drawClip); the CLUT-row pulse is approximated.
      ctx.save();
      ctx.globalAlpha = 0.7 + 0.3 * pulse();
      drawClip(ctx, dglab, 0x38 + Math.min(2, from), 0xa5, 0x41);
      ctx.restore();
      // Reserve pagers 0x31/0x32 @(0xb8/0x100,0xb6), pulsing.
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * pulse();
      drawClip(ctx, dglab, 0x31, 0xb8, 0xb6);
      drawClip(ctx, dglab, 0x32, 0x100, 0xb6);
      ctx.restore();
    });
    // Banner plate 0x20@(0x92,0xf) + header text.
    foldPane(ctx, folds?.banner, 0x140, 0x15, () => {
      drawClip(ctx, dglab, 0x20, 0x92, 0x0f);
      drawText(ctx, "Switch with who?", 0xae, 0x15);
    });
    // Outgoing (top card, y=0x13) and incoming (bottom card, y=0x8d = 0x7a+0x13).
    foldPane(ctx, folds?.topCard, 0, 0x2f, () => drawPartnerCard(ctx, rows[from], 0x13));
    foldPane(ctx, folds?.incoming, 0x140, 0x85, () => drawPartnerCard(ctx, incoming, 0x8d));
    // Details plate 0x26@(0,0xc4).
    foldPane(ctx, folds?.details, 0, 0xd1, () => {
      drawClip(ctx, dglab, 0x26, 0, 0xc4);
      drawText(ctx, "[circle] Button: Details", 0x13, 0xcb);
    });
  }

  function statValue(member, key) {
    const stored = member?.stats?.stats?.[key];
    if (stored != null) return stored;
    if (STAT_KEYS.includes(key)) return member?.profile?.[key] ?? 0;
    // The seven element values are the F0x80017174 scratch halfwords: the
    // species base plus every trained point, read through the one shared helper.
    return elementValue(member?.profile, member?.stats?.elemBonuses, key);
  }

  // The Switch/picker Details view. Circle creates the F0x8008E8D0 detail object
  // (F0x8008eabc; F0x80088b5c sets unk14=2) whose render F0x8008e4cc is the same
  // panel as the "digivolve" screen, so both share drawDetailPanel. The list is
  // the partner's equipped triple (deployed member or reserve candidate).
  function detailEntries(member) {
    if (!member || member.empty || member.name == null) return [];
    if (member.index != null && member.index < (d.state.party ?? []).length)
      return standingChoices(d.state, member.index, d.digimonById);
    return standingChoicesFromStats(member.stats, member.starter ?? member.profile, d.digimonById);
  }

  function drawDetailView(ctx, member) {
    const entries = detailEntries(member);
    drawPartnerCard(ctx, member, 0x13);
    drawDetailPanel(ctx, member, entries, 0, 0);
  }

  // The digivolve "Select Action" submenu — disasm: F0x8008820c (windows) +
  // F0x80087070 (widgets). Left: partner card + the stat detail panel
  // (stdglabo 0x1f + cmfont 0xf glyph columns @(0,0x4b); 6 core values
  // right-aligned at 0x32, 7 element values at 0x5b, rows 0x4f+0xe*i).
  // Right: loaded-technique window 0x22@(0x92,0xf) with 3 slot rows
  // (0xa7, 0x16+0xe*i), banner 0x20@(0x92,0x51) + "Select Action"@(0xae,0x57),
  // option window 0x23@(0x92,0x6c) with rows (0xa7, 0x73+0xe*i) and the
  // cursor at 0x9a, back plate 0x25@(0x92,0xb0).
  function drawDigivolveMenu(ctx, rows) {
    const member = rows[d.selectedPartner];
    drawPartnerCard(ctx, member, 0x13);
    // F0x8008820c: each pane draws through the sp9C/spA4 tween pair, so the
    // submenu's own windows fold like the root Select Action (pivots are the
    // spA4 immediates). Text rides the pane and only appears once it lands.
    // Left stat panel: clip 0x1F + cmfont 0x0F at (0,0x4B), pivot (0,0x7F).
    const statP = foldPane(ctx, d.folds?.stat, 0, 0x7f, () => {
      // Disasm order draws cmfont 0xf before 0x1f = glyphs in FRONT (later
      // sp94 renders behind); canvas is painter's order, so panel first.
      drawClip(ctx, dglab, 0x1f, 0, 0x4b);
      drawClip(ctx, cmfont, 0x0f, 0, 0x4b);
    });
    if (statP >= 1) {
      STAT_KEYS.forEach((key, index) => {
        drawText(ctx, String(statValue(member, key)), 0x32, 0x4f + index * 0x0e, { alignRight: true });
      });
      ELEM_KEYS.forEach((key, index) => {
        drawText(ctx, String(statValue(member, key)), 0x5b, 0x4f + index * 0x0e, { alignRight: true });
      });
    }
    // Loaded-tech window 0x22@(0x92,0xF), pivot (0x140,0x2A).
    const techP = foldPane(ctx, d.folds?.tech, 0x140, 0x2a,
      () => drawClip(ctx, dglab, 0x22, 0x92, 0x0f));
    if (techP >= 1) {
      const currentRecord = formLedgerRecord(member?.stats, member?.profile?.id, d.digimonById);
      const loaded = (currentRecord?.techSlots ?? []).filter((word) => word & 0x4000)
        .map((word) => d.skillsById[Number(word) & 0x1fff]).filter(Boolean);
      for (let slot = 0; slot < 3; slot += 1) {
        const y = 0x16 + slot * 0x0e;
        if (loaded[slot]) drawText(ctx, loaded[slot].name, 0xa7, y);
        else if (slot === loaded.length) drawText(ctx, "-----", 0xa7, y); // esdglabo idx 18
      }
    }
    // Banner 0x20@(0x92,0x51) + "Select Action"@(0xAE,0x57), pivot (0x140,0x5C).
    const bannerP = foldPane(ctx, d.folds?.banner, 0x140, 0x5c,
      () => drawClip(ctx, dglab, 0x20, 0x92, 0x51));
    if (bannerP >= 1) drawText(ctx, "Select Action", 0xae, 0x57);
    // Option window 0x23@(0x92,0x6C), pivot (0x140,0x87).
    const optP = foldPane(ctx, d.folds?.options, 0x140, 0x87,
      () => drawClip(ctx, dglab, 0x23, 0x92, 0x6c));
    if (optP >= 1) {
      ["Change digivolve type.", "Load technique."].forEach((label, index) => {
        const y = 0x73 + index * 0x0e;
        if (index === d.cursor) drawText(ctx, "[arrow-right]", 0x9a, y, { kind: 3 });
        drawText(ctx, label, 0xa7, y);
      });
    }
    // Back plate 0x25@(0x92,0xB0), pivot (0x140,0xBE). The original installs a
    // second object (+0xA4, 8 steps) that draws the same plate; it is kept in
    // the fold set for the input gate but drawn once here.
    const backP = foldPane(ctx, d.folds?.back, 0x140, 0xbe,
      () => drawClip(ctx, dglab, 0x25, 0x92, 0xb0));
    if (backP >= 1) drawText(ctx, "[triangle] Button: Back", 0xa8, 0xb7);
  }

  // "Choose a technique." — reuses the list window chrome; each row is the
  // tech name, MP cost right-aligned, and the "Load" tag (esdglabo idx 17)
  // on already-loaded rows.
  function drawLoadTech(ctx, rows) {
    const member = rows[d.selectedPartner];
    const stats = member?.stats ?? {};
    const record = formLedgerRecord(stats, member?.profile?.id, d.digimonById);
    const techs = (record?.techSlots ?? []).map((word, slot) => ({
      word: Number(word), slot, skill: d.skillsById[Number(word) & 0x1fff],
    })).filter((row) => row.skill);
    drawPartnerCard(ctx, member, 0x13);
    drawClip(ctx, dglab, 0x20, 0x92, 0x0f);
    drawText(ctx, "Choose a technique.", 0xae, 0x15);
    drawClip(ctx, dglab, 0x21, 0x92, 0x2a);
    const top = Math.max(0, Math.min(d.cursor - 2, techs.length - 3));
    techs.slice(top, top + 3).forEach((row, index) => {
      const skill = row.skill;
      const y = 0x31 + index * 0x0e;
      if (top + index === d.cursor) drawText(ctx, "[arrow-right]", 0x9a, y, { kind: 3 });
      drawText(ctx, skill.name, 0xa7, y);
      drawText(ctx, `MP${String(skill.mp_cost ?? 0).padStart(3, " ")}`, 0x10a, y);
      if (row.word & 0x4000) drawText(ctx, "Load", 0x12c, y, { color: "#ffd840" });
    });
    if (Math.floor(d.time * 4) % 2 === 0) {
      if (top > 0) drawClip(ctx, dglab, 0x34, 0x123, 0x2d);
      if (top + 3 < techs.length) drawClip(ctx, dglab, 0x35, 0x123, 0x55);
    }
  }

  // The decoded partner-detail panel, shared by the "{name} digivolve" screen and
  // the Switch/picker Details view. Both render through F0x8008e4cc: banner
  // 0x20@(0x92,0x0F) + header (0xAE,0x15), list window 0x22@(0x92,0x2A) with rows
  // (0xA7, 0x31+0xE*i) and 8-vsync blink arrows 0x34/0x35@(0x123,0x2D/0x55), the
  // thumb, stat panel 0x2A@(0x54,0x64), glyph column cmfont 0x14@(0x5B,0x7F), and
  // the value/tech widgets from F0x8008d7cc/F0x8008d9bc: name (0x5B,0x6A),
  // "Skill LV" (0xEB/0x12D,0x6A), six core (0x7D,0x7F+0xE*i), seven elements
  // (0xA7, 0x7F+0xE*i), six tech icons (0xB4,0x8B+0xE*i) + names (0xC2,0x8B+0xE*i).
  function drawDetailPanel(ctx, member, entries, cursor, scroll) {
    const entry = entries[cursor];
    const target = entry?.doNothing ? member?.profile : (entry?.profile ?? member?.profile);
    drawClip(ctx, dglab, 0x20, 0x92, 0x0f);
    drawText(ctx, "Choose a digivolve.", 0xae, 0x15);
    drawClip(ctx, dglab, 0x22, 0x92, 0x2a);
    if (!entries.length) drawText(ctx, "Cannot digivolve.", 0xa7, 0x31);
    const top = Math.max(0, Math.min(scroll, Math.max(0, entries.length - LIST_ROWS)));
    entries.slice(top, top + LIST_ROWS).forEach((candidate, index) => {
      const y = 0x31 + index * 0x0e;
      if (top + index === cursor) drawText(ctx, "[arrow-right]", 0x9a, y, { kind: 3 });
      drawText(ctx, candidate.doNothing ? "Do nothing." : (candidate.profile?.name ?? ""), 0xa7, y);
    });
    if (arrowsLit()) {
      if (top > 0) drawClip(ctx, dglab, 0x34, 0x123, 0x2d);
      if (top < entries.length - LIST_ROWS) drawClip(ctx, dglab, 0x35, 0x123, 0x55);
    }
    drawScrollBar(ctx, entries.length, top);
    // Numeric widgets are right-aligned at their anchor x (F0x8008d7cc anchors
    // 0x7d/0xa7/0x12d only fit the panel right-aligned). disasm: F0x8008d9bc
    // line ~99-108 — the "Skill LV" value widget is fed byte +0x2 of the ledger
    // record fetched by ctx+0x2748 ledger_read(slot, formId), the ledger's form
    // ("Skill") level, not the roster's battle level.
    drawClip(ctx, dglab, 0x2a, 0x54, 0x64);
    drawClip(ctx, cmfont, 0x14, 0x5b, 0x7f);
    drawText(ctx, target?.name ?? "", 0x5b, 0x6a);
    drawText(ctx, "Skill LV", 0xeb, 0x6a);
    const skillLv = formLedgerRecord(member?.stats, target?.id, d.digimonById)?.formLevel ?? 1;
    drawText(ctx, String(skillLv), 0x12d, 0x6a, { alignRight: true });
    STAT_KEYS.forEach((key, index) => {
      const y = 0x7f + index * 0x0e;
      drawText(ctx, String(statValue({ ...member, profile: target }, key)), 0x7d, y, { alignRight: true });
    });
    // Element glyphs come from cmfont 0x14's second column (dx=42 -> x=0x85);
    // only the values are text widgets (0xa7, 0x7f+0xe*i) [F0x8008d7cc].
    ELEM_KEYS.forEach((key, index) => {
      const y = 0x7f + index * 0x0e;
      drawText(ctx, String(statValue({ ...member, profile: target }, key)), 0xa7, y, { alignRight: true });
    });
    // disasm: F0x8008e4cc line ~59 — the tech row icon is cmfont clip
    // `Unknown3[(tech&0x1fff)-1].f2 (+0x04) + 0x37`, drawn directly (no extra box
    // call): f2 is the extracted "category" field (fight_tech_table.json) and
    // clips 0x39-0x3d are self-contained gem-in-a-beveled-box glyphs.
    const techs = (target?.techs ?? []).map((id) => d.skillsById[id]).filter(Boolean);
    techs.slice(0, 6).forEach((skill, index) => {
      const y = 0x8b + index * 0x0e;
      const category = d.techTable?.[skill.id]?.category;
      if (category != null) drawClip(ctx, cmfont, 0x37 + category, 0xb4, y);
      else drawIconGlyph(ctx, skill.element ?? "fire", 0xb4, y); // fallback: category not extracted
      drawText(ctx, skill.name ?? `Skill ${skill.id}`, 0xc2, y);
    });
  }

  function drawDigivolve(ctx, rows) {
    const member = rows[d.selectedPartner];
    const entries = standingChoices(d.state, d.selectedPartner, d.digimonById);
    drawPartnerCard(ctx, member, 0x13);
    drawDetailPanel(ctx, member, entries, d.cursor, d.scroll);
  }

  function drawChangeType(ctx, rows) {
    const member = rows[d.selectedPartner];
    const pool = changeTypePool();
    const top = d.page * 10;
    const pageRows = pool.slice(top, top + 10);
    const highlighted = pageRows[d.cursor];
    const target = highlighted?.doNothing ? member?.profile : (highlighted?.profile ?? member?.profile);
    // F0x80085470: ten cells, x = (col*0x85)+0x27, y = (row*0xE)+0x16; the cell
    // frames (clip 0x3E) sit at x-0xF and are drawn only once the entry fold
    // (+0xDC, pivot (0x140,0x37)) has landed.
    foldPane(ctx, d.gridFold, 0x140, 0x37, () => {
      pageRows.forEach((entry, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = 0x27 + col * 0x85;
        const y = 0x16 + row * 0x0e;
        if (!entry.doNothing) drawClip(ctx, dglab, 0x3e, x - 0xf, y);
        if (index === d.cursor) drawText(ctx, "[arrow-right]", x - 0xd, y, { kind: 3 });
        drawText(ctx, entry.doNothing ? "Do nothing." : (entry.profile?.name ?? ""), x, y);
      });
    });
    drawClip(ctx, dglab, 0x2a, 0x54, 0x64);
    drawClip(ctx, cmfont, 0x14, 0x5b, 0x7f);
    drawText(ctx, target?.name ?? "", 0x5b, 0x6a);
    drawText(ctx, "Skill LV", 0xeb, 0x6a);
    const skillLv = formLedgerRecord(member?.stats, target?.id, d.digimonById)?.formLevel ?? 1;
    drawText(ctx, String(skillLv), 0x12d, 0x6a, { alignRight: true });
    STAT_KEYS.forEach((key, index) => {
      const y = 0x7f + index * 0x0e;
      drawText(ctx, String(statValue({ ...member, profile: target }, key)), 0x7d, y, { alignRight: true });
    });
    ELEM_KEYS.forEach((key, index) => {
      const y = 0x7f + index * 0x0e;
      drawText(ctx, String(statValue({ ...member, profile: target }, key)), 0xa7, y, { alignRight: true });
    });
    // The message panel (F0x80085dd0 state 4 / F0x80085470 widgets): four rows
    // at (0xA7, 0x83+0xE*i) — the three equipped forms then "Don't set." — the
    // row cursor at (0x9A, 0x83+0xE*cursor), and the hint at (0x14,0xC3).
    if (d.panel) {
      const fold = d.panelFold;
      if (!fold || fold.value > 0) {
        // The two panel plates, each on its own decoded pivot (F0x80085dd0 draw
        // tail: clip 0x2C at (0x95,0x7C) pivot (0x140,0x9D); clip 0x2B at
        // (0,0xBF) pivot (0,0xD0)).
        foldPane(ctx, fold, 0x140, 0x9d, () => drawClip(ctx, dglab, 0x2c, 0x95, 0x7c));
        foldPane(ctx, fold, 0, 0xd0, () => drawClip(ctx, dglab, 0x2b, 0, 0xbf));
        const stats = driStatsAt(d.state, d.selectedPartner, d.digimonById);
        const forms = (stats?.equippedForms ?? []).map(Number);
        for (let i = 0; i < 4; i++) {
          const y = 0x83 + i * 0x0e;
          const label = i < 3 ? (d.digimonById[forms[i]]?.name ?? "") : "Don't set.";
          drawText(ctx, label, 0xa7, y);
        }
        drawText(ctx, "[arrow-right]", 0x9a, 0x83 + d.panel.cursor * 0x0e, { kind: 3 });
        const hint = "Battle Digivolve is turned off,\nPlease select Battle Digivolve.";
        hint.split("\n").forEach((line, index) => drawText(ctx, line, 0x14, 0xc3 + index * 0x0e));
      }
    }
  }

  function drawChart(ctx, rows) {
    const member = rows[d.selectedPartner];
    const starter = driStarterAt(d.state, d.selectedPartner, d.digimonById);
    const grid = chartNodeGrid();
    drawClip(ctx, dglab, 0x44, 0, 0x11);
    drawText(ctx, `${starter?.name ?? "Digimon"} digivolve`, 0x14, 0x19);
    drawClip(ctx, dglab, 0x43, 0xf0, 0x11);
    // F0x800842f4: page number @(0xFF,0x19) with +0x148(1) = right-align,
    // "/4" (esdglabo 0x28) @(0x101,0x19).
    drawText(ctx, String(d.page + 1), 0xff, 0x19, { alignRight: true });
    drawText(ctx, "/4", 0x101, 0x19);
    const rootClip = Number(d.tables?.portrait_clip_by_digimon_id?.[starter?.id] ?? 0);
    const curRow = Math.floor(d.cursor / 5);
    const curCol = d.cursor % 5;

    // The real chart grid is BUILT from the currently-unlocked forms
    // (F0x80083334/F0x800835cc) and the renderer then draws every node it
    // holds. Mirror that: filter the extracted (fully-populated) layout to
    // the unlocked set BEFORE the draw scan, so connectors never point at
    // absent nodes.
    // disasm: F0x8008365c. Left vertical spine 0x3c@(0x3d, 0x3f+i*0x2e),
    // unkCC-1 segments (unkCC = populated row count), then starter frame
    // 0x3d@(0x14,0x32) and connector stub 0x40@(0x24,0x32).
    // unkCC = F0x80083550, the number of rows the page actually built, and
    // the spine draws unkCC-1 segments below the starter frame.
    const builtRows = grid.reduce((count, nodes) => (nodes.some(Boolean) ? count + 1 : count), 0);
    for (let i = 0; i < builtRows - 1; i += 1)
      drawClip(ctx, dglab, 0x3c, 0x3d, 0x3f + i * 0x2e);
    drawClip(ctx, dglab, 0x3d, 0x14, 0x32);
    drawClip(ctx, dglab, 0x40, 0x24, 0x32);
    drawClip(ctx, chartPortraits, rootClip, 0x14, 0x32);
    // A page that built no row is not an empty grid: F0x8008365c takes its
    // other arm and draws the lone frame 0x3f plus plate 0x49 at the first
    // cell, and nothing else. Clip 0x49 never appears on a page that has
    // something to show.
    if (builtRows === 0) {
      drawClip(ctx, dglab, 0x3f, 0x4a, 0x32);
      drawClip(ctx, dglab, 0x49, 0x4a, 0x32);
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * chartClut();
      if (d.page > 0) drawClip(ctx, dglab, 0x45, 0x17, 0xc9);
      if (d.page < 3) drawClip(ctx, dglab, 0x46, 0x110, 0xc9);
      ctx.restore();
      if (d.page > 0) drawText(ctx, "L1", 0x27, 0xc4);
      if (d.page < 3) drawText(ctx, "R1", 0x115, 0xc4);
      return;
    }

    // Cursor-hover detail box (F0x8008365c unk248 branch): drawn ONLY while
    // the cursor sits on a populated node, showing THAT node's portrait —
    // plate 0x42@(0,0xa8)+portrait@(0x14,0xaf) while the cursor is on rows
    // 0-1, else 0x42@(0,0x32)+portrait@(0x14,0x39).
    const hovered = grid[curRow]?.[curCol];
    if (hovered) {
      if (curRow < 2) {
        drawClip(ctx, dglab, 0x42, 0, 0xa8);
        drawClip(ctx, chartPortraits, hovered.portrait_clip, 0x14, 0xaf);
      } else {
        drawClip(ctx, dglab, 0x42, 0, 0x32);
        drawClip(ctx, chartPortraits, hovered.portrait_clip, 0x14, 0x39);
      }
    }

    // Node/connector pass: per row, scan columns right-to-left from x=0xea.
    // A present node draws frame 0x3f; once one has been seen, every empty
    // cell to its left draws connector piece 0x40 (the elbow line back to the
    // spine). Portraits go on top at the same cell.
    const cellX = (col) => 0x4a + col * 0x28;
    const cellY = (row) => 0x32 + row * 0x2e;
    grid.forEach((nodes, row) => {
      let seenNode = false;
      for (let col = 4; col >= 0; col -= 1) {
        const node = nodes[col];
        if (node) {
          drawClip(ctx, dglab, 0x3f, cellX(col), cellY(row));
          seenNode = true;
        } else if (seenNode) {
          drawClip(ctx, dglab, 0x40, cellX(col), cellY(row));
        }
        if (node) drawClip(ctx, chartPortraits, node.portrait_clip, cellX(col), cellY(row));
      }
    });

    // Pulsing cursor frame 0x47 at the grid cell (free 5x4 cursor).
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * chartClut();
    drawClip(ctx, dglab, 0x47, cellX(curCol), cellY(curRow));
    ctx.restore();

    // L1/R1 pagers 0x45@(0x17,0xc9) / 0x46@(0x110,0xc9), pulsing.
    // Labels: F0x800842f4 constructs "L1" @(0x27,0xC4) / "R1" @(0x115,0xC4)
    // (esdglabo 0x29/0x2A); +0x144 hides L1 on page 0 and R1 on the last page.
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * chartClut();
    if (d.page > 0) drawClip(ctx, dglab, 0x45, 0x17, 0xc9);
    if (d.page < 3) drawClip(ctx, dglab, 0x46, 0x110, 0xc9);
    ctx.restore();
    if (d.page > 0) drawText(ctx, "L1", 0x27, 0xc4);
    if (d.page < 3) drawText(ctx, "R1", 0x115, 0xc4);
  }

  function drawFeedback(ctx) {
    const line = d.prompt
      ? `${d.prompt.message}  ${d.prompt.yes ? "[arrow-right]Yes  No" : "Yes  [arrow-right]No"}`
      : d.feedback;
    if (!line) return;
    drawClip(ctx, dglab, 0x2b, 0, 0xbf);
    drawText(ctx, line, 0x18, 0xca);
  }

  d.draw = (ctx, viewW, viewH) => {
    if (!d._open) return;
    const scale = Math.min(viewW / NATIVE_W, viewH / 240);
    ctx.save();
    ctx.translate((viewW - NATIVE_W * scale) / 2, 0);
    ctx.scale(scale, scale);
    backdrop(ctx);
    const rows = d.screen === "switch_from" || d.screen === "switch_to" ? switchSlots() : roster();
    if (d.screen === "root") drawRoot(ctx);
    else if (d.screen === "digivolve_picker") drawPicker(ctx, rows, "See whose digivolve?");
    else if (d.screen === "chart_picker") drawPicker(ctx, rows, "See whose chart?");
    else if (d.screen === "switch_from" || d.screen === "switch_to") {
      // Circle opens the decoded detail view (F0x8008E8D0) in place of the list.
      const waiting = d.screen === "switch_to" ? reserve() : [];
      const detailMember = d.screen === "switch_to"
        ? (waiting[clampCursor(d.cursor, waiting.length)] ?? null)
        : (rows[d.cursor] ?? null);
      if (d.details && detailMember && detailMember.name != null) drawDetailView(ctx, detailMember);
      else drawSwitch(ctx, rows);
    }
    else if (d.screen === "digivolve_menu") drawDigivolveMenu(ctx, rows);
    else if (d.screen === "load_tech") drawLoadTech(ctx, rows);
    else if (d.screen === "change_type") drawChangeType(ctx, rows);
    else if (d.screen === "digivolve") drawDigivolve(ctx, rows);
    else if (d.screen === "chart") drawChart(ctx, rows);
    drawFeedback(ctx);
    if (d.fadeLeaving) {
      const frames = Math.max(0, Math.floor((d.time - d.fadeT0) / VSYNC_S));
      const a = Math.min(255, (frames * LEAVE_FADE_DELTA) >> 8) / 255;
      paintScreenDim(ctx, a * 255, NATIVE_W, 240);
    }
    ctx.restore();
  };

  return d;
}
