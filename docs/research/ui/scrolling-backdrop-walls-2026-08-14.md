---
reach: Scrolling a menu backdrop at the rate the original moves it.
status: log
---

# The scrolling backdrop walls — full census (2026-08-14)

**Status: ten draw sites enumerated from the original assembly, all ten sharing
one code shape; all ten measured moving in the walker at the decoded rate
(2026-10-04, the tenth found by this pass).**

Most full-screen UI screens in DW3 sit on a tiled wall, and that wall is not
static — it drifts diagonally toward the bottom-right, forever, with no visible
seam or edge. This document is the complete list of the screens that do it, the
one code shape they share, and what the walker does about each.

It exists because the walker had this wrong on five screens at once, in three
different ways, and each was found separately: the DRI wall was drawn frozen,
three card screens drew a flat colour instead of the wall at all, the gym wall
was drawn frozen with the cadence written down as an open gap, and the save
wall scrolled at twice the correct speed.

## The shape all ten share

Per frame, the screen object runs:

```
lw    $v0, <toggle>($sN)      # a companion flag next to the counter
beqz  $v0, <set-toggle>       # not set yet -> set it, do not advance
lw    $v0, <counter>($sN)
addiu $v1, $v0, 0x1           # +1
slti  $v0, $v1, 0x60          # ... but only while it stays below 0x60
beqz  $v0, <store-zero>       # otherwise store 0 -- it never HOLDS 0x60
sw    $v1, <counter>($sN)
...
li    $a1, <clip>             # the wall clip
lw    $a2, <counter>($sN)     # x = counter
jalr  $v0
move_ $a3, $a2                # y = counter, in the DELAY SLOT, so it executes
```

Three details matter and each has burned someone:

- **The toggle makes it every SECOND frame.** The flag is cleared on the frame
  that advances the counter and set on the frame that does not, so the counter
  gains 1 per two frames. That is **0.5 px/vsync = 25 px/s at PAL 50Hz**, not
  50. `web/save.js` had it at 60 px/s until this pass. And "frame" here is a
  vertical blank of the console, not a browser frame: a host that steps a screen
  once per `requestAnimationFrame` runs the counter at 30 px/s on a 60 Hz
  monitor (the card screens did, until 2026-10-04 — see the last section).
- **`move_ $a3, $a2` is in the branch delay slot.** It executes. That is the
  only reason y equals x and the wall moves diagonally rather than sideways.
- **The counter never holds `0x60`.** It is the saturating/wrapping shape, so
  the range is `0..0x5F`. 96 px is exactly the mosaic's own period.

## The clips are built for it

Every wall clip is a pre-composed mosaic of **48×48 tiles on a 96×96 checker
period**, laid out with a **spare tile past every screen edge** (typically
`dx −96..288`, `dy −96..192` = 432×336 against a 320×240 screen). That margin
is the whole reason a 0..95 offset never exposes an edge. Confirmed for every
wall below out of `web/assets/ui/*_sheet.json`; all four cells of the 96×96
period (`0,0` / `48,0` / `0,48` / `48,48`) are present in each.

## The ten

| overlay | draw site | clip | counter | walker | state before this pass |
|---|---|---|---|---|---|
| `ststatus` | `0x00016bd0` | `0x1d` | `+0x54` | `web/status-backdrop.js` | correct |
| `stitshop` | `0x00008c44` | `0x14` | `+0x58` | `web/shop.js` | correct |
| `stfgtrep` | `0x0000210c` | `0x1e` | `+0x58` | `web/battle.js` | correct |
| `stgdglab` | `0x0000c1b8` | `0x37` | `+0x54` | `web/dri.js` | **drawn frozen** |
| `stgmcard` | `0x00004da8` | `0x1e` | `+0x58` | `web/save.js` | **60 px/s, should be 25** |
| `stcrdabm` | `0x00001910` | `0x08` | `+0x58` | `web/cardalbum.js` | **flat colour, no wall** |
| `stcrddek` | `0x0000628c` | `0x08` | `+0x58` | `web/carddeck.js` | **flat colour, no wall** |
| `stcrdshp` | `0x000054cc` | `0x08` | `+0x58` | `web/cardshop.js` | **flat colour, no wall** |
| `stgtrain` | `0x00002498` | *field* | `+0x5c` | `web/gym.js` | **drawn frozen** |
| `stdgname` | `0x00003798` | `0x24` | `+0x58` | `engine/dw3/ui/native/name-screen.ts` | correct, but **not in this list until 2026-10-04** |

