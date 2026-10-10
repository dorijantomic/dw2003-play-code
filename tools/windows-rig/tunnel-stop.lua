-- tunnel-stop.lua : stop the walk listener, clear input, report where we are
local RIG = "C:/bizhawk-rig"
dofile(RIG .. "/bizhawk-agent-interface.lua")
if TUNNEL_CAP_LISTENER then pcall(function() TUNNEL_CAP_LISTENER:remove() end) end
pcall(function() event.unregisterbyname("tunnel_cap") end)
releaseAll()
local OBJECTS = 0x8004b610
local function validPtr(p) return p >= 0x80000000 and p < 0x80200000 end
local leader
for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  if validPtr(p) and rd32(p) == 5 and rd32(p + 8) == 0 then leader = p end
end
print(string.format("TUNNEL_STOPPED scene=%08x frame=%d leaderx=%d leadery=%d",
  rd32(0x80055d2c), emu.framecount(),
  leader and rd32(leader + 0x58) or -1, leader and rd32(leader + 0x5c) or -1))
