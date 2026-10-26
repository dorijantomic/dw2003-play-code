---
reach: How to give a quest scene its own visual effect: a sprite sheet under web/extra_fx/, the small json beside it, and the scene steps that place it, move it, wait for it, fade the screen, drive the sky, run a chase or leave a prop behind. Read before adding an effect.
status: final 2026-10-23. Three sheets exist (crate, shard, frame), all drawn by tools/make_quest_fx.py. Every step below is played live: tools/verify_quest_all.mjs plays the one demo that uses all of them (zz_fx_all, Cipher on the Asuka Bridge) with screenshots in ~/scratch-research/quest-fx2/verify/.
---

# Effects, atmosphere and props for the extra quests' scenes

A scene (`web/quest-scenes.js`) can place our own art on any map, have it fall, slide, rise or fade, shake the field,
drive the map's own weather and time of day, flash lightning, run a chase the player has to keep up with, show a character
as a faded memory, fade the screen, fight you mid-scene or move you to another map. The walking, talking and camera steps
are the game's own; the effect art is ours, drawn for this project and stored in `web/extra_fx/` (**never** game art: the
repo is public). A quest can also leave our art standing in the world after it is done (`props`, section 8).

## What an effect is

Two files, both ours and both committed:

```
web/extra_fx/crate.png     ONE strip of frames, left to right, each `frame` pixels, transparent background
web/extra_fx/crate.json    { "name": "crate", "frame": [24, 24], "anchor": [0.5, 1],
                             "clips": { "fall":   { "frames": [0, 1], "hold": 3, "loop": true },
                                        "settle": { "frames": [3, 4, 5], "hold": 6 } },
                             "default": "settle" }
```

- `frame` — the cell size in game pixels. 24x24 fits a crate, a puff of dust, a gem; a big rock can be 32x32. Keep cells
  small: they are drawn at the game's own pixel scale, sprite by sprite.
- `anchor` — where the sheet's `(x, y)` sits inside a cell, 0..1 on each axis. `[0.5, 1]` = bottom centre (feet on the
  ground, what a crate or a rock wants); `[0.5, 0.75]` floats a shard a little above its point.
- `clips` — named frame lists. `hold` is the number of field blanks (60 a second) a frame stays up. A clip with
  `"loop": true` starts again; without it the clip holds its last frame, which is what makes a settled pose work.
  `default` is the clip a scene gets when it does not name one.
- nearest-neighbour pixels, no anti-aliasing, transparent background. The game draws the sheet 1:1 in its own coordinate
  space, so a 24 px crate is exactly as tall as the NPCs are wide.

The cells are drawn with the same palette feel as the game's own field art (bright flats, a dark outline, at most two
shades of a colour). They are not copies: the crate, the shard and the frame board were drawn by `tools/make_quest_fx.py`
from the numbers in its `PARAMS` block.

## Option 1: draw it from parameters (what exists today)

`tools/make_quest_fx.py` holds one entry per effect in `PARAMS` (cell size, anchor, colours, the clips). Add an entry, add a
`draw_<name>(params, index)` function that paints one cell, register it in `DRAW`, and run:

```
python3 tools/make_quest_fx.py
```

It writes both files and prints what it made. Look at the sheet enlarged before you use it: scale the PNG 8x with
nearest-neighbour (any image viewer) and check the frames read at 24 px.

## Option 2: a sheet from an artist or an image generator

1. Ask for ONE strip of frames, in a row, every frame the same square size, on a flat (not transparent) background the
   figures never touch: `4 frames of a wooden crate falling, each 24x24 pixels, pixel art, dark outline, flat colours,
   plain bright green background, no text, no shadow`.
2. Cut the background out (the game's own sprites have hard edges; `tools/make_quest_sprites.py` shows the trick: remove
   only the border colour that connects to the edge, so a green backpack survives).
3. Assemble the frames into one row of `frame`-sized cells, transparent, and save as `web/extra_fx/<name>.png`.
4. Write `<name>.json` by hand (the shape above).
5. Look at it in the game (below) before you commit it, and keep the source picture in `data/authored/quests/art/` only if
   it is ours to keep: generated art of our own is fine, anything cut from the disc is not.

## Using it in a scene

The steps are documented at the top of `web/quest-scenes.js`; the DSL helpers are in `data/authored/quests/dsl.py`.

