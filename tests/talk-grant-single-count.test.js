// A talk grant lands EXACTLY ONCE, at the dialogue close — the walker's talk-close arm is
// its single home.
//
// The disc's site (decode, not a guess): the field talk handler (`fieldstg` F0x80090afc)
// stores the selected ptrB triple's ptr2 into entity+0xFC at talk start — the store sits in
// the branch delay slot at file 0xdee8-0xdeec, so it runs on every path — and its CLOSE arm
// (file 0xdfa4-0xe010, the tick the dialogue handle reads closed) runs that table through
// the applier F0x80016988 (exe/fns.s .L0x80016988: walks `{u16 id, u16 value}` pairs until
// 0xFFFF, calling setGameState(id, value) for each) -> set_flag F0x800165ac -> for the eight
// collection banks 0x80..0x8E, F0x800161d8 ("+1 copy of id", capped at 99). ONE apply, one
// copy. web/game.js's talk onClose is the port of that arm and applies the SAME table
// (web/assets/scenes/*.json dialogue_states[].on_close) — grant AND consume, every bank.
//
// What went wrong and what this pins: the converter ALSO emitted a once OnTalk GiveItem row
// per item-give (`sNNN.give.npc.item`), fired at talk START by the engine, so every granted
// item landed twice (engine row + scene write; measured on Nohemon's forge and the
// King-of-Cards trophy). The rows are gone from the converted content; these tests are the
// census that keeps a second home from coming back, plus the engine half of the mechanism.
//
// fail-before (master): 198 `*.give.*` rows, 198 GiveItem instructions, and a talk to
// s300's box put one PowerCharge in the bag from the engine alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GameEngine } from "../engine/index.ts";
import { createEngineBridge } from "../web/engine-bridge.js";

const content = JSON.parse(readFileSync("web/assets/engine-content.json", "utf8"));
const grants = JSON.parse(readFileSync("web/assets/data/talk_item_grants.json", "utf8")).grants;

const sceneOf = (stage) => JSON.parse(readFileSync(`web/assets/scenes/${stage}.json`, "utf8"));
const countOf = (engine, id) => {
  for (const [k, v] of engine.state.inventory.toJSON()) if (k === id) return v;
  return 0;
};

test("the converted content emits no OnTalk give row and no GiveItem for a talk grant", () => {
  const giveRows = [];
  const giveInsts = [];
  for (const st of content.stages) {
    for (const e of st.events) if (String(e.id).includes(".give.")) giveRows.push(e.id);
    for (const s of st.scripts)
      for (const i of s.program) if (i.op === "GiveItem") giveInsts.push(s.id);
  }
  assert.deepEqual(giveRows, [], "no converted OnTalk give row");
  assert.deepEqual(giveInsts, [], "no GiveItem instruction in the converted content");
});

test("every talk grant's on_close entry is in the walker's scene data — the single home exists", () => {
  const missing = [];
  for (const g of grants) {
    const scene = sceneOf(g.stage);
    let found = false;
    for (const npc of scene.npcs ?? []) {
      if (npc.npc_id !== g.npc_id) continue;
      for (const ds of npc.dialogue_states ?? [])
        for (const c of ds.on_close ?? [])
          if (c.id === g.flag_id && c.expected === 1) found = true;
    }
    if (!found) missing.push(`${g.stage} npc ${g.npc_id} item ${g.item_id}`);
  }
  assert.deepEqual(missing, [], "grants whose on_close the close arm cannot reach");
  // The shipped census (201 grants over 88 stages at the time of writing) — a big drop
  // means the extractor or the scenes moved, not that the grants vanished.
  assert.ok(grants.length >= 190, `the shipped talk grants (${grants.length})`);
});

test("no converted row re-grants a scene write's item — no row can fire twice", () => {
  // The census over the give-row class: for every (stage, npc) that hands an item over in
  // a dialogue-state on_close, no converted OnTalk row's script grants that item id. The
  // item has exactly one home — the scene write the walker's close arm applies.
  const byStage = new Map(content.stages.map((st) => [st.mapId, st]));
  const hits = [];
  for (const g of grants) {
    const st = byStage.get(g.stage);
    if (!st) continue;
    for (const e of st.events) {
      if (e.on !== "OnTalk" || (e.match?.npc ?? null) !== g.npc_id) continue;
      const script = st.scripts.find((s) => s.id === e.do);
      if (script?.program.some((i) => i.op === "GiveItem" && Number(i.args[0]?.v) === g.item_id))
        hits.push(`${e.id} would re-grant item ${g.item_id}`);
    }
  }
  assert.deepEqual(hits, [], "no converted row re-grants a scene write's item");
});

test("the engine grants nothing on a talk — the walker's close arm is the only home", () => {
  // s300's item box (npc 33): its on_close is [532=1, 33323=1, 0x7013] — item 43
  // PowerCharge, the box's own spawn bit, and the flourish. fail-before: the engine row
  // s300.give.33.43 fired GiveItem(43) at talk start, so the close arm's copy made two.
  const engine = new GameEngine(content, { driven: true });
  const bridge = createEngineBridge({
    engine,
    playCutscene: (_fk, onDone) => onDone(null),
    startBattle: (_s, onWin) => onWin(),
    doHandoff: () => {},
  });
  bridge.onStageEnter("s300");
  bridge.onTalk(33);
  assert.equal(countOf(engine, 43), 0, "no engine-side grant at talk start");
  // What the close arm does — applyStoryFlag's collection branch (web/game.js), one copy.
  engine.state.inventory.add(43, 1);
  assert.equal(countOf(engine, 43), 1, "the close arm's copy lands once");
  assert.equal(engine.state.flags.get(0x822b, 1), true, "possession predicate reads the copy");
});

test("the walker's close arm applies the on_close table and owns the 0x7013 flourish", () => {
  // Source-level seam, in the style of the walker's other census tests: the close arm
  // routes every on_close entry through applyStoryFlag (the set_flag dispatcher port), and
  // applyStoryFlag carries the op-0x50 arm (F0x80015d4c -> setSub1(3), unconditional) so a
  // talk grant's flourish fires on the close tick, where the disc fires it.
  const game = readFileSync("web/game.js", "utf8");
  assert.match(
    game,
    /for \(const c of dlgState\.on_close \|\| \[\]\)\s*\n\s*applyStoryFlag\(c\.id, c\.expected\);/,
    "the talk onClose applies the selected state's on_close table",
  );
  const fn = game.indexOf("function applyStoryFlag(");
  assert.ok(fn > 0, "web/game.js still has applyStoryFlag");
  const body = game.slice(fn, game.indexOf("\n}\n", fn));
  assert.ok(body.includes("id === 0x7013"), "applyStoryFlag handles the op-0x50 flourish");
  assert.ok(
    body.includes("state.sparkleActor = { program: 3"),
    "…by arming sparkle program 3",
  );
});
