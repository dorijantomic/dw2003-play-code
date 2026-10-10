-- Find custom GPU/DMA submission code by trapping reads of the executable's
-- RAM-resident hardware-register pointer tables. This works even when battle
-- code bypasses both SDK DrawOTag wrappers and writes GP0/DMA2 itself.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end
local targets = {
  {0x80055ffc, "GP0_A"}, {0x80056064, "GP0_B"},
  {0x80056004, "MADR_A"}, {0x80056058, "MADR_B"},
  {0x8005aaf4, "MADR_C"}, {0x8005600c, "CHCR_A"},
  {0x80056060, "CHCR_B"}, {0x8005aaf0, "CHCR_C"},
}

DNA_GPTR_FRAME = 0
DNA_GPTR_COUNT = 0
DNA_GPTR_DONE = false
DNA_GPTR_BPS = {}

local traceFile = io.open("C:/dw3-rig/dumps/dna_gpu_pointer_readers_state9.log", "w")
local function emit(line)
  DNA_GPTR_COUNT = DNA_GPTR_COUNT + 1
  if traceFile then traceFile:write(line .. "\n"); traceFile:flush() end
end

for _, item in ipairs(targets) do
  local addr, label = item[1], item[2]
  DNA_GPTR_BPS[#DNA_GPTR_BPS + 1] = PCSX.addBreakpoint(
    addr, "Read", 4, "dna_gptr_" .. label, function()
      if DNA_GPTR_FRAME >= 430 and DNA_GPTR_FRAME <= 920 and DNA_GPTR_COUNT < 12000 then
        local regs = PCSX.getRegisters()
        local r = regs.GPR.n
        emit(string.format(
          "f=%d src=%s ptr=%s pc=%s ra=%s a0=%s a1=%s a2=%s a3=%s s0=%s s1=%s s2=%s",
          DNA_GPTR_FRAME, label, hex(addr), hex(regs.pc), hex(r.ra), hex(r.a0),
          hex(r.a1), hex(r.a2), hex(r.a3), hex(r.s0), hex(r.s1), hex(r.s2)))
      end
      return false
    end)
end

DNA_GPTR_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_GPTR_DONE then return end
  DNA_GPTR_FRAME = DNA_GPTR_FRAME + 1
  if DNA_GPTR_FRAME >= 930 or DNA_GPTR_COUNT >= 12000 then
    DNA_GPTR_DONE = true
    for _, bp in ipairs(DNA_GPTR_BPS) do pcall(function() bp:remove() end) end
    if traceFile then traceFile:close(); traceFile = nil end
    print(string.format("DNA_GPTR_DONE frame=%d events=%d", DNA_GPTR_FRAME, DNA_GPTR_COUNT))
  end
end)

PCSX.resumeEmulator()
print("DNA_GPTR_ARMED")
