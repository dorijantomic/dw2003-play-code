# byod — end-to-end report: "player's disc in, game out"

Scope: `tools/byod/` turns an EU Digimon World 2003 disc image (SLES-03936) into
the ddw3-shaped data tree; the dw2003-play-code build then reads that tree
exactly as it reads `~/ddw3`. This report is the evidence for that claim.

Everything below was produced in `~/.hermes/cache/scratch/byod/` from the EU
disc (`sha256 fb70dc9a995aed628cf515cabc87c7b14e5142559076ec394dfe793ec3e26a04`,
`~/vm-spike/dw2003.bin`), never touching `~/dw2003-play-code` or `~/ddw3`
(the builds ran in scratch copies of the repo).

## 1. Plain answer

**Yes — with two documented patches to Marko's tools.** A full build from the
generated tree produces a `web/assets/` that matches the build from the real
ddw3 tree: **5,645 of 5,723 files byte-identical; 0 missing, 0 extra, 0
unexplained**. The only two non-identical classes are provably not tree-related:
77 `.ogg` files whose container serial is random per encode (decoded PCM is
identical) and 1 JSON that embeds the absolute tree path (identical after path
normalisation). Every PNG is byte-identical between the two builds.

The one real defect found along the way — 420 map PNGs differing by one step of
8-bit colour — was root-caused to a 2023 encoding change in `untim` (commit
`cbbaf7569`) and fixed with `patches/ddw3-untim-duplicate-colours.patch`; with
it the generated tree is **pixel-identical to ddw3 on all 16,303 PNGs the build
reads** (before the patch: 15,883 pixel-identical, 420 differing).

## 2. What was done

1. Disc → tree: `python3 tools/byod/byod.py disc/dw2003.bin --out tree-gen5
   --tools <ddw3 tools built with patches/> --staging tree-gen/_disc --reuse-staging`
   → 65,965 files, 42,601 configs in 167 s (2,385 disc files extracted, 2,065 decoded).
2. Support files copied from ddw3 (see README): `asm/ rust/ tools/ iso/ data/`
   → `tree-final2`, 111,126 files.
3. Readset verification (`tools/byod/verify_readset.py tree-final2`): every one
   of the 65,884 paths the reference build reads, compared byte-wise vs
   `~/ddw3`, with PNGs pixel-compared — see §3.
4. End-to-end: two full builds (`python3 build_all.py --skip ddw3_disc`,
   `DW3_DISC=disc/dw2003.bin`) in scratch copies of the repo — `build-gen2`
   with `DDW3_DIR=tree-final2`, `build-ref2` with `DDW3_DIR=~/ddw3` — then
   `web/assets/` diffed file-by-file: **155/155 stages OK on both sides, exit
   0**, see §2b. (An earlier pair on an older repo snapshot with the unpatched
   tree, §2c, measured the effect of the colour difference.)

## 2b. End-to-end diff — corrected pair (build-gen2 vs build-ref2)

Repo: frozen snapshot `repo-snap2` (157 stages; `build_all.py` md5
`23f931bdf94c94d097f8a1325eeef16c`, taken while another worker was editing the
live repo). Both builds: 155/155 stages OK, exit 0.

`web/assets/` (5,723 files on both sides):

| class | count | explanation |
|---|---:|---|
| byte-identical | **5,645** | includes every PNG (maps, thumbs, sprites, effects, screens …) |
| `.ogg` byte-differing, PCM-identical | 77 | ogg stream serial is random per encode; decoded audio is identical (all 77 checked); re-rendering the same stage on the same tree reproduces the byte difference, first differing byte = the serial field |
| `.json` path-only difference | 1 | `data/jogress_scripts.json` embeds the absolute `DDW3_DIR` path; byte-identical after normalising the path |
| pixel-differing PNGs | **0** | — |
| missing / extra | **0 / 0** | — |
| unexplained | **0** | — |

Other generated outputs (outside web/assets): `docs/research`, `data`,
`exe-decomp` — 0 diffs. `docs/generated/item-native-readers.json`,
`docs/generated/item-routes.json`, `recovered/ddw3/function-inventory.json` —
differ only in embedded source paths (byte-identical after path normalisation;
`~/ddw3` vs the tree path).

## 2c. End-to-end diff — first pair (build-gen vs build-ref, unpatched tree)

5,703 files on both sides; **0 missing / 0 extra**; 5,413 identical. The
remaining 290 split into exactly three explained classes:

* **212 PNGs pixel-differing** — `web/assets/maps/*.png` (112) + `thumbs/*.png`
  (100): the one-step colour difference propagating from the 420 tree PNGs
  (fixed by the untim patch, §7). In the corrected pair these are all
  byte-identical.
* **77 `.ogg`** — as above (encoder serial randomness).
* **1 JSON** — `data/jogress_scripts.json` (embedded path).

