-- One-shot confusion outcome trace for GUI hotkey Save State 1.
--
-- Captures only the callback's final threshold/random comparison and the value
-- returned to the joke-menu producer. No RAM dump, screenshot, or frame trace.

local ROOT = (os.getenv("DW3_RIG_ROOT") or "C:/dw3-rig"):gsub("\\", "/")
local STATE = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate1"
local OUT = ROOT .. "/dumps/confusion-outcome.txt"

local trace = {}
local bps = {}
local listener
local frames = 0

local function hex(value)
  return string.format("%08x", bit.band(value, 0xffffffff))
end

local function removeAll()
  for _, bp in ipairs(bps) do
    pcall(function() bp:remove() end)
  end
  bps = {}
  if listener then
    pcall(function() listener:remove() end)
    listener = nil
  end
end

local function finish(reason)
  trace[#trace + 1] = "finish=" .. reason
  local f = assert(io.open(OUT, "w"))
  f:write(table.concat(trace, "\n"), "\n")
  f:close()
  removeAll()
end

PCSX.loadSaveState(Support.File.zReader(Support.File.open(STATE)))

-- Immediately after the callback's RNG call: s0 is the computed threshold and
-- v0 is the unmasked RNG result. The function compares (v0 & 0x7f) < s0.
bps[#bps + 1] = PCSX.addBreakpoint(0x800a19bc, "Exec", 4,
  "confusion_callback_compare", function()
    local r = PCSX.getRegisters().GPR.n
    trace[#trace + 1] = string.format(
      "compare threshold=%d random_raw=%s random7=%d",
      r.s0, hex(r.v0), bit.band(r.v0, 0x7f))
    return false
  end)

-- First instruction after jalr callback returns to the joke-menu producer.
bps[#bps + 1] = PCSX.addBreakpoint(0x8009a9f0, "Exec", 4,
  "confusion_callback_return", function()
    local r = PCSX.getRegisters().GPR.n
    trace[#trace + 1] = string.format(
      "return result=%d actor=%s rows=%s", r.v0, hex(r.s2), hex(r.s3))
    finish("captured")
    return false
  end)

local pad = PCSX.SIO0.slots[1].pads[1]
listener = PCSX.Events.createEventListener("GPU::Vsync", function()
  frames = frames + 1
  if frames == 2 then pad.setOverride(14) end -- X / confirm
  if frames == 6 then pad.clearOverride(14) end
  if frames >= 180 then
    pad.clearOverride(14)
    finish("timeout")
  end
end)

PCSX.resumeEmulator()
print("CONFUSION_OUTCOME_ARMED")
