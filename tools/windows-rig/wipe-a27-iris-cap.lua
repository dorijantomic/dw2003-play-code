-- A27 iris (F0x8008A5E4) on an ORDINARY STAGE CHANGE. ONE execute hook only
-- (measured: each extra execute-breakpoint registration costs this core ~6 fps,
-- so 3 hooks drops the field to ~37 fps; one hook holds ~50 fps).
-- NO onframeend driver (driver + execute hooks -> ~0.3 fps, measured 2026-10-06).
--
-- Trigger: tools/windows-rig/bizhawk-rpc 'wr32(0x8004B3FC, 0x2d7); wr32(0x8004B404, 0)'
-- Read:    tools/windows-rig/bizhawk-rpc "WA3.dump()"
-- Stop:    tools/windows-rig/bizhawk-rpc "WA3.stop()"

local NAMES = { "wa3_iris" }
pcall(function() for _, n in ipairs(NAMES) do event.unregisterbyname(n) end end)

WA3 = { log = {}, scenes = {}, count = 0, cap = 200,
        start_frame = emu.framecount(), start_scene = getSceneID() }
local last_scene = WA3.start_scene
local function r32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end

local function cb()
  if WA3.count >= WA3.cap then
    pcall(function() event.unregisterbyname("wa3_iris") end); return
  end
  local ok, r = pcall(emu.getregisters)
  if not ok or type(r) ~= "table" then return end
  WA3.count = WA3.count + 1
  local a0 = bit.band(r.a0 or 0, 0xffffffff)
  local valid = a0 >= 0x80000000 and a0 < 0x80200000
  WA3.log[#WA3.log + 1] = string.format(
    "IRIS n=%d f=%d a0=%08x a1=%08x st=%d lvl=%d w=%d h=%d rc=%d ctr=%d",
    WA3.count, emu.framecount(), a0, bit.band(r.a1 or 0, 0xffffffff),
    valid and r32(a0 + 0x10) or -1, valid and r32(a0 + 0x50) or -1,
    valid and r32(a0 + 0x54) or -1, valid and r32(a0 + 0x58) or -1,
    valid and r32(a0 + 0x14) or -1, valid and r32(a0 + 0x6C) or -1)
  local sc = getSceneID()
  if sc ~= last_scene then
    last_scene = sc
    WA3.scenes[#WA3.scenes + 1] = string.format("SCENE n=%d f=%d -> %08x", WA3.count, emu.framecount(), sc)
  end
  if WA3.count >= WA3.cap then pcall(function() event.unregisterbyname("wa3_iris") end) end
end
event.onmemoryexecute(cb, 0x8008A5E4, "wa3_iris", "System Bus")

function WA3.dump()
  print(string.format("WA3 start_scene=%08x start_frame=%d now_scene=%08x count=%d/%d",
    WA3.start_scene, WA3.start_frame, getSceneID(), WA3.count, WA3.cap))
  for i = 1, #WA3.scenes do print(WA3.scenes[i]) end
  for i = 1, #WA3.log do print(WA3.log[i]) end
end
function WA3.stop()
  for _, x in ipairs(NAMES) do pcall(function() event.unregisterbyname(x) end) end
  print("WA3 stopped")
end
print(string.format("WA3 armed start_scene=%08x f=%d vantage_scene5c=%d launcher=%08x",
  WA3.start_scene, WA3.start_frame, r32(0x80099D80 + 0x5C), r32(0x8004B3FC)))
