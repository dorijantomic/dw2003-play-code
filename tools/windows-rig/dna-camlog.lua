-- DNA camera recorder (2026-10-03).
-- Hooks: op5 handler F0x8008c004 (each camera command), camera cut F0x80092244 and glide
-- F0x800922b4 (a0 = camera object). Each frame: the camera object's live block cam+0x54
-- (eye xyz, target xyz as s32, H at +0x30 of the block) and t/step (cam+0xf0/+0xf4).
-- Screenshot every SHOT_EVERY frames. Stops after MAXF frames.
pcall(function() event.unregisterbyname("dnacam_frame") end)
for _, n in ipairs({"dnacam_op5","dnacam_cut","dnacam_glide"}) do pcall(function() event.unregisterbyname(n) end) end
local MAXF, SHOT_EVERY = DNACAM_MAXF or 3000, DNACAM_SHOT or 6
local f = io.open("C:/bizhawk-rig/dumps/dnacam.log", "w")
local cam, n, k = nil, 0, 0
local function r32(a) return memory.read_s32_le(a & 0x1fffff, "MainRAM") end
local function reg(r) return emu.getregister(r) or 0 end
local function hook(pc, tag, setcam)
  event.onmemoryexecute(function()
    local a0 = reg("a0") & 0xffffffff
    if setcam then cam = a0 end
    local p = 0x800a46d8
    f:write(string.format("n=%d fc=%d %s a0=%x a1=%x a2=%x a3=%x ra=%x param eye=%d,%d,%d tgt=%d,%d,%d H=%d\n",
      n, emu.framecount(), tag, a0, reg("a1") & 0xffffffff, reg("a2") & 0xffffffff, reg("a3") & 0xffffffff, reg("ra") & 0xffffffff,
      r32(p), r32(p+4), r32(p+8), r32(p+0xc), r32(p+0x10), r32(p+0x14), r32(p+0x30)))
  end, pc, "dnacam_" .. tag)
end
hook(0x8008c004, "op5", false)
hook(0x80092244, "cut", true)
hook(0x800922b4, "glide", true)
event.onframeend(function()
  n = n + 1
  if cam then
    local b = cam + 0x54
    f:write(string.format("F n=%d eye=%d,%d,%d tgt=%d,%d,%d H=%d t=%d step=%d\n", n,
      r32(b), r32(b+4), r32(b+8), r32(b+0xc), r32(b+0x10), r32(b+0x14), r32(b+0x30),
      r32(cam+0xf0), r32(cam+0xf4)))
  end
  if n % SHOT_EVERY == 1 then
    k = k + 1
    client.screenshot(string.format("C:/bizhawk-rig/dumps/dnacam/%04d.png", n))
  end
  if n >= MAXF then
    f:write("END\n"); f:close()
    for _, x in ipairs({"dnacam_frame","dnacam_op5","dnacam_cut","dnacam_glide"}) do pcall(function() event.unregisterbyname(x) end) end
  end
end, "dnacam_frame")
print("dnacam armed")
