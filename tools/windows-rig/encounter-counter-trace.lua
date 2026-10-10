-- Random-encounter step-counter trace (ENCOUNTER-Q001, the last open residue).
-- Needs setup-portable.lua loaded first (rd32, press, BTN, PRESS_LISTENER).
--
-- WHAT IT ANSWERS. The 2026-07-26 savestate fixed the encounter values and layout in
-- live RAM but showed no motion, so three parts of the decode are still untested at
-- runtime. Watching [0x80048d64] while the player walks tests all three at once:
--
--   * period — the driver is claimed to run once per 8 movement ticks, so drops
--              should land ~8 frames apart while walking and never while standing.
--   * rate   — each drop should equal RATE[zone level] exactly: in Central Park 6 in
--              the level-3 zone and 3 in the level-1 zone. The drop size IS the rate,
--              so no encounter has to fire for this to be measured.
--   * reset  — on expiry the counter reloads to rand()%0x900 folded into 0..1279
--              (values under 0x100 kept, the rest halved toward 0x100). Each expiry
--              is one sample of that distribution.
--
-- OBSERVATION ONLY BY DEFAULT. It reads memory and writes a small text file. No
-- breakpoints (build 314 dies on exec BPs), no savestates, no screenshots, and no
-- writes into the game unless you turn SUPPRESS on.
--
-- HOW TO RUN
--   1. Load setup-portable.lua.
--   2. Load the Central Park savestate BY HAND (GUI hotkey). This script must not do
--      it — PCSX.loadSaveState() from a Vsync callback destabilizes the process.
--      Be standing in the field with no textbox open.
--   3. Load this file. It prints "encounter trace armed".
--   4. Either walk yourself, or set AUTOWALK = true below and it will hold a
--      direction for you, reversing every WALK_LEG frames so you stay on the map.
--   5. It stops itself after MAX_FRAMES or MAX_LINES, whichever comes first, and
--      prints "encounter trace done". The file is rewritten as it goes, so quitting
--      early still leaves a usable trace.
--
-- OUTPUT  C:/dw3-rig/dumps/encounter_trace.txt
--   '#' header lines, then one line per change:  frame <n>  counter <v>  delta <d>
--   delta < 0 is a drain (that is the zone's rate); delta > 0 is a reset (that is a
--   fresh counter sample).

local OUT        = "C:/dw3-rig/dumps/encounter_trace.txt"
local COUNTER    = 0x80048d64          -- the step counter itself
local SWITCH     = 0x80042b1c          -- launch master switch (read only unless SUPPRESS)
local RATE_TABLE = 0x8009b6ac          -- six words: 2000,3,4,6,9,18
local ZONE_GATE  = 0x8009b6c4 + 0x10   -- the driver's module gate
local SCENE_ZONE = 0x80099da0          -- scene+0x20 -> zone-pointer array

local MAX_FRAMES  = 10800   -- 3 minutes, then stop
local MAX_LINES   = 3000    -- hard cap on the log, per the trace-size rule
local FLUSH_EVERY = 600     -- rewrite the file every 10 seconds

-- Both switches can be set from an RPC call before loading this file, e.g.
--   ET_AUTOWALK = true; dofile("C:/dw3-rig/encounter-counter-trace.lua")
local AUTOWALK  = (ET_AUTOWALK == true)   -- drive the D-pad instead of walking by hand
local WALK_LEG  = 240       -- frames per leg before reversing direction
local SUPPRESS  = (ET_SUPPRESS == true)
                            -- true = zero the master switch so no battle launches.
                            -- The counter still drains and resets; only the launch
                            -- stops. This IS a write into the running game, so leave
                            -- it false unless battles ruin the walk.

if ET_LISTENER then ET_LISTENER:remove(); ET_LISTENER = nil end

local lines, frame, last, dropped = {}, 0, rd32(COUNTER), 0

lines[#lines+1] = "# encounter step-counter trace"
lines[#lines+1] = string.format("# counter 0x%08x  start %d", COUNTER, last)
lines[#lines+1] = string.format("# zone gate [0x%08x] = 0x%08x", ZONE_GATE, rd32(ZONE_GATE))
lines[#lines+1] = string.format("# master switch [0x%08x] = %d", SWITCH, rd32(SWITCH))
do
  local r = {}
  for i = 0, 5 do r[#r+1] = tostring(rd32(RATE_TABLE + i * 4)) end
  lines[#lines+1] = "# rate table = " .. table.concat(r, ", ")
end
do
  local arr, z = rd32(SCENE_ZONE), {}
  for i = 0, 7 do
    local p = rd32(arr + 0xc + i * 4)
    if p >= 0x80000000 and p < 0x80200000 then
      z[#z+1] = string.format("zone%d=lvl%d", i + 1, rd32(p))
    else
      break
    end
  end
  lines[#lines+1] = string.format("# zone array 0x%08x  %s", arr, table.concat(z, " "))
end
lines[#lines+1] = string.format("# autowalk=%s suppress=%s", tostring(AUTOWALK), tostring(SUPPRESS))
lines[#lines+1] = "# frame  counter  delta   (delta<0 = one driver run at that zone's rate)"

local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  if dropped > 0 then
    f:write("# " .. dropped .. " further changes not logged (line cap)\n")
  end
  f:close()
end

if SUPPRESS then
  wr32(SWITCH, 0)
  lines[#lines+1] = "# NOTE master switch zeroed by this script - launches suppressed"
end

local WALK = { BTN.LEFT, BTN.RIGHT }

ET_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  local ok, err = pcall(function()
    frame = frame + 1

    -- Keep the pad queue topped up so movement is continuous, not stuttered.
    if AUTOWALK and #PRESSQ == 0 then
      press(WALK[(math.floor(frame / WALK_LEG) % 2) + 1], 30)
    end

    local now = rd32(COUNTER)
    if now ~= last then
      if #lines < MAX_LINES then
        lines[#lines+1] = string.format("%6d %8d %6d", frame, now, now - last)
      else
        dropped = dropped + 1
      end
      last = now
    end

    if frame % FLUSH_EVERY == 0 then flush() end
    if frame >= MAX_FRAMES or dropped > 0 then
      flush()
      ET_LISTENER:remove(); ET_LISTENER = nil
      print("encounter trace done -> " .. OUT)
    end
  end)
  if not ok then
    print("encounter trace err: " .. tostring(err))
    if ET_LISTENER then ET_LISTENER:remove(); ET_LISTENER = nil end
  end
end)

flush()
print("encounter trace armed -> " .. OUT)
