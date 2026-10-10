#!/usr/bin/env python3
"""Extract the ten DNA/Jogress director scripts out of the fight model action bins.

A DNA DV does not name its result anywhere in code. `FIGHTSTG_F0x8008f714`
(fightstg.s:12957-12992, 0x8008f7cc-0x8008f7f4) reads the technique record's clip
byte at `+0x10`; the ten DNA action records (374-380, 432-434) all carry 12, and
12 is what becomes presentation command `0x3A`. That number is not a species --
it is the SCRIPT INDEX inside the acting fighter's own 0x48-magic action bin,
the 18 x u32 offset header + opcode stream that `tools/decode_action_scripts.py`
already reads. Each of the twenty-two Digimon the game lets DNA has a clip-12
script, and each of those scripts loads its partner and the fused form as models
(`op2` sub-op 6, the slot spawn at `.L0x8008bac0`, which passes the operand to
`[+0x184](manager, slot, model, 0)`). So the fused species id is disc data, read
here out of the action bins -- nothing is typed in by hand.

Three disc reads, no transcription:

  * `web/assets/native/screens/resident.bin` (the resident PS-X EXE image, base
    0x80010000): the 55-row species profile table at 0x8003EF5C, stride 0x58.
    `+0x00` is the row's MODEL number, `+0x2A` its DNA action id, `+0x3D` its DNA
    partner's 1-based profile index and `+0x55` its own 1-based index.
  * the same image: the 18-byte technique records at 0x80042BDC, whose `+0x10` is
    the clip the action runs.
  * `~/ddw3/pack/dw2003/fight/model/m<NNN>*/`: the model's own action bin. The
    folder's numeric prefix is the model number (docs/research/battle/
    smdldata-container-2026-08-05.md: "All 245 shipped model packs ... match one
    of the 248 keys by their folder number").

Anchor: the clip-12 script of m260stng (Stingmon, action 374) decodes op-for-op
and word-for-word onto the RAM-captured script in
docs/research/battle/captures/dna-2026-07-14/clip12-full-script.md -- all 94
operations, which `tests/lane-b/jogress-scripts.test.js` re-checks.

Usage:  .venv/bin/python3 tools/extract_jogress_scripts.py [--check]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from decode_action_scripts import decode_action_scripts, find_action_bin  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
RESIDENT = REPO / "web/assets/native/screens/resident.bin"
MODEL_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "pack/dw2003/fight/model"
OUT = REPO / "web/assets/data/jogress_scripts.json"
# smdldata's decoded records: model number -> the CD file that holds its geometry
# (`resource`), from tools/extract_smdldata.py.
PLACEMENT = REPO / "web/assets/battle/model_placement.json"
LBA_RS = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "rust/dw2003_exe_data/src/lba.rs"

# The resident PS-X EXE image's own load address (tools/build_native_screens.py
# RESIDENT_BASE).
RESIDENT_BASE = 0x80010000
# FIGHTSTG_F0x800980e4 :22132-22163 -- the 55 profile rows, stride 0x58.
PROFILE_BASE = 0x8003EF5C
PROFILE_STRIDE = 0x58
PROFILE_ROWS = 0x37
PROFILE_MODEL = 0x00
PROFILE_DNA_ACTION = 0x2A
PROFILE_DNA_PARTNER = 0x3D
PROFILE_SELF_INDEX = 0x55
# F0x8008f714 :12957-12992 -- the 18-byte technique records, 1-based.
TECHNIQUE_BASE = 0x80042BDC
TECHNIQUE_STRIDE = 0x12
TECHNIQUE_CLIP = 0x10
# The clip byte F0x8008f714 turns into presentation command 0x3A, the Jogress
# director. Every DNA action's own record carries it.
JOGRESS_CLIP = 12
# op2 sub-op 6 is the slot model spawn; sub-op 4 is the motion player (op4).
OP_MODEL_SPAWN = 2
OP_MOTION = 4
OP2_SUB_MODEL = 6
# op0 is the interpreter's wait-for-quiescence barrier (FIGHTSTG_F0x8008c590
# `.L0x8008c870`-`.L0x8008c8ec`), not an end of script: each clip-12 director is
# five segments separated by one. Only op255 ends a script.
BARRIER = "continue"


def _u16(image: bytes, addr: int) -> int:
    return struct.unpack_from("<H", image, addr - RESIDENT_BASE)[0]


def _u8(image: bytes, addr: int) -> int:
    return image[addr - RESIDENT_BASE]


def load_profiles(image: bytes) -> list[dict]:
    """The 55 species rows, exactly as the original's species getter walks them."""
    rows = []
    for index in range(PROFILE_ROWS):
        at = PROFILE_BASE + PROFILE_STRIDE * index
        rows.append({
            "profile": index + 1,
            "selfIndex": _u8(image, at + PROFILE_SELF_INDEX),
            "model": _u16(image, at + PROFILE_MODEL),
            "dnaAction": _u16(image, at + PROFILE_DNA_ACTION),
            "dnaPartner": _u8(image, at + PROFILE_DNA_PARTNER),
        })
    return rows


