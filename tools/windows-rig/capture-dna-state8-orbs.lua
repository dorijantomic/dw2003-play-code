-- Dense, bounded oracle capture for the authentic DNA/Jogress orb merge.
--
-- Loads the GUI-created AppData slot 8 in a fresh pinned Redux process, then
-- captures one raw framebuffer every five Vsyncs while recording the live
-- camera and clip-director state.  Keep all shot calls in this one listener:
-- repeated RPC screenshot commands and pauseEmulator() are unstable on build
-- 314.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate8"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local mem = PCSX.getMemPtr()
local function u8(a) return mem[bit.band(a, 0x1fffff)] end
local function u16(a) return u8(a) + u8(a + 1) * 256 end
local function u32(a) return u16(a) + u16(a + 2) * 65536 end
local function s32(a)
  local v = u32(a)
  return v >= 0x80000000 and v - 0x100000000 or v
end
local function hex(v) return string.format("%08x", bit.band(v, 0xffffffff)) end

local CAM = 0x800a46d8
local DIRECTOR = 0x800c106c
local MAX_FRAMES = 520

DNA8_ORB_FRAME = 0
DNA8_ORB_DONE = false
DNA8_ORB_LOG = {}
DNA8_ORB_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA8_ORB_DONE then return end
  DNA8_ORB_FRAME = DNA8_ORB_FRAME + 1

  if DNA8_ORB_FRAME % 5 == 0 then
    pcall(shot, string.format("dna8_orb_%04d", DNA8_ORB_FRAME))
    DNA8_ORB_LOG[#DNA8_ORB_LOG + 1] = string.format(
      "f=%d state=%s cursor=%s wait=%d cam=(%d,%d,%d)->(%d,%d,%d) H=%d",
      DNA8_ORB_FRAME,
      hex(u32(DIRECTOR + 0x0c)), hex(u32(DIRECTOR + 0x8c)),
      u32(DIRECTOR + 0x94),
      s32(CAM), s32(CAM + 4), s32(CAM + 8),
      s32(CAM + 0x0c), s32(CAM + 0x10), s32(CAM + 0x14),
      s32(CAM + 0x30))
  end

  if DNA8_ORB_FRAME >= MAX_FRAMES then
    DNA8_ORB_DONE = true
    print(string.format("DNA8_ORB_DONE frames=%d samples=%d",
      DNA8_ORB_FRAME, #DNA8_ORB_LOG))
  end
end)

PCSX.resumeEmulator()
print("DNA8_ORB_ARMED")
