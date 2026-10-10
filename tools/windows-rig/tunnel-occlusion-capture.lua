-- tunnel-occlusion-capture.lua  (worker-B, Protocol Ruins item 14)
-- Walk the live rig forward into the Protocol Ruins tunnel, logging the field
-- party leader's world x/y every frame and screenshotting every 16, so the
-- frame where the character disappears behind the stonework can be named.
-- One frame-end listener owns input, logging and captures.
local RIG = "C:/bizhawk-rig"
dofile(RIG .. "/bizhawk-agent-interface.lua")

-- 1. preserve the operator's moment in a NAMED state, then take control
savestate_("operator-restore-tunnel-2026-10-07")
rig_control("agent")

-- 2. keep random encounters / the ambush launcher quiet while we walk
wr32(0x8009b6d4, 0)   -- encounter gate
wr32(0x80042b1c, 0)   -- battle launch switch

-- 3. find the field party (leader = slot 0); actor struct: +0 type==5,
--    +8 field slot, +0x58 x, +0x5c y, +0x60 facing
local OBJECTS = 0x8004b610
local function validPtr(p) return p >= 0x80000000 and p < 0x80200000 end
local leader, party = nil, {}
for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  if validPtr(p) and rd32(p) == 5 then
    local slot = rd32(p + 8)
    if slot == 0 or slot == 2 or slot == 4 or slot == 8 then
      party[#party + 1] = { ptr = p, slot = slot }
      if slot == 0 then leader = p end
    end
  end
end

local LOG = RIG .. "/dumps/tunnel_occlusion.log"
local lines = {}
local function emit(s) lines[#lines + 1] = s end
local function flush()
  local f = io.open(LOG, "w")
  if f then f:write(table.concat(lines, "\n") .. "\n"); f:close() end
end

emit(string.format("scene=%08x frame=%d leader=%s nparty=%d",
  rd32(0x80055d2c), emu.framecount(),
  leader and string.format("%08x", leader) or "nil", #party))
if leader then
  emit(string.format("start x=%d y=%d face=%d", rd32(leader + 0x58),
    rd32(leader + 0x5c), rd32(leader + 0x60)))
end

local frame, MAX, CAP_EVERY = 0, 300, 16
pcall(savestatePNG, "tunnel_before")
press(BTN.UP, 280) -- hold Up (walk toward the tunnel)

event.onframeend(function()
  frame = frame + 1
  local x = leader and rd32(leader + 0x58) or -1
  local y = leader and rd32(leader + 0x5c) or -1
  local face = leader and rd32(leader + 0x60) or -1
  emit(string.format("f=%d x=%d y=%d face=%d", frame, x, y, face))
  if frame % CAP_EVERY == 0 then pcall(savestatePNG, string.format("tunnel_f%03d", frame)) end
  if frame >= MAX then
    flush()
    print("TUNNEL_CAP_DONE frames=" .. frame)
  end
end, "tunnel_cap")

flush()
print("TUNNEL_CAP_ARMED leader=" .. tostring(leader) .. " log=" .. LOG)
