-- Bounded runtime trace for the authentic Jogress/DNA presentation in GUI state 8.
-- The breakpoint is armed from the first post-load Vsync, never in the same
-- callback that requests the savestate load (pinned Redux build 314 safety rule).

local mem = PCSX.getMemPtr()

local function u8(a)
  return mem[bit.band(a, 0x1fffff)]
end

local function u16(a)
  return u8(a) + u8(a + 1) * 256
end

local function s16(a)
  local v = u16(a)
  if v >= 0x8000 then return v - 0x10000 end
  return v
end

local function u32(a)
  return u8(a) + u8(a + 1) * 256 + u8(a + 2) * 65536 + u8(a + 3) * 16777216
end

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate8"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

DNA_FX_FRAME = 0
DNA_FX_TRACE = {}
DNA_FX_DONE = false
DNA_FX_BP = nil

DNA_FX_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_FX_DONE then return end
  DNA_FX_FRAME = DNA_FX_FRAME + 1

  if DNA_FX_FRAME == 1 then
    DNA_FX_BP = PCSX.addBreakpoint(0x8008bc80, "Exec", 4, "dna_fx_op3", function()
      pcall(function()
        local r = PCSX.getRegisters()
        local ctx = r.GPR.n.a0
        local pc = u32(ctx + 0x8c)
        DNA_FX_TRACE[#DNA_FX_TRACE + 1] = string.format(
          "f=%d pc=%08x sub=%d type=%d x=%d y=%d z=%d ra=%08x",
          DNA_FX_FRAME,
          bit.band(pc, 0xffffffff),
          s16(pc), s16(pc + 2), s16(pc + 4), s16(pc + 6), s16(pc + 8),
          bit.band(r.GPR.n.ra, 0xffffffff)
        )
      end)
      return false
    end)
  end

  if DNA_FX_FRAME >= 480 then
    DNA_FX_DONE = true
    print("DNA_FX_TRACE_DONE frames=" .. DNA_FX_FRAME .. " events=" .. #DNA_FX_TRACE)
  end
end)

PCSX.resumeEmulator()
print("DNA_FX_TRACE_ARMED")
