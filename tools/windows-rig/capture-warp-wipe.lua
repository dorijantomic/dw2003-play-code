-- Frame-level capture of the stage-change wipe.
--
-- Load a field GUI state, then dofile this. It presses Cross once to clear any
-- dialogue, writes a stage-launch request into the launcher slot
-- (0x8004B3FC, the developers' row code — see
-- docs/research/field/rig-stage-anchoring-2026-09-11.md), and screenshots
-- every frame around the change so the wipe (iris / checkerboard) is captured
-- frame by frame. Results: DW3_RIG_ROOT/shots/wipe_fNNN.raw; writes
-- DW3_RIG_ROOT/rpc/wipe.done when finished.
--
-- Usage: tools/windows-rig/rpc-windows.sh tools/windows-rig/capture-warp-wipe.lua
-- (setup-portable.lua must have been loaded first for rd32/wr32/shot/press.)

WIPE_CODE = WIPE_CODE or 0x2d7   -- Kusanagi street corner; a known field
WIPE_N = 0
WIPE_DONE = false

local function finish()
  WIPE_DONE = true
  local f = io.open(DW3_RIG_ROOT .. "/rpc/wipe.done", "w")
  f:write("1"); f:close()
end

WIPE_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if WIPE_DONE then return end
  WIPE_N = WIPE_N + 1
  local ok, err = pcall(function()
    if WIPE_N == 4 then press(BTN.X, 4) end
    if WIPE_N == 40 then
      wr32(0x8004B3FC, WIPE_CODE)
      wr32(0x8004B404, 0)
    end
    if WIPE_N >= 30 and WIPE_N <= 260 then
      shot(string.format("wipe_f%03d", WIPE_N))
    end
    if WIPE_N > 260 then finish() end
  end)
  if not ok then
    print("WIPE ERR " .. tostring(err))
    finish()
  end
end)

print(string.format("wipe capture armed code=%x", WIPE_CODE))
