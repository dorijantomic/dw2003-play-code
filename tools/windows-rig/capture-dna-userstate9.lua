-- Dense ground-truth capture of the full DNA DV presentation from the user's
-- state 9 (parked one X press from confirming Stingmon + ExVeemon DNA DV).
-- Capture-only: one press, bounded screenshots, no pause, no dumps; the
-- listener self-disables at the cap and is removed by a follow-up RPC.
DNAU_FRAME = 0
DNAU_DONE = false
local SHOT_EVERY = 25
local MAX_FRAMES = 2200

DNAU_L = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNAU_DONE then return end
  DNAU_FRAME = DNAU_FRAME + 1
  if DNAU_FRAME == 10 then press(BTN.X, 4) end
  if DNAU_FRAME >= 30 and DNAU_FRAME % SHOT_EVERY == 0 then
    pcall(shot, string.format("dnau_%04d", DNAU_FRAME))
  end
  if DNAU_FRAME >= MAX_FRAMES then
    DNAU_DONE = true
    print("DNAU_DONE frames=" .. tostring(DNAU_FRAME))
  end
end)
print("DNAU_ARMED")
