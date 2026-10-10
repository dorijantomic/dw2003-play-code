-- Trace the CPU sites that rebuild the two long-lived DNA orb meshes.  These
-- are the first live GPU command words for CLUT groups 16171 and 16170 in the
-- real 0x100-entry battle-effect ordering table rooted at 0x800ac4ac.
-- Redux's dynarec can drop data breakpoints, so re-arm them every vsync.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end
local out = io.open("C:/dw3-rig/dumps/dna_orb_packet_writers_state9.log", "w")
local frame, done, count, bps = 0, false, 0, {}
local targets = {
  { 0x801e8314, "orb_a_buf0" }, { 0x801cf308, "orb_a_buf1" },
  { 0x801e8c24, "orb_b_buf0" }, { 0x801cfc18, "orb_b_buf1" },
}

local function emit(s)
  if out then out:write(s .. "\n"); out:flush() end
end

local function clear()
  for _, bp in ipairs(bps) do pcall(function() bp:remove() end) end
  bps = {}
end

local function arm(address, name)
  bps[#bps + 1] = PCSX.addBreakpoint(address, "Write", 4,
    "dna_orb_packet_" .. name, function()
      if frame >= 500 and frame <= 740 then
        count = count + 1
        local regs = PCSX.getRegisters()
        local r = regs.GPR.n
        emit(string.format(
          "f=%d target=%s address=%s pc=%s ra=%s a0=%s a1=%s a2=%s a3=%s v0=%s v1=%s t0=%s t1=%s t2=%s t3=%s s0=%s s1=%s s2=%s s3=%s sp=%s",
          frame, name, hex(address), hex(regs.pc), hex(r.ra), hex(r.a0),
          hex(r.a1), hex(r.a2), hex(r.a3), hex(r.v0), hex(r.v1), hex(r.t0),
          hex(r.t1), hex(r.t2), hex(r.t3), hex(r.s0), hex(r.s1), hex(r.s2),
          hex(r.s3), hex(r.sp)))
      end
      return false
    end)
end

DNA_ORB_PACKET_WRITER_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if done then return end
  frame = frame + 1
  clear()
  for _, target in ipairs(targets) do arm(target[1], target[2]) end
  if frame >= 760 then
    done = true
    clear()
    if out then out:close(); out = nil end
    print(string.format("DNA_ORB_PACKET_WRITERS_DONE frames=%d hits=%d", frame, count))
  end
end)

PCSX.resumeEmulator()
print("DNA_ORB_PACKET_WRITERS_ARMED")
