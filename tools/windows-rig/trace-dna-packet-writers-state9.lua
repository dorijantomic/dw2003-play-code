-- Identify the native code that constructs deterministic live DNA mesh
-- packets. These addresses were selected from the visible ordering-table
-- chain in the refreshed AppData state 9 capture at presentation frame 700.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end
local targets = { 0x801d21a4, 0x801d3e1c, 0x801d44c4 }
local traceFile = io.open("C:/dw3-rig/dumps/dna_packet_writers_state9.log", "w")

DNA_PWRITE_FRAME = 0
DNA_PWRITE_COUNT = 0
DNA_PWRITE_DONE = false
DNA_PWRITE_BPS = {}

local function emit(line)
  DNA_PWRITE_COUNT = DNA_PWRITE_COUNT + 1
  if traceFile then traceFile:write(line .. "\n"); traceFile:flush() end
end

for _, address in ipairs(targets) do
  DNA_PWRITE_BPS[#DNA_PWRITE_BPS + 1] = PCSX.addBreakpoint(
    address, "Write", 4, "dna_packet_writer", function()
      if DNA_PWRITE_FRAME >= 450 and DNA_PWRITE_FRAME <= 820 then
        local regs = PCSX.getRegisters()
        local r = regs.GPR.n
        emit(string.format(
          "f=%d target=%s pc=%s ra=%s a0=%s a1=%s a2=%s a3=%s v0=%s v1=%s s0=%s s1=%s s2=%s s3=%s sp=%s",
          DNA_PWRITE_FRAME, hex(address), hex(regs.pc), hex(r.ra), hex(r.a0),
          hex(r.a1), hex(r.a2), hex(r.a3), hex(r.v0), hex(r.v1), hex(r.s0),
          hex(r.s1), hex(r.s2), hex(r.s3), hex(r.sp)))
      end
      return false
    end)
end

DNA_PWRITE_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_PWRITE_DONE then return end
  DNA_PWRITE_FRAME = DNA_PWRITE_FRAME + 1
  if DNA_PWRITE_FRAME >= 840 then
    DNA_PWRITE_DONE = true
    if traceFile then traceFile:close(); traceFile = nil end
    print(string.format("DNA_PWRITE_DONE frames=%d events=%d", DNA_PWRITE_FRAME,
      DNA_PWRITE_COUNT))
  end
end)

PCSX.resumeEmulator()
print("DNA_PWRITE_ARMED")
