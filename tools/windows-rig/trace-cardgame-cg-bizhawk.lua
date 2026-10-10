-- BizHawk cardgame-overlay call graph.
--
-- Arms one exec hook per function entry in the cardgame overlay (list generated
-- from docs/generated/function-extents.json for ~/ddw3/asm/dw2003/pro/cardgame.s)
-- and counts entries per function while a duel is played. Callbacks ONLY count;
-- they never read RAM and never return a value (a numeric return would rewrite
-- the executed instruction). The log is flushed every 120 frames so a crash
-- still leaves the hits captured so far.
--
-- Arm:  tools/windows-rig/bizhawk-rpc tools/windows-rig/trace-cardgame-cg-bizhawk.lua
-- Dump: tools/windows-rig/bizhawk-rpc "CGCG.dump()"
-- Stop: tools/windows-rig/bizhawk-rpc "CGCG.stop()"
--
-- Log: C:/bizhawk-rig/dumps/cardgame-cg.log
-- Requires C:/bizhawk-rig/cardgame-fnlist.lua (CG_FNS).

CGCG = CGCG or {}
CGCG.path   = CGCG.path   or "C:/bizhawk-rig/dumps/cardgame-cg.log"
CGCG.counts = CGCG.counts or {}
CGCG.first  = CGCG.first  or {}
CGCG.last   = CGCG.last   or {}
CGCG.addrs  = CGCG.addrs  or {}
CGCG.frame  = CGCG.frame  or 0
CGCG.armed  = CGCG.armed  or false
CGCG.guids  = CGCG.guids  or {}

local function append(s)
  local f = io.open(CGCG.path, "a")
  if f then f:write(s .. "\n"); f:close() end
end

if not CGCG.armed then
  dofile("C:/bizhawk-rig/cardgame-fnlist.lua")
  assert(CG_FNS, "cardgame-fnlist.lua did not define CG_FNS")
  append(string.format("# armed fns=%d frame=%d", #CG_FNS, emu.framecount()))
  for i = 1, #CG_FNS do
    local a = CG_FNS[i][1]
    CGCG.addrs[i] = a
    local idx = i
    local g = event.on_bus_exec(function(addr)
      local c = CGCG
      c.counts[idx] = (c.counts[idx] or 0) + 1
      if not c.first[idx] then c.first[idx] = c.frame end
      c.last[idx] = c.frame
    end, a, "cgcg_" .. i, "System Bus")
    if g then CGCG.guids[#CGCG.guids + 1] = g end
  end
  event.onframeend(function()
    CGCG.frame = CGCG.frame + 1
    if CGCG.frame % 120 == 0 then CGCG.flush() end
  end, "cgcg_frame")
  CGCG.armed = true
end

function CGCG.flush()
  local lines = { string.format("# flush frame=%d", CGCG.frame) }
  for i = 1, #CGCG.addrs do
    if CGCG.counts[i] then
      lines[#lines + 1] = string.format("%08x n=%d first=%d last=%d",
        CGCG.addrs[i], CGCG.counts[i], CGCG.first[i], CGCG.last[i])
    end
  end
  append(table.concat(lines, "\n"))
end

function CGCG.dump()
  print(string.format("cardgame-cg frame=%d hit_fns=%s",
    CGCG.frame, tostring(#CGCG.addrs)))
  for i = 1, #CGCG.addrs do
    if CGCG.counts[i] then
      print(string.format("%08x n=%d first=%d last=%d",
        CGCG.addrs[i], CGCG.counts[i], CGCG.first[i], CGCG.last[i]))
    end
  end
end

function CGCG.stop()
  for i = 1, #CGCG.guids do pcall(function() event.unregisterbyid(CGCG.guids[i]) end) end
  pcall(function() event.unregisterbyname("cgcg_frame") end)
  CGCG.flush()
  CGCG.armed = false
  print(string.format("cardgame-cg stopped frame=%d", CGCG.frame))
end

print(string.format("cardgame-cg armed=%s frame=%d out=%s", tostring(CGCG.armed), CGCG.frame, CGCG.path))
