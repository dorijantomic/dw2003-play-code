#!/usr/bin/env python3
"""Decode the DW2003 fight battle-action scripts (the 0x48-magic bin).

Each model's 0x48 bin holds 18 bytecode scripts (one per battle action): an
18 x u32 offset header (offset 0 = script absent) followed by per-script opcode
streams. Structured port of skeletal-lab tools/disasm_action_scripts.py; the
opcode operand counts are read 1:1 from interpreter FIGHTSTG_F0x8008c590's
handlers. Self-validating: every present script must reach a terminator
(op 0/255) without overrunning the next script's header offset.
"""
import glob
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_fight_anim import is_offset_table  # noqa: E402

# Known opcodes per FIGHTSTG_F0x8008c590 handlers. Any op outside this set is flagged
# "unknown": True on its record. The dispatcher (@.L0x8008c714) handles 0,1,2,3,4,5,6,7,
# 8,9,10,11,255; ops 12..254 are silent no-ops (no handler, 0 operands).
# ⚠️ op7 (spawn/free, handler F0x8008c514) was missing here — it is the sole cause of the
# residual "unknown blob" scripts: read as 1 word (the unknown fallback) instead of its real
# 2 operands, it desynced the stream and the trailing data read back as garbage opcodes
# (30/193/negatives). DATA: op7 was the FIRST unknown in all 13 residual scripts.
_KNOWN_OPS = frozenset({0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 255})


def _i16(d, p):
    return struct.unpack_from('<h', d, p)[0]


def _operand_count(d, p):
    """Words consumed AFTER the opcode word. p = first operand word (opcode at p-2)."""
    op = _i16(d, p - 2)
    if op in (0, 255):
        return 0
    if op in (1, 8, 9, 11):
        return 1
    if op == 7:
        # spawn/free, handler F0x8008c514: reads op[0] (type) + op[1] (arg), IP=p+4 (2 words),
        # for both the spawn (op[0]==0 -> F0x800930c0) and free (op[0]==1 -> F0x80093088) paths.
        return 2
    if op == 10:
        return 2
    if op == 3:
        return 2 if _i16(d, p) == 1 else 5
    if op == 4:
        return 2 if _i16(d, p) == 1 else 4
    if op == 5:
        sub = _i16(d, p + 2)
        if sub == 0:
            return 3
        if sub == 1:
            return 16
        return 2
    if op == 6:
        return 2 if _i16(d, p) == 1 else 8
    if op == 2:
        s1 = _i16(d, p)
        s3read = s1 in (0, 5, 6) or s1 >= 10
        base = 2 + (1 if s3read else 0)
        # Mode 4 (asm F0x8008ba78 / .L0x00008dc8): READS three words (x@p+2, y@p+4, z@p+6
        # relative to the operand base p+2) but ADVANCES IP by four more words — it skips one
        # (the delay-slot `sw $v1,0x8c($s2)` sets IP = base+0x0c, i.e. six words past the mode
        # word). Framing it as 3 desynced the stream (defect fixed 2026-10-06).
        extra = {0: 0, 1: 0, 2: 0, 3: 4, 4: 4, 6: 0, 7: 1, 8: 1, 9: 0}.get(s1, 0)
        if s1 == 5:
            # s3 is at p+4 (s1@p, a1@p+2, s3@p+4) per op2 handler F0x8008b7f4:8890-8894;
            # the s3==4 case consumes one extra word. (Was p+2 — a one-word framing bug that
            # misread ~182 scripts incl. the reference basic-attack. Disasm+data confirmed.)
            extra = 1 if _i16(d, p + 4) == 4 else 0
        if s1 >= 10:
            extra = 0
        return base + extra
    return 1  # unknown opcode — consume one word and continue


# op0 and op255 share ONE handler (FIGHTSTG_F0x8008c590 `.L0x8008c870`-.L0x8008c8ec`):
# a wait-for-quiescence barrier that rewinds its cursor 2 bytes while anything is
# still moving and, once idle, signals the owning action object and continues PAST
# the op. So op0 is NOT an end-of-script marker — only op255 is. The default here
# stops at either (the behaviour every shipped model build was generated with);
# `barrier="continue"` walks the whole script, which is what the DNA/Jogress clip-12
# directors need (each is five segments separated by op0).
STOP_OPS = frozenset({0, 255})


def _decode_script(d, start, bound, barrier="stop"):
    ops = []
    p = start
    guard = 0
    # guard < 200 caps ops/script; hitting it truncates without setting overrun (deliberate safety bound).
    limit = 400 if barrier == "continue" else 200
    stop = STOP_OPS if barrier == "stop" else frozenset({255})
    while p < bound and guard < limit:
        guard += 1
        op = _i16(d, p)
        n = _operand_count(d, p + 2)
        words = [_i16(d, p + 2 + 2 * k) for k in range(n)]
        rec = {"op": op, "words": words}
        if op not in _KNOWN_OPS:
            rec["unknown"] = True
        ops.append(rec)
        p = p + 2 + 2 * n
        if op in stop:
            break
    return {"ops": ops, "overrun": p > bound}


def decode_action_scripts(clip_bytes, barrier="stop"):
    """clip_bytes = the 0x48-magic bin. Returns list[18] of {ops, overrun} | None."""
    d = clip_bytes
    offs = list(struct.unpack_from('<18I', d, 0))
    present = sorted({o for o in offs if o} | {len(d)})

    def bound(o):
        return min((x for x in present if x > o), default=len(d))

    return [None if o == 0 else _decode_script(d, o, bound(o), barrier) for o in offs]


def _bin_sort_key(x):
    """Sort key for .bin filenames: numeric stems first (ascending), then non-numeric by name."""
    stem = os.path.basename(x)[:-4]
    try:
        return (0, int(stem))
    except ValueError:
        return (1, stem)


def find_action_bin(folder_path, want_name=False):
    """Return the bytes of the model folder's 0x48-magic action bin, or None.

    The magic is the first entry of the 18 x u32 offset header, so it is not
    unique on its own: m469garm's bone table (the part directory smdldata's +0x00
    member names) begins with the value 72 as well. `is_offset_table` keeps that
    one out -- an 18-entry offset table into its own bin cannot decrease.

    want_name=True returns (bytes, file name) instead of just the bytes.
    """
    for fp in sorted(glob.glob(os.path.join(folder_path, '*.bin')), key=_bin_sort_key):
        with open(fp, 'rb') as fh:
            d = fh.read()
        if len(d) >= 4 and struct.unpack_from('<I', d, 0)[0] == 0x48 and is_offset_table(d):
            return (d, os.path.basename(fp)) if want_name else d
    return (None, None) if want_name else None
