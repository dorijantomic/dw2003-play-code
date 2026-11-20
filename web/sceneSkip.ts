// web/sceneSkip.js
// In-game STORY SCENE SKIPPER — a dev overlay that jumps the game to any beat on the
// master story-progress ordinal spine (field-script-engine §WS4.6), from the Genji battle
// (s200) all the way to the Galantmon finale (s810/s820). Toggle with the `=` / `+` key.
//
// Jumping a beat: set $story.ordinal to the beat value (so the stage's entry handler and
// flag-gated NPC population match), CLEAR that beat's on_complete flags (so its cutscenes
// re-fire instead of being skipped as already-seen), warp to the stage, then run the
// stage-enter pump (auto cutscenes). Press `t` to auto-talk the beat's say-actors so
// talk-gated scenes (e.g. Genji) play without hunting for the NPC.
//
// All game mutation goes through injected deps so this stays DOM/global-free and the
// autonomous walkthrough test can drive the very same jump() (see tools/test_walkthrough.mjs).

export function createSceneSkip(deps) {
  // deps: { setOrdinal(n), getOrdinal(), clearFlag(id), warpToStage(stageId), fireStageEnter(stageId), talk(npcId) }
  const d = { enabled: false, sel: 0, top: 0, spine: [], ordAdj: 0, msg: null, ready: false };

  fetch("assets/data/debug_spine.json")
    .then((r) => r.json())
    .then((j) => { d.spine = j.spine || []; d.ready = true; })
    .catch(() => { d.msg = "spine load failed"; });

  const ROWS = 16; // visible list rows

  function clampScroll() {
    if (d.sel < d.top) d.top = d.sel;
    if (d.sel >= d.top + ROWS) d.top = d.sel - ROWS + 1;
    d.top = Math.max(0, Math.min(d.top, Math.max(0, d.spine.length - ROWS)));
  }

  // Jump to spine[i]. `ordOverride` lets the caller force a specific ordinal (else beat value
  // + the live ordAdj nudge). Returns a small report (used by the autonomous test).
  function jump(i, ordOverride) {
    const b = d.spine[i];
    if (!b) return { ok: false, why: "no beat" };
    const ord = ordOverride != null ? ordOverride : b.ordinal + d.ordAdj;
    for (const f of b.clearFlags) deps.clearFlag(f);   // let this beat's scenes re-fire
    deps.setOrdinal(ord);
    deps.warpToStage(b.stage);
    deps.fireStageEnter(b.stage);
    d.msg = `→ ${b.ordHex} ${b.stage} (ord=${ord})`;
    return { ok: true, beat: b, ordinal: ord };
  }

  // Auto-talk every say-actor of the currently selected beat (surfaces talk-gated scenes).
  function talkActors(i) {
    const b = d.spine[i];
    if (!b) return [];
    const fired = [];
    for (const a of b.sayActors) if (deps.talk(a)) fired.push(a);
    d.msg = fired.length ? `talked ${fired.join(",")}` : "no talk event fired";
    return fired;
  }

  d.toggle = () => { d.enabled = !d.enabled; d.sel = 0; d.top = 0; d.ordAdj = 0; d.msg = null; };
  d.jump = jump;
  d.talkActors = talkActors;
  d.list = () => d.spine;

  d.handleKey = (k) => {
    if (!d.enabled) return false;
    if (!d.ready) return true;
    if (k === "arrowup")   { d.sel = (d.sel - 1 + d.spine.length) % d.spine.length; clampScroll(); return true; }
    if (k === "arrowdown") { d.sel = (d.sel + 1) % d.spine.length; clampScroll(); return true; }
    if (k === "pageup")    { d.sel = Math.max(0, d.sel - ROWS); clampScroll(); return true; }
    if (k === "pagedown")  { d.sel = Math.min(d.spine.length - 1, d.sel + ROWS); clampScroll(); return true; }
    if (k === "[")         { d.ordAdj -= 1; d.msg = `ord nudge ${d.ordAdj}`; return true; }
    if (k === "]")         { d.ordAdj += 1; d.msg = `ord nudge ${d.ordAdj}`; return true; }
    if (k === "t")         { talkActors(d.sel); return true; }
    if (k === " " || k === "enter") { jump(d.sel); d.enabled = false; return true; }
    return true;
  };

  d.drawOverlay = (ctx, W, H) => {
    if (!d.enabled) return;
    const x = 24, y = 24, w = 440, lh = 17, head = 3;
    const rows = Math.min(ROWS, d.spine.length);
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.86)";
    ctx.fillRect(x, y, w, (rows + head + 2) * lh + 12);
    ctx.strokeStyle = "#0fa"; ctx.strokeRect(x, y, w, (rows + head + 2) * lh + 12);
    ctx.font = "12px monospace"; ctx.textBaseline = "top";
    ctx.fillStyle = "#0fa";
    ctx.fillText("SCENE SKIP — story spine (= to close)", x + 8, y + 6);
    ctx.fillText("↑↓ select  PgUp/Dn page  ⏎ jump  t talk  [ ] ord", x + 8, y + 6 + lh);
    ctx.fillStyle = "#8cf";
    ctx.fillText(`ord nudge: ${d.ordAdj >= 0 ? "+" : ""}${d.ordAdj}`, x + 8, y + 6 + lh * 2);

    if (!d.ready) { ctx.fillStyle = "#f88"; ctx.fillText("loading spine…", x + 8, y + 6 + lh * 3); ctx.restore(); return; }
    for (let r = 0; r < rows; r++) {
      const i = d.top + r;
      const b = d.spine[i];
      if (!b) break;
      const yy = y + 8 + lh * (head + r);
      ctx.fillStyle = i === d.sel ? "#ffe000" : "#cde";
      const tag = b.eventCount ? `${b.eventCount}ev` : "—";
      const label = `${i === d.sel ? "▶" : " "} ${b.ordHex} ${b.stage} ${b.name}`;
      ctx.fillText(label.slice(0, 52), x + 8, yy);
      ctx.fillStyle = i === d.sel ? "#ffe000" : "#789";
      ctx.fillText(tag, x + w - 44, yy);
    }
    if (d.msg) { ctx.fillStyle = "#6f6"; ctx.fillText(d.msg.slice(0, 56), x + 8, y + 8 + lh * (head + rows)); }
    ctx.restore();
  };

  return d;
}
