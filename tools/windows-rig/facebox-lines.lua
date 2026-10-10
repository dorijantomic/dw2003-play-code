-- Face box on ordinary battle lines, with NO skip press during any line.
-- Loads the round-1 menu state, presses Cross twice (choose Fight), then never
-- touches the pad again. Screenshot every 20 frames for 1200 frames.
pcall(function() event.unregisterbyname("fbl") end)
savestate.load("C:/bizhawk-rig/states/loss-start-2026-10-03.State")
local n, k = 0, 0
local log = io.open("C:/bizhawk-rig/dumps/fbl/fbl.txt", "w")
event.onframeend(function()
  n = n + 1
  if (n >= 30 and n < 40) or (n >= 90 and n < 100) then joypad.set({ ["P1 Cross"] = true }) end
  if n % 20 == 0 then
    k = k + 1
    client.screenshot(string.format("C:/bizhawk-rig/dumps/fbl/%04d.png", n))
    log:write(string.format("n=%d fc=%d screen=%x\n", n, emu.framecount(), memory.read_u32_le(0x4b3f8, "MainRAM")))
    log:flush()
  end
  if n >= 1200 then log:close(); event.unregisterbyname("fbl") end
end, "fbl")
print("fbl armed")
