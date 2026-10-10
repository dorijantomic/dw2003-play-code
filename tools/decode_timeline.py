"""Port of FIGHTSTG_F0x80083a54 — builds the per-position frame tables from bin-0."""
import struct


def decode_timeline(bin0_bytes):
    b = bin0_bytes
    def u16(o): return struct.unpack_from("<H", b, o)[0]
    def i16(o): return struct.unpack_from("<h", b, o)[0]
    def u32(o): return struct.unpack_from("<I", b, o)[0]

    first = u32(0)
    ptbl = [u32(4 * i) for i in range(first // 4)]

    def build(p):
        entries = []
        t5 = p
        if i16(t5) == 0x7fff:
            return entries
        while True:
            cnt = i16(t5 + 2)
            if cnt == 0:
                entries.append({
                    "value": u16(t5 + 4),
                    "loop_target": u16(t5 + 6),
                    "aux": None,
                })
                break
            rec6 = i16(t5 + 6)
            if rec6 == 0:  # loop-segment
                t3 = i16(t5 + 0xC)
                t4 = 0xffff if i16(t5) == 0 else u16(t5 - 2)
                for k in range(1, cnt + 1):
                    v = 0x8000 | ((k << 12) // (cnt + 1))
                    entries.append({
                        "value": v & 0xffff,
                        "loop_target": t3 & 0xffff,
                        "aux": t4,
                    })
            else:  # ramp
                base = u16(t5 + 4)
                for k in range(cnt):
                    entries.append({
                        "value": (base + k) & 0xffff,
                        "loop_target": 0,
                        "aux": None,
                    })
            t5 += 8
            if i16(t5) == 0x7fff:
                break
        return entries

    positions = []
    for p in ptbl:
        if p == 0 or p >= len(b):
            positions.append({"table": []})
        else:
            positions.append({"table": build(p)})
    return positions
