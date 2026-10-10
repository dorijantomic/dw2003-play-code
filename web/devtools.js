// DDW3 Dev Toolset — INTERNAL TOOLING (web/devtools.html).
//
// One page that drives the REAL game (web/index.html) inside an iframe, the same
// way web/ui-lab.html does, so it never keeps a second copy of game logic:
//   * it boots the game through the existing URL parameters (?skipTitle,
//     ?skipLanguage, ?language, ?noEncounters, ?map=) with a seeded party, and
//   * it drives the game only through the existing `window.__*` hooks plus the
//     small `window.__dev` surface added in web/game.js.
//
// It is NOT a player-facing screen and it deliberately does not reproduce the
// retail disc's leftover debug screens (the stage-select launcher, the sound
// test, the shock/rumble test and the battle scene test): those are research
// tools we read on the rig but do not ship. See docs/workflow/devtools.md.

import { assetMode, setAssetMode, assetRequest, hdAssetUrl,
         ASSET_MODE_AUTHENTIC, ASSET_MODE_HD } from "./assets.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
const log = (msg) => {
  const box = $("log");
  box.textContent += `${new Date().toISOString().slice(11, 19)}  ${msg}\n`;
  box.scrollTop = box.scrollHeight;
};

// ── boot the game the way ui-lab does ────────────────────────────────────────
// Seed a Balanced-pack party so menus, shops and battles have real party data.
function seedParty() {
  const ls = localStorage;
  ls.setItem("engineSchema", "2");
  ls.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  ls.setItem("packId", "A");
  ls.setItem("charId", "p003pken");
  ls.setItem("playerName", "Junior");
  const block = (digimonId, hp, mp) => ({
    digimonId, level: 5, xp: 0, tp: 0, hp, maxHp: hp, mp, maxMp: mp,
    bonuses: {}, elemBonuses: {},
  });
  const stats = [block(1, 150, 100), block(7, 120, 90), block(8, 130, 95)];
  ls.setItem("partyStats", JSON.stringify(stats));
  ls.setItem("partnerStats", JSON.stringify(stats[0]));
  if (!ls.getItem("assetMode")) ls.setItem("assetMode", ASSET_MODE_AUTHENTIC);
}
seedParty();

const frame = $("game");
let bootMap = null;          // ?map= the current iframe was loaded with
let dataReady = false;       // toolset data (manifest, enemies, …) loaded
let gameReady = false;       // game booted inside the iframe

function gameUrl() {
  const q = new URLSearchParams();
  q.set("skipTitle", "1");
  q.set("skipLanguage", "1");
  q.set("noEncounters", "1");
  q.set("language", "0");
  if (bootMap) q.set("map", bootMap);
  return `index.html?${q.toString()}`;
}

function reloadGame(mapId) {
  bootMap = mapId ?? bootMap;
  gameReady = false;
  setReadyPill(false, "loading…");
  frame.src = gameUrl();
}

const win = () => frame.contentWindow;
// Re-armed on every load: a jump reloads the iframe, so a one-shot reader would
// leave `gameReady` false and the module's own Start/Play buttons would refuse.
let pendingReady = [];
function onReady(cb) { pendingReady.push(cb); }
// The 'Stage events' panel must describe the stage the iframe actually loaded.
// A Jump reloads the iframe onto a new stage, so this runs on EVERY ready
// transition, not only the first boot: the earlier boot-only selection left the
// panel pointing at the previous stage, and Play then sent the game back to that
// stale stage (the "click an event, land on a totally different stage" report).
function selectLoadedStage() {
  const id = win()?.__mapInfo?.().id ?? bootMap;
  if (id) selectStage(id);
}
function watchReady() {
  const tick = () => {
    const w = win();
    const up = !!(w && w.__dev && w.__state?.started);
    if (up && !gameReady) {
      gameReady = true;
      postBoot();
      setReadyPill(true);
      selectLoadedStage();
      const cbs = pendingReady; pendingReady = [];
      for (const cb of cbs) { try { cb(); } catch (e) { log(`ready handler: ${e}`); } }
    } else if (!up && gameReady) {
      gameReady = false;
      setReadyPill(false, "loading…");
    }
    setTimeout(tick, 200);
  };
  tick();
}

