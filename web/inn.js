// web/inn.js — the inn (hotel) rest service.
//
// TEXT: authentic. Every string comes from the `eshtlnam` bank, which fieldstg
// F0x8008957c requests as language + 0x5C.
//
// NUMBERS: decoded 2026-08-13. The inn identifies itself from the map you are
// standing on — the resident screen class F0x800119a8 scans the 8-byte table
// D0x8003edcc for the current screen id — and that record carries both the
// name and the per-Digimon price. So `open()` takes a MAP, not a price.
//
// GEOMETRY: decoded 2026-08-13, same pass, from F0x800119a8 (fns.s
// L2152-2425). This screen used to borrow web/choice.js because no layout had
// been read; it no longer does. Every coordinate here is served from the
// `layout` block of web/assets/data/inn_ui.json, which the extractor writes
// from the assembly — there is no second coordinate table in this file.
//
// The window art is cmfont (pack handle 0x02860000, LBA 646) clips 0x41-0x44 —
// the same shared chrome the item shop's header uses, at the same two pivots.
//
// STILL OPEN (see `open_gaps` in inn_ui.json): which scale axis the fold drives
// (the walker scales on x, matching the shop's confirmed header), and what the
// third fold's alternate-resolver copy of clip 0x43 is for.
import { innForStage, quoteInnStay, restAtInn, ui } from "./vendor/engine.js";
import { drawText, textWidth } from "./uifont.js";
import { loadPack, drawClip } from "./screenpack.js";
import { formatBits } from "./itemicons-data.js";

const DATA_URL = "assets/data/inn_ui.json";
const CURSOR = "[arrow-right]";   // esitshop 12, the shared list cursor glyph
const ANIM_T = 0.2;               // the decoded 0xA-step fold, at PAL 50Hz

