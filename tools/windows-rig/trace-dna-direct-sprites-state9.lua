-- Trace every direct sprite-directory submission during DNA/Jogress.
--
-- A plain breakpoint at F0x8001ed6c only sees the first draw in a dynarec
-- block (normally the battle HUD).  This trace walks the call chain: after an
-- entry hit it arms the caller's return address, then re-arms the entry from
-- that return so later submissions in the same frame are also observed.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local mem = PCSX.getMemPtr()
local function u8(a) return mem[bit.band(a, 0x1fffff)] end
local function u16(a) return u8(a) + u8(a + 1) * 256 end
local function u32(a) return u16(a) + u16(a + 2) * 65536 end
local function valid(p) return p >= 0x80000000 and p < 0x80200000 end
local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end

DNA_DSPR_FRAME = 0
DNA_DSPR_DONE = false
DNA_DSPR_COUNT = 0

local MAX_FRAMES = 1250
local MAX_EVENTS = 12000
local ENTRY = 0x8001ed6c
local HUD_CALLER = 0x80093584
local traceFile = io.open("C:/dw3-rig/dumps/dna_direct_sprites_state9.log", "w")
local entryBp = nil
local returnBps = {}
local frameSeq = 0

local function emit(line)
  if DNA_DSPR_COUNT >= MAX_EVENTS then return end
  DNA_DSPR_COUNT = DNA_DSPR_COUNT + 1
  if traceFile then
    traceFile:write(line .. "\n")
    traceFile:flush()
  end
end

local function remove(bp)
  if bp then pcall(function() bp:remove() end) end
end

local armEntry
local function armReturn(addr)
  if addr == 0 or addr == ENTRY then return end
  local bp
  bp = PCSX.addBreakpoint(addr, "Exec", 4, "dna_dspr_ret", function()
    remove(bp)
    armEntry()
    return false
  end)
  returnBps[#returnBps + 1] = bp
end

armEntry = function()
  remove(entryBp)
  entryBp = PCSX.addBreakpoint(ENTRY, "Exec", 4, "dna_dspr_entry", function()
    local r = PCSX.getRegisters().GPR.n
    -- Redux exposes GPR addresses as usable positive Lua numbers. bit.band
    -- coerces them to signed int32 and produces an invalid breakpoint address.
    local caller = r.ra
    frameSeq = frameSeq + 1
    remove(entryBp)
    entryBp = nil

    if caller ~= HUD_CALLER then
      local words = "invalid"
      if valid(r.a0) then
        words = string.format("%s,%s,%s,%s,%s,%s",
          hex(u32(r.a0)), hex(u32(r.a0 + 4)), hex(u32(r.a0 + 8)),
          hex(u32(r.a0 + 12)), hex(u32(r.a0 + 16)), hex(u32(r.a0 + 20)))
      end
      emit(string.format(
        "f=%d seq=%d ra=%s a0=%s a1=%s a2=%s a3=%s s0=%s s1=%s s2=%s s3=%s sp=%s mem=%s",
        DNA_DSPR_FRAME, frameSeq, hex(caller), hex(r.a0), hex(r.a1), hex(r.a2),
        hex(r.a3), hex(r.s0), hex(r.s1), hex(r.s2), hex(r.s3), hex(r.sp), words))
    end

    armReturn(caller)
    return false
  end)
end

local function screenshot(name)
  local s = PCSX.GPU.takeScreenShot()
  local f = Support.File.open("C:/dw3-rig/shots/" .. name .. ".raw", "TRUNCATE")
  f:write(s.data)
  f:close()
end

DNA_DSPR_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_DSPR_DONE then return end
  DNA_DSPR_FRAME = DNA_DSPR_FRAME + 1
  frameSeq = 0
  armEntry()

  if DNA_DSPR_FRAME % 100 == 0 then
    pcall(screenshot, string.format("dna_dspr_%04d", DNA_DSPR_FRAME))
  end

  if DNA_DSPR_FRAME >= MAX_FRAMES or DNA_DSPR_COUNT >= MAX_EVENTS then
    DNA_DSPR_DONE = true
    remove(entryBp)
    for _, bp in ipairs(returnBps) do remove(bp) end
    if traceFile then traceFile:close(); traceFile = nil end
    print(string.format("DNA_DSPR_DONE frames=%d events=%d", DNA_DSPR_FRAME,
      DNA_DSPR_COUNT))
  end
end)

PCSX.resumeEmulator()
print("DNA_DSPR_ARMED")
