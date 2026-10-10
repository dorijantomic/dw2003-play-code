import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GameEngine, createScreenRouter } from "../engine/index.ts";
import { createTriggerSystem } from "../engine/systems/trigger-system.ts";

const content = JSON.parse(readFileSync(
  new URL("../web/assets/engine-content.json", import.meta.url), "utf8"));
const dialogue = JSON.parse(readFileSync(
  new URL("../web/assets/events/esdmg200.json", import.meta.url), "utf8"));
const wstag = JSON.parse(readFileSync(
  new URL("../web/assets/events/wstag_events.json", import.meta.url), "utf8"));
const screenTable = JSON.parse(readFileSync(
  new URL("../data/screen_table.json", import.meta.url), "utf8"));

// The pre-download reminder in the Asuka City lobby is NOT an exit guard. On the disc it is the
// lobby's own POSITION STEP: s210's step program names events 20 and 30 in two op-8 records, each
// gated on ordinal 2 (cond_a 0x6002) and nothing else, on two different tiles (grid bytes 6 and 7)
// — the tile in front of the west door and the tile in front of the lab door. Walk up to the door
// you meant to use and the partner walks back and says the line; you are not stopped.
//
// It used to be two `OnExit` rows in tools/engine-convert/decode-table.json bound to s200 / s220,
// which blocked both doors while the roster was empty. That trigger does not exist on the disc
// (ledger SCENE-ENGINE-2026-10-03 claim 16) and the rows are gone (2026-10-05); what ships is the
// step, so the event's own `HANDOFF` — it has none — leaves you exactly where you stood.
const STEPS210 = JSON.parse(readFileSync(
  new URL("../web/assets/data/story_steps.json", import.meta.url), "utf8")).stages["210"];
const GRID210 = JSON.parse(readFileSync(
  new URL("../web/assets/data/story_trigger_grids.json", import.meta.url), "utf8")).stages["210"];

/** A trigger system over the shipped program + grid, with the ordinal read the engine's way. */
function stepRig(ordinal) {
  const fired = [];
  const ts = createTriggerSystem({
    getProgram: () => STEPS210,
    getGrid: () => GRID210,
    getEnableTable: () => JSON.parse(readFileSync(
      new URL("../web/assets/data/scene/step_enable_table.json", import.meta.url), "utf8")),
    getEventById: (_m, id) => wstag.s210.find((e) => e.id === id) ?? null,
    getEventByKey: () => null,
    flags: { get: (id) => ((id & 0xff00) === 0x6000 ? (ordinal === (id & 0x1ff) ? 1 : 0) : 0), set() {} },
    done: () => false,
    markDone: () => {},
    playEvent: (ev, onDone) => { fired.push(ev.id); onDone(); },
  });
  return { ts, fired };
}
/** The pixel centre of the first tile a trigger byte selects. */
function tileOf(byte) {
  const cell = GRID210.grid.indexOf(byte);
  assert.notEqual(cell, -1, `s210's grid carries byte ${byte}`);
  return {
    byte,
    x: (cell % GRID210.w) * GRID210.cell + Math.floor(GRID210.cell / 2),
    y: Math.floor(cell / GRID210.w) * GRID210.cell + Math.floor(GRID210.cell / 2),
  };
}

test("the two pre-download reminders are the lobby's own position steps, not exit guards", () => {
  const stage = content.stages.find((entry) => entry.mapId === "s210");
  assert.deepEqual(stage.events.filter((e) => e.on === "OnExit").map((e) => e.id), [],
    "s210 has no exit row: the disc has no exit trigger in the lobby");
  for (const [index, event] of [[6, 20], [7, 30]]) {
    const step = STEPS210.steps[index];
    assert.equal(step.op, 8, `step ${index} is an op-8 start_event record`);
    assert.equal(step.params[0], event, `and it names event ${event}`);
    assert.equal(step.cond_a, 0x6002, "gated on the ordinal being 2 (the pre-download beat)");
    assert.equal(step.cond_b, 0xffff, "with no second condition");
    assert.equal(GRID210.grid.indexOf(index) >= 0, true, `the grid byte ${index} selects it`);
    // And the row the converter emits from that record is the one that plays it.
    const row = stage.events.find((e) => e.id === `s210.step.evt${event}`);
    assert.ok(row, `s210.step.evt${event} exists; rows: ${stage.events.map((e) => e.id).join(", ")}`);
    assert.equal(row.on, "OnStep");
  }
  // Both scenes walk the partner back and say the line; neither carries a HANDOFF, so nothing
  // moves you and nothing blocks the door you were walking to.
  for (const event of [20, 30]) {
    const ev = wstag.s210.find((e) => e.id === event);
    assert.equal(ev.handoff_to ?? null, null, `event ${event} hands off nowhere`);
    assert.ok(ev.disasm.some((l) => /^WALKTO 2 /.test(l)), `event ${event} walks the partner back`);
    assert.ok(ev.disasm.some((l) => l.startsWith("SAY")), `event ${event} says the line`);
  }
});

