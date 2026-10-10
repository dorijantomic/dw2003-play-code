-- Sample the resident frame-delta global D0x8004DE28 once per vsync.
-- Settles whether the duel's ~1.165 ticks-per-displayed-frame comes from a
-- VARIABLE delta (1 most frames, 2 occasionally) or from something else.
-- Defensive shape build 314 needs: one listener, pcall, hard budget, always removed.
if FD_LISTENER then FD_LISTENER:remove(); FD_LISTENER = nil end
local OUT = FD_OUT or "C:/dw3-rig/dumps/frame_delta.txt"
local MAX = FD_MAX or 900
local frame, done = 0, false
local counts, seq = {}, {}
local function finish(why)
  if done then return end
  done = true
  local lines = {"# frame-delta sample of D0x8004DE28, " .. os.date(),
                 "# " .. why .. " after " .. frame .. " frames"}
  local total, weighted = 0, 0
  for v, n in pairs(counts) do
    lines[#lines+1] = string.format("delta=%d count=%d", v, n)
    total = total + n; weighted = weighted + v * n
  end
  lines[#lines+1] = string.format("mean=%.4f over %d frames", weighted / total, total)
  lines[#lines+1] = "first 80: " .. table.concat(seq, "", 1, math.min(80, #seq))
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n"); f:close()
  if FD_LISTENER then FD_LISTENER:remove(); FD_LISTENER = nil end
end
FD_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if done then return end
  local ok, err = pcall(function()
    frame = frame + 1
    if frame > MAX then finish("budget spent"); return end
    local d = rd32(0x8004DE28)
    counts[d] = (counts[d] or 0) + 1
    if #seq < 200 then seq[#seq+1] = tostring(d) end
  end)
  if not ok then finish("errored: " .. tostring(err)) end
end)
print("frame-delta sampler armed, max=" .. MAX)
