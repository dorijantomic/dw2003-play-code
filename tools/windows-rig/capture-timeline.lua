-- Vsync-driven animation-timeline capture for PCSX-Redux (proven 2026-07-13,
-- Ice Tolerance freeze: 29 shots + 3 savestates, zero crashes).
--
-- WHY: looping one-off RPC screenshot calls from the WSL side crashes this
-- build mid-animation (killed the emulator twice before this pattern).
-- Instead, arm ONE GPU::Vsync listener that does everything in-emulator.
--
-- Usage (after setup-portable.lua): edit the CAP table below (or assign a
-- new one) and dofile this via rpc-windows.sh. Results land in
-- DW3_RIG_ROOT/shots/<prefix>_fN.raw (raw2png.py converts) and
-- DW3_RIG_ROOT/dumps/<prefix>_fN.sav (savestate_vram.py parses — do NOT
-- load these back into the emulator; that crashes).
--
-- CAP = {
--   prefix   = "ice",   -- artifact name prefix
--   press_at = 30,      -- frame to queue press(press_btn) (nil = no press)
--   press_btn= BTN.X,
--   shot_every = 15,    -- screenshot cadence (frames); nil disables
--   shot_from  = 60, shot_to = 480,
--   save_at  = { 170, 260, 350 },  -- frames to write full savestates
--   stop_at  = 480,
-- }

CAP = CAP or {
  prefix = "cap",
  press_at = 30,
  press_btn = BTN and BTN.X or 14,
  shot_every = 15,
  shot_from = 60,
  shot_to = 480,
  save_at = { 170, 260, 350 },
  stop_at = 480,
}

CAP_N = 0
CAP_DONE = false
local saveset = {}
for _, f in ipairs(CAP.save_at or {}) do saveset[f] = true end

CAP_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if CAP_DONE then return end
  CAP_N = CAP_N + 1
  local ok, err = pcall(function()
    if CAP.press_at and CAP_N == CAP.press_at then press(CAP.press_btn, 6) end
    if CAP.shot_every and CAP_N >= CAP.shot_from and CAP_N <= CAP.shot_to
       and CAP_N % CAP.shot_every == 0 then
      shot(CAP.prefix .. "_f" .. CAP_N)
    end
    if saveset[CAP_N] then savestate(CAP.prefix .. "_f" .. CAP_N) end
    if CAP_N > CAP.stop_at then CAP_DONE = true end
  end)
  if not ok then
    CAP_DONE = true
    print("CAPTURE ERR " .. tostring(err))
  end
end)

print("capture-timeline armed prefix=" .. CAP.prefix .. " stop_at=" .. CAP.stop_at)