## 3. Readset verification (tree-final2, corrected tool set)

**All 65,884 readset paths check out**: 49,580 byte-identical, 16,303 PNGs
byte-differing (2023 vs 2026 PNG encoder — pixels identical), **0 of 16,303
pixel-differing**, 0 non-PNG differing, 1 missing
(`tools/__pycache__/util.cpython-313.pyc` — a bytecode cache the build itself
re-creates on first import; confirmed created during the build).

Earlier run against tree-final (before the untim patch): 49,580 identical,
16,303 PNG byte-diffs of which **15,883 pixel-identical and 420 pixel-differing**,
0 non-PNG differing, 1 missing (same pyc).

## 4. Per-group table (readset paths, tree-final before patch)

| group     | files  | identical | output-identical | differing | missing | notes |
|-----------|-------:|----------:|-----------------:|----------:|--------:|-------|
| asm       |    345 |       345 |                — |         0 |       0 | 296 regenerated byte-identical + 50 copied from ddw3 (see §6) |
| data      |      1 |         1 |                — |         0 |       0 | `digimon_profiles.toml`, copied from ddw3 |
| dw2003    |     11 |        11 |                — |         0 |       0 | raw disc copies |
| iso       |      1 |         1 |                — |         0 |       0 | `dw2003-bootstrap/lbas.toml`, copied from ddw3 |
| lang_file |    420 |       420 |                — |         0 |       0 | |
| map       |    237 |       237 |                — |         0 |       0 | |
| map-tile  | 11,745 |    11,745 |                — |         0 |       0 | |
| pack      | 17,503 |    17,503 |                — |         0 |       0 | includes the 39 nested-screen entries fixed in the final tool |
| rlen      |  7,342 |     7,342 |                — |         0 |       0 | 3 mask tomls differ vs ddw3 but are not read (see §7) |
| rust      |      9 |         9 |                — |         0 |       0 | copied from ddw3 |
| sound     |    219 |       219 |                — |         0 |       0 | byte-identical; all 71 groups (see §5) |
| tim       | 11,745 |    11,745 |                — |         0 |       0 | |
| tim (.png)| 16,303 |         0 |           16,303 |         0 |       0 | byte-differ (encoder); 15,883 pixel-identical; 420 fixed by the untim patch |
| tools     |      3 |         2 |                — |         0 |       1 | pyc cache, auto-regenerated |
| **TOTAL** | 65,884 | 49,580 | 16,303 | 0 | 1 | |

After the untim patch (tree-final2, `dev/readset-final2.log`): the `tim (.png)`
row becomes 16,303/16,303 **output-identical (0 pixel-differing)**; every other
row unchanged. The shipped `tools/byod/verify_readset.py` reproduces the same
numbers.

## 5. Sound — resolved

First-run warnings (`sound batl00/batl10/bgm001…bgm026: missing vh/vb`, 27
groups) were a **rename bug, not a decode gap**: VAB bodies carry no magic, so
the first version's magic-sniffing rename failed. The fix renames every leaf of
`mv<group>/` to `.vb` by position (matching ddw3 commit 6ae1bd983). Verified:
`tree-final/sound/dw2003` is **byte-identical to `~/ddw3/sound/dw2003`** — 2,169
files, 0 diffs, all 71 groups present including bgm024/025/026.

## 6. Assembly (asm/) — 296 regenerated, 50 copied; the 14 residuals listed

346 `.s` files, all byte-identical to ddw3 in the final tree:

* **296/310** mechanically-derivable flat `pro/*.s` are regenerated
  **byte-identically** from the disc's raw overlay (ported ddw3 `objdump_pro`
  disassembly + the HEAD symbol map + section metadata).
* **14 residuals** — regenerated but not byte-identical, copied over from ddw3:
  `pro/cardgame.s` (12 hunks), `cnty_sel` (1), `fieldstg` (15), `soundtst` (2),
  `stagslct` (6), `stcrdabm` (1), `stcrddek` (1), `stcrdshp` (4), `stdgname` (3),
  `stgdglab` (4), `stitshop` (2), `stplnmet` (1), `ststatus` (3), `wfightmn` (68).
  Reasons (per-file diffs in `dev/asm_diffs/`):
  * **symbol-timing** (all 14): the committed files carry ddw3's *historical*
    symbol-replacement state — some addresses still plain where the HEAD symbol
    map has `F0x`/`D0x` names, and a few committed-only plain labels (`jal f2`)
    the derived map cannot express. Textual only; both forms encode identical words.
  * **data-tail truncation** (2 of 14): `fieldstg.s` omits the raw overlay's
    trailing 9,040-word data block (present in `FIELDSTG.PRO` at 0x10158+);
    `stitshop.s` omits 460 words at 0x9DF8+. Hand/tool edit in ddw3; the
    committed text is what the reference build consumed.
