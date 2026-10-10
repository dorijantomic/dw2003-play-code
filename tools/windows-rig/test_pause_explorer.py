#!/usr/bin/env python3
"""Offline test of pause-explorer.lua against a fake BizHawk and a fake menu.

The fake game is a tiny pause menu with the same shape as the real one: a field,
a top list that START opens (five rows, Up/Down clamp), a SORT page that Cross
opens from row 1 (cursor wraps over three rows), Triangle to go back, an overlay
that is only resident while the page is open, and a save-data counter that moves
on its own. The test checks the explorer finds every screen, measures the waits,
drops the moving counter from the key, and flags a key that is too coarse.

Run: ~/.local/bin/uv run --no-project --with lupa --with pytest pytest tools/windows-rig/test_pause_explorer.py
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

lupa = pytest.importorskip("lupa")

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]

FAKE = r"""
-- Fake BizHawk: memory, hooks, pad, states, frame loop.
local MEM = {}
local HOOKS = {}
local FRAMEEND = {}
local PAD_NEXT, PAD = {}, {}
local STATES = {}
local FRAMECOUNT = 0
local GAME

local function r32(a) return MEM[a & 0x1fffff] or 0 end
local function w32(a, v) MEM[a & 0x1fffff] = v & 0xffffffff end

memory = {}
function memory.read_u32_le(a, d) return r32(a) end
function memory.read_u8(a, d) return (r32(a & ~3) >> ((a & 3) * 8)) & 0xff end
function memory.read_u16_le(a, d) return memory.read_u8(a) | (memory.read_u8(a + 1) << 8) end
function memory.write_u8(a, v, d)
  local w = a & ~3; local sh = (a & 3) * 8
  w32(w, (r32(w) & ~(0xff << sh)) | ((v & 0xff) << sh))
end
function memory.write_u16_le(a, v, d) memory.write_u8(a, v & 0xff); memory.write_u8(a + 1, (v >> 8) & 0xff) end
function memory.hash_region(a, size, d)
  local h = 0
  for i = 0, size - 1, 4 do h = (h * 31 + r32(a + i)) % 4294967296 end
  return string.format("%016X", h)
end
emu = {}
local REGS = {}
function emu.getregisters() return REGS end
function emu.framecount() return FRAMECOUNT end
event = {}
local GUID = 0
function event.on_bus_exec(fn, addr, name, scope)
  GUID = GUID + 1
  local g = "g" .. GUID
  HOOKS[g] = {fn = fn, addr = addr & 0x1fffff}
  return g
end
function event.unregisterbyid(g) HOOKS[g] = nil end
function event.onframeend(fn, name) FRAMEEND[name] = fn end
function event.unregisterbyname(name) FRAMEEND[name] = nil end
joypad = {}
local NAMES = {"Up","Down","Left","Right","Cross","Circle","Square","Triangle","Start","Select","L1","R1","L2","R2"}
function joypad.get(p) local t = {} for _, n in ipairs(NAMES) do t[n] = false end return t end
function joypad.set(t, p) for k, v in pairs(t) do PAD_NEXT[k] = v end end
local function copy(t) local o = {} for k, v in pairs(t) do o[k] = type(v) == "table" and copy(v) or v end return o end
savestate = {}
function savestate.save(path) STATES[path] = {mem = copy(MEM), game = copy(GAME)} end
function savestate.load(path)
  local s = assert(STATES[path], "no state " .. path)
  MEM, GAME = copy(s.mem), copy(s.game)
end
client = {}
function client.screenshot(path) local f = io.open(path, "w") f:write("png") f:close() end
function client.speedmode(p) end
function emu.limitframerate(on) end

local function exec(addr, a0)
  REGS = {a0 = a0}
  for _, h in pairs(HOOKS) do if h.addr == addr & 0x1fffff then h.fn(addr) end end
end

