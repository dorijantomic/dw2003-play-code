-- PLAY the card duel on the disc, closed-loop, photograph every distinct screen,
-- and DERIVE THE BUTTON MAP from the running game instead of guessing it.
--
-- THREE RUNS, THREE LESSONS, all on 2026-08-24 and all recorded here so the
-- next pass does not repeat them:
--
--  1. A blind X pulse cannot play this game. It reached the Summon Phase,
--     parked on a Digimon it had no S-Energy for, and sat there 3,500 frames.
--     A refused confirm looks exactly like a confirm that did nothing.
--
--  2. Reading the board is necessary but not sufficient. The second run read
--     duel+0x446 -- the game's own per-slot "may I use this" flag -- found all
--     six zero, and then pressed a button that does not leave the phase, 350
--     times, in silence.
--
--  3. DO NOT INFER A BUTTON FROM A NUMBER. The third run moved confirm to
--     CIRCLE because claim cardgame-f8008642c-is-the-two-option-prompt says the
--     prompt's cancel is "pad bit 0x0E" and this rig's BTN.X is 14 = 0x0E.
--     That is an identity error: the game calls the pad service's mapper,
--     unk408(0, 0x0E), so 0x0E is a LOGICAL button index that the service maps
--     to a raw bit, and BTN.X is a RAW bit. Different numbering spaces. The run
--     hung on NPC dialogue, because X really is the advance button.
--
-- WHAT THE GAME ITSELF SAYS. escardgm string 0x24 is the Summon Phase's own
-- on-screen legend:
--        "[cross] Select [square] Summon"
-- Cross SELECTS. Square SUMMONS. The summon step does not confirm on cross at
-- all, which is why run 2 could never finish it. There is also a "Pass" label
-- at 0x3f whose button is not established.
--
-- So: cross advances and selects, square summons, and everything else this
-- script needs it works out by PROBING -- when a screen will not move, it tries
-- each button in turn and records which one changed the state. That is how the
-- rest of the map gets established: from the running game, at authority 1.
--
-- WHAT IT READS (every one a named field; no full-RAM read anywhere):
--   duel+0x2F8  mode. 5 Load, 6 Summon, 7 Compile, 0xA the inter-phase banner.
--   duel+0x574  the Load/Compile play machine's state (F0x8009FDD8):
--                 2 the two-option question, 4 the hand selector, 6 the commit.
--   duel+0x422  the two-option prompt's own step (F0x8008642C):
--                 0 waiting out 0x24 units, 1 opened, 2 polling, 7/8/9 answering.
--   duel+0x438  WHICH prompt: 2 = at least one card usable, 3 = none.
--   duel+0x440  that prompt's cursor. Two answers only; 0 is the first.
--   duel+0x43C  the PICKER's cursor (cardduel-picker-cursor-does-not-wrap).
--   duel+0x446+i  1 when hand entry i is usable, 0 when not -- one byte per
--                 slot, written by F0x80086D78. The game's own verdict.
--   duel+0x5A6  side 0's hand count (block+0x0A, block = duel+0x59C).
--   duel+0x300  the set counter.
--
-- Safety: ONE listener of its own (press() has its own), whole body pcall'd, a
-- hard frame budget, a hard shot cap, the listener always removed.
--
-- TWO THINGS ADDED AFTER THE FOURTH RUN:
--
--  A CONTROL ARM. A probe hit is worthless without one: several of these
--    screens advance on their own timer, so a button pressed at the right
--    moment looks exactly like the cause. Before any button is tried, this now
--    sits on the stuck screen pressing NOTHING for the same window a probe step
--    uses. If the screen moves anyway, it is recorded as SELF-ADVANCING and no
--    button is credited. Only a screen that provably does not move on its own
--    is probed, so a hit afterwards is attributable.
--
--  MULTI-FRAME SHOTS on the screens whose art is the open question. One frame
--    per state change caught the two-option box mid-slide, with no text drawn
--    yet. Those states now get four frames spread over ~80 frames so the box is
--    caught fully open. Everything else still gets one, to keep the file count
--    down -- this build has crashed on every long run.
--
-- Globals: PD_OUT PD_PREFIX PD_MAX PD_SHOTS PD_EVERY
local OUT    = PD_OUT    or "C:/dw3-rig/dumps/cardduel_played.txt"
local PREFIX = PD_PREFIX or "duel"
local MAX    = PD_MAX    or 7000
local SHOTS  = PD_SHOTS  or 110
local EVERY  = PD_EVERY  or 20        -- frames between decisions
-- extra frames after a state change, for the screens whose art is unread
local FOLLOW = { 8, 22, 48, 80 }

