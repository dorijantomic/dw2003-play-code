"""One-button rebuild of web/assets/ from disc/packs. Thin orchestrator over tools/.

Usage:
    python3 build_all.py            # run every stage, dependency-ordered
    python3 build_all.py --profile hd  # native build + optional 4x asset pack
    python3 build_all.py --dry-run  # validate only (offline-safe)
    python3 build_all.py --list     # print stages + order
    python3 build_all.py --only 3d-models,scenes
    python3 build_all.py --skip music
"""
from __future__ import annotations

import argparse
import shutil
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional


@dataclass
class Stage:
    name: str
    cmd: list                      # tokens after `python`, e.g. ["tools/gen_scenes.py", "--all"]
    cwd: str                       # absolute dir to run in
    uv_with: tuple = ()            # uv --with extras, e.g. ("pillow",)
    inputs: tuple = ()             # paths that must exist for the stage to run (dry-run check)
    outputs: tuple = ()            # paths the stage is expected to produce
    deps: tuple = ()               # names of stages that must succeed first
    setup: Optional[Callable[[], None]] = None  # idempotent precondition
    env: dict = field(default_factory=dict)     # extra env vars merged into the subprocess
    opt_in: bool = False               # heavyweight/noncanonical derivative; run via --only
    uv_python: Optional[str] = None     # interpreter constraint for uv (e.g. torch needs 3.12)


def topo_order(stages):
    """Kahn's algorithm. Raises ValueError on a cycle or an unknown dep name."""
    by_name = {s.name: s for s in stages}
    indeg = {s.name: 0 for s in stages}
    for s in stages:
        for d in s.deps:
            if d not in by_name:
                raise ValueError(f"stage {s.name!r} depends on unknown stage {d!r}")
            indeg[s.name] += 1
    ready = [n for n, d in indeg.items() if d == 0]
    out = []
    while ready:
        n = ready.pop(0)
        out.append(n)
        for s in stages:
            if n in s.deps:
                indeg[s.name] -= 1
                if indeg[s.name] == 0:
                    ready.append(s.name)
    if len(out) != len(stages):
        raise ValueError("dependency cycle detected")
    return [by_name[n] for n in out]


def _resolve(cwd, p):
    pp = Path(p)
    return pp if pp.is_absolute() else Path(cwd) / pp


def validate(stages, repo_root):
    """Dry-run check: return human-readable problems (missing tool / missing input). Empty = OK."""
    problems = []
    for s in stages:
        tool = _resolve(s.cwd, s.cmd[0])
        if not tool.exists():
            problems.append(f"{s.name}: tool not found: {tool}")
        for inp in s.inputs:
            ip = _resolve(s.cwd, inp)
            if not ip.exists():
                problems.append(f"{s.name}: missing input: {ip}")
    return problems


def validate_authored(repo_root):
    """Check the hand-authored committed inputs (AUTHORED_DATA) exist and parse.

    These are NOT generated from ~/ddw3 — they're our own authored data the game
    requires (see AUTHORED_DATA). build_all doesn't build them; it guarantees they're
    present and well-formed so "run build_all, get a playable game" stays true.
    Empty list = OK.
    """
    import json
    problems = []
    for rel, _desc in AUTHORED_DATA:
        p = Path(repo_root) / rel
        if not p.exists():
            problems.append(f"authored input missing: {p}")
            continue
        if p.suffix == ".json":
            try:
                json.loads(p.read_text())
            except Exception as e:
                problems.append(f"authored input invalid JSON: {p} ({e})")
    return problems


@dataclass
class StageResult:
    name: str
    status: str          # "OK" | "FAILED" | "SKIPPED"
    detail: str = ""
    seconds: float = 0.0


# Every stage's interpreter gets these (several tools import Pillow/toml/numpy
# through shared helper modules without declaring it); one cached uv env.
BASE_WITH = ("pillow", "toml", "numpy")


def _build_argv(stage, uv):
    # A self-contained install (the packaged launcher) ships one interpreter with
    # every stage's packages preinstalled and no uv: run the stage on it directly.
    direct = os.environ.get("DW2003_PYTHON")
    if direct and not stage.uv_python:
        return [direct, *stage.cmd]
    if stage.cmd and stage.cmd[0] == "-c":
        return [uv, *stage.cmd]                       # python -c "<code>"  (tests only)
    with_flags = []
    extra = () if stage.uv_python else BASE_WITH
    for w in dict.fromkeys((*extra, *stage.uv_with)):
        with_flags += ["--with", w]
    python_flags = ["--python", stage.uv_python] if stage.uv_python else []
    return [uv, "run", *python_flags, *with_flags, "python", *stage.cmd]


_SETUP_LOCK = threading.Lock()


def run_stage(stage, uv, log_dir):
    log_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    if stage.setup:
        try:
            with _SETUP_LOCK:  # setups share toolchain/LFS state; never run two at once
                stage.setup()
        except (Exception, SystemExit) as e:  # setup is environment-specific; surface, don't crash the run
            return StageResult(stage.name, "FAILED", f"setup: {e}", time.time() - t0)
    for out in stage.outputs:  # tools assume their output directories exist
        op = _resolve(stage.cwd, out)
        (op.parent if op.suffix else op).mkdir(parents=True, exist_ok=True)
    log = log_dir / f"{stage.name}.log"
    argv = _build_argv(stage, uv)
    env = {**os.environ, **BASE_ENV, **stage.env}
    with open(log, "w") as fh:
        rc = subprocess.call(argv, cwd=stage.cwd, stdout=fh, stderr=subprocess.STDOUT, env=env)
    secs = time.time() - t0
    if rc == 0:
        return StageResult(stage.name, "OK", "", secs)
    return StageResult(stage.name, "FAILED", f"rc={rc}; log {log}", secs)


def default_jobs():
    """Parallel stage count: DW2003_JOBS, else the core count capped at 6 (the heavy
    stages hold hundreds of MB each, so more than that mostly costs memory)."""
    env = os.environ.get("DW2003_JOBS")
    if env and env.isdigit() and int(env) > 0:
        return int(env)
    return max(1, min(os.cpu_count() or 1, 6))


def _overlap(a: Path, b: Path) -> bool:
    return a == b or a in b.parents or b in a.parents


def _serial_order_edges(ordered):
    """name -> names that must finish first so parallel runs keep the serial order
    for stages that touch overlapping paths (one writes what another reads or
    writes). Stage definitions don't declare every such pair; the serial order
    always honoured them, so keep that order for exactly those pairs."""
    outs = [[_resolve(s.cwd, p) for p in s.outputs] for s in ordered]
    ins = [[_resolve(s.cwd, p) for p in s.inputs] for s in ordered]
    edges = {s.name: set() for s in ordered}
    for j in range(len(ordered)):
        for i in range(j):
            if (any(_overlap(o, p) for o in outs[i] for p in outs[j] + ins[j])
                    or any(_overlap(p, o) for p in ins[i] for o in outs[j])):
                edges[ordered[j].name].add(ordered[i].name)
    return edges


def run_all(stages, *, only=None, skip=None, include_opt_in=False,
            uv="uv", log_dir=Path(__file__).resolve().parent / "build/logs", jobs=None):
    ordered = topo_order(stages)
    if only:
        keep = set(only)
        ordered = [s for s in ordered if s.name in keep]
    elif not include_opt_in:
        ordered = [s for s in ordered if not s.opt_in]
    if skip:
        ordered = [s for s in ordered if s.name not in set(skip)]
    jobs = max(1, jobs or default_jobs())
    names = {s.name for s in ordered}
    waits = _serial_order_edges(ordered)
    for s in ordered:
        waits[s.name] |= {d for d in s.deps if d in names}
    index = {s.name: i for i, s in enumerate(ordered)}
    results = {}
    bad = set()  # names that FAILED or were SKIPPED -> propagate to dependents
    total = len(ordered)
    pending = list(ordered)
    running = {}  # future -> stage
    done_n = 0
    t_start = time.time()
    print(f"build: {total} stages, up to {jobs} at a time", flush=True)
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        while pending or running:
            # start every ready stage (lowest serial index first) while a slot is free
            for s in list(pending):
                if len(running) >= jobs:
                    break
                if any(w not in results for w in waits[s.name]):
                    continue
                pending.remove(s)
                dep_bad = [d for d in s.deps if d in bad]
                if dep_bad:
                    results[s.name] = StageResult(s.name, "SKIPPED", f"dep {dep_bad[0]}")
                    bad.add(s.name)
                    done_n += 1
                    print(f"[{done_n}/{total}] {s.name}: SKIPPED (dep {dep_bad[0]})", flush=True)
                    continue
                print(f"   start {s.name}", flush=True)
                running[pool.submit(run_stage, s, uv, log_dir)] = s
            if not running:
                continue
            finished, _ = wait(running, return_when=FIRST_COMPLETED)
            for fut in sorted(finished, key=lambda f: index[running[f].name]):
                s = running.pop(fut)
                res = fut.result()
                results[s.name] = res
                done_n += 1
                print(f"[{done_n}/{total}] {s.name}: {res.status}"
                      + (f" ({res.detail})" if res.detail else "") + f" [{res.seconds:.1f}s]", flush=True)
                if res.status != "OK":
                    bad.add(s.name)
    print(f"build wall time: {time.time() - t_start:.0f}s "
          f"(stage time {sum(r.seconds for r in results.values()):.0f}s)", flush=True)
    _print_summary([results[s.name] for s in ordered])
    return 0 if all(r.status == "OK" for r in results.values()) else 1


def _print_summary(results):
    print("\n=== SUMMARY ===")
    for r in results:
        line = f"  {r.name:<12} {r.status}"
        if r.detail:
            line += f" ({r.detail})"
        if r.seconds:
            line += f"  [{r.seconds:.1f}s]"
        print(line)
    n_fail = sum(1 for r in results if r.status == "FAILED")
    print(f"exit code: {0 if n_fail == 0 else 1}")


# --- idempotent setup (preconditions) ---------------------------------------
# Everything is built from the public ddw3 tree (https://github.com/markisha64/ddw3).
# The root stage `ddw3_disc` runs ddw3's own build, which re-creates the disc image
# ($DDW3/build/iso/dw2003.bin) and the extracted sound banks ($DDW3/sound) that the
# stages below read; see tools/build_ddw3_disc.py and tools/ddw3_toolchain.py.
#
# Those two tools ship only in the public export (public-overlay/tools/ — "the
# public build tooling the walker does not carry", docs/workflow/public-export.md),
# so the toolchain import is optional: the export has it, the walker does not, and
# the setup helpers below fall back to the tools the walker itself carries.

sys.path.insert(0, str(Path(__file__).resolve().parent / "tools"))

DDW3 = Path(os.environ.get("DDW3_DIR") or os.path.expanduser("~/ddw3"))


def _toolchain():
    """tools/ddw3_toolchain.py when this tree carries it (the export), else None.

    It provisions a userspace build toolchain (git-lfs, fluidsynth, binutils,
    zbuild, rust) for a fresh public clone; the walker resolves those tools from
    its own environment instead.
    """
    try:
        import ddw3_toolchain  # noqa: F401  (stdlib-only)
    except ImportError:
        return None
    return ddw3_toolchain


def _is_lfs_pointer(p: Path) -> bool:
    try:
        with open(p, "rb") as fh:
            return fh.read(40).startswith(b"version https://git-lfs")
    except OSError:
        return True


def lfs_satisfied() -> bool:
    """True when sprite-pack bins are real content (not unresolved LFS pointers)."""
    hits = list((DDW3 / "pack/dw2003/field/sprite").glob("*/*.bin"))
    return bool(hits) and not _is_lfs_pointer(hits[0])


def _git_lfs() -> Path:
    """A git-lfs executable: the export's toolchain module, PATH, or ~/bin."""
    tc = _toolchain()
    if tc is not None:
        return Path(tc.git_lfs())
    found = shutil.which("git-lfs")
    if found:
        return Path(found)
    local = Path.home() / "bin/git-lfs"  # the walker's userspace binary
    if local.exists():
        return local
    raise RuntimeError(
        "git-lfs not found (checked PATH and ~/bin/git-lfs); the public export's "
        "tools/ddw3_toolchain.py provisions one — this tree does not carry it")


