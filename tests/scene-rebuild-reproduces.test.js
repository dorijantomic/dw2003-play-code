// The shipped scene files must be exactly what the scene build stages produce.
//
// web/assets/scenes/*.json is generated data that is also committed, and two stages
// write into it in order (build_all.py: gen_scenes, then gen_trap_pads). Hand-editing
// either of those files, or changing a generator without
// regenerating, used to leave the tracked data and the build disagreeing with nothing
// to notice it: on 2026-10-04 a full rebuild changed 192 of 294 scenes and six tests
// broke, because gen_scenes.py had been changed (374b9e3a) and the scenes had not been
// regenerated, while later stages had written into the stale copies.
//
// This test runs the stages into a scratch folder seeded with the tracked files
// -- which is what an in-place rebuild does -- and requires byte equality back. gen_scenes
// merges with what it finds (non-`real_*` NPCs survive), so a rebuild over the shipped
// files has to be a fixed point. Both stages take
// `--out` for exactly this; that is the only reason they can be run anywhere but in place.
//
// The second test is the shared-system census behind gen_scenes' `need_ids`: the npc ids
// whose own dialogue program writes the bank-0x90 talk-launcher bank, read straight out
// of the overlays, must equal the npc ids web/assets/data/talk_launch_bindings.json
// carries -- which is built from the scenes themselves. Two independent derivations of
// the same fact, 77 stages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCENES = join(ROOT, "web/assets/scenes");
const PY = join(ROOT, ".venv/bin/python3");
const SCRATCH = join(ROOT, ".bunny-scratch/scene-rebuild");

const sceneFiles = readdirSync(SCENES).filter((f) => /^s\d+\.json$/.test(f)).sort();

function rebuildInto(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(SCENES, dir, { recursive: true });
  const py = (script, args) =>
    execFileSync(PY, [join(ROOT, "tools", script), ...args], { cwd: ROOT, encoding: "utf8" });
  py("gen_scenes.py", ["--all", "--out", dir]);
  py("gen_trap_pads.py", ["--out", dir]);
}

test("a full rebuild of the scene stages reproduces every shipped scene file", () => {
  assert.equal(sceneFiles.length, 294, "every stage has a scene file");
  rebuildInto(SCRATCH);
  const dirty = [];
  for (const name of sceneFiles) {
    const built = readFileSync(join(SCRATCH, name), "utf8");
    if (built !== readFileSync(join(SCENES, name), "utf8")) dirty.push(name);
  }
  rmSync(SCRATCH, { recursive: true, force: true });
  assert.deepEqual(dirty, [], "run: .venv/bin/python3 build_all.py --only gen_scenes,gen_trap_pads");
});

test("the launcher-site npc ids read from the overlays are the ones the shipped bindings carry", () => {
  const out = execFileSync(PY, ["-c", `
import json, sys
sys.path.insert(0, "tools")
from gen_scenes import launcher_site_npc_ids
rows = json.load(open("web/assets/data/talk_launch_bindings.json"))["stages"]
bad = {s: (sorted({r["npc"] for r in v}), sorted(launcher_site_npc_ids(int(s.lstrip("s")))))
       for s, v in rows.items()
       if {r["npc"] for r in v} != launcher_site_npc_ids(int(s.lstrip("s")))}
print(json.dumps({"stages": len(rows), "mismatched": bad}))
`], { cwd: ROOT, encoding: "utf8" });
  const { stages, mismatched } = JSON.parse(out);
  assert.ok(stages >= 70, `expected the launcher bindings to cover the stages that use them, saw ${stages}`);
  assert.deepEqual(mismatched, {}, "every bank-0x90 launcher site must have an actor in its scene");
});

test("the scene a launcher site needs is in the shipped file (s951 npc 403, card folder 158)", () => {
  // The one folder the reachability census could not place before the generator kept
  // every ordered dialogue state: this actor's third line carries the bank-0x78 write,
  // and it was dropped because its text could not be resolved at build time.
  const scene = JSON.parse(readFileSync(join(SCENES, "s951.json"), "utf8"));
  const npc = scene.npcs.find((n) => n.npc_id === 403);
  assert.ok(npc, "s951 npc 403 must be placed");
  const states = npc.dialogue_states;
  assert.ok(states.length >= 3, `s951 npc 403 carries ${states.length} ordered lines`);
  const writes = states.flatMap((s) => s.on_close ?? []);
  assert.ok(writes.some((w) => ((w.id >> 8) & 0xfe) === 0x78 && (w.id & 0x1ff) === 78),
    "one of its lines writes the folder-158 launcher bit");
});

