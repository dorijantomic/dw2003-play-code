-- Repeat-examine SEARCH POINT trace (Asuka Inn 1F shelf, "300 BIT" find).
-- Needs setup-portable.lua loaded first (rd8, press, BTN, PRESS_LISTENER).
--
-- WHAT IT ANSWERS. The "check a spot N times to find an item" mechanic is the last
-- unmined item-grant producer class (PlatinumCard/Junk Shop, 9 Chips, post-game Epic
-- Weapon parts). A static sweep across all 318 overlays found NOTHING: no marker in
-- point_sprites, no cell in the type-7 trigger grid, no NPC record, no set_flag call
-- site. So the per-spot press COUNTER is runtime state. This trace finds it by diffing
-- the save-data region across successive X presses at one known spot.
--
--   * counter — some byte/halfword in the save block must increment on presses 1..4.
--   * grant   — on the successful press, BIT (0x80048da0) jumps by 300 and/or an
--               item count byte at 0x80048ddb+id goes 0 -> 1.
-- Whichever offset ticks up on every press and resets/stops at the find IS the counter.
--
-- OBSERVATION ONLY. Reads memory, presses X, writes one small text file. No
-- breakpoints (build 314 dies on exec BPs), no savestates, no screenshots, no writes
-- into the game. Windows range-capped per the repo's rig rule: two bounded windows,
-- 3840 bytes total, sampled once per press -- never a full-RAM dump.
--
-- HOW TO RUN
--   1. Load setup-portable.lua.
--   2. Load savestate 9 BY HAND (GUI hotkey). Loading it from a Vsync callback
--      destabilizes the process -- this script must not do it.
--      Stand at the shelf, no textbox open.
--   3. Load this file. It prints "shelf trace armed".
--   4. It presses X by itself, PRESSES times, waiting GAP frames between presses so
--      the textbox can open and close.
--   5. It stops itself and prints "shelf trace done". The file is rewritten after
--      every press, so quitting early still leaves a usable trace.
--
-- OUTPUT  C:/dw3-rig/dumps/shelf_search_trace.txt
--   '#' header lines, then per press: the BIT total, then every changed byte in the
--   watched windows as  <addr> <old> -> <new>.

local OUT = "C:/dw3-rig/dumps/shelf_search_trace.txt"

local BIT_ADDR  = 0x80048da0          -- money (u32), the "300 BIT" payoff
local ITEM_BASE = 0x80048ddb          -- item count array, 1 byte/item, cap 0x63

-- Two bounded windows over the save block. Keep these SMALL (rig rule: no bulk reads).
local W1_LO, W1_HI = 0x80048a00, 0x80049400   -- 2560 B: money + item counts
local W2_LO, W2_HI = 0x8004b300, 0x8004b800   -- 1280 B: stored flag/counter banks

local PRESSES     = 10     -- how many times to examine the shelf
local GAP         = 100    -- frames between presses (textbox open + close)
local MAX_DIFF    = 40     -- per-press cap on logged changed bytes

if ST_LISTENER then ST_LISTENER:remove(); ST_LISTENER = nil end

local mem = PCSX.getMemPtr()
local function rb(addr) return mem[bit.band(addr, 0x1fffff)] end

local function snap()
  local t = {}
  for a = W1_LO, W1_HI - 1 do t[a] = rb(a) end
  for a = W2_LO, W2_HI - 1 do t[a] = rb(a) end
  return t
end

local function bits() return rd32(BIT_ADDR) end

local lines = {}
local function emit(s) lines[#lines + 1] = s end

local function flush()
  local fh = io.open(OUT, "w")
  if not fh then return end
  fh:write(table.concat(lines, "\n"), "\n")
  fh:close()
end

emit("# shelf search-point trace -- Asuka Inn 1F, savestate 9")
emit(string.format("# windows %08x-%08x and %08x-%08x, %d presses, gap %d frames",
                   W1_LO, W1_HI, W2_LO, W2_HI, PRESSES, GAP))
emit(string.format("# BIT@%08x  ITEM_BASE@%08x", BIT_ADDR, ITEM_BASE))

local prev = snap()
local bit0 = bits()
emit(string.format("# baseline BIT=%d (0x%x)", bit0, bit0))
flush()

local n     = 0        -- presses issued
local timer = 0
local done  = false

ST_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if done then return end
  timer = timer - 1
  if timer > 0 then return end

  if n > 0 then
    -- sample the result of press n
    local cur  = snap()
    local nowb = bits()
    emit(string.format("press %d  BIT=%d  delta=%d", n, nowb, nowb - bit0))
    local shown = 0
    for a, v in pairs(cur) do
      if prev[a] ~= v then
        if shown < MAX_DIFF then
          emit(string.format("  %08x  %02x -> %02x", a, prev[a], v))
          shown = shown + 1
        end
      end
    end
    if shown == 0 then emit("  (no change in watched windows)") end
    prev, bit0 = cur, nowb
    flush()
  end

  if n >= PRESSES then
    emit("# done")
    flush()
    print("shelf trace done -> " .. OUT)
    done = true
    if ST_LISTENER then ST_LISTENER:remove(); ST_LISTENER = nil end
    return
  end

  n = n + 1
  press(BTN.X, 4)
  timer = GAP
end)

-- Long initial delay: when this is armed from the -dofile boot script the savestate
-- has just been loaded, so give the machine real emulation time to settle (and any
-- open textbox time to finish) before the first X press.
timer = 240
print("shelf trace armed -> " .. OUT)
