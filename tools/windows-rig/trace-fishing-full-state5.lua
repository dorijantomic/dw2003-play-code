-- Full-GUI s485 fishing trace from the live GUI slot 5 position.
--
-- Controlled input:
--   frame 10:  press X once to cast
--   frame 14:  release X
--   frame 420: press X once to withdraw
--   frame 424: release X
--
-- Every VSync is logged and screenshotted. The trace is bounded, uses one
-- listener, performs no savestate load, and always clears pad overrides.

local OUT = "C:/dw3-rig/dumps/fishing_full_state5_trace_r3.txt"
local SHOT_PREFIX = "fishing_full_state5_r3_f"
local OBJECTS = 0x8004b610
local SCENE_LOCK = 0x80099dd8
local SCENE_MOVE_LOCK = 0x80099de0
local SAVE_BASE = 0x80048d34
local POLE_ADDR = SAVE_BASE + 0x81
local CATCH_BUDGET = SAVE_BASE + 0x26f8
local INVENTORY_START = SAVE_BASE + 0x7c
local INVENTORY_LENGTH = 0x200
local OBJECT_BYTES = 0x160
local CAST_PRESS = 10
local CAST_RELEASE = 14
local WITHDRAW_PRESS = 420
local WITHDRAW_RELEASE = 424
local MAX_FRAMES = 900
local FLUSH_EVERY = 30
local SHOT_EVERY = 5
local OBJECT_HEAP_START = 0x800a0000
local OBJECT_HEAP_END = 0x800e0000
local BOBBER_TICK = 0x8008d27c

if FISHING_FULL_STATE5_LISTENER then
  FISHING_FULL_STATE5_LISTENER:remove()
  FISHING_FULL_STATE5_LISTENER = nil
end

local function u32(v) return bit.band(v, 0xffffffff) end
local function hex(v) return string.format("%08x", u32(v)) end
local function validPtr(p) return p >= 0x80000000 and p < 0x80200000 end

assert(rd8(POLE_ADDR) == 1, "FishingPole is not present")
assert(rd32(SCENE_LOCK) == 0 and rd32(SCENE_MOVE_LOCK) == 0,
  "scene is already locked")

local leader
for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  if validPtr(p) and rd32(p) == 5 and rd32(p + 8) == 0 then
    leader = p
    break
  end
end
assert(leader, "leader actor not found")

local controller
for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  if validPtr(p) and rd32(p) == 6 and rd32(p + 8) == 5
      and rd32(p + 0x50) == leader then
    controller = p
    break
  end
end
assert(controller, "mode-5 fishing controller not found")

local transitionHolder = rd32(leader + 0x24)
assert(validPtr(transitionHolder), "leader transition holder not found")

local tracked = {}
local slotLast = {}

local function track(p, slot, reason, frame, lines)
  if not validPtr(p) or tracked[p] then return end
  local last = {}
  for off = 0, OBJECT_BYTES - 4, 4 do last[off] = rd32(p + off) end
  tracked[p] = { slot = slot, type = rd32(p), last = last }
  if lines then
    lines[#lines + 1] = string.format(
      "%04d track reason=%s slot=%d ptr=%s type=%x",
      frame, reason, slot, hex(p), rd32(p))
  end
end

for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  slotLast[i] = p
  if validPtr(p) then track(p, i, "baseline", 0, nil) end
end

local inventoryLast = {}
for off = 0, INVENTORY_LENGTH - 1 do
  inventoryLast[off] = rd8(INVENTORY_START + off)
end

local lines = {
  "# Full s485 fishing cast-to-withdraw trace",
  "# one VSync listener; every frame logged; screenshots every 5 frames and "
    .. "every frame from 540 onward; no savestate load",
  string.format("# leader=%s start=(%d,%d) facing=%d handler=%s holder=%s",
    hex(leader), rd32(leader + 0x58), rd32(leader + 0x5c),
    rd32(leader + 0x60), hex(rd32(leader + 0x108)), hex(transitionHolder)),
  string.format("# controller=%s tag=%x state=%x substate=%x owner=%s",
    hex(controller), rd32(controller + 8), rd32(controller + 0xc),
    rd32(controller + 0x10), hex(rd32(controller + 0x50))),
  string.format("# FishingPole[%s]=%d catch_budget[%s]=%d",
    hex(POLE_ADDR), rd8(POLE_ADDR), hex(CATCH_BUDGET), rd32(CATCH_BUDGET)),
  string.format(
    "# cast=%d..%d withdraw=%d..%d max=%d screenshots=every_%d_frames",
    CAST_PRESS, CAST_RELEASE, WITHDRAW_PRESS, WITHDRAW_RELEASE, MAX_FRAMES,
    SHOT_EVERY),
  "# summary: frame leader_mode x y facing handler lock move_lock transition "
    .. "transition_state ctrl_state ctrl_sub extra child child_mode child_target "
    .. "child_timer child_variant child_progress child_speed child_ready budget",
  "# object_change: frame slot type ptr offset old new",
  "# inventory_change: frame absolute_address old new",
}

local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  f:close()
end

local pad = PCSX.SIO0.slots[1].pads[1]
local frame = 0
local castObserved = false
local childObserved = false
local withdrawObserved = false
local budgetLast = rd32(CATCH_BUDGET)

local function clearPad()
  pad.clearOverride(BTN.X)
end

local function scanForBobber()
  for addr = OBJECT_HEAP_START, OBJECT_HEAP_END - 4, 4 do
    if rd32(addr) == BOBBER_TICK then
      local p = addr - 0x48
      if validPtr(p) then
        track(p, -4, "bobber_tick_scan", frame, lines)
        lines[#lines + 1] = string.format(
          "%04d bobber_found ptr=%s tick_at=%s", frame, hex(p), hex(addr))
      end
    end
  end
