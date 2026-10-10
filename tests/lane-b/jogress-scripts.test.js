// Lane B oracle: the ten DNA/Jogress director scripts — who the fused Digimon is.
//
// Nothing in the original's code names the result of a DNA DV. The name is
// DATA, and this file checks all of it three ways:
//
//  1. `web/assets/data/jogress_scripts.json`, the committed output of
//     `tools/extract_jogress_scripts.py`, re-derived here from the disc bytes so
//     it cannot drift from the action bins.
//
//  2. Action 374 against the RAM capture. The clip-12 script of Stingmon's pack
//     (model 260) must decode op-for-op and word-for-word onto the 94 operations
//     captured out of a live run
//     (docs/research/battle/captures/dna-2026-07-14/clip12-full-script.md, kept
//     in web/assets/data/dna_clip12.json `fullScript.segments`).
//
//  3. The browser's own action VM (web/fight/action-vm.js) must produce the same
//     model assignments from each extracted script that the extraction names —
//     the consumer path, not a re-read of the JSON.
//
// The decode itself (op codes, operand widths, the 18 x u32 offset header) is
// `tools/decode_action_scripts.py`, shared with every shipped model build. Two
// assembly anchors:
//
//   * FIGHTSTG_F0x8008f714, fightstg.s:12957-12992 (0x8008f7cc-0x8008f7f4):
//     `lbu $v1, 0x10($s0)` / `li $v0, 0xc` / `bne` → presentation command 0x3A.
//     The clip byte 12 is a SCRIPT INDEX into the acting fighter's own 0x48-magic
//     action bin, not a species.
//   * `op2` sub-op 6, `.L0x8008bac0` (fightstg.s:9038-9074): the slot model spawn.
//     The third word is read into `$s3` by the op2 preamble and handed to the
//     fight manager's `[+0x184](obj, slot, model, 0)`. In each clip-12 script the
//     first such op names the partner and the second the fused form; the captured
//     action-374 script fixes that order ("op2 [6,2,259] slot 2 := model 259
//     (ExVeemon)" / "op2 [6,3,254] slot 3 := model 254 (Paildramon)").

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ActionVM } from "../../web/fight/action-vm.js";
import { dnaFusedForm } from "../../web/battle.js";
import {
    DNA_COMBATANT_STRIDE, DNA_PRICE_STRIDE, DNA_PRICES, DNA_PROFILE_PAIR,
    DNA_PROFILE_RESULT, DNA_PROFILE_ROWS, DNA_SPECIES_TABLE,
} from "../../engine/dw3/ui/native/battle-dna-menu.ts";

const dataDir = resolve(fileURLToPath(import.meta.url), "../../../web/assets/data");
const screens = resolve(dataDir, "../native/screens");
const resident = new Uint8Array(readFileSync(join(screens, "resident.bin")));
const RESIDENT_BASE = 0x80010000;
const extracted = JSON.parse(readFileSync(join(dataDir, "jogress_scripts.json"), "utf8"));
const captured = JSON.parse(readFileSync(join(dataDir, "dna_clip12.json"), "utf8"));
const digimon = JSON.parse(readFileSync(join(dataDir, "digimon.json"), "utf8")).digimon;

const MODEL_DIR = join(homedir(), "ddw3/pack/dw2003/fight/model");
const haveModels = existsSync(MODEL_DIR);

/** The ten DNA action ids, read out of the profile table, not written down. */
const DNA_ACTIONS = (() => {
    const out = new Map();
    for (let row = 0; row < DNA_PROFILE_ROWS; row++) {
        const at = DNA_SPECIES_TABLE - RESIDENT_BASE + DNA_COMBATANT_STRIDE * row;
        const action = resident[at + DNA_PROFILE_RESULT] | (resident[at + DNA_PROFILE_RESULT + 1] << 8);
        const partner = resident[at + DNA_PROFILE_PAIR];
        if (action < 1 || partner === 0) continue;
        out.set(action, (out.get(action) ?? 0) + 1);
    }
    return out;
})();

/** Model number -> the profile row that carries it, from the table's own +0x00. */
const PROFILE_BY_MODEL = (() => {
    const map = new Map();
    for (let row = 0; row < DNA_PROFILE_ROWS; row++) {
        const at = DNA_SPECIES_TABLE - RESIDENT_BASE + DNA_COMBATANT_STRIDE * row;
        map.set(resident[at] | (resident[at + 1] << 8), digimon[row]);
    }
    return map;
})();

const clipOf = (action) =>
    resident[DNA_PRICES - RESIDENT_BASE + DNA_PRICE_STRIDE * (action - 1) + 0x10];

test("the profile table names exactly ten DNA actions, each on clip 12", () => {
    assert.equal(DNA_ACTIONS.size, 10, `expected 10 DNA action ids, got ${DNA_ACTIONS.size}`);
    for (const [action, members] of DNA_ACTIONS) {
        assert.ok(members >= 2, `action ${action} has ${members} participating profile row(s)`);
        assert.equal(clipOf(action), 12,
            `action ${action}'s technique record carries clip ${clipOf(action)}, not 12`);
    }
    // The extraction has one row per action id and no others.
    assert.deepEqual(
        Object.keys(extracted.actions).map(Number).sort((a, b) => a - b),
        [...DNA_ACTIONS.keys()].sort((a, b) => a - b));
});