def setup_lfs() -> None:
    """The ddw3 tree's LFS objects must be real files, not pointers."""
    if lfs_satisfied():
        return
    if not (DDW3 / ".git").exists():
        raise RuntimeError(f"{DDW3} is missing pack/dw2003/field/sprite data (an incomplete tree?)")
    git_lfs = str(_git_lfs())
    env = {**os.environ, "PATH": str(Path(git_lfs).parent) + os.pathsep + os.environ.get("PATH", "")}
    subprocess.call(["git", "lfs", "pull"], cwd=str(DDW3), env=env)
    if not lfs_satisfied():
        raise RuntimeError(f"{DDW3} still has git-lfs pointer files; run `git lfs pull` there")


def setup_fluidsynth() -> None:
    """Find (or, in the export, build once) the offline fluidsynth the music stage uses."""
    given = os.environ.get("FLUIDSYNTH") or shutil.which("fluidsynth")
    if given and Path(given).exists():
        os.environ["FLUIDSYNTH"] = given
        return
    tc = _toolchain()
    if tc is not None:
        os.environ["FLUIDSYNTH"] = str(tc.fluidsynth())
        return
    raise RuntimeError(
        "fluidsynth not found: set FLUIDSYNTH=<path> or put it on PATH, or run the "
        "music stage in the public export (its tools/ddw3_toolchain.py builds one) — "
        "this tree does not carry that module")


# --- the pipeline -----------------------------------------------------------
# Each stage shells out to ONE existing tool. cwd is always the walker repo root
# (tools that read ~/ddw3 do so via absolute paths internally). I/O verified
# against each tool's source on 2026-06-21 (see the design spec).

REPO = Path(__file__).resolve().parent
# The disc image ddw3's build lays out (stage ddw3_disc). DW3_DISC overrides it.
DISC = os.environ.get("DW3_DISC") or str(DDW3 / "build/iso/dw2003.bin")
# Every stage subprocess sees the same data-tree and disc locations.
BASE_ENV = {"DDW3_DIR": str(DDW3), "DW3_DISC": DISC}

# --- hand-authored committed inputs -----------------------------------------
# web/assets files that are NOT generated from ~/ddw3 — our own authored data
# (the game's logic, not a disc rip). build_all does NOT build these; it VALIDATES
# them as committed inputs the game requires (presence + JSON well-formedness).
# If/when a source extractor exists for one, promote it to a generated Stage above
# and drop it from here. Same category as the hand-written engine JS.
AUTHORED_DATA = ()

# Names of stages dropped because their tool ships only in the public export
# (public-overlay/tools/); read by _wire_dependencies.
_OVERLAY_MISSING = set()


def overlay_stage(name, cmd, cwd, **kw):
    """Stage(...) for a tool that exists only in the public export.

    public-overlay/tools/ materialises these tools into the export; the walker
    does not carry them (docs/workflow/public-export.md). The export registers
    the stage unchanged; a tree without the tool does not offer a stage it
    cannot run, and deps naming the dropped stage are pruned by
    _wire_dependencies.
    """
    if not _resolve(cwd, cmd[0]).exists():
        _OVERLAY_MISSING.add(name)
        return None
    return Stage(name, cmd, cwd, **kw)


