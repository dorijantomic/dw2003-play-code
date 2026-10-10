#!/usr/bin/env python3
"""Shared instruction-word extraction for the DDW3 original-code corpus.

Why this exists
---------------
Every masked-body tool in this repo (the signature database, the family
matcher, the census) needs one thing: the *encoded words* of a function body.
Three tools each re-parsed the assembly for them, and each one only recognised
a single line shape, so 27 of the 319 modules came back **unreadable** -- not
"mismatched", just no words found -- and the biggest unnamed mass in the game
(``pro/fightstg``, 237 functions) was silently excluded.

The words are absent for three unrelated reasons, and each needs its own fix:

1. **A second line shape.** Half the corpus is rendered decoded,
   ``addiu $sp, -0x20   # .word 0x27bdffe0``; the other half is rendered raw,
   ``.word 0x27bdffe0   # addiu $sp, -0x20``. A parser that only reads
   ``# .word`` sees the raw modules as empty. Both shapes carry the same
   encoding; only its position in the line differs.

2. **A mnemonic-only disassembly.** Some overlays (``pro/fightstg``,
   ``pro/stdwtitl``, ``pro/shocktst``, ``pro/wfightts``) were disassembled to
   mnemonics *without* an encoding column at all: ``.L0x00000490: move_ $a0,
   $v0``. Their code bytes are simply not in the text.

3. **The main executable's own layout.** ``exe/fns.s`` is mnemonic-only and its
   data rows are symbolic (``.word F0x80085390``), so it has no hex word either.

The fix for 2 and 3 is a **real binary**, and one already exists in the tree for
every overlay that matters: ``web/assets/native/screens/<module>.bin`` is the
overlay's true ``.PRO`` image, read from the disc by
``tools/build_native_screens.py`` using the resident EXE's own LBA/length
tables. Every data word in ``fightstg``/``stdwtitl``/``shocktst``/``wfightts``
matches that image at 100% (verified in ``tools/test_encoded_words.py``), so its
code words are ground truth too. For the executable the words come from the
pinned PCSX-Redux RAM dump, as before.

So a module's body is read from, in order: its own word column (either shape),
then its disc image, then the pinned RAM dump. Only a module with none of the
three stays unreadable, and that is now reported with *which* three were
searched.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAM_DUMP = Path("/home/dorij/.config/pcsx-redux/SLES03936_mem_wram.bin")
RAM_BASE = 0x80000000
DUMP_PINNED_SHA256 = "671e88b8ffb4b9a646579e5abf84798ec431a43a4a0d01e7b00814271d501bc3"

NATIVE_SCREENS = ROOT / "web/assets/native/screens"
NATIVE_MANIFEST = NATIVE_SCREENS / "manifest.json"

# A label line carrying its own encoding. Decoded rows put it in the comment
# (`addiu $sp, -0x20  # .word 0x27bdffe0`); raw rows put it as the directive
# (`.word 0x24845ee4  # addiu $a0, 0x5ee4`). Both give the same word.
WORD_COLUMN_RE = re.compile(
    r"^\s*\.L0x([0-9a-f]{8}):\s*"
    r"(?:\.word\s+0x([0-9a-fA-F]{1,8})\b|.*?#\s*\.word\s+0x([0-9a-fA-F]{1,8})\b)"
)
LABEL_RE = re.compile(r"^\s*\.L0x([0-9a-f]{8})")


def parse_word_column(text: str) -> dict[int, int]:
    """Map label offset -> encoded word from a `.s` with either column shape."""
    words: dict[int, int] = {}
    for line in text.splitlines():
        found = WORD_COLUMN_RE.match(line)
        if not found:
            continue
        raw = found.group(2) or found.group(3)
        words[int(found.group(1), 16)] = int(raw, 16)
    return words


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(errors="replace")
    except OSError:
        return None


def _expand(path: str) -> Path:
    return Path(path.replace("~", str(Path.home())))


# --- the disc overlay image -----------------------------------------------

class OverlayImage:
    """The raw `.PRO` bytes of one overlay and the address they load at."""

    __slots__ = ("module", "base", "data")

    def __init__(self, module: str, base: int, data: bytes) -> None:
        self.module = module
        self.base = base
        self.data = data

    def word(self, address: int) -> int | None:
        off = address - self.base
        if off < 0 or off + 4 > len(self.data):
            return None
        return int.from_bytes(self.data[off:off + 4], "little")


def load_overlay_images(manifest: Path = NATIVE_MANIFEST) -> dict[str, OverlayImage]:
    """Every overlay image already extracted in the tree, keyed by module id.

    ``tools/build_native_screens.py`` writes one ``.bin`` per screen root next
    to a manifest naming its load base. Reusing those committed images keeps
    this step free of a live disc dependency; read them from the disc directly
    only when a module is missing here.
    """
    images: dict[str, OverlayImage] = {}
    if not manifest.exists():
        return images
    try:
        payload = json.loads(manifest.read_text())
    except (OSError, ValueError):
        return images
    for module, spec in payload.get("screens", {}).items():
        path = manifest.parent / spec["file"]
        if not path.exists():
            continue
        base = spec.get("load_base")
        if base is None:
            continue
        images[module] = OverlayImage(module, int(base), path.read_bytes())
    return images


def load_dump(path: Path = RAM_DUMP) -> bytes | None:
    try:
        return path.read_bytes()
    except OSError:
        return None


# --- the shared reader ----------------------------------------------------

class ModuleWords:
    """Resolve bounded instruction-word bodies for one inventory module.

    Sources are tried per function, so a module whose word column covers only
    its data table still reads its code from the disc image. ``kind`` names the
    source that answered the module's first function, for reporting; ``reason``
    says which sources were searched when none could.
    """

    def __init__(self, module: dict, dump: bytes | None = None,
                 images: dict[str, OverlayImage] | None = None) -> None:
        self.module = module
        self.dump = dump
        self.images = images if images is not None else load_overlay_images()
        self.kind: str | None = None
        self.reason: str | None = None

        self.words: dict[int, int] = {}          # label offset -> word
        self.starts: list[int] = []              # sorted label offsets
        self.offsets: dict[str, int] = {}        # function id -> label offset
        self.addresses: dict[str, int] = {}      # function id -> absolute addr
        self.addr_starts: list[int] = []
        self.end_addresses: dict[str, int] = {}
        self.image: OverlayImage | None = None
        self._resolve()

    # -- resolution --------------------------------------------------------

    def _resolve(self) -> None:
        self._index_addresses()
        source = _expand(self.module["source"])
        text = _read_text(source)
        column_text = text if text is not None and parse_word_column(text) else None
        if column_text is None:
            overlay = self.module["id"].split("/")[-1]
            norm = ROOT / "exe-decomp" / f"{overlay}.norm.s"
            ntext = _read_text(norm)
            if ntext is not None and parse_word_column(ntext):
                column_text = ntext
        if column_text is not None:
            self.words = parse_word_column(column_text)
            self.kind = "labels"
            self._index_labels(column_text)

        self.image = self.images.get(self.module["id"])

        if self.kind is None and self.image is not None:
            self.kind = "image"
        if (self.kind is None and self.dump is not None
                and self.module["id"].startswith("exe")):
            self.kind = "dump"
        if self.kind is None and self.dump is not None and self._addresses_in_dump():
            # An absolute-addressed overlay resident in the pinned dump is a
            # word source too (the dump was verified against the overlay).
            self.kind = "dump"
        if self.kind is None:
            self.reason = "no word column, no overlay image, no RAM dump coverage"

    def _index_labels(self, text: str) -> None:
        lines = text.splitlines()
        for function in self.module.get("functions", []):
            line_no = function.get("source_line")
            if not line_no or line_no > len(lines):
                continue
            label = lines[line_no - 1].split(":", 1)[0]
            found = LABEL_RE.match(label)
            if found:
                self.offsets[function["id"]] = int(found.group(1), 16)
        self.starts = sorted(self.offsets.values())

    def _index_addresses(self) -> None:
        for function in self.module.get("functions", []):
            address = function.get("address")
            if not address:
                continue
            addr = int(address, 16)
            self.addresses[function["id"]] = addr
            end = function.get("provisional_end_address")
            if end:
                self.end_addresses[function["id"]] = int(end, 16)
        self.addr_starts = sorted(self.addresses.values())

    def _addresses_in_dump(self) -> bool:
        if not self.addresses:
            return False
        assert self.dump is not None
        for address in (min(self.addresses.values()), max(self.addresses.values())):
            off = address - RAM_BASE
            if off < 0 or off + 4 > len(self.dump):
                return False
        return True

    # -- reading -----------------------------------------------------------

    def readable(self) -> bool:
        return self.kind is not None

    def body(self, function: dict) -> list[int] | None:
        fid = function["id"]
        start = self.offsets.get(fid)
        if start is not None and self.words and start in self.words:
            later = [s for s in self.starts if s > start]
            end = later[0] if later else None
            out = []
            offset = start
            while offset in self.words:
                if end is not None and offset >= end:
                    break
                out.append(self.words[offset])
                offset += 4
            if out:
                return out
        return self._address_body(fid)

    def _address_body(self, fid: str) -> list[int] | None:
        address = self.addresses.get(fid)
        if address is None:
            return None
        later = [a for a in self.addr_starts if a > address]
        end = later[0] if later else self.end_addresses.get(fid)
        if end is None:
            return None
        if self.image is not None:
            body = self._read_image(address, end)
            if body:
                return body
        if self.dump is not None:
            return self._read_dump(address, end)
        return None

    def _read_image(self, address: int, end: int | None) -> list[int] | None:
        assert self.image is not None
        limit = None if end is None else end - self.image.base
        out = []
        off = address - self.image.base
        while 0 <= off and off + 4 <= len(self.image.data):
            if limit is not None and off >= limit:
                break
            out.append(int.from_bytes(self.image.data[off:off + 4], "little"))
            off += 4
        return out or None

    def _read_dump(self, address: int, end: int | None) -> list[int] | None:
        assert self.dump is not None
        limit = None if end is None else end - RAM_BASE
        out = []
        off = address - RAM_BASE
        while off >= 0 and off + 4 <= len(self.dump):
            if limit is not None and off >= limit:
                break
            out.append(int.from_bytes(self.dump[off:off + 4], "little"))
            off += 4
        return out or None


def load_images_or_empty() -> dict[str, OverlayImage]:
    return load_overlay_images()
