-- Replay the refreshed AppData state 9 and stop on an exact native vsync while
-- Redux's GUI GPU Logger retains that frame's complete GP0 command stream.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
local target = tonumber(DNA_GPU_LOG_TARGET) or 700

PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

DNA_GPU_LOG_FRAME = 0
DNA_GPU_LOG_DONE = false
DNA_GPU_LOG_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_GPU_LOG_DONE then return end
  DNA_GPU_LOG_FRAME = DNA_GPU_LOG_FRAME + 1
  if DNA_GPU_LOG_FRAME >= target then
    DNA_GPU_LOG_DONE = true
    local f = io.open("C:/dw3-rig/dumps/dna_gpu_logger_paused.txt", "w")
    if f then
      f:write(string.format("paused frame=%d target=%d\n", DNA_GPU_LOG_FRAME, target))
      f:close()
    end
    PCSX.pauseEmulator()
    print(string.format("DNA_GPU_LOG_PAUSED frame=%d", DNA_GPU_LOG_FRAME))
  end
end)

PCSX.resumeEmulator()
print("DNA_GPU_LOG_ARMED target=" .. target)
