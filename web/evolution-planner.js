// web/evolution-planner.js — the forms a partner can still learn, and exactly what
// each one is waiting for.
//
// The Digimon Lab only draws a line once its first form is already learned, so every
// next step in a digivolution line is invisible until it fires. This page lists one
// roster slot's records in table order and, for each record, shows:
//   * the target form (digimon.json's name for record.to),
//   * its two form-level requirements with the current form level and the one asked for,
//   * the record's one extra gate in plain words — STR/DEF/SPT/WIS/SPD/CHR, the line's
//     own battle level, or one of the seven elemental stats,
//   * READY when every gate passes now: that record is the one the next battle report
//     learns (one acquisition per report, first passing record in table order).
//
// The rule is the disc's own unlock routine, pro/stfgtrep.s file 0x369C-0x390C
// (RAM 0x8008634C), documented in docs/research/battle/
// digivolution-tech-system-decoded-2026-07-11.md §5 and ported once to
// engine/dw3/evo-trees.ts. This page shows that same rule, it never re-invents one:
//   * the line is chosen by ROSTER SLOT (the eight pointers at 0x8008903C), not by the
//     form the member is in, so `slot` is the member's slot, not its species id;
//   * a record whose `to` is already in the ledger is skipped (the routine's `bgez`);
//   * a requirement form must EXIST in the ledger and its form level must be >= the
//     one asked for — a missing form is unmet, never ignored;
//   * kind 0 = no gate, 1..6 = the six core stats, 7 = the line's battle level,
//     8..14 = the seven element points. The browser unlock reads the TRAINED element
//     points (base 0 in engine/dw3/evo-trees.ts), so this page shows the number that
//     gate actually compares. Gear never touches a gate and the page never predicts
//     DVEXP: it only prints current vs target.
//
// The data is the same evolutions.json / digimon.json the battle reads, after
// web/extra-roster.js has merged the extra species and their line records, so a line
// can hold 44 records (the disc's) or 179 (with the extras) with no code change.
//
// OFF unless F2 -> Extras -> "Next forms planner (new)" is switched on (web/ambience.js).
// It opens on that switch's rising edge, owns the pad while it is up (Up/Down row,
// Left/Right partner, Cross/Start close) and draws over everything. With the switch off
// nothing is fetched, no press is read and the frame loop pays one comparison. The module
// is DOM-free at the top level so node tests import it; drawing takes a canvas context.

const CORE_STATS = ["str", "def", "spt", "wis", "spd", "chr"];   // rule kinds 1..6
const CORE_LABELS = { str: "STR", def: "DEF", spt: "SPT", wis: "WIS", spd: "SPD", chr: "CHR" };
const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"]; // rule kinds 8..14
const ELEMENT_LABELS = { fire: "Fire", water: "Water", ice: "Ice", wind: "Wind", thunder: "Thunder", machine: "Machine", dark: "Dark" };
const LIST_ROWS = 12;             // rows the list column shows at once; the cursor scrolls it
const ROW_H = 14;                 // one list line, in the page's own pixels

/** digimon.json's profile list, from the whole object or just the array. */
const asProfiles = (digimon) => (Array.isArray(digimon) ? digimon : digimon?.digimon ?? []);

/** A form's ledger level, from a plain object or a Map. undefined = not learned. */
function formLevelOf(formLevels, id) {
  if (formLevels instanceof Map) return formLevels.get(Number(id));
  return formLevels?.[Number(id)];
}

/** The record's one extra gate, as plain words. kind 0 = no gate. */
function extraGate(record) {
  const kind = Number(record?.kind ?? 0);
  const threshold = Number(record?.threshold ?? 0);
  if (kind === 0) return { kind: 0, key: null, label: null, threshold, text: "none" };
  if (kind >= 1 && kind <= 6) {
    const key = CORE_STATS[kind - 1];
    return { kind, key, label: CORE_LABELS[key], threshold, text: `${CORE_LABELS[key]} ${threshold}` };
  }
  if (kind === 7) return { kind, key: "level", label: "partner level", threshold, text: `partner level ${threshold}` };
  if (kind >= 8 && kind <= 14) {
    const key = ELEMENTS[kind - 8];
    return { kind, key, label: ELEMENT_LABELS[key], threshold, text: `${ELEMENT_LABELS[key]} ${threshold}` };
  }
  // A kind outside the rule's 0..14 is no gate at all (engine/dw3/evo-trees.ts's
  // evoTreeKindName answers null for it); never invent a requirement.
  return { kind: 0, key: null, label: null, threshold, text: "none" };
}

