// tests/stage-census.test.js — the Explorer's census: one stage in numbers, and the
// people the saved flags hide.
//
// The census is a pure read over a scene's NPC records: how many records the stage
// ships, how many spawn slots they fill, how many share a slot with another version,
// how many are invisible or cutscene-only, how many carry a spawn gate, and how many
// the saved flags build. "Builds" is not a rule of its own — it is the engine's own
// chapterNpcs([record], chapter, getCond) path, so a command bank always passes and a
// value the save cannot answer stays permissive. The hidden list says WHY a record is
// hidden: the plain words of the first gate entry that definitively fails.
//
// The page is driven without a browser (HARD RULE: no browser here) against a minimal
// DOM + localStorage + fetch shim, exactly like tests/story-explorer-page.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { stageCensus, hiddenRows, gateWords } from "../web/gate-text.js";
import { chapterNpcs } from "../engine/dw3/npc-manager.ts";
import { isStoryCommandBank } from "../engine/systems/story-command-banks.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const WEB = join(ROOT, "web");
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

const S305 = readJson("web/assets/scenes/s305.json");
const S200 = readJson("web/assets/scenes/s200.json");

// ── a real stage, in numbers ────────────────────────────────────────────────────────────────
test("s305 with a save that cannot answer anything is the stage in numbers", () => {
  const census = stageCensus(S305.npcs, 1, () => null);
  assert.deepEqual(
    {
      records: census.records,
      gated: census.gated,
      invisible: census.invisible,
      cutsceneOnly: census.cutsceneOnly,
      passing: census.passing,
      hidden: census.hidden,
    },
    { records: 59, gated: 59, invisible: 14, cutsceneOnly: 17, passing: 59, hidden: 0 },
  );
});

test("the census counts the slots and the records that share one", () => {
  const census = stageCensus(S305.npcs, 1, () => null);
  // s305 fills 27 slot numbers; 47 of its 59 records share their slot with another version.
  assert.equal(census.slots, 27);
  assert.equal(census.variants, 47);
  const s200 = stageCensus(S200.npcs, 1, () => null);
  assert.equal(s200.slots, 10);
  assert.equal(s200.variants, 51);
});

test("s200 ships 56 records", () => {
  assert.equal(stageCensus(S200.npcs, 1, () => null).records, 56);
});

test("the whole scene set is 3,529 records over 268 scenes and 330 npc ids", () => {
  const files = readdirSync(join(ROOT, "web/assets/scenes")).filter((f) => f.endsWith(".json"));
  const casts = readJson("web/assets/data/stage_cast_lists.json");
  let records = 0;
  let scenesWithRecords = 0;
  let castRows = 0;
  const ids = new Set();
  for (const file of files) {
    const scene = readJson(`web/assets/scenes/${file}`);
    const stage = file.replace(/\.json$/, "");
    const cast = casts[stage];
    if (!scene.npcs.length) continue;
    scenesWithRecords++;
    assert.ok(Array.isArray(cast), `${stage}: the stage cast list carries this scene`);
    // The scene JSON is the disc's cast: every record's gate list appears in the cast list.
    const gates = new Set(cast.map((row) => JSON.stringify((row.gate ?? []).map((g) => [g.id, g.expected]))));
    for (const npc of scene.npcs) {
      records++;
      ids.add(npc.npc_id);
      if (gates.has(JSON.stringify((npc.spawn_flags ?? []).map((g) => [g.id, g.expected])))) castRows++;
    }
  }
  assert.equal(Object.keys(casts).length, 281, "the disc's cast list carries 281 stages");
  assert.equal(records, 3529);
  assert.equal(scenesWithRecords, 268);
  assert.equal(ids.size, 330);
  assert.equal(castRows, records, "every scene record is one row of the disc's cast list");
});

// ── a small fixture: exactly which records the flags build ─────────────────────────────────
const fixture = [
  { id: "passes", npc_id: 7, slot: 1, x: 10, y: 20, spawn_flags: [{ id: 0x400d, expected: 0 }] },
  { id: "command", npc_id: 8, slot: 1, x: 11, y: 21, spawn_flags: [{ id: 0x7401, expected: 1 }] },
  {
    id: "fails", npc_id: 9, slot: 2, x: 12, y: 22,
    spawn_flags: [{ id: 0x400d, expected: 0 }, { id: 0x6004, expected: 1 }],
  },
];

test("a fixture scene passes exactly the records whose gate expects the value (or is a command bank)", () => {
  const census = stageCensus(fixture, 1, () => 0);
  assert.equal(census.records, 3);
  assert.equal(census.gated, 3);
  assert.equal(census.passing, 2);
  assert.equal(census.hidden, 1);
  // The engine path agrees record by record: this is the rule the census reports.
  for (const record of fixture) {
    const built = chapterNpcs([record], 1, () => 0).length === 1;
    assert.equal(built, record.id !== "fails", `${record.id}: chapterNpcs decides the census`);
  }
});

