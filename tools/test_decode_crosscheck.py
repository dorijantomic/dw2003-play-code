"""Cross-check the analyzer against the records the model path produced.

Those 83 records cost real money and are the only independent opinion on this
code. They are not authority -- the assembly is -- but agreement on a mechanical
fact is evidence the analyzer works, and a disagreement is worth a human look.
Running this costs no tokens: the records are already on disk.

Skips itself when the records are absent, so a fresh clone still passes.
"""

from __future__ import annotations

import json
import re
import sqlite3
import unittest
from pathlib import Path

from tools import decode_loop
from tools.mips_decode import decode_function

RECORDS = decode_loop.ROOT / ".dw3-research/decode-loop"
HEX = re.compile(r"0x([0-9a-fA-F]{6,8})")
# Only addresses that actually APPEAR in the function's assembly are compared.
# Measured 2026-08-10 over the 45 comparable records: the model named an address
# absent from the code in 18 of them (40%), so counting those as analyzer misses
# would let the model's inventions hide real defects. Of what remains, 11 (24%)
# are genuine analyzer gaps. Lower this number, never raise it.
TOLERATED = 0.25


def model_addresses(record: dict) -> set[int]:
    """Every address either model pass named in its `tables` list."""
    found: set[int] = set()
    for key in ("pass_a", "pass_b"):
        for table in (record.get(key) or {}).get("tables") or []:
            if isinstance(table, dict):
                hit = HEX.search(str(table.get("address", "")))
                if hit:
                    found.add(int(hit.group(1), 16))
    return found


class CrossCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not RECORDS.is_dir() or not any(RECORDS.glob("*.json")):
            raise unittest.SkipTest("no model records on disk")
        conn = sqlite3.connect(f"file:{decode_loop.DB}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            cls.sources = decode_loop.load_lines(conn)
        finally:
            conn.close()

    def test_analyzer_finds_the_addresses_the_model_named(self) -> None:
        checked = disagreed = 0
        report: list[str] = []
        for path in sorted(RECORDS.glob("*.json")):
            record = json.loads(path.read_text())
            if record.get("status") not in ("agreed", "disputed"):
                continue
            wanted = model_addresses(record)
            if not wanted:
                continue
            try:
                lines = decode_loop.function_body(
                    self.sources, record["overlay"], record["address"])
            except KeyError:
                continue
            proven = decode_function(lines)["proven"]
            ours = {row["address"] for row in
                    proven["globals"] + proven["hardware"] + proven["fields"]
                    if row.get("address")}
            ours |= {t["address"] for t in proven["tables"]}
            for call in proven["calls"]:
                for value in call["arguments"].values():
                    if value.startswith("global(0x"):
                        ours.add(int(value[9:17], 16))
            checked += 1
            text = " ".join(lines).lower()
            missing = {a for a in wanted - ours if f"{a:08x}" in text}
            if missing:
                disagreed += 1
                report.append(f"0x{record['address']:08x} {record['overlay']}: "
                              + ", ".join(f"0x{a:08X}" for a in sorted(missing)))
        self.assertGreater(checked, 0, "no comparable records found")
        ratio = disagreed / checked
        self.assertLessEqual(
            ratio, TOLERATED,
            f"{disagreed}/{checked} records disagree:\n" + "\n".join(report[:15]))


if __name__ == "__main__":
    unittest.main()