/** What the unlock's extra gate reads right now. null = the gate is kind 0 (no gate). */
function gateHave(record, live) {
  const gate = extraGate(record);
  if (gate.kind === 0) return null;
  if (gate.kind === 7) return Number(live?.level ?? 1);
  if (gate.kind >= 8 && gate.kind <= 14) return Number(live?.stats?.elemBonuses?.[gate.key] ?? 0);
  // kinds 1..6: the stored core stat plus the permanent stat-chip bonuses — the same
  // two halfwords engine/dw3/evo-trees.ts folds for the gate.
  return Number(live?.stats?.stats?.[gate.key] ?? 0) + Number(live?.stats?.bonuses?.[gate.key] ?? 0);
}

/** id -> display name for a digimon.json-shaped table or its bare profile array. */
function namesOf(profiles) {
  return new Map(asProfiles(profiles).map((p) => [Number(p.id), p.name]));
}

/** One record's requirement rows, names resolved through `nameOf`. */
function requirementsFor(record, nameOf) {
  const reqs = [];
  for (const [idKey, levelKey] of [["req0", "req0Level"], ["req1", "req1Level"]]) {
    const id = Number(record?.[idKey] ?? 0);
    if (!id) continue;
    const level = Number(record?.[levelKey] ?? 0);
    const name = nameOf.get(id) ?? `#${id}`;
    reqs.push({ id, name, level, text: `${name} L${level}` });
  }
  const gate = extraGate(record);
  const parts = reqs.map((r) => r.text);
  if (gate.kind !== 0) parts.push(gate.text);
  return { reqs, gate, text: parts.join(" + ") || "none" };
}

/**
 * One record's requirements in plain words (no live state): the source forms with the
 * form level each needs, and the extra gate's label and number. Pure.
 * Returns { reqs: [{ id, name, level, text }], gate: { kind, key, label, threshold, text },
 *           text } — text reads e.g. "Growlmon L30 + SPD 280", or "none" when the record
 * has no gate at all. A requirement id with no profile row is printed as "#<id>".
 */
export function requirementText(record, profiles) {
  return requirementsFor(record, namesOf(profiles));
}

/**
 * Does every gate of this record pass right now? Exactly the unlock routine's tests:
 * every non-zero requirement form must be in the member's ledger at the level asked
 * for, then the extra gate must reach its threshold. Pure.
 * `live` = { formLevels, level, stats }: the member's ledger, battle level and the
 * stored-stat record the battle reads (stats.stats / stats.bonuses / stats.elemBonuses).
 */
export function readyNow(record, live) {
  for (const [idKey, levelKey] of [["req0", "req0Level"], ["req1", "req1Level"]]) {
    const id = Number(record?.[idKey] ?? 0);
    if (!id) continue;
    const have = formLevelOf(live?.formLevels, id);
    if (have == null) return false;                      // a missing form is unmet, never ignored
    if (Number(have) < Number(record?.[levelKey] ?? 0)) return false;
  }
  const gate = extraGate(record);
  const have = gateHave(record, live);
  if (have != null && have < gate.threshold) return false;
  return true;
}

/**
 * The same gates with current/target filled in, for the detail panel and a row's one
 * line: { reqs: [{ ..., have, met, text }], gate: { ..., have, met, text }, unmet, ready,
 * text }. A requirement form not in the ledger reads "have 0". Pure.
 */
export function requirementProgress(record, live, profiles) {
  return progressFor(record, live, namesOf(profiles));
}

function progressFor(record, live, nameOf) {
  const base = requirementsFor(record, nameOf);
  const reqs = base.reqs.map((req) => {
    const raw = formLevelOf(live?.formLevels, req.id);
    const have = raw == null ? 0 : Number(raw);
    return { ...req, have, met: raw != null && have >= req.level, text: `${req.name} ${have}/${req.level}` };
  });
  const have = gateHave(record, live);
  const met = have == null || have >= base.gate.threshold;
  const gate = {
    ...base.gate,
    have,
    met,
    text: base.gate.kind === 0 ? "none" : `${base.gate.label} ${have}/${base.gate.threshold}`,
  };
  const unmet = [
    ...reqs.filter((r) => !r.met).map((r) => r.text),
    ...(base.gate.kind !== 0 && !met ? [gate.text] : []),
  ];
  const parts = [...reqs.map((r) => r.text)];
  if (base.gate.kind !== 0) parts.push(gate.text);
  const body = parts.join(" + ") || "none";
  return { reqs, gate, unmet, ready: unmet.length === 0, text: unmet.length ? body : `${body} — READY` };
}

