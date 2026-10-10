-- Controlled s740 Fire Dungeon explosion / party-to-1-HP trace.
--
-- Preconditions:
--   * GUI AppData save state 4 is live in s740.
--   * Junior is one Down step from the trigger near (861,502).
--   * setup-portable.lua has installed rd8/rd16/rd32, BTN, and shot().
--
-- One VSync listener owns input, logging, screenshots, flushing, and cleanup.
-- The trace watches the four field-party actors, persistent HP for all roster
-- slots, scene locks, object-table membership/struct changes, HP writers, and
-- packed sound submissions. It does not reload a state or scan full RAM.

local OUT = "C:/dw3-rig/dumps/fire_dungeon_explosion_state4_trace.txt"
local OBJECTS = 0x8004b610
local CURRENT_SCREEN = 0x8004b3f8
local SCENE_LOCK = 0x80099dd8
local SCENE_MOVE_LOCK = 0x80099de0
local ROSTER = 0x8004949c
local ROSTER_STRIDE = 0x3dc
local ACTOR_SIZE = 0x15c
local OBJECT_WATCH_SIZE = 0x80
local MAX_FRAMES = 900
local PRESS_AT = 10
local RELEASE_AT = 14
local FLUSH_EVERY = 30
local MAX_CHANGE_LINES = 24000

local OWNED_SLOTS = {0, 6, 7}

if FIRE_EXPLOSION_LISTENER then
  pcall(function() FIRE_EXPLOSION_LISTENER:remove() end)
  FIRE_EXPLOSION_LISTENER = nil
end
if FIRE_EXPLOSION_BPS then
  for _, bp in ipairs(FIRE_EXPLOSION_BPS) do
    pcall(function() bp:remove() end)
  end
end
FIRE_EXPLOSION_BPS = {}

local function u32(v) return bit.band(v, 0xffffffff) end
local function hex(v) return string.format("%08x", u32(v)) end
local function validPtr(p) return p >= 0x80000000 and p < 0x80200000 end

assert(rd32(CURRENT_SCREEN) == 0x26b, "expected s740 screen 0x26b")

