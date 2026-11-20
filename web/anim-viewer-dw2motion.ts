// K25 — DIGIMON WORLD 2 MOTION, FOR EVERY DIGIMON THAT HAS IT.
//
// The batch build (tools/build_dw2_motion.py, K22c) wrote ONE generated file per matched species at
// web/assets/battle/dw2motion/<folder>.json (git-ignored: derived from the user's own DW2 disc). Each
// file says which clip slots the body OWNS, which are gaps, and — per DW2 motion letter A..K — the
// retargeted keys, the timeline table they were written to, and the swap gate's numbers/verdict.
//
// This module is the viewer's side of those files, and nothing else:
//
//   * `dw2Rows(data)` — one row per clip slot: filled (which DW2 letter, which table), refused (the
//     gate's failing keys, from the numbers the file carries), owned (the body's own clip, untouched),
//     or not applicable (the presentation slot 12).
//   * `buildClone(rawModel, data)` — a COPY of the body's anim.json with the DW2 keys merged in, the
//     way web/fight/dw2-motion.js merges them in the game, except that the table index is allocated in
//     the copy (part of the batch build's table indices land on tables the body already uses, and
//     applyMotion refuses to overwrite one — so in the game those motions are silently dropped; here
//     the copy is ours, so every used motion gets a free table).
//   * the in-memory model folder (`<folder>-dw2m`) that carries the clone into web/battle3d.js through
//     the same three-URL shim anim-viewer-bake.js / anim-viewer-generic.js use. Everything after that
//     is the ordinary DW3 path: same renderer, textures, free camera, scrubber, speed, loop.
//   * the panel (DOM) and the deep link `?dw2fill=<slot>&model=<folder>[&letter=F][&ab=own]`.
//
// Ratings live in the generic-motion store (anim-viewer-generic.js) with kind "dw2" and the motion id
// `dw2:<slot>`, so the Ratings tab and its JSON export carry both kinds and stay separable.
import { MODEL_ANIM, MODEL_TEXTURE } from "./anim-viewer-bake.js";
import { DW2_CLIP_MAP } from "./fight/dw2-clip-map.js";
import { kindOfSlot, judgeNumbers, WORLD_BARS } from "./fight/motion-swap-gate.js";

export const DW2_ROOT = "assets/battle/dw2motion";
export const dw2FileUrl = (folder, root = DW2_ROOT) => `${root}/${folder}.json`;
export const ratingId = (slot) => `dw2:${slot}`;

/** What each clip slot is, in the words the viewer's own clip list uses. */
export const SLOT_LABELS = {
  0: "idle", 1: "hit (light)", 2: "hit / survive", 3: "death", 4: "evade",
  5: "normal attack", 6: "combo", 7: "combo (2-beat)", 8: "combo (3-beat)",
  9: "spell", 10: "item / self cast", 11: "special / signature", 12: "presentation (not the model's)",
  13: "volley", 14: "thrown-item arm", 15: "thrown special", 16: "spell variant", 17: "thrown-item reaction",
};
export const slotLabel = (slot) => SLOT_LABELS[slot] || `clip ${slot}`;

// ── the file, as rows ────────────────────────────────────────────────────────────────────────────
/** True when the baked keys never change — the motion plays but holds one pose (a defect in the file). */
export function motionIsStatic(m) {
  if (!m?.keys || !Object.keys(m.keys).length) return true;
  let spread = 0;
  for (const rows of Object.values(m.keys)) {
    if (!Array.isArray(rows) || rows.length < 2) continue;
    for (let ch = 0; ch < 3; ch++) {
      let lo = Infinity, hi = -Infinity;
      for (const r of rows) { if (r[ch] < lo) lo = r[ch]; if (r[ch] > hi) hi = r[ch]; }
      spread = Math.max(spread, hi - lo);
    }
  }
  if (m.ch1 && typeof m.ch1 === "object" && !Array.isArray(m.ch1)) {
    for (const rows of Object.values(m.ch1)) {
      if (!Array.isArray(rows) || rows.length < 2) continue;
      for (let ch = 1; ch < 3; ch++) {
        let lo = Infinity, hi = -Infinity;
        for (const r of rows) { if (r[ch] < lo) lo = r[ch]; if (r[ch] > hi) hi = r[ch]; }
        spread = Math.max(spread, hi - lo);
      }
    }
  }
  return spread === 0;
}

