# Hand-authored data installed into web/

`tools/install_authored_data.py` (build stage `authored_data`) copies every file
under `data/authored/<path>` to `<path>`. These files are written or measured by
this project; none is a byte or text copy of the game, and none has a generator
that could run from the public ddw3 tree.

| file | what it is |
| --- | --- |
| `web/assets/data/chapter_progression.json` | chapter ladder: which decoded story flag starts which chapter (curated) |
| `web/assets/battle/model_id_map.json` | species -> battle-model folder numbers; the EnemyId values come from ddw3 `rust/types/src/enemy_id.rs`, the folder choices (incl. the project's own custom model) are curated |
| `web/assets/battle/model_map.json` | battle-name -> model-folder table `resolveModelFolder` reads; hand-kept seed that `tools/build_model_map.py` then rewrites in place from `model_id_map.json` (the stage re-derives every row the species rule covers and leaves the rest) |
| `web/assets/data/maze_exits.json` | the 12 wrap-maze stages' real neighbour exits, captured live on the rig (their `wstag*.s` warp records are stale self-warps); `gen_scenes` uses it to wire the stages and place each exit on its type-7 grid wedge |
| `web/assets/data/dna_clip12.json` | camera/slot measurements of the DNA-digivolve clip, recorded from an emulator session |
