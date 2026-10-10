-- tunnel-release.lua : restore the operator's named moment and hand control back
local RIG = "C:/bizhawk-rig"
dofile(RIG .. "/bizhawk-agent-interface.lua")
-- stop any walk listener still resident
pcall(function() event.unregisterbyname("tunnel_cap") end)
releaseAll()
loadstate("operator-restore-tunnel-2026-10-07")
releaseAll()
rig_control("human")
print(string.format("TUNNEL_RELEASED scene=%08x frame=%d control=%s", rd32(0x80055d2c), emu.framecount(), rig_control()))