/**
 * The forms one roster slot can still learn: that line's records in table order, minus
 * the forms already in the ledger (the unlock skips them), each as
 * { to, name, index, ready, unmet, text }. Pure.
 * `evolutions` is the whole evolutions.json (after the extra roster's merge) and `slot`
 * is the member's roster slot. `profiles` is digimon.json or its profile array;
 * `skills` is accepted because the page loads digimon.json whole, but no gate reads a
 * technique. Records appended to a line (or a whole line at a new slot, as the new
 * partners would add) are read without a code change.
 */
export function plannerRows(evolutions, slot, profiles, skills, live) {
  const lines = Array.isArray(evolutions?.lines) ? evolutions.lines : [];
  const wanted = Number(slot);
  const line = lines.find((l) => Number(l?.slot) === wanted) ?? lines[wanted];
  if (!line || !Array.isArray(line.records)) return [];
  const nameOf = namesOf(profiles);
  const rows = [];
  for (let i = 0; i < line.records.length; i++) {
    const record = line.records[i];
    const to = Number(record?.to ?? 0);
    if (!(to > 0)) continue;                                  // blez $s1 (file 0x373C)
    if (formLevelOf(live?.formLevels, to) != null) continue;  // bgez $v0 (file 0x3734)
    const progress = progressFor(record, live, nameOf);
    rows.push({
      to,
      name: nameOf.get(to) ?? `#${to}`,
      index: i,
      ready: progress.ready,
      unmet: progress.unmet,
      text: progress.text,
    });
  }
  return rows;
}

// ---------------------------------------------------------------- the page

const S = {
  open: false,
  wasOn: false,
  evolutions: null,
  profiles: [],
  skills: [],
  members: [],       // [{ slot, name, live: { formLevels, level, stats } }] from game.js
  index: 0,          // which party member is selected
  cursor: 0,         // which row of the selected line is highlighted
  rows: [],
  loading: null,
  error: null,
};

/** Close and forget everything (a test hook, and what a full reload leaves behind). */
export function plannerReset() {
  S.open = false;
  S.wasOn = false;
  S.evolutions = null;
  S.profiles = [];
  S.skills = [];
  S.members = [];
  S.index = 0;
  S.cursor = 0;
  S.rows = [];
  S.loading = null;
  S.error = null;
}

/** Recompute the selected member's rows and keep the cursor inside them. */
function syncRows() {
  if (!S.members.length) {
    S.index = 0;
    S.rows = [];
    S.cursor = 0;
    return S.rows;
  }
  S.index = Math.max(0, Math.min(S.index, S.members.length - 1));
  const member = S.members[S.index];
  S.rows = S.evolutions && member
    ? plannerRows(S.evolutions, member.slot, S.profiles, S.skills, member.live)
    : [];
  S.cursor = Math.max(0, Math.min(S.cursor, Math.max(0, S.rows.length - 1)));
  return S.rows;
}

const asJson = (value) => (typeof value?.json === "function" ? value.json() : value);

/**
 * Fetch the two tables through the page's own fetch, so web/extra-roster.js's wrapped
 * fetch has already merged the extra species and their line records. Cached per load;
 * `fetchJson` is injectable for tests. Never rejects.
 */
export function plannerLoad(fetchJson = globalThis.fetch) {
  if (S.loading) return S.loading;
  if (typeof fetchJson !== "function") return Promise.resolve(false);
  S.loading = (async () => {
    try {
      const [evolutions, digimon] = await Promise.all([
        Promise.resolve(fetchJson("assets/data/evolutions.json")).then(asJson),
        Promise.resolve(fetchJson("assets/data/digimon.json")).then(asJson),
      ]);
      setPlannerData(evolutions, digimon);
      S.error = null;
      return true;
    } catch (err) {
      S.error = String(err?.message ?? err);
      return false;
    } finally {
      S.loading = null;
    }
  })();
  return S.loading;
}

/**
 * Install tables and (optionally) the party snapshot. Returns the number of profiles
 * read. Used by plannerLoad and by tests; game.js only supplies the members.
 */
export function setPlannerData(evolutions, digimon, members = null) {
  S.evolutions = Array.isArray(evolutions?.lines) ? evolutions : null;
  S.profiles = asProfiles(digimon);
  S.skills = Array.isArray(digimon?.skills) ? digimon.skills : [];
  if (Array.isArray(members)) S.members = members;
  syncRows();
  return S.profiles.length;
}