// ── the hand-row census: the decode table may not stand in for a decoded start ────────────────
// tools/engine-convert/decode-table.json is the converter's list of events it cannot place by
// itself. 42 rows in it were hand marks that a decoded shared system DOES start — 15 on
// cutscenes, 24 on native handlers, 3 exit-triggered claims — and a `trigger: "None"` mark emits
// NOTHING, so such a row could only mislead: the plan and the notes read as "this scene is
// unreachable" while a ported system starts it.
//
// The rule is mechanical. A row is an offender when it emits no engine event (`None`) or names a
// trigger the disc does not have, AND a decoded start already owns that event. "Owned" means one of
// the three decoded starts reaches it: a per-place gate object (engine/systems/scene-arrival.ts,
// both phase bands), an op-8 step record (engine/systems/trigger-system.ts), or the bank-0x90 talk
// launcher (engine/systems/talk-launch.ts). Re-running convert.ts without them moves exactly two
// rows in web/assets/engine-content.json — s795.auto.1505 and s800.auto.1506 appear and the
// guessed s800.sb.post OnTalk row for 1506 goes — which is what makes the deletion safe.
// The per-scene hand-row census. `web/assets/scenes/*.json` is generated data, and until
// 2026-10-05 one file in it carried a field no generator writes: s410's `gondola: true` exit
// (with `consoleX`/`consoleY`), added by the now-deleted tools/wire_gondola.py so an invented
// OnExit trigger could fire. A hand field is invisible in a diff of behaviour and reads as data,
// so the field VOCABULARY is pinned here: every key in all 294 files, measured, with the count
// each one carries. A new field — a hand row, a hand flag, a half-finished override — fails this
// until it is either generated or named here with its reason.
//
// 68 keys over 294 stages. `gondola`, `consoleX` and `consoleY` are the ones that were here.
function sceneFieldCensus() {
  const counts = new Map();
  for (const name of sceneFiles) {
    const walk = (node) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          counts.set(k, (counts.get(k) ?? 0) + 1);
          walk(v);
        }
      }
    };
    walk(JSON.parse(readFileSync(join(SCENES, name), "utf8")));
  }
  return counts;
}

test("no scene file carries a hand field: the whole field vocabulary is pinned", () => {
  const counts = sceneFieldCensus();
  const EXPECTED = ["arg_a", "arg_b", "bottom", "cell", "cols", "companion", "cutsceneOnly",
    "dialogue", "dialogue_states", "dir", "dirName", "doors", "entryCompanion", "entryKey", "eq",
    "eq_b", "exits", "expected", "file", "flag", "flag_b", "gate", "gate_a", "gate_b", "grid",
    "h", "iceSlide", "id", "idx", "index", "invisible", "key", "ladders", "launchPad", "mask",
    "mazeSections", "n", "nativeDir", "npc_id", "npcs", "on_close", "param", "ptrB", "reset",
    "rows", "screen", "selfWarp", "slot", "spawnX", "spawnY", "spawn_flags", "sprite", "stage",
    "start", "stepOp", "stop", "to", "top", "transition", "trapPads", "w", "warp", "warps", "x",
    "y", "y1", "y2", "zones"];
  assert.deepEqual([...counts.keys()].sort(), EXPECTED,
    "a scene field appeared that no generator writes — a hand row unless it is named here");
  // And the two that were here are gone for good.
  for (const gone of ["gondola", "consoleX", "consoleY"])
    assert.ok(!counts.has(gone), `${gone} is the hand-wired gondola exit; the console is a conversation`);
  // Every field the traps decoder writes is still there, and it is the only place those keys live.
  const trapFiles = sceneFiles.filter((n) => {
    const s = JSON.parse(readFileSync(join(SCENES, n), "utf8"));
    return "trapPads" in s;
  });
  assert.ok(trapFiles.length >= 3, `trapPads decoded in ${trapFiles.length} stages`);
  for (const k of ["cols", "rows", "mask", "reset"])
    assert.equal(counts.get(k), trapFiles.length, `${k} belongs to trapPads only`);
  // `start`/`stop` are the ice-slide band's own two endpoints (s735/s736), not trap-pad data.
  for (const k of ["start", "stop"]) {
    const owners = sceneFiles.filter((n) => {
      const s = JSON.parse(readFileSync(join(SCENES, n), "utf8"));
      return JSON.stringify(s).includes(`"${k}"`);
    });
    assert.deepEqual(owners, ["s735.json", "s736.json"], `${k} belongs to the ice slide only`);
  }
});

