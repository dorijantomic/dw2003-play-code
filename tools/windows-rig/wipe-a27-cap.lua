-- Bounded capture of the ordinary stage-change wipe (A27): the iris/tile close
-- and the reopen-over-the-new-field.
--
-- Routines (fieldstg):
--   0x8008A5E4  the wipe state machine (close state 1, open state 2)
--   0x80086CE4  the screen walk (six 128x128 blocks: 3 cols x 2 rows)
--   0x80086060  the tile block  (4 x 64x64 textured sprites)
--   0x800860E8  inside F0x80086060, just after the packet alloc: $v0 holds the
--               4-sprite packet base -> dump the raw packet bytes.
--
-- Every hook uses scope "System Bus" with the full 0x800... address (the only
-- convention that fires on this build) and is BOUNDED: it stops at its cap and
-- unregisters itself inside its own callback. Nothing is left armed.
--
-- Arm:  tools/windows-rig/bizhawk-rpc tools/windows-rig/wipe-a27-cap.lua
-- Read: tools/windows-rig/bizhawk-rpc "WIPE27.dump()"
-- Stop: tools/windows-rig/bizhawk-rpc "WIPE27.stop()"

pcall(function()
  for _, n in ipairs({ "w27_state", "w27_walk", "w27_tile", "w27_pkt" }) do
    event.unregisterbyname(n)
  end
end)

WIPE27 = { log = {}, pkt = {}, counts = { 0, 0, 0, 0 }, armed_at = emu.framecount() }

local MAX_STATE, MAX_WALK, MAX_TILE, MAX_PKT = 120, 120, 300, 6

local function r32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end
local function r8(a) return memory.read_u8(bit.band(a, 0x1fffff), "MainRAM") end

local function mk(name, pc, cap, idx, fmt)
  local function cb()
    if WIPE27.counts[idx] >= cap then
      pcall(function() event.unregisterbyname(name) end)
      return
    end
    local ok, r = pcall(emu.getregisters)
    if not ok or type(r) ~= "table" then return end
    WIPE27.counts[idx] = WIPE27.counts[idx] + 1
    WIPE27.log[#WIPE27.log + 1] = fmt(r, WIPE27.counts[idx])
    if WIPE27.counts[idx] >= cap then
      pcall(function() event.unregisterbyname(name) end)
    end
  end
  event.onmemoryexecute(cb, pc, name, "System Bus")
end

-- The state machine: read the wipe object's own fields.
mk("w27_state", 0x8008A5E4, MAX_STATE, 1, function(r, n)
  local a0 = bit.band(r.a0 or 0, 0xffffffff)
  return string.format(
    "STATE n=%d f=%d a0=%08x a1=%08x st=%d lvl=%d w=%d h=%d open=%d centred=%d",
    n, emu.framecount(), a0, bit.band(r.a1 or 0, 0xffffffff),
    r32(a0 + 0x10), r32(a0 + 0x50), r32(a0 + 0x54), r32(a0 + 0x58),
    r32(a0 + 0x14), r32(a0 + 0x6C))
end)

-- The screen walk: a0 = object id (0x1001), a1 = cover level.
mk("w27_walk", 0x80086CE4, MAX_WALK, 2, function(r, n)
  return string.format("WALK  n=%d f=%d a0=%08x level=%08x",
    n, emu.framecount(), bit.band(r.a0 or 0, 0xffffffff), bit.band(r.a1 or 0, 0xffffffff))
end)

-- The tile block: a1 = block x, a2 = block y, a3 = cover level (colour = a3>>8).
mk("w27_tile", 0x80086060, MAX_TILE, 3, function(r, n)
  local a3 = bit.band(r.a3 or 0, 0xffffffff)
  return string.format("TILE  n=%d f=%d a0=%08x x=%08x y=%08x level=%08x grey=%02x",
    n, emu.framecount(), bit.band(r.a0 or 0, 0xffffffff),
    bit.band(r.a1 or 0, 0xffffffff), bit.band(r.a2 or 0, 0xffffffff), a3, bit.band(a3 >> 8, 0xff))
end)

-- Inside the tile block, dump the 4-sprite packet. $v0 = packet base at 0x800860E8.
mk("w27_pkt", 0x800860E8, MAX_PKT, 4, function(r, n)
  local v0 = bit.band(r.v0 or 0, 0xffffffff)
  local bytes = {}
  if v0 >= 0x80000000 and v0 < 0x80200000 then
    for i = 0, 4 * 0x1c - 1 do
      bytes[#bytes + 1] = string.format("%02x", r8(v0 + i))
    end
  end
  WIPE27.pkt[#WIPE27.pkt + 1] = string.format("PKT n=%d f=%d v0=%08x %s",
    n, emu.framecount(), v0, table.concat(bytes, " "))
  return nil
end)

function WIPE27.dump()
  print(string.format("WIPE27 armed_at=%d counts=%d,%d,%d,%d log=%d pkt=%d",
    WIPE27.armed_at, WIPE27.counts[1], WIPE27.counts[2], WIPE27.counts[3], WIPE27.counts[4],
    #WIPE27.log, #WIPE27.pkt))
  for i = 1, #WIPE27.log do print(WIPE27.log[i]) end
  for i = 1, #WIPE27.pkt do print(WIPE27.pkt[i]) end
end

function WIPE27.stop()
  for _, n in ipairs({ "w27_state", "w27_walk", "w27_tile", "w27_pkt" }) do
    pcall(function() event.unregisterbyname(n) end)
  end
  print("WIPE27 stopped")
end

print("WIPE27 armed frame=" .. tostring(WIPE27.armed_at))