local party = {}
local leader
for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  if validPtr(p) and rd32(p) == 5 then
    local slot = rd32(p + 8)
    if slot == 0 or slot == 2 or slot == 4 or slot == 8 then
      party[#party + 1] = {ptr = p, slot = slot}
      if slot == 0 then leader = p end
    end
  end
end
assert(leader, "leader actor not found")
table.sort(party, function(a, b) return a.slot < b.slot end)

local transitionHolder = rd32(leader + 0x24)
assert(validPtr(transitionHolder), "leader transition holder not found")

local lines = {}
local changeLines = 0
local function emit(line, change)
  if not change or changeLines < MAX_CHANGE_LINES then
    lines[#lines + 1] = line
    if change then changeLines = changeLines + 1 end
  end
end

local startX, startY = rd32(leader + 0x58), rd32(leader + 0x5c)
emit("# Fire Dungeon s740 explosion / party-to-1-HP trace")
emit("# GUI AppData slot 4 already live; one Down tap; no savestate reload or full-RAM scan")
emit(string.format("# leader=%s start=(%d,%d) facing=%d handler=%s holder=%s",
  hex(leader), startX, startY, rd32(leader + 0x60),
  hex(rd32(leader + 0x108)), hex(transitionHolder)))
emit(string.format("# screen=%04x start_cell=(%d,%d) press=%d release=%d max_frames=%d",
  rd32(CURRENT_SCREEN), math.floor(startX / 32), math.floor(startY / 32),
  PRESS_AT, RELEASE_AT, MAX_FRAMES))
emit("# summary: frame screen leader_mode x y facing handler scene58 scene60 transition top sub hp0 hp1 hp2 hp3 hp4 hp5 hp6 hp7")
emit("# hp_write: frame slot address pc ra old_hp register snapshot")
emit("# sound: frame packed_id ra")
emit("# object_slot/object_change and actor_change are raw structural deltas")

for slot = 0, 7 do
  local b = ROSTER + slot * ROSTER_STRIDE
  emit(string.format("# roster_start slot=%d owned=%s level=%d hp=%d/%d mp=%d/%d",
    slot, hex(rd32(b - 8)), rd16(b + 0x1c), rd16(b + 0x20),
    rd16(b + 0x22), rd16(b + 0x24), rd16(b + 0x26)))
end

local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  f:close()
end

local actorLast = {}
for off = 0, ACTOR_SIZE - 4, 4 do
  actorLast[off] = rd32(leader + off)
end

local slots = {}
local tracked = {}
local function startTracking(p, slot, reason)
  if not validPtr(p) or tracked[p] then return end
  local obj = {ptr = p, slots = {[slot] = true}, last = {}}
  for off = 0, OBJECT_WATCH_SIZE - 4, 4 do
    obj.last[off] = rd32(p + off)
  end
  tracked[p] = obj
  emit(string.format(
    "0000 object_track reason=%s slot=%d ptr=%s type=%x state=%x sub=%x",
    reason, slot, hex(p), rd32(p), rd32(p + 0xc), rd32(p + 0x10)), true)
end
for i = 0, 99 do
  local p = rd32(OBJECTS + i * 4)
  slots[i] = p
  if validPtr(p) and rd32(p) ~= 5 then startTracking(p, i, "baseline") end
end

local rosterLast = {}
for slot = 0, 7 do
  rosterLast[slot] = rd16(ROSTER + slot * ROSTER_STRIDE + 0x20)
end

local frame = 0
local firstHpChange
local allOneFrame
local screenshots = {[1] = true, [12] = true}
local pad = PCSX.SIO0.slots[1].pads[1]

local function clearTrace()
  pad.clearOverride(BTN.DOWN)
  if FIRE_EXPLOSION_LISTENER then
    pcall(function() FIRE_EXPLOSION_LISTENER:remove() end)
    FIRE_EXPLOSION_LISTENER = nil
  end
  for _, bp in ipairs(FIRE_EXPLOSION_BPS or {}) do
    pcall(function() bp:remove() end)
  end
  FIRE_EXPLOSION_BPS = {}
end

local function finish(reason)
  emit(string.format("# finish=%s frame=%d first_hp_change=%s all_one=%s changes=%d",
    reason, frame, tostring(firstHpChange), tostring(allOneFrame), changeLines))
  flush()
  clearTrace()
  print(string.format(
    "FIRE_EXPLOSION_TRACE_DONE reason=%s frame=%d first_hp=%s all_one=%s out=%s",
    reason, frame, tostring(firstHpChange), tostring(allOneFrame), OUT))
end

local hpAddresses = {}
for slot = 0, 7 do
  hpAddresses[ROSTER + slot * ROSTER_STRIDE + 0x20] = slot
end
for address, slot in pairs(hpAddresses) do
  FIRE_EXPLOSION_BPS[#FIRE_EXPLOSION_BPS + 1] =
    PCSX.addBreakpoint(address, "Write", 2, "fire_hp_slot_" .. tostring(slot),
      function()
        pcall(function()
          local regs = PCSX.getRegisters()
          local r = regs.GPR.n
          emit(string.format(
            "%04d hp_write slot=%d address=%s pc=%s ra=%s old=%d a0=%s a1=%s a2=%s a3=%s v0=%s v1=%s",
            frame, slot, hex(address), hex(regs.pc), hex(r.ra), rd16(address),
            hex(r.a0), hex(r.a1), hex(r.a2), hex(r.a3), hex(r.v0), hex(r.v1)), true)
        end)
        return false
      end)
end

FIRE_EXPLOSION_BPS[#FIRE_EXPLOSION_BPS + 1] =
  PCSX.addBreakpoint(0x8002006c, "Exec", 4, "fire_explosion_sound", function()
    pcall(function()
      local r = PCSX.getRegisters().GPR.n
      emit(string.format("%04d sound packed=%s ra=%s",
        frame, hex(r.a0), hex(r.ra)), true)
    end)
    return false
  end)

FIRE_EXPLOSION_LISTENER =
  PCSX.Events.createEventListener("GPU::Vsync", function()
    local ok, err = pcall(function()
      frame = frame + 1
      if frame == PRESS_AT then
        pad.setOverride(BTN.DOWN)
        emit(string.format("# input frame=%d DOWN=1", frame))
      elseif frame == RELEASE_AT then
        pad.clearOverride(BTN.DOWN)
        emit(string.format("# input frame=%d DOWN=0", frame))
      end

      local transition = rd32(transitionHolder + 8)
      local top = validPtr(transition) and rd32(transition + 0xc) or 0
      local sub = validPtr(transition) and rd32(transition + 0x10) or 0
      local hp = {}
      for slot = 0, 7 do
        hp[slot] = rd16(ROSTER + slot * ROSTER_STRIDE + 0x20)
      end
      emit(string.format(
        "%04d summary %04x %x %d %d %d %s %s %s %s %x %x %d %d %d %d %d %d %d %d",
        frame, rd32(CURRENT_SCREEN), rd32(leader + 0x10),
        rd32(leader + 0x58), rd32(leader + 0x5c), rd32(leader + 0x60),
        hex(rd32(leader + 0x108)), hex(rd32(SCENE_LOCK)),
        hex(rd32(SCENE_MOVE_LOCK)), hex(transition), top, sub,
        hp[0], hp[1], hp[2], hp[3], hp[4], hp[5], hp[6], hp[7]))

      for _, a in ipairs(party) do
        emit(string.format(
          "%04d party field_slot=%d mode=%x x=%d y=%d face=%d handler=%s",
          frame, a.slot, rd32(a.ptr + 0x10), rd32(a.ptr + 0x58),
          rd32(a.ptr + 0x5c), rd32(a.ptr + 0x60),
          hex(rd32(a.ptr + 0x108))))
      end

      for slot = 0, 7 do
        if hp[slot] ~= rosterLast[slot] then
          emit(string.format("%04d hp_change slot=%d old=%d new=%d",
            frame, slot, rosterLast[slot], hp[slot]), true)
          rosterLast[slot] = hp[slot]
          if not firstHpChange then
            firstHpChange = frame
            for _, delta in ipairs({0, 15, 30, 60, 90, 120}) do
              screenshots[frame + delta] = true
            end
          end
        end
      end
      local allOne = true
      for _, slot in ipairs(OWNED_SLOTS) do
        if hp[slot] ~= 1 then allOne = false end
      end
      if allOne and not allOneFrame then
        allOneFrame = frame
        emit(string.format("# all_owned_hp_one frame=%d", frame))
      end

      for off = 0, ACTOR_SIZE - 4, 4 do
        local now, old = rd32(leader + off), actorLast[off]
        if now ~= old then
          emit(string.format("%04d actor_change %03x %s %s",
            frame, off, hex(old), hex(now)), true)
          actorLast[off] = now
        end
      end

      for i = 0, 99 do
        local now, old = rd32(OBJECTS + i * 4), slots[i]
        if now ~= old then
          emit(string.format("%04d object_slot slot=%d old=%s new=%s",
            frame, i, hex(old), hex(now)), true)
          slots[i] = now
          if validPtr(now) then startTracking(now, i, "slot_change") end
        end
      end

      if validPtr(transition) then startTracking(transition, -1, "leader_transition") end
      for _, obj in pairs(tracked) do
        for off = 0, OBJECT_WATCH_SIZE - 4, 4 do
          local now, old = rd32(obj.ptr + off), obj.last[off]
          if now ~= old then
            emit(string.format("%04d object_change ptr=%s off=%03x old=%s new=%s",
              frame, hex(obj.ptr), off, hex(old), hex(now)), true)
            obj.last[off] = now
          end
        end
      end

      if screenshots[frame] then
        pcall(shot, string.format("fire_explosion_state4_f%04d", frame))
      end
      if frame % FLUSH_EVERY == 0 then flush() end

      if allOneFrame and frame - allOneFrame >= 120
          and rd32(SCENE_LOCK) == 0 and rd32(SCENE_MOVE_LOCK) == 0
          and rd32(leader + 0x10) == 1 then
        finish("sequence_complete")
      elseif frame >= MAX_FRAMES then
        finish("max_frames")
      end
    end)
    if not ok then
      emit("# error=" .. tostring(err))
      finish("error")
    end
  end)

flush()
print("FIRE_EXPLOSION_TRACE_ARMED out=" .. OUT)