// getPlayerProfile needs state.charIdx > 0 and partnerStats.digimonId. Seed both
// post-boot if the persisted party did not restore them (the ?skipTitle route
// boots a new game, so nothing is "downloaded" on the field yet).
function postBoot() {
  const w = win(), s = w.__state;
  if (!s) return;
  if (!(s.charIdx > 0) && s.party?.length) {
    const i = s.manifest.characters.findIndex((c) => c.id === s.party[0]);
    if (i > 0) s.charIdx = i;
  }
  if (!s.partnerStats?.digimonId && s.partyStats?.[0]?.digimonId) {
    s.partnerStats = s.partyStats[0];
  }
  if (s.charIdx > 0 && s.partnerStats?.digimonId) {
    s.manifest.characters[s.charIdx].digimonId = s.partnerStats.digimonId;
  }
}

function setReadyPill(ok, text) {
  const p = $("readyPill");
  p.className = ok ? "pill good" : "pill warn";
  p.textContent = ok ? `game ready — ${win()?.__mapInfo?.().id ?? "?"}` : (text ?? "booting…");
}

// ── toolset data (the same files the game reads) ─────────────────────────────
const DATA = {};
async function loadData() {
  const j = (p) => fetch(p).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // data/stage_names.json lives one level above web/. It loads when the server
  // root is the repository (http.server run from the repo root); when the server
  // is rooted at web/ (the ui-lab convention) this 404s and nameOf() falls back
  // to the manifest's own per-map name, which carries the same strings.
  const stageNamesFetch = j("../data/stage_names.json").then((v) => v ?? j("data/stage_names.json"));
  const [manifest, stageNames, enemies, arenas, backdrops, wstag, digimon] = await Promise.all([
    j("assets/manifest.json"),
    stageNamesFetch,
    j("assets/data/enemies.json"),
    j("assets/battle/arenas/manifest.json"),
    j("assets/battle/backdrops/manifest.json"),
    j("assets/events/wstag_events.json"),
    j("assets/data/digimon.json"),
  ]);
  DATA.manifest = manifest ?? { maps: [], characters: [] };
  DATA.stageNames = stageNames ?? {};
  DATA.enemies = enemies?.enemies ?? [];
  DATA.arenas = arenas ?? { byArena: {}, byStage: {} };
  DATA.backdrops = backdrops ?? { bySig: {}, byTech: {} };
  DATA.wstag = wstag ?? {};
  DATA.skills = digimon?.skills ?? [];
  dataReady = true;
}

// arena-id -> a (stage, screen) pair whose trigger record selects it, so a
// chosen arena can be forced through the renderer's own setArenaStage.
function arenaReverseMap() {
  const rev = new Map();
  for (const [stage, e] of Object.entries(DATA.arenas.byStage ?? {})) {
    for (const [k, v] of Object.entries(e)) {
      if (typeof v === "number" && !rev.has(v)) rev.set(v, { stage, screen: k === "_default" ? null : Number(k) });
    }
  }
  return rev;
}

// ── TABS ─────────────────────────────────────────────────────────────────────
const PANES = { stages: "pane-stages", battles: "pane-battles", assets: "pane-assets", state: "pane-state" };
for (const b of document.querySelectorAll("#tabs button")) {
  b.addEventListener("click", () => {
    for (const o of document.querySelectorAll("#tabs button")) o.setAttribute("aria-selected", String(o === b));
    for (const [tab, id] of Object.entries(PANES)) $(id).classList.toggle("on", tab === b.dataset.tab);
  });
}

// ── STAGES & SCENES ──────────────────────────────────────────────────────────
let selectedMap = null;
function renderStages() {
  const pane = $("pane-stages");
  pane.textContent = "";

  pane.append(el("h2", {}, "Jump to a stage"));
  pane.append(el("div", { className: "hint" },
    "Jump sets ?map=<id> and reloads the game into that stage (the same parameter a verifier uses). ",
    "Names come from the disc's own table (data/stage_names.json)."));
  const search = el("input", { type: "text", placeholder: "filter id or name…", style: "width:100%" });
  pane.append(el("div", { className: "row" }, search));

  const list = el("ul", { className: "list" });
  const maps = DATA.manifest.maps ?? [];
  const nameOf = (id) => DATA.stageNames[id] ?? (maps.find((m) => m.id === id)?.name) ?? "";
  function fill() {
    const q = search.value.trim().toLowerCase();
    list.textContent = "";
    for (const m of maps) {
      const name = nameOf(m.id);
      if (q && !(`${m.id} ${name}`.toLowerCase().includes(q))) continue;
      const li = el("li");
      li.append(el("span", { className: "n" }, el("b", {}, m.id), "  ", name));
      const jump = el("button", { className: "act primary", textContent: "Jump" });
      jump.addEventListener("click", () => { log(`jump -> ${m.id} (${name})`); reloadGame(m.id); });
      li.append(jump);
      li.addEventListener("click", (ev) => { if (ev.target !== jump) selectStage(m.id); });
      list.append(li);
    }
  }
  search.addEventListener("input", fill);
  fill();
  pane.append(list);

  pane.append(el("h2", {}, "Stage events"));
  pane.append(el("div", { className: "hint", id: "evHint" }));
  pane.append(el("div", { id: "evList" }));
}

