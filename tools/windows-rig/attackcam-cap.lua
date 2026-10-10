-- Attack-camera capture for the BizHawk rig (2026-10-08).
--
-- Answers, from the running original: for one attack, which authored camera op-5s
-- run and when, the glide's install (its start, destination and duration), the
-- glide's progress per frame, and whether the idle camera director keeps
-- publishing its own shot while an action owns the camera.
--
-- Arm:   tools/windows-rig/bizhawk-rpc tools/windows-rig/attackcam-cap.lua
-- Reset: tools/windows-rig/bizhawk-rpc 'ATTACKCAM.reset()'
-- Dump:  tools/windows-rig/bizhawk-rpc 'ATTACKCAM.dump()'   -> C:/bizhawk-rig/dumps/attackcam-cap.log
-- Stop:  tools/windows-rig/bizhawk-rpc 'ATTACKCAM.stop()'
--
-- Hooks use the FULL 0x800... address (event.onmemoryexecute resolves through the
-- System Bus); memory reads pass "MainRAM" explicitly with the 2 MB mask, the same
-- idiom as tools/windows-rig/call-logger.lua. Four execute hooks, one of them on a
-- once-per-frame address -- do not add hot ones (they throttle the emulator).

ATTACKCAM = ATTACKCAM or {}
ATTACKCAM.names = {}
ATTACKCAM.events = {}
ATTACKCAM.samples = {}
ATTACKCAM.cam = nil
ATTACKCAM.pub = 0
ATTACKCAM.last = nil
ATTACKCAM.path = "C:/bizhawk-rig/dumps/attackcam-cap.log"

local function hex(v) return string.format("0x%08x", bit.band(v or 0, 0xffffffff)) end
local function u16(a) return memory.read_u16_le(bit.band(a, 0x1fffff), "MainRAM") end
local function u32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end
-- a 0x34-byte camera record: eye xyz, target xyz, anchor xyz, angle xyz, roll, H
local function rec(a)
  local t = {}
  for i = 0, 12 do t[i + 1] = u16(a + i * 2) end
  return string.format("eye[%d,%d,%d] tgt[%d,%d,%d] anch[%d,%d,%d] ang[%d,%d,%d] roll=%d H=%d",
    t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9], t[10], t[11], t[12], t[13], t[14])
