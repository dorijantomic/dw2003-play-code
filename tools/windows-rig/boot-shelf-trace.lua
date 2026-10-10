-- Boot script for the Asuka Inn shelf search-point trace.
--
-- Passed to pcsx-redux via `-dofile`, so every statement here runs in the MAIN Lua
-- context at startup -- NOT inside a GPU::Vsync callback. That distinction matters:
-- PCSX.loadSaveState() from a Vsync callback destabilizes build 314 (this is the
-- documented reason encounter-counter-trace.lua refuses to load its own state).
-- Loading it here is the scripted equivalent of loading it by hand.
--
-- Order: helpers -> bridge (so RPC still answers) -> savestate 9 -> arm the trace.
-- The trace itself only presses X and diffs two bounded memory windows; it stops
-- itself and writes C:/dw3-rig/dumps/shelf_search_trace.txt.

local ROOT = "C:/dw3-rig"

dofile(ROOT .. "/setup-portable.lua")
dofile(ROOT .. "/bridge-portable.lua")

-- Load the GUI-hotkey state (AppData copy staged into states/ as slot 9).
-- zReader is the form the rig doc says works for GUI slot states.
local ok, err = pcall(function() loadstate(9) end)
print("boot: loadstate(9) ok=" .. tostring(ok) .. " err=" .. tostring(err))

-- Loading a savestate leaves build 314 PAUSED, and a paused emu emits no GPU::Vsync,
-- so the trace listener never ticks (verified: header written, zero presses, and the
-- RPC bridge silent even at a 70s timeout). A single resumeEmulator() right after
-- loadstate is not enough -- the load appears to settle afterwards and re-pause.
--
-- PCSX.nextTick IS serviced while paused (it is how bridge-portable.lua polls), so
-- drive resume from a nextTick chain that keeps retrying until frames actually start
-- advancing. RESUME_TICKS is the give-up bound so this can never spin forever.
RESUME_TICKS = 0
local function kick()
  RESUME_TICKS = RESUME_TICKS + 1
  pcall(PCSX.resumeEmulator)
  if RESUME_TICKS < 600 then PCSX.nextTick(kick) end
end
pcall(kick)
print("boot: resume kicker armed")

-- Give the machine a moment of real emulation before the trace starts pressing X.
-- The trace's own initial timer handles this (it waits before the first press).
local ok2, err2 = pcall(function() dofile(ROOT .. "/shelf-search-trace.lua") end)
print("boot: trace armed ok=" .. tostring(ok2) .. " err=" .. tostring(err2))
