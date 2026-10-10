-- Controlled Ice Dungeon slide trace from the currently loaded GUI slot 1.
--
-- Preconditions:
--   * s735 is live.
--   * Junior is standing at the ice edge near (958,239).
--   * setup-portable.lua has already installed rd32/BTN helpers.
--
-- The trace deliberately avoids exec breakpoints, savestate loads, screenshots,
-- and full-RAM scans because those are unstable in pinned PCSX-Redux build 314.
-- It resolves the four party actors through the engine's 100-slot object table,
-- snapshots their 0x15c-byte structs, taps Down once, and logs every changed word.

local OUT = "C:/dw3-rig/dumps/ice_slide_trace.txt"
local OBJECTS = 0x8004b610
local ACTOR_SIZE = 0x15c
local MAX_FRAMES = 600
local PRESS_AT = 10
local RELEASE_AT = 14
local FLUSH_EVERY = 50

if ICE_SLIDE_LISTENER then
  ICE_SLIDE_LISTENER:remove()
  ICE_SLIDE_LISTENER = nil
end

local function u32(v)
  return bit.band(v, 0xffffffff)
end

local function hex(v)
  return string.format("%08x", u32(v))
end

local actors = {}
for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  if p >= 0x80000000 and p < 0x80200000 and rd32(p) == 5 then
    local partySlot = rd32(p + 8)
    if partySlot == 0 or partySlot == 2 or partySlot == 4 or partySlot == 8 then
      actors[#actors + 1] = {
        ptr = p,
        key = rd32(p + 4),
        partySlot = partySlot,
        last = {},
      }
    end
  end
end

table.sort(actors, function(a, b) return a.partySlot < b.partySlot end)
assert(#actors == 4, "expected four party actors, got " .. tostring(#actors))

local lines = {
  "# Ice Dungeon controlled slide trace",
  "# live s735; one Down tap; no exec breakpoints",
  string.format("# press_frame=%d release_frame=%d max_frames=%d",
    PRESS_AT, RELEASE_AT, MAX_FRAMES),
  "# summary columns: frame actor slot mode xfix yfix x y facing speed lock marker tick",
  "# change columns: frame actor slot offset old new",
}

for _, a in ipairs(actors) do
  lines[#lines + 1] = string.format(
    "# actor slot=%d key=%d ptr=%s start_mode=%x start_x=%d start_y=%d tick=%s",
    a.partySlot, a.key, hex(a.ptr), rd32(a.ptr + 0x10),
    rd32(a.ptr + 0x58), rd32(a.ptr + 0x5c), hex(rd32(a.ptr + 0x108)))
  for off = 0, ACTOR_SIZE - 4, 4 do
    a.last[off] = rd32(a.ptr + off)
  end
end

local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  f:close()
end

local pad = PCSX.SIO0.slots[1].pads[1]
local frame = 0

local function finish(reason)
  pad.clearOverride(BTN.DOWN)
  lines[#lines + 1] = string.format("# finish=%s frame=%d", reason, frame)
  flush()
  if ICE_SLIDE_LISTENER then
    ICE_SLIDE_LISTENER:remove()
    ICE_SLIDE_LISTENER = nil
  end
  print("ICE_SLIDE_TRACE_DONE " .. reason .. " frame=" .. tostring(frame))
end

ICE_SLIDE_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  local ok, err = pcall(function()
    frame = frame + 1

    if frame == PRESS_AT then
      pad.setOverride(BTN.DOWN)
      lines[#lines + 1] = string.format("# input frame=%d DOWN=1", frame)
    elseif frame == RELEASE_AT then
      pad.clearOverride(BTN.DOWN)
      lines[#lines + 1] = string.format("# input frame=%d DOWN=0", frame)
    end

    for _, a in ipairs(actors) do
      local p = a.ptr
      lines[#lines + 1] = string.format(
        "%04d summary %d %x %08x %08x %d %d %d %08x %08x %08x %08x",
        frame, a.partySlot, rd32(p + 0x10),
        rd32(p + 0x50), rd32(p + 0x54),
        rd32(p + 0x58), rd32(p + 0x5c), rd32(p + 0x60),
        rd32(p + 0x68), rd32(p + 0xbc), rd32(p + 0x84),
        rd32(p + 0x108))

      for off = 0, ACTOR_SIZE - 4, 4 do
        local now = rd32(p + off)
        local old = a.last[off]
        if now ~= old then
          lines[#lines + 1] = string.format(
            "%04d change %d %03x %s %s",
            frame, a.partySlot, off, hex(old), hex(now))
          a.last[off] = now
        end
      end
    end

    if frame % FLUSH_EVERY == 0 then flush() end
    if frame >= MAX_FRAMES then finish("max_frames") end
  end)

  if not ok then
    lines[#lines + 1] = "# error=" .. tostring(err)
    finish("error")
  end
end)

flush()
print("ICE_SLIDE_TRACE_ARMED actors=4 out=" .. OUT)
