#!/usr/bin/env python3
"""Extract embedded text and pointer tables from a `.word`-only assembly region.

Several DDW3 overlays disassemble to pure `.word` listings because they are data,
not code (`pro/smdldata.s`), or because a data island sits inside a code overlay
(`pro/wfightts.s`, whose developer menu strings follow its state-pointer table).
The instruction comments the disassembler emits for those words are noise.

This reads the `.L0x...: .word 0x...` rows of an assembly file, rebuilds the
little-endian byte image of the region, and reports:

  strings   NUL-terminated Shift-JIS / ASCII runs, with their file offsets
  pointers  words that fall inside a plausible RAM pointer range
  words     the raw word image, for a bounded offset range

Offsets are file offsets within the overlay image, matching the `.L0x` labels;
add the overlay's load base to get a RAM address.

Usage:
  tools/extract_asm_data_strings.py strings <file.s> [--start OFF] [--end OFF]
                                    [--min-len N] [--encoding shift_jis]
  tools/extract_asm_data_strings.py pointers <file.s> [--base 0x80000000]
                                    [--limit 0x80200000] [--start OFF] [--end OFF]
  tools/extract_asm_data_strings.py words <file.s> --start OFF --end OFF
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

WORD_ROW = re.compile(r"^\.L0x([0-9a-fA-F]{8}):\s+\.word\s+(0x[0-9a-fA-F]+|\d+|\w+)")


def read_word_image(path: Path) -> tuple[bytearray, dict[int, int]]:
    """Return (byte image, {offset: word}) for every `.word` row in the file."""
    words: dict[int, int] = {}
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            match = WORD_ROW.match(line)
            if not match:
                continue
            offset = int(match.group(1), 16)
            raw = match.group(2)
            if raw.startswith("0x"):
                value = int(raw, 16)
            elif raw.isdigit():
                value = int(raw)
            else:
                # A symbolic operand such as `D0x80082cb0`; take its address.
                symbolic = re.search(r"0x([0-9a-fA-F]+)", raw)
                if not symbolic:
                    continue
                value = int(symbolic.group(1), 16)
            words[offset] = value & 0xFFFFFFFF
    if not words:
        return bytearray(), {}
    image = bytearray(max(words) + 4)
    for offset, value in words.items():
        image[offset : offset + 4] = value.to_bytes(4, "little")
    return image, words


def decode_run(run: bytes, encoding: str) -> str | None:
    try:
        text = run.decode(encoding)
    except UnicodeDecodeError:
        return None
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in text):
        return None
    return text


def cmd_strings(args: argparse.Namespace) -> int:
    image, _ = read_word_image(Path(args.file))
    if not image:
        print("no .word rows in file", file=sys.stderr)
        return 1
    end = min(args.end if args.end is not None else len(image), len(image))
    offset = args.start
    run_start: int | None = None
    run = bytearray()
    hits = 0
    while offset <= end:
        byte = image[offset] if offset < end else 0
        if byte == 0:
            if run and len(run) >= args.min_len:
                text = decode_run(bytes(run), args.encoding)
                if text is not None:
                    print(f"0x{run_start:06x}  {text}")
                    hits += 1
            run.clear()
            run_start = None
        else:
            if run_start is None:
                run_start = offset
            run.append(byte)
        offset += 1
    print(f"-- {hits} strings, region 0x{args.start:06x}..0x{end:06x}, {args.encoding}")
    return 0


def cmd_pointers(args: argparse.Namespace) -> int:
    _, words = read_word_image(Path(args.file))
    if not words:
        print("no .word rows in file", file=sys.stderr)
        return 1
    end = args.end if args.end is not None else max(words) + 4
    hits = 0
    for offset in sorted(words):
        if offset < args.start or offset >= end:
            continue
        value = words[offset]
        if args.base <= value < args.limit:
            print(f"0x{offset:06x}  0x{value:08x}")
            hits += 1
    print(f"-- {hits} pointers in 0x{args.base:08x}..0x{args.limit:08x}")
    return 0


def cmd_words(args: argparse.Namespace) -> int:
    _, words = read_word_image(Path(args.file))
    if not words:
        print("no .word rows in file", file=sys.stderr)
        return 1
    for offset in sorted(words):
        if args.start <= offset < args.end:
            value = words[offset]
            octets = " ".join(f"{b:02x}" for b in value.to_bytes(4, "little"))
            print(f"0x{offset:06x}  0x{value:08x}  {octets}")
    return 0


def cmd_tables(args: argparse.Namespace) -> int:
    """Resolve runs of string pointers into the labels they point at.

    A menu overlay stores its lists as consecutive words pointing into its own
    string image. Given the load base, this walks the word image, groups
    consecutive in-range pointers into runs, and prints each run's slot index
    beside the decoded label, which is what a menu list actually looks like.
    """
    image, words = read_word_image(Path(args.file))
    if not words:
        print("no .word rows in file", file=sys.stderr)
        return 1

    def label_at(offset: int) -> str | None:
        if offset < 0 or offset >= len(image):
            return None
        end = image.find(b"\x00", offset)
        if end < 0:
            end = len(image)
        return decode_run(bytes(image[offset:end]), args.encoding)

    runs: list[list[tuple[int, int, str]]] = []
    current: list[tuple[int, int, str]] = []
    for offset in sorted(words):
        value = words[offset]
        text = label_at(value - args.base) if value >= args.base else None
        if text is None or not text.strip():
            if len(current) >= args.min_run:
                runs.append(current)
            current = []
            continue
        current.append((offset, value, text))
    if len(current) >= args.min_run:
        runs.append(current)

    for run in runs:
        start = run[0][0]
        print(f"-- table at 0x{start:06x} (RAM 0x{start + args.base:08x}), {len(run)} entries")
        for slot, (offset, value, text) in enumerate(run):
            print(f"   [{slot:3d}] 0x{offset:06x} -> 0x{value:08x}  {text}")
    print(f"-- {len(runs)} pointer tables, base 0x{args.base:08x}")
    return 0


def auto_int(text: str) -> int:
    return int(text, 0)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    strings = sub.add_parser("strings", help="NUL-terminated text runs")
    strings.add_argument("file")
    strings.add_argument("--start", type=auto_int, default=0)
    strings.add_argument("--end", type=auto_int, default=None)
    strings.add_argument("--min-len", type=auto_int, default=2)
    strings.add_argument("--encoding", default="shift_jis")
    strings.set_defaults(func=cmd_strings)

    pointers = sub.add_parser("pointers", help="words inside a RAM pointer range")
    pointers.add_argument("file")
    pointers.add_argument("--base", type=auto_int, default=0x80000000)
    pointers.add_argument("--limit", type=auto_int, default=0x80200000)
    pointers.add_argument("--start", type=auto_int, default=0)
    pointers.add_argument("--end", type=auto_int, default=None)
    pointers.set_defaults(func=cmd_pointers)

    tables = sub.add_parser("tables", help="resolve pointer runs into labels")
    tables.add_argument("file")
    tables.add_argument("--base", type=auto_int, required=True,
                        help="RAM address the file's offset 0 loads at")
    tables.add_argument("--min-run", type=auto_int, default=3)
    tables.add_argument("--encoding", default="shift_jis")
    tables.set_defaults(func=cmd_tables)

    raw = sub.add_parser("words", help="raw word image for an offset range")
    raw.add_argument("file")
    raw.add_argument("--start", type=auto_int, required=True)
    raw.add_argument("--end", type=auto_int, required=True)
    raw.set_defaults(func=cmd_words)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