test("the reminder fires on its own tile at story step 2, and nowhere else", () => {
  // Before the download (ordinal 2) the two tiles are live and each says its own line.
  for (const [byte, event] of [[6, 20], [7, 30]]) {
    const { ts, fired } = stepRig(2);
    const t = tileOf(byte);
    assert.equal(ts.tick("s210", t.x, t.y, 2), true, `byte ${byte} fires at ordinal 2`);
    assert.deepEqual(fired, [event], `and it is event ${event}`);
  }
  // One step later the lobby beat is over and both tiles are dark — nothing nags you after the
  // download, exactly as the record's own condition says.
  for (const byte of [6, 7]) {
    const { ts, fired } = stepRig(3);
    const t = tileOf(byte);
    assert.equal(ts.tick("s210", t.x, t.y, 2), false, `byte ${byte} is dark at ordinal 3`);
    assert.deepEqual(fired, []);
  }
  // And no matter what the roster is: the condition is the ordinal, not the party. A downloaded
  // roster at ordinal 2 still gets the line, because on the disc that is what the tile does.
  const { ts, fired } = stepRig(2);
  const t = tileOf(6);
  const engine = new GameEngine(content, { driven: true });
  engine.state.party.add(1);
  assert.equal(ts.tick("s210", t.x, t.y, 2), true);
  assert.deepEqual(fired, [20]);
});

test("pre-download guards use the extracted partner-data reminder", () => {
  for (const entry of [dialogue["8"], dialogue["9"]])
    assert.match(entry.strings[0], /I need\s+my partner\s+Digimon data!/);
});

// The pack download is the only way out of the Tamer Service: s212 carries no exit,
// warp or door to s200, and all three pack downloads end on the scene's own
// `HANDOFF 512 1000 236 1` (wstag212.s:888-891 / :1249-1252 / :1610-1613). Screen
// 512 is WSTAG200_PRO = stage 200, so the hand-off is s200 at (1000,236) facing 1,
// and the shared on_complete advances the master story ordinal to 3
// (wstag212.s:3133 -> F0x800a6438, `*(s32 *)0x8004B370 = 3`).
const DOWNLOADS = [["01120003", 10], ["01120004", 11], ["01120005", 12]];
const HANDOFF_SCREEN = 512;

test("the three s212 downloads end on the hand-off to s200 that the disc's scripts carry", () => {
  const router = createScreenRouter(screenTable, { useAlt: () => false });
  // spawn null: the screen table names the stage, and the op's own three operands
  // carry the spawn point (web/game.js:4731), exactly as the decoded chain reads it.
  assert.deepEqual(router.route(HANDOFF_SCREEN), { kind: "warp", to: "s200", spawn: null });
  for (const [flagKey, id] of DOWNLOADS) {
    const ev = wstag.s212.find((entry) => entry.flag_key === flagKey);
    assert.ok(ev, `s212 event ${flagKey}`);
    assert.equal(ev.id, id);
    assert.deepEqual(ev.disasm.slice(-2), [`HANDOFF ${HANDOFF_SCREEN} 1000 236 1`, "END"]);
    assert.equal(ev.handoff_to, router.route(HANDOFF_SCREEN).to);
    assert.deepEqual([ev.handoff_x, ev.handoff_y, ev.handoff_dir], [1000, 236, 1]);
  }
});

test("choosing pack B at the arrival beat fires event 01120004, and its end moves the story to step 3", () => {
  for (const [pack, flagKey, evId] of [[0, "01120003", 10], [1, "01120004", 11], [2, "01120005", 12]]) {
    const engine = new GameEngine(content, { driven: true });
    engine.state.vars.set("$story.ordinal", 2);
    engine.state.vars.set("$party.pack", pack);
    engine.loadStage("s212");
    const handle = engine.raise("OnEnterMap");
    assert.ok(handle, `pack ${pack} fires a download`);
    engine.vm.tick(handle);
    assert.deepEqual(engine.lastYield, { kind: "event", evId });
    assert.equal(engine.eventFlagKey("s212", evId), flagKey);
    // The on_complete the stage's own table points at (F0x800a6438).
    engine.completeEvent(evId);
    assert.equal(engine.state.vars.get("$story.ordinal"), 3);
  }
  // No pack chosen: the gate reads bank-0x70 0x7000/1/2 through $party.pack, so with
  // no selector the stage's arrival fires nothing at all (the game is never in this
  // state — registration always picks a pack — and the walker must not invent a scene).
  const none = new GameEngine(content, { driven: true });
  none.state.vars.set("$story.ordinal", 2);
  none.state.vars.set("$party.pack", null);
  none.loadStage("s212");
  assert.equal(none.raise("OnEnterMap"), null);
});
