-- Native DNA/Jogress director trace from the GUI AppData state 9.
--
-- State 9 was refreshed by the user immediately after confirming "DNA DV!" on
-- 2026-07-15, so restoring it enters the presentation without synthetic pad
-- input. This trace records the clip-12 action director, the evolution
-- presentation owner, ordinary effect creation/update/draw, and the 0x1003 /
-- 0x1004 screen-region objects used by FIGHTSTG_F0x80089cd8.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

local mem = PCSX.getMemPtr()
local function u8(a) return mem[bit.band(a, 0x1fffff)] end
local function u16(a) return u8(a) + u8(a + 1) * 256 end
local function s16(a)
  local v = u16(a)
  return v >= 0x8000 and v - 0x10000 or v
end
local function u32(a) return u16(a) + u16(a + 2) * 65536 end
local function valid(p) return p >= 0x80000000 and p < 0x80200000 end
local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end

DNA_DIR9_FRAME = 0
DNA_DIR9_DONE = false
DNA_DIR9_LOG = {}
DNA_DIR9_BPS = {}
DNA_DIR9_OWNER = 0
DNA_DIR9_SCREEN3 = 0
DNA_DIR9_SCREEN4 = 0

local MAX_FRAMES = 4200
local MAX_EVENTS = 2400
local traceFile = io.open("C:/dw3-rig/dumps/dna_director_state9.log", "w")

local function emit(line)
  if #DNA_DIR9_LOG < MAX_EVENTS then
    DNA_DIR9_LOG[#DNA_DIR9_LOG + 1] = line
    if traceFile then
      traceFile:write(line .. "\n")
      traceFile:flush()
    end
  end
end

local function regs() return PCSX.getRegisters().GPR.n end

local function screenshot(name)
  local s = PCSX.GPU.takeScreenShot()
  local f = Support.File.open("C:/dw3-rig/shots/" .. name .. ".raw", "TRUNCATE")
  f:write(s.data)
  f:close()
end

local function removeBps()
  for _, bp in ipairs(DNA_DIR9_BPS) do pcall(function() bp:remove() end) end
  DNA_DIR9_BPS = {}
end

local function add(addr, name, fn)
  DNA_DIR9_BPS[#DNA_DIR9_BPS + 1] =
    PCSX.addBreakpoint(addr, "Exec", 4, "dna_dir9_" .. name, function()
      pcall(fn, regs())
      return false
    end)
end

local function arm()
  removeBps()

  add(0x80089cd8, "evol_owner", function(r)
    DNA_DIR9_OWNER = r.a0
  end)

  add(0x8008bc80, "op3", function(r)
    local p = r.a0
    emit(string.format("f=%d op3 ctx=%s cursor=%s", DNA_DIR9_FRAME, hex(p),
      valid(p) and hex(u32(p + 0x8c)) or "invalid"))
  end)

  add(0x80089be4, "effect_create", function(r)
    emit(string.format("f=%d effect_create type=%d pos=%s ra=%s", DNA_DIR9_FRAME,
      bit.band(r.a0, 0xffff), hex(r.a1), hex(r.ra)))
  end)

  add(0x800893dc, "effect_update", function(r)
    local p = r.a0
    if valid(p) then
      emit(string.format(
        "f=%d effect_update obj=%s state=%d prog=%s xyz=%d,%d,%d elapsed=%d",
        DNA_DIR9_FRAME, hex(p), u32(p + 0x0c), hex(u32(p + 0x50)),
        s16(p + 0x54), s16(p + 0x56), s16(p + 0x58), u32(p + 0x6c)))
    end
  end)

  add(0x8008921c, "effect_draw", function(r)
    local p = r.a0
    if valid(p) then
      emit(string.format(
        "f=%d effect_draw obj=%s xyz=%d,%d,%d clip=%d clut=%d dxy=%d,%d scale=%d,%d angle=%d",
        DNA_DIR9_FRAME, hex(p), s16(p + 0x54), s16(p + 0x56), s16(p + 0x58),
        s16(p + 0x7c), s16(p + 0x7e), s16(p + 0x80), s16(p + 0x82),
        s16(p + 0x84), s16(p + 0x86), s16(p + 0x8c)))
    end
  end)

  -- Return sites after manager[+0x17c](0x1004 / 0x1003).
  add(0x8008a224, "screen4_get", function(r) DNA_DIR9_SCREEN4 = r.v0 end)
  add(0x8008a268, "screen3_get", function(r) DNA_DIR9_SCREEN3 = r.v0 end)
end

DNA_DIR9_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_DIR9_DONE then return end
  DNA_DIR9_FRAME = DNA_DIR9_FRAME + 1

  -- Arm before the relevant blocks are translated. On build 314, installing an
  -- Exec breakpoint after a dynarec block has already run can miss it forever.
  if DNA_DIR9_FRAME == 1 or DNA_DIR9_FRAME % 5 == 0 then arm() end

  if DNA_DIR9_FRAME % 10 == 0 then
    local action = 0x800c106c
    local line = string.format("f=%d action state=%d cursor=%s", DNA_DIR9_FRAME,
      u32(action + 0x0c), hex(u32(action + 0x8c)))
    if valid(DNA_DIR9_OWNER) then
      local p = DNA_DIR9_OWNER
      line = line .. string.format(
        " owner=%s state=%d sub=%d timer=%d edge=%d,%d,%d,%d",
        hex(p), u32(p + 0x0c), u32(p + 0x10), u32(p + 0x18),
        s16(p + 0x60), s16(p + 0x66), s16(p + 0x6a), s16(p + 0x6e))
    end
    emit(line)
  end

  if DNA_DIR9_FRAME % 25 == 0 then
    for _, item in ipairs({ {"screen3", DNA_DIR9_SCREEN3}, {"screen4", DNA_DIR9_SCREEN4} }) do
      local name, p = item[1], item[2]
      if valid(p) then
        emit(string.format(
          "f=%d %s obj=%s methods=%s,%s xy=%d,%d,%d,%d words=%s,%s",
          DNA_DIR9_FRAME, name, hex(p), hex(u32(p + 0x110)), hex(u32(p + 0x114)),
          s16(p + 0x20), s16(p + 0x22), s16(p + 0x24), s16(p + 0x26),
          hex(u32(p + 0x34)), hex(u32(p + 0x38))))
      end
    end
  end

  if DNA_DIR9_FRAME % 100 == 0 then
    pcall(screenshot, string.format("dna_dir9_%04d", DNA_DIR9_FRAME))
  end

  if DNA_DIR9_FRAME >= MAX_FRAMES or #DNA_DIR9_LOG >= MAX_EVENTS then
    DNA_DIR9_DONE = true
    removeBps()
    if traceFile then traceFile:close(); traceFile = nil end
    print(string.format("DNA_DIR9_DONE frames=%d events=%d owner=%s screen3=%s screen4=%s",
      DNA_DIR9_FRAME, #DNA_DIR9_LOG, hex(DNA_DIR9_OWNER), hex(DNA_DIR9_SCREEN3),
      hex(DNA_DIR9_SCREEN4)))
  end
end)

PCSX.resumeEmulator()
print("DNA_DIR9_ARMED")
