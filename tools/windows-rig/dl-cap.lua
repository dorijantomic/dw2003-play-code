-- Single-shot display-list capture for FIGHTSTG_F0x80085110 (the unported
-- display-list interpreter, fightstg.s:2381). Bounded: logs at most MAX hits
-- then unregisters itself inside the callback, so a hot per-model address is
-- never left armed. Scope "System Bus" with the full 0x800 address is the
-- only convention that fires on this build (apply the 2026-10-05 lesson).
--
-- Arm:   tools/windows-rig/bizhawk-rpc tools/windows-rig/dl-cap.lua
-- Read:  tools/windows-rig/bizhawk-rpc "DL.dump()"
-- Stop:  tools/windows-rig/bizhawk-rpc "DL.stop()"

pcall(function() event.unregisterbyname("dl_cap") end)
DL = { hits = {}, start = nil, armed = false, done = false }
DL.start = emu.framecount()
local MAX = 10
local n = 0

local function r32(a)
  return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM")
end

local function on_hit()
  if n >= MAX then return end
  local ok, r = pcall(emu.getregisters)
  if not ok or type(r) ~= "table" then return end
  n = n + 1
  local a0 = bit.band(r.a0 or 0, 0xffffffff)
  local a1 = bit.band(r.a1 or 0, 0xffffffff)
  local ra = bit.band(r.ra or 0, 0xffffffff)
  local p68 = r32(a0 + 0x68)
  local p70 = r32(a0 + 0x70)
  local p78 = r32(a0 + 0x78)
  local p54 = r32(a0 + 0x54)
  DL.hits[n] = string.format(
    "hit=%d f=%d a0=%08x a1=%08x ra=%08x node54=%08x node68=%08x node70=%08x node78=%08x",
    n, emu.framecount(), a0, a1, ra, p54, p68, p70, p78)
  if n >= MAX then
    pcall(function() event.unregisterbyname("dl_cap") end)
    DL.done = true
  end
end

event.onmemoryexecute(on_hit, 0x80085110, "dl_cap", "System Bus")
DL.armed = true
print("DL cap armed at 0x80085110 frame=" .. tostring(DL.start))

function DL.dump()
  print(string.format("DL entries=%d armed=%s done=%s", #DL.hits, tostring(DL.armed), tostring(DL.done)))
  for i = 1, #DL.hits do print(DL.hits[i]) end
end

function DL.stop()
  pcall(function() event.unregisterbyname("dl_cap") end)
  DL.armed = false
  print("DL stopped entries=" .. #DL.hits)
end