def action_clip(image: bytes, action: int) -> int | None:
    """The clip byte of one action's own technique record (0 for no record)."""
    if action < 1:
        return None
    return _u8(image, TECHNIQUE_BASE + TECHNIQUE_STRIDE * (action - 1) + TECHNIQUE_CLIP)


def model_folder(model: int) -> Path | None:
    """The pack folder whose numeric prefix is this model number, or None.

    The prefix is the model number for every shipped pack
    (docs/research/battle/smdldata-container-2026-08-05.md). Three of the 248
    smdldata keys -- 468, 469 and 470, the three Jogress-only results -- have no
    folder here, because nobody ever unpacked M468AGNM / M469GARM / M470AGRY out
    of the disc; `fused_pack` below names those from the disc's own file table and
    tools/extract_fight_model_pack.py carves them.
    """
    prefix = "m%03d" % model
    for name in sorted(os.listdir(MODEL_DIR)):
        if name.startswith(prefix):
            path = MODEL_DIR / name
            if path.is_dir():
                return path
    return None


def load_lba_names() -> dict[int, str]:
    """CD file id -> the disc's own name for it, from the decoded LBA table."""
    names = {}
    for line in LBA_RS.read_text().splitlines():
        m = re.match(r"pub const LBA_(\w+)_(BIN|PRO)_IDX: usize = (\d+);", line)
        if m:
            names[int(m.group(3))] = m.group(1)
    return names


def fused_pack(model: int) -> dict | None:
    """The CD file and pack folder that hold one model's battle geometry.

    smdldata's record for the model number gives the CD file id (`resource`, the
    high half of the record head every loader splits out), and the disc's own LBA
    name table gives that file's name. Both are reads, so the pack folder of a
    fused result is not typed in: 468 -> file 1958 -> M468AGNM -> m468agnm.
    """
    record = json.loads(PLACEMENT.read_text())["models"].get(str(model))
    if record is None:
        return None
    name = load_lba_names().get(record["resource"])
    if name is None:
        return None
    return {"resource": record["resource"], "folder": name.lower()}


def read_clip_script(model: int, clip: int) -> dict | None:
    """One clip of one model's own action bin, decoded with the shared decoder."""
    folder = model_folder(model)
    if folder is None:
        return None
    found = find_action_bin(str(folder), want_name=True)
    data, name = found
    if data is None:
        return None
    scripts = decode_action_scripts(data, BARRIER)
    if clip >= len(scripts) or scripts[clip] is None:
        return None
    script = scripts[clip]
    return {
        "model": model,
        "folder": folder.name,
        "file": name,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "clip": clip,
        "overrun": script["overrun"],
        "ops": script["ops"],
    }


def script_ops(script: dict, op: int) -> list[list[int]]:
    return [rec["words"] for rec in script["ops"] if rec["op"] == op]