/**
 * Follow F2 -> Extras -> "Next forms planner (new)". Opens once on the switch's rising
 * edge and closes when it turns off; Cross/Start closes it while the switch stays on,
 * and cycling the switch off and on opens it again. `snapshot` is game.js's live party
 * reader: () => ({ members: [{ slot, name, live }] }). With the switch off nothing is
 * fetched and the snapshot is never called.
 */
export function tickPlanner(enabled, snapshot = null) {
  const on = enabled === true;
  if (on && !S.wasOn) {
    S.open = true;
    S.index = 0;
    S.cursor = 0;
    if (!S.evolutions && !S.loading) plannerLoad();
  } else if (!on && S.wasOn) {
    S.open = false;
  }
  S.wasOn = on;
  if (S.open) {
    if (typeof snapshot === "function") {
      const snap = snapshot();
      if (Array.isArray(snap?.members)) S.members = snap.members;
    }
    syncRows();
  }
  return S.open;
}

/** Is the page up? (game.js freezes the field and routes the pad to it while true.) */
export function plannerOpen() {
  return S.open;
}

/** The rows of the selected partner's line, in table order. */
export function plannerRowsNow() {
  return S.rows;
}

/** Which row the cursor is on. */
export function plannerCursor() {
  return S.cursor;
}

/** The selected party member (game.js's snapshot entry), or null before a party. */
export function plannerSelection() {
  return S.members[S.index] ?? null;
}

/** Why the last load failed, or null. */
export function plannerError() {
  return S.error;
}

/**
 * The pad while the page is up: Up/Down the row, Left/Right the partner, Cross/Start
 * close, every other press swallowed. Returns false when the page is closed, so the
 * press falls through exactly as before.
 */
export function plannerPress(button) {
  if (!S.open) return false;
  if (button === "left" || button === "right") {
    const n = S.members.length;
    if (n) S.index = (S.index + (button === "right" ? 1 : n - 1)) % n;
    S.cursor = 0;
    syncRows();
  } else if (button === "up") {
    S.cursor = Math.max(0, S.cursor - 1);
  } else if (button === "down") {
    S.cursor = Math.min(Math.max(0, S.rows.length - 1), S.cursor + 1);
  } else if (button === "cross" || button === "start") {
    S.open = false;
  }
  return true;
}

/** Break text into lines no longer than `cols` characters, on spaces. */
function wrapText(text, cols) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= cols) line += " " + word;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

function drawPage(ctx, W, H, message) {
  ctx.save();
  ctx.fillStyle = "rgba(4,6,12,0.96)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#c9a54a";
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 10, W - 24, H - 20);
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(17, 15, W - 34, H - 30);
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.font = "bold 16px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText("NEXT FORMS", W / 2, 24);
  ctx.font = "12px monospace";
  ctx.fillStyle = "#d8e2f0";
  for (const [i, line] of wrapText(message, 56).entries()) ctx.fillText(line, W / 2, H / 2 - 20 + i * 16);
  ctx.restore();
}

/**
 * Draw the page over the whole view (640x480 in the game). Returns false when the page
 * is closed; closed, it makes no canvas call at all.
 */