/** The motions that fill `slot`: gate-passed, and the build says this slot is one of its gaps. */
export function fillersFor(data, slot) {
  const row = DW2_CLIP_MAP[slot];
  if (!row || !row.letters.length) return [];
  if (data?.ownedSlots?.includes(slot) || !data?.gapSlots?.includes(slot)) return [];
  const out = [];
  for (const letter of row.letters) {
    const m = data.motions?.[letter];
    if (!m || !m.used) continue;
    if (Array.isArray(m.gaps) && m.gaps.length && !m.gaps.includes(slot)) continue;
    out.push({ letter, table: m.table | 0, frames: m.frames | 0, kind: m.kind || row.kind, gate: m.gate || null, static: motionIsStatic(m) });
  }
  return out;
}

/** Why a gap slot has no DW2 motion: the gate keys the file's own numbers fail, or "not baked". */
export function refusalFor(data, slot) {
  const row = DW2_CLIP_MAP[slot];
  if (!row || !row.letters.length) return [{ letter: null, keys: ["no donor motion for this clip kind"], notes: [] }];
  const kind = kindOfSlot(slot);
  const out = [];
  for (const letter of row.letters) {
    const m = data?.motions?.[letter];
    if (!m) { out.push({ letter, keys: ["not baked for this body"], notes: [] }); continue; }
    if (m.used) continue;
    let keys = [], notes = [];
    try {
      const j = judgeNumbers(m.gate || {}, kind, { bars: WORLD_BARS[kind] || null });
      keys = j.keys || [];
      notes = j.notes || [];
    } catch { keys = []; }
    out.push({ letter, keys: keys.length ? keys : (m.gate ? ["the build's gate" ] : ["not baked for this body"]), notes, frames: m.frames | 0, table: m.table });
  }
  return out;
}

/**
 * One row per engine clip slot (0..17). status:
 *   "filled"  — a DW2 motion passed the gate and fills it here (letters[] to play)
 *   "refused" — it is a gap for this body and DW2 had a motion, but the gate refused it (refused[])
 *   "owned"   — the body plays its OWN clip here; DW2 never replaces an authored clip
 *   "none"    — clip 12 (the presentation actor's), or a slot with no donor motion at all
 */
export function dw2Rows(data) {
  const rows = [];
  for (let slot = 0; slot <= 17; slot++) {
    if (slot === 12) { rows.push({ slot, status: "none", letters: [], refused: [], label: slotLabel(slot) }); continue; }
    const owned = !!data?.ownedSlots?.includes(slot);
    const letters = fillersFor(data, slot);
    if (letters.length) rows.push({ slot, status: "filled", letters, refused: [], label: slotLabel(slot) });
    else if (owned) rows.push({ slot, status: "owned", letters: [], refused: [], label: slotLabel(slot) });
    else if (data?.gapSlots?.includes(slot)) rows.push({ slot, status: "refused", letters: [], refused: refusalFor(data, slot), label: slotLabel(slot) });
    else rows.push({ slot, status: "none", letters: [], refused: [], label: slotLabel(slot) });
  }
  return rows;
}

/** Counts for the panel header and the species marker. */
export function dw2Counts(data) {
  const rows = dw2Rows(data);
  const filled = rows.filter((r) => r.status === "filled");
  return {
    owned: rows.filter((r) => r.status === "owned").length,
    gaps: rows.filter((r) => r.status === "filled" || r.status === "refused").length,
    filled: filled.length,
    refused: rows.filter((r) => r.status === "refused").length,
    slots: filled.map((r) => r.slot),
  };
}

