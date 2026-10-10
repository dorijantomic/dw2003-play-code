-- General call logger for rig confirmation runs (2026-10-03).
--
-- Logs the registers at chosen program counters, so a static reading of a
-- routine can be checked against what the real game passes at run time.
-- One RPC call arms it; it then runs inside the emulator with no RPC traffic
-- (the capture-timeline pattern from docs/research/infra/rig-reference.md).
--
-- Arm:
--   tools/windows-rig/bizhawk-rpc 'CALLLOG_SPEC={name="audio", points={
--     {pc=0x8002006c, tag="play", regs={"a0","ra"}}, ...}}'
--   tools/windows-rig/bizhawk-rpc tools/windows-rig/call-logger.lua
-- Read:  copy C:/bizhawk-rig/dumps/calllog-<name>.log (one line per hit)
-- Stop:  tools/windows-rig/bizhawk-rpc 'CALLLOG.stop()'
--
-- Each line: f=<frame> tag=<tag> pc=<pc> <reg>=<hex> ...
-- Optional per point: mem={{addr=0x..., size=4, as="x"}} reads one word each
-- (keep it to a few; every hit runs inside the emulated frame).
-- A point with max=N stops logging after N hits, so a busy routine cannot
-- flood the file.
-- A point with write=true watches a memory WRITE to `pc` (an address, not code)
-- instead of an execute. The line then also carries by=<writing pc>. The hook
-- runs before the store lands, so the new value is not in memory yet; add the
-- store's source register to `regs` to log it.

CALLLOG = CALLLOG or {}
local spec = CALLLOG_SPEC or { name = "default", points = {} }
CALLLOG.path = "C:/bizhawk-rig/dumps/calllog-" .. spec.name .. ".log"

local function hex(v)
  return string.format("0x%08x", bit.band(v or 0, 0xffffffff))
end

local function append(line)
  local f = io.open(CALLLOG.path, "a")
  if f then
    f:write(line .. "\n")
    f:close()
  end
end

if CALLLOG.names then
  for _, n in ipairs(CALLLOG.names) do pcall(function() event.unregisterbyname(n) end) end
end
CALLLOG.names = {}
CALLLOG.hits = {}

append(string.format("# armed name=%s frame=%d points=%d", spec.name, emu.framecount(), #spec.points))

for i, p in ipairs(spec.points) do
  local name = "calllog_" .. spec.name .. "_" .. i
  CALLLOG.hits[i] = 0
  local function on_hit()
    if p.max and CALLLOG.hits[i] >= p.max then return end
    CALLLOG.hits[i] = CALLLOG.hits[i] + 1
    local ok, r = pcall(emu.getregisters)
    if not ok or type(r) ~= "table" then return end
    local parts = { string.format("f=%d tag=%s pc=%s", emu.framecount(), p.tag or "?", hex(p.pc)) }
    if p.write then parts[#parts + 1] = "by=" .. hex(r.pc) end
    for _, reg in ipairs(p.regs or {}) do
      parts[#parts + 1] = reg .. "=" .. hex(r[reg])
    end
    for _, m in ipairs(p.mem or {}) do
      local addr = m.addr
      if m.base then addr = bit.band((r[m.base] or 0) + (m.off or 0), 0xffffffff) end
      local v
      if m.size == 1 then v = memory.read_u8(bit.band(addr, 0x1fffff), "MainRAM")
      elseif m.size == 2 then v = memory.read_u16_le(bit.band(addr, 0x1fffff), "MainRAM")
      else v = memory.read_u32_le(bit.band(addr, 0x1fffff), "MainRAM") end
      parts[#parts + 1] = (m.label or hex(addr)) .. "=" .. hex(v)
    end
    append(table.concat(parts, " "))
  end
  if p.write then
    event.onmemorywrite(on_hit, p.pc, name)
  else
    event.onmemoryexecute(on_hit, p.pc, name)
  end
  CALLLOG.names[#CALLLOG.names + 1] = name
end

function CALLLOG.stop()
  for _, n in ipairs(CALLLOG.names or {}) do pcall(function() event.unregisterbyname(n) end) end
  local total = 0
  for _, h in pairs(CALLLOG.hits or {}) do total = total + h end
  append(string.format("# stopped frame=%d hits=%d", emu.framecount(), total))
  print("calllog stopped hits=" .. total)
  CALLLOG.names = {}
end

print("calllog armed name=" .. spec.name .. " points=" .. #spec.points .. " -> " .. CALLLOG.path)
