-- Full card-duel trace from the live GUI slot 5 position (s482, Tamer Mitch
-- dialogue "All right, I'm going to Card Battle with you!" already open).
--
-- Controlled input:
--   frame 10: press X to accept the duel, release at 14
--   thereafter: one 4-frame X pulse every PULSE_PERIOD frames, to advance
--   banners/prompts and commit the default selection so the duel actually
--   plays out. No directional input is ever sent.
--
-- One VSync listener. Every frame logged. The GUI slot 5 state is restored once
-- at top level so the run is repeatable; the pad override is always cleared on
-- finish.
--
-- Two objects are resolved at runtime and logged independently, because
-- docs/research/card/card-duel-engine-2026-08-04.md and
-- docs/research/card/cardduel-animation-decoded-2026-08-05.md attribute
-- overlapping offsets to "the duel object": the animation sprite pool spans
-- +0x108..+0xCE7 while the mode machine claims +0x2f4..+0x302. They cannot be
-- the same struct. This trace records both pointers so the attribution is
-- settled by observation, not inference.
--
-- Pointer resolution uses no breakpoints. F0x8009d310 allocates the
-- CardBattleContext and stores its caller argument (duelObject + 0x50) at
-- ctx+0x50, so once the context is located:
--   DUEL = rd32(CTX + 0x50) - 0x50
-- The context is found by the sprite-pool signature (see resolveObjects).
-- Measured live on 2026-08-05: ctx=0x800c7434, duel=0x800ac394, and the class
-- word 0x8009bba8 is at ctx+0x48. The scan retries until the allocation
-- appears, then never again.

-- Optional globals, set before running to retune without editing this file:
--   CARDGAME_S5_OUT      output path
--   CARDGAME_S5_PREFIX   screenshot prefix
--   CARDGAME_S5_PULSE    frames between X pulses (default 90)
--   CARDGAME_S5_MAX      frame budget (default 3000)
--   CARDGAME_S5_SHOT     screenshot interval (default 3)
--   CARDGAME_S5_CONTINUE true to resume a duel that is already running: skips
--                        the accept press and the overlay-load wait
local OUT = CARDGAME_S5_OUT or "C:/dw3-rig/dumps/cardgame_full_state5_trace.txt"
local SHOT_PREFIX = CARDGAME_S5_PREFIX or "cardgame_s5_f"
local CONTINUE = CARDGAME_S5_CONTINUE or false

-- anchors (pro/cardgame overlay, load base 0x80082cb0)
local FN_ANIM_DRIVER   = 0x8009bac8  -- per-frame sprite driver(ctx)
local FN_ROUND_DRIVER  = 0x800a1b48  -- two-level mode machine(duel)
local CTX_CLASS_WORD   = 0x8009bba8  -- class word stored at ctx+0x00

-- bounded object-heap window searched for the context allocation
local HEAP_LO = 0x000a6000
local HEAP_HI = 0x00110000
local SCAN_EVERY = 30

local CATALOG          = 0x800a4df4  -- card catalog base, stride 0x2c
local PHASE_TABLE      = 0x800a5d5c  -- 4-byte stride, indexed by previous mode
local RESIDENT_WIN     = 0x80048ac0  -- written 1 on the +0x302==0 branch
local SAVE_BASE        = 0x80048d34
local SCENE_LOCK       = 0x80099dd8
local SCENE_MOVE_LOCK  = 0x80099de0
local STAGE            = 0x80055d2c

local ANIM_BYTES   = 0xf48   -- CardBattleContext allocation size
local ROUND_BYTES  = 0x800   -- covers +0x2f4..+0x676 mode/outcome fields
local SPRITE_BASE  = 0x108
local SPRITE_COUNT = 40
local SPRITE_SIZE  = 0x4c

local PRESS       = 10
local RELEASE     = 14
local PULSE_PERIOD = CARDGAME_S5_PULSE or 90
local PULSE_WIDTH  = 4
local MAX_FRAMES  = CARDGAME_S5_MAX or 3000
local FLUSH_EVERY = 30
local SHOT_EVERY  = CARDGAME_S5_SHOT or 3
local SHOT_BURST  = 6     -- frames of every-frame shots after any mode change

if CARDGAME_S5_LISTENER then
  CARDGAME_S5_LISTENER:remove()
  CARDGAME_S5_LISTENER = nil
end

-- The trace expects the GUI slot 5 position (Tamer Mitch accept dialogue) to be
-- already live -- restore it with the GUI hotkey before running this script.
-- Opt-in reload only: set CARDGAME_S5_RELOAD = true beforehand. A top-level
-- loadSaveState immediately after a long previous run crashed build 314 once,
-- so this is deliberately not the default, and it is never called from VSync.
if CARDGAME_S5_RELOAD then
  local STATE5 = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate5"
  PCSX.loadSaveState(Support.File.zReader(Support.File.open(STATE5)))
end

