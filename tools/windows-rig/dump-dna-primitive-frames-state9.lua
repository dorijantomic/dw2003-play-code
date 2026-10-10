-- Dump complete RAM primitive buffers at deterministic DNA keyframes.
-- Used when build-314 dynarec breakpoints cannot observe the low-level GPU
-- submission path. The refreshed AppData state 9 starts the presentation with
-- no pad input.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local mem = PCSX.getMemPtr()
local targets = { [300]=true, [500]=true, [600]=true, [700]=true, [800]=true, [850]=true }

DNA_PDUMP_FRAME = 0
DNA_PDUMP_DONE = false

local function dumpRam(name)
  local f = io.open("C:/dw3-rig/dumps/" .. name .. ".ram", "wb")
  for base = 0, 0x1fffff, 65536 do
    local bytes = {}
    for i = 0, 65535 do bytes[#bytes + 1] = string.char(mem[base + i]) end
    f:write(table.concat(bytes))
  end
  f:close()
end

local function screenshot(name)
  local s = PCSX.GPU.takeScreenShot()
  local f = Support.File.open("C:/dw3-rig/shots/" .. name .. ".raw", "TRUNCATE")
  f:write(s.data)
  f:close()
end

DNA_PDUMP_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_PDUMP_DONE then return end
  DNA_PDUMP_FRAME = DNA_PDUMP_FRAME + 1

  if targets[DNA_PDUMP_FRAME] then
    local name = string.format("dna_primitive_%04d", DNA_PDUMP_FRAME)
    pcall(screenshot, name)
    dumpRam(name)
    print("DNA_PDUMP " .. name)
  end

  if DNA_PDUMP_FRAME >= 860 then
    DNA_PDUMP_DONE = true
    print("DNA_PDUMP_DONE")
  end
end)

PCSX.resumeEmulator()
print("DNA_PDUMP_ARMED")
