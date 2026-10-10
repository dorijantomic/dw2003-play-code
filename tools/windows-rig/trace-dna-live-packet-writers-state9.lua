-- Discover live packet addresses from the native ordering table at frame 700,
-- then watch those same double-buffered arena slots when the CPU rebuilds them.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local mem = PCSX.getMemPtr()
local function u8(a) return mem[bit.band(a, 0x1fffff)] end
local function u16(a) return u8(a) + u8(a + 1) * 256 end
local function u32(a) return u16(a) + u16(a + 2) * 65536 end
local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end

local traceFile = io.open("C:/dw3-rig/dumps/dna_live_packet_writers_state9.log", "w")
DNA_LWRITE_FRAME = 0
DNA_LWRITE_COUNT = 0
DNA_LWRITE_DONE = false
DNA_LWRITE_BPS = {}

local function emit(line)
  DNA_LWRITE_COUNT = DNA_LWRITE_COUNT + 1
  if traceFile then traceFile:write(line .. "\n"); traceFile:flush() end
end

local function armLivePackets()
  local manager = 0x8004de10
  local build = bit.band(u32(manager + 0x34), 1)
  local screen = 0
  for i = 0, 29 do
    if u32(manager + 0xd8 + i * 4) == 0x1004 then
      screen = u32(manager + 0x60 + i * 4)
      break
    end
  end
  local count = u32(screen + 0x64)
  emit(string.format("scan f=%d build=%d screen=%s count=%d ot0=%s ot1=%s",
    DNA_LWRITE_FRAME, build, hex(screen), count, hex(u32(screen + 0x5c)),
    hex(u32(screen + 0x60))))
  local armed = 0
  for tableIndex = 0, 1 do
    local ot = bit.band(u32(screen + 0x5c + tableIndex * 4), 0x1fffff)
    local otEnd = ot + count * 4
    local next = ot + (count - 1) * 4
    local seen, guard, external = {}, 0, 0
    while next ~= 0xffffff and guard < 20000 and armed < 16 do
      guard = guard + 1
      local off = bit.band(next, 0x1fffff)
      if seen[off] then break end
      seen[off] = true
      local tag = u32(off)
      local cmd = bit.rshift(u32(off + 4), 24)
      if off < ot or off >= otEnd then
        external = external + 1
        if external <= 64 then
          emit(string.format("node table=%d off=%s tag=%s word1=%s cmd=%d",
            tableIndex, hex(0x80000000 + off), hex(tag), hex(u32(off + 4)), cmd))
        end
      end
      if (off < ot or off >= otEnd) and cmd >= 0x20 and cmd <= 0x3f then
        armed = armed + 1
        local address = 0x80000000 + off
        emit(string.format("arm f=%d table=%d build=%d address=%s tag=%s cmd=%s", DNA_LWRITE_FRAME,
          tableIndex, build, hex(address), hex(tag), hex(u32(off + 4))))
        DNA_LWRITE_BPS[#DNA_LWRITE_BPS + 1] = PCSX.addBreakpoint(
          address, "Write", 4, "dna_live_packet", function()
          local regs = PCSX.getRegisters()
          local r = regs.GPR.n
          emit(string.format(
            "hit f=%d target=%s pc=%s ra=%s a0=%s a1=%s a2=%s a3=%s v0=%s v1=%s s0=%s s1=%s s2=%s s3=%s sp=%s",
            DNA_LWRITE_FRAME, hex(address), hex(regs.pc), hex(r.ra), hex(r.a0),
            hex(r.a1), hex(r.a2), hex(r.a3), hex(r.v0), hex(r.v1), hex(r.s0),
            hex(r.s1), hex(r.s2), hex(r.s3), hex(r.sp)))
          return false
          end)
      end
      next = bit.band(tag, 0xffffff)
    end
  end
end

DNA_LWRITE_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_LWRITE_DONE then return end
  DNA_LWRITE_FRAME = DNA_LWRITE_FRAME + 1
  if DNA_LWRITE_FRAME == 700 then armLivePackets() end
  if DNA_LWRITE_FRAME >= 820 then
    DNA_LWRITE_DONE = true
    if traceFile then traceFile:close(); traceFile = nil end
    print(string.format("DNA_LWRITE_DONE frames=%d events=%d", DNA_LWRITE_FRAME,
      DNA_LWRITE_COUNT))
  end
end)

PCSX.resumeEmulator()
print("DNA_LWRITE_ARMED")
