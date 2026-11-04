// The NPC dialogue-state explorer page, driven without a browser.
//
// HARD RULES forbid a browser here, so the page's own render path is exercised against a
// minimal DOM + localStorage + fetch shim: the real HTML is parsed for its element ids (a
// typo in either file fails this), the real data files are served off disk, and a save is
// planted exactly the way the game writes it. The assertions are the card's done criteria:
// a person's versions, their spawn gates, every dialogue state with its line, the live
// mark from the saved flags, and "unknown" when a value is not in the save.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WEB = join(ROOT, "web");

// ── a DOM small enough to read, big enough to run the page ──────────────────────────────────
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

// The save the game writes: engineFlags is { bank: base64(64-byte bitmap) }, and flags holds
// the text markers. 6680 = 0x1a18 -> bank 0x1a = 26, bit 24 -> byte 3 bit 0.
const bank = new Uint8Array(64);
bank[3] = 0x01;
const store = new Map([
  ["engineFlags", JSON.stringify({ 26: btoa(String.fromCharCode(...bank)) })],
  ["flags", JSON.stringify({ evt_intro: true })],
  ["progressOrdinal", "4"],
  ["playerName", "Dori"],
]);
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
};

globalThis.fetch = async (url) => {
  const path = join(WEB, String(url));
  try {
    const body = readFileSync(path, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => null };
  }
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(check, what) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await tick();
  }
  assert.fail(`timed out waiting for ${what}`);
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

const $ = (id) => elements.get(id);

await import("../web/story-explorer.js");

test("the page boots on a stage and lists the people in it", async () => {
  await waitFor(() => $("ready").textContent.includes("NPC records"), "the first stage to load");
  assert.match($("ready").textContent, /s200 — Central Sector · Asuka City/);
  assert.match($("ready").textContent, /56 NPC records, 54 with dialogue states/);
  assert.ok($("people").children.length > 5, "the person list is filled");
  assert.ok($("people").textContent.includes("npc 46"), "Mika's person row is there");
});

test("a person shows every version the disc authors, with its spawn gate in words", async () => {
  const mika = $("people").children.find((li) => li.textContent.includes("npc 46"));
  mika.fire("click");
  await waitFor(() => $("versionsTitle").textContent.includes("npc 46"), "Mika's versions to render");
  assert.match($("versionsTitle").textContent, /11 records authored/);
  const target = $("versions").children.find((c) => c.textContent.includes("real_5_5_564_558#10"));
  assert.ok(target, "the card's record is listed as one of Mika's versions");
  assert.ok($("versions").textContent.includes("beat 8"), "its spawn gate reads as a story beat");
  // The saved beat is 4, so the base record's 0x6004 gate passes and #10's 0x6008 gate does not.
  const base = $("versions").children.find((c) => c.children[0]?.children[0]?.textContent === "real_5_5_564_558");
  assert.ok(base, "the base record is listed");
  assert.ok(base.textContent.includes("spawns for this save"), "beat 4 spawns the base record");
  assert.ok(target.textContent.includes("does not spawn"), "beat 4 does not spawn the beat-8 version");
  // 24584 = 0x6008, and the page was seeded with saved beat 4 from progressOrdinal, so the
  // saved beat answers the gate and nothing is marked unknown.
  let unknown = 0;
  walk($("versions"), (node) => { if (node.className.includes("unknown")) unknown++; });
  assert.equal(unknown, 0, "a saved beat answers the gate");
});

test("the selected version shows its states with gates, lines and the live mark", async () => {
  const target = $("versions").children.find((c) => c.textContent.includes("real_5_5_564_558#10"));
  target.fire("click");
  await waitFor(() => $("states").textContent.includes("Sniff"), "the second state's line");
  const live = $("states").children.filter((c) => c.dataset.live === "true");
  assert.equal(live.length, 1, "exactly one state is live");
  assert.ok(live[0].textContent.includes("state #1"), "0x1a18 set picks the second state");
  assert.ok(live[0].textContent.includes("live for this save"));
  assert.ok($("states").textContent.includes("state #0"));
  assert.ok($("states").textContent.includes("story flag 0x1a18 is clear"), "state 0's gate says what it wants");
  assert.ok($("states").textContent.includes("story flag 0x1a18 is set"), "state 1's gate too");
  // The lines come from the real estalk file, tags stripped, with the speaker on its own line.
  assert.ok($("states").textContent.includes("Mika\nSniff...\nSepikmon took my\ncandy!"));
});

test("a saved story marker and the manual beat are what the page says it read", () => {
  assert.match($("saveInfo").textContent, /engineFlags: 1 bank, 1 bit set\./);
  assert.match($("saveInfo").textContent, /localStorage\.flags: 1 text marker\./);
  assert.match($("saveInfo").textContent, /saved story beat \(progressOrdinal\): 4/);
  assert.equal($("beat").value, "4", "the saved beat seeds the manual box");
});

test("clearing the beat turns every beat gate into unknown instead of a guess", async () => {
  $("beat").value = "";
  $("beat").fire("input");
  await waitFor(() => {
    let found = false;
    walk($("versions"), (node) => { if (node.className.includes("unknown")) found = true; });
    return found;
  }, "a beat gate to be marked unknown");
  let unknown = 0;
  walk($("versions"), (node) => { if (node.className.includes("unknown")) unknown++; });
  assert.ok(unknown > 0, "the spawn gate is now reported as unknown");
  // And the words themselves are unchanged: it is still the beat-8 gate, just undecidable.
  assert.ok($("versions").textContent.includes("beat 8"));
});
