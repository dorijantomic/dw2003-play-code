import { createStatusBackdrop } from "../status-backdrop.js";
import {
  ui,
  listItemIds,
  heldCount,
  fieldTechniqueRows,
  HEAL_SCALE_STAT,
  useFieldTechnique,
  ITEM_BY_ID,
  useItem,
  itemUsableInField,
  isPartyWide,
  unequipItem,
  equipItem,
  commitEquipSlot,
} from "../vendor/engine.js";
import { digivolveDemoOn, setDigivolveDemo } from "../blast-presentation.js";
import { CHARID_TO_DIGID, baseStatsFor, partyRosterView } from "../party.js";
import { asButton } from "../input.js";
import * as uiC from "../ui-c/index.js";
import { composeDemo } from "../ui-c/screens.js";
import { partHook } from "../ui-c/capture.js";
import { drawText, textWidth } from "../uifont.js";
import { paintScreenDim } from "../screendim.js";
import {
  CARD_FOLDERS,
  CARD_FOLDER_FADE_DELTA,
  CARD_FOLDER_FADE_MAX,
  DEMO_SETUP_HINT,
  DEMO_SETUP_LABEL,
  EQUIP_SLOT_KEYS,
  ITEM_CATS,
  ITEM_CAT_EMPTY,
  NATIVE_W,
  SORT_HEADERS,
  VSYNC,
  bagCursorStep,
  mapHoldSpeed,
  mapUnavailable,
  topItems,
} from "./pure.js";
import {
  ITEM_CAT_KINDS,
  clampIndex,
  ensureEquipment,
  equipPickOptions,
  formTechSlots,
  isCurrentForm,
  moveCursor,
  ownTechSlots,
  swapFormation,
  syncEquipBonuses,
  useMessage,
} from "./logic.js";
import { MS } from "./state.js";
import { _drawMapPane, _drawTechniques, _mapMove, _stepHeldLists } from "./draw-map.js";
import {
  _drawCardFolder,
  _drawDemoSetup,
  _drawFooter,
  _drawHeader,
  _drawHome,
  _drawHomeBit,
  _drawSidebar,
  _drawSwapBracket,
} from "./draw-common.js";
import { _drawEquip, _drawItems } from "./draw-items.js";
import { _drawDetail, _drawSeeDigivolve } from "./draw-digivolve.js";
import type { MenuState } from "./types.js";

import type { GameState } from "../game/types.js";
import type { RosterMember, DigimonRecord } from '../types/battle.js';
interface RosterViewEntry extends RosterMember {
  profile?: DigimonRecord;
}

