-- Observe, in the running game, the card-duel readings that were settled from
-- assembly on 2026-08-24 and never checked against the disc.
--
-- What this is FOR (each line is a static claim it can falsify):
--   C1  turn order is drawn ONCE. duel+0x2F5 is the seed; the play machine's
--       reset copies it into +0x578/+0x579 at the start of Load and again at
--       Compile. If +0x2F5 changes between sets, "once per duel" is wrong.
--   C2  Fortune Gate. 0x2A raises +0x305 and sets +0x304; Battle-Phase state 8
--       (+0x2F9 == 8) then issues opcode 0x1B per count, and 0x1B's update
--       EXCHANGES the stored totals +0x59C<->+0x664 and +0x59E<->+0x666 — AP
--       and HP swapped between the two SIDES, not within one. Forced below.
--   C3  a pile prompt names its pile in +0x438: 5 own hand, 7 own deck,
--       9 own trash, 0xB opp hand, 0xD opp deck, 0xF opp trash.
--   C4  the set change shuffles side 0's pile only; side 1's is not shuffled.
--
-- Controlled input: X at frame 10-14 to accept the duel, then a 4-frame X pulse
-- every PULSE frames. No directional input, so every prompt takes its default.
--
-- ONE VSync listener, bounded frame budget, pad override always cleared, and
-- the listener always removed. No full-RAM read anywhere: every read is a named
-- field of the resolved duel object.
--
-- Globals to retune without editing: CD_OUT CD_PULSE CD_MAX CD_FORCE_REVEAL
local OUT   = CD_OUT   or "C:/dw3-rig/dumps/cardduel_claims.txt"
local PULSE = CD_PULSE or 90
local MAX   = CD_MAX   or 5400
-- C2 is a controlled experiment: a real Fortune Gate may never be drawn, so on
-- the first Battle Phase we WRITE the reveal counter the card would have
-- written and watch what the machine does with it.
local FORCE = CD_FORCE_REVEAL
if FORCE == nil then FORCE = true end

if CD_LISTENER then CD_LISTENER:remove(); CD_LISTENER = nil end

local FN_ROUND_DRIVER = 0x800a1b48        -- two-level mode machine(duel)
local SPRITE_BASE, SPRITE_SIZE = 0x108, 0x4c
local HEAP_LO, HEAP_HI = 0x000a6000, 0x00110000

local function u32(v) v = v % 4294967296; if v < 0 then v = v + 4294967296 end; return v end
local function hex(v) return string.format("%08x", u32(v)) end
local function validPtr(p) return p >= 0x80000000 and p < 0x80200000 end

local BASE_ROUND = rd32(FN_ROUND_DRIVER)
local pad = PCSX.SIO0.slots[1].pads[1]
local mem = PCSX.getMemPtr()