STAGES = [
    # name             cmd                                    deps / io / extras
    Stage("screen_table", ["tools/screen_table.py"], str(REPO),
          inputs=(DISC,), outputs=("data/screen_table.json",
                                   "web/assets/data/screen_table.json")),
    Stage("stage_names", ["tools/stage_names.py"], str(REPO),
          inputs=("data/screen_table.json",), outputs=("data/stage_names.json",),
          deps=("screen_table",)),
    # The stage-entry location title card: the same fieldstg name table plus the
    # ten bar templates its presentation slides in.
    Stage("place_card", ["tools/extract_place_card.py"], str(REPO),
          inputs=(DISC, "data/screen_table.json"),
          outputs=("web/assets/data/place_card.json",),
          deps=("screen_table",)),
    Stage("wstag_extract", ["tools/wstag_extract.py", "--all", "--out",
                            "data/extracted_entities.json"], str(REPO),
          inputs=("data/screen_table.json",), outputs=("data/extracted_entities.json",),
          deps=("screen_table",)),
    Stage("build_assets", ["build_assets.py"], str(REPO), uv_with=("pillow",),
          inputs=("data/stage_names.json", "web/assets/data/map_sound_archives.json",
                  "data/screen_table.json"),
          outputs=("web/assets/manifest.json", "web/assets/events/wstag_events.json"),
          deps=("stage_names", "map_sound_archives"), setup=setup_lfs),  # also runs wstag_events internally
    Stage("tmpk_collision", ["tools/tmpk_collision.py"], str(REPO),
          inputs=("web/assets/manifest.json",), outputs=("web/assets/collision",),
          deps=("build_assets",)),
    # Global npc_id→sprite table the field engine uses (FIELDSTG .data @0x80099e00).
    # gen_scenes consumes it to assign each spawn its real sprite (NOT "p"+id).
    Stage("npc_sprites", ["tools/gen_npc_sprites.py"], str(REPO),
          inputs=(str(DDW3 / "rust/dw2003_pro_fieldstg/src/data.rs"),
                  str(DDW3 / "rust/dw2003_exe_data/src/lba.rs")),
          outputs=("web/assets/npc_sprites.json",)),
    Stage("stage_npc_banks", ["tools/build_estalk_bank.py"], str(REPO),
          inputs=("docs/generated/stage-descriptors.json",),
          outputs=("data/stage_estalk_bank.json",)),
    Stage("stage_npc_programs", ["tools/extract_stage_npc_programs.py"], str(REPO),
          inputs=("docs/generated/stage-descriptors.json", "web/assets/manifest.json",
                  "web/assets/npc_sprites.json", "data/stage_estalk_bank.json"),
          outputs=("web/stage-npc-programs.json",),
          deps=("build_assets", "npc_sprites", "stage_npc_banks")),
    Stage("gen_scenes", ["tools/gen_scenes.py", "--all"], str(REPO),
          inputs=("web/assets/manifest.json", "data/extracted_entities.json",
                  "web/assets/npc_sprites.json", "web/assets/data/maze_exits.json",
                  "web/assets/data/stage_place_points.json"),
          outputs=("web/assets/scenes",),
          deps=("build_assets", "wstag_extract", "npc_sprites", "stage_npc_banks",
                "stage_place_points")),
    # Decodes bug-maze trap pads (TMPK tile-type layer + act-13 reset warps)
    # into the scenes gen_scenes just wrote; must run after it (modifies in place).
    Stage("gen_trap_pads", ["tools/gen_trap_pads.py"], str(REPO),
          inputs=("web/assets/manifest.json",),
          outputs=("web/assets/scenes",),
          deps=("gen_scenes_final", "tmpk_collision")),
    # The story-command census reads the shipped scenes, so its checked-in snapshot
    # (data/story-command-uses.json, compared by tests/lane-b/story-command-dispatch.test.js)
    # has to be rewritten whenever they change -- it had no producing stage at all, which is
    # how 374b9e3a's generator change left it 17 rows behind the scenes it describes.
    # build_all only runs python, so the node census is invoked through a tool script.
    Stage("story_command_uses", ["tools/build_story_command_uses.py"], str(REPO),
          inputs=("web/assets/engine-content.json", "web/assets/data/story_steps.json",
                  "web/assets/scenes"),
          outputs=("data/story-command-uses.json",),
          deps=("gen_scenes_final", "gen_trap_pads", "engine_bundle")),
    Stage("build_dialogue", ["build_dialogue.py"], str(REPO), uv_with=("toml",),
          inputs=(str(DDW3 / "lang_file/dw2003/eng/estalk00.toml"),),
          outputs=("web/assets/dialogue",)),
    Stage("build_esdmg", ["build_esdmg.py"], str(REPO), uv_with=("toml",),
          inputs=(str(DDW3 / "lang_file/dw2003/eng"),), outputs=("web/assets/events",)),
    Stage("build_battle_data", ["tools/build_battle_data.py"], str(REPO),
          inputs=(str(DDW3 / "data/digimon_profiles.toml"), "web/assets/data/enemies.json"),
          outputs=("web/assets/data/digimon.json",)),
    # The eight per-roster-slot digivolution trees, read straight out of the
    # stfgtrep overlay image: the eight pointers at 0x8008903C and the 0x10-byte
    # records each one points at (pro/stfgtrep.s file 0x369C-0x390C).
    Stage("evolutions", ["tools/extract_evolutions.py"], str(REPO),
          inputs=(str(REPO / "web/assets/native/screens/pro_stfgtrep.bin"),),
          outputs=("web/assets/data/evolutions.json",),
          deps=("native_screens",)),
    # EXP/level-up/battle-reward/gym-training tables (stfgtrep + stgtrain overlay
    # data). battle_rewards[screen_id] = [dvexp, exp, bits]. See docs/research/
    # battle/exp-levelup-rewards-decoded-2026-07-10.md
    Stage("progression", ["tools/extract_progression_tables.py"], str(REPO),
          inputs=(str(DDW3 / "rust/dw2003_pro_stfgtrep/src/data.rs"),
                  str(DDW3 / "rust/dw2003_pro_stgtrain/src/data.rs")),
          outputs=("web/assets/data/progression.json",)),
    Stage("build_items", ["tools/build_items.py"], str(REPO),
          inputs=(str(DDW3 / "rust/dw2003_exe_data/src/data.rs"), "web/assets/data/item_effects.json"),
          outputs=("web/assets/data/items.json",)),
    # Real effect records + prices for all 403 items (Unknown1.f0 routing).
    # See docs/research/ui/item-system-decoded-2026-07-10.md
    Stage("item_effects", ["tools/extract_item_effects.py"], str(REPO),
          inputs=(str(DDW3 / "rust/dw2003_exe_data/src/data.rs"),
                  str(DDW3 / "rust/types/src/item_id.rs")),
          outputs=("web/assets/data/item_effects.json",)),
    # The 316-card battle catalog, read out of CARDPAK0..4.BIN at the 1580-byte
    # stride the resident selector F0x8001e7ec computes. See the extractor's
    # docstring for the full address chain.
    Stage("card_catalog", ["tools/extract_card_catalog.py"], str(REPO),
          inputs=(str(DDW3 / "lang_file/dw2003/eng/escardnm.toml"),
                  str(DDW3 / "lang_file/dw2003/eng/escardst.toml")),
          outputs=("web/assets/data/card_catalog.json",)),
    # The 60 Program-card effect records: the 0x2c-stride table at 0x800a4df4
    # that pro/cardgame's field getter F0x80083e34 reads, with the targeting
    # decoded from F0x800a36e4 / F0x8008eec8 / F0x8008ec44. See
    # docs/research/card/cardduel-rules-2026-08-06.md
    Stage("card_effects", ["tools/extract_card_effects.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/cardgame.s"),),
          deps=("card_catalog",),
          outputs=("web/assets/data/card_effects.json",)),
    # Merchant NPC -> shop_id binding (on_close bank 0x7a = shop launcher).
    # See docs/research/ui/item-system-decoded-2026-07-10.md §4
    Stage("merchant_shops", ["tools/extract_merchant_shops.py"], str(REPO),
          inputs=("web/assets/data/shops.json",),
          deps=("gen_scenes",),
          outputs=("web/assets/data/merchant_shops.json",)),
    # Gym greeter -> rank-menu group binding (on_close bank 0x94 = STGTRAIN
    # launcher; index = the 0-based progression.json rank_menus group, chosen by
    # the ID-card items). See docs/research/battle/gym-entry-and-rank-chain-
    # 2026-07-08.md §2026-07-26 (GYM-C009/GYM-C010).
    Stage("gym_ranks", ["tools/extract_gym_ranks.py"], str(REPO),
          deps=("gen_scenes",),
          outputs=("web/assets/data/gym_ranks.json",)),
    # NPC talk-give grants: mined from the scene NPCs' dialogue-state on_close
    # collection writes, so this MUST rebuild whenever gen_scenes reruns. It was
    # previously only ever listed as an input to item_obtain_index and had no
    # producing stage, so its output silently drifted from regenerated scenes.
    Stage("talk_grants", ["tools/extract_talk_grants.py"], str(REPO),
          deps=("gen_scenes",),
          outputs=("web/assets/data/talk_item_grants.json",)),
    # Native (raw-MIPS) item grants: wstag overlays whose on_complete NATIVE handler calls the
    # resident set_flag trampoline ([0x80048ac8]) directly with a collection-bank (0x80-0x8E)
    # immediate and $a1==1, bypassing the bytecode event-VM's on_complete_setflags entirely (so
    # extract_item_grants.py/extract_scripted_battles.py can never see them). Each site is
    # attributed to a real story event_id by matching its enclosing function's file offset to
    # wstag_events.json's on_complete_fn. See docs/research/story-progression/ for the DEKnowledge
    # (s526 event 760) worked example this closed.
    Stage("native_item_grants", ["tools/extract_native_item_grants.py"], str(REPO),
          inputs=("web/assets/events/wstag_events.json", str(DDW3 / "asm/dw2003/pro"),
                   str(DDW3 / "rust/types/src/item_id.rs")),
          deps=("build_assets",),
          outputs=("web/assets/data/native_item_grants.json",)),
    # Bank-0x70 REWARD/ACTION dispatch table (set_flag WRITE side of the same table
    # roster_predicate_table.json reads): only opcode-0x20 arg0==1 (CURRENCY ADD) records are
    # acted on. Static EXE data only (~/ddw3/rust/dw2003_exe_data/src/data.rs) — no scenes/rig
    # needed. See docs/research/field/bank70-reward-dispatch-2026-07-26.md.
    Stage("bank70_rewards", ["tools/extract_bank70_rewards.py"], str(REPO),
          inputs=(str(DDW3 / "rust/dw2003_exe_data/src/data.rs"),),
          outputs=("web/assets/data/bank70_rewards.json",)),
    # NPC/search-point BIT (money) grants: scene on_close writes of a bank-0x70 CURRENCY-ADD flag,
    # the money equivalent of talk_grants' item GiveItem (does NOT require a co-occurring item —
    # e.g. the s235 Asuka Inn shelf search point grants BIT only).
    Stage("bank70_money_grants", ["tools/extract_bank70_money_grants.py"], str(REPO),
          inputs=("web/assets/data/bank70_rewards.json",),
          deps=("gen_scenes", "bank70_rewards"),
          outputs=("web/assets/data/bank70_money_grants.json",)),
    # NPC partner handovers: scene on_close writes of a bank-0x70 opcode-0x10 case-3 flag
    # (`roster_owned[slot] = slot+3`). roster_predicate_table.json is checked in (extracted
    # from a RAM dump by tools/extract_roster_predicate_table.py, not a build stage), so it
    # is an input file here rather than a dependency.
    Stage("bank70_partner_grants", ["tools/extract_bank70_partner_grants.py"], str(REPO),
          inputs=("web/assets/data/roster_predicate_table.json",),
          deps=("gen_scenes",),
          outputs=("web/assets/data/bank70_partner_grants.json",)),
    # Data-word residue census: collection-bank (0x80-0x8E) flag ids that appear as
    # DATA WORDS inside {id,expected} predicate tables rather than code immediates
    # (the surface scan_flag_setters/extract_native_item_grants/extract_talk_grants
    # cannot see). Informational only -- every residue entry found to date is a GATE
    # read, not a grant, so nothing here feeds item_obtain_index. See
    # docs/research/field/dataword-flag-residue-2026-07-26.md.
    Stage("dataword_flag_refs", ["tools/extract_dataword_flag_refs.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"), str(DDW3 / "asm/dw2003/exe"),
                   str(DDW3 / "rust/types/src/item_id.rs")),
          deps=("gen_scenes",),
          outputs=("web/assets/data/dataword_flag_refs.json",)),
    # Per-item obtain-path index (item-side authenticity audit): joins cutscene/talk
    # grants + merchant stock + enemy drops; names every source-less item.
    Stage("item_obtain_index", ["tools/build_item_obtain_index.py"], str(REPO),
          inputs=("web/assets/data/item_grants.json",
                  "web/assets/data/talk_item_grants.json",
                  "web/assets/data/native_item_grants.json",
                  "web/assets/data/merchant_shops.json",
                  "web/assets/data/shops.json",
                  "web/assets/data/enemies.json",
                  "web/assets/data/item_effects.json"),
          deps=("merchant_shops", "item_effects", "talk_grants", "native_item_grants"),
          outputs=("web/assets/data/item_obtain_index.json",)),
    # Equipment catalog TS module (incl. decoded accessory effects).
    Stage("equipment_ts", ["tools/build_equipment_ts.py"], str(REPO),
          inputs=("web/assets/data/equipment.json",),
          outputs=("engine/dw3/equipment-data.ts",)),
    # Engine consumable/booster records generated from the decoded effect table.
    Stage("item_data", ["tools/build_item_data.py"], str(REPO),
          inputs=("web/assets/data/item_effects.json",),
          deps=("item_effects",),
          outputs=("engine/dw3/item-data.ts",)),
    # The five item-ID directories F0x800135E8 walks, straight out of the disc's
    # resident image — the order every item list in the game appears in.
    Stage("item_directories", ["tools/build_item_directories.py"], str(REPO),
          inputs=(DISC, str(REPO / "tools/build_native_screens.py")),
          outputs=("engine/dw3/item-directories.ts",)),
    Stage("item_names", ["tools/build_item_names.py"], str(REPO),
          inputs=(str(DDW3 / "lang_file/dw2003/eng/esitmnam.toml"),
                  str(DDW3 / "lang_file/dw2003/eng/esitminf.toml")),
          outputs=("engine/dw3/item-names.ts",)),
    Stage("fieldcom_icons", ["tools/extract_fieldcom.py"], str(REPO), uv_with=("pillow",),
          inputs=(str(DDW3 / "dw2003/AAA/DAT/FIELD/FIELDCOM.BIN"), DISC),
          outputs=("web/assets/ui/fieldcom.json",
                   "web/assets/ui/fieldcom0.png", "web/assets/ui/fieldcom1.png",
                   "web/assets/ui/fieldcom0_semi.png", "web/assets/ui/fieldcom1_semi.png",
                   "web/assets/ui/field_shadow.png")),
    # Digi-Egg dive-transition demos: Submarimon (water/seabed, archive 0x88c)
    # and Digmon (hole, archive 0x88d). Same sprite-directory + RLEN/TIM atlas
    # format as FIELDCOM; see tools/extract_dive_demo.py.
    Stage("dive_demo", ["tools/extract_dive_demo.py"], str(REPO), uv_with=("pillow",),
          inputs=(str(DDW3 / "pack/dw2003/field/stage/ssubdemo/0.bin"),
                  str(DDW3 / "pack/dw2003/field/stage/ssubdemo/1.bin"),
                  str(DDW3 / "pack/dw2003/field/stage/sdigdemo/0.bin"),
                  str(DDW3 / "pack/dw2003/field/stage/sdigdemo/1.bin")),
          outputs=("web/assets/effects/dive/dive_demo.json",
                   "web/assets/effects/dive/ssubdemo.png",
                   "web/assets/effects/dive/ssubdemo_semi.png",
                   "web/assets/effects/dive/sdigdemo.png",
                   "web/assets/effects/dive/sdigdemo_semi.png")),
    # The stage cast list (scene descriptor +0x4C) and its ONE reader: the cast
    # rebuild's player loop (0x146/0x147 dive forms, charId 1) and its general
    # actor loop (every other record). This decode derives the dive-form markers
    # and the charId-1 rows from the same walk, so the three files cannot drift.
    # tools/extract_cast_lists.py.
    Stage("cast_lists", ["tools/extract_cast_lists.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"), "docs/generated/stage-descriptors.json"),
          outputs=("web/assets/data/stage_cast_lists.json",
                   "web/assets/data/dive_form_markers.json",
                   "web/assets/data/player_cast_one.json"),
          deps=("native_overlays",)),
    # The three special block actors (npc 328/351/352): their stage rows from the
    # cast lists, their clips' lengths from the packs' own frame lists, and the
    # interaction's states/wait/cue/completion bits from fieldstg.s.
    # tools/extract_block_actors.py.
    Stage("block_actors", ["tools/extract_block_actors.py"], str(REPO),
          inputs=("web/assets/data/stage_cast_lists.json",
                  str(DDW3 / "asm/dw2003/pro/fieldstg.s"),
                  str(DDW3 / "pack/dw2003/field/sprite")),
          outputs=("web/assets/data/block_actors.json",),
          deps=("cast_lists",)),
    Stage("field_encounters", ["tools/extract_field_encounters.py"], str(REPO),
          inputs=(DISC, str(DDW3 / "rust/types/src/enemy_id.rs")),
          outputs=("web/assets/data/field_encounters.json",)),
    Stage("stage_encounters", ["tools/extract_stage_encounters.py"], str(REPO),
          inputs=("web/assets/data/field_encounters.json", str(DDW3 / "asm/dw2003/pro")),
          outputs=("web/assets/data/stage_encounters.json",),
          deps=("field_encounters",)),
    Stage("zone_grids", ["tools/extract_zone_grids.py", "--json"], str(REPO),
          inputs=(DISC, str(DDW3 / "asm/dw2003/pro")),
          outputs=("web/assets/data/zone_grids.json",)),
    # Auto-extracted scripted STORY-BATTLE descriptors (the SCRIPTED_BATTLES frontier):
    # PRE/POST event pairs + armFlag (on_complete set_flag decode) + handoff, game-wide.
    # screenId stays null (native-trigger-bound); the stage's random pool is the candidate set.
    Stage("scripted_battles",
          ["tools/extract_scripted_battles.py", "--all",
           "--output", "web/assets/data/scripted_battles.json"], str(REPO),
          inputs=("web/assets/data/stage_encounters.json", str(DDW3 / "asm/dw2003/pro")),
          outputs=("web/assets/data/scripted_battles.json",),
          deps=("stage_encounters",)),
    # Per-battle MUSIC from the wstag battle-trigger records (tag @+0x8 = the play id
    # copied to 0x80042b30 by fieldstg 0x80092780; batl00/batl10/bossNN per screen).
    Stage("battle_music", ["tools/extract_battle_music.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"), "docs/research/audio/soundtst-categories.json"),
          outputs=("web/assets/data/battle_music.json",)),
    # The battle message bank (pro/fightstg FIGHTSTG_F0x80099588 reads text family
    # 0x7F + language, the disc image copied by extract_battlecmd_data) and the item-name
    # bank 0x6A + language that kind 14's second slot and the in-battle ITEM list's row
    # names read, already decoded, so the browser can put the original's own words on the
    # message line by index. The extractor names every bank it touches against the disc
    # file-index table (dw2003_exe_data/src/lba.rs) and checks the exe's own bank
    # directory (resident.bin) sector count, which is what pins 0x6A to ESITMNAM.
    Stage("battle_text", ["tools/extract_battle_text.py"], str(REPO),
          inputs=(str(DDW3 / "lang_file/dw2003/eng"),
                  str(DDW3 / "rust/dw2003_exe_data/src/lba.rs"),
                  "web/assets/data/battlecmd/%d.bin" % (0x4E + 2),
                  "web/assets/data/battlecmd/%d.bin" % (0x7F + 2),
                  "web/assets/data/battlecmd/%d.bin" % (0x9B + 2),
                  "web/assets/data/battlecmd/%d.bin" % (0xA2 + 2),
                  "web/assets/native/screens/resident.bin"),
          outputs=("web/assets/data/battlecmd/esmfight.json",
                   "web/assets/data/battlecmd/esitmnam.json")),
    # WS4 story-step VM data: the per-stage step programs + event tables, and the
    # type-7 position→step-index trigger grids that drive them (field-script-engine §WS4).
    Stage("story_steps", ["tools/extract_story_steps.py"], str(REPO),
          inputs=("web/assets/events/wstag_events.json", str(DDW3 / "asm/dw2003/pro")),
          outputs=("web/assets/data/story_steps.json",),
          deps=("build_assets",)),
    Stage("story_trigger_grids", ["tools/extract_story_trigger_grids.py", "--json"], str(REPO),
          inputs=(DISC, str(DDW3 / "asm/dw2003/pro"), "web/assets/data/story_steps.json"),
          outputs=("web/assets/data/story_trigger_grids.json",),
          deps=("story_steps",)),
    # The position step's facing-cone enable gate — the 8x8 byte table at RAM
    # 0x80097624 in FIELDSTG.PRO that step-load (0x80088288) reads to decide whether
    # the step under the player is live. Reads the shipped FIELDSTG.PRO image, so it
    # needs no disc. See tools/extract_step_enable_table.py.
    Stage("step_enable_table", ["tools/extract_step_enable_table.py", "--json"], str(REPO),
          inputs=("web/assets/native/fieldstg.bin",),
          outputs=("web/assets/data/scene/step_enable_table.json",)),
    # Fire-Dungeon floor traps: the native stage-event controller that blows up the
    # walking party and forces every Digimon to 1 HP (tools/extract_fire_traps.py).
    # Needs story_steps for the step index + one-shot gate flag of each trap region.
    Stage("fire_traps", ["tools/extract_fire_traps.py"], str(REPO),
          inputs=("web/assets/data/story_steps.json", str(DDW3 / "asm/dw2003/pro")),
          outputs=("web/assets/data/fire_traps.json",),
          deps=("story_steps",)),
    # Ambush tiles: the floor patches whose step event is the RESIDENT fieldstg
    # forced-encounter routine. Needs story_steps + wstag_events to find them and
    # field_encounters to check each resolves to a real party.
    Stage("forced_encounters", ["tools/extract_forced_encounters.py"], str(REPO),
          uv_with=("capstone",),
          inputs=("web/assets/data/story_steps.json", "web/assets/events/wstag_events.json",
                  "web/assets/data/field_encounters.json", str(DDW3 / "asm/dw2003/pro"),
                  "data/stage_names.json"),
          outputs=("web/assets/data/forced_encounters.json",),
          deps=("story_steps", "field_encounters")),
    # Fishing spots: the op-7 step records gated on FishingPole possession, plus
    # the two scripted-encounter-block slots a successful strike fights. Same
    # inputs as the ambush tiles, which read a different slot of the same block.
    Stage("fishing_spots", ["tools/extract_fishing_spots.py"], str(REPO),
          uv_with=("capstone",),
          inputs=("web/assets/data/story_steps.json",
                  "web/assets/data/field_encounters.json", str(DDW3 / "asm/dw2003/pro")),
          outputs=("web/assets/data/fishing_spots.json",),
          deps=("story_steps", "field_encounters")),
    # Cardmon booster reward: the per-screen Booster pack a defeated Cardmon
    # leaves, from the battle-setup dispatch in fieldstg (tables 0x80082F08 /
    # 0x800831D0, picked by enemy-id parity). Selection is ported in
    # engine/dw3/cardmon-booster.ts; see claim
    # fishing-q004-cardmon-booster-selection-enumerated-2026-09-13.
    Stage("cardmon_boosters", ["tools/extract_cardmon_boosters.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/fieldstg.s"),),
          outputs=("web/assets/data/cardmon_boosters.json",)),
    # Per-stage default spawn (descriptor +0x2C/+0x30, 24.8 fixed -> map pixels
    # by >>8): where the leader stands when a stage loads with no warp spawn.
    # Decode: fieldstg F0x8009116c; see claim
    # stage-default-spawn-is-descriptor-raw-shift-8-2026-09-13.
    Stage("stage_default_spawn", ["tools/extract_stage_default_spawn.py"], str(REPO),
          inputs=("docs/generated/stage-descriptors.json",),
          outputs=("web/assets/data/stage_default_spawn.json",)),
    # Per-npc_id confirm-box half-widths (fieldstg byte table at 0x8009A458):
    # the talk/kick button's action-point box. Decode: fieldstg F0x800920F8 +
    # F0x8008E210; claim world-q001-confirm-probe-box-rule-2026-09-13.
    Stage("npc_confirm_box", ["tools/extract_npc_confirm_box.py"], str(REPO),
          inputs=("web/assets/native/fieldstg.bin",),
          outputs=("web/assets/data/npc_confirm_box.json",),
          deps=("native_overlays",)),
    # Talk-triggered cutscenes: the bank-0x90 launcher's event-id table, read out
    # of the fieldstg image. Needs the generated scenes (which write the bank) and
    # wstag_events to cross-check that each shipped bit resolves in its own stage.
    Stage("talk_event_launches", ["tools/extract_talk_event_launches.py"], str(REPO),
          inputs=("web/assets/native/fieldstg.bin", "web/assets/events/wstag_events.json",
                  "web/assets/scenes"),
          outputs=("web/assets/data/talk_event_launches.json",),
          deps=("native_overlays", "gen_scenes")),
    # WHERE each bank-0x90 write happens: the per-stage start site of every scene the
    # table above names -- one record per NPC dialogue state whose on_close writes the
    # bank. Replaces two disassembly guesses (convert's eventActor, the ordinal-owner
    # extractor's speaker_of) that started these scenes from the wrong moment.
    Stage("talk_launch_bindings", ["tools/extract_talk_launch_bindings.py"], str(REPO),
          inputs=("web/assets/native/fieldstg.bin", "web/assets/events/wstag_events.json",
                  "web/assets/scenes", "web/assets/data/talk_event_launches.json"),
          outputs=("web/assets/data/talk_launch_bindings.json",),
          deps=("native_overlays", "gen_scenes", "talk_event_launches")),
    Stage("flag_setters", ["tools/scan_flag_setters.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"), str(DDW3 / "asm/dw2003/exe/fns.s")),
          outputs=("web/assets/data/flag_setters.json",)),
    # Master story-progress ordinal [0x8004b370] ladder = the literal play order
    # (field-script-engine §WS4.6); feeds the GAME_WALKTHROUGH.md spine.
    Stage("progress_ordinal", ["tools/extract_progress_ordinal.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"),),
          outputs=("web/assets/data/progress_ordinal.json",)),
    Stage("story_progression", ["tools/build_story_progression.py"], str(REPO),
          inputs=("web/assets/data/story_steps.json", "web/assets/data/flag_setters.json",
                  "web/assets/data/progress_ordinal.json",
                  "web/assets/events/wstag_events.json",
                  "web/assets/data/chapter_progression.json",
                  "web/assets/data/screen_table.json", "data/stage_names.json"),
          outputs=("docs/research/story-progression/EVENT_DEPENDENCIES.md",
                   "docs/research/story-progression/GAME_WALKTHROUGH.md"),
          deps=("story_steps", "flag_setters", "progress_ordinal", "gen_scenes")),
    # Story gates for auto-cutscene start_event calls: the per-stage entry dispatcher's
    # ordinal + get_flag guards (control-flow traced). Lets the converter gate OnEnterMap
    # auto cutscenes (e.g. s395 Wind-Prairie Teddy fires only at ordinal 5, not on first
    # entry from Divermon's Lake). See tools/extract_auto_event_gates.py.
    Stage("auto_event_gates", ["tools/extract_auto_event_gates.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"),),
          outputs=("web/assets/data/auto_event_gates.json",)),
    # The field scene system's ARRIVAL DISPATCHER, one shared routine per place: the
    # ordered chain of (story ordinal, flag expectations) -> event id each overlay's
    # entry-object tick walks, first whole match wins. Found by the TICK each overlay
    # hands F0x80014504, kept every ordinal re-read (what DISPATCHER_CHAIN_CONDS in
    # tools/engine-convert/lib.ts works around), and every route to a candidate.
    # Read by engine/systems/scene-arrival.ts; oracle tests/lane-b/scene-arrival.test.js.
    Stage("arrival_candidates", ["tools/extract_arrival_candidates.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"),),
          outputs=("web/assets/data/scene/arrival_candidates.json",)),
    # The s260 Cargo Tower AUCTION: the sixteen lot records (FIELDSTG_progressEvents,
    # FIELDSTG_choices, FIELDSTG_events), the 50 wstag260 lot scripts and the 32
    # endChoice handler bodies -> the lot table the ported lot cycle reads
    # (engine/systems/auction.ts; web/game.js runAuctionLot). Cross-checks every bid
    # against its esdmg260 question line and every item against the item-name bank,
    # and fails loudly on a mismatch. See tools/extract_s260_auction.py and
    # docs/research/field/s260-cargo-tower-auction-decoded-2026-07-10.md.
    Stage("s260_auction", ["tools/extract_s260_auction.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/wstag260.s"),
                  str(DDW3 / "asm/dw2003/pro/fieldstg.s"),
                  "web/assets/native/fieldstg.bin",
                  "web/assets/data/bank70_rewards.json",
                  "web/assets/events/esdmg260.json",
                  "web/assets/data/battlecmd/esitmnam.json"),
          outputs=("web/assets/data/auction_lots.json",),
          deps=("native_fieldstg", "bank70_rewards", "battle_text", "build_esdmg")),
    # Per-actor ptrB on_close flag PRODUCERS: the stored-bank set_ptr tables fieldstg applies on
    # stage entry (genuinely invisible handle-0 trigger-actors, e.g. s410 npc63) / talk-close
    # (visible NPCs). Mined straight from every overlay actor. The general home for flags neither
    # scan_flag_setters (callsite-only) nor talk_item_grants (collection gives) capture -- e.g. the
    # Blue-Card second-hunt 0x1c45/0x1c46/0x1c47. See tools/extract_npc_flag_sets.py. (gen_scenes now
    # places the high-nid event puppets too, so visible ones resolve to OnTalk.)
    Stage("npc_flag_sets", ["tools/extract_npc_flag_sets.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"), "web/assets/npc_sprites.json"),
          outputs=("web/assets/data/npc_flag_sets.json",),
          deps=("npc_sprites",)),
    # Foreground map-overlay layer (walk-behind pipes/poles/canopies): the map tiles
    # are 3-layered and layers >= 1 draw OVER sprites on PS1; the flat map PNGs lost
    # that. Recomposites layer>=1 objs into sNNN_fg.png + an index JSON. See
    # docs/todo/2026-07-04-map-foreground-overlay-layer.md.
    Stage("map_overlays", ["tools/extract_map_overlays.py"], str(REPO),
          uv_with=("pillow",),
          inputs=("web/assets/manifest.json", str(DDW3 / "map/dw2003/z_stage")),
          outputs=("web/assets/data/map_overlays.json",),
          deps=("build_assets",), setup=setup_lfs),
    # Draws the map tiles' semi-transparent texels SOLID, the way the console does.
    # The field emits every map-tile layer object as an OPAQUE sprite and never turns
    # semi-transparency on, so a texel flagged transparent-black is covered black on
    # a PS1 while ddw3's stitcher composites it at 50%. See
    # docs/research/field/map-tile-draw-semitransparency-2026-08-20.md. Runs BEFORE
    # map_hairlines so a flagged one-pixel line is closed by the decoded colour rather
    # than by its neighbours' average.
    Stage("map_stp_solid", ["tools/restitch_map_stp.py"], str(REPO),
          uv_with=("pillow",),
          inputs=("web/assets/manifest.json", str(DDW3 / "map/dw2003/z_stage"),
                  str(DDW3 / "tim/dw2003/z_stage")),
          outputs=("web/assets/maps",),
          deps=("build_assets", "map_overlays"), setup=setup_lfs),
    # Draws map-tile layer 2 BEHIND the ground, the way the console's ordering
    # table does (layer 2 at depth 11, the ground at 7, the foreground at 3).
    # ddw3's stitcher paints the layers in config order, so layer 2 lands on top
    # and 11 stages ship flat blocks of colour over finished artwork -- a
    # grey-blue rectangle over the treetops of Kicking Forest, an olive band
    # across the roof of East Station. Confirmed absent from the running original
    # 2026-08-21. Runs AFTER map_stp_solid so a moved pixel carries the solid
    # colour, and BEFORE map_hairlines, which rewrites the seams last.
    # See docs/research/field/map-tile-draw-semitransparency-2026-08-20.md.
    Stage("map_layer_order", ["tools/repair_map_layer_order.py"], str(REPO),
          uv_with=("pillow",),
          inputs=("web/assets/manifest.json", str(DDW3 / "map/dw2003/z_stage"),
                  str(DDW3 / "tim/dw2003/z_stage")),
          outputs=("web/assets/maps",),
          deps=("build_assets", "map_overlays", "map_stp_solid"), setup=setup_lfs),
    # Closes the one-pixel hairlines the stitcher leaves in the flat map PNGs: a
    # transparent or half-transparent column between two tile quads has nothing
    # behind it here, so it blends with the cleared frame and the player sees a
    # dark line that shimmers as the camera moves. Rewrites the maps in place, so
    # it must run after everything that writes one. Census: tools/audit_map_hairlines.py.
    Stage("map_hairlines", ["tools/repair_map_hairlines.py"], str(REPO),
          uv_with=("pillow",),
          inputs=("web/assets/manifest.json",),
          outputs=("web/assets/maps",),
          deps=("build_assets", "map_overlays", "map_stp_solid", "map_layer_order"),
          setup=setup_lfs),
    # The ground, masked to its own pixels, so the props that draw BEHIND it can
    # be put down between map layer 2 and the ground the way the ordering table
    # does (layer 2 at depth 11, those props at 8/10, the ground at 7). One
    # flattened map cannot be both behind and in front of the same prop:
    # measured, 79,750 of those props' texels sit over ground art and 81,400
    # over layer-2 art. Runs LAST of the map stages, because it copies the
    # finished map's pixels and must carry every repair they have had. Depends
    # on point_sprites for which stages have such a prop and where it reaches.
    # See docs/research/field/map-tile-draw-semitransparency-2026-08-20.md.
    Stage("map_ground_over_props", ["tools/build_map_ground_over_props.py"], str(REPO),
          uv_with=("pillow", "numpy"),
          inputs=("web/assets/data/point_sprites.json", "web/assets/effects",
                  str(DDW3 / "map/dw2003/z_stage"), str(DDW3 / "tim/dw2003/z_stage")),
          outputs=("web/assets/data/map_ground_index.json", "web/assets/data/map_layer2_runs.json"),
          deps=("build_assets", "map_overlays", "map_stp_solid", "map_layer_order",
                "map_hairlines", "point_sprites"), setup=setup_lfs),
    # Per-stage ambient point-sprite decorations (Seiryu windmills, fans, torches,
    # walk-behind props): 18-byte placement records at descriptor+0x10 in each wstag,
    # sprites cut from the stage MASK TIMs via the TMPK sprite directory. See
    # docs/research/field/point-sprite-ambient-system.md. Renderer: web/effects.js.
    # Type-0x17 launch pads: each stage overlay's own 12-byte pad records
    # ({clipBase, guard, x, y}). See docs/research/field/launch-pad-actor-decoded.md.
    # Must run BEFORE point_sprites, which cuts the pads' clip ids from the same
    # per-stage TMPK sprite directory. Renderer: web/effects.js drawLaunchPads.
    Stage("launch_pads", ["tools/extract_launch_pads.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"),),
          outputs=("web/assets/data/launch_pads.json",),
          deps=("build_assets",)),
    # The stage overlays' own falling/bouncing rock actor (wstag415 0x800a5fa8):
    # a 16-byte record table + 4-byte animation sequences per stage, plus the
    # builder -> effect-registry id pairing read out of the resident fieldstg
    # image. Renderer: engine/systems/falling-object.ts via web/stage-objects.js.
    Stage("falling_objects", ["tools/extract_falling_objects.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"), "web/assets/native/fieldstg.bin"),
          outputs=("web/assets/data/falling_objects.json",)),
    Stage("point_sprites", ["tools/extract_point_sprites.py"], str(REPO),
          uv_with=("pillow",),
          inputs=(str(DDW3 / "asm/dw2003/pro"), "web/assets/data/launch_pads.json"),
          outputs=("web/assets/data/point_sprites.json",),
          # native stages get their FULL sprite dir cut; launch_pads supplies the
          # pad clip ids that no point-sprite record references.
          deps=("native_overlays", "launch_pads")),
    # Wall-screen texture pages: the animated screens are textured quads the
    # stage's own code submits to the GPU (wstag780 F0x800a6fbc), not point
    # records, so they need their own baked pages. Renderer: web/effects.js
    # drawScreenQuad; capture: engine/native/runtime.ts screenQuads.
    Stage("screen_pages", ["tools/extract_screen_pages.py"], str(REPO),
          uv_with=("pillow",),
          inputs=(str(DDW3 / "asm/dw2003/pro"),),
          outputs=("web/assets/data/s780_screens.json",
                   "web/assets/effects/s780_screens.png"),
          deps=("build_assets",)),
    # Kickable trees: the FIELDCOM point records the type-0x0B tree manager
    # claims, in its own order, plus the two scripted-encounter-block slots the
    # live tree drops. Reads the point table back out of point_sprites.json, so
    # it must follow it. See docs/research/field/tree-boots-kicking-decoded-2026-07-29.md.
    Stage("tree_kick", ["tools/extract_tree_kick.py"], str(REPO),
          uv_with=("capstone",),
          inputs=("web/assets/data/point_sprites.json",
                  "web/assets/data/field_encounters.json", str(DDW3 / "asm/dw2003/pro")),
          outputs=("web/assets/data/tree_kick.json",),
          deps=("point_sprites", "field_encounters")),
    # Gym mid-training animation scenes (DAT/TRAINING/TRANIN00-16, read
    # straight from the disc image): per-drill-family packs with 8 per-starter
    # large workout animation sets + the shared props (punching bag etc.).
    # See docs/research/ui/stgtrain-decoded-2026-07-11.md. Renderer: web/gym.js
    # drawTrainingViewport.
    Stage("tranin", ["tools/extract_tranin.py"], str(REPO),
          uv_with=("pillow",),
          inputs=(DISC,),
          outputs=("web/assets/ui/tranin",)),
    # THE point-record actor system: all fifteen field stage objects that claim
    # their own stage's dormant point-sprite records by their atlas tag -- the
    # Asuka City download halos (s212 0x32a) and login flash (s225 0x32f,
    # s750 0x34e, s925 0x357), the Kusanagi City / Undersea Base "tagged decor"
    # (s785 0x343, s790 0x328/0x329, s795 0x344, s800 0x345/0x347) and the
    # picture drivers (s805 0x348, s810 0x34a/0x34b/0x34c, s820 0x355).  One
    # table, one extractor, ONE module: the atlas-tag claim (fieldstg
    # F0x80089548 / F0x800894d8), the animation-script stepper every overlay
    # repeats at its own base, and the EXE F0x800143dc method block are shared.
    # Every one of the 340 anchors is checked against the read-only
    # decompilation AND the shipped image, and a mismatch stops the build.
    # Renderer: engine/systems/point-record-actor.ts via web/effects.js.
    # See docs/research/field/stage-object-registry-2026-10-04.md.
    Stage("point_record_actors", ["tools/extract_point_record_actors.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"), "web/assets/native/fieldstg.bin",
                  "web/assets/data/point_sprites.json"),
          outputs=("web/assets/data/point_record_actors.json",),
          deps=("point_sprites", "native_overlays")),
    # The s415 Deeper Crevice SCENERY LAYER (registry id 0x32c): the one member
    # whose pictures the stage's own background pack holds, cut from the TMPK
    # sub-entries 2 and 4's 14-byte frame tables into one 512x768 strip. The
    # SAME registry and tick loop as every other point-record member; only the
    # machine differs. Renderer: engine/systems/point-record-actor.ts
    # `scroll-layer` via web/effects.js. Cuts from the read-only decomp + disc.
    Stage("scroll_layers", ["tools/extract_scroll_layers.py"], str(REPO),
          uv_with=("pillow",),
          inputs=(str(DDW3 / "asm/dw2003/pro"), DISC),
          outputs=("web/assets/data/scroll_layers.json",
                   "web/assets/effects/scroll/s415.png"),
          deps=("point_record_actors",)),
    # Native wstag overlay images for the MIPS interpreter (engine/native/): the ~75
    # stages with real native ambience/gimmick code (cars, TVs, gondola interior,
    # satellite lights) run their ORIGINAL code in the walker. Extracted verbatim from
    # the decomp .s word stream + the EXE trig table from data.rs. See
    # docs/specs/2026-07-04-wstag-native-interpreter-design.md.
    Stage("native_overlays", ["tools/build_native_overlays.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"), str(DDW3 / "rust/dw2003_exe_data/src/data.rs")),
          outputs=("web/assets/native/manifest.json", "web/assets/native/exe_tables.json")),
    # Research-only companion: the seven entry-only story-gate stages the rig
    # traced, built into a separate manifest the game never loads. Read by
    # tools/stage_call_journal.ts; see
    # docs/research/field/stage-call-timelines-2026-09-11.md (addendum).
    Stage("native_overlays_entry_only",
          ["tools/build_native_overlays.py", "--entry-only",
           "200", "206", "395", "440", "575", "580", "685"],
          str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"),),
          outputs=("web/assets/native/manifest_entry_only.json",),
          deps=("native_overlays",)),
    # Overlay images for every stage that HAS an arrival dispatcher, into their own
    # manifest. The arrival-dispatcher oracle runs each overlay's own entry tick, so it
    # needs an image for all 76 of them, not only the ambience census's picks. The stage
    # list is arrival_candidates.json, so it cannot drift from the dispatchers.
    Stage("native_overlays_arrival",
          ["tools/build_native_overlays.py", "--entry-only", "--arrival"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"),
                  "web/assets/data/scene/arrival_candidates.json"),
          outputs=("web/assets/native/manifest_arrival.json",),
          deps=("arrival_candidates",)),
    # Completion-set overlay images: the stages scene_completion.json lists (the
    # scene-completion oracle runs each event's completion routine, so it needs an
    # image for every stage that ships one). Separate manifest; images shared with
    # the default build are byte-identical.
    Stage("native_overlays_completion",
          ["tools/build_native_overlays.py", "--completion"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"),
                  "web/assets/data/scene/scene_completion.json"),
          outputs=("web/assets/native/manifest_completion.json",),
          deps=("scene_completion", "native_overlays")),
    # Phase 1 of the native screen port: the resident PS-X EXE image, the screen
    # overlay images and the banks their early ticks read, shipped under
    # web/assets/native/screens/ so web/native-screen.js can boot an ORIGINAL
    # screen overlay in the browser. The bank set comes from the interpreter's
    # own bank plan (tools/native_screen_probe.ts --bank-plan), not a hand list.
    # See docs/plans/2026-09-14-native-screen-port-plan.md.
    Stage("native_screens",
          ["tools/build_native_screens.py"],
          str(REPO),
          inputs=("data/native_screen_roots.json", "tools/native_screen_probe.ts", DISC,
                  "recovered/ddw3/function-inventory.json",
                  str(DDW3 / "rust/dw2003_exe_data/src/lba.rs")),
          outputs=("web/assets/native/screens/manifest.json",
                   "web/assets/native/screens/resident.bin")),
    Stage("card_shop_data", ["tools/build_card_shop_data.py"], str(REPO),
          inputs=("web/assets/native/screens/manifest.json", "tools/build_card_shop_data.py"),
          outputs=("web/cardshop-data/manifest.json", "web/cardshop-data/tables.bin")),
    # Data-only screen resources for translated production controllers.
    Stage("translated_screen_data", ["tools/build_translated_screen_data.py"], str(REPO),
          inputs=("data/native_screen_roots.json", "tools/build_native_screens.py", DISC),
          outputs=("web/assets/data/country_screen.json",
                   "web/assets/data/shop_catalog.json",
                   "web/assets/data/shop_item_records.bin",
                   "web/assets/data/shop_descriptors_main.bin",
                   "web/assets/data/shop_descriptors_extra.bin",
                   "web/assets/data/shop_font.bin",
                   "web/assets/data/dialogue-box/manifest.json",
                   "web/assets/data/dialogue-box/resident-ranges.bin",
                   "web/assets/data/dialogue-box/estalk00.bin",
                   "web/assets/data/dialogue-box/estalk01.bin",
                   "web/assets/data/dialogue-box/estalk02.bin",
                   "web/assets/data/dialogue-box/estalk03.bin",
                   "web/assets/data/dialogue-box/estalk04.bin",
                   "web/assets/data/dialogue-box/estalk05.bin",
                   "web/assets/data/dialogue-box/estalk06.bin",
                   "web/assets/data/dialogue-box/estalk07.bin",
                   "web/assets/data/dialogue-box/estalk08.bin",
                   "web/assets/data/dialogue-box/estalk09.bin",
                   "web/assets/data/dialogue-box/esdmg200.bin",
                   "web/assets/data/dialogue-box/esdmg260.bin",
                   "web/assets/data/dialogue-box/esdmg270.bin",
                   "web/assets/data/dialogue-box/esdmg300.bin",
                   "web/assets/data/dialogue-box/esdmg305.bin",
                   "web/assets/data/dialogue-box/esdmg400.bin",
                   "web/assets/data/dialogue-box/esdmg500.bin",
                   "web/assets/data/dialogue-box/esdmg600.bin",
                   "web/assets/data/dialogue-box/esdmg700.bin",
                   "web/assets/data/dialogue-box/esdmg800.bin",
                   "web/assets/data/dialogue-box/esdmg900.bin",
                   "web/assets/data/shop-banks/manifest.json",
                   "web/assets/data/place-banks/manifest.json",
                   "web/assets/data/name/manifest.json",
                   "web/assets/data/name/tables.bin",
                   "web/assets/data/wizard/manifest.json",
                   "web/assets/data/wizard/tables.bin",
                   "web/assets/data/pause/manifest.json",
                   "web/assets/data/pause/tables.bin",
                   "web/assets/data/pause/resident.bin",
                   "web/assets/data/battlecmd/manifest.json",
                   "web/assets/data/battlecmd/tables.bin",
                   "web/assets/data/battlecmd/tech-tables.bin",
                   "web/assets/data/battlecmd/form-tables.bin",
                   "web/assets/data/battlecmd/strip.bin",
                   *(f"web/assets/data/battlecmd/{bank + language}.bin"
                     for bank in (0x4e, 0x7f, 0x9b, 0xa2) for language in range(7)),
                   "web/assets/data/battlecmd/esmfight.json",
                   "web/assets/data/battlecmd/enemy_stats.json",
                   "web/assets/data/wfight/manifest.json",
                   *(f"web/assets/data/wfight/{bank}.bin" for bank in (0x456, 0x79e, 0x7ae, 0x7e1, 0x7e3)),
                   "web/assets/data/report/manifest.json",
                   "web/assets/data/report/tables.bin",
                   "web/assets/data/memcard/manifest.json",
                   "web/assets/data/memcard/tables.bin",
                   *(f"web/assets/data/memcard/{offset + language}.bin"
                     for offset in (0x78, 0xa9) for language in range(7)),
                   *(f"web/assets/data/report/{0x55 + language}.bin" for language in range(7)),
                   *(f"web/assets/data/wizard/{offset + language}.bin"
                     for offset in (0x4e, 0x8d, 0x86) for language in range(7)),
                   *(f"web/assets/data/name/{offset + language}.bin"
                     for offset in (0x40, 0x86) for language in range(7)),
                   *(f"web/assets/data/shop-banks/{offset + language}.bin"
                     for offset in (0x63, 0x6a, 0x71, 0x94) for language in range(7)))),
    # The browser engine artifacts (esbuild bundle + EngineContent blob). Depends on the
    # extracted JSON the converter reads; build_engine.py shells out to node/esbuild.
    # The input list is the converter's own readJson() set (tools/engine-convert/convert.ts).
    Stage("engine_bundle", ["tools/build_engine.py"], str(REPO),
          inputs=("engine/index.ts", "engine/native-entry.ts", "web/assets/data/story_steps.json",
                  "web/assets/events/wstag_events.json",
                  "web/assets/data/field_encounters.json",
                  "web/assets/data/scripted_battles.json",
                  "web/assets/data/item_grants.json",
                  "web/assets/data/native_item_grants.json",
                  "web/assets/data/talk_item_grants.json",
                  "web/assets/data/scene/arrival_candidates.json",
                  "web/assets/data/talk_launch_bindings.json",
                  "web/assets/data/progress_ordinal.json",
                  "web/assets/data/auto_event_gates.json",
                  "web/assets/data/npc_flag_sets.json",
                  "web/assets/data/roster_predicate_table.json",
                  "web/assets/data/bank70_rewards.json",
                  "web/assets/data/bank70_money_grants.json",
                  "web/assets/data/bank70_partner_grants.json",
                  "web/assets/data/scene/scene_completion.json",
                  "web/assets/data/ordinal_owner.json"),
          outputs=("web/vendor/engine.js", "web/vendor/engine-native.js", "web/assets/engine-content.json"),
          deps=("story_steps", "field_encounters", "progress_ordinal", "auto_event_gates",
                "npc_flag_sets", "bank70_money_grants", "bank70_partner_grants",
                "equipment_ts", "item_data", "item_directories", "item_names",
                "item_routes")),
    # smdldata keys 468/469/470 (Agunimon, BladeGarurumon, AncientGreymon) name
    # CD file ids 1958/1992/1998 — packs ddw3's fight/model tree does not carry.
    # Carve them from the disc's raw sectors into a build-input tree (not a
    # committed asset) and let the model pipeline see it via DW3_MODEL_DIR.
    Stage("fight_model_packs",
          ["tools/extract_fight_model_pack.py", "--out", str(REPO / "build/model-packs"),
           "1958", "1992", "1998"],
          str(REPO), inputs=(DISC,), outputs=("build/model-packs",)),
    # Depends on model_placement: the smdldata record names which pack member holds each
    # model's timeline directory, and two models do not use member 0.
    Stage("fight_models", ["tools/build_fight_models.py", "--all"], str(REPO),
          uv_with=("pillow",),
          inputs=(str(DDW3 / "pack/dw2003/fight/model"),
                  "web/assets/battle/model_placement.json"),
          outputs=("web/assets/battle/models/index.json",
                   "web/assets/battle/models/m366giru/anim.json",
                   "web/assets/battle/models/m437bast/anim.json"),
          deps=("model_placement", "fight_model_packs"),
          env={"DW3_MODEL_DIR": str(REPO / "build/model-packs")}),
    Stage("fight_effects", ["tools/extract_fight_effects.py"], str(REPO),
          uv_with=("pillow",),
          inputs=(str(DDW3 / "pack/dw2003/fight/effect"),
                  str(DDW3 / "asm/dw2003/pro/fightstg.s")),
          outputs=("web/assets/battle/effects/manifest.json",)),
    # Per-Digimon battle placement + canned camera shots (pro/smdldata.s, resource
    # 0x1cc). The arena slot is x=0, y=-hover, z=-+(0x1400+standoff): both numbers
    # belong to the Digimon, so the two fighters do NOT stand at fixed positions.
    Stage("model_placement", ["tools/extract_smdldata.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/smdldata.s"),),
          outputs=("web/assets/battle/model_placement.json",)),
    # The baked texture page drops every texel no face covers, which is exactly where
    # each Digimon's blink frames live. This paints them back in, through the CLUT the
    # destination was baked with, so the renderer can blit them the way the disc does.
    # Runs after BOTH producers: it edits fight_models' pages using model_placement.
    Stage("texture_patches", ["tools/bake_texture_patches.py"], str(REPO),
          uv_with=("pillow",),
          inputs=(str(DDW3 / "pack/dw2003/fight/model"),
                  "web/assets/battle/model_placement.json"),
          outputs=("web/assets/battle/textures/m003agum.png",),
          deps=("fight_models", "model_placement")),
    # Reinstall authored native JSON+PNG bundles after the extracted model
    # index is regenerated; registered names come from data/custom/registry.json.
    Stage("custom_fight_models", ["tools/custom_fight_model.py", "build-all"], str(REPO),
          uv_with=("pillow",),
          inputs=("data/custom", "web/assets/battle/model_map.json"),
          outputs=("web/assets/battle/models/custom-manifest.json",),
          deps=("texture_patches",)),
    Stage("fight_tech_table", ["tools/extract_fight_tech_table.py"], str(REPO),
          inputs=(str(DDW3 / "rust/dw2003_exe_data/src/data.rs"),),
          outputs=("web/assets/data/fight_tech_table.json",)),
    # Special-attack per-element BACKDROPS = MEFT10<tech.sigEffect> (fallback meft1055 data-field).
    # Each pack's 3D MESHES (wall+floor) + atlas pages, drawn additively through the battle camera —
    # faithful per element from game data (no rig capture). Confirmed live 2026-07-07 (Inferno→meft1034,
    # Thunder Bolt→meft1045). See special-attack-backdrop-decode.md §11-13. Depends on the tech table.
    Stage("backdrops", ["tools/extract_backdrops.py"], str(REPO),
          uv_with=("pillow",),
          inputs=(str(DDW3 / "pack/dw2003/fight/effect"),
                  "web/assets/data/fight_tech_table.json",
                  "docs/research/fight-3d/data/sfstdata_effect_table.json"),
          outputs=("web/assets/battle/backdrops/manifest.json",)),
    Stage("ui_assets", ["tools/build_ui_assets.py"], str(REPO), uv_with=("pillow",),
          outputs=("web/assets/ui",), setup=setup_lfs),
    Stage("screen_packs", ["tools/extract_screen_packs.py"], str(REPO), uv_with=("pillow",),
          inputs=(str(DDW3 / "pack/dw2003/screen"),
                  str(DDW3 / "pack/dw2003/country/cmfontcs"), DISC),
          outputs=("web/assets/ui/ststat_sheet.png", "web/assets/ui/ststat_sheet.json",
                   "web/assets/ui/stshop_sheet.png", "web/assets/ui/cmnbgd_sheet.png",
                   "web/assets/ui/cmfont_sheet.png", "web/assets/ui/cmfont_sheet.json",
                   "web/assets/ui/stwmp0map_sheet.png", "web/assets/ui/stwmp0area_sheet.png",
                   "web/assets/ui/stwmp0icon_sheet.png", "web/assets/ui/stwmp1map_sheet.png",
                   "web/assets/ui/stwmp1area_sheet.png", "web/assets/ui/stwmp1icon_sheet.png",
                   "web/assets/ui/stdglabo_sheet.png", "web/assets/ui/stdglabo_sheet.json",
                   "web/assets/ui/sttrng0_sheet.png", "web/assets/ui/sttrng0_sheet.json",
                   "web/assets/ui/sttrng3_sheet.png", "web/assets/ui/sttrng3_sheet.json",
                   "web/assets/ui/stmcrd_sheet.png", "web/assets/ui/stmcrd_sheet.json",
                   "web/assets/ui/carddata2_sheet.png", "web/assets/ui/carddata2_sheet.json",
                   "web/assets/ui/carddata3_sheet.png", "web/assets/ui/carddata3_sheet.json",
                   "web/assets/ui/stnmet_sheet.png", "web/assets/ui/stnmet_sheet.json",
                   "web/assets/ui/stdgnm_sheet.png", "web/assets/ui/stdgnm_sheet.json"),
          setup=setup_lfs),
    Stage("status_ui", ["tools/extract_status_ui.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/ststatus.s"), "data/screen_table.json"),
          outputs=("web/assets/data/status_ui.json",)),
    Stage("stgtrain_ui", ["tools/extract_stgtrain_ui.py"], str(REPO),
          outputs=("web/assets/data/stgtrain_ui.json",),
          deps=("screen_packs",)),
    Stage("stgmcard_ui", ["tools/extract_stgmcard_ui.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/stgmcard.s"),
                  str(DDW3 / "lang_file/dw2003/eng/esmemcrd.toml")),
          outputs=("web/assets/data/stgmcard_ui.json",),
          deps=("screen_packs",)),
    Stage("cardduel_ui", ["tools/extract_cardduel_ui.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/cardgame.s"),),
          outputs=("web/assets/data/cardduel_ui.json",),
          deps=("screen_packs",)),
    Stage("card_opponents", ["tools/extract_card_opponents.py"], str(REPO),
          inputs=(str(DDW3 / "dw2003/AAA/DAT/CARD/CARD_NPC.BIN"),),
          outputs=("web/assets/data/card_opponents.json",),
          deps=("screen_packs",), setup=setup_lfs),
    # The 40 starter card ids at 0x8004B49C, granted by F0x80016E6C, which also
    # pre-fills all three folders with them at the 0x66 stride.
    Stage("card_starter", ["tools/extract_card_starter.py"], str(REPO),
          inputs=(str(DDW3 / "rust/dw2003_exe_data/src/data.rs"),
                  "web/assets/data/card_catalog.json"),
          outputs=("web/assets/data/card_starter.json",),
          deps=("card_catalog",)),
    # The booster-pack pools: the 0x1C-stride set table at 0x8008C708 in
    # pro/stcrdshp, six ordered 16-entry pools per set, one per slot of a pack.
    # See F0x800844B8 case 0xB and the extractor's docstring.
    Stage("card_boosters", ["tools/extract_card_boosters.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/stcrdshp.s"),),
          outputs=("web/assets/data/card_boosters.json",)),
    # The card-shop price list: 44 (cardId, price) halfword pairs at 0x8008CD20
    # in pro/stcrdshp, reached through the function pointer at 0x8008CB9C. A
    # card absent from the list costs 1. Depends on card_catalog only to name
    # the rows for readability. See the extractor's docstring, and mind the
    # lui/addiu borrow it documents.
    Stage("card_prices", ["tools/extract_card_prices.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/stcrdshp.s"),
                  "web/assets/data/card_catalog.json"),
          outputs=("web/assets/data/card_prices.json",),
          deps=("card_catalog",)),
    # The per-shop STOCK: 24 six-card sets in the 0xC-stride record table at
    # 0x8008CDD4, selected by shop id through the lookup at 0x8008CB98. A stock
    # set is one shop-at-one-story-point, not one location.
    Stage("card_shops", ["tools/extract_card_shops.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/stcrdshp.s"),
                  "web/assets/data/card_catalog.json"),
          outputs=("web/assets/data/card_shops.json",),
          deps=("card_catalog", "merchant_shops")),
    Stage("stagslct_ui", ["tools/extract_stagslct_ui.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/stagslct.s"),
                   "web/assets/data/screen_table.json", "data/stage_names.json"),
          outputs=("web/assets/data/stagslct_ui.json", "data/stagslct_catalog.json"),
          deps=("screen_table", "stage_names")),
    Stage("stdwtitl_ui", ["tools/extract_stdwtitl_ui.py"], str(REPO), uv_with=("pillow",),
          inputs=(str(DDW3 / "pack/dw2003/screen/ttcommpk"),
                  "web/assets/native/screens/pro_stdwtitl.bin"),
          outputs=("web/assets/ui/stdwtitl_bg.png", "web/assets/data/stdwtitl_ui.json",
                   "web/title-twinkle-data.js"),
          deps=("native_screens",), setup=setup_lfs),
    Stage("opening_movies", ["tools/extract_opening_movies.py"], str(REPO),
          uv_with=("imageio-ffmpeg",), inputs=(DISC,),
          outputs=("web/assets/movie/movieop2.mp4", "web/assets/movie/movieopn.mp4",
                   "web/assets/movie/movied08.mp4", "web/assets/movie/moviee01.mp4",
                   "web/assets/movie/moviee02.mp4",
                   "web/assets/movie/manifest.json")),
    Stage("ui_font", ["tools/extract_ui_font.py"], str(REPO), uv_with=("pillow",),
          inputs=(DISC,),
          outputs=("web/assets/ui/uifont.png", "web/assets/ui/uifont.json")),
    Stage("title_art", ["tools/decode_title_art.py"], str(REPO), uv_with=("pillow",),
          outputs=("web/assets/title_logo.png",), setup=setup_lfs),
    Stage("thumbs", ["tools/build_thumbs.py"], str(REPO), uv_with=("pillow",),
          outputs=("web/assets/thumbs",), deps=("build_assets",)),
    # Renders ddw3's extracted SEQ tracks through soundfonts built from the
    # game's own VAB instruments (tools/vab_to_sf2.py) with a locally built
    # fluidsynth (the export's tools/ddw3_toolchain.py; the walker finds one on
    # PATH or via $FLUIDSYNTH). GeneralUser GS is only an optional
    # fallback for a bank without a VAB, which never happens.
    Stage("music", ["build_music.py"], str(REPO), uv_with=("mido", "numpy", "soundfile"),
          inputs=(str(DDW3 / "sound/dw2003/common.toml"),
                  "docs/research/audio/soundtst-categories.json"), outputs=("web/assets/music",),
          setup=setup_fluidsynth),
    Stage("map_sound_archives", ["tools/extract_map_sound_archives.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"),),
          outputs=("web/assets/data/map_sound_archives.json",)),
    # Also emits special_loop_map.json: the eight per-element special-attack loops
    # (BT_LOOP0-7), which SFSTDATA rec[+0x08] selects through fightstg's second
    # packed-sound table 0x800a2498 — hence the sfstdata input.
    Stage("sfx", ["build_sfx.py"], str(REPO), outputs=("web/assets/sfx",),
          inputs=("docs/research/fight-3d/data/sfstdata_effect_table.json",
                  "docs/research/audio/soundtst-categories.json",
                  "docs/research/audio/soundtst-common-ids.json",
                  "docs/research/audio/common-tones-full.json",
                  str(DDW3 / "sound/dw2003/common.toml")),
          deps=("map_sound_archives", "fight_effects")),
    # ROOT (public export only): ddw3's own build re-creates the disc image every
    # DISC reader uses and the extracted sound banks (music/sfx). Toolchain is
    # fetched/compiled into ~/.cache/dw2003-play/toolchain on first run. Every
    # other export stage depends on it; the walker skips it (the tool is
    # public-only) and points DW3_DISC at a disc it already has.
    overlay_stage("ddw3_disc", ["tools/build_ddw3_disc.py"], str(REPO),
          inputs=(str(DDW3 / "zbuild.zb"),),
          outputs=(DISC, str(DDW3 / "sound/dw2003/common.toml")), setup=setup_lfs),
    # The FIELDSTG image (disc file 358, 50 sectors) the field interpreter and the
    # fieldstg-table extractors read.
    overlay_stage("native_fieldstg", ["tools/extract_native_fieldstg.py"], str(REPO),
          inputs=(DISC,), outputs=("web/assets/native/fieldstg.bin",)),
    # Every wstag overlay's stage descriptor (0x80099D80 writes), lifted from the
    # ddw3 assembly with the vendored m2c (tools/exe_decomp/lift_overlays.py) into
    # build/exe-decomp, then tabulated. Read by the NPC-bank, NPC-program,
    # default-spawn and cast-list stages.
    overlay_stage("decomp_lift", ["tools/build_decomp_lift.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"), "recovered/ddw3/function-inventory.json"),
          uv_with=("pycparser==2.22",),
          outputs=("exe-decomp/c",)),
    Stage("stage_descriptors", ["tools/extract_stage_descriptors.py", "--root", "exe-decomp",
                                "--json", "docs/generated/stage-descriptors.json"], str(REPO),
          inputs=("exe-decomp/c",),
          outputs=("docs/generated/stage-descriptors.json",)),
    # Raw item-possession call sites in the assembly (native-immediate census),
    # read by tools/item-readers.mjs and the item-route tests.
    Stage("item_native_readers", ["tools/extract_item_readers.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"),
                  "docs/generated/stage-descriptors.json"),
          outputs=("docs/generated/item-native-readers.json",),
          deps=("stage_descriptors",)),
    # The recovered-code semantics table: tracked (data/recovered-semantics.json)
    # because its generator chain needs the un-exported research DB; installed
    # where the native screen probe and its tests read it.
    overlay_stage("recovered_semantics", ["tools/install_recovered_semantics.py"], str(REPO),
          inputs=("data/recovered-semantics.json",),
          outputs=("recovered/ddw3/semantics.json",)),
    # The durable item route census (docs/generated/item-routes.json) and the
    # booster-id module the engine imports (engine/dw3/booster-items.ts).
    overlay_stage("item_routes", ["tools/report_item_routes.py"], str(REPO),
          inputs=("web/assets/data/item_effects.json",
                  "web/assets/data/item_obtain_index.json",
                  "web/assets/data/card_boosters.json",
                  "web/assets/native/screens/pro_fightstg.bin",
                  "docs/generated/item-native-readers.json",
                  "web/assets/scenes"),
          outputs=("docs/generated/item-routes.json", "engine/dw3/booster-items.ts"),
          deps=("item_effects", "item_obtain_index", "card_boosters", "native_screens",
                "item_native_readers", "item_directories", "item_names", "item_data",
                "equipment_ts", "gen_scenes_final")),
    # Structural function inventory of the ddw3 assembly (module load bases,
    # jal-established entries). The native-screen probe needs each module's
    # base and function partition; the research-only inputs (semantics,
    # decompiled C, extents) are absent here and only add names.
    Stage("recovered_inventory",
          ["tools/build_recovered_inventory.py", "--asm-root", str(DDW3 / "asm/dw2003"),
           "--exe-data", str(DDW3 / "rust/dw2003_exe_data/src/data.rs"),
           "--overlay-data-root", str(DDW3 / "rust"),
           "--output", "recovered/ddw3/function-inventory.json",
           "--decomp-root", "build/none", "--semantics", "build/none.json",
           "--recovered-decomp-root", "build/none", "--function-extents", "build/none.json",
           "--psyq-matches", "build/none.json"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003"),),
          outputs=("recovered/ddw3/function-inventory.json",)),
    # Byte-exact parse of the common VAB (slot -> vag + loop points); then the
    # Sound Test's common-bank name/id table built on it. Both feed sfx + SFSTDATA.
    overlay_stage("common_tones", ["tools/decode_vag_loops.py"], str(REPO),
          inputs=(str(DDW3 / "pack/dw2003/sound/common/mpcommon/0.vh"),),
          outputs=("docs/research/audio/common-tones-full.json",)),
    overlay_stage("soundtst_common_ids", ["tools/gen_soundtst_ids.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/soundtst.s"),
                  "docs/research/audio/common-tones-full.json"),
          outputs=("docs/research/audio/soundtst-common-ids.json",)),
    # Hand-authored, non-game data (data/authored/<path> -> <path>): the chapter
    # ladder and the species -> battle-model-folder table. See the tool.
    overlay_stage("authored_data", ["tools/install_authored_data.py"], str(REPO),
          inputs=("data/authored",),
          outputs=("web/assets/data/chapter_progression.json",
                   "web/assets/battle/model_id_map.json",
                   "web/assets/battle/model_map.json",
                   "web/assets/data/maze_exits.json",
                   "web/assets/data/dna_clip12.json")),
    # Every STITSHOP shop's stock list (stitshop data.rs + esshpnam names), and
    # the merchant model (shop -> merchant type) built on it.
    Stage("shops", ["tools/extract_shops.py"], str(REPO),
          inputs=(str(DDW3 / "rust/dw2003_pro_stitshop/src/data.rs"),
                  str(DDW3 / "lang_file/dw2003/eng/esshpnam.toml")),
          outputs=("web/assets/data/shops.json",)),
    Stage("merchants", ["tools/build_merchants.py"], str(REPO),
          inputs=("web/assets/data/items.json", "web/assets/data/shops.json"),
          outputs=("web/assets/data/merchants.json",)),
    # The bank-0x70 roster predicate table D0x80048ad8 (static EXE data), read
    # out of the resident EXE on the rebuilt disc.
    Stage("roster_predicate_table", ["tools/extract_roster_predicate_table.py", "--disc", DISC],
          str(REPO), inputs=(DISC,),
          outputs=("web/assets/data/roster_predicate_table.json",)),
    # species -> battle model folder (model_id_map + the built model index); the
    # custom-model stage then registers the authored packs on top of it. The seed
    # model_map.json is authored data (the rule rewrites rows in place), so the
    # stage waits for authored_data to install it.
    Stage("model_map", ["tools/build_model_map.py"], str(REPO),
          inputs=("web/assets/battle/model_id_map.json", "web/assets/battle/models/index.json",
                  "web/assets/data/digimon.json"),
          outputs=("web/assets/battle/model_map.json",),
          deps=("authored_data",)),
    # ---- data the private tree carried without a stage (each tool already
    # existed; these wire it into the build) ----
    Stage("arenas", ["tools/extract_arenas.py"], str(REPO),
          inputs=(str(DDW3 / "pack/dw2003/fight/effect"),
                  "docs/research/fight-3d/data/sfstdata_effect_table.json"),
          outputs=("web/assets/battle/arenas/manifest.json",)),
    Stage("ordinal_owner", ["tools/extract_ordinal_owner.py"], str(REPO),
          inputs=("web/assets/data/progress_ordinal.json", "web/assets/data/scene/arrival_candidates.json",
                  "web/assets/data/story_steps.json", "web/assets/data/talk_launch_bindings.json",
                  "web/assets/events/wstag_events.json"),
          outputs=("web/assets/data/ordinal_owner.json",)),
    Stage("beat_event_gates", ["tools/extract_beat_event_gates.py"], str(REPO),
          inputs=("web/assets/data/auto_event_gates.json", "web/assets/data/ordinal_owner.json",
                  "web/assets/data/progress_ordinal.json", "web/assets/events/wstag_events.json"),
          outputs=("web/assets/data/beat_event_gates.json",)),
    Stage("child_pool_parents", ["tools/extract_child_pool_parents.py"], str(REPO),
          inputs=("web/assets/native/fieldstg.bin", "web/assets/data/point_sprites.json"),
          outputs=("web/assets/data/child_pool_parents.json",)),
    Stage("dri_tables", ["tools/extract_dri_tables.py", "--disc"], str(REPO),
          inputs=(DISC, "web/assets/data/items.json"),
          outputs=("web/assets/data/dri_tables.json",)),
    Stage("inn_ui", ["tools/extract_inn_ui.py"], str(REPO),
          inputs=("web/assets/data/screen_table.json",
                  str(DDW3 / "lang_file/dw2003/eng/eshtlnam.toml"),
                  str(DDW3 / "rust/dw2003_exe_data/src/data.rs")),
          outputs=("web/assets/data/inn_ui.json",)),
    Stage("item_gates", ["tools/extract_item_gates.py"], str(REPO),
          inputs=("web/assets/data/story_steps.json", "web/assets/scenes"),
          deps=("gen_scenes_final",),
          outputs=("web/assets/data/item_gates.json",)),
    Stage("item_grants", ["tools/extract_item_grants.py"], str(REPO),
          inputs=("web/assets/data/scripted_battles.json",),
          outputs=("web/assets/data/item_grants.json",)),
    Stage("jogress_scripts", ["tools/extract_jogress_scripts.py"], str(REPO),
          inputs=("web/assets/native/screens/resident.bin", "web/assets/battle/model_placement.json"),
          outputs=("web/assets/data/jogress_scripts.json",)),
    Stage("maze_exits", ["tools/extract_maze_exits.py", "--write"], str(REPO),
          inputs=("web/assets/scenes",),
          outputs=("web/assets/data/maze_exit_records.json", "web/assets/data/maze_sections.json"),
          deps=("gen_scenes",)),
    # The places system's per-stage placePoints tables (WS7): the 34 overlays that
    # re-aim their exits per the incoming route pair. Read from the disc's own
    # overlays (the updateStage's copyPlacePoints call names each table), so it
    # needs no scenes; gen_scenes consumes it to slot the exit rows and attach the
    # table. Ledger: places-copy-place-points-family-2026-10-10.
    Stage("stage_place_points", ["tools/extract_stage_place_points.py", "--write"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"), "data/screen_table.json"),
          outputs=("web/assets/data/stage_place_points.json",),
          deps=("screen_table",)),
    # Second gen_scenes pass: the first ran before maze_sections.json existed
    # (the file is derived FROM the scenes by extract_maze_exits), so it could
    # not write the wrap-maze sections into them; this pass folds the fresh
    # sections (and the rig-captured warps, data/authored) into the scenes.
    # Consumers that must see the final scenes (gen_trap_pads, story census)
    # depend on THIS stage.
    Stage("gen_scenes_final", ["tools/gen_scenes.py", "--all"], str(REPO),
          inputs=("web/assets/scenes", "web/assets/data/maze_sections.json",
                  "web/assets/data/maze_exits.json",
                  "web/assets/data/stage_place_points.json"),
          outputs=("web/assets/scenes",),
          deps=("maze_exits", "stage_place_points")),
    Stage("scene_completion", ["tools/extract_scene_completion.py"], str(REPO),
          inputs=("web/assets/events/wstag_events.json",),
          outputs=("web/assets/data/scene/scene_completion.json",)),
    Stage("stage_fixed_sprites", ["tools/extract_stage_fixed_sprites.py", "--out",
                                  "web/assets/data/stage_fixed_sprites.json"], str(REPO),
          inputs=("web/assets/native/fieldstg.bin",),
          outputs=("web/assets/data/stage_fixed_sprites.json",)),
    Stage("stage_layout_variants", ["tools/extract_stage_layout_variants.py", "--json"], str(REPO),
          inputs=(DISC,),
          outputs=("web/assets/data/stage_layout_variants.json",)),
    Stage("stage_overlay_shapes", ["tools/extract_stage_overlay_shapes.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro"),),
          outputs=("web/assets/data/stage_overlay_shapes.json",)),
    Stage("stage_slot_ensembles", ["tools/extract_display_slot_ensembles.py"], str(REPO),
          inputs=("web/assets/native/fieldstg.bin",),
          outputs=("web/assets/data/stage_slot_ensembles.json",)),
    Stage("stage_slot_players", ["tools/extract_stage_slot_players.py", "--out",
                                 "web/assets/data/stage_slot_players.json"], str(REPO),
          inputs=("web/assets/native/fieldstg.bin", "web/assets/data/point_sprites.json"),
          outputs=("web/assets/data/stage_slot_players.json",)),
    Stage("story_trigger_zones", ["tools/extract_story_trigger_zones.py", "--json"], str(REPO),
          inputs=(DISC, "web/assets/data/story_steps.json"),
          outputs=("web/assets/data/story_trigger_zones.json",)),
    Stage("debug_spine", ["tools/build_debug_spine.py"], str(REPO),
          inputs=("web/assets/data/progress_ordinal.json", "web/assets/scenes"),
          outputs=("web/assets/data/debug_spine.json",), deps=("gen_scenes",)),
    # Screen-UI layout tables read out of the lifted screen overlays (exe-decomp/).
    *(Stage(f"{m}_ui", [f"tools/extract_{m}_ui.py"], str(REPO),
            inputs=("exe-decomp/c", "web/assets/data/card_catalog.json"),
            outputs=(f"web/assets/data/{m}_ui.json",), deps=("screen_packs",))
      for m in ("shop", "stcrdabm", "stcrddek", "stcrdshp", "stdgname", "stfgtrep", "stplnmet")),
    Stage("stcrddek_tables", ["tools/extract_stcrddek_tables.py"], str(REPO),
          inputs=("exe-decomp/c", "web/assets/native/screens/resident.bin"),
          outputs=("web/assets/data/stcrddek_tables.json",), deps=("native_screens",)),
    # Weapon/armor/accessory catalog: EXE item + equip-stat tables (data.rs).
    Stage("equipment", ["tools/build_equipment.py"], str(REPO),
          inputs=(str(DDW3 / "rust/dw2003_exe_data/src/data.rs"),
                  str(DDW3 / "rust/types/src/item_id.rs")),
          outputs=("web/assets/data/equipment.json",)),
    # SDIGIEDT's 194 enemy stat records (ddw3 rust/dw2003_pro_sdigiedt data.rs).
    overlay_stage("enemies", ["tools/extract_enemies.py"], str(REPO),
          inputs=(str(DDW3 / "rust/dw2003_pro_sdigiedt/src/data.rs"),),
          outputs=("web/assets/data/enemies.json",)),
    # SFSTDATA effect records + fightstg's packed-sound table (backdrops, sfx).
    Stage("sfstdata_effect_table", ["tools/extract_sfstdata_effect_table.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/sfstdata.s"), str(DDW3 / "asm/dw2003/pro/fightstg.s"),
                  "docs/research/audio/soundtst-common-ids.json"),
          outputs=("docs/research/fight-3d/data/sfstdata_effect_table.json",)),
    # The developers' Sound Test category table (pro/soundtst), read by sfx/music.
    Stage("soundtst_categories", ["tools/extract_soundtst.py"], str(REPO),
          inputs=(str(DDW3 / "asm/dw2003/pro/soundtst.s"),),
          outputs=("docs/research/audio/soundtst-categories.json",)),
    # Optional asset-aware 4x derivative of every runtime raster asset. This is
    # deliberately opt-in: it downloads CPU-ML dependencies and processes ~1900
    # images, including large maps. Native extracted assets remain untouched;
    # the parallel tree preserves paths and records source dimensions.
    # Run: .venv/bin/python3 build_all.py --only upscale_assets
    Stage("upscale_assets", ["tools/upscale_assets.py"], str(REPO),
          uv_with=("torch", "spandrel", "spandrel-extra-arches", "gdown",
                   "pillow", "numpy"),
          inputs=("web/assets",), outputs=("web/assets-hd/manifest.json",),
          deps=("build_assets", "fight_models", "fight_effects", "backdrops",
                "ui_assets", "screen_packs", "fieldcom_icons", "dive_demo",
                "tranin", "stdwtitl_ui", "ui_font", "title_art", "thumbs",
                "map_overlays", "map_stp_solid", "map_layer_order", "map_hairlines",
                "map_ground_over_props", "point_sprites", "texture_patches"),
          opt_in=True, uv_python="3.12"),
]

