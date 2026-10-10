-- SAFE bounded capture of the field->battle loading wipe (A28 checkerboard
-- F0x80089F7C + the A27 tile block F0x80086060 if it participates).
--
-- SAFETY CONTRACT:
--   * Every hook registered BY NAME, scope "System Bus", full 0x800... address,
--     self-unregisters at a hard low cap. Nothing left armed.
--   * 0x8008AA10 is per-frame HOT and is NEVER armed.
--   * The state is loaded by the CALLER (a plain RPC call), NOT from this file:
--     savestate.load inside a dofile'd script cost the rig ~11 fps.
--   * Force the encounter by expiring the step counter; the game's own selector
--     launches the battle, so no hand-filled parameter block (no freeze risk).
--
-- Arm:  tools/windows-rig/bizhawk-rpc tools/windows-rig/wipe-a28-cap.lua   (after loading a field)
-- Read: tools/windows-rig/bizhawk-rpc "WAC.dump()"
-- Stop: tools/windows-rig/bizhawk-rpc "WAC.stop()"

local NAMES = { "wac_chk", "wac_tile", "wac_drive" }
pcall(function()
  for _, n in ipairs(NAMES) do event.unregisterbyname(n) end
end)

WAC = { log = {}, grid = {}, time = {}, count = { 0, 0 }, shots = 0,
        start_frame = emu.framecount(), start_scene = getSceneID() }

local function r8(a)  return memory.read_u8(bit.band(a, 0x1fffff), "MainRAM") end
local function r32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end
local function valid(p) return p ~= nil and p >= 0x80000000 and p < 0x80200000 end

local CAPS = { 96, 72 }   -- checker (cold: only during the wipe), tile (6/frame)

local function mk(name, pc, idx, fmt)
  local cap = CAPS[idx]
  local function cb()
    if WAC.count[idx] >= cap then
      pcall(function() event.unregisterbyname(name) end); return
    end
    local ok, r = pcall(emu.getregisters)
    if not ok or type(r) ~= "table" then return end
    WAC.count[idx] = WAC.count[idx] + 1
    WAC.log[#WAC.log + 1] = fmt(r, WAC.count[idx])
    if WAC.count[idx] >= cap then
      pcall(function() event.unregisterbyname(name) end)
    end
  end
  event.onmemoryexecute(cb, pc, name, "System Bus")
end

mk("wac_chk", 0x80089F7C, 1, function(r, n)
  local a0 = bit.band(r.a0 or 0, 0xffffffff)
  local s = string.format(
    "CHK  n=%d f=%d a0=%08x a1=%08x st=%d hold=%d sched=%d count=%d g9f0=%d g9f8=%d g978=%d",
    n, emu.framecount(), a0, bit.band(r.a1 or 0, 0xffffffff),
    valid(a0) and r32(a0 + 0x10) or -1,
    valid(a0) and r32(a0 + 0x14) or -1,
    valid(a0) and r32(a0 + 0x18) or -1,
    valid(a0) and r32(a0 + 0x20) or -1,
    r32(0x8009b9f0), r32(0x8009b9f8), r32(0x8009b978))
  local bytes = {}
  for i = 0, 0x180 - 1 do bytes[#bytes + 1] = string.format("%02x", r8(0x8009b900 + i)) end
  WAC.grid[#WAC.grid + 1] = string.format("GRID n=%d f=%d %s", n, emu.framecount(),
    table.concat(bytes, " "))
  return s
end)

mk("wac_tile", 0x80086060, 2, function(r, n)
  local a3 = bit.band(r.a3 or 0, 0xffffffff)
  return string.format("TILE n=%d f=%d x=%04x y=%04x level=%08x hi=%02x",
    n, emu.framecount(), bit.band(r.a1 or 0, 0xffff), bit.band(r.a2 or 0, 0xffff),
    a3, bit.band(a3 >> 8, 0xff))
end)

local n = 0
local DIRS = { BTN.UP, BTN.RIGHT, BTN.DOWN, BTN.LEFT }
local last_scene = nil
local changed_at, changed_scene
event.onframeend(function()
  n = n + 1
  local sc = getSceneID()
  if sc ~= last_scene then
    last_scene = sc
    WAC.time[#WAC.time + 1] = string.format("SCENE n=%d f=%d -> %08x", n, emu.framecount(), sc)
    if WAC.start_scene and sc ~= WAC.start_scene then changed_at = n; changed_scene = sc end
  end
  local stop = (n > 420) or (changed_at and n > changed_at + 150)
  if stop then
    pcall(function() event.unregisterbyname("wac_drive") end)
    WAC.done = true; WAC.stop_n = n; return
  end
  if n >= 10 and n <= 110 then
    joypad.set({ [DIRS[(math.floor(n / 80) % 4) + 1]] = true }, 1)
  end
  if n == 30 then
    WAC.pre_counter = r32(0x80048d64)
    wr32(0x80048d64, 0)
    WAC.force_n = n; WAC.force_f = emu.framecount()
    WAC.enc_gate = r32(0x8009b6c4 + 0x10)
    WAC.launch = r32(0x80042b1c)
  end
end, "wac_drive")

function WAC.dump()
  print(string.format("WAC start_scene=%08x start_frame=%d force_f=%s done=%s stop_n=%s",
    WAC.start_scene, WAC.start_frame, tostring(WAC.force_f), tostring(WAC.done),
    tostring(WAC.stop_n)))
  print(string.format("COUNTS chk=%d tile=%d", WAC.count[1], WAC.count[2]))
  print(string.format("FORCE pre_counter=%s gate=%s launch=%s now_scene=%08x",
    tostring(WAC.pre_counter), tostring(WAC.enc_gate), tostring(WAC.launch), getSceneID()))
  for i = 1, #WAC.time do print(WAC.time[i]) end
  for i = 1, #WAC.log do print(WAC.log[i]) end
  for i = 1, #WAC.grid do print(WAC.grid[i]) end
end

function WAC.stop()
  for _, x in ipairs(NAMES) do pcall(function() event.unregisterbyname(x) end) end
  print("WAC stopped")
end

print(string.format("WAC armed start_scene=%08x f=%d", WAC.start_scene, WAC.start_frame))