local lines = {
  "# card-duel claim observation, " .. os.date(),
  "# C1 turn order once  C2 Fortune Gate swap  C3 pile id  C4 set-change shuffle",
  string.format("# pulse=%d max=%d force_reveal=%s", PULSE, MAX, tostring(FORCE)),
  "# f=frame set=+0x300 lc=+0x574 bp=+0x2F9 seed=+0x2F5 turn=+0x578/9",
  "#   play=+0x575 pass=+0x577 op=+0x420 pc=+0x4E0 zone=+0x438 sel=+0x440",
  "#   ap0=+0x59C hp0=+0x59E ap1=+0x664 hp1=+0x666 deck0=+0x5A4 deck1=+0x66C",
}
local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  f:close()
end
local function say(s) lines[#lines + 1] = s end

local frame, duel, loaded = 0, 0, false
local lastKey, lastSeed, lastSet = "", -1, -1
local forced, forcedAt, preAp0, preHp0, preAp1, preHp1 = false, -1, 0, 0, 0, 0
local deck0Seen, deck1Seen = {}, {}

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

-- the first 20 entries of a side's draw pile, as a fingerprint for C4
local function pileKey(base)
  local t = {}
  for i = 0, 19 do t[#t + 1] = string.format("%04x", rd16(base + i * 2)) end
  return table.concat(t, "")
end

CD_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  frame = frame + 1
  if frame > MAX then
    pad.clearOverride(BTN.X)
    say(string.format("# done at frame %d", frame)); flush()
    CD_LISTENER:remove(); CD_LISTENER = nil
    return
  end

  -- input
  if frame == 10 then pad.setOverride(BTN.X)
  elseif frame == 14 then pad.clearOverride(BTN.X)
  elseif frame > 14 then
    local p = frame % PULSE
    if p == 0 then pad.setOverride(BTN.X) elseif p == 4 then pad.clearOverride(BTN.X) end
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

  local set  = rd8(duel + 0x300)
  local lc   = rd8(duel + 0x574)
  local bp   = rd8(duel + 0x2f9)
  local seed = rd8(duel + 0x2f5)
  local t578, t579 = rd8(duel + 0x578), rd8(duel + 0x579)
  local play, pass = rd8(duel + 0x575), rd8(duel + 0x577)
  local op, pc = rd8(duel + 0x420), rd8(duel + 0x4e0)
  local zone, sel = rd8(duel + 0x438), rd8(duel + 0x440)
  local ap0, hp0 = rd16(duel + 0x59c), rd16(duel + 0x59e)
  local ap1, hp1 = rd16(duel + 0x664), rd16(duel + 0x666)
  local dk0, dk1 = rd16(duel + 0x5a4), rd16(duel + 0x66c)

  -- C1: the seed must never change once drawn
  if seed ~= lastSeed then
    say(string.format("C1 f=%d SEED %d -> %d (set=%d)", frame, lastSeed, seed, set))
    lastSeed = seed
  end
  -- C4: fingerprint each side's pile at every set change
  if set ~= lastSet then
    say(string.format("C4 f=%d SET %d -> %d deck0=%d deck1=%d", frame, lastSet, set, dk0, dk1))
    deck0Seen[set] = pileKey(duel + 0x5b0)
    deck1Seen[set] = pileKey(duel + 0x678)
    lastSet = set
  end
  -- C3: log every distinct pile id a prompt names
  if zone ~= 0 then
    local k = "zone" .. zone
    if not deck0Seen[k] then
      deck0Seen[k] = true
      say(string.format("C3 f=%d ZONE=%d sel=%d lc=%d", frame, zone, sel, lc))
    end
  end

  -- C2: force one reveal beat the first time a Battle Phase is entered, then
  -- watch the totals across it. This is the card's own write, nothing more.
  if FORCE and not forced and bp ~= 0 and bp < 8 then
    preAp0, preHp0, preAp1, preHp1 = ap0, hp0, ap1, hp1
    wr8(duel + 0x304, 1)          -- a face index, as 0x2A would set
    wr8(duel + 0x305, 1)          -- one reveal beat
    forced, forcedAt = true, frame
    say(string.format("C2 f=%d FORCED +0x304=1 +0x305=1 | before ap0=%d hp0=%d ap1=%d hp1=%d",
      frame, preAp0, preHp0, preAp1, preHp1))
  end
  if forced and frame > forcedAt and frame <= forcedAt + 400 then
    if ap0 ~= preAp0 or hp0 ~= preHp0 or ap1 ~= preAp1 or hp1 ~= preHp1 then
      say(string.format("C2 f=%d TOTALS ap0=%d hp0=%d ap1=%d hp1=%d (bp=%d op=%02x cnt=%d)",
        frame, ap0, hp0, ap1, hp1, bp, op, rd8(duel + 0x305)))
      preAp0, preHp0, preAp1, preHp1 = ap0, hp0, ap1, hp1
    end
  end

  local key = string.format("%d|%d|%d|%d|%d|%d|%d|%d", set, lc, bp, t578, t579, play, pass, op)
  if key ~= lastKey then
    lastKey = key
    say(string.format(
      "f=%d set=%d lc=%02x bp=%02x seed=%d turn=%d/%d play=%d pass=%d op=%02x pc=%d zone=%d sel=%d ap0=%d hp0=%d ap1=%d hp1=%d dk0=%d dk1=%d",
      frame, set, lc, bp, seed, t578, t579, play, pass, op, pc, zone, sel, ap0, hp0, ap1, hp1, dk0, dk1))
  end
  if frame % 120 == 0 then flush() end
end)

print("cardduel claim trace armed; out=" .. OUT)
