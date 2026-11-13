"""Shared maths of tools/newmap_export.py and tools/newmap_import.py (new HD maps made with Gemini).

Collision format of the game (engine/core/util/collision.ts GridJSON, one file per map):
  {"cell": 8, "cols": W/8, "rows": H/8, "blocked": ["0110...", ...]}   one string per cell row, "1" = blocked
A foot point (x, y) is walkable when the 12 x 8 foot box (x-6..x+6, y-8..y) touches no blocked cell and stays inside the
map (game.js `rectBlocked(grid, x-6, y-8, x+6, y)`). Everything here uses that same test.
"""
import json
import os
from collections import deque
from pathlib import Path

CELL = 8
STEP = 4              # lattice of foot points the flood fill walks (px)
EXIT_DEPTH = 64       # exit rectangles are 64 px deep (the disc's border exits are 64..128) ...
EXIT_LEN = 96         # ... and 96 px long along the edge
SPAWN_IN = 64         # arrival spawn: this far inside the map edge, so it is outside the exit rectangle
SIDES = {"left": "left", "l": "left", "w": "left", "west": "left",
         "right": "right", "r": "right", "e": "right", "east": "right",
         "up": "up", "top": "up", "n": "up", "north": "up",
         "down": "down", "bottom": "down", "s": "down", "south": "down"}
OPPOSITE = {"left": "right", "right": "left", "up": "down", "down": "up"}
FACING = {"left": "left", "right": "right", "up": "up", "down": "down"}   # direction a player walks when going to that side


def default_repo():
    return Path(__file__).resolve().parent.parent


def newmaps_dir():
    return Path(os.environ.get("NEWMAPS_DIR") or (Path.home() / "dw3-newmaps"))


def read_json(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def write_json(p, obj, indent=1):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=indent, ensure_ascii=False)
        f.write("\n")


# ---- collision grid (rows of "0"/"1") ---------------------------------------------------------------------------------
class Grid:
    def __init__(self, cols, rows, cells, cell=CELL):
        self.cols, self.rows, self.cells, self.cell = cols, rows, cells, cell   # cells: list[bytearray] rows

    @staticmethod
    def from_json(obj):
        cols, rows = obj["cols"], obj["rows"]
        cells = [bytearray(1 if ch == "1" else 0 for ch in row[:cols].ljust(cols, "0")) for row in obj["blocked"][:rows]]
        while len(cells) < rows:
            cells.append(bytearray(cols))
        return Grid(cols, rows, cells, obj.get("cell", CELL))

    def to_json(self):
        return {"cell": self.cell, "cols": self.cols, "rows": self.rows,
                "blocked": ["".join("1" if v else "0" for v in r) for r in self.cells]}

    def rect_blocked(self, x0, y0, x1, y1):
        c = self.cell
        c0, c1, r0, r1 = int(x0 // c), int(x1 // c), int(y0 // c), int(y1 // c)
        for r in range(r0, r1 + 1):
            for q in range(c0, c1 + 1):
                if q < 0 or r < 0 or q >= self.cols or r >= self.rows or self.cells[r][q]:
                    return True
        return False

    def foot_ok(self, x, y):
        return not self.rect_blocked(x - 6, y - 8, x + 6, y)

    def lattice(self):
        """Walkable foot points on a STEP lattice: dict {(i, j): True}; point = (i*STEP, j*STEP)."""
        w, h = self.cols * self.cell, self.rows * self.cell
        ok = set()
        for j in range(h // STEP + 1):
            for i in range(w // STEP + 1):
                if self.foot_ok(i * STEP, j * STEP):
                    ok.add((i, j))
        return ok


def components(ok):
    """Connected components (4-neighbour) of a lattice set; returns list of sets, biggest first."""
    seen, comps = set(), []
    for start in ok:
        if start in seen:
            continue
        comp, dq = {start}, deque([start])
        seen.add(start)
        while dq:
            i, j = dq.popleft()
            for n in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if n in ok and n not in seen:
                    seen.add(n)
                    comp.add(n)
                    dq.append(n)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return comps


def rect_points(ok, x, y, w, h):
    """Lattice points of `ok` whose foot point lies inside the rectangle [x, x+w) x [y, y+h)."""
    return [(i, j) for i in range(-(-x // STEP), -(-(x + w) // STEP))
            for j in range(-(-y // STEP), -(-(y + h) // STEP)) if (i, j) in ok]


# ---- geometry of one connection --------------------------------------------------------------------------------------
def exit_rect(side, W, H, along, depth=EXIT_DEPTH, length=EXIT_LEN, inset=0):
    """Rectangle on `side` of a W x H map, centred at `along` (y for left/right, x for up/down), flush with the edge
    (inset = extra px inward)."""
    if side == "right":
        return {"x": W - depth - inset, "y": along - length // 2, "w": depth, "h": length}
    if side == "left":
        return {"x": inset, "y": along - length // 2, "w": depth, "h": length}
    if side == "up":
        return {"x": along - length // 2, "y": inset, "w": length, "h": depth}
    return {"x": along - length // 2, "y": H - depth - inset, "w": length, "h": depth}


def inward(side, x, y, d):
    """Move (x, y) d px from the `side` edge toward the map's inside."""
    return {"left": (x + d, y), "right": (x - d, y), "up": (x, y + d), "down": (x, y - d)}[side]


def edge_point(side, W, H, along, d):
    """Foot point d px inside the `side` edge at position `along`."""
    return {"left": (d, along), "right": (W - d, along), "up": (along, d), "down": (along, H - d)}[side]


def along_of(side, x, y):
    return y if side in ("left", "right") else x


def edge_len(side, W, H):
    return H if side in ("left", "right") else W


def valid_id(s):
    return bool(s) and all(c.isalnum() or c in "_-" for c in s)