export function createMenu(sfx = null) {
  const backdrop = createStatusBackdrop();
  const m = {
    // top-level list cursor / drilled-in screen
    mainCursor: 0,
    cardFolderCursor: 0,
    screen: "home", // "home" | "items" | "sort" | "map" | "techniques-pick" |
                     // "techniques-list" | "status-list" | "status-detail"
    // First START draws the resident list over the live field. Entering any
    // overlay screen (ITEMS/SORT/…) keeps the diamond room when you come back.
    // Rig: docs/research/ui/captures/pause-field-home-2026-08-20.png vs
    // pause-overlay-home-2026-08-20.png.
    fieldHome: true,
    itemCursor: 0,
    itemMode: "cats", // "cats" | "list" | "sort" | "use_target"
    itemCat: 0,     // category row on "Which one?", then the bag filter
    itemTarget: 0,  // "Use it on who?" party index
    sortPick: null, // formation change: first picked slot ("Switch who?")
    statusCursor: 0,   // party index while choosing a Digimon (status-list / techniques-pick)
    detailIdx: 0,      // party index being viewed (status-detail)
    detailFocus: 0,    // 0 = digivolve, 1 = equipment (the two-row detail prompt)
    // "prompt" = the See Digivolve / See Equipment rows; "digivolve" = inside
    // the digivolve list. Equipment leaves for the full equip screen.
    detailStep: "prompt",
    demoCursor: 0,    // Digivolve Demo screen: 0 = ON, 1 = OFF
    dvAction: 0,      // 0 = Battle Digivolve On/Off, 1 = Techique Explanation
    // See Digivolve: the cursor's HOME is beside the partner's name, not on a
    // candidate (F0x80089bf0 state 4 gates on unk6C).
    dvHome: true,
    dvMessage: null,  // "Turned on/off Battle Digivolve", shown on the footer
    dvBackStep: "dvaction",  // where "Choose a technique" came from
    techInfoSel: 0,   // slot 0..5 inside "Choose a technique"
    detailSel: 0,
    techCursor: 0,
    // full EQUIP screen (F0x80086dd4): slot cursor / bag-list cursor+scroll
    equipFocus: "slots", // "slots" | "list"
    equipCursor: 0,
    equipListCursor: 0,
    equipScroll: 0,
    fadeLeaving: false,
    fadeT0: 0,
    fadePending: null,
    // The MAP page's "have I been here" reader, supplied by the host: (flagId) => set?
    // over the engine's banked store, which is where the field entry writes.
    mapSeen: null,
    // Where the Digivolve Demo screen's Back goes. No such screen is reachable
    // from the original's pause list (ledger
    // UI-DEMO-SETUP-SCREEN-HAS-NO-SELECTOR-WRITE-2026-08-14), so the host owns
    // the answer: web/game.js points this at the one pause home.
    backToHome: () => { m.screen = "home"; },
    // TECHNIQUES: null, or "use_target" while the "Use it on who?" prompt is up
    techMode: null,
    techTarget: 0,
    feedbackMsg: null,
    feedbackTimer: 0,
    digimonDB: null,
    skillDB: null,
  } as MenuState;

  // ── window fold animation (decoded tween F0x80099d5c / F0x80099df0) ────
  // Opening ramps the window's scale 0 -> 0x1000 over the slot's `steps` and
  // plays SYSTEM03; CLOSING ramps 0x1000 -> 0 at DOUBLE the step and plays
  // SYSTEM04. Every window in the pause menu is installed with steps = 0xA,
  // so a window takes 10 frames to open and 5 to shut. A screen never jumps:
  // each state waits for the fold it started before starting the next, which
  // is what `_after` below reproduces.
  const ANIM_T = 10 / VSYNC;
  m._anim = {};       // key -> {t0, dir}; missing = never animated, i.e. open
  m._sfxPlayed = {};
  m._foldOpen = (...keys) => {
    for (const k of keys) { m._anim![k] = { t0: m.time ?? 0, dir: 1 }; delete m._sfxPlayed![k]; }
  };
  m._foldClose = (...keys) => {
    for (const k of keys) { m._anim![k] = { t0: m.time ?? 0, dir: 0 }; delete m._sfxPlayed![k]; }
  };
  // Forget a window entirely: the next draw shows it fully open with no sound.
  m._foldForget = (...keys) => {
    for (const k of keys) { delete m._anim![k]; delete m._sfxPlayed![k]; }
  };
  // Put a window in the SHUT state without animating or sounding it — the
  // state a screen's windows are in before its constructor has opened them.
  m._foldShut = (...keys) => {
    for (const k of keys) { m._anim![k] = { t0: -1e9, dir: 0 }; m._sfxPlayed![k] = 1; }
  };
  // Start an open at a fixed delay. Kept for the screens whose original
  // sequence is a plain chain of equal-length folds, where a delay and a
  // wait-for-previous are the same thing.
  m._animStart = (delay, ...keys) => {
    for (const k of keys) { m._anim![k] = { t0: (m.time ?? 0) + delay, dir: 1 }; delete m._sfxPlayed![k]; }
  };
  // The transform, from the shared fold class (engine/dw3/ui/fold-tween.ts)
  // rather than a formula local to this screen.
  m._foldTr = (key, px, py, axis) => {
    const a = m._anim![key];
    if (!a) return ui.foldTransformAtTime(0, null, px, py, axis, ANIM_T);
    return a.dir
      ? ui.foldTransformAtTime(m.time ?? 0, a.t0, px, py, axis, ANIM_T)
      : ui.foldCloseTransformAtTime(m.time ?? 0, a.t0, px, py, axis, ANIM_T);
  };
  m._animP = (key) => m._foldTr!(key, 0, 0, "x").progress;
  // The boolean the original's states branch on: window_fold_tick() != 0,
  // true once the fold has LANDED, in whichever direction it was going.
  m._foldReady = (key) => m._foldTr!(key, 0, 0, "x").ready;

  // ── the screens' own choreography ──────────────────────────────────────
  // Each pause-menu screen is a small state machine that starts a fold, waits
  // for it, then starts the next. `_after(keys, fn)` queues one such step.
  m._seq = [];
  m._after = (keys, run) => { m._seq!.push({ wait: keys, run }); };
  m._seqClear = () => { m._seq!.length = 0; };
  m._runSeq = () => {
    let guard = 0;
    while (m._seq!.length && guard++ < 32) {
      const step = m._seq![0];
      if (!step!.wait.every((k) => (k === "slide" ? m._slideReady!() : m._foldReady!(k)))) break;
      m._seq!.shift();
      step!.run();
    }
  };

  // ── the panel slide (decoded tween F0x80099e5c: linear, N vsyncs) ───────
  // See Digivolve slides its whole lower panel 34 px up over 4 frames to make
  // room for the technique explanation, and back down on the way out.
  const SLIDE_STEPS = 4;
  m._slide = null;    // {t0, from, to}
  m._slideY = 0;
  m._slideStart = (from, to) => { m._slideY = from; m._slide = { t0: m.time ?? 0, from, to }; };
  m._slideSet = (v) => { m._slide = null; m._slideY = v; };
  m._slideTick = () => {
    if (!m._slide) return;
    const p = Math.min(1, Math.max(0, ((m.time ?? 0) - m._slide.t0) / (SLIDE_STEPS / VSYNC)));
    m._slideY = Math.round(m._slide.from + (m._slide.to - m._slide.from) * p);
    if (p >= 1) m._slide = null;
  };
  m._slideReady = () => m._slide == null;

  // A window counts as OPEN unless a close is running or has finished on it.
  m._isOpen = (k) => { const a = m._anim![k]; return !(a && a.dir === 0); };

  // ── the STATUS SHEET's own windows (F0x8008d684 states 0..3) ───────────
  // card + name tab, then the EXP plate + the Digivolve panel, then the stat
  // window + the Equip panel — each pair waiting on the pair before it. The
  // EXP plate and the stat window are opened only if they are not already up,
  // which is what makes coming back from See Equipment cheaper than a fresh
  // entry.
  m._openSheet = (fresh) => {
    if (fresh) m._foldOpen!("shCard");
    m._foldOpen!("shName");
    m._after!(fresh ? ["shCard", "shName"] : ["shName"], () => {
      if (!m._isOpen!("shExp")) m._foldOpen!("shExp");
      m._foldOpen!("shDv");
    });
    m._after!(["shExp", "shDv"], () => {
      if (!m._isOpen!("shStat")) m._foldOpen!("shStat");
      m._foldOpen!("shEq");
    });
    m._after!(["shStat", "shEq"], () => { m.detailStep = "prompt"; });
  };
  // Leaving the sheet for a sub-screen (state 10). The card always stays; the
  // EXP plate and the stat window come down only for See Digivolve (row 0) —
  // See Equipment draws over a sheet that still has them, which is why the
  // partner's numbers are still on its left.
  m._closeSheet = (row, alsoCard) => {
    const keys = ["shName", "shDv", "shEq"];
    if (row === 0) keys.push("shExp", "shStat");
    if (alsoCard) keys.push("shCard");
    m._foldClose!(...keys);
    return keys;
  };

  // digimon.json is small and menu-only (battle.js keeps its own copy for battle
  // maths); fetch once, lazily, so party/status/techniques screens have real profiles.
  let dataPromise: Promise<void> | null = null;
  m.ensureData = () => {
    if (!dataPromise) {
      dataPromise = fetch("assets/data/digimon.json").then((r) => r.json()).then((dj) => {
        m.digimonDB = Object.fromEntries(dj.digimon.map((d) => [d.id, d]));
        m.skillDB = Object.fromEntries(dj.skills.map((s) => [s.id, s]));
      });
    }
    return dataPromise;
  };

  m.reset = () => {
    m.mainCursor = 0; m.screen = "home"; m.fieldHome = true;
    m.itemCursor = 0; m.itemMode = "cats"; m.itemCat = 0; m.itemTarget = 0; m.itemSortCursor = 0;
    m.sortPick = null;
    m.sortSwapping = false;
    m.statusCursor = 0; m.detailIdx = 0; m.detailFocus = 0; m.detailSel = 0; m.detailStep = "prompt";
    m.techCursor = 0; m.techMode = null; m.techTarget = 0;
    m.dvAction = 0; m.techInfoSel = 0; m.demoCursor = digivolveDemoOn() ? 0 : 1;
    m.dvHome = true; m.dvMessage = null; m.dvBackStep = "dvaction";
    m.equipFocus = "slots"; m.equipCursor = 0; m.equipListCursor = 0; m.equipScroll = 0;
    m.fadeLeaving = false; m.fadeT0 = 0; m.fadePending = null;
    m.feedbackMsg = null;
    m._anim = {}; m._sfxPlayed = {}; m._screenSeen = null; // re-fold on open
    m._seq!.length = 0; m._slide = null; m._slideY = 0;
    m.ensureData!();
  };

  // Open the menu directly on one screen. Used by the DRI-desk launcher (set_flag
  // bank 0x7c index 0 = the original SWITCH-DIGIMON screen 0xd00); the walker's
  // equivalent of that screen is the SORT formation view.
  m.openAt = (screen) => {
    m.reset!();
    m.screen = screen;
    if (screen !== "home") m.fieldHome = false;
  };

  // The active tab's rows, walked in the original's directory order. The gear
  // tabs pass their negative kind so worn-only items are listed too (the tab
  // words' bit 31 — see ITEM_CAT_KINDS).
  m.itemList = (state) => listItemIds(state, ITEM_CAT_KINDS[m.itemCat] ?? 1)
    .map((id) => ({ id, qty: heldCount(state, id) }));

  m.ensureData(); // fire immediately at creation — don't wait for the first reset()

  // Seed real base stats for non-lead party members the first time we need them
  // (lazy — game.js only allocates null placeholders at grant time).
  function ensurePartyStats(state: GameState) {
    if (!Array.isArray(state.party)) return;
    if (!Array.isArray(state.partyStats) || state.partyStats.length !== state.party.length) {
      state.partyStats = state.party.map(() => null);
    }
    let changed = false;
    state.party.forEach((charId: string | number, i: number) => {
      if (i === 0) return; // lead uses live partnerStats
      if (!state.partyStats[i]) {
        const prof = m.digimonDB?.[CHARID_TO_DIGID[charId]];
        state.partyStats[i] = baseStatsFor(prof);
        changed = true;
      }
    });
    if (changed) localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
  }

  function roster(state: GameState): RosterViewEntry[] {
    ensurePartyStats(state);
    return partyRosterView(state.party, state.partnerStats, state.partyStats, m.digimonDB ?? {}, state.digimonNames);
  }

  // The LIVE stat block behind roster index i (the roster view is a copy).
  // Index 0 is the battle-tracked lead; the rest have their own persisted slot.
  function statBlock(state: GameState, i: number) {
    ensurePartyStats(state);
    return i === 0 ? state.partnerStats : state.partyStats?.[i];
  }

  function persistStats(state: GameState, i: number) {
    if (i === 0) localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
    localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
  }

  // TECHNIQUES rows for one party member: the healing techniques in the six
  // ledger slots of its three EQUIPPED forms, de-duplicated, capped at five.
  // F0x800937a4 walks the equipped-form triple (record +0x50, validated by the
  // +0x2738 getter), copies each form's ledger entry and reads its six slots —
  // it does NOT read the current species' own technique list, so a partner whose
  // evolved form learned Small Heal lists it, and a rookie with no equipped form
  // lists nothing. formTechSlots is the one form-slot reader (see its header);
  // engine fieldTechniqueRows keeps the (id - 0xB8) < 5 filter, first-seen order,
  // de-dup and the five-row cap.
  m.techRows = (state, idx) => {
    const stats = statBlock(state, idx);
    const slots = [];
    for (const formId of stats?.equippedForms ?? []) {
      slots.push(...formTechSlots(stats, formId, m.digimonDB ?? {}));
    }
    return fieldTechniqueRows(slots);
  };

  // Apply one field technique. target === null means the whole party.
  //
  // The cues are the disc's own (F0x80093A58, pro/ststatus.s): a heal that
  // landed plays 0x00040014 RECOVERY (`host.playSound(0x40014)` in the port,
  // engine/dw3/ui/native/pause-techniques.ts:149/184); a refusal replays the
  // confirm cue the caller had just played (`sound` there — 0x4001C from
  // "Use it on who?" at :19550, 0x8004503C from the party-wide list at
  // :19292). The copy used to play "savedemo" (0x00040015, a different
  // sample) on success and "system01" (0x800450BD, the back cue) on refusal —
  // divergence row `pause-home-button-table-2026-10-04.md` §13.
  m.applyTechnique = (state, techId, target, failSound = "system07") => {
    const view = roster(state);
    const casterIdx = m.statusCursor;
    const caster = statBlock(state, casterIdx);
    const skill = m.skillDB?.[techId];
    if (!caster || !skill) { m.showFeedback!("No technique."); return; }

    const idxs = target === null ? view.map((_, i) => i) : [target];
    const blocks = idxs.map((i: number) => statBlock(state, i)).filter(Boolean);
    // The scaling stat is read off the caster; HEAL_SCALE_STAT names which one
    // so a correction is a single edit in engine/dw3/field-techniques.ts.
    const scale = view[casterIdx]?.stats?.[HEAL_SCALE_STAT]
      ?? view[casterIdx]?.profile?.[HEAL_SCALE_STAT] ?? 0;

    const r = useFieldTechnique(caster, blocks, skill.mp_cost ?? 0, skill.power ?? 0, scale);
    m.showFeedback!(r.msg);
    if (!r.ok) { sfx?.play(failSound); return; }
    sfx?.play("recovery"); // 0x40014 — the applied-heal cue
    idxs.forEach((i: number) => persistStats(state, i));
    persistStats(state, casterIdx);
  };

  m.handleKey = (rawKey, state, onSave) => {
    if (m.nativeOpen?.()) return; // the native pause page owns the pad while open
    // Accept either a pad button name from the dispatcher or the raw key it
    // stands for, so a caller (and a test) may use whichever it has.
    const key = asButton(rawKey);
    if (m.fadeLeaving) return;
    if (m.feedbackMsg) { m.feedbackMsg = null; return; }

    // CONFIRMED U-07/U-08: Square is not read on this bag and no comparator
    // runs. The Sort Items strings exist in the bank and are not bound here.

    // "Choose Digimon" after a usable Items-row Circle. Cursor clamps
    // (same shape as Status U-32 / Techniques U-15).
    if (m.itemMode === "use_target") {
      const n = roster(state).length;
      if (key === "up") m.itemTarget = moveCursor(m.itemTarget, clampIndex(m.itemTarget - 1, n), sfx, "system06");
      else if (key === "down") m.itemTarget = moveCursor(m.itemTarget, clampIndex(m.itemTarget + 1, n), sfx, "system06");
      else if (key === "cross") { sfx?.play("system01"); m.itemMode = "list"; }
      else if (key === "circle") {
        // §4.3: this confirm has NO click of its own — it goes straight into
        // the apply (ststatus.s:14643 calls F0x8008F584), and the applier is
        // what you hear: 0x40014 on the applied arm, 0x4001c SYSTEM07 with
        // "No effect." on the refusal arm (file 0xcbc8 / 0xcc10).
        const list = m.itemList!(state);
        const slot = list[m.itemCursor];
        if (slot) {
          const item = ITEM_BY_ID[slot.id];
          const tgt = m.itemTarget;
          const view = tgt === 0 ? state
            // The worn gear comes along so the store's auto-unequip can see who has
            // what, exactly as the original's remove arm searches the party.
            : { inventory: state.inventory, equipment: state.equipment, partnerStats: state.partyStats[tgt] };
          // Snapshot the numbers the message compares. A shallow spread would
          // alias the nested bonuses/elemBonuses objects, so every delta would
          // read as 0 and the message would fall back to the item's nominal value.
          const ps0 = view.partnerStats ?? {};
          const before = {
            hp: ps0.hp, mp: ps0.mp, maxHp: ps0.maxHp, maxMp: ps0.maxMp, tp: ps0.tp,
            bonuses: { ...(ps0.bonuses ?? {}) },
            elemBonuses: { ...(ps0.elemBonuses ?? {}) },
          };
          const r = useItem(view, slot.id, undefined, roster(state)[tgt]?.profile);
          if (r.ok) {
            // F0x8008F584's applied arm plays 0x00040014 RECOVERY for EVERY
            // effect that landed (file 0xcbcc, `ori $a0,0x14`), not only HP
            // charges — the old "savedemo" here was 0x00040015, a different
            // sample (the save screen's demo jingle).
            sfx?.play("recovery");
            m.showFeedback!(useMessage(item, before, view.partnerStats, r));
            if (tgt === 0) localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
            else localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
            localStorage.setItem("inventory", JSON.stringify(state.inventory));
          } else {
            // The refusal arm ("No effect."): file 0xcc10, `ori $a0,0x1c`.
            sfx?.play("system07");
            m.showFeedback!(r.msg!);
          }
        }
        m.itemMode = "list";
      }
      return;
    }

    const back = () => { sfx?.play("system01"); m.screen = "home"; };

    if (m.screen === "home") {
      // The top menu CLAMPS at both ends — it does not wrap. F0x8001270c state 3
      // takes `unk58 - 1` and floors it at 0, `unk58 + 1` and ceilings it at
      // rowCount - 1. (SORT's own cursor does wrap; the two differ deliberately.)
      // Until 2026-08-14 the up branch referenced an undefined TOP_ITEMS and
      // threw on every press.
      if ((key === "up" || key === "down") && state.keys?.has?.(key)) return;
      if (key === "up") {
        const next = Math.max(0, m.mainCursor - 1);
        if (next !== m.mainCursor) { m.mainCursor = next; sfx?.play("system02"); }
      } else if (key === "down") {
        const next = Math.min(topItems(m).length - 1, m.mainCursor + 1);
        if (next !== m.mainCursor) { m.mainCursor = next; sfx?.play("system02"); }
      } else if (key === "circle") {
        // The confirm bit is word bit 0x2000, which is the name "circle" here:
        // F0x8001270c asks the pad service for logical button 0x0D and only that
        // arm records the chosen row (fns.s:3370-3406). The back bit 0x4000
        // ("cross") folds the list shut without recording a row, and the host
        // owns that fold (web/game.js), so this list acts on neither.
        const chosen = topItems(m)[m.mainCursor];
        // The confirm SOUND is unconditional and comes FIRST; only then does the
        // MAP gate swallow the press. F0x8001270c.c:177 plays the packed confirm
        // SFX and then tests `(unk64 != 0) || (unk58 != 2)` before acting, so a
        // refused MAP still clicks like every other row — it just does nothing.
        sfx?.play("system00");
        if (chosen === "MAP" && mapUnavailable(state)) return;
        m.fieldHome = false;
        if (m.onNativePage?.(chosen!)) { /* the native pause page owns the pad */ }
        else if (chosen === "ITEMS") { m.screen = "items"; m.itemMode = "cats"; m.itemCursor = 0; }
        else if (chosen === "SORT") { m.screen = "sort"; m.statusCursor = 0; m.sortPick = null; m.sortSwapping = false; }
        else if (chosen === "MAP") { m.screen = "map"; m.mapInit = false; }
        else if (chosen === "TECHNIQUES") { m.screen = "techniques-pick"; m.statusCursor = 0; }
        else if (chosen === "STATUS") { if (m.onStatus?.()) m.screen = "home"; else { m.screen = "status-list"; m.statusCursor = 0; } }
        else if (chosen === CARD_FOLDERS) { m.screen = "cardfolder"; m.cardFolderCursor = 0; }
        else if (chosen === DEMO_SETUP_LABEL) { m.screen = "demosetup"; m.demoCursor = digivolveDemoOn() ? 0 : 1; }
      }
      return;
    }

    // ── CARD FOLDERS: the parent of the Album and the folder editor ──
    // Guides and the shipped strings agree on the shape: the Card Folders
    // window offers the Album (every card you own) and Edit Folder. Both are
    // real screens the walker already ships; before this they were reachable
    // only from the debug lab.
    if (m.screen === "cardfolder") {
      if (key === "cross") { back(); return; }
      if (key === "up") m.cardFolderCursor = moveCursor(m.cardFolderCursor, 0, sfx);
      else if (key === "down") m.cardFolderCursor = moveCursor(m.cardFolderCursor, 1, sfx);
      else if (key === "circle") {
        sfx?.play("system00");
        m.fadeLeaving = true;
        m.fadeT0 = m.time ?? 0;
        m.fadePending = m.cardFolderCursor === 0 ? "album" : "deck";
      }
      return;
    }

    if (m.screen === "items") {
      const list = m.itemList!(state);
      const perPage = (MS.UI?.screens?.items?.grid?.cols ?? 2) * (MS.UI?.screens?.items?.grid?.rows ?? 8);
      if (m.itemMode === "cats" || m.itemMode == null) {
        if ((key === "up" || key === "down") && state.keys?.has?.(key)) return;
        if (key === "cross") { back(); return; }
        if (key === "up") {
          m.itemCat = moveCursor(m.itemCat, Math.max(0, m.itemCat - 1), sfx); m.itemCursor = 0;
        } else if (key === "down") {
          m.itemCat = moveCursor(m.itemCat, Math.min(ITEM_CATS.length - 1, m.itemCat + 1), sfx);
          m.itemCursor = 0;
        } else if (key === "circle") {
          // §4.1: the confirm word plays FIRST and unconditionally — the
          // original plays 0x8004503C (ststatus.s:14238) BEFORE it counts the
          // tab. A stocked tab then opens the bag; an empty one shows
          // esstatus 0x64+cat ("No Items." … "No Important Items.", :14286)
          // and STAYS, with no second sound.
          sfx?.play("system00");
          if (m.itemList!(state).length > 0) { m.itemMode = "list"; m.itemCursor = 0; }
          else m.showFeedback!(ITEM_CAT_EMPTY[m.itemCat]!);
        }
        return;
      }
      if (key === "cross") { sfx?.play("system01"); m.itemMode = "cats"; return; }
      // L1/R1 page the bag (rig: Weapons "1 / 8" + R1). Categories are the picker.
      // The original's own guards (F0x80092524): the two shoulders are mutually
      // exclusive (`heldOther` on the other one), Left is read only when Down is
      // NOT held and Right only when Up is not (the `padHeld` tests at :63/:126).
      if ((key === "l1" && state.keys?.has?.("r1")) || (key === "r1" && state.keys?.has?.("l1"))) return;
      if ((key === "left" && state.keys?.has?.("down")) || (key === "right" && state.keys?.has?.("up"))) return;
      if (key === "l1" || key === "r1" || key === "up" || key === "down" || key === "left" || key === "right") {
        m.itemCursor = moveCursor(m.itemCursor,
          bagCursorStep(m.itemCursor, key, list.length, perPage), sfx);
      }
      else if (key === "circle") {
        // U-10: Circle is a no-op off the Items category. U-28: bit 0 / pair
        // lo-byte 1 and 3 only.
        const slot = list[m.itemCursor];
        if (m.itemCat === 0 && slot && itemUsableInField(slot.id)) {
          sfx?.play("system00");
          m.itemMode = "use_target"; m.itemTarget = 0;
        }
      }
      return;
    }

    if (m.screen === "sort") {
      // Real SORT = change Digimon FORMATION (esstatus strings 15-18:
      // "Change Digimon formation", "Switch who?", "Switch with who?") —
      // not item sorting (that's the square button inside ITEMS).
      const n = roster(state).length;
      if (m.sortSwapping) return; // states 8/9 own the pad while the cards fold
      if (key === "cross") {
        // §5: BOTH real SORT states play the back word 0x800450BD on Back
        // (ststatus.s:21306 "Switch who?", :21480 "Switch with who?"), but the
        // party-of-one refusal screen leaves with NO click at all
        // (:21577-21590 reads 0xE and stores the state, with no playSound).
        if (n >= 2) sfx?.play("system01");
        if (m.sortPick != null) m.sortPick = null; else m.screen = "home";
        return;
      }
      // A party of one cannot be reordered: the real screen shows string 16 and
      // accepts nothing but cancel (F0x8009744c states 15/16).
      if ((key === "up" || key === "down") && state.keys?.has?.(key)) return;
      if (n < 2) return;
      // Both cursors WRAP here (unlike the top menu, which clamps), and on the
      // second pick the cursor SKIPS the slot already chosen — the original's
      // `do { ... } while (arg0->unk84 == temp)` loops in states 6 and 7.
      // The cues are the party-card pair: cursor 0x4001B (:21228, :21408),
      // confirm 0x4001C (:21249, :21429).
      const step = (from: number, d: number) => {
        let i = from;
        do { i = (i + d + n) % n; } while (m.sortPick != null && i === m.sortPick);
        return i;
      };
      if (key === "up") m.statusCursor = moveCursor(m.statusCursor, step(m.statusCursor, -1), sfx, "system06");
      else if (key === "down") m.statusCursor = moveCursor(m.statusCursor, step(m.statusCursor, 1), sfx, "system06");
      else if (key === "circle") {
        sfx?.play("system07");
        if (m.sortPick == null) {
          m.sortPick = m.statusCursor;
          // The second cursor may never rest on the first pick.
          if (m.statusCursor === m.sortPick) m.statusCursor = step(m.statusCursor, 1);
          return;
        }
        // States 8 and 9 (screen-tree S3): the two chosen cards fold SHUT, the
        // swap happens behind them, and only then do they fold back open with
        // their new occupants — after which the header returns to "Switch
        // who?". The walker used to swap in one frame, so the two portraits
        // teleported. `sortSwapping` holds the header on "Switch with who?"
        // and swallows the pad for the length of the two folds, which is what
        // the original's two extra states do.
        const a = m.sortPick, b = m.statusCursor;
        m.sortSwapping = true;
        m._foldClose!(`card${a}`, `card${b}`);
        m._after!([`card${a}`, `card${b}`], () => {
          swapFormation(state, a, b);
          m._foldOpen!(`card${a}`, `card${b}`);
          m._after!([`card${a}`, `card${b}`], () => {
            m.sortSwapping = false;
            m.sortPick = null;
          });
        });
      }
      return;
    }

    // Digivolve Demo ON/OFF. Two rows, assigned rather than stepped, like every
    // other two-row list in this menu (Card Folders, the detail prompt).
    if (m.screen === "demosetup") {
      // The disc has no selector for this screen, so its Back has no original
      // answer. The host decides where Back goes (web/game.js sets `backToHome`
      // to the one pause home); standing alone this module returns to its own
      // hand-written list.
      if (key === "cross") { sfx?.play("system01"); m.backToHome?.(); return; }
      if (key === "up") m.demoCursor = moveCursor(m.demoCursor, 0, sfx);
      else if (key === "down") m.demoCursor = moveCursor(m.demoCursor, 1, sfx);
      else if (key === "circle") {
        sfx?.play("system00");
        const on = m.demoCursor === 0;
        setDigivolveDemo(on);
        m.showFeedback!(on ? "Turned on Battle Digivolve" : "Turned off Battle Digivolve");
      }
      return;
    }

    if (m.screen === "map") {
      if (key === "cross") {
        m.mapHoldX = 0; m.mapHoldY = 0;
        back(); return;
      }
      const MC = MS.UI?.screens?.map?.cursor;
      if (!MC || !m.mapInit) return;
      const axis = key === "left" ? [-1, 0]
        : key === "right" ? [1, 0]
        : key === "up" ? [0, -1]
        : key === "down" ? [0, 1]
        : null;
      if (!axis) return;
      // Held pad/keyboard is ticked from the map draw (F0x800986c0 runs every
      // vsync). Event-only callers (tests) get one step here.
      if (state.keys?.has?.(key)) return;
      const horiz = axis[0] !== 0;
      if (horiz) m.mapHoldX = (m.mapHoldX ?? 0) + 1;
      else m.mapHoldY = (m.mapHoldY ?? 0) + 1;
      m.mapSpd = mapHoldSpeed(horiz ? m.mapHoldX : m.mapHoldY, MC);
      _mapMove(m, MC, axis[0], axis[1]);
      return;
    }

    if (m.screen === "techniques-pick") {
      const n = roster(state).length;
      if (key === "cross") { back(); return; }
      if (key === "up") m.statusCursor = moveCursor(m.statusCursor, clampIndex(m.statusCursor - 1, n), sfx, "system06");
      else if (key === "down") m.statusCursor = moveCursor(m.statusCursor, clampIndex(m.statusCursor + 1, n), sfx, "system06");
      // §7.1: the party list's confirm is the party-card word 0x4001C
      // (ststatus.s:18971) — it opens "Choose a technique".
      else if (key === "circle") { sfx?.play("system07"); m.screen = "techniques-list"; m.techCursor = 0; }
      return;
    }

    if (m.screen === "techniques-list") {
      const rows = m.techRows!(state, m.statusCursor);
      // "Use it on who?" (esstatus 43) — only the single-target heals ask.
      if (m.techMode === "use_target") {
        const n = roster(state).length;
        if (key === "up") m.techTarget = moveCursor(m.techTarget, clampIndex(m.techTarget - 1, n), sfx, "system06");
        else if (key === "down") m.techTarget = moveCursor(m.techTarget, clampIndex(m.techTarget + 1, n), sfx, "system06");
        else if (key === "cross") { sfx?.play("system01"); m.techMode = null; }
        else if (key === "circle") {
          // §7.3: the apply path plays NO click of its own before the applier —
          // F0x80093A58 is called with 0x4001C and plays 0x40014 on a heal,
          // its caller's 0x4001C on a refusal (state 0x20,
          // engine/dw3/ui/native/pause-techniques.ts:616-632).
          m.applyTechnique!(state, rows[m.techCursor]!, m.techTarget);
          m.techMode = null;
        }
        return;
      }
      if (key === "cross") { sfx?.play("system01"); m.screen = "techniques-pick"; return; }
      if (key === "up") m.techCursor = moveCursor(m.techCursor, Math.max(0, m.techCursor - 1), sfx);
      else if (key === "down") {
        m.techCursor = moveCursor(m.techCursor,
          Math.min(Math.max(0, rows.length - 1), m.techCursor + 1), sfx);
      }
      else if (key === "circle") {
        const techId = rows[m.techCursor];
        if (techId == null) return;
        sfx?.play("system00");
        // Party-wide heals (Giga/Final Heal, scope byte 4) skip the target
        // prompt entirely and apply to everyone at once — F0x80093a58. Its
        // refusal replays this list's own confirm cue (0x8004503C), which the
        // copy has just played as "system00" (pause-home-button-table §7.2).
        if (isPartyWide(techId)) m.applyTechnique!(state, techId, null, "system00");
        else { m.techMode = "use_target"; m.techTarget = m.statusCursor; }
      }
      return;
    }

    if (m.screen === "status-list") {
      const n = roster(state).length;
      if (key === "cross") { back(); return; }
      if (key === "up") m.statusCursor = moveCursor(m.statusCursor, clampIndex(m.statusCursor - 1, n), sfx, "system06");
      else if (key === "down") m.statusCursor = moveCursor(m.statusCursor, clampIndex(m.statusCursor + 1, n), sfx, "system06");
      else if (key === "circle") {
        // §8.1: party-card cursor 0x4001B, confirm 0x4001C (ststatus.s:11664,
        // :11687) — it opens that partner's sheet.
        sfx?.play("system07");
        m.detailIdx = m.statusCursor; m.detailFocus = 0; m.detailSel = 0;
        m.detailStep = "opening";
        m.screen = "status-detail";
        m._foldShut!("shCard", "shName", "shExp", "shStat", "shDv", "shEq");
        m._seqClear!();
        m._openSheet!(true);
      }
      return;
    }

    if (m.screen === "status-detail") {
      // While a fold is running the original is in a state that reads no pad
      // at all. Swallow the key rather than letting a screen change land
      // halfway through a window opening.
      if (m._seq!.length) return;
      const r = roster(state)[m.detailIdx];
      const evos = window.__battle?.availableEvolutions?.(state, m.detailIdx) ?? [];

      // ── the sheet's two-row prompt (F0x8008d684 state 5) ────────────────
      // Up assigns row 0, Down assigns row 1 — no wrap, no third row.
      if (m.detailStep === "prompt") {
        if (key === "cross") {
          // Cross leaves the sheet: every panel shuts, the card with them.
          sfx?.play("system01");
          const keys = m._closeSheet!(1, true);
          m.detailStep = "closing";
          m._after!(keys, () => { m.screen = "status-list"; m.detailStep = "prompt"; });
          return;
        }
        if (key === "up") m.detailFocus = moveCursor(m.detailFocus, 0, sfx);
        else if (key === "down") m.detailFocus = moveCursor(m.detailFocus, 1, sfx);
        else if (key === "circle") {
          sfx?.play("system00");
          m.detailSel = 0; m.dvHome = true; m.dvAction = 0;
          const keys = m._closeSheet!(m.detailFocus, false);
          if (m.detailFocus === 0) {
            // See Digivolve: its own screen. Name plate, then the candidate
            // list, then the lower panel (F0x80089bf0 states 0..3).
            m.detailStep = "closing";
            m._after!(keys, () => {
              m._foldShut!("dvName", "dvList", "dvAct", "dvPanel", "dvFoot");
              m._slideSet!(0);
              m._foldOpen!("dvName");
            });
            m._after!(["dvName"], () => m._foldOpen!("dvList"));
            m._after!(["dvList"], () => m._foldOpen!("dvPanel"));
            m._after!(["dvPanel"], () => { m.detailStep = "digivolve"; });
          } else {
            // See Equipment: header plate, then the slots window.
            m._after!(keys, () => {
              m.equipFocus = "slots"; m.equipCursor = 0;
              m.screen = "equip"; m.detailStep = "prompt";
              m._foldShut!("eqHeader", "eqSlots", "eqList", "eqDetail");
              m._foldOpen!("eqHeader");
            });
            m._after!(["eqHeader"], () => m._foldOpen!("eqSlots"));
          }
        }
        return;
      }

      // ── See Digivolve ───────────────────────────────────────────────────
      // Leaving the screen (F0x80089bf0 state 0x32): its three windows shut,
      // then the sheet builds itself back up.
      const leaveDigivolve = () => {
        sfx?.play("system01");
        m._foldClose!("dvName", "dvList", "dvPanel");
        m.detailStep = "closing";
        m._after!(["dvName", "dvList", "dvPanel"], () => {
          m.detailFocus = 0;
          m._openSheet!(false);
        });
      };
      // The technique explanation: the panel slides 34px up, the footer plate
      // opens under it, and the highlighted slot's text and MP cost appear.
      const openExplanation = (closeKey: string, backStep: string) => {
        m._foldClose!(closeKey);
        m.detailStep = "closing";
        m._after!([closeKey], () => m._slideStart!(0, MS.UI.screens.see_digivolve.panel_slide?.to ?? -34));
        m._after!(["slide"], () => m._foldOpen!("dvFoot"));
        m._after!(["dvFoot"], () => { m.detailStep = "techinfo"; m.dvBackStep = backStep; });
      };
      const closeExplanation = () => {
        sfx?.play(m.dvBackStep === "dvaction" ? "system00" : "system01");
        m._foldClose!("dvFoot");
        m.detailStep = "closing";
        m._after!(["dvFoot"], () => m._slideStart!(m._slideY!, 0));
        m._after!(["slide"], () => m._foldOpen!(m.dvBackStep === "dvaction" ? "dvAct" : "dvList"));
        m._after!([m.dvBackStep === "dvaction" ? "dvAct" : "dvList"],
          () => { m.detailStep = m.dvBackStep === "dvaction" ? "dvaction" : "digivolve"; });
      };

      if (m.detailStep === "digivolve") {
        // The cursor starts BESIDE THE PARTNER'S NAME, not on a candidate.
        // Right (pad bit 5) walks it into the list, Left (bit 7) brings it
        // back — F0x80089bf0 state 4 branches on unk6C for exactly that.
        if (key === "cross") { leaveDigivolve(); return; }
        if (m.dvHome) {
          if (key === "right" && evos.length) { m.dvHome = false; sfx?.play("system02"); }
          else if (key === "circle") {
            // Circle at the home cursor explains the partner's OWN signature
            // technique (state 0x3c: slot 5, text from the partner record).
            sfx?.play("system00");
            m.techInfoSel = 5;
            openExplanation("dvList", "digivolve");
          }
          return;
        }
        if (key === "left") { m.dvHome = true; sfx?.play("system02"); return; }
        if (key === "up") {
          const next = Math.max(0, m.detailSel - 1);
          if (next !== m.detailSel) { m.detailSel = next; sfx?.play("system02"); }
        } else if (key === "down") {
          const next = Math.min(Math.max(0, evos.length - 1), m.detailSel + 1);
          if (next !== m.detailSel) { m.detailSel = next; sfx?.play("system02"); }
        } else if (key === "circle" && evos[m.detailSel]) {
          // A candidate opens its ACTION PAIR: the list window shuts and the
          // shorter action window takes its place (states 0xA..0xC).
          sfx?.play("system00");
          m.dvAction = 0;
          m._foldClose!("dvList");
          m.detailStep = "closing";
          m._after!(["dvList"], () => m._foldOpen!("dvAct"));
          m._after!(["dvAct"], () => { m.detailStep = "dvaction"; });
        }
        return;
      }

      // The two action rows (state 0xD). Up assigns 0, Down assigns 1.
      if (m.detailStep === "dvaction") {
        const target = evos[m.detailSel];
        if (key === "up" || key === "down") {
          const next = key === "up" ? 0 : 1;
          if (next !== m.dvAction) { m.dvAction = next; sfx?.play("system02"); }
          return;
        }
        if (key === "cross") {
          // Back to the candidate list (states 0x14..0x16).
          sfx?.play("system01");
          m._foldClose!("dvAct");
          m.detailStep = "closing";
          m._after!(["dvAct"], () => m._foldOpen!("dvList"));
          m._after!(["dvList"], () => { m.detailStep = "digivolve"; });
          return;
        }
        if (key !== "circle" || !target) return;
        sfx?.play("system00");
        if (m.dvAction === 1) {
          const slots = formTechSlots(statBlock(state, m.detailIdx), target.formId, m.digimonDB);
          const first = slots.findIndex((id) => id > 0);
          m.techInfoSel = first < 0 ? 0 : first;
          openExplanation("dvAct", "dvaction");
          return;
        }
        // Row 0 writes the roster current-form field in place: the highlighted
        // form, or 0 when it already equals it (state 0xD, confirm branch).
        const off = isCurrentForm(r, target);
        const rookie = m.digimonDB?.[r?.rookieId];
        const toName = off ? rookie?.name : target.to;
        const result = toName
          ? window.__battle?.applyEvolution?.(toName, state, m.detailIdx)
          : null;
        // The original reports only which way the field went, not the name.
        m.dvMessage = result?.ok
          ? (off ? "Turned off Battle Digivolve" : "Turned on Battle Digivolve")
          : "Cannot digivolve.";
        // The message takes the whole screen down to the footer: the name plate
        // and the action window shut, the panel slides up, the footer opens
        // (states 0x19..0x1C).
        m._foldClose!("dvName", "dvAct");
        m.detailStep = "closing";
        m._after!(["dvName", "dvAct"],
          () => m._slideStart!(0, MS.UI.screens.see_digivolve.panel_slide?.to ?? -34));
        m._after!(["slide"], () => m._foldOpen!("dvFoot"));
        m._after!(["dvFoot"], () => { m.detailStep = "dvmessage"; });
        return;
      }

      // The message sits until Circle (state 0x1D), which plays the stepper
      // confirm rather than the ordinary one, then the screen rebuilds itself
      // from the top (states 0x1E/0x1F -> state 0).
      if (m.detailStep === "dvmessage") {
        if (key !== "circle") return;
        sfx?.play("system07");
        m._foldClose!("dvFoot", "dvPanel");
        m.detailStep = "closing";
        m._after!(["dvFoot", "dvPanel"], () => {
          m._slideSet!(0);
          m.dvHome = true; m.dvMessage = null;
          m._foldShut!("dvAct");
          m._foldOpen!("dvName");
        });
        m._after!(["dvName"], () => m._foldOpen!("dvList"));
        m._after!(["dvList"], () => m._foldOpen!("dvPanel"));
        m._after!(["dvPanel"], () => { m.detailStep = "digivolve"; });
        return;
      }

      // "Choose a technique" (state 0x2C): the cursor SKIPS empty slots and
      // stays put when there is no other filled one. Circle and Cross both
      // leave.
      if (m.detailStep === "techinfo") {
        const target = evos[m.detailSel];
        const slots = m.dvBackStep === "dvaction" && target
          ? formTechSlots(statBlock(state, m.detailIdx), target.formId, m.digimonDB)
          : ownTechSlots(r?.profile);
        const step = (from: number, d: number) => {
          for (let i = from + d; i >= 0 && i < 6; i += d) if (slots[i] > 0) return i;
          return from;
        };
        if (key === "up" || key === "down") {
          const next = step(m.techInfoSel, key === "up" ? -1 : 1);
          if (next !== m.techInfoSel) { m.techInfoSel = next; sfx?.play("system02"); }
        } else if (key === "circle" || key === "cross") {
          closeExplanation();
        }
        return;
      }
      return;
    }

    if (m.screen === "equip") {
      if (m._seq!.length) return;   // a fold is running: the original reads no pad
      const apply = (choice, slotKey: string | undefined) => {
        ensureEquipment(state);
        // Build the new slot map on a COPY, then hand both to the store's one
        // record writer: it moves the worn byte by the difference the record gained
        // and lost, once per item (ststatus 0x8009A3E8 — the displace arm at
        // 0x8009A45C and the equip arm at 0x8009A5FC, one store each). Counting
        // the difference rather than the pieces displaced is what makes a
        // two-handed weapon ONE worn copy: it sits in both hand halfwords, and one
        // writer call moved the byte once in the original.
        const slots = { ...(state.equipment[m.detailIdx] ?? {}) };
        if (choice.unequip) {
          unequipItem(slots, slotKey);
        } else {
          const res = equipItem(slots, slotKey, choice.id);
          if (!res.ok) { m.showFeedback!(res.msg ?? "Can't equip that."); return; }
        }
        commitEquipSlot(state, m.detailIdx, slotKey, slots);
        syncEquipBonuses(state, m.detailIdx);
        localStorage.setItem("equipment", JSON.stringify(state.equipment));
        localStorage.setItem("worn", JSON.stringify(state.worn ?? {}));
        localStorage.setItem("inventory", JSON.stringify(state.inventory));
      };
      if (m.equipFocus === "slots") {
        if (key === "cross") {
          // Leaving the screen: the slots window shuts, then the header plate
          // (states 0x32..0x34). Only then does the sheet build itself back up,
          // with "See Equipment" still highlighted.
          sfx?.play("system01");
          m._foldClose!("eqSlots");
          m._after!(["eqSlots"], () => m._foldClose!("eqHeader"));
          m._after!(["eqHeader"], () => {
            m.screen = "status-detail"; m.detailStep = "opening"; m.detailFocus = 1;
            m._openSheet!(false);
          });
          return;
        }
        // The slot cursor CLAMPS at both ends; it does not wrap
        // (F0x8008744c state 3: `< 0 -> 0`, `>= 6 -> 5`).
        if (key === "up") {
          const n = Math.max(0, m.equipCursor - 1);
          if (n !== m.equipCursor) { m.equipCursor = n; sfx?.play("system02"); }
        } else if (key === "down") {
          const n = Math.min(5, m.equipCursor + 1);
          if (n !== m.equipCursor) { m.equipCursor = n; sfx?.play("system02"); }
        } else if (key === "circle") {
          sfx?.play("system00");
          m.equipListCursor = 0; m.equipScroll = 0;
          // The slots window shuts, then the header plate, then the
          // current-piece panel opens and the bag list after it — states
          // 0xA/0xB/0xC/0xD/0xE, four folds in a row, never two at once.
          m._foldClose!("eqSlots");
          m._after!(["eqSlots"], () => m._foldClose!("eqHeader"));
          m._after!(["eqHeader"], () => { m.equipFocus = "list"; m._foldOpen!("eqDetail"); });
          m._after!(["eqDetail"], () => m._foldOpen!("eqList"));
        }
        return;
      }
      // list focus
      const slotKey = EQUIP_SLOT_KEYS[m.equipCursor];
      const options = equipPickOptions(state, m.detailIdx, slotKey);
      // Leaving the bag (states 0x14..0x16 then back to 0): the list shuts,
      // then the current-piece panel, then the header plate and the slots
      // window open again in that order.
      const backToSlots = () => {
        m._foldClose!("eqList");
        m._after!(["eqList"], () => m._foldClose!("eqDetail"));
        m._after!(["eqDetail"], () => { m.equipFocus = "slots"; m._foldOpen!("eqHeader"); });
        m._after!(["eqHeader"], () => m._foldOpen!("eqSlots"));
      };
      if (key === "cross") {
        sfx?.play("system01"); backToSlots();
        return;
      }
      const lastOpt = Math.max(0, options.length - 1);
      if (key === "up") m.equipListCursor = moveCursor(m.equipListCursor, Math.max(0, m.equipListCursor - 1), sfx);
      else if (key === "down") m.equipListCursor = moveCursor(m.equipListCursor, Math.min(lastOpt, m.equipListCursor + 1), sfx);
      else if (key === "l1") m.equipListCursor = moveCursor(m.equipListCursor, Math.max(0, m.equipListCursor - 8), sfx);
      else if (key === "r1") m.equipListCursor = moveCursor(m.equipListCursor, Math.min(lastOpt, m.equipListCursor + 8), sfx);
      else if (key === "circle") {
        sfx?.play("system00");
        const choice = options[m.equipListCursor];
        if (choice) apply(choice, slotKey);
        backToSlots();
      }
      // keep the 8-row window over the cursor (scroll offset obj+0x6c)
      if (m.equipListCursor < m.equipScroll) m.equipScroll = m.equipListCursor;
      if (m.equipListCursor >= m.equipScroll + 8) m.equipScroll = m.equipListCursor - 7;
      return;
    }
  };

  m.update = (dt) => {
    m.time = (m.time ?? 0) + dt;
    backdrop.update(dt);
    // The screens' choreography advances on the clock, not on the draw: each
    // queued step fires the frame its folds land, exactly as the original's
    // state machine advances when window_fold_tick returns non-zero.
    m._slideTick!();
    m._runSeq!();
    if (m.feedbackMsg) {
      m.feedbackTimer -= dt;
      if (m.feedbackTimer <= 0) m.feedbackMsg = null;
    }
    if (m.fadeLeaving) {
      const frames = Math.max(0, Math.floor((m.time - m.fadeT0) * VSYNC));
      if (frames * CARD_FOLDER_FADE_DELTA >= CARD_FOLDER_FADE_MAX) {
        const which = m.fadePending;
        m.fadeLeaving = false;
        m.fadePending = null;
        if (which === "album") m.onCardAlbum?.();
        else if (which === "deck") m.onCardDeck?.();
      }
    }
  };

  m.showFeedback = (msg, duration = 1.5) => { m.feedbackMsg = msg; m.feedbackTimer = duration; };

  // ── drawing (all coordinates native 320x240, from status_ui.json) ──

  m.draw = (ctx, viewW, viewH, state) => {
    // Resident pause home leaves the field visible. Overlay screens — and
    // home after you have been into one — use the diamond room.
    if (!(m.screen === "home" && m.fieldHome)) backdrop.draw(ctx, viewW, viewH);

    const s = viewW / NATIVE_W;
    ctx.save();
    ctx.scale(s, s);
    // Look C (web/ui-c): the Digivolve Demo setup is the one page the game still opens through this module (its Back goes to the
    // translated pause home, web/game.js backToHome). The other pages here are the hand-written list and stay as they are.
    const lookC = m.screen === "demosetup" && !!m.digimonDB && !!MS.UI;
    uiC.scope("ui-menu", ctx, { enable: lookC, texts: true, compose: composeDemo }, () => {
      if (lookC) partHook(ctx, { part: "backdrop", x: (backdrop.time() * 25) % 96, y: (backdrop.time() * 25) % 96, w: 320, h: 240 });
      m._drawNative!(ctx, viewW, viewH, state);
    });
    ctx.restore();
  };

  /** The page itself, in the 320 x 240 box (m.draw has scaled the canvas). */
  m._drawNative = (ctx, viewW, viewH, state) => {
    if (!m.digimonDB || !MS.UI) {
      drawText(ctx, "Loading...", 20, 20);
      return;
    }

    const r = roster(state);
    const t = m.time ?? 0;
    m.mapUnavailable = mapUnavailable(state);
    _stepHeldLists(m, state, sfx);

    // Start fold anims when a screen appears. Windows open SEQUENTIALLY
    // (each state handler waits window-ready before the next → 0.2s steps).
    const SIDEBAR = new Set(["home", "sort", "techniques-pick", "techniques-list", "status-list", "cardfolder", "demosetup"]);
    if (m._screenSeen !== m.screen) {
      const prev = m._screenSeen;
      m._screenSeen = m.screen;
      const chrome = SIDEBAR.has(m.screen) && (prev == null || !SIDEBAR.has(prev));
      if (chrome) {
        const n = Math.max(1, Math.min(3, roster(state).length || 1));
        if (m.screen === "home") {
          // The list you get on the FIRST START is the resident one, and it
          // opens all three cards TOGETHER (F0x8001270c's first state starts
          // +0x70, +0x80 and +0x90 in one breath). It has no header or footer
          // plate of its own.
          m._animStart!(0, "header", "footer", "card0", "card1", "card2");
        } else {
          // The overlay screens do it one card at a time, and open the footer
          // plate beside the LAST of them, not the first: F0x8008ddb0 /
          // F0x80084238 / F0x80085b6c all branch on the party size and open
          // card0 + header, then card1, then card2 + footer (a party of one
          // opens the footer with card0).
          m._animStart!(0, "header", "card0");
          if (n >= 2) m._animStart!(ANIM_T, "card1");
          if (n >= 3) m._animStart!(ANIM_T * 2, "card2");
          m._animStart!(ANIM_T * (n - 1), "footer");
        }
      }
      const base = chrome ? ANIM_T : 0;
      if (m.screen === "home") m._animStart!(base, "homeWin");
      else if (m.screen === "items") { m._animStart!(0, "itemsTitle"); m._animStart!(ANIM_T, "itemsList"); m._animStart!(ANIM_T * 2, "itemsCat"); }
      // "equip" is not listed here: the sheet's own state machine opens its
      // header plate and then its slots window as it hands over, so a
      // screen-change trigger would restart a fold already running.
    }
    // Decoded window fold: sp9C scale ramp 0..0x1000 around the spA4 pivot.
    // F0x80099d5c plays SYSTEM03 as a window starts opening and SYSTEM04 as it
    // starts shutting. Ramp and pivot transform come from the shared fold
    // class; the SFX gate stays here because the sound belongs to the screen's
    // own behaviour, not to the tween's arithmetic.
    const fold = (key: string, px: number, py: number, axis: string, fn: () => void) => {
      const a = m._anim![key];
      const tr = m._foldTr!(key, px, py, axis);
      // A window that has finished SHUTTING is gone; one that has finished
      // opening draws at unity. Both come back as progress 0 / 1 here.
      if (!m._sfxPlayed![key] && a != null) {
        m._sfxPlayed![key] = 1;
        sfx?.play(a.dir ? "system03" : "system04");
      }
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

    if (m.screen === "home") {
      _drawSidebar(ctx, r, m, t, -1, null, fold, { skipPortrait: m.fieldHome });
      _drawHomeBit(ctx, state);
      _drawHome(ctx, m, t, fold);
      const ht = MS.UI.screens.shared.header_text ?? { x: 0x98, y: 0x13 };
      drawText(ctx, "[triangle] Button: Close Status", ht.x, ht.y);
    } else if (m.screen === "cardfolder") {
      _drawSidebar(ctx, r, m, t, -1, null, fold);
      _drawFooter(ctx, state, t, "[triangle] Button: Back to Menu", null, fold);
      _drawCardFolder(ctx, m, t, fold);
    } else if (m.screen === "demosetup") {
      _drawSidebar(ctx, r, m, t, -1, null, fold);
      _drawFooter(ctx, state, t, "[triangle] Button: Back to Menu", DEMO_SETUP_HINT, fold);
      _drawDemoSetup(ctx, m, t, fold);
    } else if (m.screen === "items") {
      _drawItems(ctx, state, m, r, t, fold);
      // footer is part of the items layout (sort hint)
    } else if (m.screen === "sort") {
      // SORT builds no right-hand list (F0x80096590). A party of one gets
      // the refusal footer and no header (F0x8009744c states 15/16); otherwise
      // the shared header plate carries "Switch who?" / "Switch with who?".
      const canSort = r.length >= 2;
      if (canSort) {
        _drawHeader(ctx, m.sortPick == null ? SORT_HEADERS.pick : SORT_HEADERS.with, fold);
      }
      _drawSidebar(ctx, r, m, t, canSort ? m.statusCursor : -1, m.sortPick, fold);
      _drawFooter(ctx, state, t,
        canSort ? "Change Digimon formation" : "Can't change Digimon formation",
        "[triangle] Button: Back to Menu", fold, { hideBit: true });
      // The bracket only exists once the first Digimon is picked: the original
      // sets its gate (+0x70) as it advances into "Switch with who?" and clears
      // it on the way out (.L0x00014bf4 / .L0x00014f94).
      if (canSort) _drawSwapBracket(ctx, m, t);
    } else if (m.screen === "map") {
      _drawMapPane(ctx, state, m, t, sfx);
    } else if (m.screen === "techniques-pick" || m.screen === "status-list") {
      _drawHeader(ctx, "Choose Digimon", fold);
      _drawSidebar(ctx, r, m, t, m.statusCursor, null, fold);
      const f2 = m.screen === "status-list" ? "Digimon's digivolve and equipment" : "Use Digimon's technique.";
      _drawFooter(ctx, state, t, f2, "[triangle] Button: Back to Menu", fold, { hideBit: true });
    } else if (m.screen === "techniques-list") {
      // While "Use it on who?" is up the sidebar cursor follows the TARGET and
      // the caster's own card stays locked, the same two-card idiom SORT uses.
      const picking = m.techMode === "use_target";
      _drawHeader(ctx, picking ? "Use it on who?" : "Choose Digimon", fold);
      _drawSidebar(ctx, r, m, t, picking ? m.techTarget : m.statusCursor,
        picking ? m.statusCursor : null, fold);
      _drawFooter(ctx, state, t, "[triangle] Button: Back to Menu", null, fold, { hideBit: true });
      // The same rows the input machine picks from — one reader, so the list on
      // screen and the list the cursor walks cannot disagree (F0x800937a4).
      _drawTechniques(ctx, m.techRows!(state, m.statusCursor), m, t);
    } else if (m.screen === "status-detail") {
      // "See Digivolve" is a SCREEN OF ITS OWN, and it is a CHILD of the sheet:
      // the sheet object keeps running underneath, which is why the partner's
      // card is still there while the sub-screen's own windows are up. So the
      // sheet layer always draws — its panels are simply folded shut by then.
      // Layout claim SEE-DIGIVOLVE-SCREEN-LAYOUT-001, reference capture
      // docs/research/ui/captures/original-status-2026-09-03/03-choose-digivolve.png.
      // The sub-screen draws FIRST and the sheet over it: capture
      // 03-choose-digivolve.png has the partner's card plate sitting on top of
      // the "Choose digivolve" band, which runs the full width behind it.
      if (m.detailStep !== "prompt" && m.detailStep !== "opening" && !m._isOpen!("shDv")) {
        _drawSeeDigivolve(ctx, r[m.detailIdx], m, state, t, fold);
      }
      _drawDetail(ctx, r[m.detailIdx], m, state, t, fold);
    } else if (m.screen === "equip") {
      _drawEquip(ctx, state, m, r[m.detailIdx], t, fold);
    }

    if (m.feedbackMsg) {
      const w = textWidth(m.feedbackMsg, 3);
      drawText(ctx, m.feedbackMsg, (NATIVE_W - w) / 2, 0xA8, { kind: 3 });
    }
    if (m.fadeLeaving) {
      const frames = Math.max(0, Math.floor((m.time! - m.fadeT0) * VSYNC));
      const a = Math.min(255, (frames * CARD_FOLDER_FADE_DELTA) >> 8) / 255;
      paintScreenDim(ctx, a * 255, NATIVE_W, 240);
    }
  };

  return m;
}
