# Mount walk table: measured, not guessed

Every number here comes from the DW2 glTF joint data (`tools/walk_table.mjs`, `tools/scan_dw2_walks.mjs`,
`tools/dw2_plant_map.mjs`), never from a picture. A clip is a WALK only if all of these hold:

- **in place**: the skeleton root travels under 4% of the model height over the clip;
- **loops**: the last tick repeats the first within 3% of the height;
- **feet plant**: each measured foot is at its own lowest point, nearly still, for at least one run;
- **a gait, not a hop**: the feet do not all reach their peak on the same tick;
- **duty**: each foot is planted 8-90% of the ticks.

Feet are the four chain ends of the leg subtrees (Unimon: bone_9/13/18/22; Drimogemon: bone_18/21, two legs).

## Unimon

| file | clips | feet | walk loops |
|---|---|---|---|
| `033UNIM.gltf` (battle) | 11 (`anim_A..K`) | bone_9, bone_13, bone_18, bone_22 | **none** |
| `328QUNI.gltf` (overworld) | 2 (`anim_E0`, `anim_E1`) | 2 leaf joints | **none** |

`033UNIM` per clip (plant runs / duty / lift above the foot's own low point, in model units; height 1891):

| clip | dur | in place | loops | feet: runs/duty/lift | walk |
|---|---|---|---|---|---|
| anim_A | 1.233s | yes | no | 1/3%/13, 0/0%/572, 1/5%/7, 1/5%/7 | no |
| anim_B | 0.967s | travels | no | 0/0%/85, 1/3%/143, 0/0%/86, 0/0%/13 | no |
| anim_C0 | 0.233s | yes | no | 1/63%/120, 0/0%/106, 1/63%/132, 1/38%/138 | no |
| anim_C1 | 0.367s | yes | no | 1/17%/390, 1/8%/600, 0/0%/180, 0/0%/209 | no |
| anim_C2 | 0.633s | yes | no | 2/25%/845, 1/45%/1337, 2/15%/859, 2/40%/1124 | no |
| anim_F | 2.267s | travels | no | 1/3%/15, 1/58%/218, 1/1%/105, 1/1%/105 | no |
| anim_G | 2.267s | travels | no | 2/58%/1581, 2/54%/1412, 2/4%/763, 0/0%/667 | no |
| anim_H | 1.933s | travels | no | 2/71%/1611, 2/68%/1611, 0/0%/1018, 0/0%/1025 | no |
| anim_I | 1.833s | travels | no | 1/25%/1443, 1/21%/1516, 1/2%/21, 1/2%/21 | no |
| anim_J | 0.967s | yes | no | 2/7%/912, 1/13%/1397, 0/0%/1205, 0/0%/1261 | no |
| anim_K | 0.967s | yes | **yes** | 2/20%/175, 2/27%/55, 2/20%/350, 1/7%/96 | no: the front pair peaks together, the rear pair together, lifts 3-18% of height |

`anim_K` is the only looping, in-place clip in the whole battle set, and it is the idle/breathing clip (every DW2
battle model has it). `328QUNI` has an idle (`anim_E0`, 0.967s, in place, loop, 29-35 unit lift) and a hop
(`anim_E1`, 0.367s, travels). Neither Unimon file carries a walk.

## Drimogemon (the fallback MOUNT.md names)

| file | clips | legs | walk loops |
|---|---|---|---|
| `038DORI.gltf` (battle) | 12 | **two** (bone_18, bone_21) | **none** |
| `308QDRI.gltf` (overworld) | 2 | 2 leaf joints | **none** |

`038DORI anim_I` (1.300s) loops in place, but both legs plant and lift together (57% duty each, 1030 units of lift,
same peak tick): a two-footed hop, not a walk. `anim_K` is the small in-place step (one plant per foot, 17% duty).

## Other four-legged models checked

| model | best in-place loop | verdict |
|---|---|---|
| `047MONO` Monochromon | `anim_F` 2.333s | no: the front pair plants together, then the rear pair; 73-85% duty, no stance slide |
| `022GARU` Garurumon | `anim_C1`/`anim_H`/`anim_I` | no in-place loop with alternating feet (best score 5/13) |
| `105GRUR` Gururumon | same clip set as Garurumon | no |
| `036CENT` Centarumon | `anim_K` 0.967s | no: idle; its feet move in lockstep pairs |
| `203TRCR` Triceramon | no in-place loop | no |

A scan of all 2248 battle clips under `~/dw2-models/extract/Digimon` finds the same shape everywhere: `anim_K` is
the looping in-place idle, the attack clips travel, and no four-legged model has a clip where the feet alternate
through a planted stance. DW2 does not animate field movement with walk clips; its wild Digimon hop.

## What the mount does instead

`web/mount3d.js` calibrates a four-beat gait from the model's own four leg chains (`calibrateGait`, `applyGait`): for
each leg it finds the hip joint and the rotation axis that swings the foot along the model's forward axis, then
drives the legs a quarter cycle apart with a lift and a stance slide. `tests/mount.test.js` measures the result the
same way as the table above (each foot swings more than 3% of the model height along forward, lifts more than 0.5%,
and the four legs peak on at least three different ticks).

If a model ever does carry a real walk clip, the table takes it: `walk: { kind: "clip", name: "anim_X", fps: 30 }`,
and `clipWalkStats` refuses any clip that is not in place, does not loop, or has no alternating planted feet.

## Forward direction

Measured from the bind pose, not guessed: the head joint (`bone_3`, z -159) sits at negative z of the body root
(`bone_0`, z 0), so the model faces **-Z**. `measureRig` returns `forward: [0, 0, -1]`, the table stores it, and
`tests/mount.test.js` asserts it from the file.