end

local function finish(reason)
  clearPad()
  lines[#lines + 1] = string.format("# finish=%s frame=%d", reason, frame)
  flush()
  if FISHING_FULL_STATE5_LISTENER then
    FISHING_FULL_STATE5_LISTENER:remove()
    FISHING_FULL_STATE5_LISTENER = nil
  end
  print("FISHING_FULL_STATE5_DONE " .. reason .. " frame=" .. tostring(frame))
end

FISHING_FULL_STATE5_LISTENER =
  PCSX.Events.createEventListener("GPU::Vsync", function()
    local ok, err = pcall(function()
      frame = frame + 1

      if frame == CAST_PRESS then
        pad.setOverride(BTN.X)
        lines[#lines + 1] = string.format("# input frame=%d X=1 action=cast", frame)
      elseif frame == CAST_RELEASE then
        clearPad()
        lines[#lines + 1] = string.format("# input frame=%d X=0 action=cast", frame)
      elseif frame == WITHDRAW_PRESS then
        pad.setOverride(BTN.X)
        lines[#lines + 1] =
          string.format("# input frame=%d X=1 action=withdraw", frame)
      elseif frame == WITHDRAW_RELEASE then
        clearPad()
        lines[#lines + 1] =
          string.format("# input frame=%d X=0 action=withdraw", frame)
      end

      local transition = rd32(transitionHolder + 8)
      local transitionState =
        validPtr(transition) and rd32(transition + 0xc) or 0
      if validPtr(transition) then
        track(transition, -1, "leader_transition", frame, lines)
      end
      local activeController = validPtr(transition) and transition or controller
      local extra = rd32(activeController + 0x24)
      if validPtr(extra) then
        track(extra, -3, "controller_extra", frame, lines)
      end
      local child = validPtr(extra) and rd32(extra + 8) or 0
      if validPtr(child) then
        childObserved = true
        track(child, -2, "controller_child", frame, lines)
      end

      local childMode = validPtr(child) and rd32(child + 0xc) or 0
      local childTarget = validPtr(child) and rd32(child + 0x10) or 0
      local childTimer = validPtr(child) and rd32(child + 0x14) or 0
      local childVariant = validPtr(child) and rd32(child + 0x58) or 0
      local childProgress = validPtr(child) and rd32(child + 0x5c) or 0
      local childSpeed = validPtr(child) and rd32(child + 0x60) or 0
      local childReady = validPtr(child) and rd32(child + 0x64) or 0

      if rd32(leader + 0x10) ~= 1 then castObserved = true end
      if frame >= WITHDRAW_PRESS then withdrawObserved = true end

      lines[#lines + 1] = string.format(
        "%04d summary %x %d %d %d %s %08x %08x %s %x %x %x %s %s %x %x %x %x %x %x %d",
        frame, rd32(leader + 0x10), rd32(leader + 0x58),
        rd32(leader + 0x5c), rd32(leader + 0x60),
        hex(rd32(leader + 0x108)), rd32(SCENE_LOCK),
        rd32(SCENE_MOVE_LOCK), hex(transition), transitionState,
        rd32(activeController + 0xc), rd32(activeController + 0x10),
        hex(extra), hex(child),
        childMode, childTarget, childTimer, childVariant, childProgress,
        childSpeed, childReady, rd32(CATCH_BUDGET))

      for i = 0, 99 do
        local p = rd32(OBJECTS + i * 4)
        if p ~= slotLast[i] then
          lines[#lines + 1] = string.format(
            "%04d slot_change %d %s %s",
            frame, i, hex(slotLast[i]), hex(p))
          slotLast[i] = p
        end
        if validPtr(p) then track(p, i, "object_table", frame, lines) end
      end

      for p, obj in pairs(tracked) do
        local stillLive = obj.slot < 0
        if obj.slot >= 0 then stillLive = rd32(OBJECTS + obj.slot * 4) == p end
        if stillLive then
          for off = 0, OBJECT_BYTES - 4, 4 do
            local now, old = rd32(p + off), obj.last[off]
            if now ~= old then
              lines[#lines + 1] = string.format(
                "%04d object_change %d %x %s %03x %s %s",
                frame, obj.slot, obj.type, hex(p), off, hex(old), hex(now))
              obj.last[off] = now
            end
          end
        end
      end

      for off = 0, INVENTORY_LENGTH - 1 do
        local now, old = rd8(INVENTORY_START + off), inventoryLast[off]
        if now ~= old then
          lines[#lines + 1] = string.format(
            "%04d inventory_change %s %02x %02x",
            frame, hex(INVENTORY_START + off), old, now)
          inventoryLast[off] = now
        end
      end

      local budgetNow = rd32(CATCH_BUDGET)
      if budgetNow ~= budgetLast then
        lines[#lines + 1] = string.format(
          "%04d catch_budget_change %d %d", frame, budgetLast, budgetNow)
        budgetLast = budgetNow
      end

      if frame == 1 or frame % SHOT_EVERY == 0 or frame >= 540 then
        shot(SHOT_PREFIX .. string.format("%04d", frame))
      end

      if frame % FLUSH_EVERY == 0 then flush() end

      if frame == 30 or frame == 120 or frame == 240 or frame == 360 then
        scanForBobber()
      end

      if frame >= MAX_FRAMES then
        finish("max_frames")
      end
    end)

    if not ok then
      lines[#lines + 1] = "# error=" .. tostring(err)
      finish("error")
    end
  end)

flush()
print("FISHING_FULL_STATE5_ARMED out=" .. OUT)
