local mem = PCSX.getMemPtr()

local function u8(a)
  return mem[bit.band(a, 0x1fffff)]
end

local function u16(a)
  return u8(a) + u8(a + 1) * 256
end

local function s16(a)
  local v = u16(a)
  if v >= 0x8000 then return v - 0x10000 end
  return v
end

local function u32(a)
  return u8(a) + u8(a + 1) * 256 + u8(a + 2) * 65536 + u8(a + 3) * 16777216
end

local function wr16(a, v)
  local off = bit.band(a, 0x1fffff)
  mem[off] = bit.band(v, 0xff)
  mem[off + 1] = bit.band(bit.rshift(v, 8), 0xff)
end

local function rm(name)
  if _G[name] then
    pcall(function() _G[name]:remove() end)
    _G[name] = nil
  end
end

rm("BSC_OP10_BP")
rm("BSC_RESOLVE_BP")
rm("BSC_SOUND_BP")
rm("BSC_REACT_ENTRY_BP")
rm("BSC_REACT_TAIL_BP")
if BSC_LISTENER then
  pcall(function() BSC_LISTENER:remove() end)
  BSC_LISTENER = nil
end

loadstate(BSC_STATE or 1)
PCSX.resumeEmulator()

BSC_FRAME = 0
BSC_LOG = {}

local function log(kind, fields)
  local parts = { string.format("f=%04d", BSC_FRAME), kind }
  for i = 1, #fields do
    parts[#parts + 1] = fields[i]
  end
  BSC_LOG[#BSC_LOG + 1] = table.concat(parts, " ")
end

local function hx(v)
  if not v then return "nil" end
  return string.format("0x%08x", bit.band(v, 0xffffffff))
end

BSC_OP10_BP = PCSX.addBreakpoint(0x8008c454, "Exec", 4, "bsc_op10", function()
  pcall(function()
    local r = PCSX.getRegisters()
    local ctx = r.GPR.n.a0
    local gate = r.GPR.n.a1
    local pc = u32(ctx + 0x8c)
    local raw = s16(pc)
    local dur = s16(pc + 2)
    local contact = u32(ctx + 0x70)
    local idx = u32(ctx + 0x94)
    log("op10", {
      "ctx=" .. hx(ctx),
      "gate=" .. hx(gate),
      "pc=" .. hx(pc),
      "raw=" .. tostring(raw),
      "dur=" .. tostring(dur),
      "contact=" .. tostring(contact),
      "idx=" .. tostring(idx),
    })
  end)
  return false
end)

BSC_RESOLVE_BP = PCSX.addBreakpoint(0x8009b774, "Exec", 4, "bsc_resolve", function()
  pcall(function()
    local r = PCSX.getRegisters()
    local typ = r.GPR.n.a0
    local dur = r.GPR.n.a1
    local packed = 0
    if typ ~= 90 and typ ~= 91 and typ >= 0 and typ < 128 then
      packed = u32(0x800a368c + typ * 4)
    end
    log("resolve", {
      "type=" .. tostring(typ),
      "dur=" .. tostring(dur),
      "packed=" .. hx(packed),
    })
  end)
  return false
end)

BSC_SOUND_BP = PCSX.addBreakpoint(0x8002006c, "Exec", 4, "bsc_sound", function()
  pcall(function()
    local r = PCSX.getRegisters()
    log("sound", {
      "a0=" .. hx(r.GPR.n.a0),
      "ra=" .. hx(r.GPR.n.ra),
    })
  end)
  return false
end)

BSC_REACT_ENTRY_BP = PCSX.addBreakpoint(0x8008d3b4, "Exec", 4, "bsc_react_entry", function()
  pcall(function()
    local r = PCSX.getRegisters()
    local st = r.GPR.n.a0
    local outp = r.GPR.n.a1
    log("react_in", {
      "state=" .. hx(st),
      "outp=" .. hx(outp),
      "phase=" .. tostring(u32(st + 0x14)),
      "kind=" .. tostring(u32(st + 0x70)),
    })
  end)
  return false
end)

BSC_REACT_TAIL_BP = PCSX.addBreakpoint(0x8008d9b0, "Exec", 4, "bsc_react_tail", function()
  pcall(function()
    local r = PCSX.getRegisters()
    local st = r.GPR.n.s2
    local outp = r.GPR.n.s0
    local rec = u32(outp)
    log("react_sel", {
      "state=" .. hx(st),
      "rec=" .. hx(rec),
      "kind=" .. tostring(u32(st + 0x70)),
      "clip=" .. tostring(u32(rec + 0x54)),
      "mode=" .. tostring(u32(rec + 0x64)),
      "arg0=" .. tostring(u32(rec + 0x68)),
      "arg1=" .. tostring(u32(rec + 0x6c)),
      "arg2=" .. tostring(u32(rec + 0x70)),
    })
  end)
  return false
end)

BSC_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  BSC_FRAME = BSC_FRAME + 1
  wr16(0x800a4476, 999)
  wr16(0x800a4478, 999)
  wr16(0x800a44d6, 999)
  wr16(0x800a44d8, 999)
  if BSC_FRAME == 20 then press(BTN.X, 5) end
  if BSC_FRAME == 95 then press(BTN.X, 5) end
end)

print("battle sfx capture armed")
