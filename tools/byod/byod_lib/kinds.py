"""Kind detection + tree path conventions for the ddw3-shaped tree.

The ddw3 tree is a decoded form of the disc: every disc file is either copied
(raw files) or expanded by one of Marko's un* tools, recursively. Each blob's
kind is detected from its bytes with validators that reimplement the checks of
Marko's own tools (ddw3-pack / ddw3-rlen / ddw3-lang-file / ddw3-map-tile), so
no reference tree is needed at extraction time.

Path conventions (matching the ddw3 tree exactly):
  * container stem "pack/dw2003/country/eng/esdmg270" writes its config to
    "<stem>.toml" and its entries under sibling directories.
  * an entry of kind K named "<base><ext>" inside container stem S lands at
    "K/<S minus its first segment>/<base><extK>", with the "country/" segment
    dropped for lang_file (ddw3 keeps language files at lang_file/dw2003/<lang>/).
  * refs written into configs use "/build/<stem><extK>"; raw entries keep their
    relative name; empty entries use the ddw3 sentinel path.
"""
from __future__ import annotations

import os
import re
import struct

# --- blob kind validators (faithful ports of the ddw3 tool checks) ----------

RLEN_MAGIC = b"RLEN"
TIM_MAGIC = b"\x10\x00\x00\x00"
VAB_HEADER_MAGIC = b"pBAV"
SEP_MAGIC = b"pQES"

EMPTY_PACK_SENTINEL = "/pack/dw2003/field/stage/empty.bin"
EMPTY_MAP_SENTINEL = "/map-tile/empty.bin"


def is_rlen(d: bytes) -> bool:
    return len(d) >= 8 and d[:4] == RLEN_MAGIC


def is_tim(d: bytes) -> bool:
    """untim's checks: magic 0x10; optional clut block whose
    width*height*2+12 == total_size; then an image block with the same
    invariant. (The tool pads short images with zeros and ignores trailing
    bytes, so only the header invariants are validated.)"""
    n = len(d)
    if n < 8 or d[:4] != TIM_MAGIC:
        return False
    flags = struct.unpack_from("<I", d, 4)[0]
    pos = 8

    def img_header_ok(p: int) -> int | None:
        if p + 12 > n:
            return None
        total = struct.unpack_from("<I", d, p)[0]
        w = struct.unpack_from("<H", d, p + 8)[0]
        h = struct.unpack_from("<H", d, p + 10)[0]
        if w * h * 2 + 12 != total:
            return None
        return total

    if flags & 0x8:  # has clut
        total = img_header_ok(pos)
        if total is None:
            return False
        pos += total
    total = img_header_ok(pos)
    if total is None:
        return False
    return True


def is_pack(d: bytes) -> bool:
    """PackReader::new port, tightened with the invariants every real ddw3 pack
    has (validated against the committed tree): >=2 offsets, word-aligned,
    strictly increasing, past the header and inside the file. Small blobs that
    merely begin with a plausible offset word (sprite frames, mesh records)
    fail these and are kept as raw leaves."""
    n = len(d)
    if n == 0:
        return True  # empty pack is valid (ddw3-pack)
    if n % 4:
        return False
    try:
        def u32(i):
            return struct.unpack_from("<I", d, i)[0]

        first = u32(0)
        pos = 4
        nulls = 0
        while first == 0:
            nulls += 1
            if pos + 4 > n:
                return False
            first = u32(pos)
            pos += 4
        if first % 4:
            return False
        offlen = first // 4
        if offlen < nulls + 1 or offlen < 2 or offlen * 4 > n:
            return False
        offs = [0] * nulls + [first]
        while len(offs) < offlen:
            if pos + 4 > n:
                return False
            offs.append(u32(pos))
            pos += 4
        if any(o % 4 for o in offs):
            return False
        nz = [o for o in offs if o]
        if nz != sorted(nz) or len(set(nz)) != len(nz):
            return False
        if nz[0] < offlen * 4:
            return False
        if any(o > n for o in offs):
            return False
        return True
    except (struct.error, IndexError):
        return False