test("the extractor reproduces the committed file from the disc bytes", (t) => {
    if (!haveModels) {
        t.skip("extracted fight model packs are not present at " + MODEL_DIR);
        return;
    }
    const py = process.env.DW3_PYTHON ?? ".venv/bin/python3";
    if (!existsSync(py)) {
        t.skip("no python at " + py + " to re-run the extractor");
        return;
    }
    execFileSync(py, ["tools/extract_jogress_scripts.py"], { encoding: "utf8" });
    execFileSync(py, ["tools/extract_jogress_scripts.py", "--check"], { encoding: "utf8" });
});

test("each action's fused model is the second spawn of both parents' own scripts", () => {
    for (const [key, entry] of Object.entries(extracted.actions)) {
        const action = Number(key);
        assert.equal(entry.actionId, action);
        assert.equal(entry.clip, 12, `action ${action} clip`);
        assert.ok(entry.members.length >= 2, `action ${action} has ${entry.members.length} member(s)`);
        const memberModels = new Set(entry.members.map((m) => m.model));
        for (const member of entry.members) {
            const spawns = member.ops
                .filter((rec) => rec.op === 2 && (rec.words[0] | 0) === 6)
                .map((rec) => [rec.words[1] | 0, rec.words[2] | 0]);
            assert.deepEqual(spawns.map((s) => s[1]), member.scriptModels,
                `action ${action}: the extracted models must be model ${member.model}'s own spawns`);
            assert.equal(spawns.length, 2,
                `action ${action}: model ${member.model} spawns ${spawns.length} model(s)`);
            assert.equal(spawns[1][1], entry.fusedModel,
                `action ${action}: model ${member.model}'s SECOND spawn is the fused form`);
            assert.equal(spawns[0][1], member.partnerModel);
            assert.equal(member.scriptFusedModel, entry.fusedModel);
            assert.ok(memberModels.has(member.partnerModel),
                `action ${action}: model ${member.model}'s partner ${member.partnerModel} is not a member`);
            assert.notEqual(entry.fusedModel, member.model);
            assert.notEqual(entry.fusedModel, member.partnerModel);
            assert.ok(member.pack.folder.startsWith("m" + String(member.model).padStart(3, "0")),
                `model ${member.model} is filed under ${member.pack.folder}`);
            assert.ok(member.motions.length > 0, `action ${action}: model ${member.model} has no motion op`);
            // The profile table must agree: this row's model, and its paired partner.
            const at = DNA_SPECIES_TABLE - RESIDENT_BASE + DNA_COMBATANT_STRIDE * (member.profile - 1);
            assert.equal(resident[at] | (resident[at + 1] << 8), member.model);
            assert.equal(resident[at + DNA_PROFILE_PAIR], member.partnerProfile);
            const partnerAt = DNA_SPECIES_TABLE - RESIDENT_BASE
                + DNA_COMBATANT_STRIDE * (member.partnerProfile - 1);
            assert.equal(resident[partnerAt + DNA_PROFILE_PAIR], member.profile,
                `action ${action}: the pairing is not reciprocal`);
        }
    }
});

test("action 374 decodes onto the RAM-captured script, operation for operation", () => {
    const capturedOps = captured.fullScript.segments.flat()
        .filter((rec) => rec.op !== 0)
        .map((rec) => [rec.op, rec.words]);
    const stingmon = extracted.actions["374"].members.find((m) => m.model === 260);
    assert.ok(stingmon, "action 374 must list Stingmon (model 260) as a member");
    const extractedOps = stingmon.ops.filter((rec) => rec.op !== 0).map((rec) => [rec.op, rec.words]);
    assert.equal(capturedOps.length, 94, "the capture holds 94 non-barrier operations");
    assert.deepEqual(extractedOps, capturedOps);
    // The anchor itself, and the capture's own reading of the two spawns.
    assert.equal(stingmon.pack.folder, "m260stng");
    assert.deepEqual(capturedOps.filter(([op, w]) => op === 2 && w[0] === 6),
        [[2, [6, 2, 259]], [2, [6, 3, 254]]]);
    assert.equal(extracted.actions["374"].fusedModel, 254);
    assert.equal(PROFILE_BY_MODEL.get(254)?.name, "Paildramon");
    // ExVeemon's own copy of the same script names Stingmon first and the same
    // Paildramon second — and the rest is genuinely per-fighter: the staging
    // coordinates and the two preload motions are tuned for whichever model is
    // acting, which is why this has to be read out of the acting fighter's own
    // pack and cannot be one shared script.
    const exvee = extracted.actions["374"].members.find((m) => m.model === 259);
    assert.deepEqual(exvee.scriptModels, [260, 254]);
    assert.equal(exvee.ops.length, stingmon.ops.length);
    const spawns = (ops) => ops.filter((rec) => rec.op === 2 && rec.words[0] === 6);
    assert.deepEqual(spawns(exvee.ops)[1], spawns(stingmon.ops)[1],
        "both parents' scripts must spawn the same fused model");
    assert.notDeepEqual(spawns(exvee.ops)[0], spawns(stingmon.ops)[0],
        "each fighter's script must spawn the other as the partner");
    const differing = exvee.ops.filter((rec, i) => JSON.stringify(rec) !== JSON.stringify(stingmon.ops[i]));
    assert.ok(differing.length > 1,
        "the two parents' staging must differ — one shared script would be wrong");
});

