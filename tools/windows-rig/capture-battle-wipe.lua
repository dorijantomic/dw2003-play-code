-- Frame-level capture of the field -> battle loading wipe (the checkerboard).
--
-- Load a free-roam field GUI state, then dofile this. It dismisses any dialogue,
-- walks, and forces the next encounter roll to fire by zeroing the step counter
-- (`0x80048d64`, encounter-step-counter-decoded-2026-07-25) while the battle
-- launch switch (`0x80042b1c`) is on. Screenshots every frame so the
-- field->battle wipe (fieldstg F0x80089F7C, the 5x6 64x40 checkerboard) is
-- captured. Results: DW3_RIG_ROOT/shots/bw_fNNN.raw; writes rpc/battle-wipe.done.
--
-- Usage: tools/windows-rig/rpc-windows.sh tools/windows-rig/capture-battle-wipe.lua
-- (setup-portable.lua must have been loaded first.)

BW_N = 0
BW_DONE = false

local function finish()
  BW_DONE = true
  local f = io.open(DW3_RIG_ROOT .. "/rpc/battle-wipe.done", "w")
  f:write("1"); f:close()
end

BW_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if BW_DONE then return end
  BW_N = BW_N + 1
  local ok, err = pcall(function()
    if BW_N == 4 then press(BTN.X, 6) end          -- close the dialogue
    if BW_N == 40 then press(BTN.DOWN, 240) end     -- walk, to step the counter
    if BW_N == 60 then
      wr32(0x80048d64, 1)
      wr32(0x80042b1c, 1)
    end
    if BW_N >= 50 and BW_N <= 360 and (BW_N % 2 == 0) then
      shot(string.format("bw_f%03d", BW_N))
    end
    if BW_N > 360 then finish() end
  end)
  if not ok then
    print("BATTLE WIPE ERR " .. tostring(err))
    finish()
  end
end)

print("battle-wipe capture armed")
