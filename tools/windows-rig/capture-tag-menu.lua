-- One-shot inspection capture of the authentic GUI Tag-menu savestate.
local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate6"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local frame = 0
TAG_MENU_CAPTURE = PCSX.Events.createEventListener("GPU::Vsync", function()
  frame = frame + 1
  if frame == 2 then shot("tag_menu_state6") end
end)

PCSX.resumeEmulator()
print("TAG_MENU_CAPTURE_ARMED")