/** The filled row's default letter (F for a cast, the only letter otherwise). */
export const defaultLetter = (row) => row?.letters?.[0]?.letter ?? null;
/** The table a (slot, letter) plays in the clone, or null. */
export function tableFor(tables, slot, letter, data) {
  const hit = fillersFor(data, slot).find((f) => !letter || f.letter === letter);
  return hit ? tables?.[hit.letter] ?? null : null;
}

// ── the hand picks (web/dw2-motion-picks.json; the game reads it through web/fight/dw2-picks.js) ──
/** Every gate-passed DW2 motion for `slot`, owned slot or not (a hand pick may override ownership). */
export function pickLetters(data, slot) {
  const row = DW2_CLIP_MAP[slot];
  if (!row || !row.letters.length) return [];
  const out = [];
  for (const letter of row.letters) {
    const m = data?.motions?.[letter];
    if (!m || !m.used) continue;
    out.push({ letter, table: m.table | 0, frames: m.frames | 0, kind: m.kind || row.kind, gate: m.gate || null, static: motionIsStatic(m) });
  }
  return out;
}
/** One row per slot a pick can change: it has a DW2 motion. `rule` = what the automatic rule plays there. */
export function pickRows(data) {
  const out = [];
  for (let slot = 0; slot <= 17; slot++) {
    if (slot === 12) continue;
    const letters = pickLetters(data, slot);
    if (!letters.length) continue;
    const owned = !!data?.ownedSlots?.includes(slot);
    out.push({ slot, label: slotLabel(slot), owned, letters, rule: fillersFor(data, slot).length ? "dw2" : "dw3" });
  }
  return out;
}

// ── the clone (the body's own anim.json + the DW2 keys in a free table) ─────────────────────────
const TERM = 30000;
const empty = (t) => ({ table: t || [] });

/** The first table index this model does not use AND no motion has taken yet. */
export function freeTable(model, taken = new Set()) {
  let i = 0;
  const tl = model?.timeline || [];
  for (let t = 0; t < tl.length; t++) if ((tl[t]?.table || []).length) i = t + 1;
  while (taken.has(i) || (tl[i]?.table || []).length) i++;
  return i;
}

function appendRows(rows, into) {
  if (!Array.isArray(rows) || !rows.length) return into;
  const own = (into ?? []).filter((r) => r[3] !== TERM).map((r) => r.slice());
  const last = rows[rows.length - 1];
  return [...own, ...rows.map((r) => r.slice()), [last[0], last[1], last[2], TERM]];
}

/** Merge one motion into `model` in place, at `table`. Mirrors web/fight/dw2-motion.js's applyMotion. */
export function mergeMotion(model, letter, motion, table) {
  if (!model || !motion?.keys || !Object.keys(motion.keys).length) return false;
  if (!Array.isArray(motion.playlist) || !motion.playlist.length) return false;
  if (!Array.isArray(model.timeline)) model.timeline = [];
  for (const [idx, rows] of Object.entries(motion.keys)) {
    const i = idx | 0;
    const bone = model.bones?.[i];
    if (!bone) continue;
    const anim = { ...(bone.anim || {}) };
    anim.ch2 = appendRows(rows, anim.ch2);
    model.bones[i] = { ...bone, anim };
  }
  if (motion.ch1) {
    const byBone = Array.isArray(motion.ch1) ? { [motion.rootBone ?? 0]: motion.ch1 } : motion.ch1;
    for (const [idx, rows] of Object.entries(byBone)) {
      const i = idx | 0;
      if (!rows?.length || !model.bones?.[i]) continue;
      const bone = model.bones[i];
      const anim = { ...(bone.anim || {}) };
      anim.ch1 = appendRows(rows, anim.ch1);
      model.bones[i] = { ...bone, anim };
    }
  }
  while (model.timeline.length <= table) model.timeline.push(empty());
  model.timeline[table] = { table: motion.playlist.map((e) => ({ ...e })) };
  return true;
}

