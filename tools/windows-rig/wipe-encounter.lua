-- Force a field -> battle transition and capture the A28 checkerboard wipe, plus
-- any A27 iris that runs. Bounded hooks, no per-frame screenshots (those throttle
-- BizHawk to ~3 fps). Each hook self-unregisters at its cap.
--
-- Arm:  tools/windows-rig/bizhawk-rpc tools/windows-rig/wipe-encounter.lua
-- Read: tools/windows-rig/bizhawk-rpc "WE.dump()"
-- Stop: tools/windows-rig/bizhawk-rpc "WE.stop()"

local NAMES = { "we_iris", "we_check", "we_walk", "we_tile", "we_pkt", "we_drive" }
pcall(function()
  for _, n in ipairs(NAMES) do event.unregisterbyname(n) end
end)

savestate.load("C:/bizhawk-rig/states/auto-gym-2026-09-10-start.State")

WE = { log = {}, pkt = {}, count = {}, start_scene = getSceneID(), start_frame = emu.framecount() }

local HOOKS = {
  { name = "we_iris",  pc = 0x8008A5E4, tag = "IRIS  0x8008A5E4 A27-state", cap = 120 },
  { name = "we_check", pc = 0x80089F7C, tag = "CHECK 0x80089F7C A28-checker", cap = 120 },
  { name = "we_walk",  pc = 0x80086CE4, tag = "WALK  0x80086CE4 screenwalk", cap = 140 },
  { name = "we_tile",  pc = 0x80086060, tag = "TILE  0x80086060 tileblock", cap = 240 },
}
local function r32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end
local function r8(a) return memory.read_u8(bit.band(a, 0x1fffff), "MainRAM") end

for i = 1, #HOOKS + 1 do WE.count[i] = 0 end
for i, h in ipairs(HOOKS) do
  local idx = i
  local function cb()
    if WE.count[idx] >= h.cap then
      pcall(function() event.unregisterbyname(h.name) end)
      return
    end
    local ok, r = pcall(emu.getregisters)
    if not ok or type(r) ~= "table" then return end
    WE.count[idx] = WE.count[idx] + 1
    local a0 = bit.band(r.a0 or 0, 0xffffffff)
    WE.log[#WE.log + 1] = string.format(
      "%s n=%d f=%d a0=%08x a1=%08x a2=%08x a3=%08x st=%d lvl=%d w=%d h=%d open=%d",
      h.tag, WE.count[idx], emu.framecount(), a0,
      bit.band(r.a1 or 0, 0xffffffff), bit.band(r.a2 or 0, 0xffffffff),
      bit.band(r.a3 or 0, 0xffffffff),
      r32(a0 + 0x10), r32(a0 + 0x50), r32(a0 + 0x54), r32(a0 + 0x58), r32(a0 + 0x14))
    if WE.count[idx] >= h.cap then
      pcall(function() event.unregisterbyname(h.name) end)
    end
  end
  event.onmemoryexecute(cb, h.pc, h.name, "System Bus")
end

-- The A28 checkerboard packet buffer: at 0x8008A3A4 ($a3 <- $v0) inside F0x80089F7C.
local pcap = 4
local function pcb()
  if WE.count[5] >= pcap then
    pcall(function() event.unregisterbyname("we_pkt") end)
    return
  end
  local ok, r = pcall(emu.getregisters)
  if not ok or type(r) ~= "table" then return end
  WE.count[5] = WE.count[5] + 1
  local v0 = bit.band(r.v0 or 0, 0xffffffff)
  local bytes = {}
  if v0 >= 0x80000000 and v0 < 0x80200000 then
    for i = 0, 0x20 + 30 * 0x28 - 1 do bytes[#bytes + 1] = string.format("%02x", r8(v0 + i)) end
  end
  WE.pkt[#WE.pkt + 1] = string.format("PKT n=%d f=%d a3=%08x %s", WE.count[5], emu.framecount(), v0, table.concat(bytes, " "))
  if WE.count[5] >= pcap then
    pcall(function() event.unregisterbyname("we_pkt") end)
  end
end
event.onmemoryexecute(pcb, 0x8008A3A4, "we_pkt", "System Bus")

-- Walk until the battle screen appears; force one encounter roll.
local n = 0
local DIRS = { BTN.UP, BTN.RIGHT, BTN.DOWN, BTN.LEFT }
event.onframeend(function()
  n = n + 1
  local sc = getSceneID()
  if not WE.changed and sc ~= WE.start_scene and sc ~= 0xffffffff then
    WE.changed = sc; WE.changed_frame = emu.framecount(); WE.change_n = n
  end
  if n > 2600 or (WE.changed and n > WE.change_n + 260) then
    pcall(function() event.unregisterbyname("we_drive") end)
    WE.done = true
    return
  end
  if n == 30 then
    wr32(0x80048d64, 1)
    WE.forced = emu.framecount()
  end
  joypad.set({ [DIRS[(math.floor(n / 140) % 4) + 1]] = true }, 1)
end, "we_drive")

function WE.dump()
  print(string.format("WE start_scene=%08x start_frame=%d changed=%s change_frame=%s forced=%s",
    WE.start_scene, WE.start_frame, tostring(WE.changed), tostring(WE.changed_frame), tostring(WE.forced)))
  local parts = {}
  for i = 1, #HOOKS do parts[#parts + 1] = HOOKS[i].name .. "=" .. WE.count[i] end
  parts[#parts + 1] = "we_pkt=" .. WE.count[5]
  print("COUNTS " .. table.concat(parts, " "))
  for j = 1, #WE.log do print(WE.log[j]) end
  for j = 1, #WE.pkt do print(WE.pkt[j]) end
end

function WE.stop()
  for _, x in ipairs(NAMES) do pcall(function() event.unregisterbyname(x) end) end
  print("WE stopped")
end

print(string.format("WE armed start_scene=%08x f=%d", WE.start_scene, WE.start_frame))