-- NOTE: do not use bit.band here. LuaJIT's bit ops return a *signed* 32-bit
-- result, so bit.band(0x800ac394, 0xffffffff) is negative -- which made every
-- validPtr() check fail and printed pointers as "ffffffff800ac394".
local function u32(v)
  v = v % 4294967296
  if v < 0 then v = v + 4294967296 end
  return v
end
local function hex(v) return string.format("%08x", u32(v)) end
local function validPtr(p) return p >= 0x80000000 and p < 0x80200000 end

-- Pre-load baseline: the cardgame overlay is not resident yet, so whatever
-- currently sits at these addresses belongs to another overlay. Any change is
-- the load. This avoids hardcoding an instruction word.
local BASE_ANIM  = rd32(FN_ANIM_DRIVER)
local BASE_ROUND = rd32(FN_ROUND_DRIVER)

local lines = {
  "# Full card-duel trace from live GUI slot 5 (s482 Tamer Mitch accept)",
  "# one VSync listener; every frame logged; no savestate load",
  string.format("# start stage=%d lock=%08x move_lock=%08x",
    rd32(STAGE), rd32(SCENE_LOCK), rd32(SCENE_MOVE_LOCK)),
  string.format("# preload baseline anim_driver=%s round_driver=%s catalog0=%s",
    hex(BASE_ANIM), hex(BASE_ROUND), hex(rd32(CATALOG))),
  string.format("# input press=%d release=%d pulse_every=%d width=%d max=%d",
    PRESS, RELEASE, PULSE_PERIOD, PULSE_WIDTH, MAX_FRAMES),
  "# summary: frame loaded anim round pend2f7 cur2f8 prev2f6 msgpend2f4"
    .. " msgid421 sub2f9 sub574 out302 sub303 scene0c busy54 timer424"
    .. " score4e0 play575 result440 p0_5a0 p1_5a6 p676 lock move_lock",
  "# anim_change: frame offset old new         (bytes of the 0xf48 object)",
  "# round_change: frame offset old new        (bytes of the mode object)",
  "# sprite: frame slot x y dx dy sx sy state45 kind46 clip47 anim42 timer28 dur2c",
  "# ctx_candidate / resolve: object-heap signature lookup results",
}

local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  f:close()
end

local pad = PCSX.SIO0.slots[1].pads[1]
local frame = 0
local loaded = CONTINUE
local animPtr, roundPtr = 0, 0
local animLast, roundLast = {}, {}
local shotBurstUntil = 0
local lastModeKey = ""
local spriteLast = {}

local function clearPad() pad.clearOverride(BTN.X) end

local function snapshot(p, bytes, tbl)
  for off = 0, bytes - 4, 4 do tbl[off] = rd32(p + off) end
end

local function diff(p, bytes, tbl, tag)
  for off = 0, bytes - 4, 4 do
    local now = rd32(p + off)
    if now ~= tbl[off] then
      lines[#lines + 1] = string.format("%04d %s %03x %s %s",
        frame, tag, off, hex(tbl[off]), hex(now))
      tbl[off] = now
    end
  end
end