function selectStage(mapId) {
  selectedMap = mapId;
  const hint = $("evHint"), host = $("evList");
  if (!hint || !host) return;
  const events = DATA.wstag[mapId] ?? [];
  hint.textContent = `${mapId}: ${events.length} stage event(s). Each event normally fires from a `
    + `stage controller (a step-VM zone, a talk launcher or a story flag). "Play" bypasses that `
    + `gate and runs the script directly through the walker's own cutscene path.`;
  host.textContent = "";
  if (!events.length) { host.append(el("div", { className: "hint" }, "No scripted events for this stage.")); return; }
  const ul = el("ul", { className: "list" });
  for (const ev of events) {
    const li = el("li");
    const firstSay = (ev.disasm || []).find((l) => l.startsWith("SAY")) || "";
    li.append(el("span", { className: "n" },
      el("b", {}, `#${ev.id}`), " ", el("span", { className: "meta" }, `flag ${ev.flag_key ?? "—"}${firstSay ? " · " + firstSay : ""}`)));
    const play = el("button", { className: "act primary", textContent: "Play" });
    play.addEventListener("click", async () => {
      if (!gameReady) { log("game not ready yet"); return; }
      const ok = await win().__dev.playEvent(mapId, ev.id);
      log(`playEvent ${mapId} #${ev.id} -> ${ok ? "started" : "not found"}`);
    });
    li.append(play);
    ul.append(li);
  }
  host.append(ul);
}

