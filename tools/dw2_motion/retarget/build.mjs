// build.mjs — the DW2 motions for the DW3 Digimon, built on the player's own computer from both discs.
//   node tools/dw2_motion/retarget/build.mjs [--only m003agum,...] [--jobs N] [--out DIR]
// Needs: the DW3 battle models (DW2M_GAME/models, from the DW3 disc) and the DW2 models in our format (DW2M_DW2/dw2_<id>/anim.json,
// from the DW2 disc: tools/dw2/dw2_addon.py --motion). Writes DW2M_GAME/dw2motion/<folder>.json (read by web/fight/dw2-motion.js when
// DW2 motion is on), plus cast-types.json and index.json there. Nothing it writes is ever committed (disc-derived).
//
// Per species and DW2 clip (the clip meanings: web/fight/dw2-clip-map.js): mkmap (our bones + the pairing) -> dw2delta (DW2's poses
// re-aimed on our body, as a scene) -> run (the scene compiled into a copy of our pack, checked) -> dir_error (limb directions vs
// DW2). Then the export joins each motion into ONE table the game plays, frames from 20000 up. This is the research prototype's
// convert_everything.mjs + export_game.mjs (the 2026-10-26 "rebuild c" settings: --flip rule --hiptravel on --leafroll on).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import cp from "node:child_process";
import { GAME, DW2, WORK, PAIRS, RIGS, DATA, modelPath, dw2Path } from "./paths.mjs";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const only = arg("--only", "") ? arg("--only").split(",") : null;
const JOBS = Math.max(1, +arg("--jobs", Math.max(1, os.cpus().length - 1)));
const OUT = arg("--out", path.join(GAME, "dw2motion"));
const SETTINGS = ["--flip", "rule", "--hiptravel", "on", "--leafroll", "on"];
const CLIPS = ["F", "G", "H", "I", "K", "C0", "C1", "C2", "J", "B"];
// clip letter -> the DW3 slot whose script plays it, and how the scene ends
const SPEC = { F: { slot: 9, tail: "cast" }, G: { slot: 9, tail: "cast" }, H: { slot: 9, tail: "cast" }, I: { slot: 5, tail: "melee" }, K: { slot: 3, tail: "death" },
  C0: { slot: 1, tail: "hit" }, C1: { slot: 4, tail: "hit" }, C2: { slot: 2, tail: "hit" }, J: { slot: 4, tail: "hit" }, B: { slot: 5, tail: "melee" } };
const TAILS = {
  cast: "# end of a cast: hold, the hit, settle\nphase hold 45t ease linear\n@LAST@\n  hit after 20\n\nphase settle 110t\n  rest\n",
  melee: "phase hold 20t ease linear\n@LAST@\n  hit after 0\n\nphase settle 70t\n  rest\n",
  hit: "phase settle 40t\n  rest\n",
  death: "phase hold 80t ease linear\n@LAST@\n",
};

const pairsDoc = JSON.parse(fs.readFileSync(PAIRS, "utf8"));
const rigs = JSON.parse(fs.readFileSync(RIGS, "utf8")).models;
const species = pairsDoc.species.filter((s) => (only ? only.includes(s.folder) : true));
for (const d of ["ap", "maps", "scenes", "out", "tails"]) fs.mkdirSync(path.join(WORK, d), { recursive: true });
for (const [k, t] of Object.entries(TAILS)) fs.writeFileSync(path.join(WORK, "tails", `${k}.tail`), t);
fs.mkdirSync(OUT, { recursive: true });

// at most JOBS tool processes at once, over ALL species and clips (one slow species no longer holds a core per clip in turn)
let running = 0;
const waiting = [];
const slot = () => (running < JOBS ? (running++, Promise.resolve()) : new Promise((r) => waiting.push(r)));
const free = () => { const r = waiting.shift(); if (r) r(); else running--; };
const node = (script, a) => slot().then(() => new Promise((resolve, reject) => {
  cp.execFile(process.execPath, [path.join(HERE, script), ...a], { cwd: WORK, encoding: "utf8", timeout: 300000, maxBuffer: 64 << 20 },
    (e, stdout, stderr) => (e ? reject(new Error(`${script}: ${(stderr || e.message).split("\n").slice(0, 2).join(" | ")}`)) : resolve(stdout)));
}).finally(free));

