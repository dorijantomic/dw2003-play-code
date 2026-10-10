// The three Jogress-only fusions have geometry: Agunimon (468), BladeGarurumon
// (469) and AncientGreymon (470) are the only smdldata keys whose CD packs were
// never unpacked under `~/ddw3/pack/dw2003/fight/model`, so before this pass
// `web/assets/battle/models` held 245 of the 248 and the DNA cut-in fell back to
// the acting form (`web/battle.js`, the `ok === false && next.result` branch).
//
// Their pack folder names are READ, not typed: each fused model's smdldata record
// gives the CD file id (`resource`), and the disc's own file table gives that
// file's name -- `tools/extract_jogress_scripts.py` writes both into
// `web/assets/data/jogress_scripts.json` (`fusedPack`), and
// `tools/extract_fight_model_pack.py` carved the three files out of the disc image
// and `tools/build_fight_models.py` built them through the same pipeline as the
// other 245.
//
// What this file checks is the CONSUMER path: that every DNA action's fused pack
// is a model folder the renderer can actually load, with the same anim.json shape
// and a baked texture, listed in the viewer's index.json and reachable from the
// name -> folder map the battle screen resolves through.

// Lane B oracle: the pack behind each of the ten DNA fusions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildBoneWorldMatrices, updateSkeletalVBO } from "../../web/battle3d.js";

const ROOT = new URL("../../", import.meta.url);
const JOGRESS = JSON.parse(readFileSync(new URL("web/assets/data/jogress_scripts.json", ROOT), "utf8"));
const PLACEMENT = JSON.parse(readFileSync(new URL("web/assets/battle/model_placement.json", ROOT), "utf8"));
const MODEL_MAP = JSON.parse(readFileSync(new URL("web/assets/battle/model_map.json", ROOT), "utf8"));
const INDEX = JSON.parse(readFileSync(new URL("web/assets/battle/models/index.json", ROOT), "utf8"));

const FUSED = Object.values(JOGRESS.actions);
const load = (folder) => JSON.parse(readFileSync(join(ROOT.pathname, `web/assets/battle/models/${folder}/anim.json`), "utf8"));

test("every DNA action's fused pack is named from disc data and is built", () => {
  assert.equal(FUSED.length, 10);
  for (const action of FUSED) {
    const pack = action.fusedPack;
    assert.ok(pack, `action ${action.actionId}: no fused pack recorded`);
    assert.equal(Number(pack.folder.slice(1, 4)), action.fusedModel,
      `action ${action.actionId}: ${pack.folder} is not model ${action.fusedModel}`);
    // smdldata carries that model number, so the fused form stands in the arena
    // with its own stand-off / hover / canned shots.
    assert.ok(PLACEMENT.models[String(action.fusedModel)],
      `action ${action.actionId}: model ${action.fusedModel} has no smdldata record`);
    assert.ok(INDEX.includes(pack.folder), `${pack.folder} missing from models/index.json`);
  }
});

test("the three Jogress-only packs are present with geometry, keyframes and a texture", () => {
  // m468agnm Agunimon, m469garm BladeGarurumon, m470agry AncientGreymon.
  const packs = FUSED.filter((a) => a.fusedModel >= 468).map((a) => a.fusedPack.folder);
  assert.deepEqual(packs, ["m468agnm", "m469garm", "m470agry"]);
  for (const folder of packs) {
    const model = load(folder);
    assert.ok(model.bones.length > 0, `${folder}: no bones`);
    assert.equal(model.bones.length, model.num_bones, `${folder}: bone count`);
    const verts = model.bones.reduce((n, b) => n + b.verts.length, 0);
    const faces = model.bones.reduce((n, b) => n + b.faces.length, 0);
    const keyframes = model.bones.reduce((n, b) => n + ((b.anim?.ch1?.length ?? 0) + (b.anim?.ch2?.length ?? 0)), 0);
    assert.ok(verts > 100 && faces > 100 && keyframes > 100,
      `${folder}: ${verts}v ${faces}f ${keyframes}kf is not a model`);
    assert.ok(model.total_frames > 0, `${folder}: no frames`);
    // The same texture page every other model has: a 256x256 RGBA PNG.
    const png = readFileSync(join(ROOT.pathname, `web/assets/battle/textures/${folder}.png`));
    assert.equal(png.subarray(1, 4).toString("latin1"), "PNG", `${folder}: not a PNG`);
    assert.deepEqual([...png.subarray(16, 25)], [0, 0, 1, 0, 0, 0, 1, 0, 8],
      `${folder}: not a 256x256 8-bit page`);
    assert.equal(png[25], 6, `${folder}: not RGBA`);
    assert.ok(png.length > 4096, `${folder}: texture is empty`);
  }
});

test("each new model skins and poses like any other: finite matrices, moving vertices", () => {
  for (const folder of ["m468agnm", "m469garm", "m470agry"]) {
    const model = load(folder);
    for (const frame of [0, Math.floor(model.total_frames / 2)]) {
      const { mats } = buildBoneWorldMatrices(model, frame);
      assert.equal(mats.length, model.num_bones, `${folder}@${frame}: mat count`);
      for (const m of mats) for (const v of m) assert.ok(isFinite(v), `${folder}@${frame}: ${v}`);
      const corners = model.bones.reduce((n, b) => n + b.faces.length * 3, 0);
      const positions = new Float32Array(corners * 3);
      updateSkeletalVBO(model, frame, mats, positions);
      for (let i = 0; i < positions.length; i++) {
        assert.ok(isFinite(positions[i]), `${folder}@${frame}: vertex ${i} = ${positions[i]}`);
      }
    }
  }
});

test("the battle screen resolves each new pack by Digimon name", () => {
  // web/battle3d.js `resolveModelFolder` is the only path the DNA cut-in has to a
  // mesh, and it is a straight lookup in this map.
  const byFolder = new Map(Object.entries(MODEL_MAP).map(([name, folder]) => [folder, name]));
  for (const name of ["Agunimon", "BladeGarurumon", "AncientGreymon"]) {
    const folder = MODEL_MAP[name];
    assert.ok(folder, `${name} has no battle model`);
    assert.ok(existsSync(join(ROOT.pathname, `web/assets/battle/models/${folder}/anim.json`)),
      `${name} -> ${folder} is not built`);
    assert.equal(byFolder.get(folder), name, `${folder} is claimed by two names`);
  }
});