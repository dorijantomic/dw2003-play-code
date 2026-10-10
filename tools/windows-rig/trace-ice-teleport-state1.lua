-- Controlled s735 launch-pad / op-13 trace from the currently loaded GUI slot 1.
--
-- Preconditions:
--   * s735 is live.
--   * Junior is one Down step from the pad near (484,656).
--   * setup-portable.lua has installed rd32/BTN.
--
-- This is intentionally lighter than the slide trace: one actor struct, party
-- summaries, the nearest type-0x17 pad object, object-table additions, and any
-- newly created controller whose +0x50 points at the leader.

local OUT = "C:/dw3-rig/dumps/ice_teleport_trace.txt"
local OBJECTS = 0x8004b610
local SCENE_LOCK = 0x80099dd8
local SCENE_MOVE_LOCK = 0x80099de0
local ACTOR_SIZE = 0x15c
local MAX_FRAMES = 300
local PRESS_AT = 10
local RELEASE_AT = 14
local FLUSH_EVERY = 60

if ICE_TELEPORT_LISTENER then
  ICE_TELEPORT_LISTENER:remove()
  ICE_TELEPORT_LISTENER = nil
end

local function u32(v) return bit.band(v, 0xffffffff) end
local function hex(v) return string.format("%08x", u32(v)) end
local function validPtr(p) return p >= 0x80000000 and p < 0x80200000 end

