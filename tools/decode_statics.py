#!/usr/bin/env python3
"""Function pointers the shipped image already holds, before any code runs.

Half of this game's dispatch never passes through a store instruction. An
overlay materialises a fixed address in the resident program and loads a handler
out of it:

    addiu $s1, $v0, -0x4830      # $s1 = 0x8004B7D0
    lw    $v1, 0x408($s1)        # the handler cell 0x8004BBD8
    jalr  $v1

823 call sites read that one cell, and **nothing anywhere writes it**. The word
is placed by the linker. So tools/decode_dispatch.py was looking for the wrong
half of the pair: it matched call sites against `sw` instructions, and the
resident service table is not built by instructions at all.

**The extraction already existed.** tools/build_recovered_inventory.py reads
those cells out of the decompilation's data segment and writes them to
recovered/ddw3/function-inventory.json at authority 4, each bound to the source
file, line and sha256. This module reads that artifact rather than parsing the
same file a second time -- writing a second parser was the first attempt here,
and it rediscovered 171 of the 171 cells the inventory already had.

It adds one thing the inventory leaves undone: a cell initialised from a bare
symbol (`ptr::addr_of!(f5)`) is recorded with a name and no address. The address
is in the section header that places it -- `f5.s` writes
`.section "section_f5.0x8001355c"` above `.global f5` and states it nowhere else
-- so 12 more cells resolve, among them `rand_u16`.

Two limits are real and are not defects:

  * The cells are `static mut`. This says what the word holds when the program
    starts, not what it holds forever. A call site whose slot also has a code
    store gets both answers and stays unresolved, which is the same tie rule
    phase 3 already uses.
  * The inventory's overlay coverage is partial. The overlays' data segments are
    absent from the assembly corpus -- `fieldstg.s` stops at `# End of code` --
    so the only overlay cells here are the ones the `dw2003_pro_*` crates
    happen to carry as address-shaped `u32` arrays. That is 34 cells, and it
    does include the two largest: 0x8009B704 and 0x8009B714.

Usage:
  tools/decode_statics.py            # what was read
  tools/decode_statics.py --list     # every function-pointer cell
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "recovered/ddw3/function-inventory.json"
EXE_ASM = Path.home() / "ddw3/asm/dw2003/exe"

# `.section "section_f5.0x8001355c"` above `.global f5`
SECTION = re.compile(r'^\.section\s+"[^"]*\.0x(8[0-9a-fA-F]{7})"')
GLOBAL = re.compile(r"^\.global\s+(\w+)$")
DATA_NAME = re.compile(r"^D0x[0-9a-fA-F]{8}$")
CELL_NAME = re.compile(r"^D0x([0-9a-fA-F]{8})$")


def _symbol_addresses(asm: Path | None = None) -> dict[str, int]:
    """Bare exe symbols such as `f5`, from the section header that places them.

    `D0x...` names are refused. `fns.s` declares its data tables `.global` too,
    so accepting every exported symbol admitted 50 pointers-to-data as method
    cells -- one data table address appeared in twelve of them. The `D`/`F`
    prefix is the decompilation's own statement of which is which.
    """
    found: dict[str, int] = {}
    asm = asm if asm is not None else EXE_ASM
    if not asm.is_dir():
        return found
    for path in sorted(asm.glob("*.s")):
        address: int | None = None
        for line in path.read_text(errors="replace").splitlines():
            section = SECTION.match(line.strip())
            if section:
                address = int(section.group(1), 16)
                continue
            symbol = GLOBAL.match(line.strip())
            if symbol and address is not None and not DATA_NAME.match(symbol.group(1)):
                found.setdefault(symbol.group(1), address)
    return found


def _address(value) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.startswith("0x"):
        return int(value, 16)
    return None


def pointer_cells(inventory: Path | None = None,
                  asm: Path | None = None) -> dict[int, dict]:
    """Every word of the shipped data segment that holds a function address.

    Keyed by the word's own RAM address, because that is the identity a call
    site reads: `lw $v1, 0x408($s1)` names 0x8004BBD8 exactly, and only a cell
    at that same address can answer it.
    """
    path = inventory if inventory is not None else INVENTORY
    if not path.is_file():
        return {}
    data = json.loads(path.read_text())
    symbols = _symbol_addresses(asm)
    cells: dict[int, dict] = {}

    for name, row in data.get("global_function_pointers", {}).items():
        found = CELL_NAME.match(name)
        if not found:
            continue
        symbol = row.get("target_symbol")
        target = _address(row.get("target_address"))
        if target is None and symbol:
            target = symbols.get(symbol)
        cells[int(found.group(1), 16)] = {
            "target": target, "symbol": symbol,
            "source": f"{row.get('source')}:{row.get('source_line')}",
            "scope": "resident"}

    # An overlay's cells only exist while that overlay is loaded, and two
    # overlays share a load address, so a cell is qualified by its owner.
    for rows in data.get("overlay_function_pointers", {}).values():
        for row in rows:
            at = _address(row.get("cell_address"))
            target = _address(row.get("target_address"))
            if at is None or target is None:
                continue
            cells.setdefault(at, {
                "target": target, "symbol": row.get("target"),
                "source": f"{row.get('source')}:{row.get('source_line')}",
                "scope": row.get("owner_module") or "overlay"})
    return cells


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()

    cells = pointer_cells()
    if not cells:
        print(f"no function-pointer cells; {INVENTORY} is missing or empty")
        return 1
    named = sum(1 for cell in cells.values() if cell["target"] is not None)
    overlay = sum(1 for cell in cells.values() if cell["scope"] != "resident")
    if args.list:
        for at in sorted(cells):
            cell = cells[at]
            target = (f"0x{cell['target']:08X}" if cell["target"] is not None
                      else f"{cell['symbol']} (no address)")
            print(f"0x{at:08X}  {target:24s} {cell['scope']:16s} {cell['source']}")
        return 0
    print(f"function-pointer cells in the shipped data: {len(cells)}")
    print(f"  resolved to an address: {named}")
    print(f"  named only:             {len(cells) - named}")
    print(f"  owned by one overlay:   {overlay}")
    print(f"  read from {INVENTORY.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