-- Fake game. Addresses mirror PAUSE_SPEC: a task table of object pointers,
-- each object with its main routine at +0x48 and children at +0x20/+0x24.
local TASKS = 0x8004b610
local TOP, HOSTH, SORT = 0x8001270c, 0x80099894, 0x800980b0
local TOPOBJ, HOSTOBJ, SORTOBJ, HOSTAUX = 0x80100000, 0x80110000, 0x80120000, 0x80110100
local WORDS = FAKE_WORDS  -- handler addr -> words, from the spec
local PREV = {}

GAME = {mode = "field", t = 0, clock = 0}

local function load_overlay(on)
  for addr, words in pairs(WORDS) do
    for j, w in ipairs(words) do w32(addr + (j - 1) * 4, on and w or 0) end
  end
end

local function set_tasks(list)
  for i = 0, 99 do w32(TASKS + 4 * i, list[i + 1] or 0) end
end

-- The pause scene's first object sits at the heap start, reachable from no
-- global and not in the task table; the host is its child 0.
local HEAP, ROOTOBJ, ROOTAUX = 0x800ab800, 0x800ab878, 0x800ab900
w32(0x8004b5e0, HEAP)
w32(ROOTOBJ + 0x48, 0x80083558); w32(ROOTOBJ + 0x20, 1); w32(ROOTOBJ + 0x24, ROOTAUX)
w32(ROOTAUX, HOSTOBJ)
w32(0x8004b3f8, 0x20d)
w32(TOPOBJ + 0x48, TOP)
w32(HOSTOBJ + 0x48, HOSTH); w32(HOSTOBJ + 0x20, 2); w32(HOSTOBJ + 0x24, HOSTAUX)
w32(SORTOBJ + 0x48, SORT)
-- One box under SORT: its "hide" routine pointer sits at +0x144, its shown word at +0x1f0.
local BOX, HIDE = 0x80121000, 0x80020100
w32(SORTOBJ + 0x20, 1); w32(SORTOBJ + 0x24, 0x80121800); w32(0x80121800, BOX)
w32(BOX + 0x48, 0x80020000); w32(BOX + 0x144, HIDE); w32(BOX + 0x1f0, 1)
-- A shared service table: the pad routine sits at 0x8004B7D0 + 0x3F4.
local PADSVC = 0x80020200
w32(0x8004b7d0 + 0x3f4, PADSVC)
-- A field object that is always there; its child count is garbage-sized.
w32(0x80130000 + 0x48, 0x800a5de0); w32(0x80130000 + 0x20, 0x7fffffff)
set_tasks({0x80130000})

local function pressed(b) return PAD[b] and not PREV[b] end
local function sound(id) REGS = {a0 = id}; for _, h in pairs(HOOKS) do if h.addr == 0x2006c then h.fn(0x8002006c) end end end