`stdgname` is the tenth, and the first census missed it because its wrap is
written in the **short form** — `slti $v0, 0x5f` at `pro/stdgname.s:3545`, which
is `slti $v0, $v0, 0x5f` — where the other nine write `slti $v0, $v1, 0x60`. It
is the naming screen's MAGAMI wall, drawn at `(counter, counter)` from
`pro/stdgname.s:3565`, and the walker's port is
`engine/dw3/ui/native/name-screen.ts:105-115` (it even keeps the `0x5f` bound).
The census is now mechanical (`tools/extract_scroll_walls.py` →
`data/scrolling_walls.json`) and matches both spellings, so a screen written
either way cannot go missing again.

The card duel is deliberately **not** in this list. It scrolls too, but its
tiles are 64×64 with a `0x40` wrap (`carddata3` clip 0), and `web/cardduel.js`
already draws it at `(t, t)` correctly. It is a separate mechanism that happens
to look the same.

**The "walker" column above is the `?legacy*` rollback for six of these rows.**
`USE_NATIVE_ALBUM`, `USE_NATIVE_DECK`, `USE_NATIVE_CARDSHOP`, `USE_NATIVE_SHOP`,
`USE_NATIVE_GYM` and `USE_NATIVE_DRI` are on by default, so in ordinary play the
shop, the gym, the DRI lab and the three card screens are the shipped overlays
stepped by `web/native-screen-host.js` and the wall is drawn by the original's
own code — which is why their rate is a question about how often the host steps
that overlay (last section) rather than about `drawPackBackdrop`. The remaining
rows — pause pages, memory card, fight report, title — run translated code
through `MenuDisplayClock`, which already converts a browser frame into
displayed frames at PAL 50 Hz.

## `stgtrain` is the one that is different

Its draw takes the clip id **from the object field `+0x58`**, not from an
immediate — `lw $a1, 0x58($s5)` where every other screen has `li $a1, <clip>`.
The constructor stores it (`stgtrain.s` L246, `sw $a1, 0x58($a0)`). `sttrng3`
carries **eight** of these mosaics, clips `0x2d..0x34`.

**Which training ground selects which wall is NOT established.** A scan of
`stgtrain.s` for immediate loads in `0x2d..0x34` finds only two (`0x32` at
L4749, `0x2f` at L5190), which is not enough to build the mapping, and the
constructor's callers were not traced. The walker therefore keeps whatever clip
`stgtrain_ui.json` already names and only fixes the motion. Do not guess this.

## How the walker does it now

The rollbacks and the remaining translated screens route through
`drawPackBackdrop()` in `web/screenpack.js`, which
bakes one 96×96 period to an offscreen pattern and translates it with time.
The screens that run the shipped overlay get their wall from the overlay itself,
paced by `NativeVblankClock` (last section).
Two repairs were needed to make the shared renderer safe to share:

- the built pattern was cached **one per pack**, which would have handed the
  gym the wrong cave once it started using a variable clip — it is now keyed by
  clip id;
- screens with no per-frame update hook (the three card screens) fall back to
  the wall clock instead of each inventing a timer. (Superseded 2026-10-04: in
  ordinary play the three card screens run the shipped overlays and are paced by
  the host's vertical blanks; this fallback now only serves the `?legacy*`
  rollbacks.)

## Verification

`tools/verify_scrolling_walls.mjs` (headless) asserts the **loop time**, not a
pixel distance: 96 px at 25 px/s means the wall returns to its exact starting
phase every **3.84 s**. That is independent of how each screen scales 320×240
onto the canvas, which is what lets one threshold cover every screen. A frozen
wall never leaves its start phase; a wrong speed returns early or late.

Measured 2026-08-14, all eight lab-reachable screens:

```
ok  menu       loop=3.75s   ok  save       loop=3.82s
ok  shop       loop=3.83s   ok  gym        loop=3.84s
ok  dri        loop=3.84s   ok  cardalbum  loop=3.84s
ok  carddeck   loop=3.83s   ok  cardshop   loop=3.83s
```

## 2026-10-04: the START list has no wall, and the check was wrong twice

A browser sweep on 2026-10-04 reported `menu` and `save` as walls that "never
loop". Both readings were the check's, not the walker's. Re-measured on
2026-10-04, from the picture calls rather than from pixels:

