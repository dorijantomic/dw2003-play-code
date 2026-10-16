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

## The prompts that worked (keep these)

**Whole sprite sheet (Option 4). This produced `cyber.png`, the best result so far.** Attach
`data/authored/quests/art/ref/ref_allframes_p066frtm.png` (the game's `web/assets/sprites/p066frtm.png`, a boy with a grey cap,
enlarged 8 times on green; regenerate it with the small script in `tools/` notes below if the file is missing), then paste:

> The attached picture is the complete sprite sheet of a character from the PS1 game Digimon World 3, enlarged so each game pixel is a big square block: 3 frames across and 8 directions down, in the same order. Draw a NEW, DIFFERENT character as a complete sprite sheet in exactly the same layout: 3 columns by 8 rows, same cell size and spacing, same direction in each row, same chunky chibi proportions and height, same pixel-block style with a thick dark outline. Make it a large image with hard square pixel blocks, flat colours, at most 16 colours, no smoothing. Do not copy the reference's clothes, face, hair or bag, and do not copy its speckled shading. Plain flat bright green background, no text, no border. New character: [describe, and name the 2 or 3 features that must stay readable, made big]

The character line used for Cyber was: an armoured security unit, dark plating, glowing blue chest gem, red visor, gold headphones.
Lessons: asking for "large image, big hard pixel blocks, 3 x 8 grid" worked; features must be named so they come out big (small details
such as goggles are lost when shrunk to ~35 px); the generator's 3 frames per row are nearly identical, so only frame 0 is used.

**Three views (Option 3), the earlier method.** Attach one `art/ref/ref_<name>.png` (front, side, back of a game sprite) and paste:

> The attached picture is a character sprite from the PS1 game Digimon World 3, shown three times: facing the camera, facing right, facing away. Draw a NEW, DIFFERENT character in exactly the same pixel-art style, the same proportions, the same size, the same dark-outline and shading look, and the same layout: the same new character three times, evenly spaced, same size, feet on one line, left = facing the camera, middle = facing right, right = facing away. Do not copy the reference character's clothes, face or hair. Keep the plain flat bright green (#00FF00) background, no shadow, no text, no border. New character: [describe]

**Regenerating the references** (they are git-ignored game art): the all-frames one is the sheet `web/assets/sprites/p066frtm.png`
enlarged 8 times with nearest-neighbour on a green (#00FF00) background; the three-view ones are the `down`, `right` and `up` first
frames of a game NPC sheet (rows per `web/assets/manifest.json`), enlarged 14 times, side by side on green. (Pillow, ten lines.)

**New partner Digimon (walking sheets).** Same prompt as Option 4, with the reference being a partner's own full sheet
(`ref_<name>_allframes.png`: the game's sheet enlarged on green, git-ignored) and the frame count matching that sheet
(Patamon 9 across, Agumon / Veemon / Renamon 4, Kotemon 5). Start a new chat for each. Paste, with the counts changed:

> The attached picture is the complete sprite sheet of a character from the PS1 game Digimon World 3, enlarged so each game pixel is a big square block: 4 frames across and 8 directions down, in the same order. Draw a NEW, DIFFERENT creature as a complete sprite sheet in exactly the same layout: 4 columns by 8 rows, same cell size and spacing, same direction in each row, same chunky proportions and size, same pixel-block style with a thick dark outline. Make it a large image with hard square pixel blocks, flat colours, at most 16 colours, no smoothing. Do not copy the reference's colours, face or body details. Plain flat bright green background, no text, no border. New creature: [description], drawn in this PS1 pixel style.

- DemiDevimon (Patamon sheet, 9 across): small black round bat-devil, big bat wings, one big blue eye showing, red claws, purple trim.
- Betamon (Agumon sheet, 4 across): small green amphibian on four legs, orange belly, red fin on its head, big round eyes.
- Hagurumon (Veemon sheet, 4 across): floating grey metal gear with a face in the middle, small gear arms on the sides.

If the generator repaints the reference instead of a new creature, use a blank grid of the same size as the guide.
