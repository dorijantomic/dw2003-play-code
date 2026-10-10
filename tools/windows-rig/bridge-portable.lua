-- Portable file-based RPC bridge for PCSX-Redux.
--
-- On Windows, launch Redux with DW3_RIG_ROOT=C:/dw3-rig and -dofile this file.
-- The WSL-side rpc-windows.sh script writes commands into RIG_ROOT/rpc.

local function slash(path)
  return tostring(path):gsub("\\", "/"):gsub("/+$", "")
end

DW3_RIG_ROOT = slash(os.getenv("DW3_RIG_ROOT") or "C:/dw3-rig")

local rpcdir = DW3_RIG_ROOT .. "/rpc/"

local function poll()
  local f = io.open(rpcdir .. "cmd.ready", "r")
  if not f then return end
  f:close()
  os.remove(rpcdir .. "cmd.ready")

  local out = {}
  local oldprint = print
  print = function(...)
    local parts = {}
    for i = 1, select("#", ...) do
      parts[#parts + 1] = tostring(select(i, ...))
    end
    out[#out + 1] = table.concat(parts, "\t")
    oldprint(...)
  end

  local ok, err = pcall(dofile, rpcdir .. "cmd.lua")
  print = oldprint
  if not ok then out[#out + 1] = "ERROR: " .. tostring(err) end

  local r = io.open(rpcdir .. "res.txt", "w")
  r:write(table.concat(out, "\n"))
  r:close()

  local rd = io.open(rpcdir .. "res.ready", "w")
  rd:write("1")
  rd:close()
end

BRIDGE_VSYNC = PCSX.Events.createEventListener("GPU::Vsync", poll)

local function tickloop()
  poll()
  PCSX.nextTick(tickloop)
end
pcall(tickloop)

print("BRIDGE READY portable root=" .. DW3_RIG_ROOT)