| screen | what the original draws | walker, measured |
|---|---|---|
| pause START list | **no wall** — the list is over the live field | no clip-0x1d draw at all; correct |
| a pause page (ITEMS) | clip 0x1d, 25 px/s, 96 px period | 3.75 s loop, 25.0 px/s, 1 wrap in 4.2 s |
| memory card | clip 0x1e, 25 px/s, 96 px period | 3.85 s loop, 24.3 px/s, 2 wraps in 4.2 s |

**The pause list has no wall, and that is the disc.** Ledger claim
`UI-PAUSE-FIELD-THEN-OVERLAY-HOME-2026-08-20`: first START from the field draws
the list over the live picture, and the diamond room only appears once you have
been into a page and come back — captures
`pause-field-home-2026-08-20.png` (field still visible) against
`pause-overlay-home-2026-08-20.png` (diamond room), both authority-1 rig
screenshots, described at `pause-home-and-items-rig-2026-08-20.md:18-23`. The
walker models that with the pause session's `homeOverlay` flag
(`engine/dw3/ui/pause-root-session.ts:371`, set from `web/status-translated.js:182`
and `:195`), and it is right in both directions: opening the list from the field
issues no wall draw, and coming back from a page does (measured 23 -> 40 over
0.7 s = 24 px/s). The 2026-08-14 `menu loop=3.75s` line above was taken when
`web/menu.js` still painted the backdrop on the first home; the rig finding on
2026-08-20 removed it and this check was not re-run until the sweep. So that
row, and the check's demand for a wall there, were both stale.

**The save row sampled the card's own window.** Its box was `(360,210,120,120)`
on the 640x480 canvas — native `(180,105)`, which is inside the SAVE window's
flat interior, so the region never changed and the row read as frozen. A 20 px
motion map puts the card's bare wall at `(160,20)` and `(400,20)`, above the
window; both return to their start phase at 3.84 s.

**One real walker fault, found on the way: the lab left the pause list standing.**
`window.__labClose` (`web/game.js:1167`) set `state.menuOpen = false`, which is
the *rollback* route's flag, but the pause the field's START raises is the
translated screen's own `_open`, and nothing called `status.close()`. So every
screen the lab opened after `__labOpen("menu")` — the memory card included — was
drawn underneath the pause list's opaque party cards. That is a debug-surface
teardown gap, not an ordinary-play one: the game's own route into the card is the
inn/shop save-point handoff (`web/game.js:4769`), which is not reachable from
the pause list.

Evidence added for the two wraps: `EV-STSTATUS-WALL-PHASE-SLTI-2026-10-04`
(`pro/ststatus.s:23271`, `slti $v0, $v1, 0x60`) and
`EV-STGMCD-WALL-PHASE-SLTI-2026-10-04` (`pro/stgmcard.s:4957`, same word).

### What this pass did not settle

