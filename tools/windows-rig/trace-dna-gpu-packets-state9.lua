-- Trace live GPU packets during the persistent DNA orb phase.
-- The visible cores continue moving after op3 and directory-sprite calls stop,
-- so capture the lower-level packets linked by F0x8002973c.  Original assembly
-- verifies this routine swaps the low 24-bit DMA links between a packet and
-- an ordering-table slot (the game's AddPrim equivalent). A return-chain
-- breakpoint records every call in a frame despite Redux build 314's dynarec
-- one-hit behavior.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local mem = PCSX.getMemPtr()
local function u8(a) return mem[bit.band(a, 0x1fffff)] end
local function u16(a) return u8(a) + u8(a + 1) * 256 end
local function u32(a) return u16(a) + u16(a + 2) * 65536 end
local function valid(p) return p >= 0x80000000 and p < 0x80200000 end
local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end

DNA_GPU_FRAME = 0
DNA_GPU_DONE = false
DNA_GPU_COUNT = 0

local ENTRY = 0x8002973c
local MAX_FRAMES = 920
local MAX_EVENTS = 16000
local traceFile = io.open("C:/dw3-rig/dumps/dna_gpu_packets_state9.log", "w")
local entryBp = nil
local returnBps = {}
local frameSeq = 0

local function emit(line)
  if DNA_GPU_COUNT >= MAX_EVENTS then return end
  DNA_GPU_COUNT = DNA_GPU_COUNT + 1
  if traceFile then traceFile:write(line .. "\n"); traceFile:flush() end
end

local function remove(bp)
  if bp then pcall(function() bp:remove() end) end
end

local armEntry
local function armReturn(addr)
  if addr == 0 or addr == ENTRY then return end
  local bp
  bp = PCSX.addBreakpoint(addr, "Exec", 4, "dna_gpu_ret", function()
    remove(bp)
    armEntry()
    return false
  end)
  returnBps[#returnBps + 1] = bp
end

local function packetWords(p)
  local out, interesting = {}, false
  if not valid(p) then return "invalid", false end
  for i = 0, 15 do
    local w = u32(p + i * 4)
    out[#out + 1] = hex(w)
    local cmd = math.floor(w / 0x1000000)
    -- The native fusion field is primarily textured Gouraud geometry
    -- (0x34/0x3c), plus rectangles/copies and draw-environment packets.
    if (cmd >= 0x20 and cmd <= 0x3f) or (cmd >= 0x60 and cmd <= 0x9f)
        or (cmd >= 0xe1 and cmd <= 0xe6) then
      interesting = true
    end
  end
  return table.concat(out, ","), interesting
end

armEntry = function()
  remove(entryBp)
  entryBp = PCSX.addBreakpoint(ENTRY, "Exec", 4, "dna_gpu_entry", function()
    local r = PCSX.getRegisters().GPR.n
    local caller = r.ra
    frameSeq = frameSeq + 1
    remove(entryBp)
    entryBp = nil

    local words, interesting = packetWords(r.a0)
    if DNA_GPU_FRAME >= 180 and interesting then
      emit(string.format(
        "f=%d seq=%d ra=%s a0=%s a1=%s a2=%s a3=%s s0=%s s1=%s s2=%s s3=%s sp=%s words=%s",
        DNA_GPU_FRAME, frameSeq, hex(caller), hex(r.a0), hex(r.a1), hex(r.a2),
        hex(r.a3), hex(r.s0), hex(r.s1), hex(r.s2), hex(r.s3), hex(r.sp), words))
    end

    armReturn(caller)
    return false
  end)
end

DNA_GPU_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_GPU_DONE then return end
  DNA_GPU_FRAME = DNA_GPU_FRAME + 1
  frameSeq = 0
  armEntry()

  if DNA_GPU_FRAME >= MAX_FRAMES or DNA_GPU_COUNT >= MAX_EVENTS then
    DNA_GPU_DONE = true
    remove(entryBp)
    for _, bp in ipairs(returnBps) do remove(bp) end
    if traceFile then traceFile:close(); traceFile = nil end
    print(string.format("DNA_GPU_DONE frames=%d events=%d", DNA_GPU_FRAME,
      DNA_GPU_COUNT))
  end
end)

-- F0x8002915c is used while drawing the very first restored frame, before the
-- first post-load Vsync callback. Arm it synchronously so its block cannot be
-- cached ahead of the trace.
armEntry()
PCSX.resumeEmulator()
print("DNA_GPU_ARMED")
