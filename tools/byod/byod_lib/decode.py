"""Recursive disc -> ddw3-shaped tree decoder.

Uses Marko's (markisha64/ddw3) extractor binaries for the actual formats; the
routing, kind detection, path conventions and config (re)writing are ours.
See README.md.
"""
from __future__ import annotations

import os
import shutil
import struct
import subprocess
import tempfile
import threading
import tomllib
from pathlib import Path

from . import kinds as K

# one lock per output directory tree is unnecessary: stems are disjoint


class DecodeError(RuntimeError):
    pass


def _u32(d: bytes, i: int) -> int:
    return struct.unpack_from("<I", d, i)[0]


def pack_null_entries(d: bytes) -> set[int]:
    """Indices of entries whose offset table slot is zero (absent entries)."""
    n = len(d)
    if n == 0:
        return set()
    pos = 4
    first = _u32(d, 0)
    nulls = 0
    while first == 0:
        nulls += 1
        if pos + 4 > n:
            return set(range(nulls))
        first = _u32(d, pos)
        pos += 4
    offlen = first // 4
    offs = [0] * nulls + [first]
    while len(offs) < offlen and pos + 4 <= n:
        offs.append(_u32(d, pos))
        pos += 4
    return {i for i, o in enumerate(offs) if o == 0}