- **The three card rows.** This bullet was wrong about them and the next pass
  below settles it: the strip was on bare wall, and the rows were reading the
  card wall at the wrong rate. The `drawPackBackdrop` argument in it ("a single
  shared renderer that cannot be at two different rates") was also wrong about
  what draws these three screens in ordinary play: nothing does, because
  `USE_NATIVE_ALBUM` / `USE_NATIVE_DECK` / `USE_NATIVE_CARDSHOP` are on by
  default and the lab opens the shipped overlays.
- **The fight report** is still unverified by movement, as above.
- **The training-ground wall-clip mapping** is still unestablished.

## 2026-10-04: the card screens' wall was a frame, not a blank

### What the check was actually sampling

The lead measured `tools/verify_scrolling_walls.mjs` on both revisions and got
two different sets of numbers for the three card rows, which is what sent this
pass looking. Both readings are explained, and neither was a sampling slip:

| `web/game.js` | what stands over the card album | what the 300×12 strip at y=2 sampled | loop |
|---|---|---|---|
| `ff5aba94^` (no `status.close()` in `__labClose`) | the pause list — its party cards and ITEMS box cover the card screen whole | **the pause room's wall**, clip 0x1d, 25 px/s | 3.83 / 3.84 / 3.84 s |
| `ff5aba94` (as shipped) | nothing | **the card screen's own wall**, clip 0x08 | 3.20 / 3.18 / 3.20 s |

Captures of the first case:
`captures/walls-cardalbum-under-pause-list-2026-10-04.png` (whole screen — the
pause list, not the album) and `captures/walls-cardalbum-strip-2026-10-04.png`
(the same strip after the teardown fix, native x 120..270, y 0..7, magnified 4×,
showing bare mosaic and nothing else). So the strip is bare wall, and the
"header plates" story in the bullet above was wrong: the "…u City" plate ends at
native x=50 and the strip starts at x=120.

So the lead is right and the earlier report was not: those rows were never
"left byte-for-byte" in what they measure. For one run they were measuring the
pause screen's wall through a bug in the lab's teardown, and the moment that bug
was fixed they began measuring the card wall — which was 20% fast.

### Why 3.18 s and not 3.84 s

All three card screens carry the same shape as the pause room, read again here
from the shipped overlays:

| overlay | clip | toggle | counter | `slti` wrap | draw site | ledger |
|---|---|---|---|---|---|---|
| `pro/stcrdabm.s` | 0x08 (`:1606`) | +0x5c (`:1585`) | +0x58 (`:1587`) | `:1590` | `:1611` | `EV-STCRDABM-WALL-PHASE-SLTI-2026-10-04` |
| `pro/stcrddek.s` | 0x08 (`:6309`) | +0x5c (`:6288`) | +0x58 (`:6290`) | `:6293` | `:6314` | `EV-STCRDDEK-WALL-PHASE-SLTI-2026-10-04` |
| `pro/stcrdshp.s` | 0x08 (`:5429`) | +0x5c (`:5408`) | +0x58 (`:5410`) | `:5413` | `:5434` | `EV-STCRDSHP-WALL-PHASE-SLTI-2026-10-04` |

One step every second frame, 96 phases, so 3.84 s — provided "frame" means the
console's frame. A screen object's frame counters count **vertical blanks**, and
a PAL blank is 1/50 s. The host that steps a shipped overlay
(`web/native-screen-host.js`) ran one overlay frame per `requestAnimationFrame`,
so on a 60 Hz browser those counters advanced 60 times a second: 0.5 px × 60 =
**30 px/s**, and one period every 96/30 = **3.2 s**. Measured in the browser:
the strip returned to its *exact* start pixels at 3.222 s, 6.424 s and 9.6 s
(cardalbum), 3.191 s (carddeck), 3.20 s (cardshop) — 192 frames at 60.2 Hz, to
the frame. The same region at the same rate under the old `web/game.js` came
round at 3.84 s because it was the pause room's wall, not the card wall's.

The shared system is the host's blank cadence, not the three card screens and
not `drawPackBackdrop`: every screen the host owns was being stepped at the
monitor's rate. The fix is one clock, `NativeVblankClock`
(`engine/systems/native-vblank-clock.ts`), which turns elapsed browser time into
PAL blanks — the same conversion the translated screens already get through
`MenuDisplayClock` (`engine/dw3/ui/pad-words.ts`) — and publishes each blank's
own display delta (1 on most, 2 on 51 of every 256,
`engine/systems/frame-clock.ts`) for the runtime to write into `[0x8004DE28]`.
`web/native-screen-host.js` runs it; every adapter passes its `dt` in, so
`window.__gameSpeed` still blitzes native screens, and a screen driven by its own
rAF loop (the native title) has its real interval measured instead.

The three card rows now also read their **position** from the overlay's own draw
arguments (`rt.drawCalls`), like the pause page and the memory card read theirs
from a translated session: 106 phases, one 0x5F → 0x00 wrap in 4.2 s, 25.0 px/s,
x == y throughout. That is what makes the row a statement about the card wall
rather than about whatever happens to be painted in the top twelve pixel rows.

### After

```
ok  pausehome  no wall call over the field (saw 0 phases)
ok  pausepage  loop=3.72s  phases=106 seams=1 rate=25.0px/s
ok  shop       loop=3.83s   ok  dri    loop=3.83s
ok  save       loop=3.83s  phases=106 seams=1 rate=25.0px/s
ok  gym        loop=3.85s
ok  cardalbum  loop=3.82s  phases=106 seams=1 rate=25.0px/s
ok  carddeck   loop=3.85s  phases=106 seams=1 rate=25.0px/s
ok  cardshop   loop=3.83s  phases=106 seams=1 rate=25.0px/s
```

Ledger claim `native-screen-host-blank-cadence-2026-10-04` (partially_verified:
the review gate has not been run, and only the three card walls were measured).

### What this pass did not settle

- **The other screens the host steps** — naming, pack select, the card duel, and
  the research references behind `?native*` — ran at the browser rate too and now
  run at 50 blanks a second. No per-frame cadence in them was measured before and
  after. The change is the same one for all of them.
- **The fight report** and the **training-ground clip mapping**, as above.

## 2026-10-04 (later): the tenth member, and the check counted steps instead of pixels

Two things were left open above. Both are closed here, and neither needed a
change to a wall: the walls were already right.

### The fight report moves, and the naming screen moves

`__labOpen("fightreport")` does open the results screen (`web/game.js:1367`),
so the earlier note that it "is not reachable from the UI lab" was stale. Read
from the translated session's own picture calls (`pro/stfgtrep.s:2042-2063`,
clip `0x1e` at `(counter, counter)`): **151 phases in 5.98 s, 150 px of travel,
one `0x5F` → `0x00` wrap, 25.07 px/s, `x == y` throughout.** The naming screen
is the tenth member and was never in the check at all; the lab could not even
open it, because `?skipTitle` has no party with a roster slot and the screen
refuses to start without one. With a party seeded (`__labOpen` now treats
`nameentry` like the other partner-card screens): **151 phases in 5.97 s, 150 px,
one wrap, 25.14 px/s** — `pro/stdgname.s:3545-3565`, clip `0x24`.

