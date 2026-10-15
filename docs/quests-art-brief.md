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

## Option 3: a picture from an image generator (Gemini and the like) - the easy one, fully automatic

1. Get ONE picture with 1 to 4 figures of the character in a row: front, side facing right, back (a 4th, the other side, is
   skipped). Any flat background colour; the figures must not touch.
2. Save it as `data/authored/quests/art/<name>.png`.
3. Add the character to `data/authored/quests/new_characters.json`:
   `{"npc_id": 1005, "name": "Name", "views": "data/authored/quests/art/<name>.png", "height": 35, "residents": [{"map": "s340", "x": 440, "y": 392}]}`
   and a name/look/voice line for the same id in `characters.json`.
4. `python3 tools/make_quest_sprites.py` (takes a few seconds). Nothing else.

What the tool does by itself: removes the background (the picture's border colour, only where it connects to the edge, so a
green backpack or white shoes survive), finds the figures, shrinks them to `height` (the disc's townspeople are 26 to 40,
mostly 33 to 35; kids about 31), reduces to a game-like palette, adds the outline, builds the walk frames and the idle
"breathing" clip the game plays for anyone standing still (without it a character looks frozen next to the disc's). If it
cannot find 1 to 4 figures it says so and names the file. A side view that faces LEFT in the picture needs `"flip_side": true`.

Prompt template (use one of the game's own NPC sprites, three views, as the attached reference, and change the last line):

> The attached picture is a character sprite from the PS1 game Digimon World 3, shown three times: facing the camera, facing right, facing away. Draw a NEW, DIFFERENT character in exactly the same pixel-art style, proportions, size, dark-outline and shading look, and layout: the same new character three times, evenly spaced, same size, feet on one line, left = facing the camera, middle = facing right, right = facing away. Do not copy the reference character's clothes, face or hair. Plain flat bright green background, no shadow, no text, no border. New character: <describe>.

(The reference pictures cut from game sprites are made locally under `art/ref/` and are git-ignored: they are game art.)

## Option 4: a whole sprite sheet from an image generator (best result, real directions)

Give the generator `art/ref/ref_allframes_p066frtm.png` (the whole sheet of one game sprite, enlarged; made locally, git-ignored)
and ask for a NEW character as a complete sheet in the same layout: 8 rows top to bottom (down, down-left, left, right,
up-left, up, down-right, up-right), 3 frames across, flat green background. Save it as `data/authored/quests/art/<name>.png`
and use `"sheet_picture": "..."` instead of `"views"` in `new_characters.json`. The tool cuts the background out, finds the
8 rows and the frames, takes frame 0 of each row as the standing pose, sizes it like the disc's people and builds the idle
and walk clips. First proven with `cyber.png` (npc 1005, a placeholder name with no quest yet). If rows touch or a row is
missing, it names the file and says so.