export function plannerDraw(ctx, W = 640, H = 480) {
  if (!S.open) return false;
  if (S.error) {
    drawPage(ctx, W, H, `The evolution tables could not be read: ${S.error}`);
    return true;
  }
  if (!S.evolutions && !S.rows.length) {
    drawPage(ctx, W, H, "Reading the evolution tables…");
    return true;
  }
  if (!S.members.length) {
    drawPage(ctx, W, H, "No partner yet — finish the Starter Pack download first.");
    return true;
  }

  const x = Math.round(W * 0.03);
  const y = Math.round(H * 0.02);
  const w = W - 2 * x;
  const h = H - 2 * y;
  const left = x + 14;
  const member = S.members[S.index];
  const row = S.rows[Math.max(0, Math.min(S.cursor, S.rows.length - 1))] ?? null;

  ctx.save();
  // the page
  ctx.fillStyle = "rgba(4,6,12,0.96)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#c9a54a";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // header
  ctx.font = "bold 16px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText("NEXT FORMS", left, y + 12);
  ctx.font = "11px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText("the forms your partner can still learn", left + 128, y + 17);
  ctx.textAlign = "right";
  ctx.fillStyle = "#9fd0ff";
  ctx.fillText(`${S.index + 1} / ${S.members.length} partners`, x + w - 16, y + 16);
  ctx.textAlign = "left";

  // the selected partner: its roster slot is the line the unlock scans
  ctx.font = "bold 14px monospace";
  ctx.fillStyle = "#ffe9a8";
  ctx.fillText(`${member.name}`, left, y + 34);
  ctx.font = "10px monospace";
  ctx.fillStyle = "#8a93a8";
  const form = member.live?.stats?.digimonId != null
    ? S.profiles.find((p) => Number(p.id) === Number(member.live.stats.digimonId))?.name ?? ""
    : "";
  ctx.fillText(`roster slot ${member.slot}  ·  Lv ${member.live?.level ?? 1}${form ? `  ·  ${form}` : ""}  ·  ${S.rows.length} forms left`, left, y + 53);

  const top = y + 70;
  const bottom = y + h - 28;
  const listX = left;
  const listW = Math.round(w * 0.46);
  const dx = listX + listW + 14;
  const dw = x + w - 16 - dx;

  if (!S.rows.length) {
    ctx.font = "12px monospace";
    ctx.fillStyle = "#9ad0a8";
    ctx.fillText("Every form in this line is already learned.", left, top + 10);
  } else {
    // the list: a window of rows around the cursor, READY badges on the right
    const first = Math.max(0, Math.min(S.cursor - Math.floor(LIST_ROWS / 2), Math.max(0, S.rows.length - LIST_ROWS)));
    const shown = Math.min(LIST_ROWS, S.rows.length - first);
    for (let i = 0; i < shown; i++) {
      const r = S.rows[first + i];
      const at = top + i * ROW_H;
      const hit = first + i === S.cursor;
      if (hit) {
        ctx.fillStyle = "rgba(201,165,74,0.22)";
        ctx.fillRect(listX - 2, at - 2, listW - 4, ROW_H);
      }
      ctx.font = "10px monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = hit ? "#ffe9a8" : r.ready ? "#9ad0a8" : "#c8d2e2";
      ctx.fillText(`${hit ? ">" : " "} ${r.name}`, listX, at);
      if (r.ready) {
        ctx.fillStyle = "#6fe08a";
        ctx.textAlign = "right";
        ctx.fillText("READY", listX + listW - 8, at);
        ctx.textAlign = "left";
      }
    }
    ctx.font = "9px monospace";
    ctx.fillStyle = "#5f6b80";
    ctx.fillText(`rows ${first + 1}-${first + shown} of ${S.rows.length}, table order`, listX, bottom - 2);
  }

  // the open row: target, the READY verdict, and every gate with current/target
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.strokeRect(dx - 8, top - 6, dw, bottom - top + 6);
  ctx.textAlign = "left";
  if (row) {
    let ty = top + 2;
    ctx.font = "bold 14px monospace";
    ctx.fillStyle = "#ffd34d";
    ctx.fillText(`${row.name}  #${row.to}`, dx, ty);
    ty += 20;
    ctx.font = "10px monospace";
    ctx.fillStyle = row.ready ? "#6fe08a" : "#8a93a8";
    ctx.fillText(row.ready ? "READY — the next battle report learns it." : "Waiting for:", dx, ty);
    ty += 16;
    ctx.fillStyle = "#d8e2f0";
    const lines = wrapText(row.text, 44);
    for (const line of lines.slice(0, 3)) {
      ctx.fillText(line, dx, ty);
      ty += 13;
    }
    ty += 6;
    if (!row.ready) {
      ctx.font = "9px monospace";
      ctx.fillStyle = "#6fd0a8";
      ctx.fillText("current / target", dx, ty);
      ty += 14;
      ctx.fillStyle = "#a8b6cc";
      ctx.fillText("form levels come from the ledger;", dx, ty);
      ty += 11;
      ctx.fillText("gates read stats and element points.", dx, ty);
    }
    ctx.font = "9px monospace";
    ctx.fillStyle = "#8a93a8";
    const step = S.rows.indexOf(row) + 1;
    ctx.fillText(`step ${step} of ${S.rows.length}`, dx, bottom - 18);
  } else {
    ctx.font = "11px monospace";
    ctx.fillStyle = "#8a93a8";
    ctx.fillText("Nothing to show for this line.", dx, top + 6);
  }

  // controls, in the page's own margin
  ctx.font = "10px monospace";
  ctx.fillStyle = "#7a90b0";
  ctx.textAlign = "left";
  ctx.fillText("Up / Down: form    Left / Right: partner    Cross / Start: close", left, bottom + 8);
  ctx.restore();
  return true;
}
