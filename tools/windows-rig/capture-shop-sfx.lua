-- Runtime probe for the shop's packed-sound calls (no audio capture needed).
--
-- Hooks the shared "play packed sound" entry F0x8002006c (reached through the
-- pointer [0x80055c48] that stitshop calls) and logs a0 (packed id), ra
-- (caller) and the emulator frame for every call.
--
-- Arm:   tools/windows-rig/bizhawk-rpc tools/windows-rig/capture-shop-sfx.lua
-- Read:  tools/windows-rig/bizhawk-rpc "SHOP_SFX.dump()"
-- Stop:  tools/windows-rig/bizhawk-rpc "SHOP_SFX.stop()"
--
-- Writes an append-only line log to C:/bizhawk-rig/dumps/shop-sfx-live.log so a
-- crash mid-run still leaves the entries captured so far.

SHOP_SFX = SHOP_SFX or {}
SHOP_SFX.log = SHOP_SFX.log or {}
SHOP_SFX.path = SHOP_SFX.path or "C:/bizhawk-rig/dumps/shop-sfx-live.log"

local function hex(v)
  return string.format("0x%08x", bit.band(v or 0, 0xffffffff))
end

local function append(line)
  local f = io.open(SHOP_SFX.path, "a")
  if f then
    f:write(line .. "\n")
    f:close()
  end
end

if SHOP_SFX.armed then
  pcall(function() event.unregisterbyname("shop_sfx_play") end)
  SHOP_SFX.armed = nil
end

append(string.format("# armed frame=%d", emu.framecount()))

local function on_play()
  local ok, r = pcall(emu.getregisters)
  if not ok or type(r) ~= "table" then return end
  local line = string.format("f=%d a0=%s ra=%s", emu.framecount(), hex(r.a0), hex(r.ra))
  SHOP_SFX.log[#SHOP_SFX.log + 1] = line
  append(line)
end

event.onmemoryexecute(on_play, 0x8002006c, "shop_sfx_play")
SHOP_SFX.armed = true
SHOP_SFX.start_frame = emu.framecount()

function SHOP_SFX.dump()
  print("shop-sfx entries=" .. #SHOP_SFX.log)
  for i = 1, #SHOP_SFX.log do print(SHOP_SFX.log[i]) end
end

function SHOP_SFX.stop()
  pcall(function() event.unregisterbyname("shop_sfx_play") end)
  SHOP_SFX.armed = nil
  print("shop-sfx stopped entries=" .. #SHOP_SFX.log)
end

print("shop-sfx probe armed at 0x8002006c frame=" .. tostring(SHOP_SFX.start_frame))