function game_frame()
  local g = GAME
  g.clock = g.clock + 1
  w32(0x80049494, g.clock)            -- a roster word that moves on its own
  if g.mode ~= "handoff" or g.t < 10 then w32(0x80055d2c, 474) end  -- the scene
  if g.mode == "field" then
    if pressed("Start") then
      g.mode, g.t = "top_open", 0; w32(TOPOBJ + 0xc, 0)
      set_tasks({0x80130000, TOPOBJ})
    end
  elseif g.mode == "top_open" then
    g.t = g.t + 1; w32(TOPOBJ + 0xc, 1)
    if g.t >= 6 then g.mode = "top"; w32(TOPOBJ + 0xc, 3); w32(TOPOBJ + 0x5c, 5) end
  elseif g.mode == "top" then
    local row = r32(TOPOBJ + 0x58)
    if pressed("Up") and row > 0 then w32(TOPOBJ + 0x58, row - 1); sound(0x8004513e) end
    if pressed("Down") and row < 4 then w32(TOPOBJ + 0x58, row + 1); sound(0x8004513e) end
    -- Row 3 hides a coarse key: Square toggles a word (+0x74) the key does not
    -- read, and Cross then lands on a different screen depending on it.
    if row == 3 and pressed("Square") then w32(TOPOBJ + 0x74, 1 - r32(TOPOBJ + 0x74)) end
    if pressed("Cross") and row == 1 then
      -- The real list folds shut in step 2 and waits on a disc load that moves
      -- no keyed word for longer than the settle window.
      g.mode, g.t = "handoff", 0
      w32(TOPOBJ + 0xc, 2)
    elseif pressed("Cross") and row == 3 then
      w32(TOPOBJ + 0x64, r32(TOPOBJ + 0x74) + 1)
    elseif pressed("Triangle") then
      g.mode = "field"; w32(TOPOBJ + 0x58, 0); w32(TOPOBJ + 0x64, 0)
      set_tasks({0x80130000})
    end
    w32(TOPOBJ + 0x70, g.clock % 16)    -- a blink timer outside the key
  elseif g.mode == "handoff" then
    g.t = g.t + 1
    -- Then the list is gone, the task table is empty and the scene word is -1
    -- while the page's overlay loads (as on the real disc).
    -- The current-scene word switches to the pause scene at once (live
    -- 2026-09-29: 0x1000 while nothing of the pause scene exists yet).
    if g.t == 10 then set_tasks({}); w32(0x80055d2c, 0xffffffff); w32(0x8004b3f8, 0x1000) end
    if g.t >= 45 then
      g.mode, g.t = "page_open", 0
      w32(TOPOBJ + 0xc, 3)
      load_overlay(true)
      w32(0x8005ccf0, 1)
      -- The host loads its text for 40 frames in step 0 before the page exists.
      w32(HOSTOBJ + 0xc, 0)
      w32(SORTOBJ + 0x10, 0); w32(SORTOBJ + 0x80, 0)
      w32(HOSTAUX, 0); w32(HOSTAUX + 4, 0)
      set_tasks({})
    end
  elseif g.mode == "page_open" then
    g.t = g.t + 1
    if g.t == 40 then w32(HOSTOBJ + 0xc, 1); w32(HOSTAUX + 4, SORTOBJ) end
    if g.t < 40 then return end
    if g.clock % 2 == 0 then w32(SORTOBJ + 0x10, g.t) end
    if g.t >= 52 then g.mode = "page"; w32(SORTOBJ + 0x10, 20) end
  elseif g.mode == "page" then
    local c = r32(SORTOBJ + 0x80)
    exec(SORT)                          -- the page tick runs every frame
    exec(PADSVC, 0)                     -- and polls the pad service
    if pressed("Down") then
      exec(0x80098300); w32(SORTOBJ + 0x80, (c + 1) % 3); sound(0x8004513e)
      exec(HIDE, BOX); w32(BOX + 0x1f0, 0)
    end
    if pressed("Up") then w32(SORTOBJ + 0x80, (c + 2) % 3) end
    -- Circle swaps the first two party slots: the save data changes.
    if pressed("Circle") then
      local a, b = r32(0x80048da4), r32(0x80048da8)
      w32(0x80048da4, b); w32(0x80048da8, a == 0 and 1 or a)
    end
    if pressed("Triangle") then
      g.mode = "top"; load_overlay(false); w32(TOPOBJ + 0x58, 1)
      w32(0x8004b3f8, 0x20d)
      set_tasks({0x80130000, TOPOBJ})
    end
  end
end

function run_frames(n)
  for i = 1, n do
    PAD = PAD_NEXT; PAD_NEXT = {}
    game_frame()
    for k, v in pairs(PAD) do PREV[k] = v end
    for _, b in ipairs(NAMES) do if not PAD[b] then PREV[b] = nil end end
    FRAMECOUNT = FRAMECOUNT + 1
    for _, fn in pairs(FRAMEEND) do fn() end
    if PXP and PXP.stopped then return i end
  end
  return n
