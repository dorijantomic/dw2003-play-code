// web/story-explorer.js
//
// The NPC dialogue-state explorer: pick a stage, pick a person, and see every record
// the disc authors for them — the spawn gate of each version in plain words, and every
// dialogue state with its own gate, its line, and which one the saved flags make live.
//
// It answers "why is this person different in my friend's save", so it reads the save
// the game already keeps (engineFlags holds the banked story bits; flags holds the text
// markers) and never writes. Values the save cannot answer (the story beat, party
// Charisma, the route pair) are left to the manual boxes and read as `unknown` until
// filled — the page prints that, it does not guess.
//
// Read-only lab page: nothing here is imported by the game, so there is no F2 toggle.
import { gateWords, liveStateIndex } from "./gate-text.js";
import { createFlagStore } from "./flag-store.js";
import { flagConditionPasses } from "./vendor/engine.js";

const $ = (id) => document.getElementById(id);

// ── localStorage: read-only, and only where the game keeps saves ────────────────────────────
const storage = (() => {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
})();

const storageGet = (key) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };

function idFromKey(key) {
  if (/^0x[0-9a-f]+$/i.test(key)) return Number(key);
  if (/^\d+$/.test(key)) return Number(key);
  return null;
}

function popcount(byte) {
  let n = 0;
  for (let v = byte; v; v >>= 1) n += v & 1;
  return n;
}

/** Decode the two save strings the game keeps: engineFlags banks (base64 bitmaps) and `flags`
 *  (text markers plus, if a build ever left them, numeric ids). Pure: the tests drive it with
 *  a hand-built save. */
export function decodeSave(engineFlagsRaw, flagsRaw) {
  const banks = new Map();
  let hasEngineFlags = false;
  let bitsSet = 0;

  if (engineFlagsRaw) {
    try {
      const obj = JSON.parse(engineFlagsRaw);
      hasEngineFlags = true;
      for (const [key, encoded] of Object.entries(obj ?? {})) {
        const bank = Number(key);
        if (!Number.isInteger(bank) || bank < 0 || bank > 0xfe) continue;
        let bytes;
        try {
          bytes = Uint8Array.from(atob(String(encoded)), (c) => c.charCodeAt(0));
        } catch { continue; } // a corrupt bank reads as if it were absent
        banks.set(bank, bytes);
        for (const byte of bytes) bitsSet += popcount(byte);
      }
    } catch { hasEngineFlags = false; }
  }

  const markers = [];
  const numeric = new Map();
  if (flagsRaw) {
    try {
      const obj = JSON.parse(flagsRaw);
      for (const [key, value] of Object.entries(obj ?? {})) {
        const id = idFromKey(key);
        if (id != null && (value === 0 || value === 1 || value === true || value === false)) {
          numeric.set(id, value === 0 || value === false ? 0 : 1);
        } else {
          markers.push([key, value]);
        }
      }
    } catch { /* not JSON: nothing to show */ }
  }

  return { banks, numeric, markers, bitsSet, hasEngineFlags };
}

/** The stored-bit reader over a decoded save: `0 | 1` per id, never a guess. */
export function makeReader(decoded) {
  return (id) => {
    if (decoded.numeric.has(id)) return decoded.numeric.get(id);
    const bank = (id >> 8) & 0xfe;
    const bit = id & 0x1ff;
    const bytes = decoded.banks.get(bank);
    if (!bytes) return 0; // FlagManager: an absent stored bank reads as clear
    return ((bytes[bit >> 3] ?? 0) >> (bit & 7)) & 1;
  };
}

const readSave = () => decodeSave(storageGet("engineFlags"), storageGet("flags"));

let save = readSave();
let readBit = makeReader(save);

/** The stored-bit reader over the saved banks, with numeric `flags` keys as an overlay. */
const backend = {
  get: (id) => readBit(id),
  set() {}, // the page never writes a flag
};