// ── BATTLES ──────────────────────────────────────────────────────────────────
function renderBattles() {
  const pane = $("pane-battles");
  pane.textContent = "";
  pane.append(el("h2", {}, "Start a battle"));
  pane.append(el("div", { className: "hint" },
    "Runs the game's own battle.start (the same call the field handoff and the battle lab use). ",
    "Enemy ids are the disc's own (web/assets/data/enemies.json)."));

  const enemy = el("select", { id: "btEnemy" });
  for (const e of DATA.enemies) enemy.append(el("option", { value: e.enemy_id, textContent: e.enemy_id }));
  pane.append(el("div", { className: "row" }, el("label", {}, "enemy"), enemy));

  const level = el("input", { type: "number", id: "btLevel", value: 5, min: 1, max: 99, style: "width:70px" });
  pane.append(el("div", { className: "row" }, el("label", {}, "level"), level));

  const arena = el("select", { id: "btArena" });
  arena.append(el("option", { value: "", textContent: "(stage default)" }));
  const ids = Object.keys(DATA.arenas.byArena ?? {}).map(Number).sort((a, b) => a - b);
  for (const id of ids) arena.append(el("option", { value: String(id), textContent: `arena ${id} — ${DATA.arenas.byArena[id].pack}` }));
  pane.append(el("div", { className: "row" }, el("label", {}, "arena"),
    arena, el("span", { className: "meta", id: "arenaNote" })));

  const tech = el("select", { id: "btTech" });
  tech.append(el("option", { value: "", textContent: "(none)" }));
  for (const s of DATA.skills) tech.append(el("option", { value: String(s.id), textContent: `${s.id} ${s.name}` }));
  pane.append(el("div", { className: "row" }, el("label", {}, "tech / signature"), tech));
  pane.append(el("div", { className: "hint" },
    "The tech picks the special-attack backdrop (its sigEffect -> MEFT10 pack) and is applied live ",
    "through the renderer's own setDataField; the arena is applied through setArenaStage."));

  const start = el("button", { className: "act primary", textContent: "Start battle" });
  start.addEventListener("click", () => startBattle());
  pane.append(el("div", { className: "row" }, start));

  pane.append(el("h2", {}, "Scripted battle by screen id"));
  const scr = el("input", { type: "number", id: "btScreen", placeholder: "screen id", style: "width:100px" });
  const scrGo = el("button", { className: "act", textContent: "Start" });
  scrGo.addEventListener("click", async () => {
    const id = Number(scr.value);
    if (!id) return;
    const ok = await win().__dev.startScreenBattle(id, { mapId: win().__mapInfo?.().id });
    log(`startScreenBattle ${id} -> ${ok ? "started" : "no party for screen"}`);
  });
  pane.append(el("div", { className: "row" }, scr, scrGo));

  pane.append(el("h2", {}, "In-battle paths (existing hooks)"));
  pane.append(el("div", { className: "hint" }, "Enabled while a battle is live. These call the same "
    + "window.__battle* hooks the battle lab and the verifiers use."));
  const mk = (label, fn) => {
    const b = el("button", { className: "act", textContent: label });
    b.addEventListener("click", async () => { await ensureBattle(); log(`${label} -> ${fn()}`); });
    return b;
  };
  pane.append(el("div", { className: "row" },
    mk("Blast", () => win().__battleBlast?.()),
    mk("Revert", () => win().__battleRevert?.()),
    mk("DV (auto form)", () => win().__battleDv?.(null)),
  ));
  const formId = el("input", { type: "number", placeholder: "DV form id", style: "width:100px" });
  const dvGo = el("button", { className: "act", textContent: "DV to form" });
  dvGo.addEventListener("click", async () => { await ensureBattle(); log(`DV ${formId.value} -> ${win().__battleDv?.(Number(formId.value) || null)}`); });
  pane.append(el("div", { className: "row" }, formId, dvGo));
  const castBtn = el("button", { className: "act", textContent: "Cast signature backdrop" });
  castBtn.addEventListener("click", () => {
    const t = tech.value ? Number(tech.value) : null;
    win().__battle3d?.setDataField?.(true, t);
    log(`setDataField(true, ${t ?? "fallback"})`);
  });
  const clearBtn = el("button", { className: "act", textContent: "Clear backdrop" });
  clearBtn.addEventListener("click", () => { win().__battle3d?.setDataField?.(false); log("setDataField(false)"); });
  pane.append(el("div", { className: "row" }, castBtn, clearBtn));
}

async function ensureBattle() {
  // Best-effort: give the async battle.start a moment so the hooks are armed.
  for (let i = 0; i < 20; i++) { if (win().__battle?.isActive?.()) return true; await new Promise((r) => setTimeout(r, 150)); }
  return false;
}

async function startBattle() {
  if (!gameReady) { log("game not ready yet"); return; }
  const enemyId = $("btEnemy").value;
  const enemyLevel = Number($("btLevel").value) || 5;
  const arenaId = $("btArena").value ? Number($("btArena").value) : null;
  const techId = $("btTech").value ? Number($("btTech").value) : null;
  log(`startBattle ${enemyId} lv${enemyLevel}${arenaId ? " arena " + arenaId : ""}`);
  await win().__dev.startBattle({ enemyId, enemyLevel });
  if (!(await ensureBattle())) { log("battle did not become active"); return; }
  if (arenaId != null) applyArena(arenaId);
  if (techId != null) win().__battle3d?.setDataField?.(true, techId);
}

// Force a chosen arena through the renderer's own setArenaStage, using a
// (stage, screen) record that selects it (the disc's own mapping).
async function applyArena(arenaId) {
  for (let i = 0; i < 40 && !win().__battle3d; i++) await new Promise((r) => setTimeout(r, 150));
  const rev = arenaReverseMap().get(arenaId);
  const note = $("arenaNote");
  if (!rev) {
    if (note) note.textContent = `arena ${arenaId} is not selected by any stage record — preview it in Assets`;
    log(`arena ${arenaId}: no stage record selects it; left on the stage default`);
    return;
  }
  win().__battle3d?.setArenaStage?.(rev.stage, rev.screen);
  if (note) note.textContent = `forced via stage ${rev.stage}`;
  log(`arena ${arenaId} forced via stage ${rev.stage}${rev.screen != null ? " screen " + rev.screen : ""}`);
}

