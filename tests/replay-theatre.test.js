// Replay Theatre — the scenes of the room you are standing in, played back with no writes
// (web/replay-theatre.js + its hooks in web/game.js).
//
// The disc's own story scenes are extracted per stage in web/assets/events/wstag_events.json:
// 384 events over 139 stages, 315 with bytecode (`disasm`) and 69 native records that run a
// hand-written handler instead. The theatre lists only bytecode events of STAGES WHOSE BEAT THE
// PLAYER HAS REACHED (the master story ordinal, web/assets/data/progress_ordinal.json, whose
// ladder is the literal play order), and Play hands the record to the game's own cutscene VM
// (`playStoryEvent`) with a completion that does nothing: no flag, no ordinal, no handoff, no
// battle. Only the room you are standing on may be played — loading another stage would run its
// arrival chain, and native events / four mutating bytecode events are refused outright.
//
// Everything is OFF unless F2 -> Extras -> "Replay theatre (new)" is on (web/ambience.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REPLAY_DENY,
  replayRefused,
  replayLadder,
  replayRows,
  replayOnMap,
  elsewhereNotice,
  tickReplay, openReplay,
  replayOpen,
  replayPress,
  replayTake,
  replayView,
  replayDraw,
  replayReset,
} from "../web/replay-theatre.js";

const wstag = JSON.parse(readFileSync("web/assets/events/wstag_events.json", "utf8"));
const progress = JSON.parse(readFileSync("web/assets/data/progress_ordinal.json", "utf8"));
const manifest = JSON.parse(readFileSync("web/assets/manifest.json", "utf8"));
const ladder = replayLadder(progress, manifest);

const ALL = Object.values(wstag).flat();
const NATIVE = new Set(
  Object.entries(wstag).flatMap(([stage, list]) =>
    list.filter((e) => !e.disasm || e.disasm.length === 0).map((e) => `${stage}.${e.id}`)),
);
const eventOf = (row) => (wstag[row.mapId] ?? []).find((e) => Number(e.id) === Number(row.eventId));

/** A recording 2D context: enough of the canvas API for replayDraw, and a text log. */
function fakeCtx() {
  const calls = [];
  const ctx = {
    calls,
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect() { calls.push(["fillRect"]); },
    strokeRect() { calls.push(["strokeRect"]); },
    fillText(text) { calls.push(["fillText", String(text)]); },
    set font(v) {}, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
    set textBaseline(v) {}, set textAlign(v) {},
  };
  return ctx;
}
const drawnText = (ctx) => ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1]).join("\n");

