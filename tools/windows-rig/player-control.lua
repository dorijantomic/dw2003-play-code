-- Player-owned BizHawk session. Observation stays available; control is explicit.
-- This prevents accidental use of the normal mutation helpers, not hostile Lua.
assert(type(emu) == "table" and type(joypad) == "table" and PCSX == nil,
  "This player session requires BizHawk; Redux recorders need their own emulator.")

if RIG_PLAYER_CONTROL then
  RIG_PLAYER_CONTROL.set("human")
  return
end

local mode = "human"
local clear = assert(releaseAll, "Load the BizHawk agent interface first")
clear()

local function guarded(owner, key, description)
  local original = owner[key]
  if type(original) ~= "function" then return end
  owner[key] = function(...)
    if mode ~= "agent" then
      error("You are controlling the game. Agent action blocked: " .. description ..
        ". Use rig_control('agent') only after the user requests a controlled action.", 2)
    end
    return original(...)
  end
end

for _, key in ipairs({"press", "wr8", "wr16", "wr32", "loadstate", "pause", "resume"}) do
  guarded(_G, key, key)
end
for _, key in ipairs({"set", "setanalog"}) do guarded(joypad, key, "joypad." .. key) end
if type(savestate) == "table" then guarded(savestate, "load", "load a saved state") end
if type(client) == "table" then
  guarded(client, "pause", "pause the game")
  guarded(client, "unpause", "resume the game")
end

local function set_control(next_mode)
  assert(next_mode == "human" or next_mode == "agent", "Control must be human or agent")
  clear() -- queued presses must not survive either handoff
  mode = next_mode
  print("PLAYER CONTROL " .. mode)
  return mode
end

RIG_PLAYER_CONTROL = {set = set_control}
function rig_control(next_mode)
  if next_mode ~= nil then return set_control(next_mode) end
  return mode
end

function rig_player_status()
  print("PLAYER SESSION emulator=BizHawk control=" .. mode ..
    " session=" .. tostring(os.getenv("DW3_PLAYER_SESSION") or "unknown") ..
    " frame=" .. tostring(emu.framecount()))
end

print("You control the game. The agent can observe; no recording has been armed.")