// ── BACKGROUNDS & ASSETS ─────────────────────────────────────────────────────
const ASSET_GROUPS = [
  { key: "maps", label: "Field maps", note: "one per stage (294)" },
  { key: "arenas", label: "Battle arenas (MEFT1001-1029)", note: "the disc's per-area arenas (29)" },
  { key: "backdrops", label: "Special-attack backdrops (MEFT1033-1055)", note: "per-element packs (17)" },
  { key: "characters", label: "Character sprite sheets", note: "field walk sheets" },
];

function renderAssets() {
  const pane = $("pane-assets");
  pane.textContent = "";
  pane.append(el("h2", {}, "Asset mode"));
  pane.append(el("div", { className: "hint" },
    "The game's own runtime authority is the assetMode local-storage key (web/assets.js). ",
    "Switching here writes the same key and reloads, so the game and the previews both use it."));
  const modeRow = el("div", { className: "row" });
  for (const [m, label] of [[ASSET_MODE_AUTHENTIC, "authentic"], [ASSET_MODE_HD, "hd (4x mirror)"]]) {
    const b = el("button", { className: m === assetMode() ? "act primary" : "act", textContent: label });
    b.addEventListener("click", async () => {
      setAssetMode(m);
      log(`assetMode -> ${m}; reloading`);
      reloadGame(bootMap);
      // refresh button styles
      for (const o of modeRow.children) o.className = o.textContent.startsWith(m) ? "act primary" : "act";
    });
    modeRow.append(b);
  }
  pane.append(modeRow);

  pane.append(el("h2", {}, "Preview one asset"));
  const group = el("select", { id: "asGroup" });
  for (const g of ASSET_GROUPS) group.append(el("option", { value: g.key, textContent: `${g.label} — ${g.note}` }));
  pane.append(el("div", { className: "row" }, group));

  const list = el("ul", { className: "list", style: "max-height:200px;overflow-y:auto" });
  pane.append(list);
  const img = el("img", { id: "preview", alt: "preview" });
  const path = el("div", { className: "hint", id: "asPath" }, "—");
  pane.append(el("div", { className: "row" }, img));
  pane.append(path);

  function urlsFor(key) {
    if (key === "maps") {
      return (DATA.manifest.maps ?? []).map((m) => ({
        id: m.id, name: DATA.stageNames[m.id] ?? m.name, url: m.image,
      }));
    }
    if (key === "arenas") {
      return Object.keys(DATA.arenas.byArena ?? {}).map(Number).sort((a, b) => a - b).map((id) => ({
        id: `meft10${String(id).padStart(2, "0")}`, name: `arena ${id}`, url: `assets/battle/arenas/meft10${String(id).padStart(2, "0")}/floor.png`,
      }));
    }
    if (key === "backdrops") {
      return Object.keys(DATA.backdrops.bySig ?? {}).map((sig) => DATA.backdrops.bySig[sig]).map((e) => ({
        id: e.pack, name: `${e.element} (${e.pack})`, url: `assets/battle/backdrops/${e.pack}/floor.png`,
      }));
    }
    return (DATA.manifest.characters ?? []).map((c) => ({ id: c.id, name: c.name, url: c.sheet }));
  }

  function showPreview(rec) {
    // assetRequest is the game's own HD-aware resolver: primary = the HD url in
    // hd mode with the authentic file as fallback.
    const req = assetRequest(rec.url);
    img.onerror = () => { if (req.fallback && img.src.endsWith(req.primary)) img.src = req.fallback; };
    img.src = req.primary;
    path.textContent = `[${assetMode()}] ${req.primary}${req.fallback ? "  (fallback: " + req.fallback + ")" : ""}`;
    log(`preview ${rec.id} (${assetMode()})`);
  }

  function fillList() {
    list.textContent = "";
    for (const rec of urlsFor(group.value)) {
      const li = el("li");
      li.append(el("span", { className: "n" }, el("b", {}, rec.id), "  ", el("span", { className: "meta" }, rec.name ?? "")));
      const b = el("button", { className: "act", textContent: "View" });
      b.addEventListener("click", () => showPreview(rec));
      li.append(b);
      list.append(li);
    }
  }
  group.addEventListener("change", fillList);
  fillList();
}

// ── STATE INSPECTOR ──────────────────────────────────────────────────────────
function screenOf() {
  const w = win();
  if (!w || !w.__state) return "—";
  if (w.__battle?.isActive?.()) return "battle";
  if (w.__cutscene?.isActive?.()) return "cutscene";
  if (w.__textbox?.isOpen?.()) return "dialogue";
  if (w.__state.menuOpen) return "pause menu";
  if (w.__state.packSelect) return "pack select";
  if (w.__state.nameEntry) return "name entry";
  if (w.__state.titleScreen) return "title";
  return "field";
}

