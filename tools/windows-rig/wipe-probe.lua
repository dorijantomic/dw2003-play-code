-- Diagnostic: which transition routine actually runs on a stage change?
-- Arms bounded hooks on every candidate (A27 iris state machine, A28 checkerboard,
-- the phase-2 dispatch, the stage-change driver, the screen walk, the tile block)
-- and screenshots frames during the transition. Each hook is bounded and
-- self-unregisters. System Bus + full 0x800 address.
--
-- Arm:  tools/windows-rig/bizhawk-rpc tools/windows-rig/wipe-probe.lua
-- Read: tools/windows-rig/bizhawk-rpc "WP.dump()"
-- Stop: tools/windows-rig/bizhawk-rpc "WP.stop()"

WP = { log = {}, count = {}, shots = 0, armed_at = emu.framecount() }

local HOOKS = {
  { name = "wp_iris",  pc = 0x8008A5E4, tag = "IRIS  0x8008A5E4 A27-state" },
  { name = "wp_check", pc = 0x80089F7C, tag = "CHECK 0x80089F7C A28-checker" },
  { name = "wp_disp",  pc = 0x8008AA10, tag = "DISP  0x8008AA10 phase2" },
  { name = "wp_drv",   pc = 0x8008B6D4, tag = "DRV   0x8008B6D4 stagechange" },
  { name = "wp_walk",  pc = 0x80086CE4, tag = "WALK  0x80086CE4 screenwalk" },
  { name = "wp_tile",  pc = 0x80086060, tag = "TILE  0x80086060 tileblock" },
}
local CAP = 40

local function r32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end
for _, h in ipairs(HOOKS) do
  pcall(function() event.unregisterbyname(h.name) end)
end
pcall(function() event.unregisterbyname("wp_shot") end)
for i = 1, #HOOKS do WP.count[i] = 0 end

for i, h in ipairs(HOOKS) do
  local idx = i
  local function cb()
    if WP.count[idx] >= CAP then
      pcall(function() event.unregisterbyname(HOOKS[idx].name) end)
      return
    end
    local ok, r = pcall(emu.getregisters)
    if not ok or type(r) ~= "table" then return end
    WP.count[idx] = WP.count[idx] + 1
    local a0 = bit.band(r.a0 or 0, 0xffffffff)
    WP.log[#WP.log + 1] = string.format(
      "%s n=%d f=%d a0=%08x a1=%08x a2=%08x a3=%08x ra=%08x",
      h.tag, WP.count[idx], emu.framecount(), a0,
      bit.band(r.a1 or 0, 0xffffffff), bit.band(r.a2 or 0, 0xffffffff),
      bit.band(r.a3 or 0, 0xffffffff), bit.band(r.ra or 0, 0xffffffff))
    if WP.count[idx] >= CAP then
      pcall(function() event.unregisterbyname(HOOKS[idx].name) end)
    end
  end
  EVENT = event.onmemoryexecute(cb, h.pc, h.name, "System Bus")
  print(string.format("armed %s at %08x", h.name, h.pc))
end

local shotN = 0
event.onframeend(function()
  if shotN >= 90 then
    pcall(function() event.unregisterbyname("wp_shot") end)
    WP.shots_done = true
    return
  end
  shotN = shotN + 1
  if shotN % 2 == 0 then
    pcall(function() client.screenshot("C:/bizhawk-rig/shots/wp_" .. string.format("%03d", shotN) .. ".png") end)
    WP.shots = WP.shots + 1
  end
end, "wp_shot")

function WP.dump()
  print(string.format("WP armed_at=%d shots=%d", WP.armed_at, WP.shots))
  local parts = {}
  for i = 1, #HOOKS do parts[#parts + 1] = HOOKS[i].name .. "=" .. WP.count[i] end
  print("COUNTS " .. table.concat(parts, " "))
  for j = 1, #WP.log do print(WP.log[j]) end
end

function WP.stop()
  for _, h in ipairs(HOOKS) do pcall(function() event.unregisterbyname(h.name) end) end
  pcall(function() event.unregisterbyname("wp_shot") end)
  print("WP stopped")
end

print("WP armed frame=" .. tostring(WP.armed_at))