// ── the manual values that are not flags ────────────────────────────────────────────────────
const readNumber = (input) => {
  const text = input.value.trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

let rosterByKey = {};
let store = null;

/** A fresh tri-state reader whenever a manual box changes; blank boxes stay unmodelled (null). */
function rebuildStore() {
  const opts = { rosterTable: rosterByKey };
  const beat = readNumber($("beat"));
  if (beat != null) opts.getOrdinal = () => beat;
  const charisma = readNumber($("charisma"));
  if (charisma != null) opts.partyCharisma = () => charisma;
  const key = readNumber($("routeKey"));
  const companion = readNumber($("routeCompanion"));
  if (key != null && companion != null) opts.routePair = () => [key, companion];
  store = createFlagStore(backend, opts);
}

const getCond = (id) => store.get(id);

// ── data ────────────────────────────────────────────────────────────────────────────────────
async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

let placeCard = null;
let progressOrdinal = null;
let scene = null;
let groups = [];
const dialogueCache = new Map();

const ui = { groupKey: null, recordId: null };

function stageName(stage) {
  const row = placeCard?.stages?.[stage];
  if (!row) return stage;
  const where = [row.area, row.place].filter(Boolean).join(" · ");
  return where ? `${stage} — ${where}` : stage;
}

function playerName() {
  return storageGet("playerName") || "you";
}

function stripTags(raw) {
  return raw
    .replace(/\[player_name2?\]/gi, playerName())
    .replace(/\[name\]/gi, "\n")
    .replace(/\[clear\]/gi, "\n")
    .replace(/\[pause\]/gi, " ")
    .replace(/\[[a-z0-9_]+\]/gi, "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
}

async function loadDialogue(file) {
  if (!dialogueCache.has(file)) {
    dialogueCache.set(file, fetchJson(`assets/dialogue/${file}.json`).catch(() => null));
  }
  return dialogueCache.get(file);
}

async function fillLine(node, ref) {
  if (!ref || !ref.file) { node.textContent = "(no dialogue reference)"; return; }
  const table = await loadDialogue(ref.file);
  if (!node.isConnected) return;
  if (!table) { node.textContent = `could not read ${ref.file}.json`; return; }
  const raw = table[ref.index];
  node.textContent = typeof raw === "string"
    ? stripTags(raw)
    : `(no line ${ref.index} in ${ref.file})`;
}

// ── rendering ──────────────────────────────────────────────────────────────────────────────
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** One gate list as spans, each marked unknown when the save cannot answer it. */
function gateNode(list, empty) {
  const box = el("div", "gate");
  const conds = list ?? [];
  if (!conds.length) { box.append(el("span", "muted", empty)); return box; }
  for (const cond of conds) {
    const span = el("span", "cond", gateWords(cond));
    const value = getCond(cond.id);
    if (value === null) span.classList.add("unknown");
    span.title = `id 0x${(cond.id >>> 0).toString(16)} expected ${cond.expected} — ` +
      (value === null ? "this save cannot answer it" : `this save reads ${value}`);
    box.append(span);
  }
  return box;
}

/** Group the stage's NPC records by the person they are (npc_id): every record in a group is
 *  another authored version of the same person with its own spawn gate. Pure. */
export function groupRecords(npcs) {
  const map = new Map();
  for (const npc of npcs ?? []) {
    const key = String(npc.npc_id ?? npc.id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(npc);
  }
  return [...map.entries()]
    .map(([key, records]) => ({ key, records }))
    .sort((a, b) => (Number(a.key) - Number(b.key)) || a.key.localeCompare(b.key));
}

function groupLabel(key, records) {
  const sprites = [...new Set(records.map((r) => r.sprite).filter(Boolean))].join(", ");
  const spots = new Set(records.map((r) => `${r.x},${r.y}`));
  return {
    title: `npc ${key}`,
    meta: [sprites, `${records.length} version${records.length === 1 ? "" : "s"}`,
      spots.size === 1 ? `at ${[...spots][0]}` : `${spots.size} spots`].filter(Boolean).join(" · "),
  };
}

function renderPeople() {
  const list = $("people");
  list.replaceChildren();
  const needle = $("filter").value.trim().toLowerCase();
  const shown = groups.filter(({ key, records }) =>
    !needle || key.toLowerCase().includes(needle) ||
    records.some((r) => `${r.id} ${r.sprite ?? ""}`.toLowerCase().includes(needle)));
  if (!shown.length) { list.append(el("li", "muted", "no person matches that filter")); return; }
  for (const { key, records } of shown) {
    const label = groupLabel(key, records);
    const li = el("li");
    li.setAttribute("aria-selected", key === ui.groupKey ? "true" : "false");
    li.append(el("div", null, label.title), el("div", "meta", label.meta));
    li.addEventListener("click", () => {
      ui.groupKey = key;
      ui.recordId = null;
      renderPeople();
      renderVersions();
      renderStates();
    });
    list.append(li);
  }
}

/** Does this version spawn for the saved flags? Same rule as the disc's spawn loop:
 *  every condition must pass, a command bank always passes, an unknown value is permissive
 *  (and counted so the page can say the verdict is not certain). */
function spawnVerdict(record) {
  let unknown = 0;
  for (const cond of record.spawn_flags ?? []) {
    if (getCond(cond.id) === null) { unknown++; continue; }
    if (!flagConditionPasses(getCond, cond.id, cond.expected)) return { spawns: false, unknown };
  }
  return { spawns: true, unknown };
}

function renderVersions() {
  const box = $("versions");
  box.replaceChildren();
  const group = groups.find((g) => g.key === ui.groupKey);
  if (!group) {
    $("versionsTitle").textContent = "Versions of this person";
    box.className = "muted";
    box.textContent = "Pick a person on the left.";
    return;
  }
  $("versionsTitle").textContent =
    `Versions of npc ${group.key} — ${group.records.length} record${group.records.length === 1 ? "" : "s"} authored`;
  box.className = "";
  if (!ui.recordId) ui.recordId = group.records[0]?.id ?? null;

  for (const record of group.records) {
    const card = el("div", "card");
    card.dataset.selected = record.id === ui.recordId ? "true" : "false";
    const head = el("h3");
    head.append(el("span", "ver", record.id));
    const states = record.dialogue_states ?? [];
    head.append(el("span", "pill", `${states.length} dialogue state${states.length === 1 ? "" : "s"}`));
    if (record.cutsceneOnly) head.append(el("span", "pill warn", "cutscene only"));
    head.append(el("span", "pill", `slot ${record.slot ?? "?"}`));
    const verdict = spawnVerdict(record);
    if (verdict.spawns) {
      head.append(el("span", "pill good",
        verdict.unknown ? `spawns (${verdict.unknown} unknown)` : "spawns for this save"));
    } else {
      head.append(el("span", "pill bad", "does not spawn"));
    }
    card.append(head);
    card.append(el("div", "muted",
      `${record.sprite ?? "?"} · at ${record.x},${record.y} · facing ${record.dir ?? "?"}`));
    const spawn = el("div");
    spawn.append(el("span", "muted", "spawns when: "));
    spawn.append(gateNode(record.spawn_flags, "always (no spawn gate)"));
    card.append(spawn);
    card.addEventListener("click", () => {
      ui.recordId = record.id;
      renderVersions();
      renderStates();
    });
    box.append(card);
  }
}

function renderStates() {
  const box = $("states");
  box.replaceChildren();
  const group = groups.find((g) => g.key === ui.groupKey);
  const record = group?.records.find((r) => r.id === ui.recordId);
  if (!record) {
    $("statesTitle").textContent = "Dialogue states";
    box.className = "muted";
    box.textContent = "Pick a version above.";
    return;
  }
  const states = record.dialogue_states ?? [];
  $("statesTitle").textContent = `Dialogue states of ${record.id}`;
  box.className = "";
  if (!states.length) {
    box.append(el("div", "muted", "This version carries no ordered dialogue states."));
    return;
  }
  const live = liveStateIndex(record, getCond);
  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    const unknown = (state.gate ?? []).filter((c) => getCond(c.id) === null).length;
    const card = el("div", "card state");
    card.dataset.live = i === live ? "true" : "false";
    const head = el("div", "head");
    head.append(el("span", "num", `state #${i}`));
    if (i === live) {
      head.append(el("span", "pill good", "live for this save"));
      if (unknown) head.append(el("span", "pill warn", `${unknown} gate${unknown === 1 ? "" : "s"} unknown`));
    }
    card.append(head);
    const gate = el("div");
    gate.append(el("span", "muted", "gate: "));
    gate.append(gateNode(state.gate, "always (no gate)"));
    card.append(gate);
    const line = el("div", "line", "…");
    card.append(line);
    fillLine(line, state.dialogue);
    box.append(card);
  }
  if (live == null) {
    box.append(el("div", "hint", "No state passes this save's flags — this version is " +
      "non-speaking for your save. The game keeps the ordered program and never falls back " +
      "to an earlier line."));
  }
}

// ── the save panel ─────────────────────────────────────────────────────────────────────────
function renderSavePanel() {
  const info = $("saveInfo");
  info.replaceChildren();
  if (save.hasEngineFlags) {
    info.append(el("div", null,
      `engineFlags: ${save.banks.size} bank${save.banks.size === 1 ? "" : "s"}, ` +
      `${save.bitsSet} bit${save.bitsSet === 1 ? "" : "s"} set.`));
  } else {
    info.append(el("div", null, "No engineFlags in this browser: every stored story flag " +
      "reads clear, like a new game."));
  }
  const markerCount = save.markers.length;
  info.append(el("div", null,
    `localStorage.flags: ${markerCount} text marker${markerCount === 1 ? "" : "s"}` +
    (save.numeric.size ? ` · ${save.numeric.size} numeric id${save.numeric.size === 1 ? "" : "s"} applied` : "") +
    "."));
  if (markerCount) {
    const details = el("details");
    details.append(el("summary", null, "show the markers"));
    for (const [key, value] of save.markers.slice(0, 200)) {
      details.append(el("div", "mono hint", `${key} = ${JSON.stringify(value)}`));
    }
    info.append(details);
  }
  const saved = storageGet("progressOrdinal");
  info.append(el("div", "hint",
    saved != null ? `saved story beat (progressOrdinal): ${saved}` : "no saved story beat (progressOrdinal)"));
}

function renderBeats() {
  const box = $("beats");
  box.replaceChildren();
  const byOrdinal = new Map();
  for (const [stage, ordinals] of Object.entries(progressOrdinal?.by_stage ?? {})) {
    for (const n of ordinals) {
      if (!byOrdinal.has(n)) byOrdinal.set(n, []);
      byOrdinal.get(n).push(`s${stage}`);
    }
  }
  if (!byOrdinal.size) { box.textContent = "could not read progress_ordinal.json"; return; }
  box.className = "";
  const beat = el("div", "hint",
    `${byOrdinal.size} beats on the disc — click one to put it in the box`);
  box.append(beat);
  for (const n of [...byOrdinal.keys()].sort((a, b) => a - b)) {
    const stages = byOrdinal.get(n);
    const row = el("div", null, `beat ${n} — ${stages.map(stageName).join(", ")}`);
    row.addEventListener("click", () => {
      $("beat").value = String(n);
      rebuildStore();
      renderVersions();
      renderStates();
    });
    box.append(row);
  }
}

// ── wiring ─────────────────────────────────────────────────────────────────────────────────
function onManualChange() {
  rebuildStore();
  renderVersions();
  renderStates();
}

function reloadSave() {
  save = readSave();
  readBit = makeReader(save);
  rebuildStore();
  renderSavePanel();
  renderVersions();
  renderStates();
}

async function onStage() {
  const stage = $("stage").value;
  try {
    scene = await fetchJson(`assets/scenes/${stage}.json`);
  } catch (error) {
    $("versions").className = "muted";
    $("versions").textContent = `could not read assets/scenes/${stage}.json`;
    return;
  }
  groups = groupRecords(scene.npcs);
  ui.groupKey = groups[0]?.key ?? null;
  ui.recordId = null;
  const withStates = (scene.npcs ?? []).filter((n) => n.dialogue_states?.length).length;
  $("ready").textContent =
    `${stageName(stage)} — ${(scene.npcs ?? []).length} NPC records, ${withStates} with dialogue states`;
  renderPeople();
  renderVersions();
  renderStates();
}

async function main() {
  rebuildStore();
  renderSavePanel();
  try {
    [placeCard, progressOrdinal] = await Promise.all([
      fetchJson("assets/data/place_card.json"),
      fetchJson("assets/data/progress_ordinal.json"),
    ]);
  } catch (error) {
    $("ready").textContent = "could not read the data files";
    $("ready").id = "error";
    return;
  }
  try {
    const roster = await fetchJson("assets/data/roster_predicate_table.json");
    rosterByKey = Object.fromEntries((roster.records ?? []).map((rec) => [rec.key, rec]));
  } catch {
    // Without the table a bank-0x70 gate stays a raw hex gate, which is the honest fallback.
    rosterByKey = {};
  }
  rebuildStore();

  const stages = Object.keys(placeCard.stages ?? {}).sort(
    (a, b) => (Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, ""))) || a.localeCompare(b));
  const select = $("stage");
  select.replaceChildren();
  for (const stage of stages) select.append(new Option(stageName(stage), stage));
  select.value = stages.includes("s200") ? "s200" : stages[0];
  select.addEventListener("change", onStage);
  $("filter").addEventListener("input", renderPeople);
  $("reload").addEventListener("click", reloadSave);
  for (const id of ["beat", "charisma", "routeKey", "routeCompanion"]) {
    $(id).addEventListener("input", onManualChange);
  }

  // A saved beat seeds the box; blank means unknown, which is what the input shows.
  const savedBeat = storageGet("progressOrdinal");
  if (savedBeat != null && /^\d+$/.test(savedBeat)) $("beat").value = savedBeat;
  rebuildStore();
  renderBeats();
  renderSavePanel();
  await onStage();
}

// Only a real page starts the UI; node imports the pure halves above for the tests.
if (typeof document !== "undefined") main();