class Decoder:
    def __init__(self, tools: Path, out: Path, verbose: bool = False):
        self.tools = Path(tools)
        self.out = Path(out)
        self.verbose = verbose
        self.stats = {"files": 0, "tomls": 0, "dirs": 0}
        self.warnings: list[str] = []
        self._lock = threading.Lock()

    # --- helpers -----------------------------------------------------------

    def tool(self, name: str) -> str:
        p = self.tools / name
        if not p.exists():
            raise DecodeError(f"missing ddw3 tool binary: {p}")
        return str(p)

    def run(self, *args) -> None:
        r = subprocess.run([str(a) for a in args], capture_output=True, text=True)
        if r.returncode != 0:
            raise DecodeError(f"{os.path.basename(str(args[0]))} failed: {r.stderr.strip()[-400:]}")

    def warn(self, msg: str) -> None:
        with self._lock:
            self.warnings.append(msg)

    def write_file(self, rel: str, data: bytes) -> None:
        p = self.out / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        with self._lock:
            self.stats["files"] += 1

    def write_text(self, rel: str, text: str) -> None:
        p = self.out / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        with self._lock:
            self.stats["tomls"] += 1

    # --- config emitters (ddw3 style, byte-faithful) -----------------------

    @staticmethod
    def _toml_str(s: str) -> str:
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'

    def emit_pack_toml(self, stem: str, refs: list[str]) -> None:
        """Pack config: inline when the rendered line is <= 80 chars, else one
        ref per line with a tab indent (matches every committed pack config)."""
        line = "entries = [" + ", ".join(self._toml_str(r) for r in refs) + "]"
        if len(line) <= 80:
            self.write_text(stem + ".toml", line + "\n")
        else:
            body = "".join(f"\t{self._toml_str(r)},\n" for r in refs)
            self.write_text(stem + ".toml", "entries = [\n" + body + "]\n")

    def emit_map_toml(self, stem: str, refs: list[str], width: int, height: int,
                      extra_padding: int, override_entries_len: int | None = None) -> None:
        body = "".join(f"\t{self._toml_str(r)},\n" for r in refs)
        extra = f"override_entries_len = {override_entries_len}\n" if override_entries_len is not None else ""
        self.write_text(stem + ".toml",
                        f"width = {width}\nheight = {height}\nentries = [\n{body}]\n"
                        f"{extra}extra_padding = {extra_padding}\n")

    # --- kind routing ------------------------------------------------------

    def decode(self, kind: str, stem: str, data: bytes, depth: int = 0) -> None:
        if depth > 8:
            self.warn(f"depth limit at {stem}")
            return
        if kind == "pack":
            self.decode_pack(stem, data)
        elif kind == "map":
            self.decode_map(stem, data)
        elif kind == "lang_file":
            self.decode_lang(stem, data)
        elif kind == "rlen":
            self.decode_rlen(stem, data)
        elif kind == "map-tile":
            self.decode_map_tile(stem, data)
        elif kind == "tim":
            self.decode_tim(stem, data)
        else:
            raise DecodeError(f"unhandled kind {kind} at {stem}")

    # --- pack --------------------------------------------------------------

    def decode_pack(self, stem: str, data: bytes) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="byod-pack-", dir=self.out / "_work"))
        try:
            inp = tmp / "in.bin"
            inp.write_bytes(data)
            od = tmp / "o"
            od.mkdir()
            cfg = tmp / "o.toml"
            self.run(self.tool("unpack"), inp, "--output", str(od) + "/", "--output-config", cfg)
            entries = tomllib.load(open(cfg, "rb"))["entries"]
            nulls = pack_null_entries(data)
            name = os.path.basename(stem)
            refs: list[str] = []
            for i, entry in enumerate(entries):
                entry = str(entry)
                blob = self._read_tool_entry(od, entry)
                if i in nulls:
                    if name.endswith("mask"):
                        refs.append(K.EMPTY_PACK_SENTINEL)
                    elif name.endswith("tmpk"):
                        cstem = K.child_stem("pack", stem, entry)
                        self.decode_pack(cstem, b"")
                        refs.append("/build/" + cstem + ".bin")
                    else:
                        dest = f"{stem}/{os.path.basename(entry)}"
                        self.write_file(dest, b"")
                        refs.append(K.ref_for("leaf", stem, entry))
                    continue
                k = K.classify_entry(blob, "pack", stem)
                refs.append(self.route_entry(k, stem, entry, blob))
            self.emit_pack_toml(stem, refs)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def _read_tool_entry(self, od: Path, entry: str) -> bytes:
        p = od / entry
        if not p.exists():
            p2 = od / os.path.basename(entry)
            p = p2 if p2.exists() else p
        if not p.exists():
            self.warn(f"tool did not write entry {entry}")
            return b""
        return p.read_bytes()

    # --- map ---------------------------------------------------------------

    def decode_map(self, stem: str, data: bytes) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="byod-map-", dir=self.out / "_work"))
        try:
            inp = tmp / "in.bin"
            inp.write_bytes(data)
            od = tmp / "o"
            od.mkdir()
            cfg = tmp / "o.toml"
            self.run(self.tool("unmap"), inp, "--output", str(od) + "/", "--output-config", cfg)
            t = tomllib.load(open(cfg, "rb"))
            entries = [str(e) for e in t["entries"]]
            refs = []
            for entry in entries:
                blob = self._read_tool_entry(od, entry)
                if len(blob) == 0:
                    refs.append(K.EMPTY_MAP_SENTINEL)
                    continue
                k = K.classify_entry(blob, "map", stem)
                refs.append(self.route_entry(k, stem, entry, blob))
            self.emit_map_toml(stem, refs, t["width"], t["height"], t["extra_padding"],
                               t.get("override_entries_len"))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # --- entry routing -----------------------------------------------------

    def route_entry(self, kind: str, parent_stem: str, entry_name: str, blob: bytes) -> str:
        if kind == "empty":
            return (K.EMPTY_MAP_SENTINEL if parent_stem.startswith("map/")
                    else K.EMPTY_PACK_SENTINEL)
        if kind == "leaf":
            base = os.path.basename(entry_name)
            ext2 = K.sound_ext(blob, parent_stem)
            if ext2:
                base = os.path.splitext(base)[0] + ext2
                entry_name = os.path.join(os.path.dirname(entry_name), base) if os.path.dirname(entry_name) else base
            dest = f"{parent_stem}/{base}"
            self.write_file(dest, blob)
            return K.ref_for("leaf", parent_stem, entry_name)
        cstem = K.child_stem(kind, parent_stem, entry_name)
        if kind == "rlen":
            self.decode_rlen(cstem, blob)
        elif kind == "tim":
            self.decode_tim(cstem, blob)
        elif kind == "pack":
            self.decode_pack(cstem, blob)
        elif kind == "map-tile":
            self.decode_map_tile(cstem, blob)
        elif kind == "lang_file":
            self.decode_lang(cstem, blob)
        else:
            self.warn(f"unrouted kind {kind} at {cstem}")
        return "/build/" + cstem + K.KIND_EXT.get(kind, ".bin")

    # --- rlen --------------------------------------------------------------

    def decode_rlen(self, stem: str, data: bytes) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="byod-rlen-", dir=self.out / "_work"))
        try:
            inp = tmp / "in.bin"
            inp.write_bytes(data)
            dec = tmp / "out.dec"
            self.run(self.tool("unrlen"), inp, "--output", dec)
            d = dec.read_bytes()
            k = K.classify_expansion(d)
            if k == "tim":
                cstem = stem  # rlen and its expansion share the rel path
                self.decode_tim("tim/" + K.rel_dir(cstem), d)
                src = "/build/" + "tim/" + K.rel_dir(cstem) + ".tim"
            elif k == "map-tile":
                cstem = stem
                self.decode_map_tile("map-tile/" + K.rel_dir(cstem), d)
                src = "/build/" + "map-tile/" + K.rel_dir(cstem) + ".bin"
            elif k == "pack":
                cstem = stem
                self.decode_pack("pack/" + K.rel_dir(cstem), d)
                src = "/build/" + "pack/" + K.rel_dir(cstem) + ".bin"
            else:
                self.warn(f"rlen expansion kind unknown at {stem}")
                return
            self.write_text(stem + ".toml", f'src = "{src}"\n')
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # --- map-tile ----------------------------------------------------------

    def decode_map_tile(self, stem: str, data: bytes) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="byod-mt-", dir=self.out / "_work"))
        try:
            inp = tmp / "in.bin"
            inp.write_bytes(data)
            img = tmp / "o.tim"
            cfg = tmp / "o.toml"
            self.run(self.tool("unmap-tile"), inp, "--output-img", img, "--output-config", cfg)
            t = tomllib.load(open(cfg, "rb"))
            tim_stem = "tim/" + K.rel_dir(stem)
            self.decode_tim(tim_stem, img.read_bytes())
            img_ref = "/build/" + tim_stem + ".tim"
            lines = [f'img = "{img_ref}"']
            for layer in t["layers"]:
                lines.append("")
                lines.append("[[layers]]")
                objs = layer["objs"]
                if not objs:
                    lines.append("objs = []")
                else:
                    for o in objs:
                        wo, io_, sz = o["world_offset"], o["img_offset"], o["size"]
                        lines.append("")
                        lines.append("[[layers.objs]]")
                        lines.append(f"world_offset = [{wo[0]}, {wo[1]}]")
                        lines.append(f"img_offset = [{io_[0]}, {io_[1]}]")
                        lines.append(f"size = [{sz[0]}, {sz[1]}]")
            self.write_text(stem + ".toml", "\n".join(lines) + "\n")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # --- tim ---------------------------------------------------------------

    def decode_tim(self, stem: str, data: bytes) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="byod-tim-", dir=self.out / "_work"))
        try:
            inp = tmp / "in.tim"
            inp.write_bytes(data)
            png = tmp / "o.png"
            clut = tmp / "o.clut.png"
            cfg = tmp / "o.toml"
            self.run(self.tool("untim"), inp, "--output", png, "--output-clut", clut,
                     "--output-config", cfg)
            t = tomllib.load(open(cfg, "rb"))
            base = os.path.basename(stem)
            self.write_file(stem + ".png", png.read_bytes())
            lines = [f'bpp = "{t["bpp"]}"', ""]
            if "clut" in t:
                c = t["clut"]
                self.write_file(stem + ".clut.png", clut.read_bytes())
                lines += ["[clut]",
                          f'pos = [{c["pos"][0]}, {c["pos"][1]}]',
                          f'kind = "{c["kind"]}"',
                          f'path = "{base}.clut.png"',
                          ""]
            lines += ["[img]",
                      f'pos = [{t["img"]["pos"][0]}, {t["img"]["pos"][1]}]',
                      f'path = "{base}.png"']
            self.write_text(stem + ".toml", "\n".join(lines) + "\n")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # --- lang --------------------------------------------------------------

    def decode_lang(self, stem: str, data: bytes) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="byod-lang-", dir=self.out / "_work"))
        try:
            inp = tmp / "in.bin"
            inp.write_bytes(data)
            cfg = tmp / "o.toml"
            self.run(self.tool("unlang-file"), inp, "--output", cfg)
            t = tomllib.load(open(cfg, "rb"))

            def esc(s: str) -> str:
                return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")

            line = "strings = [" + ", ".join(f'"{esc(s)}"' for s in t["strings"]) + "]"
            if len(line) <= 80:
                self.write_text(stem + ".toml", line + "\n")
            else:
                body = "".join(f'\t"{esc(s)}",\n' for s in t["strings"])
                self.write_text(stem + ".toml", "strings = [\n" + body + "]\n")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