// ── one species: every clip converted ────────────────────────────────────────────────────────
async function convertSpecies(s) {
  const dw2 = JSON.parse(fs.readFileSync(dw2Path(s.dw2), "utf8"));
  let lo = 1e9, hi = -1e9; for (const b of dw2.bones) for (const v of b.verts || []) { lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }
  const ratio = rigs[s.folder].size.h / ((hi - lo) || 1), tpp = Math.max(2, Math.min(5, Math.round(2 * Math.sqrt(Math.max(1, ratio)))));
  const ap = path.join(WORK, "ap", `${s.folder}.ap.json`);
  fs.writeFileSync(ap, JSON.stringify({ dw2: { id: s.dw2 }, ours: { folder: s.folder }, flipDw2: s.flipDw2, pairs: s.pairs }));
  return Promise.all(CLIPS.map(async (letter) => {   // the clips are independent: they queue for the JOBS process slots
    const sp = SPEC[letter], clipIdx = dw2.clips.findIndex((c) => c.name === letter);
    const row = { folder: s.folder, name: s.name, dw2: s.dw2, letter, slot: sp.slot, ticksPerPose: tpp };
    try {
      if (clipIdx < 0) throw new Error(`no clip ${letter}`);
      const map = `maps/${s.folder}_${letter}.json`, scene = `scenes/${s.folder}_${letter}.motion`, out = `out/${s.folder}_${letter}`;
      await node("mkmap.mjs", [ap, map, "--slot", String(sp.slot)]);
      await node("dw2delta.mjs", [map, String(clipIdx), scene, "--tail", `tails/${sp.tail}.tail`, "--ticks", String(tpp), ...SETTINGS]);
      await node("run.mjs", [scene, out]);
      row.dirErr = +/dirErr ([\d.]+)/.exec(await node("dir_error.mjs", [map, String(clipIdx), out, `${scene}.targets.json`]))?.[1];
      row.dir = path.join(WORK, out);
      row.ok = true;
    } catch (e) { row.ok = false; row.error = String(e.message).slice(0, 200); }
    return row;
  }));
}