export function createInn(sfx) {
  const inn = {
    _data: null,
    _pack: null,
    _open: false,
    _innName: "",
    _price: 0,
    _state: null,
    _onClose: null,
    _message: null,
    _refusal: false,
    _sel: 0,
    _anim: {},
    time: 0,
  };

  inn.isOpen = () => inn._open;
  /** Selected row: 0 = Stay in Inn, 1 = Do not stay in Inn. */
  inn.selection = () => inn._sel;

  inn.load = async () => {
    if (!inn._data) inn._data = await (await fetch(DATA_URL)).json();
    if (!inn._pack) inn._pack = await loadPack("cmfont");
    return inn._data;
  };

  /**
   * @param state  game state (reads state.bits and the party)
   * @param opts   { map, party, onClose } — `map` is the scene the player is
   *               standing on ("s235" or 235). `innName`/`pricePerDigimon`
   *               remain accepted as an override for the UI lab only.
   * @returns the quote, or null when that map has no inn.
   */
  inn.open = async (state, opts = {}) => {
    const data = await inn.load();
    const record = innForStage(opts.map);
    const name = opts.innName ?? record?.name;
    const price = opts.pricePerDigimon ?? record?.pricePerDigimon;
    // No record and no explicit override: that map has no inn. The original
    // never reaches the screen there, so neither do we.
    if (name == null || price == null) return null;

    inn._state = state;
    inn._open = true;
    inn._message = null;
    inn._sel = 0;
    inn.time = 0;
    // Open both windows from zero. Each of the original's three folds has its
    // own value word but the same 0xA steps, and each piece carries its own
    // pivot, so every piece animates on its own key off the one clock.
    inn._anim = {};
    for (const w of data.layout.windows) {
      // The third fold is NOT opened here. It is the refusal panel, raised only
      // when the player cannot pay (states 30-32 of the screen's own update).
      if (w.id === "alternate") continue;
      w.pieces.forEach((_, i) => { inn._anim[`${w.id}${i}`] = 0; });
    }
    inn._onClose = opts.onClose ?? null;
    inn._innName = name;
    inn._price = Math.max(0, Math.floor(price));
    inn._party = opts.party ?? partyOf(state);
    return quoteInnStay(inn._party, inn._price, state?.bits ?? 0);
  };

  inn.close = () => {
    inn._open = false;
    inn._message = null;
    const cb = inn._onClose;
    inn._onClose = null;
    cb?.();
  };

  // The original's two-row selector: logical button 4 latches row 0 and button
  // 6 latches row 1 (fns.s L1698-1745) — it does not wrap, because there is
  // nowhere to wrap to.
  inn.moveUp = () => { if (inn._sel !== 0) { inn._sel = 0; sfx?.play?.("cursor"); } };
  inn.moveDown = () => { if (inn._sel !== 1) { inn._sel = 1; sfx?.play?.("cursor"); } };

  inn.confirm = () => {
    // State 31 dismisses the refusal on CONFIRM and nothing else.
    if (inn._message) {
      inn._message = null; inn._refusal = false; inn._anim.alternate0 = null;
      return;
    }
    if (inn._sel !== 0) return inn.close();      // "Do not stay in Inn"
    const state = inn._state;
    const result = restAtInn(inn._party, inn._price, state?.bits ?? 0);
    if (!result.rested) {
      // ONLY the not-enough-BIT case is decoded. The empty-party case is a
      // walker fallback with no counterpart in the original, so it does not
      // get the decoded panel — it keeps the plain line it always had.
      inn._refusal = result.reason === "unaffordable";
      inn._message = inn._refusal
        ? (inn._data?.prompt?.unaffordable || "You don't have enough BIT!")
        : "No Digimon to rest.";
      if (inn._refusal) {
        // Raise the refusal panel from now, so it folds open the way the third
        // tween does; the message only appears once it has finished (state 30
        // waits on that fold before setting the text).
        const alt = inn._data?.layout?.windows?.find((w) => w.id === "alternate");
        alt?.pieces.forEach((_, i) => { inn._anim[`alternate${i}`] = inn.time; });
      }
      return;
    }
    if (state) {
      state.bits = result.bits;
      applyInnRest(state, inn._party, result.party);
      // A stay is a persistent transaction like the shop's: Continue has to see
      // the paid bits and the healed party. Until 2026-09-13 the screen wrote
      // only the live objects, so a reload restored the damage and the money.
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("bits", String(state.bits));
        localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
        localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
      }
    }
    sfx?.play?.("confirm");
    inn.close();
  };

  inn.cancel = () => {
    if (inn._message) { inn._message = null; inn._refusal = false; return; }
    inn.close();
  };

  inn.tick = (dt) => { if (inn._open) inn.time += dt; };

  // Screen space: call after ctx.restore(), same contract as choice.js.
  inn.draw = (ctx, viewW, viewH) => {
    if (!inn._open || !inn._data || !inn._pack) return;
    const L = inn._data.layout;
    const pack = inn._pack;
    const state = inn._state;

    // Native 320-wide PS1 space scaled up, so the decoded coordinates apply
    // verbatim — the same convention web/shop.js uses.
    const s = viewW / L.native_width;
    ctx.save();
    ctx.scale(s, s);

    const text = (str, x, y, gold = false) =>
      drawText(ctx, String(str), x, y, { kind: gold ? 3 : 1 });

    // The decoded fold: setScale(value, 0x1000, 0x1000) around the setAnchor
    // pivot issued just before each piece. Shared class, not a local copy.
    const piece = (key, p, fn) => {
      const tr = ui.foldTransformAtTime(
        inn.time, inn._anim[key] ?? null, p.pivot[0], p.pivot[1], "x", ANIM_T);
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
    const window = (id) => {
      const w = L.windows.find((x) => x.id === id);
      let ready = 1;
      w.pieces.forEach((p, i) => {
        ready = Math.min(ready, piece(`${id}${i}`, p,
          () => drawClip(ctx, pack, p.clip, p.x, p.y)));
      });
      return ready >= 1;
    };
    const widget = (id) => L.widgets.find((w) => w.id === id);

    // ── header: the inn's name, and what you can pay with ──
    if (window("header")) {
      const nm = widget("inn_name");
      text(inn._innName, nm.x, nm.y);
      const bits = widget("bits"), label = widget("bits_label");
      // Slot 0x148 right-aligns this line, so the decoded x is its RIGHT edge.
      const bitStr = formatBits(state?.bits ?? 0);
      text(bitStr, bits.x - textWidth(bitStr, 3), bits.y, true);
      text(inn._data.prompt.currency, label.x, label.y, true);
    }

    // ── the offer, and the two answers ──
    if (window("prompt")) {
      const pr = widget("price");
      // The refusal replaces this line in the original — they are one widget.
      if (!inn._refusal) {
      // "Each Digimon\n{1} BIT": the bank's own line. {1} is a control code
      // naming widget line 1, which the code sets to the price integer
      // (slot 0x118, line 1) — so the substitution is the original's, not ours.
      String(inn._data.prompt.price_line)
        .replace(/\\n/g, "\n")
        .replace("{1}", String(inn._price))
        .split("\n")
        .forEach((line, i) => text(line, pr.x, pr.y + i * L.cursor.row_pitch));
      }

      const rows = [
        [widget("option_stay"), inn._data.prompt.options[0]],
        [widget("option_leave"), inn._data.prompt.options[1]],
      ];
      rows.forEach(([w, label], i) => {
        text(label, w.x, w.y);
        if (i === inn._sel && !inn._message) {
          // Decoded motion: setPosition(0xB8, 0x5F + (sel << 4)).
          text(CURSOR,
            L.cursor.x + ui.cursorOffsetAtTime(inn.time),
            L.cursor.y + i * L.cursor.row_pitch, true);
        }
      });
    }

    // The refusal. DECODED 2026-08-14, ledger UI-INN-THIRD-FOLD-2026-08-14:
    // the third fold IS this, and its trigger is states 30-32 of the screen's
    // own update. State 30 waits for that fold to finish opening and then puts
    // eshtlnam string 0x14, "You don't have enough BIT!", into the SAME widget
    // that normally carries the offer — so the message replaces the price
    // rather than sitting under it. State 31 waits for the player's Confirm,
    // and state 32 waits for the fold to close again.
    if (inn._refusal) {
      if (window("alternate")) {
        const pr = widget("price");
        text(inn._message, pr.x, pr.y);
      }
    } else if (inn._message) {
      // Undecoded fallback: keep it out of the decoded panel.
      const pr = widget("price");
      text(inn._message, pr.x, pr.y + L.cursor.row_pitch * 2);
    }

    ctx.restore();
  };

  return inn;
}

