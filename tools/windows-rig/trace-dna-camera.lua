-- Bounded live trace of clip-12 camera interpolation and result-actor slot
-- transforms from the existing visible GUI savestate.  Exact addresses only;
-- no RAM scan and no framebuffer capture.

local mem = PCSX.getMemPtr()
local function u8(a) return mem[bit.band(a, 0x1fffff)] end
local function u16(a) return u8(a) + u8(a + 1) * 256 end
local function s16(a)
  local v = u16(a)
  return v >= 0x8000 and v - 0x10000 or v
end
local function u32(a)
  return u8(a) + u8(a + 1) * 256 + u8(a + 2) * 65536 + u8(a + 3) * 16777216
end
local function s32(a)
  local v = u32(a)
  return v >= 0x80000000 and v - 0x100000000 or v
end

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate8"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

DNA_CAM_FRAME = 0
DNA_CAM_TRACE = {}
DNA_CAM_SLOT = nil
DNA_CAM_DONE = false
DNA_CAM_BPS = {}

local function line(s) DNA_CAM_TRACE[#DNA_CAM_TRACE + 1] = s end

DNA_CAM_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_CAM_DONE then return end
  DNA_CAM_FRAME = DNA_CAM_FRAME + 1

  if DNA_CAM_FRAME == 1 then
    DNA_CAM_BPS[#DNA_CAM_BPS + 1] = PCSX.addBreakpoint(0x8008c004, "Exec", 4, "dna_cam_op5", function()
      pcall(function()
        local r = PCSX.getRegisters()
        local ctx = r.GPR.n.a0
        local p = u32(ctx + 0x8c)
        line(string.format("op5 f=%d p=%08x duration=%d sub=%d", DNA_CAM_FRAME,
          bit.band(p, 0xffffffff), s16(p), s16(p + 2)))
      end)
      return false
    end)
    DNA_CAM_BPS[#DNA_CAM_BPS + 1] = PCSX.addBreakpoint(0x8008ba18, "Exec", 4, "dna_slot_mode3", function()
      pcall(function()
        local r = PCSX.getRegisters()
        DNA_CAM_SLOT = r.GPR.n.s0
        line(string.format("mode3 f=%d slot=%08x", DNA_CAM_FRAME,
          bit.band(DNA_CAM_SLOT, 0xffffffff)))
      end)
      return false
    end)
    DNA_CAM_BPS[#DNA_CAM_BPS + 1] = PCSX.addBreakpoint(0x8008ba78, "Exec", 4, "dna_slot_mode4", function()
      pcall(function()
        local r = PCSX.getRegisters()
        DNA_CAM_SLOT = r.GPR.n.s0
        line(string.format("mode4 f=%d slot=%08x", DNA_CAM_FRAME,
          bit.band(DNA_CAM_SLOT, 0xffffffff)))
      end)
      return false
    end)
  end

  if DNA_CAM_FRAME % 15 == 0 then
    local c = 0x800a46d8
    local s = string.format("f=%d cam eye=%d,%d,%d target=%d,%d,%d H=%d",
      DNA_CAM_FRAME, s32(c), s32(c+4), s32(c+8), s32(c+12), s32(c+16), s32(c+20), s32(c+48))
    if DNA_CAM_SLOT and DNA_CAM_SLOT ~= 0 then
      local a = DNA_CAM_SLOT
      s = s .. string.format(" slot pos=%d,%d,%d aux=%d,%d,%d home=%d,%d,%d",
        s16(a+0x1c), s16(a+0x1e), s16(a+0x20),
        s16(a+0x22), s16(a+0x24), s16(a+0x26),
        s16(a+0x28), s16(a+0x2a), s16(a+0x2c))
    end
    line(s)
  end

  if DNA_CAM_FRAME >= 480 then
    DNA_CAM_DONE = true
    line("done frames=480")
    print("DNA_CAM_TRACE_DONE lines=" .. #DNA_CAM_TRACE)
  end
end)

PCSX.resumeEmulator()
print("DNA_CAM_TRACE_ARMED")
