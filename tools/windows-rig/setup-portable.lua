-- Portable DW2003 rig helpers for PCSX-Redux.
--
-- This file intentionally avoids Linux-only paths. It expects:
--   DW3_RIG_ROOT/states/SLES03936.sstateN
--   DW3_RIG_ROOT/dumps/
--   DW3_RIG_ROOT/shots/

local function slash(path)
  return tostring(path):gsub("\\", "/"):gsub("/+$", "")
end

DW3_RIG_ROOT = slash(os.getenv("DW3_RIG_ROOT") or DW3_RIG_ROOT or "C:/dw3-rig")

local mem = PCSX.getMemPtr()

function rd8(addr)
  return mem[bit.band(addr, 0x1fffff)]
end

function rd16(addr)
  local off = bit.band(addr, 0x1fffff)
  return mem[off] + mem[off + 1] * 256
end

function rd32(addr)
  local off = bit.band(addr, 0x1fffff)
  local b0, b1, b2, b3 = mem[off], mem[off + 1], mem[off + 2], mem[off + 3]
  return b0 + b1 * 256 + b2 * 65536 + b3 * 16777216
end

function wr8(addr, value)
  mem[bit.band(addr, 0x1fffff)] = bit.band(value, 0xff)
end

function wr16(addr, value)
  local off = bit.band(addr, 0x1fffff)
  mem[off] = bit.band(value, 0xff)
  mem[off + 1] = bit.band(bit.rshift(value, 8), 0xff)
end

function wr32(addr, value)
  local off = bit.band(addr, 0x1fffff)
  mem[off] = bit.band(value, 0xff)
  mem[off + 1] = bit.band(bit.rshift(value, 8), 0xff)
  mem[off + 2] = bit.band(bit.rshift(value, 16), 0xff)
  mem[off + 3] = bit.band(bit.rshift(value, 24), 0xff)
end

BTN = {
  UP = 4,
  RIGHT = 5,
  DOWN = 6,
  LEFT = 7,
  X = 14,
  CIRCLE = 13,
  SQUARE = 15,
  TRIANGLE = 12,
  START = 3,
  SELECT = 0,
}

PRESSQ = PRESSQ or {}

function press(btn, frames)
  PRESSQ[#PRESSQ + 1] = { btn = btn, n = frames or 4 }
end

local pad = PCSX.SIO0.slots[1].pads[1]
PRESS_LISTENER = PRESS_LISTENER or PCSX.Events.createEventListener("GPU::Vsync", function()
  local q = PRESSQ[1]
  if q then
    pad.setOverride(q.btn)
    q.n = q.n - 1
    if q.n <= 0 then
      pad.clearOverride(q.btn)
      table.remove(PRESSQ, 1)
    end
  end
end)

-- THE RIG STATES DIRECTORY IS NOT THE GUI SLOTS. C:/dw3-rig/states holds an
-- old mirror (its slot 5 is a Digivolve screen from 2026-07-11); the slots the
-- GUI hotkeys write, and the ones every research document means by "GUI slot
-- N", live in AppData. Loading the wrong one silently puts the rig on a
-- different screen and every capture taken from it is about nothing -- that
-- cost a card-duel run on 2026-08-24. Use loadgui() for a documented slot.
function loadstate(n)
  local path = DW3_RIG_ROOT .. "/states/SLES03936.sstate" .. tostring(n)
  PCSX.loadSaveState(Support.File.zReader(Support.File.open(path)))
end

DW3_GUI_STATES = DW3_GUI_STATES or "C:/Users/dorij/AppData/Roaming/pcsx-redux"

-- Load a GUI hotkey slot -- the slot the research documents mean.
function loadgui(n)
  local path = DW3_GUI_STATES .. "/SLES03936.sstate" .. tostring(n)
  PCSX.loadSaveState(Support.File.zReader(Support.File.open(path)))
end

function dumpram(name)
  local f = io.open(DW3_RIG_ROOT .. "/dumps/" .. name, "wb")
  for i = 0, 0x1fffff, 65536 do
    local t = {}
    for j = 0, 65535 do
      t[#t + 1] = string.char(mem[i + j])
    end
    f:write(table.concat(t))
  end
  f:close()
end

-- takeScreenShot returns { data = Slice, width, height, bpp } — io.open
-- f:write(table) throws. Write the Slice through Support.File instead
-- (fixed 2026-07-13; the old io.write-the-table version crashed every call).
function shot(name)
  local s = PCSX.GPU.takeScreenShot()
  local f = Support.File.open(DW3_RIG_ROOT .. "/shots/" .. name .. ".raw", "TRUNCATE")
  f:write(s.data)
  f:close()
  return s.width, s.height
end

-- Full savestate to DW3_RIG_ROOT/dumps/<name>.sav. These files are for
-- OFFLINE parsing only (tools/windows-rig/savestate_vram.py reads the true
-- VRAM out of them) — loading one back via PCSX.loadSaveState crashes this
-- build. GUI-hotkey slot states (AppData) load fine via loadstate-style
-- zReader.
function savestate(name)
  local ss = PCSX.createSaveState()
  local f = Support.File.open(DW3_RIG_ROOT .. "/dumps/" .. name .. ".sav", "TRUNCATE")
  f:write(ss)
  f:close()
end

print("portable helpers ok root=" .. DW3_RIG_ROOT)
