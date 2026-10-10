"""
Builds real collision data from the game's TMPK walkmesh quadtree.

Format (decoded 2026-06-11, corrected same day): each stage's tmpk has walk
sub-packs of exactly 6 bins forming a spatial quadtree over 128px tiles:

  0.bin  [gridW, gridH] + gridW*gridH u8 tile indices into 1.bin
  1.bin  entries of 4 x u8   -- 2x2 children at 64px, index into 2.bin
  2.bin  entries of 4 x u16  -- 2x2 children at 32px, index into 3.bin
  3.bin  entries of 4 x u16  -- 2x2 children at 16px, index into 4.bin
  4.bin  entries of 4 x u16  -- 2x2 children at  8px, index into 5.bin
  5.bin  leaves of 64 bytes  -- 8x8 cells of 1px; nonzero = walkable

Child order is row-major (TL, TR, BL, BR). Verified: every level's max index
+ 1 equals the next bin's entry count, across multiple stages. A stage
usually has two walk layers (ground + elevated floor); union = walkable.

Output: walker collision JSON at 8px cells ('1' = blocked). A cell is
walkable when at least half of its 8x8 pixel block is walkable in any layer.

Run: python3 tools/tmpk_collision.py        (all stages in the manifest)
     python3 tools/tmpk_collision.py s200   (specific stages)
"""

import os
import base64
import json
import struct
import sys
from pathlib import Path

DDW3_STAGE = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "pack/dw2003/field/stage"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web/assets/collision"

CELL = 8                    # output cell size in px
THRESHOLD = (CELL * CELL) // 2  # walkable pixels needed for a walkable cell
DOOR_PAD = 12               # px of approach halo cleared around each door trigger

try:
    import wstag_extract  # same dir on sys.path when run as a script
except ImportError:  # pragma: no cover - import shim for package-style imports
    wstag_extract = None

try:
    import zone_registration  # same dir on sys.path when run as a script
except ImportError as exc:  # pragma: no cover - import shim
    zone_registration = None
    # Without the registrar parser there is no way to know which TMPK sub is
    # a stage's type-0 terrain layer, so EVERY stage would silently export
    # collision with no `terrain` key at all -- a world-wide data drop that
    # looks like a successful build. Make it loud.
    print(f"tmpk_collision: FATAL: cannot import zone_registration ({exc}); "
          "the typed-terrain export would be a no-op for every stage",
          file=sys.stderr)


