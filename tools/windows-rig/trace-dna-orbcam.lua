-- Bounded oracle trace: live camera struct (0x800a46d8 eye/target/H) + the
-- presentation actor's root worldT during the DNA orb flight. One X press,
-- samples every 20 frames, hard cap, capture-only, no dumps, no pause.
ORBC_FRAME = 0
ORBC_DONE = false
ORBC_LOG = {}
local MAX_FRAMES = 1700
local CAM = 0x800a46d8
local SLOT = 0x80137604   -- result-slot root worldT (README: live slot addr)

local function rd32s(a)
  local v = rd32(a)
  if v >= 0x80000000 then v = v - 0x100000000 end
  return v
end

ORBC_L = PCSX.Events.createEventListener("GPU::Vsync", function()
  if ORBC_DONE then return end
  ORBC_FRAME = ORBC_FRAME + 1
  if ORBC_FRAME == 120 or ORBC_FRAME == 240 then press(BTN.X, 4) end
  if ORBC_FRAME % 150 == 0 and ORBC_FRAME <= 1500 then pcall(shot, "orbc_" .. ORBC_FRAME) end
  if ORBC_FRAME >= 300 and ORBC_FRAME % 20 == 0 and #ORBC_LOG < 70 then
    ORBC_LOG[#ORBC_LOG + 1] = string.format(
      "f=%d cam=(%d,%d,%d)->(%d,%d,%d) H=%d slot=(%d,%d,%d)",
      ORBC_FRAME,
      rd32s(CAM), rd32s(CAM + 4), rd32s(CAM + 8),
      rd32s(CAM + 0xc), rd32s(CAM + 0x10), rd32s(CAM + 0x14),
      rd32s(CAM + 0x30),
      rd32s(SLOT), rd32s(SLOT + 4), rd32s(SLOT + 8))
  end
  if ORBC_FRAME >= MAX_FRAMES or #ORBC_LOG >= 70 then
    ORBC_DONE = true
    print("ORBC_DONE f=" .. tostring(ORBC_FRAME))
  end
end)
print("ORBC_ARMED")
