-- Four-frame bounded renderer trace for the live Jogress frame.
-- Checks the known sprite draw and fight 3D actor callbacks without scanning RAM.

local mem = PCSX.getMemPtr()
local function u8(a) return mem[bit.band(a, 0x1fffff)] end
local function u32(a) return u8(a) + u8(a + 1) * 256 + u8(a + 2) * 65536 + u8(a + 3) * 16777216 end

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate8"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

DNA_REND_FRAME = 0
DNA_REND_DONE = false
DNA_REND_TRACE = {}
DNA_REND_SEEN = {}
DNA_REND_BPS = {}

local function add(addr, name)
  DNA_REND_BPS[#DNA_REND_BPS + 1] = PCSX.addBreakpoint(addr, "Exec", 4, name, function()
    pcall(function()
      local r = PCSX.getRegisters()
      local p = r.GPR.n.a0
      local key = string.format("%d:%s:%08x", DNA_REND_FRAME, name, bit.band(p, 0xffffffff))
      if not DNA_REND_SEEN[key] and #DNA_REND_TRACE < 256 then
        DNA_REND_SEEN[key] = true
        DNA_REND_TRACE[#DNA_REND_TRACE + 1] = string.format(
          "f=%d fn=%s a0=%08x a1=%08x a2=%08x a3=%08x ra=%08x p64=%08x",
          DNA_REND_FRAME, name, bit.band(p, 0xffffffff),
          bit.band(r.GPR.n.a1, 0xffffffff), bit.band(r.GPR.n.a2, 0xffffffff),
          bit.band(r.GPR.n.a3, 0xffffffff), bit.band(r.GPR.n.ra, 0xffffffff),
          bit.band(u32(p + 0x64), 0xffffffff)
        )
      end
    end)
    return false
  end)
end

DNA_REND_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_REND_DONE then return end
  DNA_REND_FRAME = DNA_REND_FRAME + 1
  if DNA_REND_FRAME == 1 then
    add(0x8008921c, "sprite_draw")
    add(0x80083e0c, "fight_actor")
  end
  if DNA_REND_FRAME >= 4 then
    DNA_REND_DONE = true
    print("DNA_REND_TRACE_DONE events=" .. #DNA_REND_TRACE)
  end
end)

PCSX.resumeEmulator()
print("DNA_REND_TRACE_ARMED")
