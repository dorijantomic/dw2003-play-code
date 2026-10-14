// Digi-Egg traversal forms (Submarimon / Digmon).
//
// Covers the three layers the decode touches:
//   constants  -> the step opcode / sprite-id / gate-flag pairing from fieldstg
//   section    -> which screens the form is worn on, derived from the exit graph
//   locomotion -> Digmon's halved move magnitude
//
// Decode reference: engine/systems/dive-form.ts header.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  DIVE_FORMS, SURFACE_PLAYER_SPRITE_ID, diveFormForStepOp, isDiveStepOp,
  diveMoveMagnitude, computeDiveNetwork, diveFormOnScreen,
} from "../engine/systems/dive-form.ts";
import { FIELD_RUN_MAGNITUDE } from "../engine/systems/field-movement.ts";

const SCENES = "web/assets/scenes";

function loadScenes() {
  const scenes = {};
  for (const f of readdirSync(SCENES)) {
    if (!f.endsWith(".json")) continue;
    scenes[f.slice(0, -5)] = JSON.parse(readFileSync(`${SCENES}/${f}`, "utf8"));
  }
  return scenes;
}

test("op 9 is the hole/Digmon dive and op 10 the water/Submarimon dive", () => {
  // a2 at the 0x80088860 convergence: op 10 -> 0, op 9 -> 1.
  assert.equal(DIVE_FORMS[9].mode, 1);
  assert.equal(DIVE_FORMS[10].mode, 0);
  // FIELDSTG sprite-table ids read by the cast rebuild's [0x146,0x148) window.
  assert.equal(DIVE_FORMS[9].spriteId, 326);
  assert.equal(DIVE_FORMS[10].spriteId, 327);
  assert.equal(DIVE_FORMS[9].sprite, "p123digm");
  assert.equal(DIVE_FORMS[10].sprite, "p122sbmm");
  // The gates every shipped exit of each opcode carries.
  assert.equal(DIVE_FORMS[9].gateFlag, 0x7094);
  assert.equal(DIVE_FORMS[10].gateFlag, 0x7093);
  assert.equal(SURFACE_PLAYER_SPRITE_ID, 2);
});

test("only 9 and 10 are dive opcodes", () => {
  for (const op of [0, 1, 2, 7, 8, 11, 14, null, undefined, "9"])
    assert.equal(isDiveStepOp(op), false, `op ${op} must not dive`);
  assert.equal(diveFormForStepOp(1), null);
  assert.equal(diveFormForStepOp(9).name, "Digmon");
  assert.equal(diveFormForStepOp(10).name, "Submarimon");
});

test("both form sprite packs ship and carry an idle and a walk clip", () => {
  const manifest = JSON.parse(readFileSync("web/assets/manifest.json", "utf8"));
  for (const op of [9, 10]) {
    const rec = manifest.npcs.find((n) => n.id === DIVE_FORMS[op].sprite);
    assert.ok(rec, `${DIVE_FORMS[op].sprite} missing from the manifest`);
    // Rendering the player from this pack needs at least idle (1) and walk (4).
    assert.ok(rec.clips?.["1"], `${rec.id} has no idle clip`);
    assert.ok(rec.clips?.["4"], `${rec.id} has no walk clip`);
  }
});

test("Digmon halves the native move magnitude; Submarimon keeps it", () => {
  assert.equal(diveMoveMagnitude(DIVE_FORMS[9], FIELD_RUN_MAGNITUDE), FIELD_RUN_MAGNITUDE / 2);
  assert.equal(diveMoveMagnitude(DIVE_FORMS[10], FIELD_RUN_MAGNITUDE), FIELD_RUN_MAGNITUDE);
  assert.equal(diveMoveMagnitude(null, FIELD_RUN_MAGNITUDE), FIELD_RUN_MAGNITUDE);
  // 0x4cc >> 1 == 0x266, the value the constructor stores at +0x68 for 326.
  assert.equal(diveMoveMagnitude(DIVE_FORMS[9], 0x4cc), 0x266);
  // Round toward zero, matching the native srl/addu/sra idiom.
  assert.equal(diveMoveMagnitude(DIVE_FORMS[9], 7), 3);
});

