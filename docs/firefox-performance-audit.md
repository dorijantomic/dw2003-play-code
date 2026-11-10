# Firefox performance audit (read from code, 2026-11-10)

Read-only audit of `web/` on branch `integration/all` (commit 85e5fece2). Nothing was run: no browser, no timing, no
picture. Every line below is either **CONFIRMED** (read in the code, file:line given) or **GENERAL** (general browser
knowledge, not shown by this code). Anything not read is "not known yet". No disc-derived data is quoted.

## 0. Who gets what (decides which effects can even run)

`web/ship-list.js` sets the default per switch:

- **ON for players ("in")**: sway, grass, grasspush, water, reflect, mirror, wetlook, seam, rain, rainwater, snow, sand,
  lightning, gusts, breath, frost, screenfx, tod, nightlight, clouds, lamps, lightpool, lightreveal, indoor, fog, shafts,
  heat, sparkle, pollen, leaves, fireflies, steps, puddles (`ship-list.js:15-23`).
- **ALWAYS ON ("auto")**: widefield, battlewide, uisharp (xBR battle menus), smartcam, mpbubbles, mpcredit, glossary, options,
  dw2motion (`ship-list.js:24`).
- **OFF for players ("out", owner's PC only via F2)**: hd2d, **battleatmos** (battle night/moon/stars/fog/snow/rain/sand/
  lightning/water), **battlepano** (painted 360 backdrops), toonoutline, toonshade, softalpha, mount, and more (`ship-list.js:25-31`).