/**
 * A deep copy of `raw` with every gate-passed DW2 motion merged, each in a free timeline table.
 * Returns { model, tables: {letter: table}, failed: {letter: {keys}}, filled: [letters] }.
 */
export function buildClone(raw, data) {
  const model = JSON.parse(JSON.stringify(raw || {}));
  const tables = {}, failed = {}, filled = [], taken = new Set();
  if (!model || !data?.motions) return { model, tables, failed, filled };
  for (const [letter, m] of Object.entries(data.motions)) {
    if (!m?.used) { failed[letter] = { keys: refusalForLetter(data, letter) }; continue; }
    const table = Number.isInteger(m.table) && !((model.timeline?.[m.table]?.table || []).length) && !taken.has(m.table)
      ? m.table : freeTable(model, taken);
    if (!mergeMotion(model, letter, m, table)) { failed[letter] = { keys: ["the file has no keys for this motion"] }; continue; }
    taken.add(table);
    tables[letter] = table;
    filled.push(letter);
  }
  return { model, tables, failed, filled };
}

function refusalForLetter(data, letter) {
  for (let slot = 0; slot <= 17; slot++) {
    for (const r of refusalFor(data, slot)) if (r.letter === letter && r.keys?.length) return r.keys;
  }
  return ["the gate refused it"];
}

// ── the in-memory model folder ──────────────────────────────────────────────────────────────────
const safeId = (s) => String(s || "").replace(/[^A-Za-z0-9_]/g, "_");
const DW2_FOLDER = /^(.+)-dw2m$/;
export const dw2Folder = (folder) => `${folder}-dw2m`;
export const isDw2Folder = (f) => DW2_FOLDER.test(String(f || ""));
export const dw2RealFolder = (f) => DW2_FOLDER.exec(String(f || ""))?.[1] ?? null;

/** Clones by their virtual folder. Bounded; the renderer keeps its own copy once loaded. */
export function createDw2Store(limit = 6) {
  const map = new Map();
  return {
    set(vf, entry) { map.delete(vf); map.set(vf, entry); while (map.size > limit) map.delete(map.keys().next().value); },
    get: (vf) => map.get(vf) || null,
    has: (vf) => map.has(vf),
    size: () => map.size,
    /** {json} serve from memory, {url} fetch that instead, null pass through. */
    resolve(url) {
      const s = String(url || "");
      let m = MODEL_ANIM.exec(s);
      if (m) {
        const [, prefix, folder, kind, tail = ""] = m;
        const hit = map.get(folder);
        if (!hit) return null;
        if (kind === "anim") return { json: hit.model };
        return { url: `${prefix}battle/models/${hit.real}/slot_map.json${tail}` };
      }
      m = MODEL_TEXTURE.exec(s);
      if (m) {
        const [, prefix, folder, tail = ""] = m;
        const hit = map.get(folder);
        return hit ? { url: `${prefix}battle/textures/${hit.real}.png${tail}` } : null;
      }
      return null;
    },
  };
}

/** Install the shim in front of whatever fetch is there now (a no-op for every other URL). */
export function installDw2Fetch(store, target = globalThis) {
  const orig = target.fetch;
  if (typeof orig !== "function") return null;
  if (orig.__dw2mShim) return orig;
  const shim = (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const hit = store.resolve(url);
    if (!hit) return orig.call(target, input, init);
    shim.hits.push({ from: url, json: !!hit.json, to: hit.url || "(memory)" });
    if (hit.json) return Promise.resolve(new Response(JSON.stringify(hit.json), { status: 200, headers: { "content-type": "application/json" } }));
    return orig.call(target, hit.url, init);
  };
  shim.__dw2mShim = true;
  shim.hits = [];
  target.fetch = shim;
  return shim;
}

// ── which species have a file (the list marker + filter) ───────────────────────────────────────
/**
 * HEAD every folder's generated file and report the ones that exist. Bounded concurrency; a server
 * that refuses HEAD is retried with a ranged GET. Resolves to the number found.
 */