def build() -> dict:
    image = RESIDENT.read_bytes()
    profiles = load_profiles(image)
    by_profile = {row["profile"]: row for row in profiles}

    actions: dict[str, dict] = {}
    problems: list[str] = []

    for row in profiles:
        action = row["dnaAction"]
        if action < 1 or row["dnaPartner"] == 0:
            continue
        clip = action_clip(image, action)
        if clip != JOGRESS_CLIP:
            problems.append(
                "profile %d action %d clip %r is not %d"
                % (row["profile"], action, clip, JOGRESS_CLIP))
            continue
        script = read_clip_script(row["model"], clip)
        if script is None:
            problems.append("model %d has no clip %d" % (row["model"], clip))
            continue
        if script["overrun"]:
            problems.append("model %d clip %d overruns the next script" % (row["model"], clip))
        models = [words[2] for words in script_ops(script, OP_MODEL_SPAWN)
                  if words[0] == OP2_SUB_MODEL]
        if len(models) < 2:
            problems.append("model %d clip %d loads %d model(s), expected 2"
                            % (row["model"], clip, len(models)))
            continue
        partner_row = by_profile.get(row["dnaPartner"])
        entry = actions.setdefault(str(action), {
            "actionId": action,
            "clip": clip,
            "fusedModel": None,
            "partnerModels": [],
            "members": [],
        })
        # The first slot spawn is the partner and the second the fused form; the
        # captured action-374 script (clip12-full-script.md segment 0,
        # "op2 [6,2,259] slot 2 := model 259 (ExVeemon)" / "op2 [6,3,254] slot 3
        # := model 254 (Paildramon)") fixes that order. That reading is then
        # re-asserted against the profile table for all twenty-two members: the
        # first spawn must be the model of this row's own +0x3D partner.
        fused_model = models[1]
        partner_model = models[0]
        if partner_row is None or partner_model != partner_row["model"]:
            problems.append(
                "action %s: model %d's script names model %d as the partner, not %r"
                % (action, row["model"], partner_model,
                   partner_row["model"] if partner_row else None))
        if partner_model == fused_model:
            problems.append("action %s: model %d names the same model twice"
                            % (action, row["model"]))
        entry["members"].append({
            "profile": row["profile"],
            "model": row["model"],
            "partnerProfile": row["dnaPartner"],
            "partnerModel": partner_model,
            "scriptModels": models,
            "scriptFusedModel": fused_model,
            "motions": script_ops(script, OP_MOTION),
            "pack": {
                "folder": script["folder"],
                "file": script["file"],
                "bytes": script["bytes"],
                "sha256": script["sha256"],
            },
            "ops": script["ops"],
        })

    for key, entry in actions.items():
        rows = entry["members"]
        fused = rows[0]["scriptFusedModel"]
        entry["fusedModel"] = fused
        entry["partnerModels"] = sorted({r["partnerModel"] for r in rows})
        entry["fusedPack"] = fused_pack(fused)
        if entry["fusedPack"] is None:
            problems.append("action %s: fused model %d has no smdldata resource"
                            % (key, fused))
        elif int(entry["fusedPack"]["folder"][1:4]) != fused:
            problems.append(
                "action %s: fused model %d resolves to pack folder %r"
                % (key, fused, entry["fusedPack"]["folder"]))
        member_models = {r["model"] for r in rows}
        for row in rows:
            if row["scriptFusedModel"] != fused:
                problems.append("action %s: model %d's script fuses to %d, not %d"
                                % (key, row["model"], row["scriptFusedModel"], fused))
            if row["partnerModel"] not in member_models:
                problems.append(
                    "action %s: model %d's script names partner model %d, which is "
                    "not one of this action's members"
                    % (key, row["model"], row["partnerModel"]))
            if fused in (row["model"], row["partnerModel"]):
                problems.append("action %s: fused model %d is one of its own parents"
                                % (key, fused))
    if problems:
        for line in problems:
            print("PROBLEM: %s" % line)
        raise SystemExit("%d cross-check failures" % len(problems))

    return {
        "_source": {
            "resident": str(RESIDENT.relative_to(REPO)),
            "models": str(MODEL_DIR),
            "profileTable": "0x%08X stride 0x%02X rows 0x%02X" % (
                PROFILE_BASE, PROFILE_STRIDE, PROFILE_ROWS),
            "techniqueTable": "0x%08X stride 0x%02X, byte +0x10 = clip" % (
                TECHNIQUE_BASE, TECHNIQUE_STRIDE),
            "decoder": "tools/decode_action_scripts.py, barrier=%r" % BARRIER,
            "anchor": "docs/research/battle/captures/dna-2026-07-14/clip12-full-script.md",
        },
        "actions": actions,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="fail if the extraction does not match the committed file")
    args = ap.parse_args()
    data = build()
    text = json.dumps(data, indent=1, sort_keys=True) + "\n"
    if args.check:
        if not OUT.exists():
            raise SystemExit("missing %s" % OUT)
        if OUT.read_text() != text:
            raise SystemExit("%s is stale; re-run tools/extract_jogress_scripts.py" % OUT)
        print("%s is up to date (%d actions)" % (OUT.name, len(data["actions"])))
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print("wrote %s: %d actions" % (OUT, len(data["actions"])))
    for key in sorted(data["actions"], key=int):
        e = data["actions"][key]
        print("  action %-4s clip %-3d fused model %-4d partner models %s"
              % (key, e["clip"], e["fusedModel"], e["partnerModels"]))


if __name__ == "__main__":
    main()