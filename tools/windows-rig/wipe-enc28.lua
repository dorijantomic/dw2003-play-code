-- Force a field -> battle transition and capture the A28 checkerboard + any A27
-- iris. Only NON-HOT addresses are hooked (see note): 0x8008AA10 fires every
-- field frame and MUST NOT be armed. Each hook is bounded and self-unregisters.
--
-- Arm:  tools/windows-rig/bizhawk-rpc tools/windows-rig/wipe-enc28.lua
-- Read: tools/windows-rig/bizhawk-rpc "E28.dump()"
-- Stop: tools/windows-rig/bizhawk-rpc "E28.stop()"

local NAMES = { "e28_iris", "e28_check", "e28_pkt", "e28_drive", "e28_shot" }
pcall(function()
  for _, n in ipairs(NAMES) do event.unregisterbyname(n) end
end)

savestate.load("C:/bizhawk-rig/states/auto-gym-2026-09-10-start.State")

E28 = { log = {}, pkt = {}, count = {}, shots = 0, start_scene = getSceneID(), start_frame = emu.framecount() }
for i = 1, 4 do E28.count[i] = 0 end

local function r32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end
local function r8(a) return memory.read_u8(bit.band(a, 0x1fffff), "MainRAM") end

-- A27 iris state machine: idle on an ordinary field (verified 0 hits on this
-- fixture), so safe to arm.
local iris_cap = 80
local function iris_cb()
  if E28.count[1] >= iris_cap then
    pcall(function() event.unregisterbyname("e28_iris") end); return
  end
  local ok, r = pcall(emu.getregisters)
  if not ok or type(r) ~= "table" then return end
  E28.count[1] = E28.count[1] + 1
  local a0 = bit.band(r.a0 or 0, 0xffffffff)
  E28.log[#E28.log + 1] = string.format(
    "IRIS  n=%d f=%d a0=%08x st=%d lvl=%d w=%d h=%d open=%d centred=%d",
    E28.count[1], emu.framecount(), a0, r32(a0 + 0x10), r32(a0 + 0x50),
    r32(a0 + 0x54), r32(a0 + 0x58), r32(a0 + 0x14), r32(a0 + 0x6C))
  if E28.count[1] >= iris_cap then pcall(function() event.unregisterbyname("e28_iris") end) end
end
event.onmemoryexecute(iris_cb, 0x8008A5E4, "e28_iris", "System Bus")

-- A28 checkerboard.
local check_cap = 80
local function check_cb()
  if E28.count[2] >= check_cap then
    pcall(function() event.unregisterbyname("e28_check") end); return
  end
  local ok, r = pcall(emu.getregisters)
  if not ok or type(r) ~= "table" then return end
  E28.count[2] = E28.count[2] + 1
  local a0 = bit.band(r.a0 or 0, 0xffffffff)
  E28.log[#E28.log + 1] = string.format(
    "CHECK n=%d f=%d a0=%08x a1=%08x st=%d unk14=%d unk18=%d",
    E28.count[2], emu.framecount(), a0, bit.band(r.a1 or 0, 0xffffffff),
    r32(a0 + 0x10), r32(a0 + 0x14), r32(a0 + 0x18))
  if E28.count[2] >= check_cap then pcall(function() event.unregisterbyname("e28_check") end) end
end
event.onmemoryexecute(check_cb, 0x80089F7C, "e28_check", "System Bus")

-- The checkerboard packet buffer ($a3 <- $v0 at 0x8008A3A4). Dump header + 30 tiles.
local pkt_cap = 3
local function pkt_cb()
  if E28.count[3] >= pkt_cap then
    pcall(function() event.unregisterbyname("e28_pkt") end); return
  end
  local ok, r = pcall(emu.getregisters)
  if not ok or type(r) ~= "table" then return end
  E28.count[3] = E28.count[3] + 1
  local v0 = bit.band(r.v0 or 0, 0xffffffff)
  local bytes = {}
  if v0 >= 0x80000000 and v0 < 0x80200000 then
    for i = 0, 0x20 + 30 * 0x28 - 1 do bytes[#bytes + 1] = string.format("%02x", r8(v0 + i)) end
  end
  E28.pkt[#E28.pkt + 1] = string.format("PKT n=%d f=%d a3=%08x %s", E28.count[3], emu.framecount(), v0, table.concat(bytes, " "))
  if E28.count[3] >= pkt_cap then pcall(function() event.unregisterbyname("e28_pkt") end) end
end
event.onmemoryexecute(pkt_cb, 0x8008A3A4, "e28_pkt", "System Bus")

local n = 0
local DIRS = { BTN.UP, BTN.RIGHT, BTN.DOWN, BTN.LEFT }
event.onframeend(function()
  n = n + 1
  local sc = getSceneID()
  if not E28.changed and sc ~= E28.start_scene and sc ~= 0xffffffff then
    E28.changed = sc; E28.changed_frame = emu.framecount(); E28.change_n = n
  end
  if n > 1500 or (E28.changed and n > E28.change_n + 200) then
    pcall(function() event.unregisterbyname("e28_drive") end)
    E28.done = true
    return
  end
  if n == 30 then wr32(0x80048d64, 1); E28.forced = emu.framecount() end
  joypad.set({ [DIRS[(math.floor(n / 140) % 4) + 1]] = true }, 1)
end, "e28_drive")

function E28.dump()
  print(string.format("E28 start_scene=%08x f=%d changed=%s cf=%s forced=%s iris=%d check=%d pkt=%d",
    E28.start_scene, E28.start_frame, tostring(E28.changed), tostring(E28.changed_frame),
    tostring(E28.forced), E28.count[1], E28.count[2], E28.count[3]))
  for j = 1, #E28.log do print(E28.log[j]) end
  for j = 1, #E28.pkt do print(E28.pkt[j]) end
end
function E28.stop()
  for _, x in ipairs(NAMES) do pcall(function() event.unregisterbyname(x) end) end
  print("E28 stopped")
end
print(string.format("E28 armed start_scene=%08x f=%d", E28.start_scene, E28.start_frame))