test("hiddenRows names the record and the first gate that really fails", () => {
  const rows = hiddenRows(fixture, 1, () => 0);
  assert.deepEqual(rows, [
    { npc_id: 9, slot: 2, x: 12, y: 22, why: gateWords({ id: 0x6004, expected: 1 }) },
  ]);
  // The first gate of the failing record passes; only the second one fails, and that is
  // the one the row quotes.
  assert.equal(rows[0].why, "beat 4");
});

test("a record with no spawn gate always passes; a gate the save cannot answer passes too", () => {
  const always = [
    { id: "always", npc_id: 1, slot: 1, x: 0, y: 0 },
    { id: "undecoded", npc_id: 2, slot: 2, x: 1, y: 1, spawn_flags: [{ id: 0x1234, expected: 1 }] },
    { id: "unknown-value", npc_id: 3, slot: 3, x: 2, y: 2, spawn_flags: [{ id: 0x1a18, expected: 1 }] },
  ];
  const census = stageCensus(always, 9, () => null);
  assert.equal(census.gated, 2, "two records carry a gate, the third is unconditional");
  assert.equal(census.passing, 3, "an unmodelled value is permissive, like the engine");
  assert.deepEqual(hiddenRows(always, 9, () => null), []);
  // The words never dress a bank nobody has decoded up as a meaning.
  assert.equal(gateWords({ id: 0x1234, expected: 1 }), "gate 0x1234");
});

// ── the page: the census header and the list of the people it hides ────────────────────────
// HARD RULE: no browser. The page's own render path runs against a minimal DOM +
// localStorage + fetch shim; the real HTML is parsed for its element ids (so a typo in
// either file fails), the real data files are served off disk, and a save is planted the
// way the game writes it (bank 0x1a bit 24 = flag 6680 set, saved story beat 4).
class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.text = "";
    this.className = "";
    this.id = "";
    this.title = "";
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.isConnected = true;
    this.value = "";
    this.classList = { add: (name) => { this.className = `${this.className} ${name}`.trim(); } };
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(""); }
  append(...nodes) {
    for (const node of nodes) if (node && typeof node === "object") this.children.push(node);
  }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.text = ""; this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] ?? []) fn(); }
}

class OptionNode extends Node {
  constructor(text, value) { super("option"); this.text = text; this.value = value; }
}

const html = readFileSync(join(WEB, "story-explorer.html"), "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const elements = new Map(ids.map((id) => { const node = new Node("div"); node.id = id; return [id, node]; }));

globalThis.document = {
  createElement: (tag) => new Node(tag),
  getElementById: (id) => elements.get(id),
};
globalThis.Option = OptionNode;

// The save the game writes: engineFlags is { bank: base64(64-byte bitmap) }, flags holds
// the text markers. 6680 = 0x1a18 -> bank 0x1a = 26, bit 24 -> byte 3 bit 0.
const saveBank = new Uint8Array(64);
saveBank[3] = 0x01;
const saveStore = new Map([
  ["engineFlags", JSON.stringify({ 26: btoa(String.fromCharCode(...saveBank)) })],
  ["flags", JSON.stringify({ evt_intro: true })],
  ["progressOrdinal", "4"],
  ["playerName", "Dori"],
]);
globalThis.window = {
  localStorage: {
    getItem: (key) => (saveStore.has(key) ? saveStore.get(key) : null),
    setItem: (key, value) => saveStore.set(key, String(value)),
    removeItem: (key) => saveStore.delete(key),
  },
};

globalThis.fetch = async (url) => {
  try {
    const body = readFileSync(join(WEB, String(url)), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => null };
  }
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(check, what) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await tick();
  }
  assert.fail(`timed out waiting for ${what}`);
}

const $ = (id) => elements.get(id);

await import("../web/story-explorer.js");

test("the page renders the stage census above the people list", async () => {
  await waitFor(() => $("ready").textContent.includes("NPC records"), "the first stage to load");
  assert.ok($("census"), "the page carries a census block");
  const text = $("census").textContent;
  assert.match(text, /56 NPC records/, "the stage's record count");
  assert.match(text, /10 spawn slots/, "how many slot numbers the records fill");
  assert.match(text, /51 share a slot/, "how many records share a slot with another version");
  assert.match(text, /0 invisible/, "the invisible records");
  assert.match(text, /1 cutscene only/, "the cutscene-only records");
  assert.match(text, /56 with a spawn gate/, "how many records are gated");
  assert.match(text, /6 spawn for this save/, "how many the save's flags build");
  assert.match(text, /50 hidden by the gate/, "how many the save hides");
});

test("the page lists every record the save hides, with the failing gate's words", async () => {
  await waitFor(() => $("hidden").children.length > 0, "the hidden list");
  assert.equal($("hidden").children.length, 50, "one row per hidden record");
  const mikaRows = $("hidden").children.filter((li) => li.textContent.includes("npc 46"));
  assert.ok(mikaRows.length > 1, "every hidden version of npc 46 has its own row");
  const row = mikaRows.find((li) => li.textContent.includes("hidden: beat 8"));
  assert.ok(row, "the beat-8 version is hidden for a beat-4 save");
  assert.ok(row.textContent.includes("slot 5"), "the row names the spawn slot");
  assert.ok(row.textContent.includes("at 564,558"), "and the spot it would spawn at");
});

