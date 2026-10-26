#!/usr/bin/env python3
"""Read files straight off the player's own Digimon World 2 disc image (stdlib only).

The DW2 extras (mounts, extra motions) are built from the models in the disc's MODEL folder
(AAA/4.AAA/MODEL). This reads the disc's ISO9660 file system directly, so the player only drops
in the .bin (2352-byte raw sectors, CD-ROM XA) or a 2048-byte .iso: no IsoBuster, nothing else.

    dw2_disc.py <disc> --list [PATH]             list a directory (default: the root)
    dw2_disc.py <disc> --extract PATH --out DIR  copy a directory (recursively) to DIR
    dw2_disc.py <disc> --check                   is this a disc the DW2 extras can use?
"""
import argparse
import struct
import sys
from pathlib import Path

MODEL_DIR = "AAA/4.AAA/MODEL"     # where dw2_model_converter's input lives (its README)


class Disc:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.fh = open(self.path, "rb")
        try:
            self._open()
        except BaseException:
            self.fh.close()
            raise

    # the file must be closed before it is renamed or deleted (Windows refuses, WSL's /mnt/c leaves it broken)
    def close(self):
        self.fh.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _open(self):
        size = self.path.stat().st_size
        # raw 2352-byte sectors carry 24 header bytes before the 2048 user bytes (Mode 2 Form 1)
        for sector, offset in ((2352, 24), (2048, 0), (2352, 16)):
            if size % sector == 0 or sector == 2048:
                self.sector, self.offset = sector, offset
                if self._read(16, 6)[1:6] == b"CD001":
                    break
        else:
            raise ValueError("not a CD image")
        pvd = self._read(16, 2048)
        if pvd[1:6] != b"CD001":
            raise ValueError("no ISO9660 file system found (expected a PS1 .bin or .iso)")
        self.volume_id = pvd[40:72].decode("ascii", "replace").strip()
        self.root = self._record(pvd[156:156 + 34])
        # DW2's root record lists only SLUS_011.93, SYSTEM.CNF and ZZZ; AAA (and everything under it) is reachable
        # only through the PATH TABLE, which names every directory with its extent. So directories come from there.
        size, lba = struct.unpack_from("<I", pvd, 132)[0], struct.unpack_from("<I", pvd, 140)[0]
        table, i, dirs = self._read(lba, size), 0, []
        while i + 8 <= len(table):
            n = table[i]
            if n == 0:
                break
            ext, parent = struct.unpack_from("<IH", table, i + 2)
            name = table[i + 8:i + 8 + n].decode("ascii", "replace")
            path = "" if not dirs else f"{dirs[parent - 1][0]}/{name}".lstrip("/")
            dirs.append((path, ext))
            i += 8 + n + (n & 1)
        self.dirs = {p.upper(): ext for p, ext in dirs}

    def _dir_record(self, lba: int) -> dict:
        """A directory's own record from its first entry ("."), which carries the extent size."""
        r = self._record(self._read(lba, 34))
        return {**r, "lba": lba, "dir": True}

    def _read(self, lba: int, n: int) -> bytes:
        out = bytearray()
        while len(out) < n:
            self.fh.seek(lba * self.sector + self.offset)
            out += self.fh.read(min(2048, n - len(out)))
            lba += 1
        return bytes(out)

    @staticmethod
    def _record(b: bytes) -> dict:
        lba = struct.unpack_from("<I", b, 2)[0]
        size = struct.unpack_from("<I", b, 10)[0]
        flags = b[25]
        name = b[33:33 + b[32]].decode("ascii", "replace").split(";")[0]
        return {"lba": lba, "size": size, "dir": bool(flags & 2), "name": name}

    def listdir(self, rec: dict) -> list:
        data = self._read(rec["lba"], rec["size"])
        out, i = [], 0
        while i < len(data):
            n = data[i]
            if n == 0:                       # records never cross a sector: skip to the next one
                i = (i // 2048 + 1) * 2048
                continue
            r = self._record(data[i:i + n])
            if r["name"] not in ("\x00", "\x01"):
                out.append(r)
            i += n
        return out

    def find(self, path: str) -> dict | None:
        key = path.strip("/").upper()
        if key in self.dirs:
            return self._dir_record(self.dirs[key])
        parent, _, leaf = key.rpartition("/")
        if parent in self.dirs:
            hit = [r for r in self.listdir(self._dir_record(self.dirs[parent])) if r["name"].upper() == leaf]
            return hit[0] if hit else None
        rec = self.root
        for part in [p for p in path.strip("/").split("/") if p]:
            hit = [r for r in self.listdir(rec) if r["name"].upper() == part.upper()]
            if not hit:
                return None
            rec = hit[0]
        return rec

    def read_file(self, rec: dict) -> bytes:
        return self._read(rec["lba"], rec["size"])

    def extract(self, path: str, out: Path) -> int:
        rec = self.find(path)
        if rec is None or not rec["dir"]:
            raise FileNotFoundError(path)
        out.mkdir(parents=True, exist_ok=True)
        n = 0
        for r in self.listdir(rec):
            if r["dir"]:
                n += self.extract(f"{path}/{r['name']}", out / r["name"])
            else:
                (out / r["name"]).write_bytes(self.read_file(r))
                n += 1
        return n


def check(disc_path: Path) -> str:
    """'' when the image holds a DW2 MODEL folder with models in it, else a message for the player."""
    try:
        d = Disc(disc_path)
    except (OSError, ValueError) as e:
        return f"This file could not be read as a disc image ({e})."
    with d:
        return _check(d)


def _check(d: Disc) -> str:
    rec = d.find(MODEL_DIR)
    if rec is None or not rec["dir"]:
        return ("This does not look like a Digimon World 2 disc (it has no AAA/4.AAA/MODEL folder). "
                "If you have a .cue file, choose the .bin file next to it.")
    def models(r):          # M*.BIN, in MODEL000, MODEL050, ... (the converter walks the tree the same way)
        return sum(models(c) if c["dir"] else int(c["name"].upper().startswith("M") and c["name"].upper().endswith(".BIN"))
                   for c in d.listdir(r))
    if not models(rec):
        return "The MODEL folder on this disc holds no models."
    return ""


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("disc", type=Path)
    ap.add_argument("--list", nargs="?", const="/", metavar="PATH")
    ap.add_argument("--extract", metavar="PATH")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    if a.check:
        err = check(a.disc)
        print(err or "ok")
        return 1 if err else 0
    d = Disc(a.disc)
    if a.list is not None:
        rec = d.find(a.list)
        if rec is None:
            print(f"not found: {a.list}", file=sys.stderr)
            return 1
        print(f"volume {d.volume_id!r}, sector {d.sector}")
        for r in d.listdir(rec):
            print(f"{'d' if r['dir'] else '-'} {r['size']:>10} {r['name']}")
        return 0
    if a.extract:
        if not a.out:
            ap.error("--extract needs --out")
        print(f"{d.extract(a.extract, a.out)} files -> {a.out}")
        return 0
    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
