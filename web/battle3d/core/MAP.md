# web/battle3d/core
The fight scene itself, split into closures: each file exports one makeX(B$) that hangs its functions on B$.
Entry: web/battle3d.ts imports every makeX and Object.assigns them into B$ (line ~244).

| file | lines | job | main exports |
|---|---|---|---|
| anim.ts | 179 | plays motion/attack/item/victory clips and binds techs to animations | makeAnim |
| atmos.ts | 182 | sky, weather and moon atmosphere: uniforms and their draw | makeAtmos |
| backdrop.ts | 252 | stage backdrop packs, data-field motion, arena texture and stage setup | makeBackdrop |
| blast.ts | 160 | digivolve / DNA form-change presentation, arena tint, orbs, revert camera | makeBlast |
| camera.ts | 473 | camera modes: canned, entrance, intro, loss, face box, idle director, slow-mo | makeCamera |
| fighters.ts | 226 | fighter actors: spawn, lanes, visibility, attack/react clips, extra meshes | makeFighters |
| model.ts | 269 | Digimon model load/preload, projectiles, actor resource teardown, white-out | makeModel |
| pano.ts | 365 | HD painted-panorama arena: capture, floor mask, ground probe, viewer grid | makePano |
| render.ts | 1089 | the one draw pass: clear, sky, arena/panorama, toon hull, fighters, effects | makeRender |
| smartcam.ts | 161 | heuristic camera search: scores candidate framings against the arena | makeSmartcam |
| toon.ts | 184 | toon outline hull pass (welded normals, lit body) | makeToon |
| types.ts | 32 | types only: the interfaces this folder's own code builds and fills in | — |

Where to look for:
- anything drawn on screen each frame -> render.ts
- camera framing, mode switches, face window -> camera.ts, ../camera-fit.ts
- a fighter spawning, posing, attacking or reacting -> fighters.ts, anim.ts
- arena art, backdrop layers, HD panorama -> backdrop.ts, pano.ts
- evolving / absorbing / form change -> blast.ts, model.ts
