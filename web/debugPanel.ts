// web/debugPanel.js
// In-game partner debug editor. Toggle with the `~`/backquote key. Lets you live-edit the
// lead partner's level, EXP, TP, HP/MP, stat bonuses, bits, and grant any item — useful for
// testing leveling / evolution / item flows without grinding. All edits write through to
// state.partnerStats / state.inventory / state.bits and persist to localStorage, exactly
// like the battle/menu/shop code paths do.
import { heldCount, ITEMS, storeAddItem } from "./vendor/engine.js";
import { scaledStat } from "./battle.js";

const FISHING_POLE_ID = 5;
const TREE_BOOTS_ID = 4;

/** Grant the collection item that makes the fishing-spot predicate 0x8005 true. */
export function grantFishingPole(state) {
  if (heldCount(state, FISHING_POLE_ID) > 0) return false;
  storeAddItem(state, FISHING_POLE_ID, 1);
  return true;
}

/** Grant the collection item that makes the tree-kick predicate 0x8004 true. */
export function grantTreeBoots(state) {
  if (heldCount(state, TREE_BOOTS_ID) > 0) return false;
  storeAddItem(state, TREE_BOOTS_ID, 1);
  return true;
}

export function createDebugPanel() {
  const d = { enabled: false, sel: 0, itemIdx: 0, evoIdx: 0, msg: null };

  // Evolution targets the partner currently qualifies for (level/form/stat-gated). Recomputed
  // live so editing Level/stats above immediately changes what's offered here.
  const evosFor = (state) => window.__battle?.availableEvolutions?.(state) ?? [];

  // Field model. Each numeric field reads/writes a number; `set` clamps + persists.
  // Level changes recompute max HP/MP from the partner profile (same formula as a real
  // level-up) so the visible scaled stats track the new level.
  function persist(state) {
    localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
    localStorage.setItem("inventory", JSON.stringify(state.inventory));
    localStorage.setItem("bits", String(state.bits ?? 0));
  }

  function recomputeMax(state) {
    const ps = state.partnerStats;
    const prof = window.__battle?.getPlayerProfile?.(state);
    if (!prof) return;
    const lvl = ps.level ?? 1;
    ps.maxHp = scaledStat(prof, "hp", lvl) + (ps.bonuses?.hp ?? 0);
    ps.maxMp = scaledStat(prof, "mp", lvl) + (ps.bonuses?.mp ?? 0);
    ps.hp = Math.min(ps.hp, ps.maxHp);
    ps.mp = Math.min(ps.mp, ps.maxMp);
  }

  // bonus(stat) accessors live under ps.bonuses[stat] (added on top of the scaled base).
  const bonus = (stat) => ({
    label: `+${stat.toUpperCase()}`, step: 1, min: 0,
    get: (ps) => ps.bonuses?.[stat] ?? 0,
    set: (ps, v) => { ps.bonuses = ps.bonuses ?? {}; ps.bonuses[stat] = Math.max(0, v); },
  });

  const FIELDS = [
    { label: "Level", step: 1, min: 1, get: (ps) => ps.level ?? 1,
      set: (ps, v, state) => { ps.level = Math.max(1, v); recomputeMax(state); } },
    { label: "EXP", step: 10, min: 0, get: (ps) => ps.xp ?? 0, set: (ps, v) => { ps.xp = Math.max(0, v); } },
    { label: "TP", step: 1, min: 0, get: (ps) => ps.tp ?? 0, set: (ps, v) => { ps.tp = Math.max(0, Math.min(99, v)); } },
    { label: "HP", step: 10, min: 0, get: (ps) => ps.hp, set: (ps, v) => { ps.hp = Math.max(0, Math.min(v, ps.maxHp)); } },
    { label: "Max HP", step: 10, min: 1, get: (ps) => ps.maxHp, set: (ps, v) => { ps.maxHp = Math.max(1, v); ps.hp = Math.min(ps.hp, ps.maxHp); } },
    { label: "MP", step: 5, min: 0, get: (ps) => ps.mp, set: (ps, v) => { ps.mp = Math.max(0, Math.min(v, ps.maxMp)); } },
    { label: "Max MP", step: 5, min: 1, get: (ps) => ps.maxMp, set: (ps, v) => { ps.maxMp = Math.max(1, v); ps.mp = Math.min(ps.mp, ps.maxMp); } },
    bonus("str"), bonus("def"), bonus("spt"), bonus("wis"), bonus("spd"), bonus("chr"),
  ];
  const BITS_ROW = FIELDS.length;       // virtual row for state.bits
  const GIVE_ROW = FIELDS.length + 1;   // virtual row for the item granter
  const EVO_ROW  = FIELDS.length + 2;   // virtual row for the evolution trigger
  const DIVE_ROW = FIELDS.length + 3;   // virtual row for underground dive access
  const FISH_ROW = FIELDS.length + 4;   // virtual row for immediate fishing access
  const TREE_ROW = FIELDS.length + 5;   // virtual row for immediate tree-kick access
  const ROWS = FIELDS.length + 6;

  // Underground dive access. Two things gate a dive, and only one of them is the item:
  //   • DE Sincerity (item 16) calls Submarinemon -> the WATER dives, step op 10,
  //     which every one of the 61 shipped op-10 exits gates on flag 0x7093;
  //   • DE Knowledge (item 17) calls Digmon -> the HOLE dives, step op 9, gated by
  //     0x7094 on all 76 op-9 exits.
  // Both flags are bank-0x70 op-0x30 records (roster_predicate_table keys 147/148),
  // i.e. progress-ordinal RANGES, not possession tests: 0x7093 opens at ordinal 15
  // and 0x7094 at ordinal 30. So granting the eggs alone leaves every dive shut.
  // This grants both and raises the ordinal to 30 if it is lower (never lowers it).
  const DIVE_ITEMS = [16, 17];
  const DIVE_ORDINAL = 30;

  function grantDiveAccess(state) {
    for (const id of DIVE_ITEMS) {
      if (heldCount(state, id) === 0) storeAddItem(state, id, 1);
    }
    const engine = window.__engine;
    const before = Number(engine?.state.vars.get("$story.ordinal") ?? 0);
    const after = Math.max(before, DIVE_ORDINAL);
    engine?.state.vars.set("$story.ordinal", after);
    persist(state);
    return { before, after };
  }

  d.toggle = () => { d.enabled = !d.enabled; d.sel = 0; d.msg = null; };

  // Returns true when the key was consumed (so game.js doesn't also act on it).
  d.handleKey = (k, state) => {
    if (!d.enabled) return false;
    if (!state.partnerStats) return true;
    const ps = state.partnerStats;
    const big = 1; // (modifier handling is done by caller passing shift via k? kept simple)

    if (k === "arrowup")   { d.sel = (d.sel - 1 + ROWS) % ROWS; d.msg = null; return true; }
    if (k === "arrowdown") { d.sel = (d.sel + 1) % ROWS; d.msg = null; return true; }

    if (d.sel === GIVE_ROW) {
      if (k === "arrowleft")  { d.itemIdx = (d.itemIdx - 1 + ITEMS.length) % ITEMS.length; return true; }
      if (k === "arrowright") { d.itemIdx = (d.itemIdx + 1) % ITEMS.length; return true; }
      if (k === " " || k === "enter") {
        const item = ITEMS[d.itemIdx];
        storeAddItem(state, item.id, 1);
        persist(state);
        d.msg = `Gave ${item.name}.`;
        return true;
      }
      return true;
    }

    if (d.sel === EVO_ROW) {
      const evos = evosFor(state);
      if (!evos.length) { d.msg = "No evolution available at this level/stats."; return true; }
      if (d.evoIdx >= evos.length) d.evoIdx = 0;
      if (k === "arrowleft")  { d.evoIdx = (d.evoIdx - 1 + evos.length) % evos.length; return true; }
      if (k === "arrowright") { d.evoIdx = (d.evoIdx + 1) % evos.length; return true; }
      if (k === " " || k === "enter") {
        const r = window.__battle?.applyEvolution?.(evos[d.evoIdx].to);
        d.msg = r?.ok ? `${r.from} → ${r.name}!` : "Evolution failed.";
        d.evoIdx = 0;
        return true;
      }
      return true;
    }

    if (d.sel === DIVE_ROW) {
      if (k === " " || k === "enter") {
        const { before, after } = grantDiveAccess(state);
        d.msg = `DE Sincerity + DE Knowledge given; ordinal ${before} → ${after}. `
              + `Water dives open at 15, hole dives at 30.`;
        return true;
      }
      return true;
    }

    if (d.sel === FISH_ROW) {
      if (k === " " || k === "enter") {
        const granted = grantFishingPole(state);
        persist(state);
        d.msg = granted
          ? "Fishing Pole given — spots active."
          : "Pole already owned — spots active.";
        return true;
      }
      return true;
    }

    if (d.sel === TREE_ROW) {
      if (k === " " || k === "enter") {
        const granted = grantTreeBoots(state);
        persist(state);
        d.msg = granted
          ? "TreeBoots given — kick any tree."
          : "Boots already owned — kick any tree.";
        return true;
      }
      return true;
    }

    let delta = 0;
    if (k === "arrowleft")  delta = -1;
    if (k === "arrowright") delta = +1;
    if (delta === 0) return true;

    if (d.sel === BITS_ROW) {
      state.bits = Math.max(0, (state.bits ?? 0) + delta * 100);
    } else {
      const f = FIELDS[d.sel];
      f.set(ps, f.get(ps) + delta * f.step, state);
    }
    persist(state);
    return true;
  };

  d.drawOverlay = (ctx, W, H, state) => {
    if (!d.enabled) return;
    const ps = state.partnerStats;
    const x = 16, w = 260, lh = 18;
    const rows = ROWS + 3;
    // Sit at y=60 when there is room, else ride up so the last row and the
    // result message stay on screen — the row list grows as tools are added.
    const y = Math.max(4, Math.min(60, H - (rows * lh + 24)));
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.82)";
    ctx.fillRect(x, y, w, rows * lh + 20);
    ctx.strokeStyle = "#0af"; ctx.strokeRect(x, y, w, rows * lh + 20);
    ctx.font = "12px monospace"; ctx.textBaseline = "top";
    ctx.fillStyle = "#0af";
    ctx.fillText("DEBUG — Partner (~ to close)", x + 8, y + 6);
    ctx.fillText("↑↓ select  ←→ adjust  ⏎ give", x + 8, y + 6 + lh);

    if (!ps) { ctx.fillStyle = "#f88"; ctx.fillText("No partner yet.", x + 8, y + 8 + lh * 2); ctx.restore(); return; }
    let row = 0;
    const line = (label, val, idx) => {
      const yy = y + 14 + lh * (2 + row++);
      ctx.fillStyle = idx === d.sel ? "#ffe000" : "#cde";
      ctx.fillText(`${idx === d.sel ? "▶ " : "  "}${label}`, x + 8, yy);
      ctx.fillText(String(val), x + w - 70, yy);
    };
    FIELDS.forEach((f, i) => line(f.label, f.get(ps), i));
    line("Bits", state.bits ?? 0, BITS_ROW);
    const item = ITEMS[d.itemIdx];
    line(`Give ◀ ${item?.name ?? "-"} ▶`, "[⏎]", GIVE_ROW);
    const evos = evosFor(state);
    const evoName = evos.length ? (evos[Math.min(d.evoIdx, evos.length - 1)]?.to ?? "-") : "(none)";
    line(`Evolve ◀ ${evoName} ▶`, "[⏎]", EVO_ROW);
    const ord = Number(window.__engine?.state.vars.get("$story.ordinal") ?? 0);
    const have = (id) => heldCount(state, id) > 0;
    const diveState = `${have(16) && ord >= 15 ? "water" : "-"}/${have(17) && ord >= 30 ? "hole" : "-"}`;
    line(`Dive access (${diveState})`, "[⏎]", DIVE_ROW);
    line(`Fishing access (${have(FISHING_POLE_ID) ? "ready" : "locked"})`, "[⏎]", FISH_ROW);
    line(`Tree kicking (${have(TREE_BOOTS_ID) ? "ready" : "locked"})`, "[⏎]", TREE_ROW);

    if (d.msg) { ctx.fillStyle = "#6f6"; ctx.fillText(d.msg, x + 8, y + 14 + lh * (2 + ROWS)); }
    ctx.restore();
  };

  return d;
}
