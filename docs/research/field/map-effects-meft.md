---
reach: Reading a falsified premise about ambient map effects before quoting it as open work.
status: canonical
---

# Map effects (MEFT) + stage model/effect data — decode log (2026-07-04, in progress)

> **STOP — this document's PREMISE is falsified. Do not quote it as a source of open work.**
>
> It was written on the belief that `MEFT1001–1055` are the field ambient effects and that
> their stage binding was missing. Both are false:
>
> - `MEFT1001–1055` are **battle** effect packs — claim
>   `sfstdata-binds-meft10xx-battle-packs`, re-derived independently 2026-08-17.
> - Their binding is **decoded**: SFSTDATA record → MEFT pack, consumed by
>   `FIGHTSTG_F0x80086304` → `FIGHTSTG_F0x800847c4`.
> - No field stage references any of them — claim
>   `meft-field-binding-not-in-trigger-target`.
>
> The goal below therefore names real player-visible effects but the **wrong asset** for
> them. **What does draw them is decoded, shipped and tested — further down THIS file:**
>
> - Windmills / torches / fans / waterfalls → the **point-sprite ambient system**, §L779 and
>   `point-sprite-ambient-system.md`. The Seiryu windmill blades are byte-verified against
>   `~/ddw3/tim/dw2003/field/stage/s420mask/0.png`.
> - The s200/s225 download and login halos → point sprites plus a per-stage actor,
>   §L502 and `materialize-effect-actor.md` — "decoded, extracted, wired".
>
> Shipped: 9,542 placement records over 280 stages in
> `web/assets/data/point_sprites.json`, rendered by `web/effects.js` (native timer
> `period<<8` per `F0x80089038`), tested by `tests/point-sprites.test.js`.
>
> **So this file's goal is MET, not open.** Everything from §L157 down is correct; only the
> header was stale. Do not re-attach the goal to MEFT1001–1055, and do not open a frontier
> for the ambient effects.
>
> This warning exists because the stale header was copied forward into
> `docs/todo/2026-08-17-fight-effect-rendering-handoff.md` §4a on 2026-08-17 — twelve days
> after the correction was recorded — and re-opened a closed question as "genuinely open".

Goal (**as originally framed — the asset attribution in it is wrong, see above**): the
per-stage ambient effects the walker is missing — s200 download blue halo,
Asuka waterfalls, Seiryu windmills, glowing lights — plus the "black rectangles =
missing tiles" gap in maps.md.

## Files (all in the repo)

- **`MEFT####.BIN`** — 186 files in the LBA table. Two ranges: `0039–0378` = battle
  skill/summon effects (ddw3 groups them under `pack/dw2003/fight/effect/`), and
  ~~**`1001–1055` = FIELD map effects** (57 files)~~ — **BOTH HALVES OF THAT LABEL ARE
  WRONG. CORRECTED 2026-08-05, re-verified 2026-08-17.** `1001–1055` are **battle**
  effect packs, and there are **55** of them, not 57 (`ls -d
  ~/ddw3/pack/dw2003/fight/effect/meft10*/` = 55; 57 is SFSTDATA's *record* count).
  This header's "FIELD" label is named in `docs/research/infra/falsified-hypotheses.md`
  as *the* error that kept a field-side search alive for a month, and it did so again on
  2026-08-17 — see the warning box below before reading any further in this file.
  Already pack-extracted by ddw3 to `~/ddw3/pack/dw2003/fight/effect/meft####/N.bin`.
- **`SFSTDATA.PRO`** (LBA idx 459/0x1CB) **IS the MEFT binding table** — the
  2026-07-04c falsification was itself half wrong, **PARTIALLY REVERSED 2026-08-05**
  (`falsified-hypotheses.md` L381–397, claim `sfstdata-binds-meft10xx-battle-packs`).
  What stays falsified is only "per-**stage**". Record `+0x00` is **not**
  `baseA<<16|lenA`: it is a `(fileId<<16)|binIdx` MEFT resource pointer. Re-derived
  independently 2026-08-17 from `~/ddw3/asm/dw2003/pro/sfstdata.s` (1,254 data words =
  57 × 22, stride `0x58`) against `~/ddw3/rust/dw2003_exe_data/src/lba.rs`: records
  **1–55 → MEFT1001–MEFT1055, one-to-one, zero mismatches**, plus exactly two aliases
  (record 0 = MEFT1001, record 56 = MEFT1034). The index is the combat motion id, so
  the binding is *attack → effect pack*.
- **`SMDLDATA.PRO`** (idx 460) — Stage MoDeL DATA. Top-level format decoded 2026-07-04b
  (below): preload-batch manifest + model records, NOT the stage→effect binding either.
- Preloaded together with SDIGIEDT/WFIGHTMN/FIGHTSTG by fieldstg at file offset
  0x7518 (`li a0,0x1cb..0x208` chain through `[0x80044B38+0x40C](lba_idx)`).

## SFSTDATA record layout — WRONG, see falsification (was: "0x58-byte MEFT descriptor")

~~The table below described SFSTDATA `+0x00..+0x50` as a per-MEFT ambient/tint/sub-list
descriptor.~~ **FALSIFIED 2026-07-04c** (`docs/research/infra/falsified-hypotheses.md`).
SFSTDATA is the 3D battle **fight motion table** — 57 records (0–56) indexed by *combat
motion id*, not MEFT index. Real layout (from `renamon-motion-table-map.md`, RAM-verified):
`+0x00` = `baseA<<16|lenA`, `+0x04` = `baseB<<16|offB` (segment,offset into loaded 3D
playback data, consumed by `F0x80086304`/`F0x800847c4`), `+0x08` = sound index, `+0x10..`
= a null-terminated default/fallback table-id playlist. None of this is MEFT-related; the
earlier "RGB tint"/"sub-entry indices" reading was a plausible-looking misparse of motion
playback words. **The SFSTDATA angle on field MEFT binding is closed — do not revisit.**

## MEFT pack sub-entry format (typed)

First u32 of each sub = type tag. **2026-07-04 (format-decode session): 15 distinct tags
found across the 15 census MEFT numbers** (`tools/scan_meft_pack_tags.py` →
`docs/research/field/meft-pack-tag-census.json`), not just the 5 originally noted below.
No shared runtime parser was located (`meft-parser-search-log.md` — a real, documented dead
end after checking `fightstg.s`/`fieldstg.s`/`wfightmn.s`), so the layouts below come from
**data-driven cross-referencing across every instance of each tag in the census** — every
finding is labeled by confidence, not asserted as disasm-proven fact.

- `0x08` — texture: `{u32 8, u32 0, RLEN blob}` (same RLEN as screen packs). **Confirmed**:
  decompresses to a 64×256 16bpp atlas (`unrlen(blob)[20:]` = exactly `64*256*2` bytes, same
  convention as `tools/extract_screen_packs.py`'s screen packs). 4 census MEFT numbers have
  this tag: 1010, 1020, 1030, 1050 (all Spy Satellite tower).
- **`0x0c` — ⭐ ALSO a texture atlas, functionally identical to `0x08`.** `{u32 12, u32
  sizeHint, u32 0, RLEN blob}` (RLEN starts at offset 12, not 8). **Byte-verified**: every one
  of the 10 instances in the census has the literal bytes `RLEN` at offset 12 (checked
  directly, 10/10), and decompressing one (`meft1035/17.bin`) gives exactly `20 + 64*256*2`
  bytes — the *same* 64×256 16bpp atlas format as `0x08`, just with a 4-byte size-hint field
  the `0x08` header doesn't have. **This corrects the earlier "only 4 of 15 MEFT numbers have
  real texture data" scope note (2026-07-04i, below) — it was based on checking `0x08` only.**
  10 more census MEFT numbers have this tag: 1001, 1009, 1012, 1014, 1017, 1025, 1035, 1037,
  1040, 1047. **Combined with `0x08`, 14 of the 15 census MEFT numbers (all except 1022) have
  a real, extractable 64×256 texture atlas.** The earlier "most effects are 3D mesh/particle
  systems, not flat textures" conclusion needs re-evaluating in light of this — see the
  correction note added to that section.
- `0x18` — mesh/vertex data. Header `{u32 18, u32 A, u32 B, ...}` where `A`/`B` look like
  byte offsets or counts into the record (e.g. one 156-byte instance had `A=116, B=124` —
  `124-116=8`, `156-124=32`, suggesting sub-table boundaries, not confirmed further). The body
  is dominated by small values clustering around `0x0000/0x4000/0xc000/0xFFFF` — **consistent
  with compact fixed-point vertex/normal coordinates** (`0x4000`/`0xc000` = ±0.5 in a 15-bit
  fixed-point convention, a common PS1 pattern), supporting the "these are small 3D
  particle/mesh effects" reading, though the exact per-field layout (vertex count, stride,
  index vs. position data) is **not** pinned — would need either a decompiled consumer or
  much deeper structural analysis than this session did. 153 instances across nearly every
  census MEFT number.
- `0x10` — control/emitter params, **not simply "72 bytes"**: sizes seen are 72 (112/154
  instances), 88 (28), 96 (12), 112 (1), and one outlier at 33800 bytes (likely a different
  record entirely, unchecked). **The 72-byte variant is a single fixed, byte-identical
  constant record across every one of its 112 instances** — decodes as 18 little-endian u32s
  including a repeated `0x1000` (4096, plausibly a 12-bit fixed-point "1.0") and `0x7530`
  (30000, purpose unclear) in several packed combinations; almost certainly an inert
  default/boilerplate block, not a per-effect parameter. **The 88/96-byte variants DO vary
  per instance** (cross-checked: MEFT1035/1037's 88-byte variants differ in specific words
  while sharing the same header shape; MEFT1030's 96-byte variants differ in what look like
  signed 32-bit offsets) — these are the real per-effect emitter parameters, exact field
  meanings not pinned.
- `0x14` — index/order table `{u32 0x14, u32 count, pairs…}` (from the original session,
  not re-verified this pass).
- `0x04` — tiny, **two variants found, not one**: a fixed 28-byte constant
  (`{u32 4, u16[6]={0,1,1,1,1,0}, u32 0xFFFF, u32 0x7FFF, u32 0}`, byte-identical across 11 of
  15 sampled instances — corrects the earlier guess of "0xFFFF00FF" as one field, it's really
  two separate u32s `0xFFFF`/`0x7FFF`) and a second, per-instance-varying 28-byte variant
  (3 instances: MEFT1035/1037/1040) where the `u16[6]` values become `{0,120,1,120,120,0}` —
  a repeated `120` in 3 of 6 slots, suggesting a real per-effect size/duration parameter, not
  color as originally guessed. One 36-byte variant (MEFT1050) follows the same pattern with
  `160` repeated instead of `120`. **Purpose still not confirmed** (no decompiled consumer),
  but "color" is very unlikely given the repeated-integer pattern; "radius"/"duration"/"scale"
  are unconfirmed candidates.
- **Newly found tags, insufficient samples to infer a layout** (1-2 instances each in the
  census — cross-referencing needs ≥2-3 same-tag instances to separate fixed from variable
  fields, which these don't have): `0x03` (1×20 bytes), `0x07` (1×44 bytes), `0x11` (2×104
  bytes), `0x12` (1×116 bytes), `0x13` (1×116 bytes), `0x15` (2×128 bytes), `0x17` (1×164
  bytes), `0x19` (3×152/164 bytes), `0x1b` (1×164 bytes), `0x21` (2×200 bytes). Byte dumps
  are in `meft-pack-tag-census.json`'s companion pack files if a future session wants to
  attempt inference with more MEFT numbers sampled (the battle-effect range 0039-0378 shares
  this format and would give many more same-tag instances to cross-reference against).

## The per-stage descriptor (fieldstg global bank @ 0x80099D80)

Each stage's **wstag init code** fills a descriptor at `0x80099D80` (found via the
s740 init at wstag740 file 0xa80; pattern `lui a2,0x800a; addiu a2,-0x6280`):