export async function probeFolders(folders, onFound, { root = DW2_ROOT, concurrency = 6, fetchImpl = null, signal = null } = {}) {
  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) return 0;
  const list = [...new Set((folders || []).filter(Boolean))];
  let i = 0, found = 0;
  const worker = async () => {
    while (i < list.length) {
      const folder = list[i++];
      const url = dw2FileUrl(folder, root);
      try {
        let r = await f(url, { method: "HEAD", signal });
        if (r.status === 405 || r.status === 501) r = await f(url, { headers: { range: "bytes=0-0" }, signal });
        if (r.ok) { found++; onFound?.(folder); }
      } catch { /* a missing file is the normal case */ }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
  return found;
}

// ── actions + deep link ────────────────────────────────────────────────────────────────────────
/** The A/B pair for one filled slot: the DW2 motion, and what that slot plays today. */
export function dw2Actions(data, { folder = null, slot, letter = null, tables = null, any = false } = {}) {
  // any: also an owned slot's DW2 motion (the hand-pick rows play those)
  const list = fillersFor(data, slot);
  const fill = (list.length || !any ? list : pickLetters(data, slot)).find((f) => !letter || f.letter === letter);
  if (!fill) return [];
  const out = [];
  const table = tables?.[fill.letter] ?? fill.table;
  out.push({
    kind: "dw2", slot, letter: fill.letter, table, frames: fill.frames, folder,
    name: `DW2 ${slotLabel(slot)} · ${fill.letter} (table ${table}, ${fill.frames} frames)`,
    group: { key: "dw2|fill", label: "DW2 motion (fills the clips this body does not own)" },
  });
  out.push({
    kind: "own", clip: slot, folder,
    name: `today: clip ${slot} ${slotLabel(slot)} (this body's own build)`,
    group: { key: "dw2|own", label: "DW2 motion (fills the clips this body does not own)" },
  });
  return out;
}

/** The deep link the K25 report documents. */
export function dw2Query({ slot, folder, letter = null, ab = null } = {}) {
  if (slot == null) return "";
  const q = new URLSearchParams();
  q.set("dw2fill", String(slot | 0));
  if (folder) q.set("model", folder);
  if (letter) q.set("letter", letter);
  if (ab) q.set("ab", ab);
  return q.toString();
}

// ── the panel ─────────────────────────────────────────────────────────────────────────────────
const h = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) if (k != null && k !== "") n.append(k);
  return n;
};
const VERDICT_MARK = { works: "✓", broken: "✗", unsure: "?" };
const VERDICTS = ["works", "broken", "unsure"];

const PICK_WORD = { dw2: "DW2", dw3: "DW3" };
/** What the game plays for a row: the pick when there is one, else the automatic rule. */
const resultOf = (row, pick) => pick || row.rule;
/**
 * "Your picks": a table, one row per clip that has a DW2 motion.
 *   Clip | In the game (what battle plays; "unsaved" when it differs from the saved file) | Your choice
 *   (Auto / DW2 / DW3, the chosen one filled) | Preview (play DW3 / DW2, the one on screen filled).
 * v.picks: { rows, get(slot), saved(slot), set(slot, value|null), dirty, msg, onSave(), dw2On,
 *            playing: {slot, which:"dw2"|"dw3", letter}|null }
 * v.onPlay(slot, letter) plays DW2, v.onPlayOwn(slot) plays what DW3 plays there.
 */