def is_map_tile(d: bytes) -> bool:
    """unmap-tile port: u32 header_len; layers of (u32 count + 0xc*count bytes)
    bounded by header_len; the image (data[header_len:]) must be a TIM."""
    n = len(d)
    if n < 8:
        return False
    try:
        header_len = struct.unpack_from("<I", d, 0)[0]
        if header_len < 8 or header_len > n:
            return False
        pos = 4
        layers = 0
        while True:
            if pos + 4 > header_len:
                break
            objs_len = struct.unpack_from("<I", d, pos)[0]
            if pos + 0xC * objs_len > header_len:
                break
            pos += 4 + 0xC * objs_len
            layers += 1
            if layers > 4096:
                return False
        if layers == 0 or pos != header_len:
            return False
        return is_tim(d[header_len:])
    except (struct.error, IndexError):
        return False


def is_lang(d: bytes) -> bool:
    """LangFile::parse port: u32 count; that many ascending u32 offsets into the
    file; each string NUL-terminated."""
    n = len(d)
    if n < 8:
        return False
    try:
        cnt = struct.unpack_from("<I", d, 0)[0]
        if cnt == 0 or 4 + 4 * cnt > n:
            return False
        offs = [struct.unpack_from("<I", d, 4 + 4 * i)[0] for i in range(cnt)]
        if offs != sorted(offs):
            return False
        if offs[0] < 4 + 4 * cnt or offs[-1] >= n:
            return False
        for o in offs:
            if d.find(b"\x00", o) < 0:
                return False
        return True
    except (struct.error, IndexError):
        return False


_SOUND_VB_PACK = re.compile(r"(?:^|/)sound/[^/]+/mv[^/]+$")

# ddw3 expanded an entry into a nested pack only in the files its history
# actually unpacked ("Unpacked all files in ...", "Unpacked all inner files in
# pack/dw2003/screen"): the *tmpk stage packs plus this fixed set. Everywhere
# else a pack-shaped blob stayed a raw leaf (fight effect/model records, sprite
# frames), so nested-pack expansion is scoped to these stems.
_NESTED_PACK = re.compile(
    r"^pack/dw2003/(?:"
    r"field/stage/[^/]*tmpk"
    r"|card/carddata"
    r"|country/(?:cmfontcs|cmfonttm|cntselwn)"
    r"|nameent/(?:stdgnmcs|stdgnmtm|stnmetcs|stnmettm)"
    r"|screen/(?:cmnbgdcs|cmnbgdtm|end__all|namedtcs|namedttm|stalbmcs|stalbmtm"
    r"|stcdspcs|stcdsptm|stfrptcs|stfrpttm|stshopcs|stshoptm|ststatcs|ststattm"
    r"|stwmp0cs|stwmp0tm|stwmp1cs|stwmp1tm|tlogojpn|tlogopal|tlogousa|ttcommpk)"
    r")$")

# stems where ddw3 kept every tim-shaped entry raw (stage background packs the
# walker reads as raw bins: s415/s815 Deeper-Crevice scenery layers)
_NO_TIM = {
    "pack/dw2003/field/stage/s415bg01", "pack/dw2003/field/stage/s415bg02",
    "pack/dw2003/field/stage/s815bg01", "pack/dw2003/field/stage/s815bg02",
}

# stems where a lang-shaped blob stayed raw (small frame/mesh records whose
# offset table happens to look like a lang file)
_NO_LANG = {
    "pack/dw2003/field/sprite/p181sspm",
    "pack/dw2003/fight/effect/meft1005",
    "pack/dw2003/fight/model/m428ebd2",
}

# entries of a nested pack inside a screen pack stay raw (ddw3 unpacked the
# screen inner packs but expanded nothing inside them: no /build refs at all)
_SCREEN_NESTED = re.compile(r"^pack/dw2003/screen/[^/]+/[^/]+$")


