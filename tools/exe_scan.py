#!/usr/bin/env python3
"""overlay_scan.py, but for the RESIDENT EXE (load base 0x80010000).

Extracts the raw PS-X EXE from ~/vm-spike/dw2003.bin (sector 24, 2352-byte
sectors, user data at +24 -- recipe from docs/research/infra/rig-reference.md
"Recovering true immediates") and reuses overlay_scan's const-tracking/disasm
subcommands on it, plus a `tags` subcommand: the branch-tracked MEFT type-tag
dispatch search that fns.s' mnemonic-only disasm made impossible
(docs/research/field/meft-parser-search-log.md).

Run: ~/.local/bin/uv run --with capstone python3 tools/exe_scan.py <cmd> ...

Subcommands (all addresses are RAM hex; EXE base 0x80010000):
  extract                     write ~/vm-spike/main_exe.bin (cached)
  refs  <ram_addr>            code/data references to <ram_addr>
  dis   <ram_start> <ram_end> capstone disasm
  fn    <ram_start>           disasm to the next jr $ra
  words <ram_start> <ram_end> raw word dump
  writes <base_ram> <lo>      sw stores at base+off, lo<=off<=0x800
  tags                        clusters of >=3 distinct MEFT type-tag compares
"""
import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import overlay_scan as ovs

DISC = Path.home() / "vm-spike/dw2003.bin"
EXE = Path.home() / "vm-spike/main_exe.bin"
BASE = 0x80010000
SECTOR, USER_OFF, USER_LEN = 2352, 24, 2048

# The 15 MEFT pack sub-entry type tags (docs/research/field/meft-pack-tag-census.json)
TAGS = {0x3, 0x4, 0x7, 0x8, 0xC, 0x10, 0x11, 0x12, 0x13, 0x15, 0x17, 0x18, 0x19, 0x1B, 0x21}


def extract() -> bytes:
    if EXE.exists():
        return EXE.read_bytes()
    with DISC.open("rb") as disc:
        disc.seek(24 * SECTOR + USER_OFF)
        hdr = disc.read(USER_LEN)
        assert hdr[:8] == b"PS-X EXE", hdr[:8]
        t_addr, t_size = struct.unpack_from("<II", hdr, 0x18)
        assert t_addr == BASE, hex(t_addr)
        out, s = bytearray(), 25
        while len(out) < t_size:
            disc.seek(s * SECTOR + USER_OFF)
            out += disc.read(USER_LEN)
            s += 1
    EXE.write_bytes(out[:t_size])
    print(f"extracted {t_size:#x} bytes -> {EXE}", file=sys.stderr)
    return bytes(out[:t_size])


def load_words_exe(_path, _base=None) -> dict[int, int]:
    """Match overlay_scan.load_words(path, base)'s callback contract."""
    data = extract()
    return {o: struct.unpack_from("<I", data, o)[0] for o in range(0, len(data) - 3, 4)}


def cmd_tags(words) -> None:
    """li rX,<tag> ; beq/bne against rX -- clusters = a compiled tag-dispatch chain."""
    hits = []  # (file_off, tag)
    for off, w, regs in ovs.track_consts(sorted(words.items())):
        if (w >> 26) in (0x04, 0x05):  # beq/bne
            rs, rt = (w >> 21) & 31, (w >> 16) & 31
            if rs == 0 or rt == 0:
                continue  # compare-to-zero, not a tag compare
            vs, vt = regs.get(rs), regs.get(rt)
            for v in (vs, vt):
                if v in TAGS:
                    hits.append((off, v))
    hits.sort()
    reported = set()
    for i, (off, _tag) in enumerate(hits):
        window = {t for o, t in hits if off <= o < off + 0x180}
        if len(window) >= 3:
            key = off >> 9
            if key in reported:
                continue
            reported.add(key)
            print(f"cluster at file 0x{off:06x} (RAM 0x{BASE + off:08x}): "
                  f"tags {sorted(hex(t) for t in window)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["extract", "refs", "dis", "fn", "words", "writes", "tags"])
    ap.add_argument("start", nargs="?")
    ap.add_argument("end", nargs="?")
    ap.add_argument("--stride", type=int, default=16)
    args = ap.parse_args()
    ovs.load_words = load_words_exe  # every ovs.cmd_* reads through this
    if args.cmd == "extract":
        extract()
        return
    if args.cmd == "tags":
        cmd_tags(load_words_exe(None))
        return

    def ram_to_off(s: str) -> str:
        v = int(s, 16)
        return f"0x{v - BASE:x}" if v >= BASE else s

    if args.cmd == "refs":
        args.addr = args.start  # target stays a RAM address
    elif args.cmd == "writes":
        args.base_ram = args.start  # RAM base as-is
        args.lo, args.hi = args.end or "0", "0x800"
    else:  # dis / fn / words take file offsets internally
        args.start = ram_to_off(args.start)
        if args.end:
            args.end = ram_to_off(args.end)
    getattr(ovs, "cmd_" + args.cmd)(EXE, BASE, args)


if __name__ == "__main__":
    main()
