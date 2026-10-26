# Third-party and generated content

The README says this repository does **not** contain game assets, decompiled or
extracted original code, or data files from the original game. This page makes
that claim checkable: it classifies every tracked file that is generated *from*
the game data, and every file that is kept tracked although it is game-derived.

Method: every tracked path was matched against the output list of the
`build_all.py` stages and against the generation headers of `tools/*`; the
tracked copies of the build outputs were then hash-compared with a full
fresh build (they matched byte-for-byte). Files below are grouped by what they
are, not by where they live.

## 1. Build outputs — not tracked (rebuilt by `build_all.py`)

These are produced from the game-data tree the player supplies (`--ddw3 PATH`,
or `--fetch-data`) and are `.gitignore`d. This export sweep untracked them; a
fresh clone rebuilds all of them. The engine bundle reads the four generated
TypeScript tables, so `engine_bundle` depends on their stages.

| path | rebuilt by stage | notes |
|---|---|---|
| `data/screen_table.json` | `screen_table` | disc LBA table; also read by several stages |
| `data/stage_names.json` | `stage_names` | stage display names |
| `data/extracted_entities.json` | `wstag_extract` | scene/entity extraction |
| `data/stage_estalk_bank.json` | `stage_npc_banks` | NPC talk banks |
| `data/story-command-uses.json` | `story_command_uses` | census of the shipped scenes |
| `data/stagslct_catalog.json` | `stagslct_ui` | developer screen index |
| `engine/dw3/item-names.ts` | `item_names` | item display names (lang files) |
| `engine/dw3/item-data.ts` | `item_data` | consumable/booster records |
| `engine/dw3/item-directories.ts` | `item_directories` | item-ID directories (disc) |
| `engine/dw3/equipment-data.ts` | `equipment_ts` | equipment catalog |
| `engine/dw3/booster-items.ts` | `item_routes` | booster item ids (engine module) |
| `docs/generated/item-native-readers.json` | `item_native_readers` | raw item-possession census |
| `docs/generated/item-routes.json` | `item_routes` | durable item route census |
| `web/assets/native/manifest_completion.json` (+ images) | `native_overlays_completion` | completion-set overlay images |
| `web/stage-npc-programs.json` | `stage_npc_programs` | NPC programs served to the browser |
| `web/title-twinkle-data.js` | `stdwtitl_ui` | title-screen twinkle data |
| `web/vendor/engine.js` | `engine_bundle` | esbuild bundle of `engine/index.ts` |
| `web/vendor/engine-native.js` | `engine_bundle` | native-entry research bundle |

Already untracked before this sweep (same principle, see `.gitignore`):
`web/assets/**`, `web/assets-hd/**`, `web/cardshop-data/**`, `web/sfx-voice/**`,
`docs/research/fight-3d/**`, `docs/research/audio/{common-tones-full,soundtst-common-ids,soundtst-categories,phrase-notes}.json`,
`docs/research/audio/recovered/**`, `docs/research/story-progression/**`,
`docs/generated/**`, `recovered/**`, `exe-decomp/**`, `build/**`,
`content/**` (engine content converted by the `engine_bundle` stage),
`third_party/**` (SF2 banks the `music` stage builds from the tree's VABs).

Optional Digimon World 2 extras (the Unimon mount): `web/dw2models/**` is never tracked. Each player builds it from
their own Digimon World 2 disc on their own machine (launcher page `/__dw2003/extras.html`, or
`tools/dw2/dw2_addon.py`). The disc's models are read by `tools/dw2/dw2_disc.py` (ours) and turned into glTF by
jype's [dw2_model_converter](https://gitlab.com/jype/dw2_model_converter) (MIT; it builds on work by SydMontague
and RemyRM). The release workflow builds the converter from source at a pinned commit and ships it with its LICENSE
in `runtime/bin`; it contains no game data. `tools/dw2/needed.json` lists the models the game loads.

## 2. Game-derived files kept tracked (unavoidable, with reason)

These carry content decoded from the original game and are still tracked.
Each one is a build input, a test snapshot, or a table whose generator is not
wired into `build_all.py` in this export — removing them would break the build
or its test suite. Wiring their generators is listed as follow-up work.