def sound_ext(d: bytes, stem: str = "") -> str | None:
    """ddw3's rename of VAB-header / SEP / VAB-body entries to .vh/.seq/.vb.

    .vh/.seq are magic-detected; the VAB body has no magic, so it is renamed
    by position: every leaf of a pack/dw2003/sound/<group>/mv<group> pack is a
    VAB body (that is the only content those packs hold, 71/71 groups)."""
    if d[:4] == VAB_HEADER_MAGIC:
        return ".vh"
    if d[:4] == SEP_MAGIC:
        return ".seq"
    if _SOUND_VB_PACK.search(stem):
        return ".vb"
    return None


# --- kind decision ----------------------------------------------------------

def classify_entry(d: bytes, container_kind: str, stem: str = "") -> str:
    """Kind of an entry blob inside a pack or map container.

    Returns one of: empty, rlen, tim, pack, map, map-tile, lang_file, leaf.
    Order is tuned so each validator only sees candidates of its own format
    (validated against the committed ddw3 tree for every container). `stem` is
    the container's tree stem; expansion policy is scoped by it (see the
    _NESTED_PACK / _NO_TIM / _NO_LANG tables above).
    """
    if len(d) == 0:
        return "empty"
    if _SCREEN_NESTED.match(stem):
        return "leaf"
    if container_kind == "map":
        if is_rlen(d):
            return "rlen"
        if is_map_tile(d):
            return "map-tile"
        return "leaf"
    # pack container
    if is_rlen(d):
        return "rlen"
    if is_tim(d) and stem not in _NO_TIM:
        return "tim"
    if is_pack(d) and _NESTED_PACK.match(stem):
        return "pack"
    if is_map_tile(d):
        return "map-tile"
    if is_lang(d) and stem not in _NO_LANG:
        return "lang_file"
    return "leaf"


def classify_expansion(d: bytes) -> str:
    """Kind of the bytes an rlen expands to (ddw3 only has tim and map-tile)."""
    if is_tim(d):
        return "tim"
    if is_map_tile(d):
        return "map-tile"
    if is_pack(d):
        return "pack"
    return "unknown"


# --- path conventions -------------------------------------------------------

KIND_EXT = {
    "pack": ".bin",
    "map": ".bin",
    "lang_file": ".bin",
    "rlen": ".bin",
    "map-tile": ".bin",
    "tim": ".tim",
}


def rel_dir(stem: str) -> str:
    """'pack/dw2003/country/eng' -> 'dw2003/country/eng'."""
    return stem.split("/", 1)[1]


def child_stem(kind: str, parent_stem: str, entry_name: str) -> str:
    """Tree stem for an entry of `kind` inside container `parent_stem`."""
    d = rel_dir(parent_stem)
    if kind == "lang_file":
        d = d.replace("country/", "", 1)
    base = os.path.basename(entry_name)
    ext = os.path.splitext(base)[1]
    if ext:
        base = base[: -len(ext)]
    return f"{kind}/{d}/{base}"


def ref_for(kind: str, parent_stem: str, entry_name: str) -> str:
    """The reference string ddw3 writes for this entry in the parent config."""
    if kind == "empty":
        return EMPTY_MAP_SENTINEL if parent_stem.startswith("map/") else EMPTY_PACK_SENTINEL
    if kind == "leaf":
        base = os.path.basename(entry_name)
        ext = os.path.splitext(base)[1]
        return f"{os.path.basename(parent_stem)}/{base}"
    return "/build/" + child_stem(kind, parent_stem, entry_name) + KIND_EXT[kind]


def entry_dest(kind: str, parent_stem: str, entry_name: str, data: bytes) -> str:
    """Tree path an entry's file is written to (leaf keeps its relative name)."""
    if kind == "leaf":
        return f"{parent_stem}/{os.path.basename(entry_name)}"
    return child_stem(kind, parent_stem, entry_name) + KIND_EXT[kind]