end
"""


def build_spec(tmp: pathlib.Path) -> pathlib.Path:
    out = tmp / "spec.lua"
    subprocess.run([sys.executable, str(ROOT / "tools/build_pause_explorer_spec.py"), "--out", str(out)],
                   check=True, cwd=ROOT, capture_output=True)
    return out


def run_explorer(tmp: pathlib.Path, pre_lua: str = "", **cfg) -> dict:
    tmp.mkdir(parents=True, exist_ok=True)
    spec = build_spec(tmp)
    out = tmp / "out"
    (out / "shots").mkdir(parents=True)
    (tmp / "states").mkdir()
    lua = lupa.LuaRuntime()
    lua.execute(f"dofile({json.dumps(str(spec))})")
    # The fake overlay writes every page root's words while the page is open.
    lua.execute("""
      FAKE_WORDS = {}
      for _, pg in ipairs(PAUSE_SPEC.pages) do
        if #pg.words > 0 then FAKE_WORDS[pg.handler] = pg.words end
      end
      for _, r in ipairs(PAUSE_SPEC.scene_roots) do FAKE_WORDS[r.handler] = r.words end
    """)
    lua.execute(FAKE)
    if pre_lua:
        lua.execute(pre_lua)
    settings = dict(run="t", out=str(out), states=str(tmp / "states"), calibrate=40,
                    settle=20, max_frames=200)
    settings.update(cfg)
    def lua_lit(v):
        if isinstance(v, bool):
            return str(v).lower()
        if isinstance(v, list):
            return "{" + ", ".join(lua_lit(x) for x in v) + "}"
        return json.dumps(v)
    body = ", ".join(f"{k} = {lua_lit(v)}" for k, v in settings.items())
    lua.execute(f"PAUSE_EXPLORE_CFG = {{ {body} }}")
    lua.execute(f"dofile({json.dumps(str(HERE / 'pause-explorer.lua'))})")
    lua.execute("run_frames(400000)")

    def lines(name):
        p = out / name
        return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []

    return dict(lua=lua, out=out, summary=json.loads((out / "summary.json").read_text()), nodes=lines("nodes.jsonl"),
                edges=lines("edges.jsonl"), keys={k["id"]: k["key"] for k in lines("keys.jsonl")},
                calibration=lines("calibration.jsonl"))


def test_explorer_maps_the_fake_menu(tmp_path):
    r = run_explorer(tmp_path)
    s = r["summary"]
    assert s["reason"] == "queue empty: no new screens", s
    assert s["unsettled"] == 0
    # The moving roster word is dropped from the key after calibration.
    assert r["calibration"][0]["volatile"] == {"roster": True}
    keys = [n["key"] for n in r["nodes"]]
    tops = [k for k in keys if k.startswith("top=") and "sort=" not in k]
    sorts = [n["key"] for n in r["nodes"] if "sort=" in n["key"] and not n.get("world_changed")]
    # field, five top rows (+ the two row-3 results), three SORT cursors.
    assert sum(1 for k in keys if not k.startswith(("top=", "host="))) == 1
    assert len(sorts) == 3, sorts
    assert len({k.split("|")[0] for k in tops}) >= 5
    # START from the field has a measured wait: the key first changes, then
    # settles once the list has finished opening (6 frames in the fake).
    start = next(e for e in r["edges"] if e["from"] == 1 and e["button"] == "Start")
    assert start["settled"] and start["first_change"] is not None
    assert start["settle_frame"] >= 6
    # A press that changes the screen on its first held frame counts from 1; a
    # press that changes nothing has no change frame at all.
    down = next(e for e in r["edges"] if e["from"] == start["to"] and e["button"] == "Down")
    assert down["first_change"] == 1 and down["settle_frame"] == 1
    up = next(e for e in r["edges"] if e["from"] == start["to"] and e["button"] == "Up")
    assert up["to"] == start["to"] and up.get("first_change") is None
    # The one hook left, on the sound routine, still reports the cursor sound.
    assert ["8004513e"] == [x[1] for x in down["sounds"]]
    # Cross on SORT goes through the 45-frame handoff and lands on the page;
    # no screen is ever settled inside the handoff step.
    sort_row = next(n for n in r["nodes"] if n["path"] == ["Start", "Down"])
    cross = next(e for e in r["edges"] if e["from"] == sort_row["id"] and e["button"] == "Cross")
    assert "sort=" in r["keys"][cross["to_key_id"]] and cross["settle_frame"] > 45 + 40
    # No screen is settled while the host is still loading (host step 0).
    assert not any("host=0," in n["key"] for n in r["nodes"])
    assert not any(k.startswith("top=2,") for k in (n["key"] for n in r["nodes"]))
    # Every trial restored its starting screen exactly.
    assert all(e["restore_ok"] for e in r["edges"])


def test_explorer_records_but_does_not_expand_a_world_change(tmp_path):
    r = run_explorer(tmp_path)
    changed = [n for n in r["nodes"] if n.get("world_changed")]
    assert changed and not any(n["expanded"] for n in changed)
    assert all(n["path"][-1] == "Circle" for n in changed)


def test_explorer_flags_a_coarse_key(tmp_path):
    r = run_explorer(tmp_path)
    coarse = [e for e in r["edges"] if e.get("coarse")]
    # Row 3 + Square toggles a flag outside the key, so Cross from the alternate
    # moment on row 3 lands somewhere else than from the first moment.
    assert coarse, "the hidden flag on row 3 should make the key too coarse"
    assert all(e["button"] == "Cross" for e in coarse)


def test_explorer_applies_pokes_before_calibration(tmp_path):
    r = run_explorer(tmp_path, pokes=[0x80048ddb, 1, 0x63, 0x80048da0, 2, 0x967f], label="cheat-filled save")
    assert r["summary"]["pokes"] == 2 and r["summary"]["label"] == "cheat-filled save"
    run = json.loads((tmp_path / "out" / "run.jsonl").read_text().splitlines()[0])
    assert run["pokes_failed"] == 0


def test_explorer_resumes_where_a_run_stopped(tmp_path):
    whole = run_explorer(tmp_path / "whole")
    # A first run stopped by its budget, then a second run in the same emulator
    # session (the saved moments live there) that loads resume.lua.
    part = tmp_path / "part"
    first = run_explorer(part, max_trials=40)
    assert first["summary"]["reason"] == "trial budget reached"
    out1, out2 = part / "out", part / "out2"
    out2.mkdir()
    (out2 / "shots").mkdir()
    for name in ("nodes.jsonl", "edges.jsonl", "keys.jsonl", "alts.jsonl"):
        if (out1 / name).exists():
            (out2 / name).write_text((out1 / name).read_text())
    lua = first["lua"]
    lua.execute(f"PAUSE_EXPLORE_CFG = {{ run = 't2', out = {json.dumps(str(out2))}, states = {json.dumps(str(part / 'states'))},"
                f" settle = 20, max_frames = 200, resume = {json.dumps(str(out1 / 'resume.lua'))} }}")
    lua.execute(f"dofile({json.dumps(str(HERE / 'pause-explorer.lua'))})")
    lua.execute("run_frames(400000)")
    second = json.loads((out2 / "summary.json").read_text())
    assert second["reason"] == "queue empty: no new screens"
    keys = lambda folder: sorted(json.loads(l)["key"] for l in (folder / "nodes.jsonl").read_text().splitlines())
    assert keys(out2) == keys(whole["out"])
    assert second["trials"] == whole["summary"]["trials"]


def test_sample_lists_keeps_the_list_ends(tmp_path):
    r = run_explorer(tmp_path, max_trials=1, sample_lists=True)
    inner = r["lua"].eval("PXP.inside_list")
    bag = lambda cell, count=0x7b: f"host=1,1|items=1,10|bag=1,2,0,{count:x},{cell:x},{cell >> 4:x}|row=0"
    # 16 cells a page in two columns: the first and last row of each page stay.
    assert [c for c in range(32) if not inner(bag(c))] == [0, 1, 14, 15, 16, 17, 30, 31]
    # The last two items of a tab stay too, and a short key (child page open) is never skipped.
    assert not inner(bag(0x24, count=0x26)) and not inner(bag(0x25, count=0x26))
    assert inner(bag(0x23, count=0x26))
    assert not inner("host=1,1|items=1,10|bag=1|row=0") and not inner("host=1,1|sort=1,2|row=0")
    # EQUIPMENT's list (step 0xF, 8 rows): the first and last screenful stay.
    eq = lambda row, top, n=0x85, step=0xf: f"host=1,1|status=1,15|equipment=1,{step:x},0,0,{row:x},{n:x},{top:x},1|row=4"
    assert not inner(eq(7, 0)) and not inner(eq(7, 1)) and inner(eq(7, 2)) and inner(eq(3, 50))
    assert not inner(eq(7, 0x85 - 8)) and not inner(eq(0, 0x85 - 9)) and inner(eq(0, 0x85 - 10))
    assert not inner(eq(3, 10, n=0x14))  # a short list is all ends
    assert not inner(eq(3, 3, step=3)) and not inner("host=1,1|status=1,15|equipment=1,3,0,2|row=4")


def test_bench_reports_each_phase(tmp_path):
    # A fake wall clock: one second every 100 calls.
    r = run_explorer(tmp_path, pre_lua="local n = 0; os.time = function() n = n + 1; return n // 100 end", bench=1)
    s = r["summary"]
    assert s["reason"] == "bench done" and s["trials"] == 0
    assert [b["phase"] for b in s["bench"]][0] == "bare" and len(s["bench"]) == 4
    assert all(b["frames"] > 0 for b in s["bench"])


def test_windowed_sound_hook_keeps_every_sound(tmp_path):
    full = run_explorer(tmp_path / "full", sound_audit=100000)
    windowed = run_explorer(tmp_path / "win", sound_audit=0)
    sounds = lambda r: sorted((e["from"], e["button"], tuple(x[1] for x in e["sounds"])) for e in r["edges"])
    assert sounds(windowed) == sounds(full)
    assert full["summary"]["late_sounds"] == 0 and windowed["summary"]["sound_gaps"] >= 0
    assert [n["key"] for n in windowed["nodes"]] == [n["key"] for n in full["nodes"]]


def test_trace_records_functions_changes_and_sounds(tmp_path):
    # Reach the SORT page by pad, save that moment, then trace Down and Up from it.
    pre = """
      local function press(b, n) joypad.set({[b] = true}, 1); run_frames(1); run_frames(n) end
      press("Start", 20); press("Down", 5); press("Cross", 120)
      savestate.save("C:/S1")
    """
    cases = tmp_path / "cases.lua"
    cases.write_text('return {fns = {0x800980b0, 0x80098300}, slots = {0x114, 0x144}, services = {{base = 0x8004b7d0, slots = {0x3f4}}, {base = 0x8004b7d0, map_only = true, range = {0x3f0, 0x3f8}}}, cases = {'
                     '{id = 1, node = 7, state = "C:/S1", button = "Down"},'
                     '{id = 2, node = 7, state = "C:/S1", button = "Up"}}}')
    r = run_explorer(tmp_path, pre_lua=pre, trace=str(cases))
    assert r["summary"]["reason"] == "trace done" and r["summary"]["traced"] == 2
    down, up = [json.loads(x) for x in (r["out"] / "trace.jsonl").read_text().splitlines()]
    fns = {c["fn"]: c for c in down["calls"]}
    # The tick runs in the idle baseline too; the Down handler only on the press frame.
    assert fns["800980b0"]["first"] < 1 and fns["80098300"]["frames"] == [1]
    assert [x[1] for x in down["sounds"]] == ["8004513e"]
    sort = next(o for o in down["objects"] if o["page"] == "sort")
    assert sort["changes"] == [["80", "0", "1"]]
    # Only the fake's clock word moves in the save (a roster word that counts frames).
    assert {w[0] for w in down["world"]} <= {"roster"} and down["last_change"] == 1
    # Up moves the cursor to the last row through the same tick, with no Down handler.
    assert "80098300" not in {c["fn"] for c in up["calls"]}
    # The box's hide routine is found from its pointer, and its call and effect are recorded.
    assert down["action_fns"] == 2
    hide = [a for a in down["acts"] if a[1] == "80020100"]
    assert [a[1:4] + a[6:7] for a in hide] == [["80020100", "80121000", "0", ["144"]]]
    # The pad service is polled on every hooked frame, labelled by its table slot.
    assert r["summary"]["service_map"] == {"8004b7d0+3f0": "0", "8004b7d0+3f4": "80020200", "8004b7d0+3f8": "0"}
    pad = [a for a in down["acts"] if a[1] == "80020200"]
    assert pad and all(a[6] == ["svc3f4"] for a in pad)
    box = next(b for b in down["boxes"] if b["obj"] == "80121000")
    assert box["changes"] == [["1f0", "1", "0"]] and box["routine"] == "80020000"
    assert not [a for a in up["acts"] if a[1] == "80020100"] and not any(b["obj"] == "80121000" for b in up["boxes"])
    assert next(o for o in up["objects"] if o["page"] == "sort")["changes"] == [["80", "0", "2"]]


def test_trace_plays_presses_first_and_keeps_that_moment(tmp_path):
    # The same SORT trace, but the robot reaches SORT itself from the field with
    # the case's presses, keeps that moment, and the second case starts there.
    cases = tmp_path / "cases.lua"
    cases.write_text('return {fns = {0x80098300}, cases = {'
                     '{id = 1, state = "C:/F0", pre = {{"Start", 20}, {"Down", 5}, {"Cross", 120}}, save = "sort.State", button = "Down"},'
                     '{id = 2, state = "sort.State", button = "Up"}}}')
    r = run_explorer(tmp_path, pre_lua='savestate.save("C:/F0")', trace=str(cases))
    assert r["summary"]["reason"] == "trace done" and r["summary"]["traced"] == 2
    down, up = [json.loads(x) for x in (r["out"] / "trace.jsonl").read_text().splitlines()]
    assert down["pre"][0] == ["Start", 20]
    assert next(o for o in down["objects"] if o["page"] == "sort")["changes"] == [["80", "0", "1"]]
    assert next(o for o in up["objects"] if o["page"] == "sort")["changes"] == [["80", "0", "2"]]


def test_explorer_respects_the_trial_budget(tmp_path):
    r = run_explorer(tmp_path, max_trials=5)
    assert r["summary"]["reason"] == "trial budget reached"
    assert r["summary"]["trials"] == 5


def test_explorer_stops_on_stop_file(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    (out / "STOP").write_text("")
    r = run_explorer(tmp_path)
    assert r["summary"]["reason"] == "STOP file"


def test_report_reads_a_run(tmp_path):
    run_explorer(tmp_path)
    out = tmp_path / "out"
    subprocess.run([sys.executable, str(ROOT / "tools/pause_explorer_report.py"), str(out)],
                   check=True, cwd=ROOT, capture_output=True)
    graph = json.loads((out / "graph.json").read_text())
    text = (out / "MAP.md").read_text()
    assert graph["screens"][0]["name"].startswith("Field")
    assert any(s["name"].startswith("SORT (") for s in graph["screens"])
    assert "Key too coarse" in text
    assert "Pause list, cursor on SORT" in text
    cov = {c["page"]: c for c in json.loads((out / "coverage.json").read_text())}
    seen = [v[0] for v in cov["sort"]["seen"]]
    assert 0 in seen and 20 in seen
    # The real SORT tick's step list comes from the translation; the fake only
    # reaches its own steps, so most of the real list stays "never reached".
    assert cov["sort"]["cases"] and cov["sort"]["never"]
