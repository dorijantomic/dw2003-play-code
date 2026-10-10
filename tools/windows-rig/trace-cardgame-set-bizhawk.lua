-- BizHawk curated cardgame-overlay call graph.
--
-- Same logger as trace-cardgame-cg-bizhawk.lua but armed only on the routines a
-- player's duel flow actually calls (from docs/research/ui/symbols/cardgame.json):
-- the picker family, the phase runners, the duel methods, the AI/effect picks and
-- the board draws still carrying identity questions. The full 247-entry list runs
-- at ~1 fps; this set is small enough to play.
--
-- Arm:  tools/windows-rig/bizhawk-rpc tools/windows-rig/trace-cardgame-set-bizhawk.lua
-- Dump: tools/windows-rig/bizhawk-rpc "CGSET.dump()"
-- Stop: tools/windows-rig/bizhawk-rpc "CGSET.stop()"
-- Log:  C:/bizhawk-rig/dumps/cardgame-set.log

local NAMES = {
  {0x80085de8, "sortPickerCardList"},
  {0x80085fd0, "pickerRowIsLegal"},
  {0x80086d78, "openLegalRowPicker"},
  {0x80086eb0, "openBrowsePicker"},
  {0x80086f24, "pickerCursorMove"},
  {0x800870a4, "pickerCursorMoveFromList"},
  {0x8008735c, "spendOrRefundEnergy"},
  {0x800875ac, "pickerPadPickOne"},
  {0x800878b4, "pickerPadPickSeveral"},
  {0x80087b80, "pickerPadBrowse"},
  {0x80087edc, "tickCardPicker"},
  {0x800896f0, "pickerCursorTwoChoices"},
  {0x8008baa4, "openPilePicker"},
  {0x8008c044, "tickPilePicker"},
  {0x8009f110, "runStartPhase"},
  {0x8009f910, "runDrawPhase"},
  {0x8009f998, "commitSelectedHandCard"},
  {0x800a0b80, "runSummonPhase"},
  {0x800a0f94, "runBattlePhase"},
  {0x80092c54, "dealOpeningHands"},
  {0x8009d9e4, "scanDeckAvailability"},
  {0x800a19f8, "returnHandToDeck"},
  {0x8009f04c, "duelMethod_810"},
  {0x8009eefc, "duelMethod_814"},
  {0x800a0754, "duelMethod_818_commitSummons"},
  {0x800a4978, "aiChooseCardToPlay"},
  {0x8008c5f0, "effectOp_9d_autoPickSummons"},
  {0x800a44f0, "aiSimulateGenericEffect"},
  {0x80096828, "createElementPanel"},
  {0x800999a0, "drawTurnMarker"},
  {0x80099be4, "turnMarkerFadeTick"},
  {0x80099de8, "floatNumberDraw"},
  {0x8009acac, "drawSelectionGlow"},
  {0x8009ba3c, "cardSpriteDraw"},
  {0x8008d938, "animCardLeaveSlot"},
  {0x80095030, "tickBannerWait"},
  {0x800894e4, "showPhaseBanner"},
  {0x80094fdc, "showBanner"},
}

CGSET = CGSET or {}
CGSET.path   = CGSET.path   or "C:/bizhawk-rig/dumps/cardgame-set.log"
CGSET.counts = CGSET.counts or {}
CGSET.first  = CGSET.first  or {}
CGSET.last   = CGSET.last   or {}
CGSET.frame  = CGSET.frame  or 0
CGSET.armed  = CGSET.armed  or false
CGSET.guids  = CGSET.guids  or {}

local function append(s)
  local f = io.open(CGSET.path, "a"); if f then f:write(s .. "\n"); f:close() end
end

if not CGSET.armed then
  append(string.format("# armed fns=%d frame=%d", #NAMES, emu.framecount()))
  for i = 1, #NAMES do
    local idx = i
    local g = event.on_bus_exec(function(addr)
      CGSET.counts[idx] = (CGSET.counts[idx] or 0) + 1
      if not CGSET.first[idx] then CGSET.first[idx] = CGSET.frame end
      CGSET.last[idx] = CGSET.frame
    end, NAMES[i][1], "cgset_" .. i, "System Bus")
    if g then CGSET.guids[#CGSET.guids + 1] = g end
  end
  event.onframeend(function()
    CGSET.frame = CGSET.frame + 1
    if CGSET.frame % 120 == 0 then CGSET.flush() end
  end, "cgset_frame")
  CGSET.armed = true
end

function CGSET.flush()
  local lines = { string.format("# flush frame=%d", CGSET.frame) }
  for i = 1, #NAMES do
    if CGSET.counts[i] then
      lines[#lines + 1] = string.format("%08x %-26s n=%d first=%d last=%d",
        NAMES[i][1], NAMES[i][2], CGSET.counts[i], CGSET.first[i], CGSET.last[i])
    end
  end
  append(table.concat(lines, "\n"))
end

function CGSET.dump()
  print("cardgame-set frame=" .. CGSET.frame)
  for i = 1, #NAMES do
    if CGSET.counts[i] then
      print(string.format("%08x %-26s n=%d first=%d last=%d",
        NAMES[i][1], NAMES[i][2], CGSET.counts[i], CGSET.first[i], CGSET.last[i]))
    end
  end
end

function CGSET.stop()
  for i = 1, #CGSET.guids do pcall(function() event.unregisterbyid(CGSET.guids[i]) end) end
  pcall(function() event.unregisterbyname("cgset_frame") end)
  CGSET.flush(); CGSET.armed = false
  print("cardgame-set stopped frame=" .. CGSET.frame)
end

print(string.format("cardgame-set armed=%s fns=%d frame=%d", tostring(CGSET.armed), #NAMES, CGSET.frame))