test("a dive section spreads over non-dive exits but never through another dive", () => {
  const scenes = {
    s100: { exits: [{ to: "s800", stepOp: 10 }] },       // surface dock
    s101: { exits: [{ to: "s900", stepOp: 9 }] },        // surface hole
    s800: { exits: [{ to: "s801" }, { to: "s100" }] },   // seabed entry + way back
    s801: { exits: [{ to: "s802" }] },
    s802: { exits: [] },
    s900: { exits: [{ to: "s901" }] },                   // separate hole section
    s901: { exits: [] },
    s100b: { exits: [] },
  };
  const { network, conflicts } = computeDiveNetwork(scenes);
  assert.deepEqual(conflicts, []);
  assert.equal(network.get("s800"), 10);
  assert.equal(network.get("s801"), 10);
  assert.equal(network.get("s802"), 10);
  // The op-9 exit inside the seabed starts its own section, not a continuation.
  assert.equal(network.get("s900"), 9);
  assert.equal(network.get("s901"), 9);
  // s100 is a dive SOURCE, so the seabed's exit back to it does not drag the
  // surface into the section.
  assert.equal(network.has("s100"), false);
  assert.equal(network.has("s100b"), false);
});

test("a dive source nested inside a section is left unclaimed (documented limit)", () => {
  // The shipped data never does this -- the real-scene test asserts source and
  // destination are disjoint. If a future decode adds a hole INSIDE the seabed,
  // the graph rule cannot classify it and the per-stage 326/327 marker table
  // becomes required. Pinned so that day fails loudly here first.
  const { network } = computeDiveNetwork({
    s100: { exits: [{ to: "s800", stepOp: 10 }] },
    s800: { exits: [{ to: "s801" }] },
    s801: { exits: [{ to: "s900", stepOp: 9 }] },
    s900: { exits: [] },
  });
  assert.equal(network.get("s800"), 10);
  assert.equal(network.get("s900"), 9);
  assert.equal(network.has("s801"), false);
});

test("the shipped scenes partition cleanly into a Digmon and a Submarimon section", () => {
  const scenes = loadScenes();
  const { network, conflicts } = computeDiveNetwork(scenes);
  assert.deepEqual(conflicts, [], "a screen must not belong to both dive forms");

  // Destinations actually shipped, per opcode (regression lock on the data).
  const dst = { 9: new Set(), 10: new Set() };
  for (const scene of Object.values(scenes))
    for (const e of scene.exits ?? [])
      if (isDiveStepOp(e.stepOp)) dst[e.stepOp].add(e.to);
  assert.deepEqual([...dst[9]].sort(), ["s865", "s870", "s968", "s969"]);
  assert.deepEqual(
    [...dst[10]].sort(),
    ["s825", "s830", "s835", "s840", "s850", "s960", "s961", "s962", "s963", "s965"],
  );
  for (const s of dst[9]) assert.equal(diveFormOnScreen(network, s).name, "Digmon");
  for (const s of dst[10]) assert.equal(diveFormOnScreen(network, s).name, "Submarimon");

  // No screen is both a dive source and a dive destination -- the property the
  // source-terminated walk relies on. If this ever breaks, the section rule
  // needs the real per-stage 326/327 marker table instead.
  const sources = new Set();
  for (const [id, scene] of Object.entries(scenes))
    for (const e of scene.exits ?? []) if (isDiveStepOp(e.stepOp)) sources.add(id);
  for (const s of [...dst[9], ...dst[10]])
    assert.equal(sources.has(s), false, `${s} is both a dive source and destination`);

  // The two sections, locked. Submarimon = Seabed band + endgame aliases,
  // Digmon = Circuit band + endgame aliases. s860 and s875-s895 are absent
  // from the exit-graph network because those screens are reached only through
  // the runtime maze-exit table (mazeSections) -- the gap the per-screen
  // cast-list markers below now cover. s845/s855 left the STATIC graph with the
  // places system: the place-carrying stages (s825-s895 here) now ship their own
  // StageSlots as self-warp placeholders and re-aim them per the incoming place
  // pair at runtime (engine/systems/place-points.ts), so the static rows no
  // longer walk s840/s850 -> s845/s855. Their form comes from the native
  // cast-list markers (327), which the runtime prefers anyway.
  const section = (op) => [...network].filter(([, v]) => v === op).map(([k]) => k).sort();
  assert.deepEqual(section(10), [
    "s825", "s830", "s835", "s840", "s850",
    "s960", "s961", "s962", "s963", "s965",
  ]);
  assert.deepEqual(section(9), ["s865", "s870", "s968", "s969"]);
});

