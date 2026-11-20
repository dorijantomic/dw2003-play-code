// Generic motions tester for the animation viewer.
//
// The generator (web/fight/generic-motion.js) bakes ONE generic motion (walk, hop, flinch...) for ANY
// Digimon, in the browser, into a clone of its anim.json whose timeline[table] plays the generated
// frames. This module is the viewer's side of that: nothing here knows a species.
//
//   * the in-memory model "folder": the renderer loads models by FOLDER (`<base>/anim.json`), so a baked
//     clone is presented as a model folder of its own (`<folder>-gm-<motion>`) and a fetch shim serves
//     the clone from memory and sends the slot map / texture to the real body (same trick as
//     anim-viewer-bake.js, which this builds on).
//   * the preview: idle -> motion -> idle as one playlist of raw timeline tables, and how many logic
//     ticks that lasts (measured with the renderer's own sampler).
//   * the ratings: works / broken / unsure per (motion, Digimon) in localStorage, the motion x body-plan
//     count matrix, JSON export and a merging import.
//   * the generator loader: the real module when it exists, else the placeholder stub (and it says which).
//
// Pure functions + a tiny DOM renderer; the wiring lives in anim-viewer.html (tests/anim-viewer-generic.test.js).
import { MODEL_ANIM, MODEL_TEXTURE } from "./anim-viewer-bake.js";
import { TimelinePlayer } from "./fight/timeline-player.js";

export const VERDICTS = ["works", "broken", "unsure"];
export const VERDICT_MARK = { works: "✓", broken: "✗", unsure: "?" };
export const RATING_KEY = "dw3.genericRatings.v1";
export const PREVIEW_KEY = "dw3.genericFullPreview.v1";
export const TICK_SPEED = 2;

// ── the in-memory model folder ──────────────────────────────────────────────────────────────────
const safeId = (s) => String(s || "").replace(/[^A-Za-z0-9_]/g, "_");
const GENERIC_FOLDER = /^(.+)-gm-([A-Za-z0-9_]+)$/;
export const genericFolder = (folder, motion) => `${folder}-gm-${safeId(motion)}`;
export const isGenericFolder = (f) => GENERIC_FOLDER.test(String(f || ""));
export const genericRealFolder = (f) => GENERIC_FOLDER.exec(String(f || ""))?.[1] ?? null;

