-- Re-arm mesh-render breakpoints every vsync. Redux's dynarec invalidates an
-- Exec breakpoint after the first compiled-block hit on this build, so a
-- one-shot breakpoint falsely reports that clip 12 stops drawing meshes.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end
local out = io.open("C:/dw3-rig/dumps/dna_mesh_rearm_state9.log", "w")
local frame, done, bps = 0, false, {}
local seen = {}

local function emit(s)
  if out then out:write(s .. "\n"); out:flush() end
end

local function clear()
  for _, bp in ipairs(bps) do pcall(function() bp:remove() end) end
  bps = {}
end

local function arm(addr, name)
  bps[#bps + 1] = PCSX.addBreakpoint(addr, "Exec", 4, "dna_mesh_" .. name,
    function()
      local r = PCSX.getRegisters().GPR.n
      local key = string.format("%d:%s:%08x:%08x", math.floor(frame / 10), name,
        bit.band(r.ra, 0xffffffff), bit.band(r.a0, 0xffffffff))
      if not seen[key] then
        seen[key] = true
        emit(string.format("f=%d fn=%s ra=%s a0=%s a1=%s a2=%s a3=%s s0=%s s1=%s s2=%s s3=%s",
          frame, name, hex(r.ra), hex(r.a0), hex(r.a1), hex(r.a2), hex(r.a3),
          hex(r.s0), hex(r.s1), hex(r.s2), hex(r.s3)))
      end
      return false
    end)
end

local function shot(n)
  local s = PCSX.GPU.takeScreenShot()
  local f = Support.File.open(string.format("C:/dw3-rig/shots/dna_mesh_%04d.raw", n), "TRUNCATE")
  f:write(s.data); f:close()
end

DNA_MESH_REARM_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if done then return end
  frame = frame + 1
  clear()
  arm(0x80085110, "mesh_a")
  arm(0x80085958, "mesh_b")
  if frame >= 300 and frame <= 720 and frame % 20 == 0 then pcall(shot, frame) end
  if frame >= 740 then
    done = true; clear()
    if out then out:close(); out = nil end
    print("DNA_MESH_REARM_DONE")
  end
end)

PCSX.resumeEmulator()
print("DNA_MESH_REARM_ARMED")
