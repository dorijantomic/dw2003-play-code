// Fusion Lab (dev page). Talks to tools/fusion_lab_server.py on localhost:8791, which runs ~/dw3-fusion/tools/fuse.py.
import type { FusionLabBody, FusionLabRow, FusionLabSelection } from "./types/fusion-lab.js";
const API = "http://localhost:8791";
const KINDS = ["arms", "legs", "head", "tail", "wings"];
const $ = (id: string) => document.getElementById(id) as any;

let models = [];          // {id, name, rookie}
let fusions = [];         // {id, name}
let byLabel = new Map();  // datalist label -> id
let byId = new Map();     // id -> {label, rookie, blocked}
let rookieIds = new Set();
let bossIds = new Set();  // Lab bosses already written (ids "lab_<model>")
let lastBuild = null;     // {model, recipe}
const rows: FusionLabRow[] = [];

async function api(path: string, body?: FusionLabBody) {
  const r = await fetch(API + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return r.json();
}

function blockedOf(id) { return (byId.get(id) || {}).blocked || null; }
function labelFor(m) { return m.name + " (" + m.id + ")" + (m.rookie ? " [rookie]" : ""); }
function fusionLabel(f: { id: string; name: string; }) { return "fusion " + f.id + (f.name ? " - " + f.name : ""); }

function fillList() {
  byLabel = new Map(); byId = new Map(); rookieIds = new Set();
  const dl = $("all"); dl.textContent = "";
  const add = (label: string, id, rookie: boolean, blocked) => {
    byLabel.set(label, id); byId.set(id, { label, rookie, blocked: blocked || null });
    const o = document.createElement("option"); o.value = label; dl.appendChild(o);
    if (rookie) rookieIds.add(id);
  };
  for (const f of fusions) add(fusionLabel(f), f.id, false, f.blocked);
  for (const m of models) add(labelFor(m), m.id, m.rookie, m.blocked);
}

// text typed in an input -> model id (exact label, bare id, or a unique name match), else null
function resolve(text: string) {
  text = (text || "").trim();
  if (!text) return null;
  if (byLabel.has(text)) return byLabel.get(text);
  if (byId.has(text)) return text;
  const low = text.toLowerCase();
  const hits = [...byLabel].filter(([l]) => l.toLowerCase().startsWith(low + " ") || l.toLowerCase() === low);
  return hits.length === 1 ? hits[0][1] : null;
}

// ---- candidate lists (parts found by position; several = the user must pick)
async function loadCands(model: string | number | boolean, kind: string) {
  const d = await api("/api/candidates?model=" + encodeURIComponent(model) + "&kind=" + kind);
  if (d.error) throw new Error(d.error);
  return d.candidates;
}

// a part the tool is not sure about (fuse.py disagrees with bodies.json / anatomy.json): plain warning under the picker
function trustWarn(box: HTMLDivElement, label: string, c) {
  if (!c || c.trusted) return;
  const w = document.createElement("div"); w.className = "warn";
  w.textContent = "Warning, " + label + ": " + ((c.reasons && c.reasons.length) ? [...new Set(c.reasons)].join("; ") : "the tool is not sure this is the right part.") +
    " You can still use it, but the result may look wrong.";
  box.appendChild(w);
}

function candPicker(label: string, cands, onChange: { (): void; (): void; (): void; }) {
  const wrap = document.createElement("div");
  if (!cands.length) {
    wrap.className = "err"; wrap.textContent = label + ": no part of this kind found on this model (adding parts comes later).";
    return { el: wrap, value: () => null, missing: true };
  }
  if (cands.length === 1) {
    wrap.className = "small"; wrap.textContent = label + ": one candidate, used automatically.";
    trustWarn(wrap, label, cands[0]);
    return { el: wrap, value: () => cands[0].spec, missing: false };
  }
  const sel = document.createElement("select");
  const none = document.createElement("option"); none.value = ""; none.textContent = "-- pick one --"; sel.appendChild(none);
  for (const c of cands) {
    const o = document.createElement("option"); o.value = c.spec;
    o.textContent = (c.trusted ? "" : "(not sure) ") + "[" + c.index + "] " + (c.index === 0 ? "highest" : c.index === cands.length - 1 ? "lowest" : "middle") + " on the body (height " + c.height + " of body), " + c.text;
    sel.appendChild(o);
  }
  const tw = document.createElement("div");
  sel.addEventListener("change", () => { tw.textContent = ""; trustWarn(tw, label, cands.find((c: { spec: string; }) => c.spec === sel.value)); onChange(); });
  const t = document.createElement("div"); t.className = "warn"; t.textContent = label + ": " + cands.length + " candidates, pick one.";
  wrap.append(t, sel, tw);
  return { el: wrap, value: () => sel.value || null, missing: false, needs: true };
}

function addRow(init?: FusionLabSelection | null | undefined) {
  const row = { part: null, donor: null, baseCands: null, donorCands: null } as FusionLabRow;
  const el = document.createElement("div"); el.className = "row";
  const part = document.createElement("select");
  for (const k of KINDS) { const o = document.createElement("option"); o.value = k; o.textContent = k; part.appendChild(o); }
  const donor = document.createElement("input"); donor.setAttribute("list", "all"); donor.size = 34; donor.placeholder = "donor Digimon";
  const del = document.createElement("button"); del.textContent = "remove";
  const warn = document.createElement("div"); warn.className = "warn";
  const cands = document.createElement("div"); cands.className = "cands";
  el.append(part, " from ", donor, del, warn, cands);
  row.el = el; row.part = part; row.donor = donor; row.cands = cands; row.warn = warn;
  del.onclick = () => { rows.splice(rows.indexOf(row), 1); el.remove(); };
  const refresh = () => refreshRow(row);
  part.onchange = refresh; donor.onchange = refresh; donor.oninput = () => { if (resolve(donor.value)) refresh(); };
  row.refresh = refresh;
  if (init) { part.value = init.part; donor.value = (byId.get(init.donor) || {}).label || init.donor; row.pre = init; }
  rows.push(row); $("rows").appendChild(el);
  if (init) refresh();
  return row;
}

async function refreshRow(row: FusionLabRow) {
  const token = (row.token = (row.token || 0) + 1);
  const kind = row.part.value, donorId = resolve(row.donor.value), baseId = resolve($("base").value);
  row.cands.textContent = ""; row.warn.textContent = "";
  row.donorPick = null; row.basePick = null;
  if (donorId && blockedOf(donorId)) row.warn.textContent = "Blocked donor: " + blockedOf(donorId);
  try {
    if (baseId) {
      const bc = await loadCands(baseId, kind);
      if (token !== row.token) return;
      row.basePick = candPicker("Base " + kind, bc, () => {});
      if (row.pre && row.pre.base_chain && row.basePick.needs) { const s = row.basePick.el.querySelector("select"); if (s) s.value = row.pre.base_chain; }
      row.cands.appendChild(row.basePick.el);
    }
    if (donorId) {
      try {
        const at = await api("/api/attacks?model=" + encodeURIComponent(donorId) + "&kind=" + kind);
        if (token !== row.token) return;
        const a = document.createElement("div"); a.className = "small";
        if (!at.known) a.textContent = "Attacks from this part: donor is not in anatomy.json, unknown.";
        else {
          const f = (l: { technique: string; bodyPart: string; }[]) => l.map((s: { technique: string; bodyPart: string; }) => s.technique + " (" + s.bodyPart + ")").join(", ");
          a.textContent = "Attacks from this donor " + kind + ": " + (at.mine.length ? f(at.mine) : "none listed in anatomy.json") + (at.others.length ? ".  Other attacks of this Digimon come from other parts: " + f(at.others) : "");
        }
        row.cands.appendChild(a);
      } catch (e) { /* attacks are extra info only */ }
      const dc = await loadCands(donorId, kind);
      if (token !== row.token) return;
      row.donorPick = candPicker("Donor " + kind, dc, () => {});
      if (row.pre && row.pre.donor_chain && row.donorPick.needs) { const s = row.donorPick.el.querySelector("select"); if (s) s.value = row.pre.donor_chain; }
      row.cands.appendChild(row.donorPick.el);
    }
  } catch (e) { row.warn.textContent = "Could not read parts: " + e.message; }
  row.pre = null;
}

function recipe() {
  const base = resolve($("base").value);
  const ops = [];
  for (const r of rows) {
    const donor = resolve(r.donor.value);
    const o = { part: r.part.value, donor } as FusionLabSelection;
    const dv = r.donorPick && r.donorPick.value(), bv = r.basePick && r.basePick.value();
    if (dv) o.donor_chain = dv;
    if (bv) o.base_chain = bv;
    ops.push(o);
  }
  return { base, ops };
}

function problems(rc) {
  const out = [];
  if (!rc.base) out.push("Pick a base Digimon from the list.");
  else if (blockedOf(rc.base)) out.push("Base: " + blockedOf(rc.base));
  if (!rc.ops.length) out.push("Add at least one part row.");
  rows.forEach((r, i) => {
    const n = "Row " + (i + 1) + " (" + r.part.value + ")";
    if (!rc.ops[i].donor) out.push(n + ": pick a donor from the list.");
    else if (blockedOf(rc.ops[i].donor)) out.push(n + ": donor " + blockedOf(rc.ops[i].donor));
    if (r.donorPick && r.donorPick.missing) out.push(n + ": the donor has no " + r.part.value + ".");
    if (r.basePick && r.basePick.missing) out.push(n + ": the base has no " + r.part.value + ".");
    if (r.donorPick && r.donorPick.needs && !r.donorPick.value()) out.push(n + ": pick which donor " + r.part.value + " to use.");
    if (r.basePick && r.basePick.needs && !r.basePick.value()) out.push(n + ": pick which base " + r.part.value + " to replace.");
  });
  return out;
}

// ---- battle data (tools/fusion_battle.py, plain words)
const STAT_WORDS = { str: "Strength", def: "Defence", spt: "Spirit", wis: "Wisdom", spd: "Speed" };
function li(ul: HTMLUListElement, text: string | null, cls?: string | undefined) { const e = document.createElement("li"); e.textContent = text; if (cls) e.className = cls; ul.appendChild(e); return e; }
function heading(box: { appendChild: (arg0: HTMLDivElement) => void; }, text: string | null) { const h = document.createElement("div"); h.className = "small"; h.style.marginTop = "8px"; h.style.color = "#9ec5ff"; h.textContent = text; box.appendChild(h); }

function renderBattle(d) {
  const box = $("battle"); box.textContent = "";
  if (!d || d.error) { box.textContent = d && d.error ? d.error : ""; box.className = "err"; return; }
  box.className = "";
  heading(box, "Who may fuse");
  let ul = document.createElement("ul");
  for (const e of d.eligibility) li(ul, e.name + ": " + (e.blocked || "allowed."), e.blocked ? "err" : "ok");
  box.appendChild(ul);
  heading(box, "Where each part's numbers come from");
  ul = document.createElement("ul");
  for (const sr of d.sources || []) {
    const e = li(ul, sr.text, sr.kind === "none" ? "err" : "");
    if (sr.stats.length) { const x = document.createElement("div"); x.className = "small"; x.textContent = sr.stats.join("; "); e.appendChild(x); }
  }
  box.appendChild(ul);
  heading(box, "Stats: the largest value among the parts' Digimon, plus a quarter of the second largest");
  if (!d.stats) { const w = document.createElement("div"); w.className = "warn"; w.textContent = d.unavailable; box.appendChild(w); }
  else {
    ul = document.createElement("ul");
    for (const k of Object.keys(d.stats)) li(ul, STAT_WORDS[k] + ": " + d.stats[k].text);
    box.appendChild(ul);
    const k = d.kept;
    heading(box, "Kept from the base (" + k.from + ")");
    ul = document.createElement("ul");
    li(ul, "Resistances: " + Object.entries(k.resistances).map(([a, b]) => a + " " + b).join(", "));
    li(ul, "Status resists: " + Object.entries(k.status_resist).map(([a, b]) => a + " " + b).join(", "));
    li(ul, "Family group " + k.family + ", drop " + k.drop_item + " (rate " + k.drop_rate + ").");
    box.appendChild(ul);
  }
  heading(box, "Attacks (a fusion fights with Fight and two specials)");
  ul = document.createElement("ul");
  for (const m of d.moves) {
    const e = li(ul, m.slot_text + ": " + m.name + " (id " + m.id + ", emitter " + m.emitter + "). " + m.reason +
      (m.clip != null ? ". Plays on the base model's clip " + m.clip + " (" + m.clip_kind + "; " + (m.base_authors_clip ? "the base model has its own" : "the base model has none, the game borrows or builds it") + ")." : ""));
    for (const f of m.flags) { const x = document.createElement("div"); x.className = "warn"; x.textContent = "Flag: " + f; e.appendChild(x); }
  }
  box.appendChild(ul);
  if (d.notes.length) { ul = document.createElement("ul"); for (const n of d.notes) li(ul, n, "small"); box.appendChild(ul); }
  heading(box, "As a boss");
  ul = document.createElement("ul");
  if (d.level) {
    li(ul, "Level " + d.level.level + " (the highest), HP " + d.level.hp + " (the parts' HP added), stat scale " + d.level.stat_scale + " (the highest). Each part:");
    for (const t of d.level.from) li(ul, t, "small");
  }
  for (const b of d.blockers) li(ul, "Not ready: " + b, "err");
  if (d.boss_ready) li(ul, "Ready: save it as a favourite, then Make boss.", "ok");
  box.appendChild(ul);
}

async function showBattle() {
  const rc = recipe();
  if (!rc.base || rc.ops.some((o) => !o.donor)) { renderBattle({ error: "Pick the base and a donor for every row to see battle data." }); return; }
  try { renderBattle(await api("/api/battle", { base: rc.base, ops: rc.ops.map((o) => ({ part: o.part, donor: o.donor })) })); }
  catch (e) { renderBattle({ error: "Helper server not reachable: " + e.message }); }
}

function show(model: string | number | boolean) {
  $("resId").textContent = model ? "(" + model + ")" : "";
  $("viewer").src = model ? "model-viewer.html?model=" + encodeURIComponent(model) + "&t=" + Date.now() : "about:blank";
}

async function build() {
  const rc = recipe();
  $("error").textContent = ""; $("summary").textContent = ""; $("raw").textContent = ""; $("saveMsg").textContent = "";
  const p = problems(rc);
  if (p.length) { $("error").textContent = p.join("\n"); return; }
  $("build").disabled = true; $("save").disabled = true; $("status").textContent = "building (can take a minute)...";
  try {
    const body = { base: rc.base, ops: rc.ops } as FusionLabBody;
    if (window.__reuseOut) body.out = window.__reuseOut;
    const d = await api("/api/build", body);
    $("raw").textContent = (d.command ? d.command + "\n\n" : "") + (d.output || "");
    if (!d.ok) { $("error").textContent = "Build failed: " + (d.error || "unknown error"); $("status").textContent = ""; return; }
    $("status").textContent = "built " + d.model + " in " + d.seconds + " s";
    const ul = document.createElement("ul");
    for (const s of d.summary || []) { const li = document.createElement("li"); li.textContent = s; ul.appendChild(li); }
    $("summary").appendChild(ul);
    lastBuild = { model: d.model, recipe: rc };
    $("save").disabled = false;
    show(d.model);
    showBattle();
    await loadLists();
  } catch (e) {
    $("error").textContent = "Helper server not reachable on " + API + " (" + e.message + "). Start it as in DW2003-INDEX.md.";
  } finally { $("build").disabled = false; }
}

async function save() {
  const name = $("favName").value.trim();
  if (!lastBuild) return;
  if (!name) { $("saveMsg").textContent = "give it a name first"; return; }
  const d = await api("/api/favorites", { name, recipe: lastBuild.recipe, model: lastBuild.model });
  $("saveMsg").textContent = d.ok ? "saved" : (d.error || "failed");
  if (d.ok) await loadLists();
}

function reopen(f) {
  window.__reuseOut = f.model;
  $("base").value = (byId.get(f.recipe.base) || {}).label || f.recipe.base;
  $("rows").textContent = ""; rows.length = 0;
  for (const o of f.recipe.ops) addRow(o);
  $("favName").value = f.name;
  lastBuild = { model: f.model, recipe: f.recipe };
  $("save").disabled = false; $("error").textContent = ""; $("summary").textContent = ""; $("raw").textContent = "";
  $("status").textContent = "re-opened " + f.model + ". Build again to rebuild it under the same id.";
  show(f.model);
  showBattle();
}

async function makeBoss(f, msg: HTMLSpanElement) {
  msg.textContent = "working...";
  const d = await api("/api/boss", { model: f.model });
  if (d.ok) {
    msg.textContent = "Boss written (" + d.boss.id + ", level " + d.boss.level + ", HP " + d.boss.hp + "). In the game: tick F2 -> Extras -> Fusion bosses, then dev toolset (F2) -> Battles -> Fusion Lab bosses.";
    msg.className = "ok";
  } else { msg.textContent = d.error || "failed"; msg.className = "err"; }
  await loadFavs();
}

async function loadFavs() {
  const d = await api("/api/favorites");
  try { bossIds = new Set((await api("/api/bosses")).bosses || []); } catch (e) { bossIds = new Set(); }
  const box = $("favs"); box.textContent = "";
  if (!d.favorites.length) { box.textContent = "none yet"; return; }
  for (const f of d.favorites) {
    const div = document.createElement("div"); div.className = "fav";
    const s = document.createElement("span"); s.textContent = f.name + " (" + f.model + ", " + f.recipe.ops.map((o) => o.part).join("+") + ", saved " + f.saved + ")" + (bossIds.has("lab_" + f.model) ? " [boss]" : "");
    const open = document.createElement("button"); open.textContent = "open";
    open.onclick = () => reopen(f);
    const rm = document.createElement("button"); rm.textContent = "remove";
    rm.onclick = async () => { await api("/api/favorites/delete", { model: f.model }); loadFavs(); };
    const msg = document.createElement("span"); msg.className = "small";
    const boss = document.createElement("button");
    const isBoss = bossIds.has("lab_" + f.model);
    boss.textContent = isBoss ? "update boss" : "Make boss";
    boss.onclick = () => makeBoss(f, msg);
    div.append(s, open, boss);
    if (isBoss) {
      const unb = document.createElement("button"); unb.textContent = "remove boss";
      unb.onclick = async () => { await api("/api/boss/delete", { model: f.model }); loadFavs(); };
      div.append(unb);
    }
    div.append(rm, msg); box.appendChild(div);
  }
}

async function loadLists() {
  const d = await api("/api/models");
  models = d.models; fusions = d.fusions;
  $("rookieNote").textContent = d.rookie_note;
  fillList();
  await loadFavs();
}

function baseWarn() {
  const id = resolve($("base").value);
  $("baseWarn").textContent = id && blockedOf(id) ? "Blocked base: " + blockedOf(id) : "";
  rows.forEach((r) => r.refresh());
}

async function randomFusion() {
  $("error").textContent = ""; $("why").textContent = "";
  $("status").textContent = "picking..."; $("random").disabled = true;
  try {
    const d = await api("/api/random");
    if (d.error) { $("error").textContent = d.error; return; }
    window.__reuseOut = null;
    $("base").value = (byId.get(d.base) || {}).label || d.base;
    $("rows").textContent = ""; rows.length = 0;
    for (const o of d.ops) addRow(o);
    const ul = document.createElement("ul");
    const t = document.createElement("li"); t.textContent = "Base " + d.base_name + " (picked at random, not a rookie)."; ul.appendChild(t);
    for (const r of d.reasons) { const li = document.createElement("li"); li.textContent = r; ul.appendChild(li); }
    $("why").appendChild(ul);
    baseWarn0();
  } catch (e) { $("error").textContent = "Helper server not reachable: " + e.message; }
  finally { $("status").textContent = ""; $("random").disabled = false; }
}
function baseWarn0() { const id = resolve($("base").value); $("baseWarn").textContent = id && blockedOf(id) ? "Blocked base: " + blockedOf(id) : ""; }
$("random").onclick = randomFusion;
$("addRow").onclick = () => addRow();
$("build").onclick = build;
$("battleBtn").onclick = showBattle;
$("save").onclick = save;
$("base").onchange = () => { window.__reuseOut = null; baseWarn(); };
$("base").oninput = () => { if (resolve($("base").value)) baseWarn(); };
loadLists().then(() => { $("helper").textContent = " helper: connected"; addRow(); })
  .catch((e) => { $("helper").textContent = " helper NOT reachable on " + API + ": " + e.message; });
