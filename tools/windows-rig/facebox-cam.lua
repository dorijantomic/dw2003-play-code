-- Log the face box framing read (FIGHTSTG_F0x80091c1c) each time it runs:
-- self+0x50 (resource index), the speaker flag, the record pointer and the seven fields.
pcall(function() event.unregisterbyname("fbc_exec") end)
pcall(function() event.unregisterbyname("fbc_pad") end)
local function r32(a) return memory.read_u32_le(a & 0x1fffff, "MainRAM") end
local function s32(a) local v = r32(a); if v >= 0x80000000 then v = v - 0x100000000 end; return v end
local function s16(a) local v = memory.read_u16_le(a & 0x1fffff, "MainRAM"); if v >= 0x8000 then v = v - 0x10000 end; return v end
local log = io.open(FBC_LOG or "C:/bizhawk-rig/dumps/fbc.txt", "w")
local hits = 0
event.onmemoryexecute(function()
  local self = r32(0x1f8003fc) -- placeholder, replaced below by $s0 read
end, 0x80091ce4, "fbc_exec")
pcall(function() event.unregisterbyname("fbc_exec") end)
event.onmemoryexecute(function()
  local self = emu.getregister("s0") & 0xffffffff
  local rec = emu.getregister("a2") & 0xffffffff
  local spk = r32(r32(self + 0x54) + 0x18)
  hits = hits + 1
  local t = {}
  for g = 0, 7 do
    t[#t+1] = string.format("g%d eye=%d,%d,%d tgt=%d,%d,%d H=%d", g,
      s16(rec + 0x1a + g*6), s16(rec + 0x1c + g*6), s16(rec + 0x1e + g*6),
      s16(rec + 0x62 + g*6), s16(rec + 0x64 + g*6), s16(rec + 0x66 + g*6), s16(rec + 0xaa + g*2))
  end
  log:write(string.format("hit=%d fc=%d self=%08x idx=%d spk=%d rec=%08x self58..78=%d,%d,%d %d,%d,%d H=%d\n  %s\n",
    hits, emu.framecount(), self, r32(self + 0x50), spk, rec,
    s32(self+0x58), s32(self+0x5c), s32(self+0x60), s32(self+0x64), s32(self+0x68), s32(self+0x6c), s32(self+0x78),
    table.concat(t, "\n  ")))
  log:flush()
  if hits <= 4 then client.screenshot(string.format("C:/bizhawk-rig/dumps/fbc-%d.png", hits)) end
end, 0x80091ce4, "fbc_exec")
savestate.load(FBC_STATE or "C:/bizhawk-rig/states/loss-start-2026-10-03.State")
local n = 0
event.onframeend(function()
  n = n + 1
  if n % 60 < 6 then joypad.set({ ["P1 Cross"] = true }) end
  if n >= 1500 then event.unregisterbyname("fbc_pad"); event.unregisterbyname("fbc_exec"); log:close() end
end, "fbc_pad")
print("fbc armed")
