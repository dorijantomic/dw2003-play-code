-- Bounded structure/callback trace for the live clip-12 Jogress director.
-- Loads GUI savestate 8, waits for the first post-load Vsync, records only
-- fixed-size objects reachable from the known director, then stops at frame 8.

local mem = PCSX.getMemPtr()

local function u8(a)
  return mem[bit.band(a, 0x1fffff)]
end

local function u32(a)
  return u8(a) + u8(a + 1) * 256 + u8(a + 2) * 65536 + u8(a + 3) * 16777216
end

local function words(base, size)
  local out = {}
  for off = 0, size - 4, 4 do
    out[#out + 1] = string.format("+%03x=%08x", off, bit.band(u32(base + off), 0xffffffff))
  end
  return table.concat(out, " ")
end

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate8"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

DNA_DIR_FRAME = 0
DNA_DIR_DONE = false
DNA_DIR_TRACE = {}

DNA_DIR_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_DIR_DONE then return end
  DNA_DIR_FRAME = DNA_DIR_FRAME + 1
  if DNA_DIR_FRAME == 1 then
    local director = 0x800c106c
    local actor = u32(director + 0x88)
    local resource = u32(director + 0x78)
    DNA_DIR_TRACE[#DNA_DIR_TRACE + 1] = string.format("director=%08x actor=%08x resource=%08x", director, actor, resource)
    DNA_DIR_TRACE[#DNA_DIR_TRACE + 1] = "DIRECTOR " .. words(director, 0xb0)
    if actor >= 0x80000000 and actor < 0x80200000 then
      DNA_DIR_TRACE[#DNA_DIR_TRACE + 1] = "ACTOR " .. words(actor, 0x200)
    end
    if resource >= 0x80000000 and resource < 0x80200000 then
      DNA_DIR_TRACE[#DNA_DIR_TRACE + 1] = "RESOURCE " .. words(resource, 0x100)
    end
  end
  if DNA_DIR_FRAME >= 8 then
    DNA_DIR_DONE = true
    print("DNA_DIR_TRACE_DONE")
  end
end)

PCSX.resumeEmulator()
print("DNA_DIR_TRACE_ARMED")