- **Built three.js arenas (`web/built/*.js`, `web/arena-built.js`) are not in the game.** Only `arena-viewer.html` imports
  `arena-built.js` (grep over `web/`: `arena-viewer.html:109`, plus other built/* and viewer tools). `battle3d.js:2963` and
  `:6190` only expose the hook. So they cannot slow the played game; they matter only for the Arena Viewer page.

So for a Firefox player the live cost is: the 2D field canvas + field effects (section 2A), grass3d/water3d (2B), and the
ordinary 3D battle (2C). Battle sky/weather/backdrops (2D) and built arenas (2E) cost only where the owner turned them on / on the viewer page.

## 1. Renderer setup

| # | where | what | antialias | pixel ratio | powerPreference | preserveDrawingBuffer | logDepth / shadows / tone map |
|---|---|---|---|---|---|---|---|
| 1 | `web/game.js:825` main field canvas `#game` | 2D context, no `willReadFrequently` | n/a | HD mode: backing = CSS size x `devicePixelRatio`, longest side capped 4096 (`canvas-resolution.js:23-37`); Authentic 640x480 | n/a | n/a | n/a |
| 2 | `web/grass3d.js:53-57` | three WebGLRenderer on a hidden canvas, 640x480 (`VIEW_W*2` x 480; wider with Wide overworld) | **true** | `setPixelRatio(1)` | default | default (false) | none set |
| 3 | `web/water3d.js:43-46` | three WebGLRenderer, hidden canvas, same size | false | `setPixelRatio(1)` | default | default | none set |
| 4 | `web/mount3d.js:575-576` | three, hidden canvas (mount, OUT) | false | 1 | default | default | none set |
| 5 | `web/battle3d.js:1985-1986` via `battle.js:3308-3309` | raw `getContext("webgl")` on an `OffscreenCanvas`, blitted to the 2D canvas each frame (`battle.js:9542-9543`) | **true** | canvas = stage size x min(dpr,2), long side capped 1600 (`battle.js:3236-3244`) | default | default | no shadows, no tone map (grade is in the fragment shader) |
| 6 | `web/game.js:431` glossary stage | another `createBattle3D` (lazy) | true | own canvas | default | default | same |
| 7 | `web/mpbattle.js:173` many-vs-many fight | `createBattle3D(U.off)` + a view canvas + a 2D ui canvas | true | `battle-fs` canvases | default | default | same |
| 8 | `web/gpu-pixel-filter.js:168` | WebGL2 pipeline (OffscreenCanvas 1x1 for the battle-menu xBR copies; overlay canvas when the F2 filter is on) | false | n/a | default | **true** | none |
| 9 | `web/post2d.js:66` | WebGL2 overlay, only with hd2d (OUT) | false | follows game canvas size | default | default | none |
| 10 | `web/arena-built.js:49` | three on `builtCv` 960x720 (Arena Viewer only) | **true** | default (1) | default | default | `outputColorSpace` sRGB only |
| 11 | `web/built/post.js:274-290` | three on the visible viewer canvas | false | 1 | default | default | NoToneMapping; own ACES in shader (`post.js:280`) |
| 12 | dev pages: `arena-add-picker.js:67` (preserveDrawingBuffer true), `biome/gallery.js:26` (powerPreference "high-performance"), `model-viewer.html:210`, `anim-viewer-dw2.js:472` (preserveDrawingBuffer true), `battle-test.html:172,201` | dev only | mixed | 1 | | | |

- `logarithmicDepthBuffer`: not used anywhere (CONFIRMED by grep).
- Shadow maps: not enabled anywhere; the only hits are `shadowMap.autoUpdate` save/restore in `built/water.js:1032-1039` and `biome/lakeproc.js:558-563`.
- Tone mapping: only `built/post.js:280` (NoToneMapping; ACES is hand-written in its final pass).
- `powerPreference` is set only on the dev gallery (`biome/gallery.js:26`). The game never asks for high-performance (relevant to laptops with two GPUs; effect in Firefox: GENERAL).
- Canvases/contexts alive at once:
  - Field, game running on a grass+water map: 1 visible 2D canvas + grass3d GL + water3d GL = **3** (+1 `gpu-pixel-filter` GL context the first time a battle menu sheet is filtered, +1 glossary GL when opened).
  - In a fight: field 2D + 1 OffscreenCanvas GL (+ grass3d/water3d contexts stay alive, they are never destroyed: `grass3d.js:37`, `water3d.js:22`).
  - Arena Viewer built look: `#cv` 2D + battle3d OffscreenCanvas GL + `builtCv` GL (arena-built) + post GL = **4** (`arena-viewer.html:103-118`), all 960x720.

## 2. Effects: what each draws per frame

### 2A. Field, 2D canvas (all default ON for players)

Everything below draws onto the one 2D canvas. In HD Remaster that canvas is as big as the display (item 1 above), so
every full-view fill/gradient scales with device pixels. `ambienceFor` returns one closure that `game.js:11023-11025` runs each frame.

| effect | file:line | per frame |
|---|---|---|
| time of day | `scenery.js:153-171` | full-view `multiply` fillRect + a full-view radial-gradient vignette when dusk > 0.12 |
| night snapshot for lamp reveal | `scenery.js:121-127`, `scenery2.js:119-146` | when lamps+reveal apply at night: `takeSnap` = whole canvas copied to a 2nd canvas (`copy`), then another whole-canvas-size canvas copy + `destination-in` + draw back; mask 320x240 filled with up to N radial sprites |
| heat shimmer (sand maps) | `scenery.js:174-186` | whole canvas copied to `tmp`, then `canvas.height/3` `drawImage` strips (480 at 1440 high) |
| light shafts | `scenery.js:189-212` | 6 shafts x 2 gradient quads, `lighter` |
| fog / mist | `scenery.js:216-227` | 9 radial gradients (radius 90-180) created and filled per frame |
| pollen | `scenery.js:230-243` | 80 arcs, `lighter` |
| butterflies, birds | `scenery.js:246-286` | 26 / 3-5 small paths |
| ice sparkle | `scenery.js:289-302` | up to 340 candidates, ~14% drawn |
| lightning | `scenery.js:305-321` | full-view `lighter` fill 0.5 alpha for ~0.6 s |
| cloud shadows | `scenery2.js:319-331` | 5 clouds x 3 radial gradients radius 100-190 |
| lamps / windows | `scenery2.js:335-357`, `drawGameLight` `:83-106` | per lamp on screen: pool sprite, bloom drawImage, 2 sheet drawImages with `lighter`; non-record lamps: 2 gradients + arc |
| lamp bloom bake | `scenery2.js:40-70` | once per lamp type: canvas with `filter = blur(...)` and a **getImageData** of it (cached) |
| night light | `scenery3.js:58-90` | 320x240 canvas: full fill, then one `destination-out` radial gradient per party member / lamp / window, then drawn scaled up to the field canvas |
| window glow | `scenery3.js:92-115` | 2 gradients per window, `lighter` |
| screen rain / storm lens | `scenery3.js:118-151` | full-view vignette gradient; `saturation` blend full-view fill in blizzard; <=16 lens drops |
| rain on water | `scenery3.js:229-246` | <=40 ellipse strokes |
| rain | `ambience.js:850-879` | full-view fill + **170** separate stroked paths (each sets `globalAlpha`) + <=60 splash ellipses |
| snow / blizzard | `ambience.js:800-828` | **230** arcs; blizzard +**260** strokes + 2 full-view fills |
| sandstorm | `ambience.js:829-849` | full-view fill + 9 radial gradients radius 70-170 (each a big `fillRect`) + **260** strokes |
| leaves | `ambience.js:778-799` | 24-74 leaves, each `save/translate/rotate/scale/ellipse/restore`; feet loop per leaf |
| fireflies | `ambience.js:761-774` | up to 280 `drawImage` of an 18x18 glow, `lighter` |
| frost | `scenery2.js:537-541` | one 320x240 canvas drawn (built once, `:250-280`) |
| cold breath, gusts, wildlife, dust devils | `scenery2.js:360-369, 511-534, 459-508` | tens of small paths / gradients |
| wet / dusty look | `ambience.js:925-929` -> `game.js:10097-10099` | `ctx.filter = brightness() contrast() saturate()` (or `sepia() brightness()`) set around **every body's sprite draw** while wet > 0.06 or sand > 0.2 |
| water mirror of characters | `game.js:10087-10095` | per body standing in water: `ctx.filter = "brightness(0.78) saturate(0.85) blur(0.5px)"`, flipped second draw |
| swaying trees | `treesway.js:138-165` | for each 24x2 cell of every canopy in view: one `drawImage` (up to ~120 rows x ~14 cols = ~1,700 per frame at 320 view; fewer where no canopy); plus a patch canvas draw |
| ground effects (steps, puddles, ice) | `scenery.js:361-485` | <=160 footprints, 30-46 puddles/ice (3 paths each), ripples, 80 splash arcs |
| seam fix | `seamfix.js` / `game.js:10551-10553` | one patch canvas drawImage; full-map `getImageData` once per map |
| omen | `ambience.js:880-913` | OFF for players |

Per-map one-off cost (map entry spike): `getImageData` of the whole map picture in `ambience.js:203,304,319`
(`scan`, `pixOf`, `pixOfImg`), `grass3d.js:175-177` (1-2 maps), `water3d.js:197-199`, `treesway.js:28-30` (fg + base,
plus a flood fill over all pixels, `:43-59`, plus a 90-pass colour grow `:92-108`), `seamfix.js`, `scenery2.js:182-225` (findLamps, unused path). All use `willReadFrequently: true`. Native map pixel sizes: not known yet.

Every `drawImage` on every 2D context goes through a JS wrapper that takes `...args` and does a `Map` lookup plus a
`pixelFiltered()` call (`assets.js:170-206`, installed `game.js:826`). In HD mode it also flips `imageSmoothingEnabled`
around HD-image draws (`assets.js:197-206`) and sets `imageSmoothingQuality = "high"` each frame (`canvas-resolution.js:169`).

### 2B. grass3d / water3d (default ON, field maps with grass / water only)

- `web/grass3d.js:282-333`: one three.js render per frame to a hidden 640x480 canvas (antialias true). Blades are `InstancedBufferGeometry`, 5 rows = 10 verts, 8 tris each (`:123-139`); 3 blades per 5x5 map-pixel cell that passes a solid-grass test (`:30-32,236-258`); bands of 128 map rows, **whole width** of the map, culled by row only (`:29,307-310`). Vertex shader runs an 8-iteration feet loop per vertex (`:96-104`). Blade count per map is printed at build (`:294`); actual counts: not known yet. Upper bound per visible band = map width / 5 x 128 / 5 x 3 blades.
- Result pasted into the 2D canvas as **30 `drawImage` strips of 8 rows** (240 / 8) per frame, each its own entry in the y-sorted list (`game.js:10584-10594`).
- `web/water3d.js:238-260`: one full-view quad per frame, fragment shader with 3 `normalize`d sine waves, `pow(spec, 90)`, 3 texture reads (+1 reflection read), `discard` outside the mask (`:60-126`). One `drawImage` of the result (`game.js:10580-10582`).
- No texture uploads per frame (map texture set once, `needsUpdate` once at build `:218-227`). No `needsUpdate` each frame.
- `renderer.setSize` is only called when the width changed (`grass3d.js:286`, `water3d.js:242`).

### 2C. 3D battle (always the ordinary path)

- `web/battle3d.js:1256-1281` `arenaCullIndices`: per arena group, per frame, a JS loop over every triangle: builds a `Map`, per-triangle `xy` arrays (`projTri`), pushes indices into a JS array. Then `drawProjLayerIndexed` does `new Uint16Array(idx)` + `bufferData(DYNAMIC_DRAW)` (`:1307-1308`) per group per frame (called `:5561-5563`). Triangle counts per arena: not known yet.
- Fighters: `_updateSkeletalVBOGL` allocates `new Float32Array(totalVerts*3)` and `bufferData(DYNAMIC_DRAW)` per fighter per frame (`:899,948`).
- One shared fragment shader (`:69-157`) with `mediump` floats; all extra features are uniform-gated branches (water waves `:88-103`, stars/moon `:122-137`, scene light, toon, soft alpha 3x3 taps `:77-86`). With everything off the cost is one texture read + fog mix.
- Canvas copy: whole OffscreenCanvas drawn to the 2D canvas every frame (`battle.js:9542-9543`), canvas up to 1600 px long side. Effects sprites drawn over it with `lighter`/`difference` (`effects.js:658-662,1301-1303`, `battle.js:9656-9662`).
- `render` clears and re-binds per frame; no render targets, no readPixels in the frame path (readPixels only in capture tools `:4886, 6059`).

### 2D. Battle sky / weather / backdrops (OUT for players; owner only)

- `_atmosFrame` `battle3d.js:4367-4403`: JS only, cheap.
- `_drawWeather` `:4492-4559`: up to **900 snow + 800 rain + 700 sand particles** (`want`, `:4493`). Every frame a JS loop over all particles writes 6 verts x 7 floats each into a **new `Float32Array`** (900 particles = 37,800 floats; 2,400 = 100,800) and `bufferData(DYNAMIC_DRAW)` (`:4512,4535`). Blended quads, no depth write. One draw call.
- Night sky, stars, moon, water: all in the shared fragment shader (`:116-137, 88-103`), gated per texel by blue-sky / water-colour tests. `hash3` uses `sin`; stars: one `floor(d*420)` cell hash per sky texel.
- `_atmosMoonPick` `:4431-4490`: once per arena after 1.5 s, synchronous CPU ray cast: up to 63 candidates x (1 + 4 edge rays) over every arena triangle. Triangle counts: not known yet.
- Painted backdrop (`_drawPano` `:4836-4852`, `_drawArenaPaint` `:4627-4682`): one 4x-upscaled panorama texture (size not read: not known yet), a depth-mesh with `indexCount` unknown, **plus** `arenaCullIndices` over the disc arena and a per-group `new Uint16Array` + `bufferData` split into floor/other lists every frame (`:4672-4681`). Texture loads via `loadTexturePixels` (canvas `getImageData`, `battle3d.js:1085-1088`) once per picture.

### 2E. Built three.js arenas (Arena Viewer page only)

Per frame in `arena-viewer.html:408-421` (own `requestAnimationFrame`, `:424-425`), canvas fixed 960x720:

- `arena-built.js:171` calls `renderer.setSize(canvas.width, canvas.height, false)` **every frame**; three's `setSize` assigns `canvas.width/height` unconditionally (`lib3d/three.module.js:16708-16722`). Whether Firefox reallocates the drawing buffer on a same-size assignment: not known yet.
- Scene render of the whole world (`arena-built.js:179`), including: grass 450,000 flat blades (`built/grass.js:26,35`); sky shader with a 24-step bisection and ring loop (`built/sky.js:215-229`); 3D cumulus 66.6k tris; trees/foliage/boulders/mushrooms/spires/gulls (counts in their files; measured ms in INDEX lines, not re-measured here).
- Water: planar reflection = a **second full scene render** into a half-size HalfFloat render target with depth every frame (`built/water.js:985-1041`, `REFL_SCALE 0.5` `:901`); the water fragment shader loops `WATER.ROWS = 8` (`:140, 537`).
- Post (`built/post.js`, on by default in the viewer built look): both source canvases uploaded as textures each frame via `cur.needsUpdate = true` (`:372-375`, a canvas-to-texture copy x2 at 960x720), one 4x MSAA HalfFloat composite target (`:287-293`), then bright pass + 3 down passes + 8 separable 9-tap blur passes + final = **14 full-screen passes** (`:389-428`).
- Then `ctx.drawImage(post.canvas)` into the page canvas (`arena-viewer.html:416`), and `drawImage(off)` for the fighters (`:420`).
- Render-target switches per frame: about 14 (post) + 1 (reflection). Per-frame allocations: three's own (matrices etc.); a `renderer.info` read; `new THREE.Vector3` in `groundHeight` only on demand.

## 3. Page-level costs

- **CSS filters / backdrop-filter / blur / mix-blend-mode over the canvas: none found** in `index.html` or in any game JS (grep for `backdrop-filter`, `mix-blend-mode`, `filter:`, `drop-shadow`, `blur(` over `web/*.html`, `web/*.js`; the only `blur(` are canvas-context filters, see 2A). `index.html:69` has one `box-shadow` on the hidden asset-mode panel. Title screen has `opacity` transition (`index.html:93`) and `@keyframes blink` (`:142`).
- Over-canvas DOM when online: `#mp-dock` with `text-shadow` and semi-transparent backgrounds (`mpsocial.js:620-636`). Many-vs-many fight: card `box-shadow` glow, `filter: grayscale(1)` on KO cards, `@keyframes mpbfloat` (`mpbattle.js:54-67`). `#fx-gear` opacity transition (`ambience.js:1086`, owner only).
- Overlay canvases: `post2d` and `pixel-filter` overlays are created (hidden `display:none`) at start (`game.js:502-503`); they stay hidden while their switches are off.
- **Canvas 2D `filter`** (the canvas-context kind, not CSS): `game.js:10091,10098` (per body sprite), `scenery2.js:48` (once per lamp bake), `fight/effect-player.js:314` (`invert(1)` with `multiply`).
- 2D canvases without `willReadFrequently` that are drawn to every frame: the main canvas (`game.js:825`, correct: it is not read), `scenery3.js:62` night light (never read), `scenery.js:124` snapshot canvas (never read). Canvases that are read use `willReadFrequently: true`. The canvas that is read back per frame is **mount3d's `scratch`** (`mount3d.js:930-955`: draw, `getImageData`, per-pixel palette, `putImageData`; mount is OUT).
- `getImageData` in the frame path: only `mount3d.js:933` (OUT). `readPixels` in the frame path: none (`mount3d.js:856,868` self-test only). `toDataURL`: none in the frame path.
- `requestAnimationFrame` loops alive during the field: `game.js:8625,8644` main `frame` (capped at 61 fps by skipping early `:8624-8627`), `game.js:8617` `padLoop`, `gpu-pixel-filter.js:361` (returns at once when off), `post2d.js:112` (returns at once when off) = **4**. In a many-vs-many fight `mpbattle.js:209` adds a 5th. Title screen adds `titleFrame` loops (`game.js:3820-4014`). Arena Viewer: 1 loop (`arena-viewer.html:425`).
- `setInterval`: `multiplayer.js:444` every **50 ms** (`sendPresence`; whether it does work offline: not known yet); `mpsocial.js:734-735` 1500 ms and 400 ms; `game.js:1846` every 3000 ms; `showcase.js:44` (dev tour).
- WebAudio: weather/ambience noise is built from looping noise buffers + biquad filters (`fxaudio.js:11-19, 73-91, 137, 193`); no ScriptProcessor / AudioWorklet found. Cost: not known yet.

## 4. Firefox-specific

**Code that branches on the browser: none.** Grep for `firefox`, `gecko`, `userAgent`, `navigator.vendor`, `isFirefox` over `web/`, `launcher/`, `docs/` (excluding vendored libs): zero hits (CONFIRMED). The game runs the same path in every browser.

Slow paths this code hits. "CONFIRMED" = the code does it. The Firefox cost itself is GENERAL knowledge and was not measured here.

| item | in the code (CONFIRMED) | Firefox cost (GENERAL, not measured) |
|---|---|---|
| WebGL canvas -> 2D `drawImage` every frame | grass (30 strips) `game.js:10584-10594`, water `game.js:10582`, battle OffscreenCanvas `battle.js:9543`, viewer `arena-viewer.html:416-420` | a cross-context copy can become a GPU readback + CPU upload when the 2D canvas is not GPU-backed; depends on Firefox's canvas acceleration for this machine: not known yet |
| 2D canvas `filter` | `game.js:10091,10098` per body | canvas filters are applied on a software path in Firefox |
| Large 2D canvas | HD backing up to 4096 px on a side (`canvas-resolution.js:23-37`) | fill-rate bound if 2D canvas is software; acceleration state: not known yet |
| Many small canvas ops | rain/snow/sand/leaves/treesway (section 2A) | thousands of `beginPath/fill/stroke/drawImage` per frame are a CPU cost in any browser; relative to Chrome: not known yet |
| Prototype-patched `drawImage` with rest args | `assets.js:182-206` on all 2D contexts | wrapped built-ins with spread args can run slower than native calls in Firefox's JIT; not measured |
| Same-size `canvas.width` assignment | `arena-built.js:171` via three `setSize` every frame | may clear / reallocate the drawing buffer; not known yet |
| `preserveDrawingBuffer: true` | `gpu-pixel-filter.js:168` (only when the filter / HD battle menu sheets are used) | forces a copy of the buffer on present; small canvas for menus |
| `antialias: true` on 4 contexts | `grass3d.js:54`, `battle3d.js:1986`, `arena-built.js:49` | MSAA cost on the GPU; Firefox applies it the same way; no data |
| MSAA + HalfFloat render targets | `built/post.js:287-293` (viewer only) | `samples: 4` on a half-float target needs `EXT_color_buffer_half_float`/WebGL2 blit; support on the machine: not known yet |
| Many render-target switches | 14 passes + reflection (viewer only) | each switch is a GL state change; Firefox's WebGL runs through ANGLE like Chrome; no extra data |
| Large `getImageData` | map entry (2A, one-off) and `mount3d.js:933` (per frame, mount OUT) | sync readback; Firefox is slower on non-`willReadFrequently` canvases; ours use the flag |
| Sync GPU readbacks | none in the frame path | n/a |
| High pixel ratio | field: yes (HD, capped 4096); battle: min(dpr,2), 1600 cap; three canvases fixed at 1 | field canvas scales with display; Firefox on a 4K / scaled display gets the largest 2D canvas |
| CSS filter / backdrop-filter over WebGL | none | n/a |
| `imageSmoothingQuality = "high"` | `canvas-resolution.js:169` every field frame | Firefox may ignore it; not known yet |

## 5. Ranked suspects (facts only, nothing measured)

1. `web/canvas-resolution.js:23-37` with `web/scenery.js:160`, `web/ambience.js:829-879`: the HD field canvas is display size x dpr (up to 4096) and ~10-20 full-view fills/gradients/strokes run on it every frame; every cost scales with device pixels.
2. `web/game.js:10580-10594` + `web/grass3d.js:282-333` + `web/water3d.js:238-260`: two always-on extra WebGL contexts (one antialiased, full-map-width instance bands) copied into the 2D canvas each frame (30 strip draws + 1).
3. `web/game.js:10084-10099`, `web/ambience.js:925-929`: canvas `filter` set around every body sprite while wet/sandy, and a blurred flipped second draw per body in water (Firefox software path: GENERAL).
4. `web/battle3d.js:1256-1281,1307-1308,5561-5563,899,948`: the always-on battle path does JS triangle culling with per-triangle arrays and a new typed array + `bufferData` for every arena group and every fighter every frame.
5. `web/battle.js:9542-9543` + `web/battle3d.js:1985-1986`: antialiased OffscreenCanvas GL (up to 1600 px) copied whole into the 2D canvas every frame.
6. `web/scenery.js:174-186`, `web/scenery.js:121-127`, `web/scenery2.js:119-146`: heat shimmer, lamp snapshot and reveal copy the whole HD canvas (some twice) and issue one `drawImage` per 3 device rows.
7. `web/treesway.js:138-165`: up to ~1,700 `drawImage` calls per frame for swaying canopies (cell 24x2), on every map with canopies (default ON).
8. `web/ambience.js:778-879`, `web/scenery.js:216-227`, `web/scenery2.js:319-331`, `web/scenery3.js:58-90`: hundreds of separate paths/strokes and dozens of radial gradients per frame (rain 170, snow 230, storm 260, sand 260+9, fog 9, clouds 15, night-light holes).
9. `web/assets.js:182-206`: every `drawImage` of every 2D context passes through a patched JS wrapper (rest args, `Map` lookup, filter hook, smoothing toggles in HD).
10. Owner/dev only: `web/battle3d.js:4474-4559` (900-particle weather rebuilt in JS each frame), `web/battle3d.js:4660-4682` (painted-backdrop per-frame split + upload), and the Arena Viewer stack (`web/arena-viewer.html:408-421`, `web/built/post.js:389-428`, `web/built/water.js:985-1041`, `web/built/grass.js:26`, `web/arena-built.js:171`): 4 contexts, ~14 post passes with a 4x MSAA half-float target, a second scene render for water, 450k grass blades.

## 6. Not known yet

- Native pixel size of the field maps and the blade count per map (`grass3d.js:294` prints it at run time).
- Triangle counts of the disc arenas (cost of the per-frame CPU cull) and of the painted-backdrop mesh; panorama texture size.
- Number of lamps per stage (`assets/data/lights.json` was not read: disc-derived).
- Whether Firefox on the target machine GPU-accelerates the 2D canvas, and its cost for WebGL-to-2D copies, canvas filters and same-size `canvas.width` assignment.
- Whether `multiplayer.js` `sendPresence` (every 50 ms) does work offline.
- Any measured milliseconds: nothing was run, so the ranking above is by amount of work in the code, not by timing.
