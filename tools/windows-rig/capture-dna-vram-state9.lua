-- Capture true VRAM plus on-screen output across the persistent DNA core
-- flight. State 9 begins after the user's DNA DV confirmation.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local targets = { [500]=true, [550]=true, [600]=true, [650]=true,
  [700]=true, [750]=true, [800]=true, [850]=true }

DNA_VRAM9_FRAME = 0
DNA_VRAM9_DONE = false

local function capture(frame)
  local name = string.format("dna_vram9_%04d", frame)
  local screen = PCSX.GPU.takeScreenShot()
  local sf = Support.File.open("C:/dw3-rig/shots/" .. name .. ".raw", "TRUNCATE")
  sf:write(screen.data)
  sf:close()
  local ss = PCSX.createSaveState()
  local vf = Support.File.open("C:/dw3-rig/dumps/" .. name .. ".sav", "TRUNCATE")
  vf:write(ss)
  vf:close()
  print("DNA_VRAM9_CAPTURE " .. name)
end

DNA_VRAM9_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_VRAM9_DONE then return end
  DNA_VRAM9_FRAME = DNA_VRAM9_FRAME + 1
  if targets[DNA_VRAM9_FRAME] then pcall(capture, DNA_VRAM9_FRAME) end
  if DNA_VRAM9_FRAME >= 860 then
    DNA_VRAM9_DONE = true
    print("DNA_VRAM9_DONE")
  end
end)

PCSX.resumeEmulator()
print("DNA_VRAM9_ARMED")