* **29 hand-authored** files (8 pro incl. subdirs + `sdigiedt`, 20 `exe/` incl.
  f0–f16/fns/loading/start, `macros.s`) and **7 structural** files (`smdldata`,
  `shocktst`, `stdwtitl`, `wfightts`, `fightstg`, `stfgtrep`, `stgtrain`) are
  **copied from the public ddw3 repo** — they are curated text, not derivable
  from the disc by mechanical disassembly.
* Reproduce: `python3 tools/byod/byod_asm.py --staging tree/_disc
  --objdump-bin <mipsel objdump> --ddw3 <ddw3 checkout> --out tree/ --report …`
  (shipped; run from its new home, output byte-identical to the verified tree).

## 7. Known differences vs ddw3 (all outside the readset)

* `lang_file/dw2003/spn/sstraini.toml` — one string renders as `\x0217` where
  ddw3 has `\x02\x05\x0b`: identical bytes (the tool's codepoint table maps
  0x05→"1", 0x0b→"7"); a formatting artifact, not read by the build.
* `rlen/dw2003/field/stage/{s237,s295,s455}mask/0.toml` — missing ddw3's
  `compatibility = "…"` metadata line (written by ddw3's `mkrlen`, not by the
  decode path). Not read by the build (no `*mask*` path is in the readset).
* `dw2003/AAA/DAT/**` beyond the 11 readset files: 36 files differ from ddw3's
  committed copies (region/disc-revision data; not read).
* PNG byte-level identity in the *tree* is not achieved (the 2023 `image` crate
  encoder is not reproducible with the 2026 one); pixels are what matter and are
  identical. Build outputs (maps/thumbs) are byte-identical.

## 8. Not checked / caveats

* The `ddw3_disc` stage (rebuilds a disc image from ddw3's own zbuild tree) was
  skipped in both builds — inapplicable when the disc is the input. `DW3_DISC`
  pointed at the same disc copy for both builds.
* `upscale_assets` (opt-in 4× derivative) not run.
* Build-side non-determinism (not tree-related): 77 `.ogg` serials per run,
  and 4 JSONs that embed absolute `DDW3_DIR`/source paths.
* The live `~/dw2003-play-code` was edited by another worker mid-run; the final
  pair was run on a frozen snapshot (`repo-snap2`, 157 stages). The older pair
  ran a 151-stage snapshot.

## 9. Merge readiness

**Ready.** `tools/byod/` is self-contained and mergeable into
`~/dw2003-play-code` as `tools/byod/`:

```
tools/byod/
  byod.py                 disc -> tree (stdlib only)
  byod_lib/{iso,kinds,decode,mips}.py
  byod_asm.py, byod_asm_gen.py   asm/ regeneration (296 byte-identical; the
                          non-derivable 50 copied from a ddw3 checkout)
  data/discmap.json       disc file -> tree path map
  data/readset.tsv        65,884 paths the build reads (verifier input)
  verify_readset.py       compares a tree against a ddw3 checkout
  patches/ddw3-lang-file-decode-loop.patch
  patches/ddw3-untim-duplicate-colours.patch
  README.md               credits (Marko / markisha64 / ddw3) + how to run
  REPORT.md               this file
```

Known integration notes for the lead:

* The tool needs Marko's binaries (built from a ddw3 checkout with the two
  patches) — `--tools <dir>`, or drop them in `tools/byod/ddw3-tools/`.
* Support files (`rust/`, `tools/{util,stitch-map}.py` +
  `ddw3-lang-file/src/codepoint.rs`, `iso/dw2003-bootstrap/lbas.toml`,
  `data/digimon_profiles.toml`) are copied from the ddw3 checkout — documented
  in the README; a future step could regenerate the rust tables from the disc
  (they are hand-written extracts, not mechanical).
* The play-code build then needs `DDW3_DIR=<tree> build_all.py --skip ddw3_disc`.

## 10. Evidence files (all under `~/.hermes/cache/scratch/byod/`)

| artifact | what it shows |
|---|---|
| `dev/readset-final2.log`, `dev/readset-final2-shipped.log` | readset verification, corrected tree (0 pixel diffs) |
| `dev/readset-final.log` | readset verification, pre-patch (420 pixel diffs) |
| `dev/e2e-v2.log` | final web/assets diff (this report's §2b) |
| `dev/e2e-v1.log` | first-pair web/assets diff (§2c) |
| `dev/clut_transform2.log` | 16,303/16,303 transform-exact check (§7 colour) |
| `dev/asm_diffs/` | per-file diffs for the 14 asm residuals |
| `dev/treegen5.log`, `dev/treegen4.log` | tree generation runs |
| `build-gen2.out`, `build-ref2.out` | final pair build logs (155/155 OK) |
| `build-gen.out`, `build-ref.out` | first pair build logs (151/151 OK) |
| `tree-final2/`, `build-gen2/`, `build-ref2/` | the final tree + both build trees |