local function finish(reason)
  clearPad()
  lines[#lines + 1] = string.format("# finish=%s frame=%d ctx=%s duel=%s",
    reason, frame, hex(animPtr), hex(roundPtr))
  -- phase-order table, readable only while the overlay is resident
  if loaded then
    local t = {}
    for i = 0, 15 do t[#t + 1] = hex(rd32(PHASE_TABLE + i * 4)) end
    lines[#lines + 1] = "# phase_table " .. table.concat(t, " ")
  end
  flush()
  if CARDGAME_S5_LISTENER then
    CARDGAME_S5_LISTENER:remove()
    CARDGAME_S5_LISTENER = nil
  end
  print("CARDGAME_S5_DONE " .. reason .. " frame=" .. tostring(frame))
end

-- One bounded pass over the object heap for the sprite-pool signature: 40
-- sprites of 0x4c bytes at ctx+0x108, each storing its own slot index at +0x24.
-- Five ascending indices in a row is self-validating, unlike the class word --
-- which, measured live, sits at ctx+0x48 and not at ctx+0x00.
local mem = PCSX.getMemPtr()
local function resolveObjects()
  local found = nil
  for off = HEAP_LO, HEAP_HI - 4, 4 do
    if mem[off + SPRITE_SIZE + 0x24] == 1
        and mem[off + 0x24] == 0
        and mem[off + SPRITE_SIZE * 2 + 0x24] == 2
        and mem[off + SPRITE_SIZE * 3 + 0x24] == 3
        and mem[off + SPRITE_SIZE * 4 + 0x24] == 4 then
      local ctx = 0x80000000 + off - SPRITE_BASE
      local link = rd32(ctx + 0x50)
      lines[#lines + 1] = string.format(
        "%04d ctx_candidate ctx=%s class48=%s link50=%s",
        frame, hex(ctx), hex(rd32(ctx + 0x48)), hex(link))
      if not found and validPtr(link) then found = ctx end
    end
  end
  if not found then return false end
  animPtr = found
  snapshot(animPtr, ANIM_BYTES, animLast)
  local duel = u32(rd32(animPtr + 0x50) - 0x50)
  if validPtr(duel) then
    roundPtr = duel
    snapshot(roundPtr, ROUND_BYTES, roundLast)
  end
  lines[#lines + 1] = string.format("%04d resolve ctx=%s duel=%s",
    frame, hex(animPtr), hex(roundPtr))
  return true
end

CARDGAME_S5_LISTENER =
  PCSX.Events.createEventListener("GPU::Vsync", function()
    local ok, err = pcall(function()
      frame = frame + 1

      if frame == PRESS and not CONTINUE then
        pad.setOverride(BTN.X)
        lines[#lines + 1] = string.format("# input frame=%d X=1 action=accept", frame)
      elseif frame == RELEASE and not CONTINUE then
        clearPad()
        lines[#lines + 1] = string.format("# input frame=%d X=0 action=accept", frame)
      elseif frame > RELEASE or CONTINUE then
        local phase = frame % PULSE_PERIOD
        if phase == 0 then
          pad.setOverride(BTN.X)
          lines[#lines + 1] = string.format("# input frame=%d X=1 action=pulse", frame)
        elseif phase == PULSE_WIDTH then
          clearPad()
          lines[#lines + 1] = string.format("# input frame=%d X=0 action=pulse", frame)
        end
      end

      -- overlay load detection, then resolve the objects by signature
      if not loaded then
        if rd32(FN_ANIM_DRIVER) ~= BASE_ANIM
            or rd32(FN_ROUND_DRIVER) ~= BASE_ROUND then
          loaded = true
          lines[#lines + 1] = string.format(
            "%04d overlay_loaded anim_word=%s round_word=%s catalog0=%s",
            frame, hex(rd32(FN_ANIM_DRIVER)), hex(rd32(FN_ROUND_DRIVER)),
            hex(rd32(CATALOG)))
        end
      elseif animPtr == 0 and frame % SCAN_EVERY == 0 then
        resolveObjects()
      end

      local function rb(off) return roundPtr ~= 0 and rd8(roundPtr + off) or 0 end
      local function rw(off) return roundPtr ~= 0 and rd32(roundPtr + off) or 0 end
      local function ab(off) return animPtr ~= 0 and rd8(animPtr + off) or 0 end
      local function aw(off) return animPtr ~= 0 and rd32(animPtr + off) or 0 end

      lines[#lines + 1] = string.format(
        "%04d summary %d %s %s %02x %02x %02x %02x %02x %02x %02x %02x %02x"
          .. " %02x %08x %08x %08x %02x %08x %02x %02x %02x %08x %08x",
        frame, loaded and 1 or 0, hex(animPtr), hex(roundPtr),
        rb(0x2f7), rb(0x2f8), rb(0x2f6), rb(0x2f4), rb(0x421), rb(0x2f9),
        rb(0x574), rb(0x302), rb(0x303), rb(0x0c),
        aw(0x54), aw(0x424), aw(0x4e0), rb(0x575), rw(0x440),
        rb(0x5a0), rb(0x5a6), rb(0x676),
        rd32(SCENE_LOCK), rd32(SCENE_MOVE_LOCK))

      local modeKey = string.format("%02x%02x%02x%02x",
        rb(0x2f7), rb(0x2f8), rb(0x2f9), rb(0x574))
      if modeKey ~= lastModeKey then
        lines[#lines + 1] = string.format("%04d mode_change %s -> %s",
          frame, lastModeKey, modeKey)
        lastModeKey = modeKey
        shotBurstUntil = frame + SHOT_BURST
      end

      if animPtr ~= 0 then
        diff(animPtr, ANIM_BYTES, animLast, "anim_change")
        for s = 0, SPRITE_COUNT - 1 do
          local sp = animPtr + SPRITE_BASE + s * SPRITE_SIZE
          local key = string.format(
            "%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d",
            rd32(sp + 0x00), rd32(sp + 0x04), rd32(sp + 0x08), rd32(sp + 0x0c),
            rd16(sp + 0x18), rd16(sp + 0x1a), rd8(sp + 0x45), rd8(sp + 0x46),
            rd8(sp + 0x47), rd8(sp + 0x42), rd32(sp + 0x28), rd32(sp + 0x2c))
          if key ~= spriteLast[s] then
            lines[#lines + 1] = string.format("%04d sprite %02d %s", frame, s, key)
            spriteLast[s] = key
          end
        end
      end
      if roundPtr ~= 0 and roundPtr ~= animPtr then
        diff(roundPtr, ROUND_BYTES, roundLast, "round_change")
      end

      if frame == 1 or frame % SHOT_EVERY == 0 or frame <= shotBurstUntil then
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
print("CARDGAME_S5_ARMED out=" .. OUT)
