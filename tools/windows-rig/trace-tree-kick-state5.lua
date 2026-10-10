-- Full-GUI s485 TreeBoots/tree-kick trace from the live GUI slot 5 position.
--
-- Controlled input:
--   frame 10: press X once
--   frame 14: release X
--
-- Every VSync is logged. Frames 1..540 are screenshotted consecutively and
-- frames 545..900 every fifth VSync. No savestate is loaded by this script.

local OUT
local SHOT_PREFIX
local OBJECTS = 0x8004b610
local SCENE_LOCK = 0x80099dd8
local SCENE_MOVE_LOCK = 0x80099de0
local SAVE_BASE = 0x80048d34
local TREE_BOOTS_ADDR = SAVE_BASE + 0x80
local INVENTORY_START = SAVE_BASE + 0x7c
local INVENTORY_LENGTH = 0x200
local BATTLE_SCREEN = 0x80042b2c
local BATTLE_PARAM = 0x80042b28
local BATTLE_MUSIC = 0x80042b30
local OBJECT_BYTES = 0x160
local PRESS_AT = 10
local RELEASE_AT = 14
local MAX_FRAMES = 900
local FLUSH_EVERY = 30

if TREE_KICK_STATE5_LISTENER then
  TREE_KICK_STATE5_LISTENER:remove()
  TREE_KICK_STATE5_LISTENER = nil
end

local function u32(v) return bit.band(v, 0xffffffff) end
local function hex(v) return string.format("%08x", u32(v)) end
local function validPtr(p) return p >= 0x80000000 and p < 0x80200000 end

assert(rd8(TREE_BOOTS_ADDR) == 1, "TreeBoots are not present")
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
local RUN = rd32(leader + 0x58) > 900 and "active" or "inactive"
OUT = "C:/dw3-rig/dumps/tree_kick_state5_" .. RUN .. "_trace.txt"
SHOT_PREFIX = "tree_kick_state5_" .. RUN .. "_f"

local transitionHolder = rd32(leader + 0x24)
assert(validPtr(transitionHolder), "leader transition holder not found")

local tracked = {}
local slotLast = {}
local lines = {}

local function track(p, slot, reason, frame)
  if not validPtr(p) or tracked[p] then return end
  local last = {}
  for off = 0, OBJECT_BYTES - 4, 4 do last[off] = rd32(p + off) end
  tracked[p] = { slot = slot, type = rd32(p), last = last }
  lines[#lines + 1] = string.format(
    "%04d track reason=%s slot=%d ptr=%s type=%x tick=%s",
    frame, reason, slot, hex(p), rd32(p), hex(rd32(p + 0x48)))
end

for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  slotLast[i] = p
  if validPtr(p) then track(p, i, "baseline", 0) end
end

local inventoryLast = {}
for off = 0, INVENTORY_LENGTH - 1 do
  inventoryLast[off] = rd8(INVENTORY_START + off)
end

local battleLast = {
  screen = rd32(BATTLE_SCREEN),
  param = rd32(BATTLE_PARAM),
  music = rd32(BATTLE_MUSIC),
}

