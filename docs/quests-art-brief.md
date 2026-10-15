---
reach: How to give the extra quests a new character with their own sprite: drawn from parameters by tools/make_quest_sprites.py, or a finished sheet from any artist or image generator. Read before adding a character.
status: written 2026-10-15. Three characters exist (Moss 1001, Maintenance Tech 1002, Runner 1003), drawn by the tool.
---

# New characters and their art

A new character is two things: a **sprite sheet** and an entry in `data/authored/quests/new_characters.json`
(`npc_id` 1000 or higher, a name, and where they stand). Their words and voice go in `characters.json`; their quests in a
`pack_*.py`. Then run `python3 tools/make_quest_sprites.py` and `python3 tools/build_quests.py`; the game picks them up
from `web/extra_npcs.json` and `web/extra_sprites/` with no code change.

## Option 1: draw them from parameters (what exists today)

```json
{"npc_id": 1004, "name": "Dockhand",
 "look": {"skin": "#d9a67c", "hair": "#303030", "hairstyle": "short|long|bun|spiky", "hat": "#2f6fb5",
          "top": "#7fb0da", "bottom": "#4a6e96", "shoes": "#555566", "accent": "#f4c542", "glasses": "#334455",
          "headphones": "#d8503c", "scarf": "#f1d04b", "pack": "#3a5a40", "coat": false},
 "residents": [{"map": "s202", "x": 656, "y": 312, "dir": "down-left"}]}
```
Every key but skin/top/bottom is optional. The figure is a plain 2-heads-tall person with eight facing directions and a
walk cycle. It is clearly simpler than the disc's hand-made sprites; fine for townspeople, poor for a hero.

## Option 2: a finished sheet (any tool, any artist, an image generator)

Point `"sheet": "path/to/file.png"` at a PNG of exactly **120 x 384 pixels**, transparent background:

- 8 rows, top to bottom: `down, down-left, left, right, up-left, up, down-right, up-right` (what each way the character faces)
- 5 columns per row: standing, step, standing, other step, standing
- each cell **24 x 48 pixels**, feet on the bottom line about 4 pixels above the cell bottom, character about 20 wide x 40 tall,
  one-pixel dark outline (see any sheet in the game for the look: bright flat colours, selective shading)
- nearest-neighbour pixels, no anti-aliasing, no semi-transparent edges

If the tool refuses the size it says so. A generator that draws one front view can be turned into a sheet by copying that
view into the "down" rows and a mirrored copy into "left/right"; quality is then limited, but it works.

## About Hermes and image generation

Asked on 2026-10-15 (`hermes -z ...`), Hermes replied that this session has no `image_generate` tool loaded: its config lists
the `image_gen` toolset, but the provider (FAL_KEY, or a DeepInfra block under `image_gen:`) is not set up, so nothing was
drawn. Once a provider is working, give it the Option 2 spec above plus the character's `look` line from
`characters.json`, then save the result into `data/authored/quests/art/` and reference it as the `sheet`. Nothing in the game
changes. Do not commit game art: sheets must be original.
