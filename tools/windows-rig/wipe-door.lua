-- Trigger a REAL door transition (the documented El Dorado approach) and capture
-- the wipe. Loads the parked fixture, arms bounded hooks on every transition
-- routine, then walks UP to the door and confirms twice. Screenshots the
-- transition frames. Every hook is bounded and self-unregisters.
--
-- Arm:  tools/windows-rig/bizhawk-rpc tools/windows-rig/wipe-door.lua
-- Read: tools/windows-rig/bizhawk-rpc "WD.dump()"
-- Stop: tools/windows-rig/bizhawk-rpc "WD.stop()"

local NAMES = { "wdo_iris", "wdo_check", "wdo_disp", "wdo_drv", "wdo_walk", "wdo_tile", "wdo_shot" }
pcall(function()
  for _, n in ipairs(NAMES) do event.unregisterbyname(n) end
end)

savestate.load("C:/bizhawk-rig/states/eldoorkeeper-charisma-2026-09-10-pre.State")

WD = { log = {}, count = {}, shots = 0, start_scene = getSceneID(), start_frame = emu.framecount() }

local HOOKS = {
  { name = "wdo_iris",  pc = 0x8008A5E4, tag = "IRIS  0x8008A5E4 A27-state" },
  { name = "wdo_check", pc = 0x80089F7C, tag = "CHECK 0x80089F7C A28-checker" },
  { name = "wdo_disp",  pc = 0x8008AA10, tag = "DISP  0x8008AA10 phase2" },
  { name = "wdo_drv",   pc = 0x8008B6D4, tag = "DRV   0x8008B6D4 stagechange" },
  { name = "wdo_walk",  pc = 0x80086CE4, tag = "WALK  0x80086CE4 screenwalk" },
  { name = "wdo_tile",  pc = 0x80086060, tag = "TILE  0x80086060 tileblock" },
}
local CAP = 80
local function r32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end

for i = 1, #HOOKS do WD.count[i] = 0 end
for i, h in ipairs(HOOKS) do
  local idx = i
  local function cb()
    if WD.count[idx] >= CAP then
      pcall(function() event.unregisterbyname(HOOKS[idx].name) end)
      return
    end
    local ok, r = pcall(emu.getregisters)
    if not ok or type(r) ~= "table" then return end
    WD.count[idx] = WD.count[idx] + 1
    local a0 = bit.band(r.a0 or 0, 0xffffffff)
    WD.log[#WD.log + 1] = string.format(
      "%s n=%d f=%d a0=%08x a1=%08x a2=%08x a3=%08x ra=%08x st=%d lvl=%d w=%d h=%d",
      h.tag, WD.count[idx], emu.framecount(), a0,
      bit.band(r.a1 or 0, 0xffffffff), bit.band(r.a2 or 0, 0xffffffff),
      bit.band(r.a3 or 0, 0xffffffff), bit.band(r.ra or 0, 0xffffffff),
      r32(a0 + 0x10), r32(a0 + 0x50), r32(a0 + 0x54), r32(a0 + 0x58))
    if WD.count[idx] >= CAP then
      pcall(function() event.unregisterbyname(HOOKS[idx].name) end)
    end
  end
  event.onmemoryexecute(cb, h.pc, h.name, "System Bus")
end

local n = 0
event.onframeend(function()
  n = n + 1
  local sc = getSceneID()
  if not WD.changed and sc ~= WD.start_scene and sc ~= 0xffffffff then
    WD.changed = sc
    WD.changed_frame = emu.framecount()
    WD.change_n = n
  end
  if n > 900 or (WD.changed and n > WD.change_n + 200) then
    pcall(function() event.unregisterbyname("wdo_shot") end)
    WD.done = true
    return
  end
  -- Walk up to the door, then confirm twice.
  if n <= 60 then
    joypad.set({ [BTN.UP] = true }, 1)
  elseif n <= 120 then
    joypad.set({ [BTN.UP] = true }, 1)
  elseif n == 140 or n == 200 then
    joypad.set({ [BTN.X] = true }, 1)
  end
  -- Only screenshot around the transition window (writing hundreds of PNGs
  -- slows the load, per docs/research/field/captures/warp-wipe-2026-09-13).
  local shot = (n % 6 == 0) or (WD.changed and n >= WD.change_n - 24 and n <= WD.change_n + 200 and n % 2 == 0)
  if shot then
    pcall(function() client.screenshot("C:/bizhawk-rig/shots/wdo_" .. string.format("%03d", n) .. ".png") end)
    WD.shots = WD.shots + 1
  end
end, "wdo_shot")

function WD.dump()
  print(string.format("WD start_scene=%08x start_frame=%d shots=%d changed=%s change_frame=%s",
    WD.start_scene, WD.start_frame, WD.shots, tostring(WD.changed), tostring(WD.changed_frame)))
  local parts = {}
  for i = 1, #HOOKS do parts[#parts + 1] = HOOKS[i].name .. "=" .. WD.count[i] end
  print("COUNTS " .. table.concat(parts, " "))
  for j = 1, #WD.log do print(WD.log[j]) end
end

function WD.stop()
  for _, n in ipairs(NAMES) do pcall(function() event.unregisterbyname(n) end) end
  print("WD stopped")
end

print(string.format("WD armed start_scene=%08x frame=%d", WD.start_scene, WD.start_frame))
