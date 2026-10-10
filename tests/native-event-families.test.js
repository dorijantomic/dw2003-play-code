// The native-event census: 69 of the 384 extracted wstag events carry no bytecode of their
// own (script_offset == 0, empty disasm). Each one must belong to a known behaviour family
// with a NAMED translated handler, or be explicitly recorded as blocked with its reason.
// This is the measurable form of "production runs our logic, not a silent drop": a new
// native event, or one that changes family, fails here instead of vanishing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  NATIVE_EVENT_FAMILIES,
  nativeEventFamily,
  nativeEventInfo,
  nativeEventMembers,
  nativeEventDispositions,
} from "../engine/systems/native-event-families.ts";

const events = JSON.parse(readFileSync("web/assets/events/wstag_events.json", "utf8"));

/** Every extracted event that has no bytecode of its own. */
function nativeEvents() {
  const out = [];
  for (const [stage, arr] of Object.entries(events)) {
    for (const e of arr) {
      const noScript = !e.script_offset || e.script_offset === 0;
      const noDisasm = !e.disasm || e.disasm.length === 0;
      if (noScript && noDisasm) out.push({ stage, id: e.id });
    }
  }
  return out;
}

test("the census counts 69 native events out of 384", () => {
  const all = Object.values(events).reduce((n, a) => n + a.length, 0);
  assert.equal(all, 384, "extracted event total");
  assert.equal(nativeEvents().length, 69, "native event total");
});

test("every native event resolves to a family, and every family member is a real native event", () => {
  const actual = new Map(nativeEvents().map(e => [`${e.stage}.${e.id}`, e]));
  const declared = nativeEventMembers();
  // no event is claimed twice
  const seen = new Set();
  for (const m of declared) {
    const key = `${m.stage}.${m.id}`;
    assert.ok(!seen.has(key), `duplicate family member ${key}`);
    seen.add(key);
  }
  // the declared set EQUALS the extracted set
  assert.deepEqual([...seen].sort(), [...actual.keys()].sort());
  // and every extracted event classifies
  for (const [key, e] of actual) {
    assert.equal(nativeEventFamily(e.stage, e.id), declared.find(m => `${m.stage}.${m.id}` === key).family);
  }
});

test("the family split is 69 translated / 0 blocked", () => {
  assert.deepEqual(nativeEventDispositions(), { translated: 69, blocked: 0 });
  const blocked = NATIVE_EVENT_FAMILIES.filter(f => f.disposition === "blocked");
  assert.deepEqual(blocked, [], "no native family is blocked on undecoded data");
});

test("every translated family names a handler module that exists", () => {
  for (const f of NATIVE_EVENT_FAMILIES) {
    if (f.disposition !== "translated") continue;
    assert.ok(f.handler, `${f.family} must name a handler`);
    assert.ok(existsSync(f.handler), `${f.handler} must exist`);
    const first = f.members[0];
    assert.equal(nativeEventInfo(first.stage, first.id)?.family, f.family);
  }
});

test("the ordinary field route dispatches the darkSwitch events to our handler", () => {
  // The walker's native-event dispatcher (web/game.js playStoryEvent) must reach our module.
  // If this import or the dispatch call is dropped, the six events fall through to the
  // cutscene path (a no-op) — the silent drop this family used to be.
  const game = readFileSync("web/game.js", "utf8");
  assert.match(game, /import \{[^}]*dungeonSwitchCommand[^}]*\} from "\.\/vendor\/engine\.js"/,
    "game.js must import the switch resolver from the engine bundle");
  assert.match(game, /function playDungeonSwitchEvent/, "the darkSwitch dispatcher must exist");
  assert.match(game, /if \(!ev\.disasm\?\.length && playDungeonSwitchEvent\(ev, onDone\)\) return;/,
    "playStoryEvent must try the darkSwitch dispatcher on a native event");
});

test("the ordinary field route dispatches the gunslinger events to our handler", () => {
  // Same rule as darkSwitch: without the import and the dispatch call the two s810
  // events fall through to the cutscene path (a no-op) — the silent drop they were.
  const game = readFileSync("web/game.js", "utf8");
  assert.match(game, /import \{[^}]*gunslingerSwitchCommand[^}]*\} from "\.\/gunslinger-switch\.js"/,
    "game.js must import the gunslinger switch resolver");
  assert.match(game, /function playGunslingerEvent/, "the gunslinger dispatcher must exist");
  assert.match(game, /if \(!ev\.disasm\?\.length && playGunslingerEvent\(ev, onDone\)\) return;/,
    "playStoryEvent must try the gunslinger dispatcher on a native event");
});

test("the six darkSwitch events are started on the ordinary route (OnStep rows in the built content)", () => {
  // The converter emits an OnStep row per op-8 story step; these six events ARE such
  // targets, so the field's position step VM starts them and playStoryEvent dispatches
  // them to our handler. If a row goes missing the event is unreachable — a silent drop.
  const content = JSON.parse(readFileSync("web/assets/engine-content.json", "utf8"));
  const byMap = new Map(content.stages.map(s => [s.mapId, s]));
  for (const m of nativeEventInfo("s745", 8000).members) {
    const st = byMap.get(m.stage);
    const row = st.events.find(e => e.on === "OnStep" && (e.do || "").includes(`.${m.id}.`));
    assert.ok(row, `${m.stage}.${m.id} must have an OnStep row`);
    const script = st.scripts.find(s => s.id === row.do);
    assert.deepEqual(script?.program.map(p => p.op), ["StartEvent"], `${m.stage}.${m.id} runs through the event VM`);
  }
});

test("the six families carry the expected member counts", () => {
  const byFamily = Object.fromEntries(NATIVE_EVENT_FAMILIES.map(f => [f.family, f.members.length]));
  assert.deepEqual(byFamily, {
    helpMenu: 5, yesNo: 8, fireTrap: 32, darkSwitch: 6, ambush: 16, gunslinger: 2,
  });
});