function renderPicks(box, v) {
  const p = v.picks;
  const wrap = h("div", { id: "dw2Picks", className: "dw2Picks" });
  const changed = p.rows.filter((r) => (p.get(r.slot) || null) !== (p.saved(r.slot) || null)).length;
  const nPicks = p.rows.filter((r) => p.get(r.slot)).length;

  // header: what this table means + the save state, always visible
  const head = h("div", { className: "pkHead" });
  head.append(h("span", { className: "pkTitle", textContent: "Which animation does the game play?" }));
  const save = h("button", { type: "button", id: "dw2PicksSave",
    className: "pkSave " + (changed ? "dirty" : "clean"),
    textContent: changed ? `Save ${changed} change${changed === 1 ? "" : "s"}` : "All saved ✓",
    title: "write web/dw2-motion-picks.json (it ships with the game)" });
  save.disabled = !changed;
  save.onclick = () => p.onSave();
  head.append(save);
  if (p.msg) head.append(h("span", { id: "dw2PicksMsg", className: "pkMsg" + (/NOT saved/.test(p.msg) ? " bad" : ""), textContent: p.msg }));
  wrap.append(head);
  wrap.append(h("div", { className: "pkLegend" },
    h("span", { className: "pkChip dw3", textContent: "DW3" }), " Digimon World 3 (its own or the old fallback)   ",
    h("span", { className: "pkChip dw2", textContent: "DW2" }), " Digimon World 2 motion   ·   ",
    h("b", { textContent: "Auto" }), " = the automatic rule   ·   ",
    `${nPicks} hand pick${nPicks === 1 ? "" : "s"} on this Digimon   ·   your game here: DW2 motion is `,
    h("b", { className: p.dw2On ? "pkOn" : "pkOff", textContent: p.dw2On ? "ON" : "OFF" }),
    p.dw2On ? "" : " (F2 → Battle; off = everything plays DW3)"));

  if (!p.rows.length) { wrap.append(h("div", { className: "rowline dim" }, "no clip of this Digimon has a DW2 motion.")); box.append(wrap); return; }

  const table = h("table", { className: "pkTable" });
  const hr = h("tr", {});
  for (const t of ["Clip", "In the game", "Your choice", "Preview"]) hr.append(h("th", { textContent: t }));
  table.append(hr);
  for (const r of p.rows) {
    const cur = p.get(r.slot) || null;
    const was = p.saved(r.slot) || null;
    const now = resultOf(r, cur);
    const before = resultOf(r, was);
    const unsaved = cur !== was;
    const tr = h("tr", { className: "pkRow" + (unsaved ? " unsaved" : "") + (p.playing?.slot === r.slot ? " onscreen" : "") });
    tr.dataset.slot = String(r.slot);

    tr.append(h("td", {}, h("b", { textContent: r.label }), h("div", { className: "dim", textContent: `clip ${r.slot} · ${r.owned ? "has its own DW3 clip" : "no own DW3 clip"}` })));

    const inGame = h("td", {}, h("span", { className: `pkChip big ${now}`, textContent: PICK_WORD[now] }));
    inGame.append(h("div", { className: "dim", textContent: cur ? "your pick" : "automatic rule" }));
    if (unsaved) inGame.append(h("div", { className: "pkUnsaved", textContent: before !== now ? `unsaved · saved file plays ${PICK_WORD[before]}` : "unsaved" }));
    tr.append(inGame);

    const seg = h("div", { className: "pkSeg" });
    for (const val of [null, "dw2", "dw3"]) {
      const label = val ? PICK_WORD[val] : `Auto (${PICK_WORD[r.rule]})`;
      const b = h("button", { type: "button", className: `pkOpt ${val || "auto"}` + (cur === val ? " sel" : ""), textContent: (cur === val ? "● " : "○ ") + label,
        title: val ? `always play ${PICK_WORD[val]} for this clip` : `follow the automatic rule (${PICK_WORD[r.rule]} here)` });
      b.dataset.pick = val || "rule";
      b.onclick = () => p.set(r.slot, val);
      seg.append(b);
    }
    tr.append(h("td", {}, seg));

    const prev = h("td", { className: "pkPrev" });
    const ownOn = p.playing?.slot === r.slot && p.playing.which === "dw3";
    const own = h("button", { type: "button", className: "pkPlay dw3" + (ownOn ? " sel" : ""), textContent: ownOn ? "▶ DW3 (showing)" : "▶ DW3", title: "show what DW3 plays for this clip" });
    own.onclick = () => v.onPlayOwn(r.slot);
    prev.append(own);
    for (const f of r.letters) {
      const on = p.playing?.slot === r.slot && p.playing.which === "dw2" && p.playing.letter === f.letter;
      const name = r.letters.length > 1 ? `DW2 ${f.letter}` : "DW2";
      const b = h("button", { type: "button", className: "pkPlay dw2" + (on ? " sel" : ""), textContent: on ? `▶ ${name} (showing)` : `▶ ${name}`,
        title: r.letters.length > 1 ? `show the DW2 ${f.letter} motion (in battle the technique decides F, G or H)` : "show the DW2 motion" });
      b.dataset.letter = f.letter;
      b.onclick = () => v.onPlay(r.slot, f.letter);
      prev.append(b);
    }
    tr.append(prev);
    table.append(tr);
  }
  wrap.append(table);
  box.append(wrap);
}