test("clicking a hidden person opens their versions", async () => {
  const row = $("hidden").children.find((li) => li.textContent.includes("npc 46"));
  row.fire("click");
  await waitFor(() => $("versionsTitle").textContent.includes("npc 46"), "Mika's versions to render");
  assert.ok($("versions").textContent.includes("does not spawn"), "the hidden version is marked there");
});

test("choosing another stage re-renders both the census and the hidden list", async () => {
  $("stage").value = "s305";
  $("stage").fire("change");
  await waitFor(() => $("census").textContent.includes("59 NPC records"), "s305's census");
  assert.match($("census").textContent, /27 spawn slots/);
  assert.match($("census").textContent, /14 invisible/);
  assert.match($("census").textContent, /17 cutscene only/);
  assert.match($("census").textContent, /0 spawn for this save/);
  assert.match($("census").textContent, /59 hidden by the gate/);
  assert.equal($("hidden").children.length, 59);
  // The first row is the record whose first gate (0x600d = beat 13) fails; the row quotes
  // that gate, not the second one.
  const first = $("hidden").children[0];
  assert.ok(first.textContent.includes("npc 1 · slot 4 · at 0,0"));
  assert.ok(first.textContent.includes("hidden: beat 13"),
    `the failing gate's words: ${first.textContent}`);
});

test("clearing the manual beat turns those gates unknown, and the census follows", async () => {
  $("beat").value = "";
  $("beat").fire("input");
  await waitFor(() => $("census").textContent.includes("2 hidden by the gate"), "the permissive census");
  assert.match($("census").textContent, /57 spawn for this save/);
  assert.equal($("hidden").children.length, 2);
  assert.ok(!$("hidden").textContent.includes("beat "), "an unknown beat never fails a gate");
});

test("the census is a header, one import of the shared words, and no write path", () => {
  // Structure: census above the people list, hidden list under it (same left column).
  const at = (id) => html.indexOf(`id="${id}"`);
  assert.ok(at("census") > 0 && at("census") < at("people"), "census sits above the people list");
  assert.ok(at("hidden") > at("people"), "the hidden list sits under the people list");
  // The words and the counting are the shared module's, never a second renderer.
  const src = readFileSync(join(WEB, "story-explorer.js"), "utf8");
  const imports = [...src.matchAll(/import\s+\{([^}]+)\}\s+from\s+"\.\/gate-text\.js"/g)];
  assert.equal(imports.length, 1, "one import from web/gate-text.js");
  const names = imports[0][1].split(",").map((s) => s.trim());
  for (const name of ["gateWords", "stageCensus", "hiddenRows"]) assert.ok(names.includes(name), name);
  assert.ok(!/function\s+gateWords\b/.test(src), "gateWords is not reimplemented");
  assert.ok(!/function\s+gateListWords\b/.test(src), "the gate renderer is not reimplemented");
  // Read-only: the page never writes a flag, never posts, and the game never imports it.
  assert.ok(!src.includes(".setItem("), "the explorer writes nothing");
  assert.ok(!/method:\s*"(POST|PUT|DELETE)"/.test(src), "the explorer only reads");
  const game = readFileSync(join(WEB, "game.js"), "utf8");
  assert.ok(!game.includes("stageCensus") && !game.includes("hiddenRows"),
    "no game file uses the census");
});

test("stageCensus and hiddenRows agree with chapterNpcs on every s200 and s305 record", () => {
  const scenarios = [
    () => 0,
    () => 1,
    () => null,
    (id) => (id === 0x6004 ? 1 : 0),
    (id) => (id === 0x1a18 ? 1 : 0),
    (id) => (id === 0x7003 ? 1 : 0),
  ];
  for (const [name, scene] of [["s200", S200], ["s305", S305]]) {
    for (let s = 0; s < scenarios.length; s++) {
      const getCond = scenarios[s];
      const built = scene.npcs.filter((record) => chapterNpcs([record], 4, getCond).length === 1);
      const census = stageCensus(scene.npcs, 4, getCond);
      assert.equal(census.passing, built.length, `${name} scenario ${s}: passing`);
      assert.equal(census.hidden, scene.npcs.length - built.length, `${name} scenario ${s}: hidden`);
      const hidden = scene.npcs.filter((record) => chapterNpcs([record], 4, getCond).length !== 1);
      const rows = hiddenRows(scene.npcs, 4, getCond);
      assert.deepEqual(
        rows.map((r) => `${r.npc_id}@${r.slot}:${r.x},${r.y}`),
        hidden.map((r) => `${r.npc_id}@${r.slot}:${r.x},${r.y}`),
        `${name} scenario ${s}: one row per hidden record, in record order`,
      );
      for (let i = 0; i < hidden.length; i++) {
        const record = hidden[i];
        const firstFailing = (record.spawn_flags ?? []).find((c) =>
          !isStoryCommandBank((c.id >>> 8) & 0xfe) &&
          getCond(c.id) !== null && getCond(c.id) !== c.expected);
        assert.equal(rows[i].why, gateWords(firstFailing), `${name} ${record.id}: why is the failing gate's words`);
      }
    }
  }
});
