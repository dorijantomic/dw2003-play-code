-- Eight-frame trace of the actual sprite-effect updater while Jogress is live.
-- This distinguishes authored program duration from wall-clock/Vsync lifetime.

local mem = PCSX.getMemPtr()
local function u8(a) return mem[bit.band(a, 0x1fffff)] end
local function u32(a) return u8(a) + u8(a + 1) * 256 + u8(a + 2) * 65536 + u8(a + 3) * 16777216 end

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate8"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

DNA_EOBJ_FRAME = 0
DNA_EOBJ_DONE = false
DNA_EOBJ_TRACE = {}
DNA_EOBJ_SEEN = {}
DNA_EOBJ_BP = nil

DNA_EOBJ_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_EOBJ_DONE then return end
  DNA_EOBJ_FRAME = DNA_EOBJ_FRAME + 1
  if DNA_EOBJ_FRAME == 1 then
    DNA_EOBJ_BP = PCSX.addBreakpoint(0x800893dc, "Exec", 4, "dna_effect_update", function()
      pcall(function()
        local r = PCSX.getRegisters()
        local p = r.GPR.n.a0
        local key = string.format("%d:%08x", DNA_EOBJ_FRAME, bit.band(p, 0xffffffff))
        if not DNA_EOBJ_SEEN[key] and #DNA_EOBJ_TRACE < 128 then
          DNA_EOBJ_SEEN[key] = true
          DNA_EOBJ_TRACE[#DNA_EOBJ_TRACE + 1] = string.format(
            "f=%d obj=%08x state=%d program=%08x arch=%08x elapsed=%d mask=%d stride=%d duration=%d",
            DNA_EOBJ_FRAME, bit.band(p, 0xffffffff), u32(p + 0xc),
            bit.band(u32(p + 0x50), 0xffffffff), bit.band(u32(p + 0x68), 0xffffffff),
            u32(p + 0x6c), u32(p + 0x70), u32(p + 0x74), u32(p + 0x78)
          )
        end
      end)
      return false
    end)
  end
  if DNA_EOBJ_FRAME >= 8 then
    DNA_EOBJ_DONE = true
    print("DNA_EOBJ_TRACE_DONE events=" .. #DNA_EOBJ_TRACE)
  end
end)

PCSX.resumeEmulator()
print("DNA_EOBJ_TRACE_ARMED")
