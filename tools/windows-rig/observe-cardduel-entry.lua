-- Read-only observer: screenshot burst of the card-duel ENTRY on BizHawk.
--
-- Arms one frame-end listener. It waits until the cardgame overlay becomes
-- resident (two pinned function-prologue words, static-derived from
-- cardgame.s), then takes one PNG every STEP frames for up to MAX shots.
-- It sends NO input, performs NO writes and loads NO savestate. The user keeps
-- the controls. Stop early with CDE.stop(); it self-stops at MAX.
--
-- Arm:    tools/windows-rig/bizhawk-rpc tools/windows-rig/observe-cardduel-entry.lua
-- Status: tools/windows-rig/bizhawk-rpc "CDE.status()"
-- Stop:   tools/windows-rig/bizhawk-rpc "CDE.stop()"
--
-- Screenshots land in C:/bizhawk-rig/shots/ (readable from WSL at
-- /mnt/c/bizhawk-rig/shots/). The append-only log is
-- C:/bizhawk-rig/dumps/cardduel-entry.log and survives a crash.

CDE = CDE or {}
CDE.step   = CDE.step   or 2
CDE.max    = CDE.max    or 800
CDE.prefix = CDE.prefix or "cde"
CDE.path   = CDE.path   or "C:/bizhawk-rig/dumps/cardduel-entry.log"
CDE.pin1addr, CDE.pin1 = 0x8009bac8, 0x27bdffd8
CDE.pin2addr, CDE.pin2 = 0x800a1b48, 0x27bdffe0
CDE.started  = CDE.started  or nil
CDE.frame    = CDE.frame    or 0
CDE.shots    = CDE.shots    or 0
CDE.finished = CDE.finished or false
CDE.armed    = CDE.armed    or false

local function log(s)
  local f = io.open(CDE.path, "a")
  if f then f:write(s .. "\n"); f:close() end
end

if not CDE.armed then
  CDE.armed = true
  log(string.format("# armed frame=%d pin1base=%08x pin2base=%08x step=%d max=%d",
    emu.framecount(), rd32(CDE.pin1addr), rd32(CDE.pin2addr), CDE.step, CDE.max))

  event.onframeend(function()
    if CDE.finished then return end
    CDE.frame = CDE.frame + 1
    local f = emu.framecount()
    if not CDE.started then
      if rd32(CDE.pin1addr) == CDE.pin1 and rd32(CDE.pin2addr) == CDE.pin2 then
        CDE.started = f
        log(string.format("# START cardgame resident frame=%d scene=%08x", f, getSceneID()))
      elseif CDE.frame % 180 == 0 then
        log(string.format("# waiting frame=%d pin1=%08x pin2=%08x scene=%08x",
          f, rd32(CDE.pin1addr), rd32(CDE.pin2addr), getSceneID()))
      end
    end
    if CDE.started and (f - CDE.started) % CDE.step == 0 and CDE.shots < CDE.max then
      local name = string.format("%s_%04d", CDE.prefix, CDE.shots)
      savestatePNG(name)
      log(string.format("shot=%s frame=%d off=%d scene=%08x",
        name, f, f - CDE.started, getSceneID()))
      CDE.shots = CDE.shots + 1
      if CDE.shots >= CDE.max then
        CDE.finished = true
        log(string.format("# DONE shots=%d frame=%d", CDE.shots, f))
      end
    end
  end, "cde_frame")
end

function CDE.status()
  print(string.format("cde armed=%s started=%s shots=%d frame=%d finished=%s pin1=%08x pin2=%08x",
    tostring(CDE.armed), tostring(CDE.started), CDE.shots, CDE.frame, tostring(CDE.finished),
    rd32(CDE.pin1addr), rd32(CDE.pin2addr)))
end

function CDE.stop()
  pcall(function() event.unregisterbyname("cde_frame") end)
  CDE.finished = true
  CDE.armed = false
  print(string.format("cde stopped shots=%d", CDE.shots))
end

print(string.format("cardduel-entry observer armed step=%d max=%d out=%s",
  CDE.step, CDE.max, CDE.path))