if PD_LISTENER then PD_LISTENER:remove(); PD_LISTENER = nil end
while #PRESSQ > 0 do table.remove(PRESSQ, 1) end

-- Cross advances and selects; square summons. Both are the GAME's own legend,
-- not an inference. Everything else is discovered by PROBE_ORDER below.
local ADVANCE, SUMMON = BTN.X, BTN.SQUARE
local PROBE_ORDER = {
  { BTN.X, "X" }, { BTN.SQUARE, "SQUARE" }, { BTN.CIRCLE, "CIRCLE" },
  { BTN.TRIANGLE, "TRIANGLE" }, { BTN.RIGHT, "RIGHT" }, { BTN.LEFT, "LEFT" },
  { BTN.DOWN, "DOWN" }, { BTN.UP, "UP" }, { BTN.START, "START" },
}

local FN_ROUND_DRIVER = 0x800a1b48
local SPRITE_BASE, SPRITE_SIZE = 0x108, 0x4c
local HEAP_LO, HEAP_HI = 0x000a6000, 0x00110000

local function u32(v) v = v % 4294967296; if v < 0 then v = v + 4294967296 end; return v end
local function hex(v) return string.format("%08x", u32(v)) end
local function validPtr(p) return p >= 0x80000000 and p < 0x80200000 end

local BASE_ROUND = rd32(FN_ROUND_DRIVER)
local mem = PCSX.getMemPtr()

