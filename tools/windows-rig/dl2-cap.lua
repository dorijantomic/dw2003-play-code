-- Single-shot probe of FIGHTSTG_F0x800847f4 (the mesh colour / NCS path,
-- fightstg.s:1777). Captures the routine's input node ($a0) and every field it
-- reads, so the values it programs into COP2 and consumes from COP2 can be
-- reconstructed from their exact sources. BizHawk exposes GPRs only (no COP2
-- read API), so the coprocessor file itself is not read here.
--
-- Bounded: logs at most MAX hits, then unregisters inside the callback.
-- Scope "System Bus" + full 0x800 address (the only convention that fires).
--
-- Arm:  tools/windows-rig/bizhawk-rpc tools/windows-rig/dl2-cap.lua
-- Read: tools/windows-rig/bizhawk-rpc "DL2.dump()"

pcall(function() event.unregisterbyname("dl2_cap") end)
DL2 = { hits = {}, armed = false, done = false }
local MAX = 8
local n = 0

local function r32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end
local function r16(a) return memory.read_u16_le(bit.band(a, 0x1fffff), "MainRAM") end
local function r8(a)  return memory.read_u8(bit.band(a, 0x1fffff), "MainRAM") end

local function on_hit()
  if n >= MAX then return end
  local ok, r = pcall(emu.getregisters)
  if not ok or type(r) ~= "table" then return end
  n = n + 1
  local a0 = bit.band(r.a0 or 0, 0xffffffff)
  local p64 = r32(a0 + 0x64)
  local p80 = r32(a0 + 0x80)
  local cnt = (p64 >= 0x80000000 and p64 < 0x80200000) and r16(p64) or -1
  local row = string.format(
    "hit=%d f=%d a0=%08x n54=%04x n58=%02x%02x%02x n64=%08x cnt=%d n80=%08x " ..
    "n84=%04x,%04x,%04x,%04x,%04x,%04x,%04x,%04x,%04x n98=%04x,%04x,%04x,%04x",
    n, emu.framecount(), a0, r16(a0 + 0x54),
    r8(a0 + 0x58), r8(a0 + 0x59), r8(a0 + 0x5a), p64, cnt, p80,
    r16(a0+0x84), r16(a0+0x86), r16(a0+0x88), r16(a0+0x8a), r16(a0+0x8c),
    r16(a0+0x8e), r16(a0+0x90), r16(a0+0x92), r16(a0+0x94),
    r16(a0+0x98), r16(a0+0x9a), r16(a0+0x9c), r16(a0+0x9e))
  -- first data record (the NCS input pair at the tail)
  if cnt > 0 and p64 >= 0x80000000 and p64 < 0x80200000 then
    row = row .. string.format(" rec0=%02x%02x%02x%02x%02x%02x",
      r8(p64+6), r8(p64+7), r8(p64+8), r8(p64+9), r8(p64+10), r8(p64+11))
  end
  DL2.hits[n] = row
  if n >= MAX then
    pcall(function() event.unregisterbyname("dl2_cap") end)
    DL2.done = true
  end
end

event.onmemoryexecute(on_hit, 0x800847f4, "dl2_cap", "System Bus")
DL2.armed = true
print("DL2 armed at 0x800847f4 frame=" .. tostring(emu.framecount()))

function DL2.dump()
  print(string.format("DL2 entries=%d done=%s", #DL2.hits, tostring(DL2.done)))
  for i = 1, #DL2.hits do print(DL2.hits[i]) end
  print("CONST 0x800812f8 (COP2 ctrl $0-$4 + $5-$7 source):")
  for i = 0, 7 do print(string.format("  c%02x = %08x", i*4, r32(0x800812f8 + i*4))) end
end

function DL2.stop()
  pcall(function() event.unregisterbyname("dl2_cap") end)
  DL2.armed = false
  print("DL2 stopped entries=" .. #DL2.hits)
end