/** Baked clones by their virtual folder. Bounded: the oldest are dropped (the renderer keeps its own copy). */
export function createGenericStore(limit = 24) {
  const map = new Map();
  return {
    set(vf, entry) { map.delete(vf); map.set(vf, entry); while (map.size > limit) map.delete(map.keys().next().value); },
    get: (vf) => map.get(vf) || null,
    has: (vf) => map.has(vf),
    size: () => map.size,
    /** What to do with one request: {json} serve from memory, {url} fetch this instead, null pass through. */
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

/** Install the shim in front of whatever fetch is there now. */
export function installGenericFetch(store, target = globalThis) {
  const orig = target.fetch;
  if (typeof orig !== "function") return null;
  if (orig.__genericShim) return orig;
  const shim = (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const hit = store.resolve(url);
    if (!hit) return orig.call(target, input, init);
    shim.hits.push({ from: url, json: !!hit.json, to: hit.url || "(memory)" });
    if (hit.json) {
      return Promise.resolve(new Response(JSON.stringify(hit.json), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return orig.call(target, hit.url, init);
  };
  shim.__genericShim = true;
  shim.hits = [];
  target.fetch = shim;
  return shim;
}

// ── the preview (idle -> motion -> idle) ────────────────────────────────────────────────────────
/** Logic ticks one pass of a raw table lasts: to its end marker or its first loop-back. */
export function simulateTicks(table, speed = TICK_SPEED, cap = 1500) {
  if (!table || !table.length) return 0;
  const p = new TimelinePlayer(table);
  let n = 0;
  while (!p.ended && n < cap) {
    p.step(speed);
    n++;
    if (p.looped) break;
  }
  return Math.max(1, n);
}

/**
 * The tables to hand `debugPlayPlaylist` and the length of the whole preview in ticks. Idle table 0 is
 * the body's own idle; a playlist advances a looping non-final table at its loop-back, so each idle
 * leg lasts exactly one idle cycle (the last leg is cut at `postIdle` ticks).
 */
export function previewPlan(model, motionTable, { full = true, postIdle = 45 } = {}) {
  const motion = model?.timeline?.[motionTable]?.table || [];
  const idle = model?.timeline?.[0]?.table || [];
  const motionTicks = simulateTicks(motion);
  if (!full || !idle.length) return { tables: [motion], ticks: Math.max(1, motionTicks), motionTicks, idleTicks: 0, lead: 0 };
  const idleTicks = simulateTicks(idle);
  return {
    tables: [idle, motion, idle],
    ticks: idleTicks + motionTicks + Math.min(idleTicks, postIdle),
    motionTicks, idleTicks, lead: idleTicks,
  };
}

export const genericQuery = ({ motion, folder } = {}) => {
  if (!motion) return "";
  const q = new URLSearchParams();
  q.set("generic", motion);
  if (folder) q.set("model", folder);
  return q.toString();
};

// ── the generator: real if it exists, else the stub ─────────────────────────────────────────────
const valid = (m) => m && Array.isArray(m.GENERIC_MOTIONS) && typeof m.listGenericMotions === "function" && typeof m.bakeGenericMotion === "function";
export async function loadGenerator(importer = (p) => import(p), paths = { real: "./fight/generic-motion.js", stub: "./anim-viewer-generic-stub.js" }) {
  let realError = null;
  try {
    const m = await importer(paths.real);
    if (valid(m)) return { source: "real", path: "web/fight/generic-motion.js", api: m };
    realError = "web/fight/generic-motion.js exists but does not export the agreed API";
  } catch (e) { realError = String(e?.message || e); }
  const stub = await importer(paths.stub);
  if (!valid(stub)) throw new Error("the stub generator is broken too");
  return { source: "stub", path: "web/anim-viewer-generic-stub.js", api: stub, realError };
}

// ── ratings ─────────────────────────────────────────────────────────────────────────────────────
export function safeStorage(g = globalThis) {
  try {
    const s = g.localStorage;
    if (!s) return null;
    const k = "__gm_probe__";
    s.setItem(k, "1"); s.removeItem(k);
    return s;
  } catch { return null; }
}

const rkey = (motion, folder) => `${motion}|${folder}`;

// K25: every entry carries a `kind` ("generic" for the motions this module bakes, "dw2" for the DW2
// motions' tester), so both kinds share ONE store/localStorage key and one export yet stay separable.
export function createRatingStore({ storage = safeStorage(), key = RATING_KEY, now = () => new Date().toISOString(), defaultKind = "generic" } = {}) {
  let map = new Map();
  let persisted = !!storage;
  try {
    const raw = storage?.getItem(key);
    if (raw) for (const r of JSON.parse(raw)) if (r?.motion && r?.folder && VERDICTS.includes(r.verdict)) map.set(rkey(r.motion, r.folder), { kind: defaultKind, ...r });
  } catch { /* unreadable storage: start empty, keep working in memory */ }
  const save = () => {
    try { storage?.setItem(key, JSON.stringify([...map.values()])); persisted = !!storage; }
    catch { persisted = false; }
    return persisted;
  };
  const worth = (r, kind) => (kind == null ? true : (r.kind || defaultKind) === kind);
  const api = {
    get persisted() { return persisted; },
    get: (motion, folder) => map.get(rkey(motion, folder)) || null,
    all: (kind = null) => [...map.values()].filter((r) => worth(r, kind)),
    size: (kind = null) => api.all(kind).length,
    set(motion, folder, { verdict, note = "", name = "", bodyPlan = null, kind = defaultKind }) {
      if (!VERDICTS.includes(verdict)) throw new Error(`bad verdict ${verdict}`);
      const e = { motion, folder, name, bodyPlan: bodyPlan || "unknown", verdict, note: String(note || "").slice(0, 300), at: now(), kind };
      map.set(rkey(motion, folder), e);
      save();
      return e;
    },
    setNote(motion, folder, note) {
      const e = map.get(rkey(motion, folder));
      if (!e) return null;
      e.note = String(note || "").slice(0, 300); e.at = now(); save();
      return e;
    },
    clear(motion, folder) { const had = map.delete(rkey(motion, folder)); if (had) save(); return had; },
    /** folder -> {works, broken, unsure, total} for the species list marker. */
    byFolder(kind = null) {
      const out = new Map();
      for (const r of api.all(kind)) {
        const c = out.get(r.folder) || { works: 0, broken: 0, unsure: 0, total: 0 };
        c[r.verdict]++; c.total++;
        out.set(r.folder, c);
      }
      return out;
    },
    /** motion -> plan -> {works, broken, unsure}. */
    matrix(kind = null) {
      const out = new Map();
      for (const r of api.all(kind)) {
        const row = out.get(r.motion) || new Map();
        const c = row.get(r.bodyPlan) || { works: 0, broken: 0, unsure: 0 };
        c[r.verdict]++;
        row.set(r.bodyPlan, c);
        out.set(r.motion, row);
      }
      return out;
    },
    exportObject() {
      const ratings = [...map.values()]
        .sort((a, b) => a.motion.localeCompare(b.motion) || a.folder.localeCompare(b.folder))
        .map((r) => ({ motion: r.motion, folder: r.folder, name: r.name, bodyPlan: r.bodyPlan, verdict: r.verdict, note: r.note || "", at: r.at, kind: r.kind || defaultKind }));
      return { generatedAt: now(), ratings };
    },
    /** Merge an exported object (or its JSON text). The newer `at` wins. */
    importObject(input) {
      let obj = input;
      if (typeof input === "string") obj = JSON.parse(input);
      if (!obj || !Array.isArray(obj.ratings)) throw new Error("not a ratings file: no ratings array");
      const res = { added: 0, updated: 0, kept: 0, skipped: 0 };
      for (const r of obj.ratings) {
        if (!r || typeof r.motion !== "string" || typeof r.folder !== "string" || !VERDICTS.includes(r.verdict)) { res.skipped++; continue; }
        const k = rkey(r.motion, r.folder), cur = map.get(k);
        const entry = { motion: r.motion, folder: r.folder, name: String(r.name || ""), bodyPlan: String(r.bodyPlan || "unknown"), verdict: r.verdict, note: String(r.note || "").slice(0, 300), at: String(r.at || obj.generatedAt || now()), kind: String(r.kind || defaultKind) };
        if (!cur) { map.set(k, entry); res.added++; }
        else if (entry.at > cur.at) { map.set(k, entry); res.updated++; }
        else res.kept++;
      }
      save();
      return res;
    },
  };
  return api;
}

// ── DOM (kept small; everything it needs is passed in) ──────────────────────────────────────────
const h = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) if (k != null && k !== "") n.append(k);
  return n;
};

/**
 * The "Generic motions" section for the current Digimon.
 * v: { digimon:{name,folder,plan}, source:{source,path}, motions:[{id,name,description,applicable,reason}],
 *      selected, rating(id)->entry|null, current: {report, ticks}|null, full, busy,
 *      onSelect(id), onRate(verdict, note), onClear(), onNote(note), onAB(), onFull(bool) }
 */
export function renderGenericPanel(box, v) {
  box.replaceChildren();
  const stub = v.source?.source !== "real";
  box.append(h("div", { className: "groupTitle" },
    `Generic motions · ${v.digimon?.name || "?"} (${v.digimon?.plan || "no body plan"}) · generator: `,
    h("b", { className: stub ? "gvStub" : "gvReal", textContent: stub ? "STUB placeholder (the real generator is not on disk)" : "real (web/fight/generic-motion.js)", title: v.source?.path || "" })));
  const row = h("div", { className: "actList" });
  for (const m of v.motions) {
    const r = v.rating?.(m.id);
    const cls = "act gmBtn" + (m.applicable ? "" : " na") + (v.selected === m.id ? " sel" : "");
    const b = h("button", { className: cls, title: m.applicable ? (m.description || m.name) : `not applicable: ${m.reason || "this body lacks what the motion needs"}`, type: "button" },
      m.name, r ? h("span", { className: `gv ${r.verdict}`, textContent: ` ${VERDICT_MARK[r.verdict]}`, title: `${r.verdict}${r.note ? ": " + r.note : ""}` }) : "");
    b.dataset.motion = m.id;
    b.setAttribute("aria-disabled", m.applicable ? "false" : "true");
    b.onclick = () => v.onSelect(m.id, m);
    row.append(b);
  }
  box.append(row);
  const ctl = h("div", { className: "rowline" });
  const full = h("input", { type: "checkbox", checked: !!v.full, id: "gmFull" });
  full.onchange = () => v.onFull(full.checked);
  ctl.append(h("label", { title: "play the Digimon's own idle, then the generic motion, then idle again" }, full, " idle → motion → idle"));
  const ab = h("button", { textContent: "A/B vs idle", title: "flip between this generic motion and the Digimon's own idle, same tick and camera", type: "button", id: "gmAB" });
  ab.disabled = !v.selected;
  ab.onclick = () => v.onAB();
  ctl.append(ab);
  if (v.busy) ctl.append(h("span", { className: "dim", textContent: v.busy }));
  box.append(ctl);
  if (v.selected) {
    const m = v.motions.find((x) => x.id === v.selected);
    const cur = v.rating?.(v.selected);
    const rate = h("div", { className: "rowline", id: "gmRate" }, h("span", { className: "dim" }, "Does "), h("b", {}, m?.name || v.selected), h("span", { className: "dim" }, ` look right on ${v.digimon?.name || "this Digimon"}?`));
    const note = h("input", { type: "text", id: "gmNote", placeholder: "note (optional, one line)", value: cur?.note || "", maxLength: 300, size: 34 });
    for (const verdict of VERDICTS) {
      const b = h("button", { className: `rateBtn ${verdict}` + (cur?.verdict === verdict ? " sel" : ""), textContent: verdict, type: "button", title: cur?.verdict === verdict ? "click again to remove the rating" : `mark ${verdict}` });
      b.dataset.verdict = verdict;
      b.onclick = () => (cur?.verdict === verdict ? v.onClear() : v.onRate(verdict, note.value));
      rate.append(b);
    }
    note.onchange = () => v.onNote(note.value);
    rate.append(note);
    box.append(rate);
    if (v.current?.report) {
      const text = typeof v.current.report === "string" ? v.current.report : JSON.stringify(v.current.report);
      box.append(h("div", { className: "rowline dim", id: "gmReport", title: text }, `preview ${v.current.ticks} ticks · motion ${v.current.frames ?? "?"} frames · ${text.length > 220 ? text.slice(0, 220) + "…" : text}`));
    }
  }
}

/** The Ratings tab: motion x body plan counts + export / import. */
export function renderRatingsPanel(box, v) {
  box.replaceChildren();
  const bar = h("div", { className: "rowline" });
  const exp = h("button", { textContent: "Export JSON", id: "gmExport", type: "button" }); exp.onclick = () => v.onExport();
  const cp = h("button", { textContent: "Copy JSON", id: "gmCopy", type: "button" }); cp.onclick = () => v.onCopy();
  const file = h("input", { type: "file", accept: "application/json,.json", id: "gmImportFile", style: "display:none" });
  file.onchange = () => { if (file.files?.[0]) v.onImport(file.files[0]); file.value = ""; };
  const imp = h("button", { textContent: "Import (merge)", id: "gmImport", type: "button" }); imp.onclick = () => file.click();
  bar.append(exp, cp, imp, file,
    h("span", { className: "dim", id: "gmTotals" }, `${v.total} rating${v.total === 1 ? "" : "s"} ${v.persisted ? "saved in this browser" : "(NOT persisted: this browser blocks storage)"}`));
  box.append(bar);
  const t = h("table", { id: "gmMatrix" });
  const head = h("tr", {}, h("th", { textContent: "motion \\ body plan" }));
  for (const p of v.plans) head.append(h("th", { textContent: p, title: p }));
  t.append(head);
  for (const m of v.motions) {
    const tr = h("tr", {}, h("td", { textContent: m.name, title: m.description || "" }));
    const row = v.matrix.get(m.id);
    for (const p of v.plans) {
      const c = row?.get(p);
      const td = h("td");
      if (c) {
        td.append(h("span", { className: "gv works", textContent: c.works }), "/", h("span", { className: "gv broken", textContent: c.broken }), "/", h("span", { className: "gv unsure", textContent: c.unsure }));
        td.title = `${c.works} works / ${c.broken} broken / ${c.unsure} unsure`;
      } else td.append(h("span", { className: "dim", textContent: "·" }));
      tr.append(td);
    }
    t.append(tr);
  }
  box.append(h("div", { className: "matrixWrap" }, t));
  box.append(h("div", { className: "rowline dim" }, "cells are works / broken / unsure, counted per body plan (digimon-anatomy.js). Rows: the generic motions; columns: body plans with at least one rating." + (v.unrated?.length ? ` No ratings yet for: ${v.unrated.join(", ")}.` : "")));
}
