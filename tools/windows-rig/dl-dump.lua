-- Dump a display-list buffer and decode it against FIGHTSTG_F0x80085110.
-- Set DL_ADDR (and optional DL_LEN) then run this file.
--
-- Rules read from fightstg.s:2507-2912 (the dispatch loop, load base 0x80082cb0):
--   opcode byte b; hi=b>>4; lo=b&0xf
--   b == 0xff                 -> terminate
--   hi == 0, lo == 0           -> mesh emit; advance = (s3c+3)*(1+(s40?1:0)+(s30?2:0))
--   hi == 0, lo == 1           -> render-state packet; advance 7
--   hi == 0, lo in 2..5        -> colour packet; advance 4
--   hi == 0, lo in 6..15       -> NOT COVERED (loop re-reads same byte: no advance)
--   hi in 8..14                -> set state slot (8->s3c 9->s30 A->s38 B->s34
--                                 C->s40 D->s44 E->s48) = lo; advance 1
--   hi in 1..7 or 15           -> NOT COVERED by table: advance 1, no effect

local addr = DL_ADDR
local len  = DL_LEN or 288
assert(addr, "set DL_ADDR first")

local function rd(a) return memory.read_u8(bit.band(a, 0x1fffff), "MainRAM") end
local function r32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end

print(string.format("dl addr=%08x len=%d frame=%d", addr, len, emu.framecount()))

-- raw hex, 16 rows of 16
for row = 0, math.ceil(len/16) - 1 do
  local b = {}
  for i = 0, 15 do
    b[#b+1] = string.format("%02x", rd(addr + row*16 + i))
  end
  print(string.format("%04x: %s", row*16, table.concat(b, " ")))
end

-- decode
local s30, s34, s38, s3c, s40, s44, s48 = 0,0,0,0,0,0,0
local cur, guard = addr, 0
print("--- opcode stream (cursor advance per decoded rules) ---")
while guard < 200 do
  guard = guard + 1
  local b = rd(cur)
  local off = cur - addr
  if b == 0xff then
    print(string.format("  +%04x: %02x TERMINATOR", off, b))
    break
  end
  local hi, lo = math.floor(b/16), b % 16
  local desc, adv
  if hi == 0 and lo == 0 then
    -- The handler pre-increments the cursor past the opcode byte (0x85568)
    -- before the advance block, so the opcode costs 1 + (s3c+3)*k bytes.
    adv = 1 + (s3c + 3) * (1 + (s40 ~= 0 and 1 or 0) + (s30 ~= 0 and 2 or 0))
    desc = string.format("MESH  s3c=%d s40=%d s30=%d", s3c, s40, s30)
  elseif hi == 0 and lo == 1 then
    adv, desc = 7, "STATE/prim packet"
  elseif hi == 0 and lo >= 2 and lo <= 5 then
    adv, desc = 4, "COLOUR packet"
  elseif hi == 0 then
    adv, desc = nil, "UNCOVERED (loop re-reads: no advance)"
  elseif hi >= 8 and hi <= 14 then
    if hi == 8 then s3c = lo elseif hi == 9 then s30 = lo elseif hi == 10 then s38 = lo
    elseif hi == 11 then s34 = lo elseif hi == 12 then s40 = lo elseif hi == 13 then s44 = lo
    else s48 = lo end
    adv, desc = 1, string.format("SET slot hi=%x -> %d", hi, lo)
  else
    adv, desc = 1, "UNCOVERED (table skip)"
  end
  print(string.format("  +%04x: %02x %s adv=%s", off, b, desc, tostring(adv)))
  if adv == nil then print("    -> undefined: loop would not advance"); break end
  cur = cur + adv
  if (cur - addr) >= len then print("  (reached dump end before terminator)"); break end
end