local lines = {
  "# card duel PLAYED closed-loop + BUTTON PROBE, " .. os.date(),
  "# cross advances/selects and square summons -- escardgm 0x24, the game's own",
  "# legend. Everything else is probed: when a screen will not move, each button",
  "# is tried in turn and the one that changes the state is recorded.",
  string.format("# prefix=%s max=%d shots<=%d every=%d", PREFIX, MAX, SHOTS, EVERY),
  "# f m=mode lc=+0x574 st=+0x422 w=+0x438 sel=+0x440 cur=+0x43C hand set | usable | ACT",
}
local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  f:close()
end
local function say(s) lines[#lines + 1] = s end

local frame, duel, loaded = 0, 0, false
local shots, lastKey, lastAct, done = 0, "", -999, false
local stuckKey, stuckN = "", 0
-- HOW LONG BEFORE A SCREEN COUNTS AS STUCK. This was 5 decisions with a
-- 2-decision control arm -- under a second at EVERY=10 -- and that is shorter
-- than the Battle Phase's own animations. Twice on 2026-08-24 the run reached
-- mode 8, was declared stuck while it was simply busy, probed all nine buttons
-- and quit at "no button moves this screen" in set 0. A screen that is merely
-- slow must not be mistaken for one that is waiting for input.
local STUCK_AFTER = PD_STUCK or 40
-- probe state
local probing, probeI, probeKey, probeFrom = false, 0, "", ""
local control, controlLeft = false, 0
local CONTROL_WAIT = PD_CONTROL or 20   -- decisions pressing nothing first
local FOUND = {}          -- FOUND[situation] = button name that moved it
local SELF  = {}          -- SELF[situation]  = true when it moves unaided
local pending = {}        -- pending[frame] = shot name

local function resolve()
  for off = HEAP_LO, HEAP_HI - 4, 4 do
    if mem[off + SPRITE_SIZE + 0x24] == 1 and mem[off + 0x24] == 0
       and mem[off + SPRITE_SIZE * 2 + 0x24] == 2
       and mem[off + SPRITE_SIZE * 3 + 0x24] == 3
       and mem[off + SPRITE_SIZE * 4 + 0x24] == 4 then
      local ctx = 0x80000000 + off - SPRITE_BASE
      local d = u32(rd32(ctx + 0x50) - 0x50)
      if validPtr(d) then
        say(string.format("# resolve f=%d ctx=%s duel=%s", frame, hex(ctx), hex(d)))
        flush()
        return d
      end
    end
  end
  return 0
end

local function finish(why)
  if done then return end
  done = true
  say("# ---- button map derived from the running game ----")
  local any = false
  for situation, btn in pairs(FOUND) do
    any = true
    say(string.format("# BUTTON  %-28s -> %s", situation, btn))
  end
  if not any then say("# BUTTON  (nothing probed -- nothing got stuck)") end
  for situation in pairs(SELF) do
    say(string.format("# SELF    %-28s advances with NO input -- no button credited", situation))
  end
  say(string.format("# %s at frame %d, %d shots", why, frame, shots))
  flush()
  if PD_LISTENER then PD_LISTENER:remove(); PD_LISTENER = nil end
end

PD_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if done then return end
  local ok, err = pcall(function()
    frame = frame + 1
    if frame > MAX then finish("budget spent"); return end

    if not loaded then
      if rd32(FN_ROUND_DRIVER) ~= BASE_ROUND then
        loaded = true; say(string.format("# overlay loaded at frame %d", frame)); flush()
      end
      -- Keep advancing until the overlay actually loads. A single press at
      -- frame 10 is not enough: Mitch's challenge is several pages plus the
      -- accept, so one press left the driver parked on the dialogue for the
      -- whole budget and the log never got a single line (2026-08-24).
      if frame % 30 == 10 then press(ADVANCE, 5) end
      return
    end
    if duel == 0 then
      if frame % 30 == 0 then duel = resolve() end
      if frame % 60 == 0 then press(ADVANCE, 5) end
      return
    end

    local mode  = rd8(duel + 0x2f8)
    local lc    = rd8(duel + 0x574)
    local step  = rd8(duel + 0x422)
    local which = rd8(duel + 0x438)
    local sel   = rd8(duel + 0x440)
    local cur   = rd8(duel + 0x43c)
    local hand  = rd8(duel + 0x5a6)
    local set   = rd8(duel + 0x300)

    local usable, firstOk, nOk = {}, -1, 0
    for i = 0, math.min(hand, 40) - 1 do
      local u = rd8(duel + 0x446 + i)
      usable[i] = u
      if u ~= 0 then
        nOk = nOk + 1
        if firstOk < 0 then firstOk = i end
      end
    end
    local ustr = ""
    for i = 0, math.min(hand, 40) - 1 do ustr = ustr .. tostring(usable[i]) end

    -- any shot scheduled for this frame
    if pending[frame] then
      if shots < SHOTS then shot(pending[frame]); shots = shots + 1 end
      pending[frame] = nil
    end

    local key = string.format("%d|%d|%d|%d|%d|%d|%d", mode, lc, step, which, sel, cur, set)
    local shotName = "-"
    if key ~= lastKey then
      lastKey = key
      if shots < SHOTS then
        shotName = string.format("%s_f%05d_m%d_lc%d_s%d_w%d_c%d_p%d",
                                 PREFIX, frame, mode, lc, step, which, sel, cur)
        shot(shotName)
        shots = shots + 1
        -- The two-option question (lc 2) and the pickers (lc 4, lc 13, mode 6)
        -- are the screens whose art is the open question: follow them.
        if lc == 2 or lc == 4 or lc == 13 or mode == 6 then
          for _, d in ipairs(FOLLOW) do
            pending[frame + d] = string.format("%s_f%05d+%02d_m%d_lc%d_s%d_w%d_c%d_p%d",
                                              PREFIX, frame, d, mode, lc, step, which, sel, cur)
          end
        end
      end
    end

    if PRESSQ[1] ~= nil then return end
    if frame - lastAct < EVERY then return end

    -- ---- control arm: does this screen move with NO input at all? -------
    if control then
      if key ~= probeKey then
        SELF[probeKey] = true
        say(string.format("f=%d CONTROL: %s advanced with NO input -> %s (no button credited)",
                          frame, probeKey, key))
        control = false; stuckN = 0; stuckKey = key; lastAct = frame
        return
      end
      controlLeft = controlLeft - 1
      if controlLeft > 0 then lastAct = frame; return end
      control = false
      probing, probeI, probeFrom = true, 1, key
      say(string.format("f=%d CONTROL: %s did NOT move unaided over %d windows -- probing is meaningful",
                        frame, probeKey, CONTROL_WAIT))
      say(string.format("f=%d PROBE try %s on %s", frame, PROBE_ORDER[1][2], probeKey))
      press(PROBE_ORDER[1][1], 4); lastAct = frame
      return
    end

    -- ---- probing: did the last button move anything? -------------------
    if probing then
      if key ~= probeFrom then
        local name = PROBE_ORDER[probeI][2]
        FOUND[probeKey] = name
        say(string.format("f=%d PROBE HIT  %s moved %s -> %s", frame, name, probeFrom, key))
        probing = false; stuckN = 0; stuckKey = key; lastAct = frame
        return
      end
      probeI = probeI + 1
      if probeI > #PROBE_ORDER then
        say(string.format("f=%d PROBE EXHAUSTED on %s | usable=%s hand=%d", frame, probeKey, ustr, hand))
        finish("no button moves this screen")
        return
      end
      say(string.format("f=%d PROBE try %s on %s", frame, PROBE_ORDER[probeI][2], probeKey))
      press(PROBE_ORDER[probeI][1], 4); lastAct = frame
      return
    end

    -- ---- stuck? start probing -----------------------------------------
    if key == stuckKey then stuckN = stuckN + 1 else stuckKey, stuckN = key, 0 end
    if stuckN >= STUCK_AFTER then
      control, controlLeft, probeKey = true, CONTROL_WAIT, key
      say(string.format("f=%d STUCK on %s | usable=%s hand=%d -- CONTROL first (no input)",
                        frame, key, ustr, hand))
      lastAct = frame
      return
    end

    -- ---- ordinary play -------------------------------------------------
    local act
    if lc == 2 and (mode == 5 or mode == 7) then
      -- The two-option question. Only step 2 polls.
      if step == 2 then
        if which == 2 and sel ~= 0 then
          act = "UP(to answer 0)"; press(BTN.UP, 4)
        else
          act = (which == 2) and "ADVANCE(yes)" or "ADVANCE(no, nothing usable)"
          press(ADVANCE, 4)
        end
      else
        return                                   -- opening/closing: do not press
      end
    elseif lc == 4 and (mode == 5 or mode == 7) then
      if nOk == 0 then
        act = "ADVANCE(no legal card)"; press(ADVANCE, 4)
      elseif usable[cur] ~= nil and usable[cur] ~= 0 then
        act = "ADVANCE(play slot " .. cur .. ")"; press(ADVANCE, 4)
      elseif cur > firstOk then
        act = "LEFT(" .. cur .. "->" .. firstOk .. ")"; press(BTN.LEFT, 4)
      else
        act = "RIGHT(" .. cur .. "->" .. firstOk .. ")"; press(BTN.RIGHT, 4)
      end
    elseif mode == 6 then
      -- Summon Phase. SQUARE summons; cross only selects. escardgm 0x24.
      if nOk == 0 then
        act = "ADVANCE(nothing summonable)"; press(ADVANCE, 4)
      elseif usable[cur] ~= nil and usable[cur] ~= 0 then
        act = "SQUARE(summon slot " .. cur .. ")"; press(SUMMON, 4)
      elseif cur > firstOk then
        act = "LEFT(" .. cur .. "->" .. firstOk .. ")"; press(BTN.LEFT, 4)
      else
        act = "RIGHT(" .. cur .. "->" .. firstOk .. ")"; press(BTN.RIGHT, 4)
      end
    else
      -- USE WHAT THE PROBE ALREADY LEARNED. Without this the run rediscovers
      -- the same button forever: the Compile Phase's commit screen (7|6|12)
      -- does not move on X but does on TRIANGLE, and a control-armed probe
      -- found that twice, 1,100 frames apart, because the default action went
      -- straight back to X in between (2026-08-24).
      local learned = FOUND[key]
      if learned then
        for _, e in ipairs(PROBE_ORDER) do
          if e[2] == learned then act = "LEARNED " .. learned; press(e[1], 4); break end
        end
      end
      if not act then act = "ADVANCE"; press(ADVANCE, 4) end
    end

    lastAct = frame
    say(string.format("f=%d m=%d lc=%d st=%d w=%d sel=%d cur=%d hand=%d set=%d | %s | %s | shot=%s",
                      frame, mode, lc, step, which, sel, cur, hand, set, ustr, act, shotName))
    if #lines % 3 == 0 then flush() end
  end)
  if not ok then
    say("# LUA ERROR " .. tostring(err))
    finish("errored")
  end
end)

print("cardduel PLAYER+PROBE armed: prefix=" .. PREFIX .. " max=" .. MAX .. " out=" .. OUT)
