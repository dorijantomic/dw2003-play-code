-- Drive savestate 1 forward and find out whether it reaches the card duel.
-- Diagnostic only: pulses X, shoots every SHOT_EVERY frames, logs whether the
-- cardgame overlay's round driver has been paged in.
--
-- Written the defensive way build 314 requires: ONE GPU::Vsync listener,
-- everything inside pcall, a hard frame budget, the pad override always
-- cleared and the listener always removed.
if PS1_LISTENER then PS1_LISTENER:remove(); PS1_LISTENER = nil end

local OUT        = PS1_OUT   or "C:/dw3-rig/dumps/probe_state1_to_duel.txt"
local PREFIX     = PS1_PREFIX or "s1probe"
local PULSE      = PS1_PULSE or 40
local MAX        = PS1_MAX   or 2400
local SHOT_EVERY = PS1_SHOT  or 60

local FN_ROUND_DRIVER = 0x800a1b48
local BASE_ROUND = rd32(FN_ROUND_DRIVER)
local pad = PCSX.SIO0.slots[1].pads[1]

local lines = {
  "# probe: does savestate 1 lead into the card duel?",
  string.format("# pulse=%d max=%d shot_every=%d base_round=%08x",
                PULSE, MAX, SHOT_EVERY, BASE_ROUND),
}
local function say(s) lines[#lines + 1] = s end
local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  f:close()
end

local frame, loaded, done = 0, false, false
local function finish(why)
  if done then return end
  done = true
  pcall(function() pad.clearOverride(BTN.X) end)
  say(string.format("# %s at frame %d loaded=%s", why, frame, tostring(loaded)))
  flush()
  if PS1_LISTENER then PS1_LISTENER:remove(); PS1_LISTENER = nil end
end

PS1_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if done then return end
  local ok, err = pcall(function()
    frame = frame + 1
    if frame > MAX then finish("budget spent"); return end

    local p = frame % PULSE
    if p == 0 then pad.setOverride(BTN.X) elseif p == 5 then pad.clearOverride(BTN.X) end

    if not loaded and rd32(FN_ROUND_DRIVER) ~= BASE_ROUND then
      loaded = true
      say(string.format("# CARDGAME OVERLAY LOADED at frame %d", frame))
      flush()
    end
    if frame % SHOT_EVERY == 0 then
      shot(string.format("%s_f%05d", PREFIX, frame))
      say(string.format("f=%d loaded=%s round=%08x", frame, tostring(loaded),
                        rd32(FN_ROUND_DRIVER)))
      flush()
    end
  end)
  if not ok then say("# LUA ERROR " .. tostring(err)); finish("errored") end
end)

print("state1 probe armed: pulse=" .. PULSE .. " max=" .. MAX)
