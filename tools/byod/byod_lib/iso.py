"""Disc image -> files: CD-ROM XA (Mode 2/2352) and plain ISO (2048) support.

This is a plain ISO9660 reader, not a game-format decoder: the game formats
are handled by Marko's tools (see decode.py).
"""
from __future__ import annotations

import struct
from pathlib import Path

SECTOR_RAW = 2352
SECTOR_ISO = 2048


class IsoError(RuntimeError):
    pass


class DiscImage:
    """Random-access reader for a .bin (Mode 2/2352) or .iso (2048) image."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.fh = open(self.path, "rb")
        size = self.path.stat().st_size
        self.sector_size = None
        if size % SECTOR_RAW == 0:
            self.fh.seek(16 * SECTOR_RAW)
            head = self.fh.read(32)
            if (head[:12] == b"\x00\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\x00"
                    and head[15:16] == b"\x02"
                    and head[24:25] == b"\x01" and head[25:30] == b"CD001"):
                self.sector_size = SECTOR_RAW
        if self.sector_size is None and size % SECTOR_ISO == 0:
            self.fh.seek(16 * SECTOR_ISO)
            head = self.fh.read(8)
            if head[0:1] == b"\x01" and head[1:6] == b"CD001":
                self.sector_size = SECTOR_ISO
        if self.sector_size is None:
            raise IsoError(f"{path}: not a CD-ROM XA (2352) or ISO (2048) image")

    def user_sector(self, lba: int) -> bytes:
        """2048 bytes of user data for sector `lba`."""
        if self.sector_size == SECTOR_ISO:
            self.fh.seek(lba * SECTOR_ISO)
            return self.fh.read(SECTOR_ISO)
        self.fh.seek(lba * SECTOR_RAW)
        raw = self.fh.read(SECTOR_RAW)
        if len(raw) < SECTOR_RAW:
            raise IsoError(f"short read at sector {lba}")
        if raw[:12] != b"\x00\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\x00":
            # not a raw sector (may be a 2048 image with size divisible by 2352)
            self.fh.seek(lba * SECTOR_ISO)
            return self.fh.read(SECTOR_ISO)
        submode = raw[18]
        if submode & 0x20:  # Mode 2 Form 2: 2324 user bytes, no EDC-checked data
            return raw[24:24 + 2324]
        return raw[24:24 + 2048]

    def file_bytes(self, lba: int, size: int) -> bytes:
        out = bytearray()
        sec = lba
        while len(out) < size:
            out += self.user_sector(sec)[:2048]
            sec += 1
        return bytes(out[:size])

    def read_dir(self, lba: int, size: int) -> list[tuple[str, int, int, bool]]:
        """Returns [(name, lba, size, is_dir)] for one directory extent."""
        data = self.file_bytes(lba, size)
        out = []
        pos = 0
        while pos < len(data):
            rec_len = data[pos]
            if rec_len == 0:
                pos = (pos // 2048 + 1) * 2048
                continue
            rec = data[pos:pos + rec_len]
            if len(rec) < 33:
                pos += rec_len or 1
                continue
            ext_lba, ext_size = struct.unpack_from("<II", rec, 2)[0], struct.unpack_from("<I", rec, 10)[0]
            flags = rec[25]
            name_len = rec[32]
            name = rec[33:33 + name_len]
            pos += rec_len
            if name in (b"\x00", b"\x01"):
                continue
            nm = name.decode("latin-1")
            if ";1" in nm:
                nm = nm.split(";1")[0]
            out.append((nm, ext_lba, ext_size, bool(flags & 0x02)))
        return out

    def _dir_size(self, lba: int) -> int:
        """Size of a directory extent, from its own '.' record."""
        sec = self.user_sector(lba)
        rec_len = sec[0]
        return struct.unpack_from("<I", sec, 10)[0] if rec_len else SECTOR_ISO

    def walk(self):
        """Yield (iso_path, lba, size) for every file.

        The retail disc's root directory record list is sparse (it does not
        list AAA/), so the directory tree is walked from the ISO9660 path
        table, exactly like `ddw3-uniso --use-path-table`.
        """
        pvd = self.user_sector(16)
        pt_lba = struct.unpack_from("<I", pvd, 140)[0]
        pt_size = struct.unpack_from("<I", pvd, 132)[0]
        pt = self.file_bytes(pt_lba, pt_size)
        dirs = []  # (name, lba, parent_1based)
        pos = 0
        while pos + 8 <= len(pt) and pt[pos] != 0:
            nl = pt[pos]
            lba = struct.unpack_from("<I", pt, pos + 2)[0]
            parent = struct.unpack_from("<H", pt, pos + 6)[0]
            name = pt[pos + 8:pos + 8 + nl].decode("latin-1")
            pos += 8 + nl + (nl & 1)
            dirs.append((name, lba, parent))
        paths = {}
        queue = []
        for idx, (name, lba, parent) in enumerate(dirs, 1):
            if parent == 0 or name == "\x00":
                prefix = ""
            else:
                prefix = paths.get(parent, "") + name + "/"
            paths[idx] = prefix
            queue.append((prefix, lba))
        seen_lbas = {lba for _, lba, _ in dirs}
        seen_lbas.add(struct.unpack_from("<I", pvd, 158)[0])  # root lba
        while queue:
            prefix, lba = queue.pop(0)
            for name, elba, esize, isdir in self.read_dir(lba, self._dir_size(lba)):
                p = f"{prefix}{name}"
                if isdir:
                    if elba not in seen_lbas:
                        seen_lbas.add(elba)
                        queue.append((p + "/", elba))
                else:
                    yield p, elba, esize

    def extract_all(self, out_dir: Path, skip=None) -> dict[str, int]:
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        counts = {"files": 0, "bytes": 0, "skipped": 0}
        for p, lba, size in self.walk():
            if skip and skip(p):
                counts["skipped"] += 1
                continue
            dest = out_dir / p
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(self.file_bytes(lba, size))
            counts["files"] += 1
            counts["bytes"] += size
        return counts
