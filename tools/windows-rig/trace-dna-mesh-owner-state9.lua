-- Determine whether any native fight-model mesh is rendered during the DNA
-- parent-orbit hold. FIGHTSTG_F0x80085110 is verified from assembly as the
-- GTE display-list renderer that emits 0x24/2c/34/3c primitives.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end
local traceFile = io.open("C:/dw3-rig/dumps/dna_mesh_owner_state9.log", "w")
DNA_MESH_FRAME = 0
DNA_MESH_COUNT = 0
DNA_MESH_DONE = false

local function emit(line)
  DNA_MESH_COUNT = DNA_MESH_COUNT + 1
  if traceFile then traceFile:write(line .. "\n"); traceFile:flush() end
end

DNA_MESH_BP = PCSX.addBreakpoint(0x80085110, "Exec", 4, "dna_mesh_owner", function()
  if DNA_MESH_FRAME >= 480 and DNA_MESH_FRAME <= 900 and DNA_MESH_COUNT < 2000 then
    local regs = PCSX.getRegisters()
    local r = regs.GPR.n
    emit(string.format(
      "f=%d pc=%s ra=%s a0=%s a1=%s a2=%s a3=%s s0=%s s1=%s s2=%s s3=%s sp=%s",
      DNA_MESH_FRAME, hex(regs.pc), hex(r.ra), hex(r.a0), hex(r.a1), hex(r.a2),
      hex(r.a3), hex(r.s0), hex(r.s1), hex(r.s2), hex(r.s3), hex(r.sp)))
  end
  return false
end)

DNA_MESH_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_MESH_DONE then return end
  DNA_MESH_FRAME = DNA_MESH_FRAME + 1
  if DNA_MESH_FRAME >= 920 or DNA_MESH_COUNT >= 2000 then
    DNA_MESH_DONE = true
    if traceFile then traceFile:close(); traceFile = nil end
    print(string.format("DNA_MESH_DONE frames=%d events=%d", DNA_MESH_FRAME,
      DNA_MESH_COUNT))
  end
end)

PCSX.resumeEmulator()
print("DNA_MESH_ARMED")