local party = {}
local leader
for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  if validPtr(p) and rd32(p) == 5 then
    local slot = rd32(p + 8)
    if slot == 0 or slot == 2 or slot == 4 or slot == 8 then
      party[#party + 1] = { ptr = p, slot = slot }
      if slot == 0 then leader = p end
    end
  end
end
assert(leader, "leader actor not found")
table.sort(party, function(a, b) return a.slot < b.slot end)
local transitionHolder = rd32(leader + 0x24)
assert(validPtr(transitionHolder), "leader transition holder not found")

local padObject
local padDistance = 0x7fffffff
local lx, ly = rd32(leader + 0x58), rd32(leader + 0x5c)
for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  if validPtr(p) and rd32(p) == 0x17 then
    local dx = math.abs(lx - rd32(p + 4))
    local dy = math.abs(ly - rd32(p + 8))
    local distance = dx + dy * 2
    if distance < padDistance then
      padDistance = distance
      padObject = p
    end
  end
end
assert(padObject, "nearest type-0x17 pad object not found")

local baselineObjects = {}
for i = 0, 99 do baselineObjects[i] = rd32(OBJECTS + i * 4) end

local actorLast = {}
for off = 0, ACTOR_SIZE - 4, 4 do actorLast[off] = rd32(leader + off) end

local padLast = {}
for off = 0, 0x74 - 4, 4 do padLast[off] = rd32(padObject + off) end

local tracked = {}
local lines = {
  "# Ice Dungeon s735 launch-pad / teleport trace",
  "# one Down tap; no breakpoints, screenshots, savestate load, or full-RAM scan",
  string.format("# leader=%s start=(%d,%d) facing=%d", hex(leader), lx, ly,
    rd32(leader + 0x60)),
  string.format("# transition_holder=%s", hex(transitionHolder)),
  string.format("# nearest_type17=%s pad=(%d,%d) distance=%d", hex(padObject),
    rd32(padObject + 4), rd32(padObject + 8), padDistance),
  string.format("# press_frame=%d release_frame=%d max_frames=%d",
    PRESS_AT, RELEASE_AT, MAX_FRAMES),
  "# summary: frame leader_mode x y facing handler scene58 scene60 pad_state pad_substate transition transition_state transition_substate",
  "# actor_change: frame offset old new",
  "# object_change: frame object offset old new",
}

local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  f:close()
end

local pad = PCSX.SIO0.slots[1].pads[1]
local frame = 0
local activated = false
local clearedAt

local function addTracked(p, slot)
  local obj = { ptr = p, slot = slot, last = {} }
  for off = 0, 0x74 - 4, 4 do obj.last[off] = rd32(p + off) end
  tracked[#tracked + 1] = obj
  lines[#lines + 1] = string.format(
    "%04d new_object slot=%d ptr=%s type=%x key=%x state=%x owner=%s record=%s",
    frame, slot, hex(p), rd32(p), rd32(p + 4), rd32(p + 0xc),
    hex(rd32(p + 0x50)), hex(rd32(p + 0x54)))
end

local function finish(reason)
  pad.clearOverride(BTN.DOWN)
  lines[#lines + 1] = string.format("# finish=%s frame=%d", reason, frame)
  flush()
  if ICE_TELEPORT_LISTENER then
    ICE_TELEPORT_LISTENER:remove()
    ICE_TELEPORT_LISTENER = nil
  end
  print("ICE_TELEPORT_TRACE_DONE " .. reason .. " frame=" .. tostring(frame))
end

ICE_TELEPORT_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  local ok, err = pcall(function()
    frame = frame + 1
    if frame == PRESS_AT then
      pad.setOverride(BTN.DOWN)
      lines[#lines + 1] = string.format("# input frame=%d DOWN=1", frame)
    elseif frame == RELEASE_AT then
      pad.clearOverride(BTN.DOWN)
      lines[#lines + 1] = string.format("# input frame=%d DOWN=0", frame)
    end

    local scene58 = rd32(SCENE_LOCK)
    local scene60 = rd32(SCENE_MOVE_LOCK)
    if scene58 ~= 0 then activated = true end
    local transition = rd32(transitionHolder + 8)
    local transitionState = validPtr(transition) and rd32(transition + 0xc) or 0
    local transitionSubstate = validPtr(transition) and rd32(transition + 0x10) or 0
    lines[#lines + 1] = string.format(
      "%04d summary %x %d %d %d %s %08x %08x %x %x %s %x %x",
      frame, rd32(leader + 0x10), rd32(leader + 0x58),
      rd32(leader + 0x5c), rd32(leader + 0x60),
      hex(rd32(leader + 0x108)), scene58, scene60,
      rd32(padObject + 0xc), rd32(padObject + 0x10),
      hex(transition), transitionState, transitionSubstate)

    for _, a in ipairs(party) do
      lines[#lines + 1] = string.format(
        "%04d party slot=%d mode=%x x=%d y=%d face=%d handler=%s",
        frame, a.slot, rd32(a.ptr + 0x10), rd32(a.ptr + 0x58),
        rd32(a.ptr + 0x5c), rd32(a.ptr + 0x60), hex(rd32(a.ptr + 0x108)))
    end

    for off = 0, ACTOR_SIZE - 4, 4 do
      local now, old = rd32(leader + off), actorLast[off]
      if now ~= old then
        lines[#lines + 1] = string.format(
          "%04d actor_change %03x %s %s", frame, off, hex(old), hex(now))
        actorLast[off] = now
      end
    end

    for off = 0, 0x74 - 4, 4 do
      local now, old = rd32(padObject + off), padLast[off]
      if now ~= old then
        lines[#lines + 1] = string.format(
          "%04d pad_change %03x %s %s", frame, off, hex(old), hex(now))
        padLast[off] = now
      end
    end

    for i = 0, 99 do
      local p = rd32(OBJECTS + i * 4)
      local known = false
      for _, obj in ipairs(tracked) do
        if obj.ptr == p then known = true break end
      end
      if validPtr(p) and not known and p ~= baselineObjects[i] then
        addTracked(p, i)
      end
    end

    if validPtr(transition) then
      local known = false
      for _, obj in ipairs(tracked) do
        if obj.ptr == transition then known = true break end
      end
      if not known then addTracked(transition, -1) end
    end

    for _, obj in ipairs(tracked) do
      for off = 0, 0x74 - 4, 4 do
        local now, old = rd32(obj.ptr + off), obj.last[off]
        if now ~= old then
          lines[#lines + 1] = string.format(
            "%04d object_change %s %03x %s %s",
            frame, hex(obj.ptr), off, hex(old), hex(now))
          obj.last[off] = now
        end
      end
    end

    if activated and scene58 == 0 then
      if not clearedAt then clearedAt = frame end
      if frame - clearedAt >= 20 then finish("sequence_complete") end
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
print("ICE_TELEPORT_TRACE_ARMED out=" .. OUT)
