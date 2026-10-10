-- Arm opcode-1 value capture on an already-loaded battle state.
-- This script does not load a state and does not press any buttons.

local ROOT = (os.getenv("DW3_RIG_ROOT") or "C:/dw3-rig"):gsub("\\", "/")
local OUT = ROOT .. "/dumps/op1-hammer-rush-live.txt"
local mem = PCSX.getMemPtr()

local function rd16(addr)
  local p = bit.band(addr, 0x1fffff)
  return mem[p] + mem[p + 1] * 256
end

local function rd32(addr)
  local p = bit.band(addr, 0x1fffff)
  return mem[p] + mem[p + 1] * 256 + mem[p + 2] * 65536 + mem[p + 3] * 16777216
end

local function s16(v)
  return v >= 0x8000 and v - 0x10000 or v
end

local function hex(v)
  return string.format("%08x", bit.band(v or 0, 0xffffffff))
end

local function append(fmt, ...)
  local f = assert(io.open(OUT, "a"))
  f:write(string.format(fmt, ...), "\n")
  f:close()
end

local f = assert(io.open(OUT, "w"))
f:write("armed\n")
f:close()

OP1_LIVE_CURRENT = nil
OP1_LIVE_BPS = OP1_LIVE_BPS or {}

OP1_LIVE_BPS[#OP1_LIVE_BPS + 1] = PCSX.addBreakpoint(
  0x8008b69c, "Exec", 4, "op1_live_entry", function()
    local r = PCSX.getRegisters().GPR.n
    local parent, owner = r.a0, r.a1
    local operand = rd32(parent + 0x8c)
    local mode = s16(rd16(operand))
    OP1_LIVE_CURRENT = { parent = parent, owner = owner, mode = mode }
    append(
      "entry mode=%d parent=%s owner=%s operand=%s p58=%d p5c=%d p60=%d p64=%d p90=%d",
      mode, hex(parent), hex(owner), hex(operand), rd32(parent + 0x58),
      rd32(parent + 0x5c), rd32(parent + 0x60), rd32(parent + 0x64),
      rd32(parent + 0x90))
    return false
  end)

OP1_LIVE_BPS[#OP1_LIVE_BPS + 1] = PCSX.addBreakpoint(
  0x8008b7e0, "Exec", 4, "op1_live_exit", function()
    local c = OP1_LIVE_CURRENT
    if c then
      local child = rd32(c.owner + 0x3c)
      append("exit mode=%d child=%s child50=%d child54=%d",
        c.mode, hex(child), child ~= 0 and rd32(child + 0x50) or -1,
        child ~= 0 and rd32(child + 0x54) or -1)
      OP1_LIVE_CURRENT = nil
    end
    return false
  end)

PCSX.resumeEmulator()
print("OP1_LIVE_ARMED")