// The screen prices and rests the DEPLOYED partner blocks, not the character
// ids. `state.party` is the charId list, so the old read handed restAtInn an
// array of strings and applyInnRest wrote hp/mp onto them -- committing a stay
// threw "Cannot create property 'hp' on string". Index 0 is the live
// partnerStats block, the rest are the partyStats slots.
function partyOf(state) {
  const chars = state?.party;
  if (!Array.isArray(chars) || !chars.length) return [];
  const stats = Array.isArray(state.partyStats) ? state.partyStats : [];
  return chars.map((_, i) => (i === 0 ? state.partnerStats : stats[i]) ?? {});
}

export function applyInnRest(state, before, after) {
  const chars = state?.party;
  if (!Array.isArray(chars) || !chars.length) return;
  const stats = Array.isArray(state.partyStats) ? state.partyStats : [];
  after.forEach((m, i) => {
    let target = i === 0 ? state.partnerStats : stats[i];
    if (!target) { target = {}; stats[i] = target; }
    if (Array.isArray(state.partyStats)) state.partyStats[i] = target;
    target.hp = m.hp;
    target.mp = m.mp;
    // F0x8001104c also zeroes three roster halfwords; the walker reads that as
    // clearing the status list. What those fields mean is NOT decoded — see
    // `open_gaps` in inn_ui.json.
    if (Array.isArray(m.status)) target.status = m.status;
    // The three halfwords ARE decoded now (EQUIP-C026): the persistent post-hit stat
    // penalty at roster +0x42/+0x44/+0x46, which `F0x8001104c` sets 0 on every present
    // slot and this rest is the disc's only clearing point for
    // (engine/dw3/battle-damage-terms.ts, engine/dw3/inn.ts `restAtInn`).
    target.statPenalty = { ...(m.statPenalty ?? { str: 0, def: 0, spd: 0 }) };
  });
}
