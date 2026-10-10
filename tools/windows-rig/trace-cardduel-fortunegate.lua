-- The decisive Fortune Gate experiment, and the set-change pile fingerprints.
--
-- CLAIM UNDER TEST (read from assembly 2026-08-24, never observed):
--   Effect opcode 0x2A does nothing but raise the reveal counter duel+0x305 and
--   put a face index in duel+0x304. Battle-Phase state 8 (+0x2F9 == 8) then
--   issues effect opcode 0x1B once per count, and 0x1B's update phase
--   F0x80093CAC EXCHANGES the stored totals: +0x59C with +0x664, and +0x59E
--   with +0x666. That is AP swapped between the two SIDES and HP swapped
--   between the two SIDES -- NOT a side's own AP with its own HP, which is how
--   the printed card text reads in English.
--
-- WHY IT IS FORCED. Fortune Gate has to be drawn and played to arise naturally.
-- Writing the two bytes the card's own program writes, and then only watching,
-- tests the machine's response without touching the machine.
--
-- TRIGGER. The previous run wrote the bytes during the Load Phase, where they
-- were cleared long before any battle -- +0x2F9 is not zero outside the Battle
-- Phase, so "bp ~= 0" was not the gate it looked like. This run waits for the
-- combo-scan states with real totals on the board, which is the step directly
-- before state 8.
--
-- Also fingerprints both draw piles across a set change, for
-- `cardduel-set-change-shuffles-only-the-player-pile-2026-08-21`: side 0's
-- order must change and side 1's must not.
local OUT = FG_OUT or "C:/dw3-rig/dumps/cardduel_fortunegate.txt"
local PULSE = FG_PULSE or 60
local MAX = FG_MAX or 9000

if FG_LISTENER then FG_LISTENER:remove(); FG_LISTENER = nil end

local DUEL = FG_DUEL or 0x800ac394
local pad = PCSX.SIO0.slots[1].pads[1]
local lines = {
  "# Fortune Gate exchange + set-change pile fingerprints, " .. os.date(),
  "# duel=" .. string.format("%08x", DUEL),
}
local function say(s) lines[#lines + 1] = s end
local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n"); f:close()
end
local function pileKey(base, n)
  local t = {}
  for i = 0, n - 1 do t[#t + 1] = string.format("%d", rd16(base + i * 2)) end
  return table.concat(t, ",")
end

local frame, armed, fired, firedAt = 0, false, false, -1
local lastSet, lastBp, lastKey = -1, -1, ""
local pre = {}

FG_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  frame = frame + 1
  if frame > MAX then
    pad.clearOverride(BTN.X); say("# done " .. frame); flush()
    FG_LISTENER:remove(); FG_LISTENER = nil; return
  end
  local p = frame % PULSE
  if p == 0 then pad.setOverride(BTN.X) elseif p == 4 then pad.clearOverride(BTN.X) end

  local set = rd8(DUEL + 0x300)
  local bp  = rd8(DUEL + 0x2f9)
  local ap0, hp0 = rd16(DUEL + 0x59c), rd16(DUEL + 0x59e)
  local ap1, hp1 = rd16(DUEL + 0x664), rd16(DUEL + 0x666)
  local cnt, face = rd8(DUEL + 0x305), rd8(DUEL + 0x304)

  if set ~= lastSet then
    -- fingerprint BEFORE anything else this frame; the set byte advances inside
    -- mode 9, so this is the pile as the new set opens.
    say(string.format("SET %d -> %d f=%d", lastSet, set, frame))
    say("  pile0=" .. pileKey(DUEL + 0x5b0, 40))
    say("  pile1=" .. pileKey(DUEL + 0x678, 40))
    lastSet = set
  end

  -- Arm only in the Battle Phase's combo scans, with real totals on the board.
  if not fired and (bp == 1 or bp == 2) and (ap0 + hp0 + ap1 + hp1) > 0 then
    pre = { ap0 = ap0, hp0 = hp0, ap1 = ap1, hp1 = hp1 }
    wr8(DUEL + 0x304, 1)
    wr8(DUEL + 0x305, 1)
    fired, firedAt = true, frame
    say(string.format("FORCE f=%d bp=%d | before ap0=%d hp0=%d ap1=%d hp1=%d",
      frame, bp, ap0, hp0, ap1, hp1))
  end

  if fired and frame >= firedAt then
    local key = string.format("%d|%d|%d|%d|%d|%d|%d", bp, ap0, hp0, ap1, hp1, cnt, face)
    if key ~= lastKey then
      lastKey = key
      say(string.format("  f=%d bp=%02d op=%02x cnt=%d face=%d ap0=%d hp0=%d ap1=%d hp1=%d",
        frame, bp, rd8(DUEL + 0x420), cnt, face, ap0, hp0, ap1, hp1))
      if pre.ap0 and (ap0 == pre.ap1 and ap1 == pre.ap0 and hp0 == pre.hp1 and hp1 == pre.hp0)
         and (pre.ap0 ~= pre.ap1 or pre.hp0 ~= pre.hp1) then
        say("  ==> SIDE-FOR-SIDE EXCHANGE OBSERVED")
      end
      if pre.ap0 and ap0 == pre.hp0 and hp0 == pre.ap0 and pre.ap0 ~= pre.hp0 then
        say("  ==> WITHIN-SIDE SWAP OBSERVED (the claim would be WRONG)")
      end
    end
  end
  if bp ~= lastBp then lastBp = bp end
  if frame % 120 == 0 then flush() end
end)
print("fortune-gate experiment armed; out=" .. OUT)
