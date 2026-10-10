-- One-shot, listener-driven capture of the existing mid-DNA GUI savestate.
-- Keeps all framebuffer reads inside one GPU::Vsync callback; repeated RPC
-- screenshot calls are forbidden on pinned Redux build 314 because they crash it.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate8"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local frame = 0
local done = false
DNA_CAPTURE_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if done then return end
  frame = frame + 1
  local ok, err = pcall(function()
    if frame % 15 == 0 then shot("dna_auth_f" .. frame) end
    if frame >= 480 then
      done = true
      PCSX.pauseEmulator()
      print("DNA_CAPTURE_DONE frames=" .. frame)
    end
  end)
  if not ok then
    done = true
    PCSX.pauseEmulator()
    print("DNA_CAPTURE_ERR " .. tostring(err))
  end
end)

PCSX.resumeEmulator()
print("DNA_CAPTURE_ARMED")