/** The body of a named top-level function in a source file (its own closing brace at column 0). */
function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} exists`);
  const end = src.indexOf("\n}", start);
  assert.ok(end > start, `${signature} is closed`);
  return src.slice(start, end + 2);
}

// ── the data the page is built on ────────────────────────────────────────────────────────────
test("the extracted table is 384 events over 139 stages: 315 bytecode, 69 native", () => {
  assert.equal(Object.keys(wstag).length, 139);
  assert.equal(ALL.length, 384);
  assert.equal(ALL.filter((e) => Array.isArray(e.disasm) && e.disasm.length > 0).length, 315);
  assert.equal(ALL.filter((e) => e.script_offset === 0).length, 69);
  assert.equal(NATIVE.size, 69);
});

test("no native event is ever a row, and neither is anything outside a reached beat", () => {
  // the widest list the theatre can ever show: the last beat of the story
  const ordinal = Math.max(...progress.ladder.flatMap((b) => b.ordinals));
  const rows = replayRows("s200", wstag, ladder, ordinal);
  assert.ok(rows.length > 0, "the end-game list is not empty");
  for (const row of rows) {
    assert.ok(!NATIVE.has(`${row.mapId}.${row.eventId}`), `${row.mapId}.${row.eventId} carries no bytecode`);
    assert.ok((eventOf(row)?.disasm ?? []).length > 0, "every row carries bytecode");
  }
  // a stage enters the list only once its own beat (its first ladder ordinal) is reached
  assert.ok(replayRows("s200", wstag, ladder, 0).length === 0, "ordinal 0 reaches no beat");
});

// ── the room you are in: s200, and the beat it belongs to ────────────────────────────────────
test("on s200 at ordinal 4 the player-facing list is exactly the two bytecode events 50 and 52", () => {
  const here = replayRows("s200", wstag, ladder, 4).filter((r) => r.playable);
  assert.deepEqual(here.map((r) => r.eventId), [50, 52]);
  assert.deepEqual((wstag.s200 ?? []).map((e) => e.id), [50, 52]);
  // s200's ladder ordinal is 4, so at 3 the stage has not been reached at all
  const before = replayRows("s200", wstag, ladder, 3);
  assert.equal(before.filter((r) => r.playable).length, 0);
  assert.ok(!before.some((r) => r.mapId === "s200"), "s200 is not listed one beat early");
});

test("the two s200 rows carry the disc's own first SAY line", () => {
  const [a, b] = replayRows("s200", wstag, ladder, 4).filter((r) => r.playable);
  assert.equal(a.firstSay, "SAY 0 1 57 3");
  assert.equal(b.firstSay, "SAY 0 1 1 0");
  // the row's SAY really is the first SAY of its own disassembly
  assert.equal(a.firstSay, eventOf(a).disasm.find((l) => l.startsWith("SAY")));
});

// ── the refused family: the pack select and the three partner downloads ──────────────────────
test("REPLAY_DENY is exactly the four mutating flag keys", () => {
  assert.equal(REPLAY_DENY.size, 4);
  assert.deepEqual([...REPLAY_DENY].sort(), ["01120003", "01120004", "01120005", "014a0001"]);
});

test("no denied event ever appears: s785's pack select and s212's three downloads are withheld", () => {
  const ordinal = Math.max(...progress.ladder.flatMap((b) => b.ordinals));
  const rows = replayRows("s200", wstag, ladder, ordinal);
  const flagged = rows.map((r) => eventOf(r)?.flag_key).filter((k) => REPLAY_DENY.has(k));
  assert.deepEqual(flagged, [], "no row carries a denied flag key");
  // the four records really are in the data, and they really are the four the page withholds
  const denied = [];
  for (const [stage, list] of Object.entries(wstag)) {
    for (const e of list) if (REPLAY_DENY.has(e.flag_key)) denied.push(`${stage}.${e.id}`);
  }
  assert.deepEqual(denied.sort(), ["s212.10", "s212.11", "s212.12", "s785.1"]);
  for (const key of denied) {
    const [stage, id] = key.split(".");
    assert.ok(!rows.some((r) => r.mapId === stage && r.eventId === Number(id)), `${key} is withheld`);
  }
});

// ── the refusal is a rule of the module, not only of the list ────────────────────────────────
test("replayRefused refuses a native record and each of the four keys, and accepts s200's 50", () => {
  const nativeEv = ALL.find((e) => !(e.disasm ?? []).length);
  assert.ok(nativeEv, "the table holds native records");
  assert.equal(replayRefused(nativeEv), true);
  for (const key of REPLAY_DENY) {
    const ev = ALL.find((e) => e.flag_key === key);
    assert.ok(ev, `${key} is a real event`);
    assert.equal(replayRefused(ev), true);
  }
  assert.equal(replayRefused((wstag.s200 ?? []).find((e) => e.id === 50)), false);
  assert.equal(replayRefused(null), true, "an absent record is never playable");
  // the game's play path consults the rule before the VM
  const body = fnBody(readFileSync("web/game.js", "utf8"), "function replayScene(ev)");
  const refuse = body.indexOf("replayRefused(ev)");
  const play = body.indexOf("playStoryEvent(ev, () => {})");
  assert.ok(refuse >= 0 && refuse < play, "the refusal comes before the VM call");
});

// ── names, elsewhere and Play ───────────────────────────────────────────────────────────────
test("every row carries its stage's manifest name, and another room's row is elsewhere", () => {
  const ordinal = Math.max(...progress.ladder.flatMap((b) => b.ordinals));
  const rows = replayRows("s200", wstag, ladder, ordinal);
  for (const row of rows) {
    const name = manifest.maps.find((m) => m.id === row.mapId)?.name;
    assert.equal(row.stage, name, `${row.mapId} carries its manifest name`);
  }
  const elsewhere = rows.find((r) => r.elsewhere);
  assert.ok(elsewhere, "the end-game list has reached rooms other than s200");
  assert.equal(elsewhere.playable, false);
  assert.notEqual(elsewhere.mapId, "s200");
  // Play from another stage returns false and keeps the place name for the player
  assert.equal(replayOnMap(elsewhere.mapId, "s200"), false);
  assert.equal(replayOnMap("s200", "s200"), true);
  assert.ok(elsewhereNotice(elsewhere).includes(elsewhere.stage), "the notice names the place");
  assert.match(elsewhereNotice(elsewhere), /walk there to replay it/i);
  // and the same room's rows are playable, not elsewhere
  for (const row of rows.filter((r) => r.mapId === "s200")) {
    assert.deepEqual({ playable: row.playable, elsewhere: row.elsewhere }, { playable: true, elsewhere: false });
  }
});

// ── the play path has no writes and no routing ──────────────────────────────────────────────
test("replayScene plays through the VM with a no-op completion and nothing else", () => {
  const game = readFileSync("web/game.js", "utf8");
  const body = fnBody(game, "function replayScene(ev)");
  assert.match(body, /playStoryEvent\(ev, \(\) => \{\}\)/, "the completion argument is a no-op");
  for (const banned of ["engine.completeEvent", "doStoryHandoff", "setFlag", "startTransition", "battle.start"]) {
    assert.ok(!body.includes(banned), `the play path never calls ${banned}`);
  }
  // the elsewhere guard runs BEFORE the VM call, so another stage is never loaded or played
  const guard = body.indexOf("replayOnMap(ev");
  const play = body.indexOf("playStoryEvent(ev, () => {})");
  assert.ok(guard >= 0 && guard < play, "the room check comes first");
  assert.match(body, /return false/);
});

test("the player-facing list is filtered to currentMap().id and gated on $story.ordinal", () => {
  const game = readFileSync("web/game.js", "utf8");
  const rows = fnBody(game, "function replayRowsNow()");
  assert.match(rows, /currentMap\(\)\.id/, "the list is the room you are standing in");
  assert.match(rows, /replayRows\(/);
  assert.match(rows, /\$story\.ordinal/, "the beat comes from the engine's own ordinal");
  assert.match(game, /if \(replayPress\(k\)\)/, "the pad is gated on the page");
  assert.match(game, /if \(replayOpen\(\)\) return;/, "the field is frozen under the page");
  assert.match(game, /replayDraw\(ctx/, "the page draws over everything");
});

test("the F2 switch is the Extras pair and EXPERIMENTAL, so it starts OFF", () => {
  const ambience = readFileSync("web/ambience.js", "utf8");
  assert.ok(ambience.includes('["replay", "Replay theatre (new)"]'), "the Extras pair is present");
  const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
  assert.ok(experimental, "EXPERIMENTAL is still one array literal");
  assert.ok(/"replay"/.test(experimental[1]), "replay is experimental (off until switched on)");
  const game = readFileSync("web/game.js", "utf8");
  assert.match(game, /tickReplay\(window\.__fx\?\.replay === true/);
});

// ── the ladder is not the story ordinal ─────────────────────────────────────────────────────
test("the fetched ladder is kept in its own field, never the $story.ordinal proxy", () => {
  // state.progressOrdinal is an accessor over the engine's $story.ordinal (Object.defineProperty
  // later in game.js). Storing the fetched progress_ordinal.json there would write NaN into the
  // story ordinal on every boot — with the theatre switched off, which is not allowed.
  const game = readFileSync("web/game.js", "utf8");
  assert.ok(!/state\.progressOrdinal\s*=\s*po\b/.test(game), "the table is not assigned into the ordinal proxy");
  assert.match(game, /state\.progressTable\s*=\s*po\b/, "the table is kept under its own name");
  const rows = fnBody(game, "function replayRowsNow()");
  assert.ok(!rows.includes("state.progressOrdinal"), "the rows do not read the assembled ladder off the ordinal proxy");
  assert.match(rows, /state\.progressTable/);
});

// ── the panel itself ────────────────────────────────────────────────────────────────────────
const view = {
  place: "Central Sector — Asuka City",
  here: replayRows("s200", wstag, ladder, 4).filter((r) => r.playable),
  elsewhere: replayRows("s200", wstag, ladder, 4).filter((r) => r.elsewhere),
};

test("with the switch off tickReplay opens nothing, and a closed page swallows no press", () => {
  replayReset();
  const ctx = fakeCtx();
  assert.equal(tickReplay(false, () => view), false);
  assert.equal(replayOpen(), false);
  assert.equal(replayPress("cross"), false, "a closed page does not eat the pad");
  assert.equal(replayDraw(ctx, 640, 480), false, "a closed page draws nothing");
  assert.equal(ctx.calls.length, 0);
});

test("the switch never opens the page, the button does, and Start closes it", () => {
  replayReset();
  assert.equal(tickReplay(false, () => view), false);
  assert.equal(tickReplay(true, () => view), false, "the switch on opens nothing");
  assert.equal(replayOpen(), false);
  assert.equal(openReplay(view), true, "the F2 button opens the page");
  assert.equal(replayView().place, view.place);
  assert.equal(replayView().here.length, 2);
  // a second frame with the switch still on does not reopen a page the player closed
  assert.equal(replayPress("start"), true, "the page owns the press");
  assert.equal(replayOpen(), false);
  assert.equal(tickReplay(true, () => view), false, "still on, not reopened");
  // switching it off and on again does not open it either; the switch off closes an open page
  assert.equal(tickReplay(false, () => view), false);
  assert.equal(tickReplay(true, () => view), false);
  openReplay(view);
  assert.equal(tickReplay(false, () => view), false, "the switch off closes it");
  assert.equal(replayOpen(), false);
  openReplay(view);
  assert.equal(replayPress("cross"), true, "Escape arrives as cross and closes it");
  assert.equal(replayOpen(), false);
});

test("Up/Down walk the room's rows and Cross hands the chosen row to the game", () => {
  replayReset();
  openReplay(view);
  assert.equal(replayView().cursor, 0);
  replayPress("down");
  assert.equal(replayView().cursor, 1);
  replayPress("down");
  assert.equal(replayView().cursor, 0, "the cursor wraps inside the room's own rows");
  replayPress("up");
  assert.equal(replayView().cursor, 1);
  assert.equal(replayTake(), null, "nothing chosen until Cross");
  assert.equal(replayPress("cross"), true);
  const row = replayTake();
  assert.equal(row.eventId, 52);
  assert.equal(replayOpen(), false, "Cross plays and closes the page");
  assert.equal(replayTake(), null, "the choice is handed over once");
});

test("Cross on a room with no scene of its own chooses nothing, and the elsewhere list is greyed", () => {
  replayReset();
  openReplay({ place: "Asuka City — Underground Path", here: [], elsewhere: view.elsewhere });
  assert.equal(replayPress("cross"), true);
  assert.equal(replayTake(), null, "nothing to play here");
  assert.equal(replayOpen(), false);
  // the page still draws the greyed rows and the walk-there line
  replayReset();
  openReplay({ place: "Asuka City — Underground Path", here: [], elsewhere: view.elsewhere });
  const ctx = fakeCtx();
  assert.equal(replayDraw(ctx, 640, 480), true);
  const text = drawnText(ctx);
  assert.match(text, /REPLAY THEATRE/);
  assert.match(text, /Asuka City — Underground Path/);
  assert.match(text, /walk there to replay it/i);
  assert.match(text, /Asuka City — Main Lobby|Kusanagi City — Online Center/, "another reached room is named");
});

test("the open page draws the room's rows with their SAY lines", () => {
  replayReset();
  openReplay(view);
  const ctx = fakeCtx();
  assert.equal(replayDraw(ctx, 640, 480), true);
  const text = drawnText(ctx);
  assert.match(text, /Central Sector — Asuka City/);
  assert.match(text, /SAY 0 1 57 3/);
  assert.match(text, /SAY 0 1 1 0/);
  assert.match(text, /Cross: play/);
});