# Public-overlay stages whose tool this tree does not carry (the walker) are
# dropped here; the export registers every stage (see overlay_stage).
STAGES = [s for s in STAGES if s is not None]


def _wire_dependencies(stages):
    """Every stage runs after ddw3_disc (it makes the disc image and sound banks),
    and after whichever single stage lists one of its inputs as an output.

    A dep naming a public-overlay stage this tree does not carry (the walker) is
    dropped with the stage itself; a dep on any other unknown name still fails
    topo_order."""
    names = {st.name for st in stages}
    producers = {}
    for st in stages:
        for out in st.outputs:
            producers.setdefault(str(_resolve(st.cwd, out)), []).append(st.name)
    for st in stages:
        deps = [d for d in st.deps if d in names or d not in _OVERLAY_MISSING]
        if "ddw3_disc" in names and st.name != "ddw3_disc" and "ddw3_disc" not in deps:
            deps.append("ddw3_disc")
        tool = _resolve(st.cwd, st.cmd[0])
        if (st.name not in ("decomp_lift", "ddw3_disc", "recovered_inventory")
                and "decomp_lift" in names and tool.suffix == ".py" and tool.exists()
                and "exe-decomp" in tool.read_text(errors="replace")
                and "decomp_lift" not in deps):
            deps.append("decomp_lift")  # reads lifted C under exe-decomp/
        for inp in st.inputs:
            who = producers.get(str(_resolve(st.cwd, inp)), [])
            if len(who) == 1 and who[0] != st.name and who[0] not in deps:
                deps.append(who[0])
        st.deps = tuple(deps)


