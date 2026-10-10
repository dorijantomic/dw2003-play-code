-- Visible, player-owned BizHawk entry: existing helpers/bridge plus control guard.
local root = (os.getenv("BIZHAWK_RIG_ROOT") or "C:/bizhawk-rig")
  :gsub("\\", "/"):gsub("/+$", "")
BIZHAWK_RIG_ROOT = root
dofile(root .. "/bizhawk-agent-interface.lua")
dofile(root .. "/player-control.lua")
dofile(root .. "/bridge-portable.lua")
rig_player_status()
