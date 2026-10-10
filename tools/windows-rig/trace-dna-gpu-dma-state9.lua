-- Capture the CPU sites that submit GPU DMA2 linked lists. Vsync inspection is
-- too late: by then the live ordering table has already been consumed/cleared.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end
local traceFile = io.open("C:/dw3-rig/dumps/dna_gpu_dma_state9.log", "w")
DNA_DMA_FRAME = 0
DNA_DMA_COUNT = 0
DNA_DMA_DONE = false
DNA_DMA_BPS = {}

local function emit(kind, address)
  if DNA_DMA_FRAME < 480 or DNA_DMA_FRAME > 860 or DNA_DMA_COUNT >= 4000 then return end
  DNA_DMA_COUNT = DNA_DMA_COUNT + 1
  local regs = PCSX.getRegisters()
  local r = regs.GPR.n
  traceFile:write(string.format(
    "f=%d kind=%s addr=%s pc=%s ra=%s at=%s v0=%s v1=%s a0=%s a1=%s a2=%s a3=%s t0=%s t1=%s t2=%s s0=%s s1=%s s2=%s sp=%s\n",
    DNA_DMA_FRAME, kind, hex(address), hex(regs.pc), hex(r.ra), hex(r.at),
    hex(r.v0), hex(r.v1), hex(r.a0), hex(r.a1), hex(r.a2), hex(r.a3),
    hex(r.t0), hex(r.t1), hex(r.t2), hex(r.s0), hex(r.s1), hex(r.s2), hex(r.sp)))
  traceFile:flush()
end

for _, target in ipairs({ {0x1f8010a0, "MADR"}, {0x1f8010a8, "CHCR"} }) do
  local address, kind = target[1], target[2]
  DNA_DMA_BPS[#DNA_DMA_BPS + 1] = PCSX.addBreakpoint(
    address, "Write", 4, "dna_gpu_dma_" .. kind, function()
      emit(kind, address)
      return false
    end)
end

DNA_DMA_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_DMA_DONE then return end
  DNA_DMA_FRAME = DNA_DMA_FRAME + 1
  if DNA_DMA_FRAME >= 880 or DNA_DMA_COUNT >= 4000 then
    DNA_DMA_DONE = true
    if traceFile then traceFile:close(); traceFile = nil end
    print(string.format("DNA_DMA_DONE frames=%d events=%d", DNA_DMA_FRAME,
      DNA_DMA_COUNT))
  end
end)

PCSX.resumeEmulator()
print("DNA_DMA_ARMED")
