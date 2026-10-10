-- Attack-camera frame watcher for the BizHawk rig (2026-10-08).
--
-- NO execute hooks: measured on this rig, four execute hooks drop the emulator to
-- ~3 fps and a hook-free run holds ~50 fps, and ANY registered execute hook pays a
-- per-instruction cost in this build. So this watches the camera object's own record
-- and tween fields from a per-frame callback instead.
--
-- Arming needs the camera object's address, which the previous run read off the
-- instant-apply arm (a0). Verify it is still the camera before trusting a run:
-- ATTACKW.probe() prints the record so it can be checked against the known arena shot.
--
-- Arm:   tools/windows-rig/bizhawk-rpc tools/windows-rig/attackcam-watch.lua
-- Dump:  tools/windows-rig/bizhawk-rpc 'ATTACKW.dump()'   -> C:/bizhawk-rig/dumps/attackcam-watch.log
-- Stop:  tools/windows-rig/bizhawk-rpc 'ATTACKW.stop()'

ATTACKW = ATTACKW or {}
ATTACKW.cam = ATTACKW.cam or 0x800bb2d4      -- the camera object (from the instant arm's a0)
ATTACKW.scratch = 0x800a46d8                 -- the op-5 handler's scratch record (fixed address)
ATTACKW.lines = {}
ATTACKW.last = nil
ATTACKW.shots = 0
ATTACKW.instants = 0
ATTACKW.glide = nil                          -- frame the current glide was first seen
ATTACKW.glideframes = 0
ATTACKW.path = "C:/bizhawk-rig/dumps/attackcam-watch.log"

local function hex(v) return string.format("0x%08x", bit.band(v or 0, 0xffffffff)) end
local function s16(v) if v >= 0x8000 then return v - 0x10000 else return v end end
local function u16(a) return memory.read_u16_le(bit.band(a, 0x1fffff), "MainRAM") end
local function u32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end
local function trip(a) return string.format("[%d,%d,%d]", s16(u16(a)), s16(u16(a + 2)), s16(u16(a + 4))) end

function ATTACKW.probe()  print(string.format("cam=%s progress=%d step=%d live=%s -> %s scratch=%s -> %s",
    hex(ATTACKW.cam), u16(ATTACKW.cam + 0xf0), u16(ATTACKW.cam + 0xf4),
    trip(ATTACKW.cam + 0x54), trip(ATTACKW.cam + 0x5a), trip(ATTACKW.scratch), trip(ATTACKW.scratch + 6)))
end

-- ONE execute hook: the instant-apply arm. It names the camera object and counts the
-- applies, so we can see whether the idle camera keeps publishing while an action owns
-- the camera. Any execute hook costs frames on this rig, so there is only ever one.
function ATTACKW.hook()
  pcall(function() event.unregisterbyname("attackw_instant") end)
  local ok, err = pcall(function()
    event.onmemoryexecute(function()
      local r = emu.getregisters()
      local a0 = r.a0 or 0
      ATTACKW.instants = ATTACKW.instants + 1
      if a0 ~= 0 and a0 ~= ATTACKW.cam then
        ATTACKW.cam = a0
        if #ATTACKW.lines < 3000 then
          ATTACKW.lines[#ATTACKW.lines + 1] = string.format("f=%d CAMERA OBJECT -> %s (from the instant arm)",
            emu.framecount(), hex(a0))
        end
      end
    end, 0x80092244, "attackw_instant")
  end)
  print(ok and "attackw instant hook armed" or ("attackw hook FAILED: " .. tostring(err)))
end

function ATTACKW.stop()
  pcall(function() event.unregisterbyname("attackw_scan") end)
  pcall(function() event.unregisterbyname("attackw_instant") end)
  print(string.format("attackw stopped: lines=%d shots=%d instants=%d", #ATTACKW.lines, ATTACKW.shots, ATTACKW.instants or 0))
end

function ATTACKW.dump()
  local f = io.open(ATTACKW.path, "w")
  if not f then print("attackw dump FAILED"); return end
  f:write(string.format("# attackw frame=%d scene=%s cam=%s lines=%d\n",
    emu.framecount(), tostring(u32(0x80055d2c)), hex(ATTACKW.cam), #ATTACKW.lines))
  f:write("# columns: frame progress step | live eye/target (signed) | scratch eye/target (signed)\n")
  for _, l in ipairs(ATTACKW.lines) do f:write(l .. "\n") end
  f:close()
  print("attackw dumped -> " .. ATTACKW.path)
end

-- Keep the per-frame cost to ONE memory read: this rig's Lua frame callback is
-- expensive enough that ~20 reads per frame drops the emulator to ~2 fps. The
-- record and the scratch are read only on a frame where the tween actually moved.
ATTACKW.lastp = nil
ATTACKW.laststep = nil

event.onframeend(function()
  local cam = ATTACKW.cam
  local f = emu.framecount()
  local p = u16(cam + 0xf0)
  local step = u16(cam + 0xf4)

  local gliding = (p ~= 0x1000 and p ~= 0)
  if gliding then
    if not ATTACKW.glide or p < 100 then ATTACKW.glide = f; ATTACKW.lastshot = nil end
    local n = f - (ATTACKW.glide or f)
    if n % 20 == 0 and n > 0 and n ~= ATTACKW.lastshot then
      ATTACKW.lastshot = n
      ATTACKW.shots = ATTACKW.shots + 1
      client.screenshot(string.format("C:/bizhawk-rig/shots/cam-glide-%03d.png", n))
    end
  end

  -- periodic heartbeat line (every 20 frames) so a window with no camera change
  -- still shows what the picture was doing, and where the attack had got to
  if f % 20 == 0 then
    local l1 = string.format("f=%d progress=%d step=%d inst=%d | live %s -> %s | scratch %s -> %s",
      f, p, step, ATTACKW.instants, trip(cam + 0x54), trip(cam + 0x5a), trip(ATTACKW.scratch), trip(ATTACKW.scratch + 6))
    if #ATTACKW.lines < 3000 then ATTACKW.lines[#ATTACKW.lines + 1] = l1 end
  end

  if p ~= ATTACKW.lastp or step ~= ATTACKW.laststep then
    ATTACKW.lastp = p
    ATTACKW.laststep = step
    local l2 = string.format("f=%d progress=%d step=%d inst=%d | live %s -> %s | scratch %s -> %s",
      f, p, step, ATTACKW.instants, trip(cam + 0x54), trip(cam + 0x5a), trip(ATTACKW.scratch), trip(ATTACKW.scratch + 6))
    if #ATTACKW.lines < 3000 then ATTACKW.lines[#ATTACKW.lines + 1] = l2 end
  end
end, "attackw_scan")

print(string.format("attackw armed frame=%d scene=%s cam=%s", emu.framecount(), tostring(u32(0x80055d2c)), hex(ATTACKW.cam)))