function currentSnapshot() {
  const w = win();
  if (!w || !w.__dev?.snapshot || !w.__state?.manifest) return null;
  try {
    const snap = w.__dev.snapshot();
    snap.screen = screenOf();
    return snap;
  } catch { return null; }
}

async function refreshSnapshot() {
  const snap = currentSnapshot();
  const text = snap ? JSON.stringify(snap, null, 1) : "—";
  $("snap").textContent = text;
  const sj = $("snapJson");
  if (sj) sj.textContent = text;
  return snap;
}

function wireStatePane() {
  $("setFlagOn").addEventListener("click", () => {
    const id = Number($("setFlagId").value);
    if (Number.isFinite(id)) { win().__dev?.setFlag?.(id, true); log(`setFlag ${id} = 1`); refreshSnapshot(); }
  });
  $("setFlagOff").addEventListener("click", () => {
    const id = Number($("setFlagId").value);
    if (Number.isFinite(id)) { win().__dev?.setFlag?.(id, false); log(`setFlag ${id} = 0`); refreshSnapshot(); }
  });
  $("tpGo").addEventListener("click", () => {
    const x = Number($("tpX").value), y = Number($("tpY").value);
    if (Number.isFinite(x) && Number.isFinite(y)) { win().__teleport?.(x, y); log(`teleport ${x},${y}`); refreshSnapshot(); }
  });
  $("chapterGo").addEventListener("click", () => {
    const n = Number($("chapterN").value);
    if (Number.isFinite(n)) { win().__setChapter?.(n); log(`chapter -> ${n}`); refreshSnapshot(); }
  });
  $("chapterClear").addEventListener("click", () => { win().__setChapter?.(null); log("chapter -> derived"); refreshSnapshot(); });
  $("snapCopy").addEventListener("click", async () => {
    const snap = await refreshSnapshot();
    try { await navigator.clipboard.writeText(JSON.stringify(snap, null, 1)); log("state JSON copied"); }
    catch { log("clipboard blocked; JSON is in the panel"); }
  });
  $("snapRefresh").addEventListener("click", refreshSnapshot);
}

// ── window.__dev (parent page) — scripts drive the same actions ──────────────
function installDev() {
  window.__dev = {
    // jump to a stage in-place (no reload); use the Jump buttons for the ?map= reload route.
    jump: (map, x, y) => win().__dev?.jump?.(map, x ?? null, y ?? null),
    reload: (map) => reloadGame(map),
    startBattle: (opts) => win().__dev?.startBattle?.(opts),
    startScreenBattle: (id, opts) => win().__dev?.startScreenBattle?.(id, opts),
    playEvent: (map, id) => win().__dev?.playEvent?.(map, id),
    setFlag: (id, val) => win().__dev?.setFlag?.(id, val),
    setArena: (id) => applyArena(Number(id)),
    snapshot: () => currentSnapshot(),
    exportJSON: () => JSON.stringify(currentSnapshot(), null, 1),
    get game() { return win(); },
  };
}

// ── boot ─────────────────────────────────────────────────────────────────────
(async () => {
  installDev();
  await loadData();
  renderStages();
  renderBattles();
  renderAssets();
  wireStatePane();

  frame.addEventListener("load", () => {
    setReadyPill(false, "loading…");
    // Hide the game's own HUD/toolbars so only the screen shows, like ui-lab.
    try {
      const d = frame.contentDocument;
      const s = d.createElement("style");
      s.textContent = "header,#hint,#hud{display:none!important} #stage{margin:0}";
      d.head.appendChild(s);
    } catch { /* cross-origin unexpected */ }
  });

  reloadGame(null);
  onReady(() => {
    log(`game ready on ${win().__mapInfo?.().id ?? "?"} — data: ${DATA.manifest.maps.length} maps, ${DATA.enemies.length} enemies, ${Object.keys(DATA.arenas.byArena).length} arenas`);
    // The events panel is (re)selected for the loaded stage by selectLoadedStage()
    // on every ready transition, so it also survives a Jump reload.
    refreshSnapshot();
  });
  watchReady();
  setInterval(refreshSnapshot, 1000);
})();
