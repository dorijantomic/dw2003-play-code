-- Full GPU/RAM oracle from the user's GUI-created state 8, already parked in
-- the persistent Jogress-orb flight.  One injected listener, no pause: build
-- 314 can wedge if a post-restore RPC or pause is attempted.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate8"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

DNA8_DUMP_FRAME = 0
DNA8_DUMP_DONE = false
DNA8_DUMP_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA8_DUMP_DONE then return end
  DNA8_DUMP_FRAME = DNA8_DUMP_FRAME + 1
  if DNA8_DUMP_FRAME == 30 then
    pcall(shot, "dna8_vram_frame0030")
    pcall(savestate, "dna8_vram_frame0030")
    pcall(dumpram, "dna8_vram_frame0030.ram")
    DNA8_DUMP_DONE = true
    print("DNA8_VRAM_DUMP_DONE")
  end
end)

PCSX.resumeEmulator()
print("DNA8_VRAM_DUMP_ARMED")
