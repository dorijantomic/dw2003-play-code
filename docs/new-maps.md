# New maps made with Gemini

A new field map is: export, Gemini, import. Nothing from the disc is committed; the Gemini picture stays on your machine.

## Steps

1. Pick the neighbour map id (e.g. `s330`) and the side the new map sits on (`left`, `right`, `up`, `down`).
2. `python3 tools/newmap_export.py s330 left --size 1024x768 --name "Central Sector — Mossy Glade"`
   writes `~/dw3-newmaps/n001/` (outside the repo) with `prompt.txt`, `ref.png`, `guide.png`, `spec.json`.
   Sizes are multiples of 64. `--at 600` moves the connection along the neighbour's edge; `--id` sets the id.
3. In the Gemini web app: attach `ref.png` and `guide.png`, paste `prompt.txt`. Gemini must return two pictures:
   the map and the walk mask (pure white = walkable, pure black = blocked). Save them in the same folder as
   `map.png` and `walk.png`. Any size with the same shape is fine (it is scaled to the spec size).
4. `python3 tools/newmap_import.py ~/dw3-newmaps/n001`
   It checks the mask (black/white, spawn and exits walkable, one connected area) and says what is wrong if not;
   then ask Gemini again. `--check-only` only checks.
5. Start the game: the new exit is on the neighbour, the new map has its exit back. No option, no flag.

## What gets written

- `data/authored/web/assets/data/newmaps/<id>.json` (map record, scene with the exit back, the exit added to the neighbour),
  `<id>.collision.json`, `index.json`: our own data, may be committed.
- Installed for local play by copying just those files to `web/assets/data/newmaps/` and the picture to
  `web/assets/maps/<id>.png` (git-ignored). `tools/install_authored_data.py` is not used.
- The picture is not put in `data/authored` unless you pass `--original-art` (only for art that is clearly original).
  A fresh clone with the data but without the picture skips that map and its door (`web/newmaps.js`).

## Collision format

The game's own grid (`engine/core/util/collision.ts`): `{"cell": 8, "cols": W/8, "rows": H/8, "blocked": ["0110...", ...]}`,
one string per 8-pixel cell row, `1` = blocked. A cell is blocked when more than half of its mask pixels are black.
A foot point is walkable when the 12 x 8 foot box touches no blocked cell and stays in the map.
Exits are rectangles 64 x 96 px in the scene (`{x,y,w,h,to,spawnX,spawnY,dir}`), like a disc exit.

## Game side

`web/newmaps.js` + 3 lines in `web/game.js` (after the manifest loads): records join `manifest.maps`, the scene comes from the file,
the neighbour's extra exit is appended when its scene is built. Test: `tests/newmap-pipeline.test.js` (synthetic map, end to end).

## Not done yet

NPCs, shops, encounters, battle arena and quests for a new map; extra exits on the other sides; the HD 4x tile path (the picture loads whole at its native size).