| Off (global) | Field | Example s740 |
|---|---|---|
| +0x08 (0x99D88) | **PACK LBA idx** | 0x6DC = S740PACK |
| +0x0C (0x99D8C) | **TMPK handle** (idx<<16) | 0x6DD0000 |
| +0x10/+0x14 | overlay data ptrs | 0x800a6f08 / 0x800a703c |
| +0x1C (0x99D9C) | **MASK LBA idx** | 0x6DB — read back at fieldstg 0x6dc0 for load |
| +0x20/24/28/4C | overlay ptrs (event tables etc.) | |
| +0x2C/+0x30 | 0x00012200 / 0x0002F400 (fixed-point scroll?) | |
| +0x38 (0x99DB8) | ambient color (copied from wstag word 0) | 0x808080 |
| +0x3C (0x99DBC) | **music id** (small int; consumer calls [0x80045C54]) | 0x19 |
| +0x40 (0x99DC0) | **packed BGM play-id** `0x60XX0000` — consumer is the known play-SFX fn 0x80055C48 | 0x6064<<16 |
| +0x44 (0x99DC4) | **estalk bank idx** = `[0x8005CCA8] + 0xD3` — ⚠️ **`D0x8005CCA8` = the LANGUAGE INDEX (2=English)**: 0xD3+2 = 0xD5 = ESTALK02. (Also explains the loader's `[0x8005CCA8]+0xB0` = ESSTATUS.) | |

Two nice side-decodes: the language-index global, and the music binding
(+0x3C/+0x40) — 161 stages' descriptor inits parse cleanly with the scratchpad
script (`wstag_desc.py`).

## ✅ CLOSED 2026-08-05: there is no stage → MEFT binding, because MEFT1001–1055 are BATTLE packs

The question this section chased for a month was malformed. **MEFT1001–1055 are not field map
effects.** They are the battle effect packs bound by `SFSTDATA`, record `i` → `MEFT10<i>`.

Re-derived independently 2026-08-05 (static): parsing `~/ddw3/asm/dw2003/pro/sfstdata.s` at
stride 0x58 and resolving each record's `+0x00` high half through
`~/ddw3/iso/dw2003-bootstrap/lbas.toml` gives records **1–55 → MEFT1001–MEFT1055 exactly**,
with two aliases (record 0 = MEFT1001, record 56 = MEFT1034) and no other exception. Record 55
carries `prog=0x20, clut=0x06`, byte-matching the MEFT1055 pack decode in
`docs/research/fight-3d/special-attack-backdrop-decode.md` §9. `+0x00`/`+0x04` are
`(fileId<<16)|binIdx` resource pointers; the readers are `fightstg F0x80086304` (motion rebuild)
and `F0x8008b06c`, and the ids that reach them come from the tech table's
`effect`/`sigEffect`/`motion` fields.

So the "FIELD map effects" label in §Files above — inferred from the id-range split alone, never
from a consumer — is what kept this search alive. Field stages never reference these packs
because they are not field assets. The 2026-07-04c falsification was right that SFSTDATA is not
a *per-stage* binding table and right that it is the battle-side table, but its "57 records ≈ 57
field MEFT files was pure numeric coincidence" line is wrong: the 1:1 record↔MEFT mapping is
real. Corrected in `falsified-hypotheses.md`.

**Consequence for the walker:** any remaining work on MEFT1001–1055 is a *battle* presentation
question (fight-3d), not a missing field-effect renderer. The field ambient system is the point
sprites at descriptor +0x10, complete at 9542/9542.

#### Refined same day: the 55-pack range splits into stage packs and effect packs

The developers' own battle scene test tool settles what is inside the range. The
asset list in `pro/wfightts.s` (file 0x3634, slots 0..54, load base 0x800a5de0)
labels slot 0 `ＭＦＳＴＧ００１` through slot 28 `ＭＦＳＴＧ０２９`, then slot 29
`ＭＥＦＴ００３０` through slot 54 `ＭＥＦＴ００５５` — one contiguous 1..55
numbering with `slot = id - 1` and no gap at the prefix change. The disc carries
exactly 55 `MEFT10xx_BIN` files and no `MFSTG` file at all, so `MFSTG` is a
content label, not a filename.

So **MEFT1001–1029 are battle STAGE packs and MEFT1030–1055 are battle EFFECT
packs.** The battle-not-field conclusion above is unaffected; this only adds the
internal split, and it explains why the range kept reading as heterogeneous —
two kinds of battle asset share one filename prefix.

See `docs/research/battle/scene-test-tool-wfightts-2026-08-05.md`; ledger claim
`wfightts-asset-list-splits-meft-range-into-stage-and-effect-packs` (candidate).

### Historical: what the field-side hunt had ruled out (all still true, now explained)

Ruled out:
- ~~disc adjacency~~ (MEFT files sit before stage MASK/PACK/TMPK groups on disc,
  but that's mastering locality: MEFT1027–1050 are contiguous, no stages between)
- ~~descriptor +0x3C/+0x40~~ (= music)
- ~~static idx tables~~ (no MEFT LBA idx / handles in fieldstg data.rs, EXE data.rs,
  or wstag immediates — s740 contains no 0x6DA)
- ~~record h0lo = screen id − 0x200~~ (duplicate screens, nonsense pairs)
- ~~SFSTDATA is the binding table~~ (2026-07-04c: it's the unrelated battle motion table —
  see falsified-hypotheses.md)

### 2026-07-04c: the SFSTDATA preload-site fn decompiled — it's the loading-screen wipe, not a stage binding

Followed next-step 1 from the previous session (m2c-decompile the fn right after the
`0x1CB` preload at fieldstg file 0x752c). Pipeline: `overlay_to_fns.py fieldstg.s →
normalize_asm.py → decompile_exe.py`, entry `F0x80089f7c` (RAM `0x80082cb0+0x74a0` region;
`.c` at `out/F0x80089f7c.c`). Findings:

- The five `0x80044B38->unk40C(idx)` calls at file 0x752c–0x7570 (`0x1CB` SFSTDATA, `0x1CC`
  SMDLDATA, `0x1CF` STCRDSHP, `0x208` WFIGHTMN, `0x167` FIGHTSTG) are **literal constants**,
  loaded **unconditionally on every field↔battle transition** — a hardcoded system-resource
  bundle (fight presentation assets: motion table, model data, card-shop UI, fight menu,
  fight-stage overlay), not a per-stage parameterized list. This *is* the "preloaded
  together" pattern noted at the top of this doc — confirmed, but it means SFSTDATA/SMDLDATA
  residency is stage-invariant and carries no per-stage MEFT selection signal.
- The rest of `F0x80089f7c` is a **6×5-tile loading-screen wipe/dissolve transition**: fills
  a 0x8009B900 grid with 30 `{col*64, row*40}` tile-position entries (320×240 screen ÷ 5
  cols × 6 rows), then each call draws GPU quads for not-yet-consumed tiles (sentinel
  `0x200` = done) with a per-row color ramp — the classic PS1 checkerboard-wipe loading
  transition. Nothing here reads/branches on MEFT ids or per-stage config; it's generic UI.
- **Conclusion: this fn is not the SFSTDATA consumer we were looking for** (there is no such
  consumer for MEFT purposes — SFSTDATA doesn't hold MEFT data at all, see falsification).
  Next-step 1 from 2026-07-04b is done and dead-ends; strike it.

## ~~✅ RESOLVED 2026-07-04c: stage → MEFT binding is authored directly in each wstag's static data~~ ⚠️ FALSIFIED (session 2, below): the "meft numbers" were X COORDINATES read at wrong record alignment

Followed next-step 2 (grep wstag scripts for MEFT LBA refs, `0x3E9–0x41F` = 1001–1055 decimal
encoded literally as small ints, not the LBA-table index — the field itself just holds the
MEFT file's decimal number). One `li $a0, 0x411` hit in `wstag815.s` led to its static `.word`
data section, which decodes cleanly as a **repeating placement record** (confirmed against
the "type tag 0x08 = texture" sub-entry format already known from the MEFT pack format
section above):

```
{ placement/pos header (2-3 words, format not fully pinned — includes a fixed-point-ish
  0x02400001 and a packed coordinate/size pair) }
{ meftNumber << 16 | 0x00000008 }   # 0x00000008 = "texture" MEFT-sub type tag
{ variant/size int }                # e.g. 0x319, 0x31f, 0x303 — differs per placement
{ 0x00010000 }                      # constant
```

Scanning every `wstag*.s` for the middle word (`(w & 0xffff) == 8` with the high half in
1001–1055) finds this record in **5 stages** initially (script: inline, `re.match(r'\.word
0x([0-9a-f]+)')` per line, filter `(w>>16) in range(1001,1056) and (w&0xffff)==8`).
**Extended 2026-07-04e to all 5 MEFT sub-entry type tags** (`0x04` tiny/color, `0x08` texture,
`0x10` control, `0x14` index, `0x18` mesh — same filter, `tag in {4,8,0x10,0x14,0x18}`): the
`0x10`/`0x14`/`0x18` tags produced **zero** additional hits (those pack sub-types are
evidently placed some other way, or not placed via this record shape at all), but **`0x04`
added 14 more stages** — verified to be the *same* sub-shape-1 (ambient/unconditional) record,
just with a different header constant family (`0x0X400001` instead of `0x02400001`,
correlating with the sub-entry type placed rather than being a fixed magic number). **Full
census, 19 stages:**

| Stage | Screen name | MEFT numbers used |
|---|---|---|
| wstag480 | South Sector — Jungle Grave | 1017, 1047 |
| wstag481 | (Jungle Grave variant) | 1017, 1047 |
| wstag490 | South Sector — Ether Jungle | 1017 |
| wstag205 | Central Sector — Asuka Bridge | 1009 |
| wstag320 | Asuka City — Asuka Sewers | 1037 |
| wstag321 | (Asuka Sewers variant) | 1012 |
| wstag535 | (South Sector, unconfirmed name) | 1010 |
| wstag537 | South Sector — Catacomb | 1010 |
| wstag538 | (Catacomb variant) | 1010 |
| wstag580 | West Sector — Dum Dum Factory | 1025 |
| wstag581 | (Dum Dum Factory variant) | 1025 |
| wstag705 | (West Sector, unconfirmed name) | 1001 |
| wstag735 | North Sector — Ice Dungeon | 1014, 1022 |
| wstag736 | (Ice Dungeon variant) | 1014, 1022 |
| wstag800 | Undersea Base — Magasta B2F | 1040 |
| wstag810 | Spy Satellite — Gunslinger 1F | 1010, 1035 |
| wstag815 | Spy Satellite — Gunslinger 2F | 1020, 1030, 1040, 1050 |
| wstag922 | (unconfirmed name) | 1009 |
| wstag938 | (unconfirmed name) | 1037 |

This is a **strong, thematically-consistent confirmation across the whole census, not just
the original 5**: jungle (1017/1047 — foliage/spore/mist), Asuka Bridge/Sewers (1009/1012/1037
— water/river effects, exactly the "Asuka waterfalls" the doc's original goal named),
Dum Dum Factory (1025 — industrial steam/machinery glow), Ice Dungeon (1014/1022 — ice
glints/frost sparkle), Undersea Base (1040 — underwater bubbles/glow — reuses the same MEFT
number 1040 that the Spy Satellite also uses, suggesting some MEFT numbers are generic
"glow/light" effects reused across unrelated locations, not bespoke-per-location), and the
Spy Satellite tower's denser set (1010/1035/1020/1030/1040/1050). Every location's effect
choice matches its visual theme with no exceptions — strong evidence the census methodology
(type-tag pattern match) is finding the real, complete authored content, not noise.

**⇒ There is no per-stage descriptor field or global table binding MEFT to stages** (the
`0x80099D80` descriptor's unexplained `+0x20/24/28/4C` "overlay ptrs" are NOT it, and neither
is SFSTDATA/SMDLDATA). Each stage's wstag script simply **hardcodes its own MEFT placement
records** as static data, read by the stage's init/step code alongside its NPC/exit/zone
tables — the same "per-stage authored content" pattern already established for
NPCs/scenes/story_steps. The s225 login-room negative result stands (it has none of these
records — its halo is a different, non-MEFT primitive system, per the 2026-07-04b session).

### ~~2026-07-04e: the header actually splits into TWO distinct record sub-shapes~~ ⚠️ FALSIFIED (session 2, below): both "sub-shapes" were misparses — shape 1 = the 9-u16 point records misaligned, shape 2 = warp/trigger-table act records

Dumped the full ±16-byte window around every one of the 8 confirmed texture-placement
records (from the original 5-stage `0x08` scan, before the `0x04` sub-entry-type extension
documented above added 14 more stages) to compare headers directly, rather than guessing
from one example:

**Sub-shape 1 — "ambient/unconditional" (jungle stages, wstag480/481/490):**
```
{ packed byte word, e.g. 0x030303f2 }   # differs slightly per record; low byte often echoes something
{ 0 }
{ 0x02400001 }                          # CONSTANT — identical across all 5 jungle-type records
{ coord/anchor pair, e.g. 0x3d380138 }  # identical (0x3d380138) for BOTH records within wstag480
{ meftNumber<<16 | 8 }                  #     AND within wstag481 — but different in wstag490
{ variant, e.g. 0x303 / 0x31f / 0x319 } # differs per record, even within the same stage
{ 0x00010000 }                          # constant
```
The anchor word being byte-identical across *two different effects in the same stage* (both
wstag480 records = `0x3d380138`, both wstag481 records = `0x3d380138`, but wstag490's single
record = `0x110c010c`) means it's very unlikely to be a per-effect (x,y) placement — it reads
as a **per-stage** value (a scroll/parallax anchor or map-space origin applied uniformly to
every ambient effect in that stage), which fits "jungle mist/firefly overlay covering the
whole screen" better than discrete placed sprites. The `variant` word differing per record
(0x303 vs 0x31f within wstag480) is the one field that's genuinely per-effect — candidate for
scale, opacity, or animation-speed.

**Sub-shape 2 — "conditional/act-linked" (satellite stages, wstag810/815):**
```
{ 0 }
{ 0 }
{ ACT_ID }        # e.g. 0x4070-0x4073 in wstag815 — the SAME ids used as set_flag(id,1) targets
                   #  in the descriptor+0x24 act table (2026-07-04d) for that same stage
{ 0xffff }         # sentinel marking this record as act-gated, replacing sub-shape 1's 0x02400001+coord
{ meftNumber<<16 | 8 }
{ 0 }              # NOT a variant int — zero here
{ 0 }              # NOT 0x00010000 — zero here
```
The `ACT_ID` field is the clearest, most load-bearing new fact: it directly cross-references
the flag-setting stub ids from the OTHER (`descriptor+0x24`) table for the *same* stage —
i.e. **this MEFT placement is only active while/because that flag-tied act has run**,
matching the "Spy Satellite lights change with story progress" theme already established.
`0xffff` in the header position where sub-shape 1 has `0x02400001` looks like a **type
discriminant**: `0xffff` = "this is a conditional/act-gated placement, read `ACT_ID` from
+8", vs. an ordinary fixed-point-looking constant = "this is an unconditional/ambient
placement, read the anchor from +0xC". **Checked immediately — holds with zero exceptions
across all 8 known records**: wstag480×2/wstag481×2/wstag490×1 all have `0x02400001` at
header−8/coord at header−4 (shape 1); wstag810×2/wstag815×4 all have `0xffff` at header−4
with a real-looking id at header−8 (shape 2, `ACT_ID = 0x406f`/`0x16028` for wstag810's two,
`0x4070..0x4073` for wstag815's four). No third shape appeared. Not yet proven by a
decompiled consumer (still no `wstag`-base m2c decompile of the actual reader), but this is
now a data-verified, falsifiable classification rule — worth re-checking against the
sub-`0x18`/`0x10`/`0x14`/`0x04` scans once those are done (next steps below).

### 2026-07-04d: a second, more general per-stage table — `descriptor+0x24` points at a generic act/resource array; census across ALL 90 stages that have one

Right before each stage's texture-placement array sits a **second, more general table**,
pointed to directly by the stage descriptor's `+0x24` field (one of the "overlay ptrs" left
unexplained since the 2026-07-04 session), stride 5 words (0x14 bytes), terminated by
`0xFFFFFFFF`:

```
{ PTR_A }   # RAM address of real code in THIS wstag (an init fn or a set_flag(id,1) stub)
{ NUM }     # a resource id — range varies by subsystem (see below); NOT always a MEFT number
{ PTR_B }   # RAM address of real code in THIS wstag (an act-script entry point)
{ TAG }     # 0x0151NNNN in the two stages checked closely — see below
{ 0 }
```

**`descriptor+0x24` was verified to literally equal `table_start + 4`** (pointing straight at
record 1's `NUM` field) in both wstag815 (`+0x24=0x800a7260`) and wstag810
(`+0x24=0x800a7fd8`) — found by locating each stage's `sw $v0, 0x24($a2)` store and tracing
the `lui/addiu` computing `$v0` just before it. `PTR_A`/`PTR_B` were independently confirmed
byte-exact against real code: wstag815's `PTR_A=0x800a679c` is exactly the stub that calls
`set_flag(0x4070, 1)` (`flagapi+0xc`, `field-script-engine-verified.md:529`); `PTR_B` for its
first record is exactly the tail of the OnEnterMap descriptor-init function. So this is a real
record shape, not pattern-matching noise.

**Scripted a walker from `descriptor+0x24` to `0xFFFFFFFF` and ran it over every `wstag*.s`
(regex-locate the `sw $v0,0x24($a2)` store → resolve its `lui`/`addiu` operand → walk the
5-word array).** Found the table in **90 stages**. `NUM` spans wildly different ranges
depending on the stage — confirming this is a **general act/resource-registration table**,
not a MEFT-specific one: small values 0x27–0x378 (39–888, the documented **battle skill/summon
MEFT range**), several distinct hundreds-to-low-thousands ranges not yet identified (likely
other resource kinds — sound cues, particle ids), and one striking repeated constant
**`NUM=0x2328` (9000)** verbatim across many unrelated stages (wstag376/401/531/535/538/740/
741/745/746/810/949/953…) — almost certainly a shared universal system resource (not
per-stage art), not yet identified.

**Byte-checked the `NUM=9000` (`0x2328`) record directly (wstag376, table at file `0xa90`)**
to see if it's really the same 5-word shape: it is, stride-wise (`0xa90→0xaa4→0xab8`, each
+0x14), **but its normally-zero last word is repurposed**: `{PTR_A=0x800a5f2c, NUM=0x2328,
PTR_B=0, TAG=0, 0x8008bf38}` — that last field is a real **EXE-space function pointer**
(`0x8008bf38`, outside the wstag's own `0x800a5de0`-based range), not the `0` every other
record has there. So `NUM=9000` records carry an extra payload — probably "call this shared
EXE callback" rather than "bind this per-wstag resource" — a structurally distinct record
subtype hiding inside the same array. **This means a trustworthy NUM census needs a
stride/shape-aware parser, not a blind fixed-stride walk** — an earlier attempt at
aggregating NUM statistics across all 90 stages produced inconsistent counts (spurious
`0xFFFFFFFF` "NUM" values in ~51/249 records) that trace back to this kind of per-record-type
variation, not a script bug in the terminator check itself; that broader statistical census
is deferred, not delivered this session — the two confirmed facts above (battle range +
`9000` sentinel-with-payload) stand on their own byte-level evidence.

**Cross-checked against the field-MEFT (1001–1055) census from this table: only wstag810
(1010, 1035) and wstag815 (1020, 1030, 1040, 1041, 1050) show a field-MEFT NUM** — an exact
match with what the direct texture-placement scan already found for those two stages. **The
other 3 known field-MEFT stages (wstag480/481/490) do NOT have a field-MEFT entry in this
table** — their MEFT refs live *only* in the texture-placement array from 2026-07-04c. So the
two tables are related (share the same record-shape convention and, for the Satellite tower,
the same MEFT numbers) but are **not redundant** — this generic table is the wider "any
stage-local act may reference any kind of numbered resource" mechanism, of which "NUM ∈
1001–1055 = bind a field MEFT" is only the case actually exercised by the Satellite floors;
other stages evidently place their field MEFT purely via the texture-placement array without
also registering it here.

⇒ **The exhaustive field-MEFT-placement census is therefore the 19-stage texture-tag scan**
(`0x08`+`0x04`, listed in the 2026-07-04c section above) — this `descriptor+0x24` table only
corroborates 810/815 (the two stages where a MEFT-referencing act is also flag-gated) and
adds no stages beyond that 19. Two follow-ups still worth doing: (1) the `0x10`/`0x14`/`0x18`
sub-entry types produced zero hits under this exact pattern — worth a second pass with a
looser filter in case those types encode the MEFT number differently (not necessarily
`num<<16|tag` in a single word); (2) identify the other `NUM` ranges in this 90-stage table
(battle range and the `9000` sentinel aside) in case one of them is an alternate/indirect
field-MEFT reference this census is still missing.

**The `TAG` field (`0x0151NNNN` in wstag810/815) is a separate, still-valuable finding: a
single GLOBAL sequential index, not per-stage.** A plain grep for any literal `0x0151NNNN`
word across all `wstag*.s` (independent of the 5-word record walk above) found the exact
**contiguous run 0–18** split across one dungeon's stage cluster — `wstag800:[0,1,2,18]`,
`wstag805:[3,4,5]`, `wstag810:[6,7,8,11]`, `wstag815:[9,10,12,13,14]`, `wstag820:[15,16,17]`
— all five of which are **Spy Satellite floors** (810="Gunslinger 1F", 815="Gunslinger 2F",
820="Control Room"; 800/805 the same tower, floor names unconfirmed). Other locations reuse
small indices independently (e.g. `wstag480`/`wstag660` both show `10`), and — strikingly —
**`wstag250`/`wstag251`/`wstag932` all share index `1600`**, and `wstag661`/`wstag660` share
`2760`: several *different* stage records (story-variant duplicates of one location) sharing
one index.

**CORRECTION (2026-07-04f): found the actual consumer, and it re-classifies the TAG field —
it's a localized text reference, not a runtime animation-state slot.** Located the real
reader in `fieldstg.s` (file `0x2780`, RAM `0x80082cb0+0x2780`): a function that takes an id
`s1` (its own argument, passed in by *its* caller — not yet traced further up), walks the
`descriptor+0x24` array (`lw a1, 0x24(a0)` where `a0=0x80099d80`) comparing each record's
`NUM` word against `s1` until it matches, then reads that record's `TAG` field and does:
```
v0 = [0x8005CCA8]        # the LANGUAGE INDEX global (confirmed, same one used by the
                          # descriptor's own +0x44 estalk-bank field elsewhere)
v0 = TAG + (v0 << 16)
```
This is structurally identical to the already-documented `estalk bank = base + langIndex`
pattern (`docs/research/field/npc-decode.md` / the descriptor's `+0x44` field) — a `{bank
prefix, index}` pair combined with the language index to select a localized string. **So
`0x0151` (337) is very likely an ESTALK-style bank/table id, and `NNNN` is a string index
within it — not "an effect's runtime state slot".** This reframes but doesn't invalidate the
empirical fact above (the `0–18` run is contiguous across the Spy Satellite cluster, and
`1600`/`2760` are shared across story-variant duplicate stages): it now reads as **per-effect
flavor-text indices**, allocated sequentially within each location's text bank at build time,
and correctly shared across duplicate stage records because the physical location (and its
description text) doesn't change across story states. Immediately after this, the same
function separately calls the shared object-lookup helper `[0x8004b7bc]` (documented in
`docs/research/battle/battle-invocation.md`/`docs/research/audio/sfx-triggers.md`) with
`type=5` (= the **player object**) and conditionally invokes a player method — a side effect
unrelated to text or MEFT, confirming (again) that this `descriptor+0x24` array is a
**general per-stage scripted-cue table** (text + player-state checks + resource ids all in
one array), of which "NUM ∈ 1001–1055 → bind a field MEFT" is only the case the Satellite
floors happen to exercise. Full semantics of this table are **not** required to finish the
MEFT deliverable — the exhaustive field-MEFT stage census (the 19-stage texture-tag scan) and
its two header sub-shapes stand independently of this table.

Next steps to close this out for real (build the converter/walker support):
1. **Nail the exact placement position/size fields** within sub-shape 1's header (the
   `packed byte word` and the coord/anchor pair — confirmed *what* they roughly are in
   2026-07-04e, not their precise bit layout) — decompile the wstag815 init/step code with
   `overlay_to_fns.py`+m2c generalized to the shared wstag RAM base **`0x800a5de0`**
   (confirmed correct above; a copy with `BASE` patched is enough, no new tool needed).
2. **Identify the other `NUM` ranges** in the `descriptor+0x24` table (battle range 39–888
   and the `9000`-with-payload sentinel aside) — the hundreds/low-thousands values are still
   unclassified, and one of them could turn out to be an indirect/alternate field-MEFT
   reference this census is missing.
3. ~~Find the `0x0151NNNN` index consumer~~ **DONE 2026-07-04f** — it's a text/localization
   reference (`TAG + langIndex<<16`), not an effect-state slot; see correction above. Trace
   who calls `fieldstg 0x2780` with the target `s1` id if the exact caller ever matters.
4. **Try a looser filter for the `0x10`/`0x14`/`0x18` sub-entry types** — the exact
   `num<<16|tag` single-word pattern found zero hits for those three; they may encode the
   MEFT number across two words or via an indirection instead.
5. ~~Write `tools/extract_meft_placements.py`~~ ~~**DONE 2026-07-04g.**~~ ⚠️ **DELETED session 2 — the extraction was a misparse** (see falsification section below). Scanned all `wstag*.s`
   for the `meftNumber<<16|subTag` pattern (`0x04`/`0x08`), classifies each hit into the
   `ambient`/`act_gated` sub-shape via the header discriminant word, and emits
   `web/assets/data/meft_placements.json` keyed by stage — reproduces the 19-stage/27-record
   census above exactly (verified by direct comparison). Two corrections made while writing
   it: the "ambient" header constant is `0x0XY00001` (**two** varying hex digits — `0x02..`,
   `0x06..` — not the single-nibble `0x0X400001` first guessed from a smaller sample); with
   that fixed, wstag535/538 (missed initially) now match too. **Not yet wired into the
   walker's renderer** — that's the remaining step: sub-shape 1 (ambient) can render
   immediately; sub-shape 2 (act-gated) should gate on its `actId` flag (that binding is
   already fully understood, no further RE needed).

## Runtime session on s225 login room (2026-07-04b) — halo is probably NOT MEFT

> **✅ RESOLVED 2026-07-09 — see `materialize-effect-actor.md`.** The "untextured
> translucent primitives" guess below was wrong: the s225 halos are **point sprites**
> (additive-blend clips in the s225 MASK atlas). The persistent pad halos are ordinary
> active point records that `extract_point_sprites.py` was dropping (over-strict CLUT
> assert, fixed); the login/download *flash* is a per-stage actor that claims the 3
> `atlasFlag 1-3` slot records and animates them with `{spriteId, duration}` scripts
> (wstag212 download + wstag225 login decoded, extracted, wired). Next-step 1 below is
> done; strike it.

User savestate slot 1 = **s225** (login room, blue download halos on the pads;
stage lba `[0x80055d2c]` = 0x1d6 = WSTAG225). Full RAM + VRAM dumps taken
(`~/vm-spike/dumps/meft_login.bin`, `meft_login_vram.bin`, HTTP API port 8080).
Findings, all byte-checked:

- **SFSTDATA is NOT resident in s225 RAM.** Searched: full-file copy, every
  record's 0x50-byte tail (skipping the handle words), every record's
  tint+sublist slice — nothing (only generic all-zero/0x010101 false positives).
  So the preload either doesn't persist a plain copy, or the file is consumed
  transiently at stage init.
- **No MEFT type-8 texture is in s225's VRAM.** Decompressed every type-8 sub
  of all 57 MEFT10xx packs (`unrlen` from `tools/extract_screen_packs.py`) and
  searched the 1MB VRAM dump for distinctive 32-byte pixel rows — zero hits.
  ⇒ the login-room halo is most likely **untextured translucent primitives**
  (native draw code), not a MEFT atlas — or s225 simply uses no MEFT at all.
  (Fits the user's hint: the halo belongs to the *download* system — the
  wstag212 download-materialize actor is already decoded in
  `docs/research/audio/sound-system.md` §2026-07-03l; its draw path is the
  next place to look for the halo primitives.)
- **No MEFT/SFSTDATA handles resident anywhere in RAM** (u32 == idx<<16 scan
  over all 57 field MEFT idxs + 0x1CB/0x1CC). The single "MEFT1017 handle at
  0x800dd7b0" hit was a false positive — that region is 4bpp pixel nibbles.
- **wstag225 init decoded** (file 0x540, RAM 0x800a6320): fills the 0x80099D80
  descriptor exactly as the runtime dump shows (PACK 0x19E, TMPK 0x19F<<16,
  MASK 0x3CD, music 0x33/0x60CC<<16 with two conditional variants → 0x1F/0x607C
  gated on `[0x8004b370]` ordinal ranges 0x14–0x17 and 0x27–0x28), then calls a
  **fieldstg runtime fn table at `0x8009B6C4`**: `[+0x40](0, 0x019F0001, 0x17700)`,
  `[+0x40](7, 0x019F0002)`, `[+0x50](0)` — i.e. pack-sub handle loads
  (TMPK subs 1/2). **No MEFT reference anywhere in the wstag225 init.**
- **SMDLDATA.PRO top level decoded — it is NOT the stage→effect binding.**
  Header `{runtime-ptr slot, 0x10, 0x2458, 0x4e74}`. Section 0x10..0x2458 =
  grouped u32 entries `{u8 A, u8 seq, u16 lba_idx}` where `seq` counts 0..N
  within each group; group 1 = 55 entries whose `A` is a permutation of 1..55
  (a load-order/sort index) over a mixed file set (wstag210/220/225, movies,
  card-game, estalk, P00x sprites, FIGHTSTG, STAGSLCT…) — i.e. **disc-batch /
  preload manifests** (the intro/login set), not per-stage effect records.
  Sections 0x2458/0x4e74 = model-ish records with pack handles (0x7A6<<16,
  0x646<<16) + geometry — the actual stage-model data, unexplored.

Next steps after this session:
1. **Halo**: decompile the wstag212 download-effect actor's *draw* path
   (handler file 0x368 / RAM 0x800a6148 — already located in the sound decode)
   and the wstag225 actor code past init (step-script bytes start ~file 0x680)
   — expect GPU poly prims (semi-transparent blue), not textures.
2. ~~**MEFT binding**: redo the RAM+VRAM capture on a stage with a *known*
   textured MEFT effect~~ — superseded by the static-data census (2026-07-04c-g
   above); no emulator capture was needed after all.
3. ~~fieldstg SFSTDATA consumer decompile~~ — done 2026-07-04c (turned out to
   be the loading-screen wipe, unrelated to MEFT binding).

## 2026-07-04i: most census MEFT packs are mesh/particle systems, not flat textures — a real rendering-scope correction

~~While starting the render-wiring handoff... only 4 have any `0x08` texture sub at all...~~

**⚠️ CORRECTED 2026-07-04 (format-decode session): this was based on checking the `0x08` tag
only.** Tag `0x0c` turns out to be functionally identical to `0x08` (same RLEN-compressed
64×256 16bpp atlas, just a 4-byte-longer header — see the "MEFT pack sub-entry format"
section above, byte-verified 10/10 instances). **14 of the 15 census MEFT numbers (all except
1022) have a real, extractable texture atlas** via one tag or the other — not just the 4
originally found. The `0x18` mesh data is still real and still present in most packs
alongside the texture (so these effects likely combine a mesh/particle placement *with* a
real texture, e.g. a textured particle billboard — a common effects technique), but "most
effects have no texture at all" is **false**; retract that specific claim. The general
point — that `0x18`/`0x10` mesh/emitter data exists and its exact fields aren't fully pinned —
still stands, see the "MEFT pack sub-entry format" section above for what's now known about
each tag's byte layout (data-driven inference, no decompiled consumer found — see
`meft-parser-search-log.md`).

**Original (2026-07-04i) text, kept for the session trail:** While starting the render-wiring
handoff (`docs/todo/2026-07-04-meft-render-wiring.md`), checked every one of the 15 distinct
MEFT numbers in the 19-stage census against its own pack file's sub-entry type tags (first
u32 of each `MEFT10xx/N.bin`). Only 4 have any `0x08` texture sub at all: MEFT1010, 1020,
1030, 1050 — all four are the Spy Satellite tower's `act_gated` effects. Every other MEFT
number in the census (1001/1009/1012/1014/1017/1022/1025/1035/1037/1040/1047 — every jungle
effect and nearly every `ambient` placement) has zero `0x08` subs; their packs are dominated
(60–90%) by `0x18` (mesh/vertex) entries, with a handful of `0x10` (72-byte emitter/placement
control) and one `0x04`/`0xc` each. Reusing the existing 3D fight-effect rendering pipeline
(`docs/research/fight-3d/`) is likely a better starting point than building a new 2D overlay
layer, which would only ever cover the 4 texture-backed numbers.

## 2026-07-04 format-decode session, Task 4: placement-record consumer — also a dead end

Attempted to decompile the code that reads a stage's texture-placement record (the `{header,
meft<<16|tag, variant, 0x10000}` array) to pin what `anchor`/`variant` actually mean, per
`docs/superpowers/plans/2026-07-04-meft-format-decode.md` Task 4. Disassembling wstag815's
file region `0x1300-0x1480` (`overlay_scan.py dis wstag815 0x1300 0x1480`) confirms **this
entire region is DATA** (the placement records themselves — capstone produces nonsense
"instructions" like `tge $zero,$zero,0x101` when fed real data words, the same signature
already seen once this session when a different data region was mis-fed to the decompiler).
There is no code co-located with this table to read.

Checked whether any of the stage descriptor's other pointer fields (`+0x10, +0x14, +0x20,
+0x28, +0x4c` — all "overlay ptrs" left unexplained since the very first 2026-07-04 session)
point at this table, the way `+0x24` was found to point at the *other* table
(`descriptor+0x24` act/resource array, 2026-07-04d). None do — each of those fields points at
a different small table/pointer chain (e.g. `+0x4c` points at yet another pair of RAM
pointers, `0x800a7084`/`0x800a7098`, not investigated further this session). **So this
placement table's consumer is not reachable through the descriptor bank at all** — it must be
read some other way (a literal address baked into shared engine code, or found via the
`descriptor+0x24` table's `PTR_B` act-script entries rather than a direct pointer).

**Conclusion: this is a second genuine dead end this session**, alongside Task 2's (no shared
pack-format parser found). Both were investigated with the right tools (structural disasm
search, not guesswork) and both come up empty within this session's time — not for lack of
trying. `anchor`/`variant`'s exact semantics remain **not pinned**; the data-driven read from
2026-07-04c/e stands as the best available characterization (anchor = per-stage constant,
likely a scroll/parallax origin; variant = per-effect, likely scale/opacity/animation-speed —
unconfirmed either way).

## 2026-07-04 format-decode session, Task 5: cross-check + close-out

**Cross-check against wstag480's jungle mist (MEFT1017, `ambient`).** Per
`meft-pack-tag-census.json`, MEFT1017's pack has 27 sub-entries: one `0x04` (fixed boilerplate
per the format writeup above), twelve `0x10` (72-byte — check whether these are the fixed
boilerplate variant or the varying kind; not individually re-verified this pass), twelve
`0x18` (mesh — the vertex/normal-like data), one `0xc` (**confirmed RLEN texture atlas** — so
this "mist" effect DOES have real pixel data, contradicting the original 2026-07-04i
mesh-only read), and one `0x19` (insufficient samples, size 152). This is consistent with a
**textured particle effect**: mesh/emitter data placing small billboards or particles, each
sampling from the one real texture atlas in the pack — a coherent, plausible rendering model
for "drifting mist/spore particles," though not proven by a decompiled consumer.

**Savestate/VRAM cross-check: not attempted this session** — the `~/vm-spike` PCSX-Redux rig
was not running and starting it was out of scope for a decode-only pass with no renderer to
compare against yet; a future session should do this once a renderer (or even a static
wireframe-dump script) exists to produce something comparable to a screenshot.

**Success criteria from `docs/superpowers/specs/2026-07-04-meft-render-wiring-design.md`,
final status:**
- *"Every sub-entry type tag has a disasm-sourced, documented byte layout"* — **partially
  met**. No disasm-sourced layout was found for any tag (both the pack parser and the
  placement consumer were genuine, documented dead ends). Every tag DOES have a
  data-driven/cross-referenced layout, clearly labeled as inferred rather than proven,
  including one high-confidence structural finding (`0x0c` = texture atlas, byte-verified by
  direct decompression, not mere pattern-matching).
- *"anchor/variant fields have a disasm-sourced explanation"* — **not met**. Still open,
  same reasons as above.

This is an honest partial outcome, not a failure to hide: the one static disasm search
attempted (the only method the user authorized) came up empty in the time available, and the
data-driven fallback (explicitly permitted by the spec as a labeled-inferred substitute)
produced real, useful, higher-confidence-than-guessing results — most importantly the `0x0c`
texture-atlas discovery, which changes the render-wiring scope back toward "mostly
texture-renderable" rather than "mostly needs new 3D capability." Next session, if more
decode depth is wanted before starting a renderer spec: try the EXE-resident corpus properly
(a normalized-word disasm of `fns.s`, which this session's ad-hoc tooling couldn't parse — see
`meft-parser-search-log.md`'s "next-session leads"), or pursue the runtime/VRAM cross-check
once there's a first-draft renderer to validate against.

## Related user reports (this session's targets)

- **Palm tree (kickable, Kicking Boots quest) = FIELDCOM dir0 frames 56–64**
  (in the walker's `fieldcom.json`/`fieldcom0.png` already): frame 56 = intact
  palm (24×72 trunk layer + 56×56 canopy at dy −99); 57–64 = kick shake and the
  canopy/coconut falling in steps (dy −99 → −14). Frames 35–49 (15× 16×16 at
  dy −36) = a falling-item/sparkle strip; 96–99 = water-splash strip (fishing);
  20–34/65–95 = small direction-paired sprites (fishing bobber/cast?).
  NOT covered by the 11 indicator `programs` (those stop at id 70 and skip
  56-64) — the kick handler steps frames directly in code.
  **Placement is NOT in scene npcs[] nor story_steps.json** (s400 has neither)
  → next: decompile wstag400/401 act handlers for the palm coordinates + kick
  interaction (m2c recipe, base 0x800a5de0).
- maps.md: "black rectangles on some maps = missing tiles in extracted data" —
  candidate explanation: those regions are covered by MEFT overlays/models at
  runtime (verify per stage once effects render). Not yet investigated.

## 2026-07-04 session 2: ⭐ pack PROGRAM TABLE decoded — the container structure is now fully explained (data-verified 15/15)

The EXE-corpus tag-dispatch search (new tool `tools/exe_scan.py`; see
`meft-parser-search-log.md` session 2) found **no** MEFT tag dispatcher — and the reason
turned out to be structural: **most sub-entry first-u32s are not type tags.** Dumping the
"insufficient samples" odd-value family (`0x3/0x7/0x11/0x12/0x13/0x15/0x17/0x19/0x1b/0x21`)
side by side shows they are all ONE record type — and it explains the whole pack:

```
{ u32 texIdx }                    # sub-entry index of the pack's texture atlas
{ u32 count }                     # number of layers
count × { u32 0, u32 meshIdx, u32 ctrlIdx }
```

**Every one of the 15 census packs' LAST sub-entry is this record** (`len == 4*(2+3*count)`
exact, 15/15; first-word-of-triple zero, 15/15). Cross-referencing the indices against the
census: **every `meshIdx` names a `0x18` sub and every `ctrlIdx` names a `0x10` sub — 15/15
packs, zero exceptions**; `texIdx` names the pack's `0x08`/`0x0c` texture atlas in **14/14
packs that have one** (the one exception, MEFT1022, is exactly the pack with no texture —
its `texIdx=19` points at a `0x10` control sub instead).

⇒ **A MEFT pack = one program table (last sub) + `count` layers, each = (mesh `0x18`,
emitter-control `0x10`) pair + one shared texture atlas (`0x08`/`0x0c`) + one `0x04` + (in
some packs) one `0x14`.** The old "type tag" reading survives only as: `0x8`/`0xc` = RLEN
payload offset (byte-verified earlier), `0x18`/`0x10` = probably header sizes of their
record shapes. The odd "tags" were `texIdx` values all along (they varied because pack
layouts vary — `2*count+1` for the common layout `{count×(mesh,ctrl) pairs, then texture}`).

Evidence class: data-driven, but **exhaustive over the census with zero exceptions across
four independent predictions** (size formula, zero fields, meshIdx→0x18, ctrlIdx→0x10,
texIdx→texture) — much stronger than the earlier per-tag inference. Still pending a
decompiled consumer for the runtime semantics (draw order? layers all active at once?).
Remaining unknown internals: `0x18` mesh body (vertex/UV layout), `0x10` control fields
(88/96-byte varying variants), `0x04`, `0x14`.

## ⚠️ 2026-07-04 session 2: THE 19-STAGE PLACEMENT CENSUS IS FALSIFIED — the "MEFT numbers" were X COORDINATES

**Every section above claiming a stage→MEFT binding via wstag placement records
(2026-07-04c "RESOLVED", 2026-07-04d/e sub-shapes, 2026-07-04g extractor) is WRONG.**
Discovered while statically tracing the placement-table consumer (per the session-2 decode
plan): dumping the wstag480 table as a **u16 stream** instead of u32 words gives a perfect
9-u16 record alignment across all 29 consecutive records:

```
{ 0, 1, 0x240, groupA, groupB, kind, X, Y, 0 }     # 18 bytes per record
```

- wstag480 has three record families: `{gA=0x132, gB=0x3732, kind=8}` ×7 (X=191..901),
  `{gA=0x138, gB=0x3d38, kind=8}` ×12 (X=977..1096), `{gA=0x23e, gB=0xf00, kind=6}` ×9.
- **X is strictly increasing within each family** (coordinate-sorted authoring), and (X,Y)
  are plausible map pixels. The u32 word `meft<<16|8` the census matched was really
  `X<<16|kind` — the "MEFT numbers 1001–1055" were just **X coordinates in the 1001..1055
  pixel range**, and "variant" was the Y coordinate. The "19 thematically-matching stages"
  were confirmation bias (any big map has points with X>1000).
- The "anchor identical across records in a stage" observation is explained: it was the
  *previous record's* `(gB, gA)` group params read at the wrong alignment.
- The wstag810/815 "act_gated sub-shape" falls too: those are 6-u32 records in the separate
  **warp/trigger table** (`{actGate, 0xffff, target<<16|kind, y<<16|x, dir, 0}` — the same
  shape as live-RAM-verified real warps, e.g. s485's `{ffff,ffff,023c0001,03f8048e,3,0}` =
  screen 572, spawn (1166,1016), dir 3). Their kind-8 `target` values (1020/1030/1040/1050)
  are **act-table keys** (`descriptor+0x24` NUMs), not MEFT numbers: wstag485 has the same
  record with `target=0x5fa=1530` — no MEFT1530 exists. The `li $a0, 0x411` code hit that
  started the whole census is loading an act key, not a MEFT id.

**What still stands:** the MEFT pack-file format decode (the program table, texture
atlases, mesh/ctrl pairing — all about the files themselves, unaffected); the falsified
SFSTDATA finding; the per-stage descriptor decode. **What is OPEN again: whether/how field
stages reference MEFT1001–1055 at all.**

**The REAL system these tables implement (new, this session):** the point tables live in a
structure pointed to by **`descriptor+0x10`** (and a sibling at **`+0x14`**), consumed by
`fieldstg F0x80089490` / `F0x80088a4c` — both called with `(a0=[descriptor+0xc] = the TMPK
handle, a1=table)` from the field-engine setup fn at `fieldstg file 0x81a8` (RAM
0x8008ae58), results stored in the engine object at `+0x78`/`+0x68`. `F0x80089490` allocates
a 0x58-byte engine object via `0x80014504(cb=0x80089038, size=0x58, prio=4)` storing
`{+0x50: tmpkHandle, +0x54: tablePtr}` — i.e. **these are point placements OF MAP-TEXTURE
(TMPK) SPRITES: the real ambient map-effect system** (s485's analogous families match its
~11 pier torches; wstag480's kind-6 family lies along its river). The object's callback
`0x80089038` (fieldstg file 0x6388) is the actual per-frame parser/renderer — decompiling it
is the next step. `descriptor+0x4c` is a third, different list (pointer list to structs with
an id at +8 → spawned via `0x8009116c(id,0,0,0)`).

Corrected artifacts (this session): `web/assets/data/meft_placements.json` **deleted**
(wrong data, never wired into the game), `tools/extract_meft_placements.py` **deleted**
(wrong parse), `docs/todo/2026-07-04-meft-render-wiring.md` re-scoped, memory updated,
falsified-hypotheses entry added.

**⚠️ 2026-08-05 — one artifact was missed and outlived the falsification by a month.**
`tools/audit_stage_coverage.py` (written 2026-07-10, after this section) re-implemented
the census as its `meft_unrendered` bucket and reported "19 stages, 27 placements" at
the head of the project queue. Removed 2026-08-05 with a regression test. The 27 were
re-checked individually against shipped data: **21 are the X coordinate of a point
sprite the walker already draws** on that stage, and the **6** s810/s815 hits are the
`target` of the `{gate, 0xffff, target<<16|kind, spawn, dir, 0}` trigger record, whose
corpus-wide range of 270…1509 across 23 instances rules out a MEFT id (MEFT0270,
MEFT0730/0740/0760, MEFT0966 and MEFT1507–1509 have no pack file; the disc has 39–378
and 1001–1055). This confirms session 2's reading from the shipped side as well as the
overlay side. **The open question stands unchanged: no field stage is known to
reference MEFT1001–1055.** When falsifying a finding, grep the tools for it too.

## ✅ 2026-07-04 session 3: the point-table system fully decoded — it IS the ambient
map-effect system (windmills/torches/fans), and it does not use MEFT

Followed session 2's lead (decompile the `descriptor+0x10` consumer callback
`F0x80089038`). Full decode in **`point-sprite-ambient-system.md`** — 18-byte placement
records (X/Y/sprite-id/anim-mode/loop-range/period/y-sort-baseline), sprite directory =
TMPK sub-0 in the FIELDCOM format, **pixels = the stage MASK TIMs** (byte-verified on
wstag420: the Seiryu windmill blades sit at exactly the frame-directory rects in
`~/ddw3/tim/dw2003/field/stage/s420mask/0.png`), with a `0xFF` escape that draws from
FIELDCOM.BIN instead (likely the palm tree/splash placements). The user-visible goal of
this whole venture (animated ambient decorations) is served by THAT system; the
stage→MEFT1001–1055 binding question stays open but is now decoupled from the
render-wiring deliverable.
