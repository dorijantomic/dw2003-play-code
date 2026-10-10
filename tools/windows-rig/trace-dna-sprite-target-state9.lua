-- Resolve the concrete sprite-renderer target used by the generic effect draw
-- path. FIGHTSTG 0x800893c0 is the final jalr, with v1 holding the callee and
-- a0..a3 holding clip/source and screen-placement arguments.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end
DNA_STGT_FRAME = 0
DNA_STGT_COUNT = 0
DNA_STGT_DONE = false
local traceFile = io.open("C:/dw3-rig/dumps/dna_sprite_target_state9.log", "w")

DNA_STGT_BP = PCSX.addBreakpoint(0x800893c0, "Exec", 4, "dna_sprite_target", function()
  if DNA_STGT_FRAME <= 550 and DNA_STGT_COUNT < 2000 then
    local regs = PCSX.getRegisters()
    local r = regs.GPR.n
    DNA_STGT_COUNT = DNA_STGT_COUNT + 1
    if traceFile then
      traceFile:write(string.format(
        "f=%d target=%s ra=%s a0=%s a1=%d a2=%d a3=%d s0=%s s1=%s\n",
        DNA_STGT_FRAME, hex(r.v1), hex(r.ra), hex(r.a0), bit.band(r.a1, 0xffff),
        bit.band(r.a2, 0xffff), bit.band(r.a3, 0xffff), hex(r.s0), hex(r.s1)))
      traceFile:flush()
    end
  end
  return false
end)

DNA_STGT_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_STGT_DONE then return end
  DNA_STGT_FRAME = DNA_STGT_FRAME + 1
  if DNA_STGT_FRAME >= 560 or DNA_STGT_COUNT >= 2000 then
    DNA_STGT_DONE = true
    if traceFile then traceFile:close(); traceFile = nil end
    print(string.format("DNA_STGT_DONE frame=%d events=%d", DNA_STGT_FRAME, DNA_STGT_COUNT))
  end
end)

PCSX.resumeEmulator()
print("DNA_STGT_ARMED")