_wire_dependencies(STAGES)

def main(argv=None):
    ap = argparse.ArgumentParser(description="Rebuild all of web/assets/ from disc/packs.")
    ap.add_argument("--only", help="comma-separated stage names to run")
    ap.add_argument("--skip", help="comma-separated stage names to skip")
    ap.add_argument(
        "--profile", choices=("authentic", "hd"), default="authentic",
        help="authentic builds native assets only; hd also builds the 4x asset pack",
    )
    ap.add_argument(
        "--jobs", "-j", type=int, default=None,
        help="stages to run at once (default: cores, max 6, or $DW2003_JOBS; 1 = serial)",
    )
    ap.add_argument("--list", action="store_true", help="print stages in order and exit")
    ap.add_argument("--dry-run", action="store_true", help="validate only, run nothing")
    a = ap.parse_args(argv)
    only = a.only.split(",") if a.only else None
    skip = a.skip.split(",") if a.skip else None
    if a.list:
        for s in topo_order(STAGES):
            py = f" --python {s.uv_python}" if s.uv_python else ""
            extras = f" --with {' '.join(s.uv_with)}" if s.uv_with else ""
            opt_in = " [opt-in]" if s.opt_in else ""
            print(f"{s.name:<16} {' '.join(s.cmd)}{py}{extras}{opt_in}")
        print("\n# authored inputs (committed, validated — NOT generated from ~/ddw3):")
        for rel, desc in AUTHORED_DATA:
            print(f"{rel:<32} {desc.split(';')[0].split('—')[0].strip()}")
        return 0
    if a.dry_run:
        problems = validate(STAGES, REPO) + validate_authored(REPO)
        for p in problems:
            print("DRY-RUN PROBLEM:", p)
        print("dry-run OK" if not problems else f"dry-run found {len(problems)} problem(s)")
        return 0 if not problems else 1
    # Fail fast before a real build if a committed authored input is missing/corrupt —
    # the generated stages can't make these, so a missing one means a broken game.
    authored_problems = validate_authored(REPO)
    if authored_problems:
        for p in authored_problems:
            print("AUTHORED INPUT PROBLEM:", p)
        return 1
    uv = os.path.expanduser("~/.local/bin/uv")
    if not os.path.exists(uv):
        import shutil as _shutil_uv
        uv = _shutil_uv.which("uv") or uv
    return run_all(
        STAGES, only=only, skip=skip, include_opt_in=a.profile == "hd", uv=uv, jobs=a.jobs
    )


if __name__ == "__main__":
    sys.exit(main())