| path | size | why it stays tracked |
|---|---|---|
| `data/stage_registry_members.json` | 388 KiB | Read by the `point_record_actors` build stage (tick resolution) and by `tests/stage-registry-members.test.js`. Its generator (`tools/inventory_stage_registry.py`) itself reads `point_record_actors.json`, so wiring it as a stage would be circular. |
| `data/stage_object_families.json` | 262 KiB | Read by `tests/stage-object-families.test.js` and the registry inventory tools. Generator `tools/inventory_stage_objects.py` is portable but not wired; its current output differs from the tracked snapshot, so wiring needs a reconciliation pass first. |
| `data/sfx-call-sites.json` | 3.3 KiB | Staged build input: `build_sfx.py` reads it; also read by `tests/sfx-manifest.test.js` / `tests/sfx-phrase-callers.test.js`. Decoded by one-off passes, no generator. |
| `data/scrolling_walls.json` | 4.6 KiB | Decoded table (`tools/extract_scroll_walls.py`); read by `tests/scrolling-wall-position.test.js` / `tests/scrolling-wall-census.test.js`. Generator not wired. |
| `data/translated_functions.json` | 270 KiB | Hand-curated registry (original function address → our port + oracle test); read by the native screen probe, `query_recovered_inventory.py`, `test_translations.mjs`. No generator exists. |
| `data/screen_progress.json` | 152 KiB | Hand-maintained work log (project state, not game data); read by the status/ownership reports. |
| `data/native_screen_roots.json` | 8.2 KiB | Hand-maintained list of screen roots; **input** to the `native_screens` / `translated_screen_data` stages. |
| `data/language_table.json` | 1.8 KiB | Authored table with provenance (language global + name table decode). |
| `data/intro_re_findings.json` | 4.2 KiB | Authored research notes (intro function semantics). |
| `data/door_wiring.json` | 2 B | Placeholder (`{}`), authored. |
| `docs/research/audio/sfx-triggers.json` | 49 KiB | Hand-curated decode notes (call-site evidence for each sound); tracked deliberately (see `.gitignore` comment). |
| `docs/generated/function-extents.json` | 1.2 MiB | Generated function-entry/extent table for the assembly corpus. Read by the native screen probe (`indexModule`'s resident-fragment tiling) and the native-screen tests. Its generator (`tools/build_function_extents.py`) needs the 616 MB `.dw3-research/index.sqlite3` research database, which is not part of this export, so the table is tracked instead of rebuilt. |
| `engine/dw3/annotator-shapes.ts` | 174 KiB | Generated by `tools/extract_annotator_shapes.py` (reads the ddw3 pack tree). Imported by the engine bundle; generator not wired. |
| `engine/dw3/annotator-tables.ts` | 6.0 KiB | Generated by `tools/extract_annotator_tables.py` (reads ddw3 overlays); imported by the engine bundle. |
| `engine/dw3/movie-destinations.ts` | 2.4 KiB | Generated by `tools/extract_movie_destinations.py` (reads `stdwtitl.s` + `lbas.toml`); imported by the engine. |
| `engine/dw3/npc-sizes.ts` | 2.9 KiB | Generated by `tools/extract_npc_sizes.py` (reads the disc's FIELDSTG); imported by the engine. |
| `engine/dw3/street-light-tables.ts` | 2.2 KiB | Generated by `tools/extract_street_lights.py` (reads wstag780); imported by the engine. |
| `engine/dw3/street-screen-tables.ts` | 16 KiB | Generated by `tools/extract_street_screens.py`; imported by the engine. |
| `engine/dw3/street-vehicle-tables.ts` | 878 B | Generated by `tools/extract_street_vehicle_tables.py`; imported by the engine. |
| `engine/systems/card-opcode-families.ts` | 5.3 KiB | Generated by `tools/gen_card_performance_table.py` from tracked research JSON; imported by the engine. |
| `engine/dw3/battle-damage-terms.ts` | 141 KiB | Our own TypeScript port (with `fightstg.s` citations), not extracted data. |
| `engine/dw3/equipment.ts` | 68 KiB | Our own helper code; imports the catalog from the generated `equipment-data.ts` (its header comment predates that split). |
| `web/system-status.json` | 1.1 MiB | Generated project status page (`tools/build_system_status.mjs`) joined from our research docs; read by `web/systems.html`. Not needed by the game; regenerable after a build. |
| `docs/generated/function-table.json` | 2.0 MiB | Per-routine navigation/join table of the original executable (`summary.functions` = 3,875). Rebuilt by `tools/build_semantic_graph.py`, whose inputs include the 616 MB `.dw3-research/index.sqlite3` research DB that is not part of this export — tracked for the same reason as `function-extents.json`. Read by the system-status page (`tools/build_system_status.mjs`, `web/systems.js`) and its tests. |
| `data/recovered-semantics.json` | 1.9 MiB | Recovered-code semantics (named globals, families, blocks and functions, each with a verification mark and ledger citations). The `recovered_semantics` stage installs it at `recovered/ddw3/semantics.json`, where the native screen probe and the native-bridge / native-screen tests read it. Its generator chain needs the un-exported research DB, so the table itself is tracked. |
| `docs/research/evidence/ledger.json` | 9.2 MiB | The research ground-truth store: 7,454 `evidence` records and 2,046 `claims` about the original game. Read by the system-status page and most research tooling (`tools/dw3_research/**`, `tools/audit_*.py`, `tools/build_system_status.mjs`, …) and cited from engine comments. Kept deliberately — it is the citation base the other research files reference. (Its `source` fields quote the author's machine paths.) |
| `docs/research/ui/current-ui-code-ownership.json` | 570 KiB | Per-routine UI/translation ownership report (`generatedBy: tools/report_ui_code_ownership.mjs`); read by `tools/verify_ui_flow.mjs` and the system-status page. Regenerable after a build, tracked so the status page works from a fresh clone. |
| `docs/research/systems/catalog.json` | 439 KiB | Navigation/coverage registry — which systems exist, what they own, their frontiers and implementation marks. Read by the research tooling and the system-status page; `tests/system-status-fresh.test.js` fails when a tracked file is owned by no system. Kept as the status page's input. |
| `docs/research/battle/data/battle-arena-meft03-census.json` | 50 KiB | MEft03 battle-arena census produced by `tools/census_battle_arena_meft.py`; read by `tests/battle-arena-meft03.test.js`. The generator is portable but not wired into `build_all.py`; the tracked snapshot is the test input. |

**Embedded UI strings (game-derived text inside authored code).** The ported
UI code reproduces the original screens, so it embeds the game's own short
message strings — the files say so themselves ("Real esitshop.toml strings",
"escardgm.toml … verbatim", "All text is real esnameet.toml content"):

- browser modules: `web/shop.js`, `web/cardshop.js` ("Not enough BIT.",
  "Too many items", "Equipped.", "How many?" …), `web/cardduel.js` (the
  duel's string bank; "Choose a folder", "No Cards in the Field."),
  `web/carddeck.js`, `web/carddeck-native.js`, `web/ui-flow-data.js`,
  `web/stplnmet.js`;
- engine modules driving the same screens: `engine/systems/card-inspect.ts`,
  `engine/systems/card-ceremony.ts`, `engine/systems/card-battle.ts`,
  `engine/dw3/ui/folder-session.ts`, `engine/dw3/ui/shop-buy-branches.ts`;
- tests/tools that assert on or extract those strings
  (`tests/cardshop-detail.test.js`, `tests/shop-hand-swap-close.test.js`,
  `tools/verify_*.mjs`, `tools/extract_*ui.py`), and the status/ledger docs
  that quote them.

These are short UI message strings (no dialogue text, no data tables), kept
because the screens are reproduced verbatim; this entry is their
classification rather than a removal.

## 3. Authored content (our own work, not game data)

- `data/custom/**` (~8 MB) — our custom battle-model sources (mesh, textures,
  anims) and the model registry; inputs to the `custom_fight_models` stage.
- `data/model-authoring/**` (~6 MB) — authoring recipes and reference images,
  plus `catalog.json` (a measurement database built from the *built* battle
  models by `tools/model_authoring.py`; tracked as the authoring tool's input).
- `tools/byod/**` — the bring-your-own-disc tool: our routing/decoding code and
  two patches against Marko's ddw3 extractor sources (reused with permission,
  credited), plus path lists (`data/discmap.json`, `data/readset.tsv`). No game
  content: the extractor binaries are built by the user from the ddw3 source,
  and the tree is decoded from the user's own disc.
- `engine/**`, `web/**`, `tools/**`, `tests/**` — our engine code, browser
  code, build tooling and tests.
- `docs/research/**` — research documents we wrote (the two tracked audio
  tables are listed in section 2).
- `web/jsonbourne.png` (2.3 MiB) — **not game data**: a meme poster, referenced
  by nothing. Kept (candidate for a future cleanup).
- `data/not-exported-files.json` — the export's scope record: the catalog-named
  files (walker-only tests) that are absent from this repository by design. Read
  by `tools/build_system_status.mjs` so they are reported as "not part of this
  export" instead of as missing files; anything missing without an entry here is
  still reported and still fails `tests/system-status-fresh.test.js`.
- `LICENSE`, `README.md`, `PLAYING.md`, `.github/**`, `package*.json`,
  `tsconfig.json`, `install-play.sh`, the root build scripts.

## 4. Checking the claim

```sh
git ls-files web/assets | wc -l            # 0 — no built assets tracked
git ls-files | grep -c ':Zone.Identifier'  # 0 — no Windows sidecar files
git grep -l 'Not enough BIT\.' -- web engine   # the embedded-string modules
python3 build_all.py --dry-run             # validates inputs without building
```

A full audit re-runs from a fresh clone: `install-play.sh --ddw3 <tree>` must
leave the sections 1 files rebuilt (hash-equal to a prior build) and never read
a path outside the clone + the given data tree (no `~/ddw3`, no `~/ddw3-walker`).
