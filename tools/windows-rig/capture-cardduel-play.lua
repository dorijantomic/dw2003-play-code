-- Photograph the card duel's PLAY NEGOTIATION on the disc — the three states
-- of F0x8009FDD8 that the walker had wrong until 2026-08-24.
--
-- WHAT THIS IS FOR. The mechanism is read and the ART is not:
--   state 2, opcode 0x98 -> the TWO-OPTION PROMPT (F0x8008642C). Its message id
--     is 0xE ("Use a Program Card?"), it has exactly two answers, and it opens
--     through the view's +0xEE4 method. WHAT THAT DRAWS HAS NEVER BEEN READ OR
--     SEEN. That is the single thing this capture exists to settle.
--   state 4, opcode 0x99 -> the hand selector (F0x80086D78 + F0x80087EDC).
--     F0x80086D78 marks every hand entry usable or not, so the row should be
--     drawn with per-card legality. Never seen either.
--   state 6 -> the commit, whose declining arm is the take-back.
--
-- HOW, and why it is written this way. Looping one-off RPC shot() calls from
-- WSL crashes this build — it did exactly that on 2026-08-24, one call after a
-- loadSaveState. So: ONE GPU::Vsync listener, every screenshot taken from
-- inside it, the whole body wrapped in pcall, a hard frame budget, the pad
-- override always cleared and the listener always removed.
--
-- No full-RAM read anywhere. Every read is a named field of the resolved duel
-- object; the resolution is the sprite-pool signature proven in
-- trace-cardduel-claims.lua (ctx = 0x800c7434, duel = 0x800ac394 on 2026-08-24).
--
-- Input is a SLOW pulse on purpose. Each prompt has to sit on screen long
-- enough to be photographed, so X is tapped once every CP_PULSE frames rather
-- than continuously, and no direction is ever pressed — every prompt takes its
-- default answer, which for the question is "yes" and so walks INTO the hand
-- selector rather than past it.
--
-- Globals to retune without editing: CP_OUT CP_PREFIX CP_PULSE CP_MAX CP_SHOTS
local OUT    = CP_OUT    or "C:/dw3-rig/dumps/cardduel_play.txt"
local PREFIX = CP_PREFIX or "play"
local PULSE  = CP_PULSE  or 150      -- ~2.5s per prompt at 60Hz
local MAX    = CP_MAX    or 5400
local SHOTS  = CP_SHOTS  or 60       -- hard cap on files written

if CP_LISTENER then CP_LISTENER:remove(); CP_LISTENER = nil end

local FN_ROUND_DRIVER = 0x800a1b48
local SPRITE_BASE, SPRITE_SIZE = 0x108, 0x4c
local HEAP_LO, HEAP_HI = 0x000a6000, 0x00110000

local function u32(v) v = v % 4294967296; if v < 0 then v = v + 4294967296 end; return v end
local function hex(v) return string.format("%08x", u32(v)) end
local function validPtr(p) return p >= 0x80000000 and p < 0x80200000 end

local BASE_ROUND = rd32(FN_ROUND_DRIVER)
local pad = PCSX.SIO0.slots[1].pads[1]
local mem = PCSX.getMemPtr()

local lines = {
  "# card-duel PLAY NEGOTIATION capture, " .. os.date(),
  "# purpose: photograph state 2's two-option box, state 4's hand selector,",
  "#          state 6's commit. The art of all three is unread.",
  string.format("# prefix=%s pulse=%d max=%d shots<=%d", PREFIX, PULSE, MAX, SHOTS),
  "# f=frame mode=+0x2F8 lc=+0x574 step=+0x422 op=+0x420 which=+0x438",
  "#   sel=+0x440 view=+0x499 hand=+0x5A6 acc=+0x424",
  "# shot=<file> written on every change of (lc,step,which,sel,view)",
}
local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  f:close()
end
local function say(s) lines[#lines + 1] = s end

local frame, duel, loaded = 0, 0, false
local shots, lastKey = 0, ""
local done = false

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
        return d
      end
    end
  end
  return 0
end

local function finish(why)
  if done then return end
  done = true
  pad.clearOverride(BTN.X)
  say(string.format("# %s at frame %d, %d shots", why, frame, shots))
  flush()
  if CP_LISTENER then CP_LISTENER:remove(); CP_LISTENER = nil end
end

CP_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if done then return end
  local ok, err = pcall(function()
    frame = frame + 1
    if frame > MAX then finish("budget spent"); return end

    -- Input: one tap to accept the duel, then a slow tap so each prompt is
    -- readable. No direction is ever pressed.
    if frame == 10 then pad.setOverride(BTN.X)
    elseif frame == 14 then pad.clearOverride(BTN.X)
    elseif frame > 14 then
      local p = frame % PULSE
      if p == 0 then pad.setOverride(BTN.X) elseif p == 5 then pad.clearOverride(BTN.X) end
    end

    if not loaded then
      if rd32(FN_ROUND_DRIVER) ~= BASE_ROUND then
        loaded = true; say(string.format("# overlay loaded at frame %d", frame))
      end
      return
    end
    if duel == 0 then
      if frame % 30 == 0 then duel = resolve() end
      return
    end

    local mode  = rd8(duel + 0x2f8)
    local lc    = rd8(duel + 0x574)
    local step  = rd8(duel + 0x422)
    local op    = rd8(duel + 0x420)
    local which = rd8(duel + 0x438)
    local sel   = rd8(duel + 0x440)
    local view  = rd8(duel + 0x499)
    local hand  = rd8(duel + 0x5a6)
    local acc   = rd32(duel + 0x424)

    -- One line and one photograph per distinct on-screen situation. The key is
    -- everything that selects WHAT is drawn: the play-machine state, the
    -- prompt's own step, which prompt it is, where its cursor rests, and the
    -- view-mode byte F0x80086D78 and F0x8008642C both write.
    local key = string.format("%d|%d|%d|%d|%d|%d", lc, step, which, sel, view, mode)
    if key ~= lastKey then
      lastKey = key
      local name = string.format("%s_f%05d_m%d_lc%d_s%d_w%d_c%d_v%d",
                                 PREFIX, frame, mode, lc, step, which, sel, view)
      local shotName = "-"
      if shots < SHOTS then
        shot(name)
        shots = shots + 1
        shotName = name
      end
      say(string.format("f=%d mode=%d lc=%d step=%d op=%02x which=%d sel=%d view=%02x hand=%d acc=%d shot=%s",
                        frame, mode, lc, step, op, which, sel, view, hand, acc, shotName))
      if shots % 8 == 0 then flush() end
    end
  end)
  if not ok then
    say("# LUA ERROR " .. tostring(err))
    finish("errored")
  end
end)

print("cardduel play capture armed: prefix=" .. PREFIX .. " pulse=" .. PULSE
      .. " max=" .. MAX .. " out=" .. OUT)