// ── one species: the converted clips joined into the file the game loads ────────────────────
const TERM = 30000, START = 20000, LIMIT = 29900;   // START 20000: the game bakes its own in-memory casts at 6000 + 4000*n AFTER loading this file; keys must stay sorted
const MERGE = ["C0", "C1", "B", "C2J", "C2K", "I", "F", "G", "H"];   // = web/fight/dw2-clip-map.js DW2_MOTION_LETTERS (frame ranges rise in this order)
const KIND = { F: "cast", G: "cast", H: "cast", I: "victory", B: "evade", C0: "flinch", C1: "reaction", C2J: "survive", C2K: "death" };
const PARTS = { C2J: ["C0", "C1", "C2", "J"], C2K: ["C0", "C1", "C2", "K"] };   // DW2's hit reaction order (Stg30_HitReactUpdate)
const hasOps = (a) => Array.isArray(a?.ops) && a.ops.length > 0;
function exportSpecies(s, batch) {
  const folder = s.folder;
  const own = JSON.parse(fs.readFileSync(modelPath(folder), "utf8"));
  const ownMax = Math.max(own.total_frames | 0, ...own.bones.flatMap((b) => [...(b.anim?.ch1 || []), ...(b.anim?.ch2 || [])].map((r) => r[3]).filter((f) => f !== TERM)));
  const usedTables = new Set(own.timeline.map((t, i) => (t?.table?.length ? i : -1)).filter((i) => i >= 0));
  const freeTable = () => { let t = own.timeline.length; while (usedTables.has(t)) t++; usedTables.add(t); return t; };
  const motions = {}, notes = [];
  const conv = (L) => batch.find((x) => x.ok && x.letter === L);
  const partsOf = (L) => (PARTS[L] || [L]).map(conv);
  const readPart = (r) => {   // one converted clip: the tables its slot script binds, in order, joined; the frames it uses
    const b = JSON.parse(fs.readFileSync(path.join(r.dir, folder, "anim.json"), "utf8"));
    for (let i = 0; i < own.bones.length; i++) for (const ch of ["ch1", "ch2"]) {   // our own data must be untouched
      const o = (own.bones[i].anim?.[ch] || []).filter((x) => x[3] !== TERM), n = (b.bones[i].anim?.[ch] || []).filter((x) => x[3] !== TERM);
      if (JSON.stringify(n.slice(0, o.length)) !== JSON.stringify(o)) throw new Error(`${folder} ${r.letter}: bone ${i} ${ch} own keys changed`);
    }
    const tabs = (b.actions[r.slot]?.ops || []).filter((o) => o.op === 2 && (o.words?.[0] | 0) === 0 && (o.words?.[2] | 0) > 1).map((o) => o.words[2] | 0).filter((t) => !own.timeline[t]?.table?.length);
    if (!tabs.length) return null;
    // every short table ends with 0xffff; joined as-is the game would stop at the FIRST one, so an inner end becomes the held last frame
    const entries = tabs.flatMap((t, ti) => b.timeline[t].table.flatMap((e, i, T) => {
      if ((e.value | 0) !== 0xffff || ti === tabs.length - 1) return [e];
      const last = [...T.slice(0, i)].reverse().find((x) => (x.value | 0) < 0x8000);
      return last ? [{ ...last }] : [];
    }));
    const fr = entries.map((e) => e.value).filter((v) => v < 0x8000), lo = Math.min(...fr), hi = Math.max(...fr);
    if (lo <= ownMax) throw new Error(`${folder} ${r.letter}: appended frames start at ${lo}, own data reaches ${ownMax}`);
    return { b, entries, lo, hi };
  };
  let cursor = START;
  for (const L of MERGE) {   // frame ranges MUST rise in this order: the game's key reader assumes sorted keys
    const rs = partsOf(L);
    if (!rs.at(-1)) { notes.push(`${L}: none`); continue; }
    const used = rs.filter(Boolean), missingParts = (PARTS[L] || []).filter((_, i) => !rs[i]);
    if (missingParts.length) notes.push(`${L}: without ${missingParts.join(",")}`);
    const keys = {}, ch1 = {}, start = cursor;
    let playlist = [], hit = null, bad = false;
    for (const [pi, r] of used.entries()) {
      const p = readPart(r);
      if (!p) { notes.push(`${L}: no appended table in ${r.letter} slot ${r.slot}`); bad = true; break; }
      const shift = cursor - p.lo, lastPart = pi === used.length - 1;
      p.b.bones.forEach((bn, i) => {
        const rows = (bn.anim?.ch2 || []).filter((x) => x[3] !== TERM && x[3] >= p.lo && x[3] <= p.hi).map((x) => [x[0], x[1], x[2], x[3] + shift]);
        if (rows.length) (keys[i] ||= []).push(...rows);
        const q = (bn.anim?.ch1 || []).filter((x) => x[3] !== TERM && x[3] >= p.lo && x[3] <= p.hi).map((x) => [x[0], x[1], x[2], x[3] + shift]);
        if (q.length) (ch1[i] ||= []).push(...q);
      });
      let pl = p.entries.map((e) => ({ ...e, value: e.value < 0x8000 ? e.value + shift : e.value, loop_target: (e.value & 0x8000) && e.value !== 0xffff && e.value !== 0x8000 ? e.loop_target + shift : e.loop_target }));
      if (!lastPart && pl.at(-1)?.value === 0xffff) { pl.pop(); const last = [...pl].reverse().find((x) => x.value < 0x8000); if (last) pl.push({ ...last }); }   // a chained part holds its last frame
      if (used.length === 1 && KIND[L] === "cast") {   // the strike pose (report.json release: frame = offset + tick), only for a technique body
        const rp = path.join(r.dir, "report.json"), rep = fs.existsSync(rp) ? JSON.parse(fs.readFileSync(rp, "utf8")) : null, ev = rep?.release?.[0];
        if (ev) { const hf = rep.offset + ev.tick + shift; const i = pl.findIndex((e) => e.value === hf); if (i >= 0) hit = i; else notes.push(`${L}: strike frame not in playlist`); }
        else notes.push(`${L}: no strike point`);
      }
      playlist.push(...pl);
      cursor = p.hi + shift + 10;
    }
    if (bad) { cursor = start; continue; }
    const missing = own.bones.length - Object.keys(keys).length;
    if (missing) notes.push(`${L}: ${missing} bones without keys`);
    // timing: each DW2 pose plays ticksPerPose (2-5) entries, DW2 shows one every 2: play faster by ticksPerPose/2, capped at 1.5x
    const speed = Math.min(1.5, Math.max(1, (used[0].ticksPerPose || 2) / 2));
    if (speed > 1) {
      const end = playlist.at(-1)?.value === 0xffff ? playlist.pop() : null, n = playlist.length, m = Math.max(1, Math.round(n / speed));
      playlist = Array.from({ length: m }, (_, k) => ({ ...playlist[Math.min(n - 1, Math.round(k * speed))] }));
      if (end) playlist.push(end);
      if (hit != null) hit = Math.min(m - 1, Math.round(hit / speed));
    }
    const fr = playlist.map((e) => e.value).filter((v) => v < 0x8000);
    const table = freeTable();
    motions[L] = { letter: L, used: true, kind: KIND[L], table, lo: Math.min(...fr), hi: Math.max(...fr), offset: start, frames: cursor - 10 - start + 1, keys, ch1, playlist,
      hit, speed, parts: used.map((r) => r.letter), method: "tools/dw2_motion/retarget", dirErr: Math.max(...used.map((r) => r.dirErr || 0)) };
    if (cursor > LIMIT) throw new Error(`${folder}: frames past ${LIMIT}`);
  }
  const ownedSlots = own.actions.map((a, i) => (hasOps(a) ? i : -1)).filter((i) => i >= 0), gapSlots = [...Array(18).keys()].filter((i) => i !== 12 && !ownedSlots.includes(i));
  const out = { v: 2, folder, dw2: s.dw2, name: s.name, ownedSlots, gapSlots, hasVictory: !!own.timeline[44]?.table?.length, motions,
    builtBy: "tools/dw2_motion/retarget/build.mjs", gate: null };
  fs.writeFileSync(path.join(OUT, `${folder}.json`), JSON.stringify(out));
  return { folder, name: s.name, letters: Object.keys(motions), notes };
}

