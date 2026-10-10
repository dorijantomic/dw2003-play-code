-- Capture the completed GPU linked list immediately before the PsyQ-style
-- DrawOTag submission destroys/clears it.  F0x80027548 writes a0 to DMA2 MADR
-- and starts linked-list mode with CHCR 0x01000401.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local mem = PCSX.getMemPtr()
local function u8(a) return mem[bit.band(a, 0x1fffff)] end
local function u16(a) return u8(a) + u8(a + 1) * 256 end
local function u32(a) return u16(a) + u16(a + 2) * 65536 end
local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end

-- Capture the whole persistent-orb interval. The game does not necessarily
-- submit a new frame on the same vsync parity as our prior screenshot targets.
local function isTarget(frame) return frame >= 450 and frame <= 900 end

DNA_DOT_FRAME = 0
DNA_DOT_DONE = false
DNA_DOT_CALLS = {}
DNA_DOT_BPS = {}

local traceFile = io.open("C:/dw3-rig/dumps/dna_drawotag_state9.log", "w")

local function emit(line)
  if traceFile then
    traceFile:write(line .. "\n")
    traceFile:flush()
  end
end

local function walkChain(start, call)
  local addr = bit.band(start, 0x1fffff)
  local visited = {}
  local links, packets, words = 0, 0, 0

  while addr ~= 0x00ffffff and links < 20000 do
    if addr < 0 or addr > 0x1ffffc or visited[addr] then
      emit(string.format("ERROR f=%d call=%d addr=%06x links=%d", DNA_DOT_FRAME,
        call, addr, links))
      break
    end
    visited[addr] = true

    local tag = u32(addr)
    local count = bit.band(bit.rshift(tag, 24), 0xff)
    local nextAddr = bit.band(tag, 0x00ffffff)
    links = links + 1

    if count > 0 then
      local parts = {
        string.format("P f=%d call=%d origin=%06x count=%d next=%06x",
          DNA_DOT_FRAME, call, addr, count, nextAddr)
      }
      for i = 1, count do parts[#parts + 1] = hex(u32(addr + i * 4)) end
      emit(table.concat(parts, " "))
      packets = packets + 1
      words = words + count
    end

    addr = nextAddr
  end

  emit(string.format("END f=%d call=%d start=%08x links=%d packets=%d words=%d",
    DNA_DOT_FRAME, call, start, links, packets, words))
end

local function capture(start, source)
  if isTarget(DNA_DOT_FRAME) then
    local call = (DNA_DOT_CALLS[DNA_DOT_FRAME] or 0) + 1
    DNA_DOT_CALLS[DNA_DOT_FRAME] = call
    emit(string.format("CALL f=%d call=%d source=%s", DNA_DOT_FRAME, call, source))
    walkChain(start, call)
  end
end

-- Basic DrawOTag(a0).
DNA_DOT_BPS[#DNA_DOT_BPS + 1] = PCSX.addBreakpoint(
  0x80027548, "Exec", 4, "dna_drawotag_state9", function()
  capture(PCSX.getRegisters().GPR.n.a0, "80027548:a0")
  return false
end)

-- DrawOTag2-style path. F0x80028e80 optionally splices a1 onto a0; at this
-- instruction s0 is the final list head immediately before DMA2 setup.
DNA_DOT_BPS[#DNA_DOT_BPS + 1] = PCSX.addBreakpoint(
  0x80028f48, "Exec", 4, "dna_drawotag2_state9", function()
  capture(PCSX.getRegisters().GPR.n.s0, "80028f48:s0")
  return false
end)

DNA_DOT_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_DOT_DONE then return end
  DNA_DOT_FRAME = DNA_DOT_FRAME + 1
  if DNA_DOT_FRAME >= 920 then
    DNA_DOT_DONE = true
    for _, bp in ipairs(DNA_DOT_BPS) do pcall(function() bp:remove() end) end
    if traceFile then traceFile:close(); traceFile = nil end
    print("DNA_DOT_DONE frame=" .. DNA_DOT_FRAME)
  end
end)

PCSX.resumeEmulator()
print("DNA_DOT_ARMED")
