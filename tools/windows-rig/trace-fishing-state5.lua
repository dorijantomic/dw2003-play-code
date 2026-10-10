-- Controlled fishing-spot interaction trace from the currently loaded GUI
-- slot 5. Junior must remain in the preflight position at (956,597), facing
-- the nearby NPC. setup-portable.lua must already be loaded.

local POLE_ADDR = 0x80048db5
local hasPole = rd8(POLE_ADDR) ~= 0
local RUN = hasPole and "with_pole" or "without_pole"
local OUT = "C:/dw3-rig/dumps/fishing_state5_cross_" .. RUN .. "_trace.txt"
local OBJECTS = 0x8004b610
local SCENE_LOCK = 0x80099dd8
local SCENE_MOVE_LOCK = 0x80099de0
local MAX_FRAMES = 150
local PRESS_AT = 10
local RELEASE_AT = 14
local FLUSH_EVERY = 30

if FISHING_STATE5_LISTENER then
  FISHING_STATE5_LISTENER:remove()
  FISHING_STATE5_LISTENER = nil
end

local function u32(v) return bit.band(v, 0xffffffff) end
local function hex(v) return string.format("%08x", u32(v)) end
local function validPtr(p) return p >= 0x80000000 and p < 0x80200000 end

local leader
for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  if validPtr(p) and rd32(p) == 5 and rd32(p + 8) == 0 then
    leader = p
    break
  end
end
assert(leader, "leader actor not found")
assert(rd32(leader + 0x58) == 956 and rd32(leader + 0x5c) == 597,
  "state 5 preflight position changed")

local transitionHolder = rd32(leader + 0x24)
assert(validPtr(transitionHolder), "leader transition holder not found")

local slots, tracked = {}, {}
for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  slots[i] = p
  if validPtr(p) then
    local last = {}
    for off = 0, 0x15c - 4, 4 do last[off] = rd32(p + off) end
    tracked[p] = { slot = i, type = rd32(p), last = last }
  end
end

local lines = {
  "# Fishing spot state 5 controlled Cross trace",
  "# one Cross press; no savestate load, breakpoints, or full-RAM scan",
  string.format("# FishingPole[%s]=%d", hex(POLE_ADDR), rd8(POLE_ADDR)),
  string.format("# leader=%s start=(%d,%d) facing=%d handler=%s holder=%s",
    hex(leader), rd32(leader + 0x58), rd32(leader + 0x5c),
    rd32(leader + 0x60), hex(rd32(leader + 0x108)), hex(transitionHolder)),
  string.format("# press_frame=%d release_frame=%d max_frames=%d",
    PRESS_AT, RELEASE_AT, MAX_FRAMES),
  "# summary: frame mode x y facing handler lock move_lock transition transition_state",
  "# change: frame slot type ptr offset old new",
}

local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  f:close()
end

local pad = PCSX.SIO0.slots[1].pads[1]
local frame = 0

local function finish(reason)
  pad.clearOverride(BTN.X)
  lines[#lines + 1] = string.format("# finish=%s frame=%d", reason, frame)
  flush()
  if FISHING_STATE5_LISTENER then
    FISHING_STATE5_LISTENER:remove()
    FISHING_STATE5_LISTENER = nil
  end
  print("FISHING_STATE5_TRACE_DONE " .. reason .. " frame=" .. tostring(frame))
end

FISHING_STATE5_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  local ok, err = pcall(function()
    frame = frame + 1
    if frame == PRESS_AT then
      pad.setOverride(BTN.X)
      lines[#lines + 1] = "# input frame=10 X=1"
    elseif frame == RELEASE_AT then
      pad.clearOverride(BTN.X)
      lines[#lines + 1] = "# input frame=14 X=0"
    end

    local transition = rd32(transitionHolder + 8)
    local transitionState = validPtr(transition) and rd32(transition + 0xc) or 0
    lines[#lines + 1] = string.format(
      "%04d summary %x %d %d %d %s %08x %08x %s %x",
      frame, rd32(leader + 0x10), rd32(leader + 0x58),
      rd32(leader + 0x5c), rd32(leader + 0x60),
      hex(rd32(leader + 0x108)), rd32(SCENE_LOCK),
      rd32(SCENE_MOVE_LOCK), hex(transition), transitionState)

    for i = 0, 99 do
      local p = rd32(OBJECTS + i * 4)
      if validPtr(p) and not tracked[p] then
        local last = {}
        for off = 0, 0x15c - 4, 4 do last[off] = rd32(p + off) end
        tracked[p] = { slot = i, type = rd32(p), last = last }
        lines[#lines + 1] = string.format(
          "%04d new_object slot=%d type=%x ptr=%s", frame, i, rd32(p), hex(p))
      end
    end

    for p, obj in pairs(tracked) do
      if rd32(OBJECTS + obj.slot * 4) == p then
        for off = 0, 0x15c - 4, 4 do
          local now, old = rd32(p + off), obj.last[off]
          if now ~= old then
            lines[#lines + 1] = string.format(
              "%04d change %d %x %s %03x %s %s",
              frame, obj.slot, obj.type, hex(p), off, hex(old), hex(now))
            obj.last[off] = now
          end
        end
      end
    end

    if frame == 45 or frame == 90 or frame == 140 then
      shot("fishing_state5_cross_" .. RUN .. "_f" .. tostring(frame))
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
print("FISHING_STATE5_TRACE_ARMED out=" .. OUT)