// ── all species at once; the process slots (JOBS) limit the work ─────────────────────────────
const t0 = Date.now(), done = [], failed = [];
await Promise.all(species.map(async (s) => {
    try {
      if (!fs.existsSync(modelPath(s.folder))) throw new Error("no DW3 model (DW3 disc not extracted?)");
      if (!fs.existsSync(dw2Path(s.dw2))) throw new Error(`no DW2 model dw2_${s.dw2} (DW2 disc not converted?)`);
      const rows = await convertSpecies(s);
      const r = exportSpecies(s, rows);
      done.push({ ...r, clips: rows.filter((x) => x.ok).length, errors: rows.filter((x) => !x.ok).map((x) => `${x.letter}: ${x.error}`) });
      console.log(`[${done.length + failed.length}/${species.length}] ${s.name} (${s.folder}): ${r.letters.join(",")}${r.notes.length ? " | " + r.notes.join("; ") : ""}`);
    } catch (e) {
      failed.push({ folder: s.folder, error: String(e.message).slice(0, 200) });
      console.log(`[${done.length + failed.length}/${species.length}] FAILED ${s.folder}: ${String(e.message).slice(0, 160)}`);
    }
}));
fs.copyFileSync(path.join(DATA, "cast-types.json"), path.join(OUT, "cast-types.json"));
const folders = fs.readdirSync(OUT).filter((f) => /^m\d{3}\w+\.json$/.test(f)).map((f) => f.slice(0, -5)).sort();
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ v: 1, source: "tools/dw2_motion/retarget/build.mjs", note: "which bodies have a DW2 motion file", folders }));
fs.writeFileSync(path.join(WORK, "build-report.json"), JSON.stringify({ at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), done, failed }, null, 1));
console.log(`done: ${done.length} species, ${failed.length} failed, ${Math.round((Date.now() - t0) / 1000)} s`);
process.exitCode = failed.length && !done.length ? 1 : 0;
