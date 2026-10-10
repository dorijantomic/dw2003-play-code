-- Lean, hook-only checkerboard capture (NO onframeend driver: an onframeend
-- driver combined with memory-execute hooks drops this BizHawk core to ~0.3 fps,
-- measured 2026-10-06). Drive the walk/force from RPC calls (press / wr32) instead.
--
-- Arm:  tools/windows-rig/bizhawk-rpc tools/windows-rig/wipe-a28-hook.lua
-- Walk: tools/windows-rig/bizhawk-rpc 'press(BTN.RIGHT, 240)'
-- Force:tools/windows-rig/bizhawk-rpc 'wr32(0x80048d64, 0)'
-- Read: tools/windows-rig/bizhawk-rpc "WA2.dump()"
-- Stop: tools/windows-rig/bizhawk-rpc "WA2.stop()"

local NAMES = { "wa2_chk", "wa2_iris" }
pcall(function() for _, n in ipairs(NAMES) do event.unregisterbyname(n) end end)

WA2 = { log = {}, grid = {}, count = { 0, 0 }, start_frame = emu.framecount() }
local function r8(a)  return memory.read_u8(bit.band(a, 0x1fffff), "MainRAM") end
local function r32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end
local function valid(p) return p ~= nil and p >= 0x80000000 and p < 0x80200000 end
local CAPS = { 120, 48 }

local function mk(name, pc, idx, fmt)
  local cap = CAPS[idx]
  local function cb()
    if WA2.count[idx] >= cap then pcall(function() event.unregisterbyname(name) end); return end
    local ok, r = pcall(emu.getregisters)
    if not ok or type(r) ~= "table" then return end
    WA2.count[idx] = WA2.count[idx] + 1
    WA2.log[#WA2.log + 1] = fmt(r, WA2.count[idx])
    if WA2.count[idx] >= cap then pcall(function() event.unregisterbyname(name) end) end
  end
  event.onmemoryexecute(cb, pc, name, "System Bus")
end

mk("wa2_chk", 0x80089F7C, 1, function(r, n)
  local a0 = bit.band(r.a0 or 0, 0xffffffff)
  local s = string.format("CHK  n=%d f=%d a0=%08x st=%d hold=%d sched=%d count=%d g9f0=%d",
    n, emu.framecount(), a0, valid(a0) and r32(a0 + 0x10) or -1,
    valid(a0) and r32(a0 + 0x14) or -1, valid(a0) and r32(a0 + 0x18) or -1,
    valid(a0) and r32(a0 + 0x20) or -1, r32(0x8009b9f0))
  local bytes = {}
  for i = 0, 0xF0 - 1 do bytes[#bytes + 1] = string.format("%02x", r8(0x8009b900 + i)) end
  WA2.grid[#WA2.grid + 1] = string.format("GRID n=%d f=%d %s", n, emu.framecount(),
    table.concat(bytes, " "))
  return s
end)

mk("wa2_iris", 0x8008A5E4, 2, function(r, n)
  local a0 = bit.band(r.a0 or 0, 0xffffffff)
  return string.format("IRIS n=%d f=%d a0=%08x st=%d u14=%d", n, emu.framecount(), a0,
    valid(a0) and r32(a0 + 0x10) or -1, valid(a0) and r32(a0 + 0x14) or -1)
end)

function WA2.dump()
  print(string.format("WA2 start_frame=%d counts chk=%d iris=%d scene=%08x",
    WA2.start_frame, WA2.count[1], WA2.count[2], getSceneID()))
  for i = 1, #WA2.log do print(WA2.log[i]) end
  for i = 1, #WA2.grid do print(WA2.grid[i]) end
end
function WA2.stop()
  for _, x in ipairs(NAMES) do pcall(function() event.unregisterbyname(x) end) end
  print("WA2 stopped")
end
print("WA2 armed frame=" .. tostring(WA2.start_frame))