end
local function ev(line) ATTACKCAM.events[#ATTACKCAM.events + 1] = line end

function ATTACKCAM.stop()
  for _, n in ipairs(ATTACKCAM.names) do pcall(function() event.unregisterbyname(n) end) end
  ATTACKCAM.names = {}
  print(string.format("attackcam stopped: events=%d samples=%d pub=%d", #ATTACKCAM.events, #ATTACKCAM.samples, ATTACKCAM.pub))
end

function ATTACKCAM.reset()
  ATTACKCAM.events = {}
  ATTACKCAM.samples = {}
  ATTACKCAM.cam = nil
  ATTACKCAM.pub = 0
  ATTACKCAM.last = nil
  print("attackcam cleared")
end

function ATTACKCAM.dump()
  local f = io.open(ATTACKCAM.path, "w")
  if not f then print("attackcam dump FAILED: cannot open " .. ATTACKCAM.path); return end
  f:write(string.format("# attackcam frame=%d scene=%s pub=%d events=%d samples=%d\n",
    emu.framecount(), tostring(u32(0x80055d2c)), ATTACKCAM.pub, #ATTACKCAM.events, #ATTACKCAM.samples))
  f:write("# fightstg residency probe rd32(0x80092d50)= " .. hex(u32(0x80092d50)) .. "\n")
  for _, l in ipairs(ATTACKCAM.events) do f:write(l .. "\n") end
  f:write("# --- per-frame samples (only when progress/eye/publish changed) ---\n")
  for _, l in ipairs(ATTACKCAM.samples) do f:write(l .. "\n") end
  f:close()
  print("attackcam dumped -> " .. ATTACKCAM.path)
end

-- 1. the idle director's publish tail: s1 = its task, [s1+0x50] = the camera object
local function on_pub()
  ATTACKCAM.pub = ATTACKCAM.pub + 1
  local r = emu.getregisters()
  local cam = u32(bit.band((r.s1 or 0) + 0x50, 0xffffffff))
  if cam ~= 0 then ATTACKCAM.cam = cam end
end

-- 2. the op-5 handler entry: fires only on an authored op-5
local function on_op5()
  local r = emu.getregisters()
  ev(string.format("f=%d OP5-HANDLER a0=%s a1=%s a2=%s a3=%s ra=%s", emu.framecount(),
    hex(r.a0), hex(r.a1), hex(r.a2), hex(r.a3), hex(r.ra)))
  ev(string.format("   scratch 0x800a46d8 now: %s", rec(0x800a46d8)))
end

-- 3. the glide installer: a0 = camera object, a1 = start record (0 = current), a2 = dest, a3 = duration
local function on_glide()
  local r = emu.getregisters()
  local a0, a1, a2, a3 = r.a0 or 0, r.a1 or 0, r.a2 or 0, r.a3 or 0
  if a0 ~= 0 then ATTACKCAM.cam = a0 end
  ev(string.format("f=%d GLIDE a0=%s a1=%s(start) a2=%s(dest) a3=%s(duration) progress=%s step=%s",
    emu.framecount(), hex(a0), hex(a1), hex(a2), hex(a3), tostring(u16(a0 + 0xf0)), tostring(u16(a0 + 0xf4))))
  ev(string.format("   glide START (object+0x54): %s", rec(a0 + 0x54)))
  if a2 ~= 0 then ev(string.format("   glide DEST  (a2): %s", rec(a2))) end
end

-- 4. the instant arm: a0 = camera object, a1 = record to apply now
local function on_instant()
  local r = emu.getregisters()
  ev(string.format("f=%d INSTANT a0=%s a1=%s", emu.framecount(), hex(r.a0), hex(r.a1)))
  if (r.a1 or 0) ~= 0 then ev(string.format("   applied record: %s", rec(r.a1))) end
end

local function register(name, addr, fn)
  local ok, err = pcall(function() event.onmemoryexecute(fn, addr, name) end)
  if ok then ATTACKCAM.names[#ATTACKCAM.names + 1] = name
  else print("attackcam HOOK FAILED " .. name .. ": " .. tostring(err)) end
end

register("attackcam_pub", 0x80087ab4, on_pub)
register("attackcam_op5", 0x8008c004, on_op5)
register("attackcam_glide", 0x800922b4, on_glide)
register("attackcam_instant", 0x80092244, on_instant)

-- per-frame sampler: the live record, its tween progress, and the publish count
event.onframeend(function()
  local cam = ATTACKCAM.cam
  if not cam then return end
  local p = u16(cam + 0xf0)
  local eye = string.format("[%d,%d,%d]", u16(cam + 0x54), u16(cam + 0x56), u16(cam + 0x58))
  local tgt = string.format("[%d,%d,%d]", u16(cam + 0x5c), u16(cam + 0x5e), u16(cam + 0x60))
  local key = p .. "|" .. eye .. "|" .. ATTACKCAM.pub
  if key ~= ATTACKCAM.last then
    ATTACKCAM.last = key
    if #ATTACKCAM.samples < 4000 then
      ATTACKCAM.samples[#ATTACKCAM.samples + 1] = string.format("f=%d progress=%d eye=%s tgt=%s pub=%d",
        emu.framecount(), p, eye, tgt, ATTACKCAM.pub)
    end
  end
end, "attackcam_scan")

print(string.format("attackcam armed frame=%d scene=%s fightstg=%s cam=%s",
  emu.framecount(), tostring(u32(0x80055d2c)), hex(u32(0x80092d50)), tostring(ATTACKCAM.cam)))
