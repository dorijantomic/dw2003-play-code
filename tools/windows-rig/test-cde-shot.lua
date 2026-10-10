-- Bounded self-test: does savestatePNG work inside an event.onframeend callback
-- on this BizHawk rig? Takes 4 screenshots, one per frame, then sets a done flag.
-- Removal is a separate RPC call (callbacks are PROHIBITED_MID_FRAME).
CDE_TEST = CDE_TEST or { n = 0, done = false }
if not CDE_TEST.armed then
  event.onframeend(function()
    if CDE_TEST.done then return end
    savestatePNG("cdetest_" .. tostring(emu.framecount()))
    CDE_TEST.n = CDE_TEST.n + 1
    if CDE_TEST.n >= 4 then CDE_TEST.done = true end
  end, "cde_test_frame")
  CDE_TEST.armed = true
end
print("cde-test armed frame=" .. tostring(emu.framecount()))