| step | what it shows | helper |
|---|---|---|
| `fx`, `fxplay`, `fxmove`, `fxwait`, `fxremove` | our own sheet anywhere: appear, play a clip, fall + bounce, slide, rise, fade out | `fx fx_play fx_move fx_wait fx_remove` |
| `pan` | the camera to a point; back with `pan("player")` | `pan` |
| `drop` / `rise` | the PLAYER falls / is lifted N px and the room scrolls; the camera goes to the player on its own | `drop rise` |
| `fade` | the screen to black and back | `fade` |
| `battle` | a fight mid-scene; the scene goes on after a win or a flee | `battle` |
| `warp` | the player to another map and spot; the scene ends there, so it is last | `warp` |
| `shake` | the field shakes: `{shake: 6, frames: 20}`, or a row of thuds with `every`/`times` (a giant's footsteps). The text box and the menus stay still; the step waits for the last thud to die out | `shake` |
| `weather` | any Effects-panel weather on ANY map: `fog rain storm snow blizzard sand leaves fireflies clear`, with `strength`, `frames`, `force` | `weather` |
| `time` | the time of day on ANY map, indoors too: `day golden dusk night`, sliding there over `frames` | `tod` |
| `lightning` | 1-6 flashes on cue (thunder follows when weather sound is on) | `lightning` |
| `chase` | the target (an NPC id, or an effect's name) runs a path while the PLAYER keeps the controls and must stay within `lose` px | plain dict |
| `ghost` | that character drawn faded and tinted for the rest of the scene (a memory replay); `{ghost: n, off: true}` restores them | plain dict |

```python
fx("crate", at=[1056, 120], clip="fall", fall={"floor": 424, "step": 0.7})   # place it and let it fall
fx_wait("crate")                                                             # wait for it to land
fx_play("crate", "settle")                                                   # switch to the settled pose
fx_remove("crate", fade=20)                                                  # fade it away (or drop the `fade` and it vanishes)
pan([1056, 350])                                                             # the camera to a point (FN6B)
pan("player")                                                                # and back to following the player (FN6A)
fade("out", 30)                                                              # the screen to black
drop(100)                                                                    # the player falls 100 px (the s680 drive)
rise(96)                                                                     # ... or is lifted that far
battle(34)                                                                   # a fight mid-scene; the scene goes on after a win
warp("s320", [576, 448])                                                     # to another map: the LAST step (the scene ends there)
shake(5, frames=10, every=26, times=4)                                       # four thuds, as if something enormous walked by
weather("fog", strength=1.0, frames=60)                                      # the panel's fog on a map that has none
tod("night", frames=90)                                                      # night in the middle of the day
lightning(2)                                                                 # two flashes
{"chase": 1005, "path": LAP, "speed": 120, "lose": 96, "frames": 720}        # keep up with Cipher (0 kept / 1 lost)
{"ghost": 1005, "alpha": 0.35, "tint": "#9fc8ff"}                            # Cipher as a faded memory
{"ghost": 1005, "off": True}                                                 # and back
```

Rules that matter:

- **A scene never blocks on art it does not have.** A sheet that will not load, an effect that was never placed, a map that
  does not exist, a chase target that is not on the map: that one step is skipped and the scene goes on. So a missing file
  spoils one moment, not the quest.
- **Nothing a scene placed stays behind.** Every effect is removed when the scene ends or is skipped, before a mid-scene
  fight, on a warp, on a map change and on every stage entry (so an ordinary map change or a loaded save clears it too).
  A sheet left on screen on another map is a bug, not a style choice. **Exception: a prop** (section 8) — it is named
  `prop:<key>` and is quest state, re-placed on the next frame. A check for "is anything left after the scene" must ignore
  `prop:` names.
- **Layer.** `"entity"` (the default) puts the effect in the field's one y-sorted draw list, so it stands in front of or
  behind the people exactly as a sprite does. `"behind"` draws it over the map but behind every person; `"front"` draws it
  over everyone (a glow, a marker).
- **The motions are the game's own maths.** A fall adds `step` px per blank to a velocity and bounces as `-v/3` on reaching
  `floor` (the s415 rock fall); `drop` writes the field character's own `+0x54` word (the s680 floor collapse), so the room
  scrolls rather than the sprite bobbing. A `drop`/`rise` moves the camera to the player first, so a `pan` to a point is
  released by it; put `pan("player")` after it if the scene needs the camera back on the player.
- **A fade is a plain black cover**, not the game's stage-change wipe: the wipe would make the map the quest is still
  standing on think the player just arrived (and fire its arrival events).
- **A warp ends the scene** (`HANDOFF`'s own rule). Put it last, and give the player a spot that is walkable on the new map.
- Effect sheets are drawn at the game's native scale, not from the HD art set, so in HD asset mode they look smaller
  against the map. That is a known limit, not a bug to work around in data.

## Atmosphere: weather, time of day, lightning (web/ambience.js)

The F2 Effects panel already draws, per map: rain, snow and blizzards, sandstorm, lightning, wind gusts, cold breath,
frost, screen rain; time of day (day / golden / dusk / night) with lit circles, lamp glow, light pools, fog and mist,
light shafts, heat shimmer, ice sparkle, pollen, cloud shadows; falling leaves, fireflies, dust devils; footprints, dust,
puddles and ice; and the sounds that go with them. A scene does not redraw any of it: `weather`, `time` and `lightning`
drive that layer through a scene override (`setAmbienceScene`, `web/ambience.js`).

- **Any kind on any map.** The map's own profile does not decide: fog on the Asuka Bridge, snow in a desert. `weather` takes
  `fog rain storm snow blizzard sand leaves fireflies clear`; `storm` is rain + lightning, `clear` is no weather at all.
  It fades in over `frames` and blocks until it is there. A later `weather`/`time` step merges over the same override.
- **The player's own switches are respected.** An effect they turned off in F2 stays off unless the step says
  `force: true` (then it shows anyway). Default: respect the switches; the words must carry the moment with the effect off.
- **`time` works indoors too**, and slides there over `frames` (the day literally passes). The panel's own time pin is handed
  back when the scene ends.
- **Everything is restored on every exit**: scene end, skip, mid-scene fight, warp, map change, load, F2 Quests off. After a
  scene the map's own sky is back (`window.__questFx.sky()` is `null`) and `window.__todForce` is what it was.
- **Pick the map for the look, not just the state.** Fog draws as soft pale blobs; on the Bridge's white stone it is
  measurably drawn (about 23k pixels changed at strength 1) and still invisible to the eye (mean change ~2/255). The step
  is right, the place is wrong: a fog moment wants a darker map or the night. Sand, snow and lightning read anywhere.
- Do not invent a second weather system and do not draw weather with `fx` art.

## Props: the world the quest changed

A prop is **our own sheet art left standing on a map because of the quest's state** — a sign put up, a crate moved, a
grave dug, a lamp lit, a bridge repaired. It is quest data, not a scene step (`web/quest-props.js`):

```json
"props": [ { "map": "s205", "sheet": "frame", "at": [936, 302], "clip": "idle",
             "layer": "entity", "after": "done", "solid": true } ]
```

- `map` a map id (a night/story variant counts as its place, `sameMap`); `sheet` a sheet in `web/extra_fx/`; `at` the
  world pixels of the prop's feet (the sheet's anchor decides where that lands in the cell).
- `after` `"done"` (the default: once the quest is handed in) or `"accepted"` (from the moment it is taken).
- `layer` `"entity"` (default, y-sorted with the people), `"behind"` or `"front"`.
- `solid` off by default. `true` adds a small foot box to the disc's standing-actor probe, so the player bumps into it like a
  person and can always back away — a bump, never a wall, never a trap.
- Authored with `prop(place, sheet, at, clip=..., layer=..., after=..., solid=...)` in `dsl.py`; `tools/build_quests.py`
  carries the list and `tools/check_quests.py` checks the map, sheet, clip, `after`, layer, `solid` and `at`.

How it lives: the layer re-places every prop from the **saved quest state** on every frame, so a scene's clear, a warp, a
fight, a map change, a load or a reload cannot lose it (a frame may show none; the next tick restores it). A state change
while the player stands on the map shows or drops it on the next frame, with no reload. F2 → Extras → Quests off hides the
whole layer at once. Because a prop shares the scene effects' live list under a `prop:` name, "nothing an effect placed may
be left after a scene" must ignore `prop:` — a prop is meant to be there.

## Chase

`{"chase": 27, "path": [[x, y], ...], "speed": 130, "lose": 90, "frames": 600}` — the target (an NPC on this map, or one
of our own effects by name) runs the path at `speed` px/s while the PLAYER keeps the controls (movement, collision, the
party following); the camera is put on the player and stays there. The player must stay within `lose` px; falling behind
for about a second, or still being far away when `frames` runs out, loses it. Encounters are suppressed during the run.

The run's result comes back on the same channel as an `ask`: **0 = kept up, 1 = lost**. A loss ends the rest of the scene
right there (the words after it never play) and it **never fails the quest**: the step stays open, the quest stays active,
and talking to the giver again starts the run again. Put the chase inside the quest's own `talk` step (with
`retryLines`) when the lap IS the job — that is how `zz_chase_demo` does it. The target's path must be walkable for the
player's own foot box; keep it inside the map's open ground and end near where the scene goes on.

## Ghost

`{"ghost": 27, "alpha": 0.5, "tint": "#9fc8ff"}` — that character is drawn faded and tinted for the rest of the scene
(a memory replay, a recording, a spirit); `"player"` works as the target. `{"ghost": 27, "off": true}` puts them back.
Every ghost is cleared on every scene exit and when F2 Quests is switched off. It is a look, not a second body: a ghosted
character still walks, talks and blocks like themselves.

## Walkable ground: where a scene may put a character

The cutscene VM's own walk driver steps straight toward a target with **no collision test**: a `WALKTO` whose line
crosses a wall walks through it. Quest scenes are built from a giver's post plus wherever the player happens to stand, so
they get a router (`web/quest-walk.js`, handed to `compileScene` by `web/game.js playQuestScene`; the disc's own story
scenes never get one and are untouched):

- A `walk` whose straight line is clear compiles to **one `WALKTO`, exactly as before** — nothing changes for a scene that
  was fine.
- A `walk` that would cross a wall compiles to a few short `WALKTO` legs around it with `WAITIDLE <actor>` between them
  (the VM holds one target per actor). Legs are computed from where the previous step left the character.
- A destination inside a pocket nothing can reach: the character walks as far toward it as the map allows and stops on the
  nearest ground they can really stand on. A walk step always finishes — it can never hang and never crosses a wall.
- A small step (24 px or less) to a spot that is not standable is walked as written (an NPC stepping back off their own
  counter cell must not wander off).

What an author must keep true, and what `python3 tools/check_quests.py` fails on (it runs `node tools/check_quest_walks.mjs`,
which uses the same geometry as the router):

- every spot a scene names for a character — `walk` (a point, `"origin"`, `{near, gap}`, `{near, dx, dy}`), `put`, a
  `warp` arrival, and every point of a `chase` path — is on ground the player's 12 x 8 foot box can stand on;
- a `warp` lands in the part of the new map its exits open onto, not in a sealed room;
- a `drop`/`rise` landing is checked when an earlier `put` said where the player is.

Not checkable at build time: a place relative to the player (`{ "near": "player" }`, 510 of 1562 places today — most of
the DSL's walking offer scenes). The router handles those at run time; they are counted as skipped, not failed.
`together`, `apart` and `face` are unchanged (`together` was already planned against free ground, the other two move
nobody). The full description, measured numbers and what is not covered: `~/scratch-research/quest-fx2/WALK.md`.

`questStandIns` (the copy of a character who is not on the map): it stands on that character's post as it is, and is only
nudged when someone else is standing there — then to walkable ground clear of everyone, falling back to the post.

## Checking it

- `node --test tests/quest-scenes.test.js tests/quest-fx.test.js tests/quest-sky.test.js tests/quest-chase.test.js
  tests/quest-ghost.test.js tests/quest-props.test.js tests/quest-edge.test.js` — every step compiles and validates, the
  effect list itself (fall, bounce, settle, clips, fade, remove, the player drive, cleanup), the sky override, the chase
  machine, the ghost table, the prop layer, and the edge cases.
- In the browser: `python3 tools/build_quests.py --with-drafts`, then `web/quest-lab.html` and play the drafts:
  - `zz_fx_all` ("Cipher's full sweep") plays EVERY step in one scene: shake thuds, fog, night, lightning, a ghost, a
    crate that falls/settles/slides/fades, a real fight, a chase, a drop, a rise, a fade, a warp — and leaves a board
    beside Cipher once it is handed in.
  - `zz_fx_demo` is the short part-1 demo (crate, pan, fade, drop, warp); `zz_sky_demo`, `zz_chase_demo`, `zz_ghost_demo`
    and `zz_props_demo` each show one family.
  - The lab's **Go** button calls `lab.prepare(id)`, which now also *focuses* that quest: only it may be offered at its giver
    while it holds, so several demos sharing one character can be played one by one.
- `tools/verify_quest_all.mjs` plays `zz_fx_all` start to end headless (screenshots in
  `~/scratch-research/quest-fx2/verify/`), then twice more with the scene aborted half-way (mid-shake, and with fog + night
  + a ghost + the crate showing) and once with F2 → Quests switched off mid-scene, checking that the sky, the ghosts, the
  shake and the effect art are all gone. The other demos' scripts: `verify_quest_fx.mjs`, `verify_quest_sky.mjs`,
  `verify_quest_chase.mjs`, `verify_quest_ghost.mjs`, `verify_quest_props.mjs`, `verify_quest_edges.mjs`.
- In the console: `window.__questFx.state()` lists what is on the map right now (props included, under `prop:`),
  `window.__questFx.sky()` the scene's weather/time override, `window.__questFx.ghost()` the ghosts, `window.__questProps.state()`
  the props, `window.__questChase()` a running chase. `window.__questFx.clear()` empties the scene layer (what the game
  itself calls on every exit path).