So both rows are now in `tools/verify_scrolling_walls.mjs`, measured by
position only: no bare-wall pixel box had been mapped for either screen, and a
guessed box would be a guess.

### A skipped phase is not a broken wall

One run of the check reported the card folder editor as a wall that "never
looped": `phases=101 seams=0 rate=22.6px/s`. Its own pixel row for the same
screen read `loop=3.85s`, and re-measuring that screen three times with the
check's exact sequence (screenshot, dense per-frame pixel read, then the phase
sample) gave `106 phases, 1 wrap, 25.0 px/s` every time. So the wall was fine and
the reading was not.

The cause was in the check's arithmetic, not in a screen. It counted **+1
steps** and called a wrap a "seam", then divided by the window length:

```js
if (d === 1) strides++; else if (d < 0 && prev === 0x5f && now === 0) seams++;
const rate = (strides + seams) / 4.2;
```

A browser frame that runs long is ordinary on a machine shared by six workers:
`NativeVblankClock` then owes two or three blanks at once, the host steps the
overlay that many times in one frame, and the counter moves `+2` or `+3` between
two samples. Such a step is neither a stride nor a seam, so it dropped out of the
numerator — the rate fell, and if the missed phase happened to be the wrap, the
row also claimed zero wraps and the check printed the sentence a player would
read as "this wall does not move".

`tools/scrolling-walls.mjs` now counts the **advance**: every pixel the counter
moved, a wrap counting as 96, divided by the seconds actually sampled. A frozen
wall still measures 0 px and still fails; a wall at the monitor's rate still
fails on the rate; a wall whose x and y differ still fails, because that is not
this wall. Only the reading of a dropped frame changed.
`tests/scrolling-wall-position.test.js` pins both: a 4.2 s trace with skips reads
25 px/s and no faults, and the same trace under the old arithmetic reads
"22.6 px/s, no wrap".

### The census is a program now

`tools/extract_scroll_walls.py` matches the whole shape (the `slti` wrap in
either spelling, the delay-slot `move_ $a3, $a2` after a `jalr`, the x argument
loaded from the counter field, the clip immediate or field) over every overlay
in `~/ddw3/asm/dw2003/{pro,exe}` and writes `data/scrolling_walls.json`: ten
sites, no eleventh. `tests/scrolling-wall-census.test.js` pins that list and
requires one measured row per member, so the two lists cannot drift again.

### What this pass did not settle

- **The training-ground → wall-clip mapping**, as above: still unestablished, and
  nothing here changed that.
- **The card duel** was not re-measured. It is not one of the ten (its tiles are
  64×64 with a `0x40` wrap) and this pass did not look at it.

## What I did not establish

- **The training-ground → wall-clip mapping**, as above.
- **Whether a screen scrolls its backdrop without this shape.** The census is now
  a matcher for the decoded shape, not for every way a background can move; a
  screen that scrolled sideways, or at a rate other than one pixel per two
  blanks, would still not appear. All 321 `pro` overlays and every `exe`
  overlay were scanned for the shape and none beyond the ten has it.
- The `wstag*` stage overlays were excluded from the first census as field
  stages, not UI. The 2026-10-04 scan covered them and found no wall site.
