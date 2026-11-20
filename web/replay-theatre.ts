// web/replay-theatre.js — the story scenes of the room you are standing in, played back with
// no writes.
//
// The disc ships 384 story events over 139 stages (web/assets/events/wstag_events.json): 315
// carry bytecode the game's cutscene VM runs, 69 are native records whose behaviour lives in a
// hand-written handler instead. This page lists the bytecode events of stages whose beat the
// player has REACHED — the master story ordinal the ladder in web/assets/data/progress_ordinal.json
// orders (the ladder's value order is the literal play order, and a stage enters the list once
// its first beat is behind the player) — and Play hands one record to the game's own
// `playStoryEvent` with a completion that does nothing:
//
//   * no `engine.completeEvent`: the event's own flag writes and its step store never run;
//   * no `doStoryHandoff`: a HANDOFF op ends the scene instead of warping anywhere;
//   * no battle, no item, no party change.
//
// Two families are refused outright, because their mutation lives INSIDE `playStoryEvent` and a
// no-op completion cannot stop it:
//   * the 69 native events (script_offset === 0, empty disasm) — their handlers fire traps,
//     ambush the party and grant packs;
//   * the four bytecode flag keys in REPLAY_DENY — the opening pack select (014a0001, whose
//     after-SAY hook opens the starter wizard) and the three s212 partner downloads
//     (01120003/4/5, whose completion hands the pending party to the player).
// Native events are refused by shape rather than by a list, so a new extraction cannot slip one in.
//
// Only the room you are standing in may be played: `playStoryEvent` stages a scene with the
// CURRENT map's cast (state.scenes[currentMap().id]), and loading another stage to stage it
// there would run that stage's arrival chain and could write. Scenes of other reached rooms are
// listed greyed with their place name — "walk there to replay it".
//
// OFF unless F2 -> Extras -> "Replay theatre (new)" is switched on (web/ambience.js). It opens on
// that switch's rising edge, owns the pad while it is up (Up/Down row, Cross play, Start close)
// and draws over everything. With the switch off there is no list, no press is read and no VM
// call is made. The module is DOM-free at the top level so node tests can import it; drawing
// takes a canvas context and the two view sizes.

/** The four bytecode events whose effect escapes the scene itself (see the header). */
export const REPLAY_DENY = new Set(["014a0001", "01120003", "01120004", "01120005"]);

const LIST_ROWS = 8;        // the room's own rows shown at once; the cursor scrolls them
const ELSEWHERE_ROWS = 6;   // greyed lines under the list, one per other reached room

/**
 * The ladder the page gates on, prepared once from the two data files the game already loads:
 * `progress` is web/assets/data/progress_ordinal.json (or its `ladder` array) and `manifest` is
 * web/assets/manifest.json (or its `maps` array). Returns `{ byStage, names }`:
 *   byStage  { "s200": [4], ... } — each stage's beats, ascending
 *   names    { "s200": "Central Sector — Asuka City", ... } — the manifest's own stage names
 * A plain manifest-less ladder is still accepted by replayRows; rows then fall back to the id.
 */
