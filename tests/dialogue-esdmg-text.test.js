import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// native-screen-text.js loads its glyph tables with a relative fetch; serve it from disk.
const realFetch = globalThis.fetch;
globalThis.fetch = async (p) => {
  const f = resolve("web", String(p));
  if (!existsSync(f)) return { ok: false, json: async () => ({}) };
  return { ok: true, json: async () => JSON.parse(readFileSync(f, "utf8")) };
};
const { decodeNativeText } = await import("../web/native-screen-text.js");
await new Promise((r) => setTimeout(r, 50));
globalThis.fetch = realFetch;

const TOKEN_LEN = [1, 2, 3, 2, 5, 3, 3, 2, 3, 2, 0];
const PN = "\u0001PN\u0001";

// Mirrors loadEsdmgEntry in web/dialogue-translated.js, then the [count][offsets] pack.
function rawLines(file, entry) {
  const data = readFileSync(resolve(`web/assets/data/dialogue-box/${file}.bin`));
  const entries = data.readUInt32LE(0) / 4;
  if (!(entry >= 0 && entry < entries)) return null;
  const start = data.readUInt32LE(entry * 4);
  const end = entry + 1 < entries ? data.readUInt32LE((entry + 1) * 4) : data.length;
  return data.subarray(start, end);
}
function rawLine(pack, i) {
  const count = pack.readUInt32LE(0);
  if (!(i >= 0 && i < count)) return null;
  const s = pack.readUInt32LE(4 + i * 4);
  const e = i + 1 < count ? pack.readUInt32LE(4 + (i + 1) * 4) : pack.length;
  return pack.subarray(s, e);
}
// Compared with the player-name control and all whitespace dropped (the old strings carry a speaker label and spacing the raw token stream expresses differently).
// Whole line: split on pause/clear tokens, decode each run, name control -> placeholder.
function decodeWhole(bytes) {
  const segs = [];
  let cur = [];
  const flush = () => { if (cur.length) segs.push(decodeNativeText(Uint8Array.from(cur)).text); cur = []; };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0) break;
    if (b === 0x01) { cur.push(b, bytes[++i]); continue; }
    if (b === 0x02) {
      const n = bytes[i + 1];
      const len = Math.max(1, TOKEN_LEN[n] ?? 2);
      if (n === 2 || n === 3) flush();
      else if (n === 8) { flush(); segs.push(PN); }
      else for (let k = 0; k < len; k++) cur.push(bytes[i + k]);
      i += len - 1;
      continue;
    }
    cur.push(b);
  }
  flush();
  return segs.join(" ");
}
const norm = (s) => s
  .replace(/\[player_name\]/g, PN)
  .replace(/\[name\]/g, " ").replace(/\[pause\]/g, " ").replace(/\[clear\]/g, " ")
  .replace(/\[[^\]]*\]/g, " ")
  .split(PN).join("").replace(/\\/g, "").replace(/\s+/g, "");

// Minimal parser for `strings = [ "...", ... ]` (basic strings, \n \" \\ \t escapes only).
function tomlStrings(file) {
  const t = readFileSync(file, "utf8");
  let i = t.indexOf("[", t.indexOf("strings"));
  const out = [];
  for (i++; i < t.length; i++) {
    const c = t[i];
    if (c === "]") break;
    if (c !== '"') continue;
    let s = "";
    for (i++; t[i] !== '"'; i++) {
      if (t[i] === "\\") {
        const e = t[++i];
        s += e === "n" ? "\n" : e === "t" ? "\t" : e;
      } else s += t[i];
    }
    out.push(s);
  }
  return out;
}
const TOML_DIR = resolve(process.env.DDW3_DIR || resolve(process.env.HOME, "ddw3"),
  "lang_file/dw2003/eng");
// The SAY-text comparison reads the ddw3 TOML dumps; without them there is
// nothing to compare against, so the test skips instead of failing.
const SKIP_TOML = { skip: !existsSync(TOML_DIR) && "ddw3 lang_file TOMLs not present on this machine (set DDW3_DIR or clone ddw3 to ~/ddw3)" };

test("translated SAY text equals the original text dump (TOML) for every SAY line", SKIP_TOML, () => {
  const wstag = JSON.parse(readFileSync("web/assets/events/wstag_events.json", "utf8"));
  const stats = { events: 0, say: 0, matched: 0, mismatched: 0, missingToml: 0, missingRaw: 0, oldBoxWrong: 0 };
  const bad = [];
  const cache = new Map();
  const oldData = (st) => {
    if (!cache.has(st)) { const f = `web/assets/events/esdmg${st}.json`; cache.set(st, existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null); }
    return cache.get(st);
  };
  const tcache = new Map();
  const tomlOf = (st, en) => {
    const f = `${TOML_DIR}/esdmg${st}/${en}.toml`;
    if (!tcache.has(f)) tcache.set(f, existsSync(f) ? tomlStrings(f) : null);
    return tcache.get(f);
  };
  for (const list of Object.values(wstag)) for (const ev of list) {
    if (ev.esdmg_entry == null || ev.esdmg_stage == null) continue;
    const says = (ev.disasm || []).filter((l) => l.startsWith("SAY "));
    if (!says.length) continue;
    stats.events++;
    const old = oldData(ev.esdmg_stage)?.[String(ev.esdmg_entry)]?.strings ?? null;
    const toml = tomlOf(ev.esdmg_stage, ev.esdmg_entry);
    const pack = existsSync(`web/assets/data/dialogue-box/esdmg${ev.esdmg_stage}.bin`) ? rawLines(`esdmg${ev.esdmg_stage}`, Number(ev.esdmg_entry)) : null;
    for (const l of says) {
      const p1 = Number(l.split(/\s+/)[2]);
      stats.say++;
      const rec = { stage: ev.esdmg_stage, entry: ev.esdmg_entry, p1 };
      const t = toml?.[p1];
      const raw = pack ? rawLine(pack, p1) : null;
      if (t == null || raw == null) {
        if (t == null) stats.missingToml++;
        if (raw == null) stats.missingRaw++;
        bad.push({ ...rec, toml: t ?? "<missing>", raw: raw == null ? "<missing>" : decodeWhole(raw) });
        continue;
      }
      if (old?.[p1 - 1] == null || norm(old[p1 - 1]) !== norm(t)) stats.oldBoxWrong++;
      const a = norm(t), b = norm(decodeWhole(raw));
      if (a === b) stats.matched++;
      else { stats.mismatched++; bad.push({ ...rec, toml: a, raw: b }); }
    }
  }
  console.log("COUNTS", JSON.stringify(stats));
  console.log(`INFO: the OLD box (esdmgNNN.json) showed ${stats.oldBoxWrong} of ${stats.say} SAY lines wrongly (not asserted)`);
  for (const m of bad) console.log(`MISMATCH stage=${m.stage} entry=${m.entry} p1=${m.p1}\n  toml: ${JSON.stringify(m.toml)}\n  raw:  ${JSON.stringify(m.raw)}`);
  assert.equal(bad.length, 0, `${bad.length} of ${stats.say} SAY lines differ from the TOML dump`);
});