def decode_layer_pixels(bins, gw, gh, typed=False):
    """Returns a gh*128 x gw*128 bitmap (list of bytearrays).

    typed=False: each pixel is 1 when walkable (any nonzero leaf byte).
    typed=True:  each pixel keeps the raw leaf byte = the tile-type code
    (0=void; nonzero values mark floor/path/hazard tile classes, e.g. the
    trap-pad codes used by bug-maze stages).
    """
    grid = bins[0]
    l1 = [bins[1][i*4:(i+1)*4] for i in range(len(bins[1]) // 4)]
    def u16_entries(b):
        return [struct.unpack_from("<4H", b, i*8) for i in range(len(b) // 8)]
    l2, l3, l4 = u16_entries(bins[2]), u16_entries(bins[3]), u16_entries(bins[4])
    leaves = [bins[5][i*64:(i+1)*64] for i in range(len(bins[5]) // 64)]

    out = [bytearray(gw * 128) for _ in range(gh * 128)]
    for ty in range(gh):
        for tx in range(gw):
            e1 = l1[grid[2 + ty * gw + tx]]
            for q1, c1 in enumerate(e1):                     # 64px
                x1, y1 = tx*128 + (q1 % 2)*64, ty*128 + (q1 // 2)*64
                for q2, c2 in enumerate(l2[c1]):             # 32px
                    x2, y2 = x1 + (q2 % 2)*32, y1 + (q2 // 2)*32
                    for q3, c3 in enumerate(l3[c2]):         # 16px
                        x3, y3 = x2 + (q3 % 2)*16, y2 + (q3 // 2)*16
                        for q4, c4 in enumerate(l4[c3]):     # 8px
                            x4, y4 = x3 + (q4 % 2)*8, y3 + (q4 // 2)*8
                            leaf = leaves[c4]
                            for py in range(8):
                                row = out[y4 + py]
                                base = py * 8
                                for px in range(8):
                                    v = leaf[base + px]
                                    if v:
                                        row[x4 + px] = v if typed else 1
    return out


def walk_layer_subs(stage):
    """The TMPK sub-packs that carry the stage's walkable area, from the
    stage's OWN resource registration (`zonemgr+0x40` via zone_registration).

    Resource **type 0** is the terrain/walk layer (claim
    `typed-terrain-layer-is-stage-type0-resource`). Resource **type 1** is a
    SECOND walk layer that only 8 stages register -- s261, s375, s376, s480,
    s481, s540, s934, s949 -- where the ground walkmesh and an elevated-floor /
    stair walkmesh are separate sub-packs and the walkable area is their union.

    The old fixed {0,1,2} union in `find_layers` guessed the layers by sub
    number: it mixed in the type-7 story-trigger layer and, worse, dropped the
    type-1 layer whole. On s375 (Protocol Ruins) the stair/ramp up to the
    Pharaohmon block and on s480/s481 (Jungle Grave) the boardwalk from the
    entrance to the interior live ONLY in type 1, so those places were blocked
    outright. Reading them by registration has no per-stage hand row.

    Returns sub indices in registration order (type 0 first); [] when the stage
    registers no walk layer (s260/s415), so callers can fall back.
    """
    if zone_registration is None:
        return []
    key = stage[1:] if stage.startswith("s") else stage
    subs = []
    for typ in (0, 1):
        t = zone_registration.type_id(key, typ)
        if t is not None and t[1] not in subs:
            subs.append(t[1])
    return subs


def registered_layers(stage, gw, gh):
    """Validated quadtree bins for the stage's registered walk layers (type 0 +
    type 1), in registration order. [] if none resolve."""
    bins = []
    for sub in walk_layer_subs(stage):
        b = find_layer(stage, sub, gw, gh)
        if b is not None:
            bins.append(b)
    return bins


def find_layers(stage, gw, gh):
    layers = []
    for sub in ("0", "1", "2"):
        d = DDW3_STAGE / f"{stage}tmpk" / sub
        if not d.exists():
            continue
        bins_paths = sorted(d.glob("*.bin"))
        if len(bins_paths) != 6:
            continue
        bins = [(d / f"{i}.bin").read_bytes() for i in range(6)]
        g = bins[0]
        if (len(g) >= 2 + gw * gh and g[0] == gw and g[1] == gh
                and len(bins[5]) % 64 == 0 and bins[5]):
            layers.append(bins)
    return layers


def find_layer(stage, sub, gw, gh):
    """Return one validated TMPK quadtree sub-pack, or None."""
    d = DDW3_STAGE / f"{stage}tmpk" / str(sub)
    if not d.exists():
        return None
    paths = sorted(d.glob("*.bin"))
    if len(paths) != 6:
        return None
    bins = [(d / f"{i}.bin").read_bytes() for i in range(6)]
    g = bins[0]
    if (len(g) < 2 + gw * gh or g[0] != gw or g[1] != gh
            or len(bins[5]) % 64 != 0 or not bins[5]):
        return None
    return bins


def widen_doors(coll, doors):
    """Clear collision cells in and around each door trigger so the approach
    path is never blocked by 8px walkmesh quantization.

    A door trigger is the vertical segment {x, y1..y2}; the player approaches it
    horizontally. We unblock every cell overlapping the trigger rect expanded by
    DOOR_PAD px on all sides. The halo is small (~1-2 cells) so it opens the
    threshold tile without punching through real walls. Mutates and returns coll.
    """
    cell, cols, rows = coll["cell"], coll["cols"], coll["rows"]
    grid = [bytearray(row, "ascii") for row in coll["blocked"]]
    for d in doors:
        x0 = (d["x"] - DOOR_PAD) // cell
        x1 = (d["x"] + DOOR_PAD) // cell
        y0 = (d["y1"] - DOOR_PAD) // cell
        y1 = (d["y2"] + DOOR_PAD) // cell
        for r in range(max(0, y0), min(rows, y1 + 1)):
            for c in range(max(0, x0), min(cols, x1 + 1)):
                grid[r][c] = ord("0")
    coll["blocked"] = [row.decode("ascii") for row in grid]
    return coll


def stage_doors(stage):
    """Door triggers ({x, y1, y2}) for a stage id like 's745', or [] if none."""
    if wstag_extract is None:
        return []
    data = wstag_extract.overlay_bytes(stage[1:] if stage.startswith("s") else stage)
    return wstag_extract.extract_doors(data) if data else []


def stage_collision(stage, width, height):
    gw, gh = width // 128, height // 128
    # The walkable area is the union of the stage's REGISTERED walk layers
    # (type 0 + type 1), read from the stage's own resource table. Only when a
    # stage registers no resolvable walk layer (s260/s415) do we fall back to
    # the old fixed sub set, so those stages keep the collision they had.
    layer_bins = registered_layers(stage, gw, gh)
    if not layer_bins:
        layer_bins = find_layers(stage, gw, gh)
    if not layer_bins:
        return None
    walk = None
    for bins in layer_bins:
        px = decode_layer_pixels(bins, gw, gh)
        if walk is None:
            walk = px
        else:
            for r, row in enumerate(px):
                wrow = walk[r]
                for c, v in enumerate(row):
                    if v:
                        wrow[c] = 1
    cols, rows = -(-width // CELL), -(-height // CELL)
    blocked = []
    for r in range(rows):
        line = []
        for c in range(cols):
            count = 0
            for py in range(r * CELL, min((r + 1) * CELL, gh * 128)):
                row = walk[py]
                count += sum(row[c * CELL:min((c + 1) * CELL, gw * 128)])
            line.append("0" if count >= THRESHOLD else "1")
        blocked.append("".join(line))
    coll = {"cell": CELL, "cols": cols, "rows": rows, "blocked": blocked}
    # The native movement helper queries the actor's exact pixel position
    # against the stage's registered type-0 TMPK sub (its resource-registrar
    # id, not a fixed sub number) and uses the raw byte's low nibble/bit 0x10
    # to select its vector.
    if zone_registration is None:
        raise RuntimeError(
            "tmpk_collision: zone_registration is unavailable, so the typed-"
            "terrain layer cannot be resolved; refusing to write collision "
            "data with the terrain export silently dropped")
    terrain = None
    key = stage[1:] if stage.startswith("s") else stage
    type0 = zone_registration.type0_id(key)
    if type0 is not None:
        # We read the sub out of the stage's OWN {stage}tmpk directory, so the
        # registration's file number must be this stage's pack. Every stage in
        # the shipped set registers all its resource types against a single
        # file number (and all 292 type-0 file numbers are distinct), but
        # nothing in the format guarantees it -- if a stage ever registered
        # another pack's file, reading sub N out of this directory would be
        # silently wrong. Check instead of assuming.
        files = zone_registration.registration_files(key)
        if files != {type0[0]}:
            raise RuntimeError(
                f"{stage}: type-0 registration names pack file {type0[0]} but "
                f"the stage also registers files {sorted(files - {type0[0]})}; "
                "the terrain sub may not live in this stage's own tmpk pack")
        terrain = find_layer(stage, type0[1], gw, gh)
    if terrain:
        coll["terrain"] = [base64.b64encode(b).decode("ascii") for b in terrain]
    return widen_doors(coll, stage_doors(stage))


def main():
    manifest = json.loads((ROOT / "web/assets/manifest.json").read_text())
    wanted = {s if s.startswith("s") else f"s{s}" for s in sys.argv[1:]}
    OUT.mkdir(exist_ok=True)
    done = skipped = 0
    for m in manifest["maps"]:
        if wanted and m["id"] not in wanted:
            continue
        coll = stage_collision(m["id"], m["width"], m["height"])
        if coll is None:
            skipped += 1
            continue
        (OUT / f"{m['id']}.json").write_text(json.dumps(coll))
        done += 1
    print(f"wrote {done} collision files from tmpk quadtree walkmesh "
          f"({CELL}px cells), {skipped} stages without decodable layers")


if __name__ == "__main__":
    main()