export function replayLadder(progress, manifest) {
  const byStage = {};
  const beats = Array.isArray(progress) ? progress : (progress?.ladder ?? []);
  for (const row of beats) {
    const stageNum = Number(row?.stage);
    if (!Number.isFinite(stageNum)) continue;
    const ordinals = (row?.ordinals ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (ordinals.length) byStage[`s${stageNum}`] = ordinals;
  }
  const names = {};
  const maps = Array.isArray(manifest) ? manifest : (manifest?.maps ?? []);
  for (const map of maps) {
    if (map?.id) names[map.id] = map.name ?? map.id;
  }
  return { byStage, names };
}

/** A prepared ladder, a raw progress_ordinal.json or its ladder array, all read the same way. */
function ladderParts(ladder) {
  if (ladder && typeof ladder.byStage === "object" && ladder.byStage) {
    return { byStage: ladder.byStage, names: ladder.names ?? {} };
  }
  const prepared = replayLadder(ladder, null);
  return { byStage: prepared.byStage, names: prepared.names };
}

/** A native record: no bytecode of its own (the handler lives outside the VM). */
const isNative = (ev) => !Array.isArray(ev?.disasm) || ev.disasm.length === 0 || Number(ev?.script_offset) === 0;

/**
 * May this record ever be replayed? A native record and the four mutating flag keys never can —
 * their effect lives inside playStoryEvent, where a no-op completion cannot stop it — and an absent
 * record is refused too. This is the one rule both the list and the play path consult.
 */
export function replayRefused(ev) {
  if (!ev) return true;
  if (isNative(ev)) return true;
  return REPLAY_DENY.has(String(ev.flag_key));
}

/** The record's first SAY line, the one line that tells two scenes of a room apart. */
const firstSayOf = (ev) => (ev?.disasm ?? []).find((line) => typeof line === "string" && /^SAY(?:\s|$)/.test(line)) ?? null;

/**
 * The page's rows for one moment: `mapId` is the room the player stands in, `wstag` the extracted
 * event table, `ladder` the prepared ladder above and `ordinal` the live master story ordinal.
 *
 * A row is `{ mapId, stage, eventId, firstSay, playable, elsewhere }`:
 *   stage     the manifest's name for the row's own room
 *   playable  true only for the room the player stands in
 *   elsewhere true for a reached room they must walk to (its Play returns false)
 * Rows come in ladder order (the disc's own play order), then by event id.
 */
export function replayRows(mapId, wstag, ladder, ordinal) {
  const { byStage, names } = ladderParts(ladder);
  const reached = Number(ordinal) || 0;
  const rows = [];
  for (const [stageId, events] of Object.entries(wstag ?? {})) {
    const beats = byStage[stageId];
    if (!beats || !beats.length) continue;
    if (!beats.some((beat) => beat <= reached)) continue;   // the stage's first beat is still ahead
    for (const ev of events ?? []) {
      if (replayRefused(ev)) continue;
      rows.push({
        mapId: stageId,
        stage: names[stageId] ?? stageId,
        eventId: Number(ev.id),
        firstSay: firstSayOf(ev),
        playable: stageId === mapId,
        elsewhere: stageId !== mapId,
      });
    }
  }
  const beatOf = (stageId) => byStage[stageId]?.[0] ?? Number.MAX_SAFE_INTEGER;
  rows.sort((a, b) => (beatOf(a.mapId) - beatOf(b.mapId)) || a.mapId.localeCompare(b.mapId) || a.eventId - b.eventId);
  return rows;
}

/** May a row of `stageId` be played while standing in `mapId`? Only the same room. */
export function replayOnMap(stageId, mapId) {
  return !!stageId && !!mapId && stageId === mapId;
}

/** The greyed line under another room's scene: its place name, and how to get there. */
export function elsewhereNotice(row) {
  return `${row?.stage ?? "another room"} — walk there to replay it.`;
}

// ── the panel ──────────────────────────────────────────────────────────────────────────────
const S = {
  open: false,
  wasOn: false,    // the F2 flag last frame: the page opens on its rising edge only
  place: "",
  here: [],        // the room's own rows (Up/Down/Cross work on these)
  elsewhere: [],   // reached scenes in other rooms (greyed, never selectable)
  cursor: 0,
  chosen: null,    // the row Cross asked for; game.js takes it once
};

/** Is the page up? (web/game.js freezes the field and routes the pad to it while true.) */
export function replayOpen() {
  return S.open;
}

/** What the page is showing (the test and the console aid read this). */
export function replayView() {
  return { open: S.open, place: S.place, here: S.here, elsewhere: S.elsewhere, cursor: S.cursor };
}

/** Put the page back to its shipped state (a fresh session; tests use this). */
export function replayReset() {
  S.open = false;
  S.wasOn = false;
  S.place = "";
  S.here = [];
  S.elsewhere = [];
  S.cursor = 0;
  S.chosen = null;
}

/** Open on a prepared view: `{ place, here, elsewhere }` (rows from replayRows). */
export function openReplay(view = {}) {
  S.place = view?.place ?? "";
  S.here = Array.isArray(view?.here) ? view.here : [];
  S.elsewhere = Array.isArray(view?.elsewhere) ? view.elsewhere : [];
  S.cursor = 0;
  S.chosen = null;
  S.open = true;
  return S.open;
}

export function closeReplay() {
  S.open = false;
  S.chosen = null;
}

/**
 * Follow the F2 -> Extras -> "Replay theatre (new)" switch. The switch only ENABLES the page: it never
 * opens it (not on page load, not on ticking the switch). The F2 button "Open the replay theatre" opens
 * it (openReplay, with the field free, so a story cutscene or a fight is never replaced by a replay).
 * Switching the switch off closes it; Start or Cross close it too. `rowsNow` and `free` are kept so the
 * call shape is unchanged; nothing is built here.
 */
export function tickReplay(enabled, rowsNow, free = true) {
  const on = enabled === true;
  if (!on && S.open) closeReplay();
  S.wasOn = on;
  return S.open;
}

/**
 * The pad while the page is up: Up/Down walk the room's own rows, Cross plays the highlighted one
 * (and closes the page), Start closes it, every other press is swallowed. A room with no scene of
 * its own chooses nothing on Cross. Returns false when the page is closed, so nothing changes then.
 */
export function replayPress(k) {
  if (!S.open) return false;
  const n = S.here.length;
  if (k === "up") S.cursor = n ? (S.cursor + n - 1) % n : 0;
  else if (k === "down") S.cursor = n ? (S.cursor + 1) % n : 0;
  else if (k === "cross") {
    S.chosen = n ? S.here[((S.cursor % n) + n) % n] : null;
    S.open = false;
  } else if (k === "start") {
    S.open = false;
  }
  return true;
}

/** The row Cross asked to play, once (null when nothing was chosen). */
export function replayTake() {
  const row = S.chosen;
  S.chosen = null;
  return row;
}

/**
 * Draw the page over the whole view. `W`/`H` are the canvas box (640x480 in the game); the panel
 * is inset from them, so it also reads correctly in a smaller test canvas.
 */
export function replayDraw(ctx, W = 640, H = 480) {
  if (!S.open) return false;

  const x = Math.round(W * 0.04), y = Math.round(H * 0.04);
  const w = W - 2 * x, h = H - 2 * y;
  const left = x + 16;
  const lh = 16;

  ctx.save();
  ctx.fillStyle = "rgba(4,6,12,0.95)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#4f8fc0";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // header: what this is, and the room the player is standing in
  ctx.font = "bold 18px monospace";
  ctx.fillStyle = "#9fd0ff";
  ctx.fillText("REPLAY THEATRE", left, y + 10);
  ctx.font = "14px monospace";
  ctx.fillStyle = "#7a90b0";
  ctx.fillText(S.place || "(no room)", left, y + 32);

  // the room's own rows, with the cursor visible
  ctx.font = "13px monospace";
  let ty = y + 58;
  if (!S.here.length) {
    ctx.fillStyle = "#8a93a8";
    ctx.fillText("No scene you have reached has played in this room.", left, ty);
    ty += lh;
  } else {
    const first = Math.max(0, Math.min(S.cursor - LIST_ROWS + 1, S.here.length - LIST_ROWS));
    const shown = S.here.slice(first, first + LIST_ROWS);
    for (let i = 0; i < shown.length; i++) {
      const row = shown[i];
      const selected = first + i === S.cursor;
      ctx.fillStyle = selected ? "#ffd34d" : "#d8e2f0";
      const mark = selected ? ">" : " ";
      ctx.fillText(`${mark} #${row.eventId}  ${row.firstSay ?? "(no line)"}`, left, ty);
      ty += lh;
    }
  }

  // the greyed rooms you must walk to
  if (S.elsewhere.length) {
    ty += 6;
    ctx.font = "bold 12px monospace";
    ctx.fillStyle = "#7a90b0";
    ctx.fillText("Scenes elsewhere (walk there to replay them):", left, ty);
    ty += lh;
    ctx.font = "12px monospace";
    ctx.fillStyle = "#6f7a8c";
    for (const row of S.elsewhere.slice(0, ELSEWHERE_ROWS)) {
      ctx.fillText(`- ${elsewhereNotice(row)}`, left, ty);
      ty += lh;
    }
    if (S.elsewhere.length > ELSEWHERE_ROWS) {
      ctx.fillText(`- and ${S.elsewhere.length - ELSEWHERE_ROWS} more`, left, ty);
    }
  }

  // controls
  ctx.font = "12px monospace";
  ctx.fillStyle = "#7a90b0";
  ctx.fillText("Up / Down: pick    Cross: play    Start: close    F2 -> Extras switches it off", left, y + h - 18);
  ctx.restore();
  return true;
}
