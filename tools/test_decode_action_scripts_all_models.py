import glob
import os
from decode_action_scripts import decode_action_scripts, find_action_bin

MODELS = os.path.expanduser('~/ddw3/pack/dw2003/fight/model')

def test_all_models_decode_without_overrun():
    folders = sorted(p for p in glob.glob(MODELS + '/*') if os.path.isdir(p))
    assert len(folders) >= 200, f"only {len(folders)} model folders"
    checked = 0
    unknown_script_count = 0  # scripts containing any unknown-opcode record
    for f in folders:
        clip = find_action_bin(f)
        if clip is None:
            continue  # a few models may lack a 0x48 bin — not a structural requirement
        scripts = decode_action_scripts(clip)
        assert len(scripts) == 18, f"{os.path.basename(f)}: {len(scripts)} scripts"
        for i, s in enumerate(scripts):
            if s is None:
                continue
            assert s["ops"], f"{os.path.basename(f)} clip {i} empty"
            assert s["ops"][-1]["op"] in (0, 255), f"{os.path.basename(f)} clip {i} no terminator"
            assert not s["overrun"], f"{os.path.basename(f)} clip {i} overran"
            if any(rec.get("unknown") for rec in s["ops"]):
                unknown_script_count += 1
        checked += 1
    assert checked >= 200, f"only {checked} models had an action bin"

    # ZERO unknown-opcode scripts across all 245 (Phase C / Task 4). The former "~13 inline
    # data blob" residual was NOT a blob format — it was op7 (spawn/free, handler F0x8008c514)
    # missing from _KNOWN_OPS / _operand_count: read as 1 word (the unknown fallback) instead
    # of its real 2 operands, it desynced the stream so trailing data read back as garbage
    # opcodes. op7 was the FIRST unknown in all 13. With op7=2 added, the corpus is fully clean.
    # A regression (drop op7, or reintroduce the op2 p+2 bug) would push this back up immediately.
    assert unknown_script_count == 0, (
        f"unknown-opcode script count {unknown_script_count} != 0 — "
        f"op7/op2 arity regression or a new unmapped opcode"
    )

    # Concrete regression guard: the reference basic-attack must decode cleanly (0 unknown ops).
    agumon_folder = os.path.join(MODELS, 'm003agum')
    agumon_clip = find_action_bin(agumon_folder)
    assert agumon_clip is not None, "m003agum action bin not found"
    agumon_scripts = decode_action_scripts(agumon_clip)
    clip5 = agumon_scripts[5]
    assert clip5 is not None, "m003agum clip 5 is absent"
    agumon_unknowns = [rec for rec in clip5["ops"] if rec.get("unknown")]
    assert not agumon_unknowns, (
        f"m003agum clip 5 has unknown-opcode records (op2 arity regression?): {agumon_unknowns}"
    )

    # Also guard Renamon clip 5 (second reference).
    rena_folder = os.path.join(MODELS, 'm373rena')
    rena_clip = find_action_bin(rena_folder)
    assert rena_clip is not None, "m373rena action bin not found"
    rena_scripts = decode_action_scripts(rena_clip)
    rena_clip5 = rena_scripts[5]
    assert rena_clip5 is not None, "m373rena clip 5 is absent"
    rena_unknowns = [rec for rec in rena_clip5["ops"] if rec.get("unknown")]
    assert not rena_unknowns, (
        f"m373rena clip 5 has unknown-opcode records (op2 arity regression?): {rena_unknowns}"
    )

    print(f"unknown-opcode scripts: {unknown_script_count} (target 0 after the op7=2 arity fix)")

if __name__ == "__main__":
    test_all_models_decode_without_overrun()
    print("ok")