test("the walker's own rule answers every DNA action from the extracted scripts", () => {
    // `species` is the same 55-row profile-table image the DNA pane loads, and
    // `digimon` the same digimon.json the walker addresses its rows with.
    const species = resident.subarray(DNA_SPECIES_TABLE - RESIDENT_BASE,
        DNA_SPECIES_TABLE - RESIDENT_BASE + DNA_COMBATANT_STRIDE * DNA_PROFILE_ROWS);
    const digimonById = Object.fromEntries(digimon.map((d) => [d.id, d]));
    const seen = {};
    for (const action of DNA_ACTIONS.keys()) {
        const fused = dnaFusedForm(extracted, species, action, digimonById);
        assert.ok(fused, `action ${action} must have an extracted director script`);
        assert.equal(fused.clip, 12);
        // The disc's own answer, read out of the profile table's model halfword.
        const row = PROFILE_BY_MODEL.get(fused.fusedModel);
        assert.ok(row, `model ${fused.fusedModel} must be a roster row`);
        assert.equal(fused.fusedName, row.name);
        assert.equal(fused.profile?.id, row.id);
        seen[action] = fused.fusedName;
    }
    assert.deepEqual(seen, {
        374: "Paildramon",
        375: "Phoenixmon",
        376: "MegaGargomon",
        377: "Omnimon",
        378: "Imperialdramon-P",
        379: "Beelzemon",
        380: "Diaboromon",
        432: "Agunimon",
        433: "BladeGarurumon",
        434: "AncientGreymon",
    });
    // An action with no extracted script is not a fusion and must not be renamed.
    assert.equal(dnaFusedForm(extracted, species, 1, digimonById), null);
    assert.equal(dnaFusedForm(null, species, 374, digimonById), null);
});

test("the browser's action VM spawns the same two models from every script", () => {
    for (const entry of Object.values(extracted.actions)) {
        for (const member of entry.members) {
            const assigned = [];
            const vm = new ActionVM({ ops: member.ops }, {
                hooks: { onModelAssign: (e) => assigned.push(e) },
            });
            // The browser VM treats op0 as its terminator, so it runs segment 0 —
            // which is where both spawns are. Anything less and the script's own
            // barrier sits between the two models.
            for (let tick = 0; tick < 400 && !vm.ended; tick++) vm.step(1);
            assert.deepEqual(assigned.map((a) => a.model), member.scriptModels,
                `action ${entry.actionId}: model ${member.model}'s VM assignments`);
            assert.deepEqual(assigned.map((a) => a.slot), [2, 3],
                `action ${entry.actionId}: the slots are the script's raw operands`);
        }
    }
});

test("all ten fused forms are roster Digimon the game can name", () => {
    const named = {};
    for (const [key, entry] of Object.entries(extracted.actions)) {
        named[key] = PROFILE_BY_MODEL.get(entry.fusedModel)?.name ?? null;
    }
    assert.deepEqual(named, {
        374: "Paildramon",
        375: "Phoenixmon",
        376: "MegaGargomon",
        377: "Omnimon",
        378: "Imperialdramon-P",
        379: "Beelzemon",
        380: "Diaboromon",
        432: "Agunimon",
        433: "BladeGarurumon",
        434: "AncientGreymon",
    });
    // The three Jogress-only results (468, 469, 470) are the last three roster
    // rows, and their model packs are the three smdldata keys with no extracted
    // folder (docs/research/battle/smdldata-container-2026-08-05.md).
    for (const model of [468, 469, 470]) {
        assert.ok(PROFILE_BY_MODEL.has(model), `model ${model} must be a roster row`);
    }
});

test("the extraction covers every model pack that has a clip 12", (t) => {
    if (!haveModels) {
        t.skip("extracted fight model packs are not present at " + MODEL_DIR);
        return;
    }
    const covered = new Set();
    for (const entry of Object.values(extracted.actions)) {
        for (const member of entry.members) covered.add(member.pack.folder);
    }
    // Greymon and Dukemon both hold a clip-12 script and must be covered.
    for (const folder of ["m005grey", "m369duke", "m267bkwg", "m378bvnd"]) {
        assert.ok(readdirSync(MODEL_DIR).includes(folder), `${folder} must be extracted on this machine`);
        assert.ok(covered.has(folder), `${folder}'s clip-12 script must be in the extraction`);
    }
    assert.equal(covered.size, 22, "twenty-two Digimon the game lets DNA");
});