/**
 * The "DW2 motion" section of the Actions tab.
 * v: { digimon:{name,folder,plan}, status:"loading"|"none"|"ready", data, rows, counts, busy,
 *      played:{slot,letter}|null, report:string,
 *      rating(slot)->entry|null, onPlay(slot,letter), onAB(), onRate(verdict,note), onClear(), onNote(note) }
 */
export function renderDw2Panel(box, v) {
  box.replaceChildren();
  const name = v.digimon?.name || "?";
  // SIMPLE MODE (the viewer's default): the picks table and nothing else
  if (v.simple) {
    if (v.status === "loading") { box.append(h("div", { className: "rowline dim", id: "dw2Loading" }, `reading ${name}'s DW2 file…`)); return; }
    if (v.status === "none" || !v.data || !v.picks) { box.append(h("div", { className: "rowline dim", id: "dw2None" }, `${name} has no Digimon World 2 motion: the game always plays DW3.`)); return; }
    renderPicks(box, v);
    return;
  }
  const title = h("div", { className: "groupTitle" }, `DW2 motion · ${name}`, v.digimon?.plan ? h("span", { className: "dim" }, ` (${v.digimon.plan})`) : "");
  box.append(title);
  if (v.status === "loading") { box.append(h("div", { className: "rowline dim", id: "dw2Loading" }, "reading this Digimon's DW2 file…")); return; }
  if (v.status === "none" || !v.data) {
    box.append(h("div", { className: "rowline dim", id: "dw2None" }, "no DW2 twin for this Digimon (no generated file) — nothing to show here."));
    return;
  }
  const c = v.counts;
  const statics = new Set(v.rows.filter((r) => r.status === "filled" && r.letters.every((f) => f.static)).map((r) => r.slot));
  box.append(h("div", { className: "rowline dim", id: "dw2Counts" },
    `${c.filled} of ${c.gaps} gap clip${c.gaps === 1 ? "" : "s"} filled by a DW2 motion · ${c.refused} refused by the gate · ${c.owned} clip${c.owned === 1 ? "" : "s"} this body plays itself`
    + (statics.size ? ` · ${statics.size} of them hold one pose (the baked keys never move: that species' file is defective, not the viewer)` : "")));

  if (v.picks) renderPicks(box, v);

  // ── filled: clickable, one button per (slot), sub-buttons per cast letter
  const filledRow = h("div", { className: "actList", id: "dw2Fill" });
  const filled = v.rows.filter((r) => r.status === "filled");
  if (!filled.length) filledRow.append(h("span", { className: "dim" }, "no slot is filled on this body."));
  for (const r of filled) {
    const sel = v.played?.slot === r.slot;
    const isStatic = r.letters.every((f) => f.static);
    const b = h("button", {
      className: "act dw2Btn" + (sel ? " sel" : "") + (isStatic ? " static" : ""), type: "button",
      title: `${slotLabel(r.slot)} — DW2 ${r.letters.map((f) => f.letter).join("/")}${isStatic ? " · this species' baked keys never move (file defect): the clip holds one pose" : ""}`,
    }, h("span", {}, slotLabel(r.slot), h("small", {}, ` ${r.letters[0].letter} · table ${r.letters[0].table}${isStatic ? " · static" : ""}`)));
    b.dataset.slot = String(r.slot);
    b.onclick = () => v.onPlay(r.slot, defaultLetter(r));
    const rating = v.rating?.(r.slot);
    if (rating) b.append(h("span", { className: `gv ${rating.verdict}`, textContent: ` ${VERDICT_MARK[rating.verdict]}`, title: `${rating.verdict}${rating.note ? ": " + rating.note : ""}` }));
    if (r.letters.length > 1) {
      for (const f of r.letters) {
        const s = h("button", { className: "dw2Letter" + (v.played?.slot === r.slot && v.played?.letter === f.letter ? " sel" : ""), type: "button", textContent: f.letter, title: `play the DW2 ${f.letter} motion (table ${f.table})` });
        s.dataset.letter = f.letter; s.dataset.slot = String(r.slot);
        s.onclick = (e) => { e.stopPropagation(); v.onPlay(r.slot, f.letter); };
        b.append(s);
      }
    }
    filledRow.append(b);
  }
  box.append(filledRow);

  // ── the A/B + rating strip for the slot on screen
  const ctl = h("div", { className: "rowline" });
  const ab = h("button", { textContent: "A/B vs today's clip", id: "dw2AB", type: "button", title: "flip between the DW2 motion and what this slot plays today, at the same tick and camera" });
  ab.disabled = !v.played;
  ab.onclick = () => v.onAB();
  ctl.append(ab);
  if (v.busy) ctl.append(h("span", { className: "dim", id: "dw2Busy" }, v.busy));
  box.append(ctl);
  if (v.played) {
    const row = v.rows.find((r) => r.slot === v.played.slot);
    const cur = v.rating?.(v.played.slot);
    const rate = h("div", { className: "rowline", id: "dw2Rate" },
      h("span", { className: "dim" }, "Does the DW2 "), h("b", {}, `${slotLabel(v.played.slot)} ${v.played.letter || ""}`.trim()),
      h("span", { className: "dim" }, ` look right on ${name}?`));
    const note = h("input", { type: "text", id: "dw2Note", placeholder: "note (optional, one line)", value: cur?.note || "", maxLength: 300, size: 30 });
    for (const verdict of VERDICTS) {
      const b = h("button", { className: `rateBtn ${verdict}` + (cur?.verdict === verdict ? " sel" : ""), textContent: verdict, type: "button", title: cur?.verdict === verdict ? "click again to remove the rating" : `mark ${verdict}` });
      b.dataset.verdict = verdict;
      b.onclick = () => (cur?.verdict === verdict ? v.onClear() : v.onRate(verdict, note.value));
      rate.append(b);
    }
    note.onchange = () => v.onNote(note.value);
    rate.append(note);
    box.append(rate);
    if (v.report) box.append(h("div", { className: "rowline dim", id: "dw2Report" }, v.report));
    else if (row) box.append(h("div", { className: "rowline dim", id: "dw2Report" }, `clip ${row.slot} · ${row.label} · DW2 ${v.played.letter || row.letters[0]?.letter}`));
  }

  // ── refused + owned, as compact lines
  const refused = v.rows.filter((r) => r.status === "refused");
  if (refused.length) {
    const line = h("div", { className: "rowline dim", id: "dw2Refused" }, h("span", {}, "gate refused: "));
    for (const r of refused) {
      const why = r.refused.map((x) => `${x.letter || "?"}: ${(x.keys || []).join(", ")}`).join(" · ");
      line.append(h("span", { className: "dw2RefusedRow", title: `${slotLabel(r.slot)} — ${why}`, textContent: `${r.slot}${r.label ? " " + r.label : ""}` }));
      line.append(h("span", { textContent: " " }));
    }
    box.append(line);
  }
  const owned = v.rows.filter((r) => r.status === "owned");
  if (owned.length) {
    box.append(h("div", { className: "rowline dim", id: "dw2Owned" },
      `owns its own clip, not replaced: ${owned.map((r) => `${r.slot} ${r.label}`).join(" · ")}`));
  }
}
