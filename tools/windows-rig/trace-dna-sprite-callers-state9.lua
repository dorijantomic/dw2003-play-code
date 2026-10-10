-- Trace the concrete textured-rectangle renderer resolved from the DNA effect
-- path. Re-arm periodically because Redux build 314 can stop reporting an Exec
-- breakpoint after the first translated-block hit.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end
local mem = PCSX.getMemPtr()
local function nop(addr)
  local p = bit.band(addr, 0x1fffff)
  mem[p], mem[p + 1], mem[p + 2], mem[p + 3] = 0, 0, 0, 0
end

-- These are the two HUD textured-rectangle calls in FIGHTSTG_F0x80093364.
-- Suppress only their jalr instructions so the one-hit debugger can expose
-- the next renderer caller in the same native frame.
nop(0x8009357c)
nop(0x80093598)
DNA_SCALL_FRAME = 0
DNA_SCALL_COUNT = 0
DNA_SCALL_DONE = false
DNA_SCALL_BP = nil
local traceFile = io.open("C:/dw3-rig/dumps/dna_sprite_callers_state9.log", "w")

local function arm()
  if DNA_SCALL_BP then pcall(function() DNA_SCALL_BP:remove() end) end
  DNA_SCALL_BP = PCSX.addBreakpoint(0x8001ed6c, "Exec", 4, "dna_sprite_callers", function()
    if DNA_SCALL_FRAME >= 180 and DNA_SCALL_FRAME <= 920 and DNA_SCALL_COUNT < 5000 then
      local regs = PCSX.getRegisters()
      local r = regs.GPR.n
      DNA_SCALL_COUNT = DNA_SCALL_COUNT + 1
      if traceFile then
        traceFile:write(string.format(
          "f=%d ra=%s a0=%s a1=%s a2=%s a3=%s t0=%s t1=%s s0=%s s1=%s sp=%s\n",
          DNA_SCALL_FRAME, hex(r.ra), hex(r.a0), hex(r.a1), hex(r.a2), hex(r.a3),
          hex(r.t0), hex(r.t1), hex(r.s0), hex(r.s1), hex(r.sp)))
        traceFile:flush()
      end
    end
    return false
  end)
end

arm()
DNA_SCALL_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_SCALL_DONE then return end
  DNA_SCALL_FRAME = DNA_SCALL_FRAME + 1
  if DNA_SCALL_FRAME % 2 == 0 then arm() end
  if DNA_SCALL_FRAME >= 930 or DNA_SCALL_COUNT >= 5000 then
    DNA_SCALL_DONE = true
    if DNA_SCALL_BP then pcall(function() DNA_SCALL_BP:remove() end) end
    if traceFile then traceFile:close(); traceFile = nil end
    print(string.format("DNA_SCALL_DONE frame=%d events=%d", DNA_SCALL_FRAME, DNA_SCALL_COUNT))
  end
end)

PCSX.resumeEmulator()
print("DNA_SCALL_ARMED")