lines[#lines + 1] = "# Full s485 TreeBoots/tree-kick trace"
lines[#lines + 1] = "# run=" .. RUN
lines[#lines + 1] =
  "# one VSync listener; every frame logged; no savestate load"
lines[#lines + 1] = string.format(
  "# leader=%s start=(%d,%d) facing=%d handler=%s holder=%s",
  hex(leader), rd32(leader + 0x58), rd32(leader + 0x5c),
  rd32(leader + 0x60), hex(rd32(leader + 0x108)), hex(transitionHolder))
lines[#lines + 1] = string.format(
  "# TreeBoots[%s]=%d input=%d..%d max=%d screenshots=1..540_every_frame_then_every_5",
  hex(TREE_BOOTS_ADDR), rd8(TREE_BOOTS_ADDR), PRESS_AT, RELEASE_AT, MAX_FRAMES)
lines[#lines + 1] = string.format(
  "# battle_initial screen=%x param=%x music=%x",
  battleLast.screen, battleLast.param, battleLast.music)
lines[#lines + 1] =
  "# summary: frame leader_mode x y facing handler lock move_lock transition "
  .. "transition_type transition_state transition_sub transition_tick "
  .. "battle_screen battle_param battle_music"
lines[#lines + 1] =
  "# object_change: frame slot type ptr offset old new"
lines[#lines + 1] =
  "# inventory_change: frame absolute_address old new"

local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  f:close()
end

local pad = PCSX.SIO0.slots[1].pads[1]
local frame = 0

local function clearPad()
  pad.clearOverride(BTN.X)
end

local function finish(reason)
  clearPad()
  lines[#lines + 1] = string.format("# finish=%s frame=%d", reason, frame)
  flush()
  if TREE_KICK_STATE5_LISTENER then
    TREE_KICK_STATE5_LISTENER:remove()
    TREE_KICK_STATE5_LISTENER = nil
  end
  print("TREE_KICK_STATE5_DONE " .. reason .. " frame=" .. tostring(frame))
end

TREE_KICK_STATE5_LISTENER =
  PCSX.Events.createEventListener("GPU::Vsync", function()
    local ok, err = pcall(function()
      frame = frame + 1

      if frame == PRESS_AT then
        pad.setOverride(BTN.X)
        lines[#lines + 1] =
          string.format("# input frame=%d X=1 action=tree_kick", frame)
      elseif frame == RELEASE_AT then
        clearPad()
        lines[#lines + 1] =
          string.format("# input frame=%d X=0 action=tree_kick", frame)
      end

      local transition = rd32(transitionHolder + 8)
      if validPtr(transition) then track(transition, -1, "leader_transition", frame) end
      local transitionType = validPtr(transition) and rd32(transition) or 0
      local transitionState = validPtr(transition) and rd32(transition + 0xc) or 0
      local transitionSub = validPtr(transition) and rd32(transition + 0x10) or 0
      local transitionTick = validPtr(transition) and rd32(transition + 0x48) or 0

      lines[#lines + 1] = string.format(
        "%04d summary %x %d %d %d %s %08x %08x %s %x %x %x %s %x %x %x",
        frame, rd32(leader + 0x10), rd32(leader + 0x58),
        rd32(leader + 0x5c), rd32(leader + 0x60),
        hex(rd32(leader + 0x108)), rd32(SCENE_LOCK),
        rd32(SCENE_MOVE_LOCK), hex(transition), transitionType,
        transitionState, transitionSub, hex(transitionTick),
        rd32(BATTLE_SCREEN), rd32(BATTLE_PARAM), rd32(BATTLE_MUSIC))

      for i = 0, 99 do
        local p = rd32(OBJECTS + i * 4)
        if p ~= slotLast[i] then
          lines[#lines + 1] = string.format(
            "%04d slot_change %d %s %s", frame, i, hex(slotLast[i]), hex(p))
          slotLast[i] = p
        end
        if validPtr(p) then track(p, i, "object_table", frame) end
      end

      for p, obj in pairs(tracked) do
        local live = obj.slot < 0
        if obj.slot >= 0 then live = rd32(OBJECTS + obj.slot * 4) == p end
        if live then
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

      local screen = rd32(BATTLE_SCREEN)
      local param = rd32(BATTLE_PARAM)
      local music = rd32(BATTLE_MUSIC)
      if screen ~= battleLast.screen or param ~= battleLast.param
          or music ~= battleLast.music then
        lines[#lines + 1] = string.format(
          "%04d battle_change screen=%x->%x param=%x->%x music=%x->%x",
          frame, battleLast.screen, screen, battleLast.param, param,
          battleLast.music, music)
        battleLast.screen, battleLast.param, battleLast.music =
          screen, param, music
      end

      if frame <= 540 or frame % 5 == 0 then
        shot(SHOT_PREFIX .. string.format("%04d", frame))
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
print("TREE_KICK_STATE5_ARMED out=" .. OUT)
