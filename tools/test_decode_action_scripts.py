import os
import struct
from decode_action_scripts import decode_action_scripts, find_action_bin, _operand_count

REF = os.path.expanduser('~/ddw3/pack/dw2003/fight/model/m373rena')
PRESENT = {0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 14, 15, 17}

def test_op2_mode4_frames_six_words():
    # The op2 mode-4 sub-handler F0x8008ba78 (.L0x00008dc8) reads three words and skips
    # one: its delay-slot `sw $v1,0x8c($s2)` sets IP = base+0x0c, six words past the mode
    # word. The 2026-10-06 fix changed this from 5 to 6; framing it as 5 desynced the
    # stream because the skipped word is often 0 and read back as an op0 terminator.
    b = bytearray(32)
    struct.pack_into('<h', b, 0, 2)     # op2 at offset 0 (p-2)
    struct.pack_into('<h', b, 2, 4)     # mode 4 at the first operand (p=2)
    assert _operand_count(b, 2) == 6
    struct.pack_into('<h', b, 2, 3)     # mode 3 absolute move: 2 + 4 = 6
    assert _operand_count(b, 2) == 6
    struct.pack_into('<h', b, 2, 1)     # mode 1: 2 words
    assert _operand_count(b, 2) == 2

def test_reference_scripts_decode_cleanly():
    clip = find_action_bin(REF)
    assert clip is not None, "no 0x48 action bin found for m373rena"
    scripts = decode_action_scripts(clip)
    assert len(scripts) == 18
    present = {i for i, s in enumerate(scripts) if s is not None}
    assert present == PRESENT, f"present {present} != {PRESENT}"
    for i in present:
        s = scripts[i]
        assert s["ops"], f"clip {i} empty"
        assert s["ops"][-1]["op"] in (0, 255), f"clip {i} no terminator"
        assert not s["overrun"], f"clip {i} overran its bound"

def test_attack_and_signature_play_motion():
    scripts = decode_action_scripts(find_action_bin(REF))
    m5 = [o["words"][1] for o in scripts[5]["ops"] if o["op"] == 4 and len(o["words"]) >= 2]
    m11 = [o["words"][1] for o in scripts[11]["ops"] if o["op"] == 4 and len(o["words"]) >= 2]
    assert 56 in m5, f"clip 5 motions {m5} missing 56"
    assert 55 in m11, f"clip 11 motions {m11} missing 55"

if __name__ == "__main__":
    test_reference_scripts_decode_cleanly()
    test_attack_and_signature_play_motion()
    print("ok")