test("each traversal form has its own decoded step sound", () => {
  // fieldstg 0x8008d0c4 branches on the character's sprite id at [char+0x4]:
  //   default -> PLAYER00 every 8 ticks
  //   326     -> DIG_MOVE every 32 ticks (a second `tick & 0x1f` gate)
  //   327     -> no sample; the branch calls the hook at [0x800ab6a0] instead
  const sfxManifest = JSON.parse(readFileSync("web/assets/sfx/manifest.json", "utf8"));
  assert.equal(sfxManifest.player00?.id, "0x8004583c");
  // Digmon's cue must actually ship, or the form falls silent by accident.
  assert.equal(sfxManifest.dig_move?.id, "0x80045fcb");

  // The trigger row that puts DIG_MOVE in the build set, kept honest.
  const triggers = JSON.parse(readFileSync("docs/research/audio/sfx-triggers.json", "utf8"));
  const row = triggers.find((r) => r.name === "DIG_MOVE");
  assert.ok(row, "DIG_MOVE has no sfx-triggers row");
  assert.equal(row.id, "0x80045fcb");
  assert.equal(row.status, "decoded");
  assert.ok(row.walker_hook, "DIG_MOVE must declare its walker hook to stay in the build set");
});

test("a screen outside every dive section wears no form", () => {
  const { network } = computeDiveNetwork(loadScenes());
  // s200 is the first surface stage and is not a dive destination.
  assert.equal(diveFormOnScreen(network, "s200"), null);
  assert.equal(diveFormOnScreen(network, "s-nonexistent"), null);
});

test("the per-screen cast-list markers cover the maze screens the exit graph misses", () => {
  // tools/extract_dive_form_markers.py reads each stage's descriptor+0x4C cast
  // list and takes the unconditional record whose id is 0x146 (Digmon) or
  // 0x147 (Submarimon). That is the native rule; the exit graph is only a
  // fallback. Claim world-q001-dive-form-is-a-per-screen-cast-marker-2026-09-13.
  const markers = JSON.parse(readFileSync("web/assets/data/dive_form_markers.json", "utf8"));
  const { network } = computeDiveNetwork(loadScenes());

  // The native marker set is larger than the exit-graph network.
  assert.equal(Object.keys(markers).length, 30);
  const networkScreens = new Set([...network.keys()]);
  for (const s of networkScreens)
    assert.ok(s in markers, `${s} is in the network but has no native marker`);

  // The 14 maze-entered screens the exit graph never reaches, plus s845/s855:
  // the places system rebuilt the place-carrying stages' exits as their own
  // place-aimed StageSlots (see the section lock above), so the static graph no
  // longer walks into those two either. Their markers are the form that ships.
  const missing = {
    s845: "Submarimon", s855: "Submarimon",
    s860: "Submarimon", s875: "Digmon", s880: "Digmon", s885: "Digmon",
    s890: "Digmon", s895: "Digmon", s964: "Submarimon", s966: "Submarimon",
    s967: "Submarimon", s970: "Digmon", s971: "Digmon", s972: "Digmon",
    s973: "Digmon", s974: "Digmon",
  };
  for (const [screen, name] of Object.entries(missing)) {
    assert.equal(network.has(screen), false, `${screen} must be missing from the network`);
    assert.equal(screen in markers, true, `${screen} must carry a native marker`);
    assert.equal(diveFormOnScreen(network, screen, markers)?.name, name,
      `${screen} must wear ${name} from its marker`);
  }

  // Markers name Junior's screens as null too, and a surface screen stays null.
  assert.equal(diveFormOnScreen(network, "s200", markers), null);
  // Every recorded id is one of the two form sprite ids.
  for (const id of Object.values(markers))
    assert.ok(id === 326 || id === 327, `unexpected marker id ${id}`);
});
