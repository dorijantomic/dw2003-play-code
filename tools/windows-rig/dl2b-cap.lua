-- Single-shot probe of the COP2 traffic inside FIGHTSTG_F0x800847f4.
-- BizHawk exposes GPRs only, so COP2 contents are read as the exact GPRs the
-- routine moves into the data/control registers and reads back out:
--   0x80084878  MVMVA #1            t4,t5,t6 -> mtc2 $9,$10,$11 (IR1-3 in)
--   0x8008488c  after mfc2 $9,$10,$11   t4,t5,t6 = IR1-3 result out
--   0x80084964  MVMVA (0x480012)    t4 -> mtc2 $0 (VXY0 in)
--   0x80084968  after swc2 $25,$26,$27  (MAC out written to sp+0x24)
--   0x800849e8  NCS (0xc8041e)      t4,t5 -> mtc2 $0,$1 ; a0 = dest
--   0x800849ec  swc2 $22 -> [a0]    (colour out)
-- Each hook is single-shot: it logs once and unregisters itself.
--
-- Arm:  tools/windows-rig/bizhawk-rpc tools/windows-rig/dl2b-cap.lua
-- Read: tools/windows-rig/bizhawk-rpc "DL2B.dump()"

pcall(function() event.unregisterbyname("d2b_1") end)
pcall(function() event.unregisterbyname("d2b_2") end)
pcall(function() event.unregisterbyname("d2b_3") end)
pcall(function() event.unregisterbyname("d2b_4") end)
pcall(function() event.unregisterbyname("d2b_5") end)
pcall(function() event.unregisterbyname("d2b_6") end)
DL2B = { log = {} }
local function r32(a) return memory.read_u32_le(bit.band(a, 0x1fffff), "MainRAM") end

local function mk(name, pc, fields, tag)
  local done = false
  local function cb()
    if done then return end
    done = true
    pcall(function() event.unregisterbyname(name) end)
    local ok, r = pcall(emu.getregisters)
    if not ok or type(r) ~= "table" then return end
    local parts = { string.format("f=%d pc=%08x %s", emu.framecount(), pc, tag) }
    for _, k in ipairs(fields) do parts[#parts+1] = k .. "=" .. string.format("%08x", bit.band(r[k] or 0, 0xffffffff)) end
    DL2B.log[#DL2B.log+1] = table.concat(parts, " ")
  end
  event.onmemoryexecute(cb, pc, name, "System Bus")
end

mk("d2b_1", 0x80084878, {"s1","t4","t5","t6"}, "MVMVA1 in: IR1-3 <- node+84/8a/90")
mk("d2b_2", 0x8008488c, {"t4","t5","t6"}, "MVMVA1 out: mfc2 $9,$10,$11 (IR1-3)")
mk("d2b_3", 0x80084964, {"s1","t4","t5","t6"}, "MVMVA2 in: mtc2 $0/$1 <- node+98")
mk("d2b_4", 0x80084968, {"s1","t4","t5","t6"}, "MVMVA2 out: swc2 $25,$26,$27")
mk("d2b_5", 0x800849e8, {"s1","a0","t4","t5"}, "NCS in: mtc2 $0/$1 ; a0=dest")
mk("d2b_6", 0x800849ec, {"a0"}, "NCS out: swc2 $22 -> [a0]")

function DL2B.dump()
  print("DL2B entries=" .. #DL2B.log)
  for i = 1, #DL2B.log do print(DL2B.log[i]) end
end
function DL2B.stop()
  for i = 1, 6 do pcall(function() event.unregisterbyname("d2b_"..i) end) end
  print("DL2B stopped")
end
print("DL2B armed 6 single-shot hooks frame=" .. tostring(emu.framecount()))