function decodeStarts() {
  const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
  const arrival = read("web/assets/data/scene/arrival_candidates.json");
  const steps = read("web/assets/data/story_steps.json").stages;
  const launch = read("web/assets/data/talk_launch_bindings.json");
  const gatesOf = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);
  const owned = new Map();                       // "<stage>|<event>" → which system starts it
  const add = (st, ev, who) => { const k = `${st}|${ev}`; if (!owned.has(k)) owned.set(k, who); };
  for (const [st, v] of Object.entries(arrival.stages))
    for (const g of gatesOf(v))
      for (const c of g.candidates) add(st, c.event, `gate object (${g.phase_gate.band} band) at ${g.tick}`);
  for (const [n, st] of Object.entries(steps))
    for (const s of st.steps ?? []) if (s.op === 8) add("s" + n, s.params[0], "op-8 step record");
  for (const [st, rows] of Object.entries(launch.stages ?? {}))
    for (const r of rows) if (r.in_stage !== false) add(st, r.event, "bank-0x90 talk launcher");
  return owned;
}

test("no hand row stands in for a start the decoded systems already own", () => {
  const decode = JSON.parse(readFileSync(join(ROOT, "tools/engine-convert/decode-table.json"), "utf8"));
  const owned = decodeStarts();
  const offenders = [];
  const inert = [];
  for (const [st, table] of Object.entries(decode)) {
    if (st === "_comment") continue;
    for (const [ev, row] of Object.entries(table)) {
      if (ev === "_comment" || !row || typeof row !== "object") continue;
      if (row.trigger === "None") inert.push(`${st}/${ev}`);
      const who = owned.get(`${st}|${ev}`);
      if (who) offenders.push(`${st}/${ev}: trigger ${row.trigger}, but ${who} starts it`);
    }
  }
  // The only marks that may stay: the two vestigial ambush handlers no step record reaches,
  // plus s220/54 — the Digimon Lab's seventh navi scene, which the NAMED set below already
  // documents as UNSTARTED (no gate object, no op-8 step record and no launcher bit). It used
  // to be fired by the classifier's speaker-guessed OnTalk row; the None mark retires that.
  assert.deepEqual([...inert].sort(), ["s220/54", "s949/9000", "s953/9000"],
    `unexpected inert marks: ${inert.filter((x) => !["s949/9000", "s953/9000", "s220/54"].includes(x)).join(", ")}`);
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("every scene in the walker's own tables has a decoded start, and the rest is named", () => {
  // The other half, on the data the browser loads. An event with no decoded start at all is the
  // thing the hand rows used to paper over. The allowed remainder is derived, not listed by hand:
  // the interactive controllers' ANSWER events (each yes/no tutorial's two replies, started by the
  // controller routine that tools/measure_gate_objects.py counts as `controllers`), plus the small
  // named set below, each with its reason.
  const events = JSON.parse(readFileSync(join(ROOT, "web/assets/events/wstag_events.json"), "utf8"));
  const owned = decodeStarts();
  // s756 asks for 352 but its own event table holds 910/911, so start_event binds no record
  // (fieldstg.s:2536-2540). Settled 2026-10-02, .bunny-scratch/prior/s756evt-report.md.
  const NAMED = {
    "s756|352": "the overlay asks for it; s756's own event table does not own it, so it is silent on the disc",
    "s949|9000": "vestigial ambush handler: no step record reaches it and the stage's slot 5 is empty",
    "s953|9000": "vestigial ambush handler: no step record reaches it and the stage's slot 5 is empty",
    "s406|1285": "UNSTARTED: no gate object, no op-8 step record and no launcher bit names it",
    "s220|54": "UNSTARTED: no gate object, no op-8 step record and no launcher bit names it",
    "s550|1225": "started by the 3-bucket classifier's OnTalk guess, not by a decoded start",
    "s551|1226": "started by the 3-bucket classifier's OnTalk guess, not by a decoded start",
  };
  const orphans = [];
  for (const [st, list] of Object.entries(events)) {
    for (const e of list) {
      const k = `${st}|${e.id}`;
      if (owned.has(k) || k in NAMED || k === "s756|352") continue;
      orphans.push(k);
    }
  }
  // Everything left must be a yes/no tutorial's reply: started by the ported controller when the
  // player picks it (engine/dw3/ui/native/yesno-launcher.ts), which is not one of the three
  // scene-system starts.
  const census = JSON.parse(execFileSync(
    process.env.PY ?? ".venv/bin/python3", ["tools/measure_gate_objects.py"], { encoding: "utf8" }));
  const answerLike = new Set(
    census.rows.filter((r) => r.kind === "controllers").flatMap((r) => r.event_literals));
  const unexplained = orphans.filter((k) => !answerLike.has(Number(k.split("|")[1])));
  assert.deepEqual(unexplained, [], `events no decoded start reaches: ${unexplained.join(", ")}`);
  assert.ok(orphans.length > 0, "the census must still see the known gap, or it is not measuring");
});
