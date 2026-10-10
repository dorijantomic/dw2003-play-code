-- Full-run renderer ownership trace for Jogress, starting from the user's
-- GUI-created AppData state 9 (one confirm press before DNA DV).  State restore
-- replaces both the pad object and the RPC listener, so everything after the
-- load must remain in this injected Vsync listener; reacquire the pad at press.
--
-- Build 314's dynarec stops delivering a given Exec breakpoint after its
-- translated block is invalidated. Re-arm the small, known renderer set every
-- ten Vsyncs instead of scanning RAM or pausing the emulator.

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate9"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))
local dnaPad = nil

local mem = PCSX.getMemPtr()
local function u8(a) return mem[bit.band(a, 0x1fffff)] end
local function u16(a) return u8(a) + u8(a + 1) * 256 end
local function u32(a) return u16(a) + u16(a + 2) * 65536 end
local function hex(v) return string.format("%08x", bit.band(v or 0, 0xffffffff)) end
local function valid(p) return p >= 0x80000000 and p < 0x80200000 end

DNA9_REND_FRAME = 0
DNA9_REND_DONE = false
DNA9_REND_LOG = {}
DNA9_REND_BPS = {}

local MAX_FRAMES = 2400
local MAX_EVENTS = 1200
-- AppData save-state restoration needs several presented frames before a pad
-- override is accepted reliably on build 314.  A frame-10 press can be lost
-- while the UI still looks fully restored, leaving us on the confirmation.
local PRESS_AT = 90
local TRACE_FROM = 350
local TRACE_TO = 2000

local targets = {
  { 0x8001ed6c, "dir_sprite" },
  { 0x8002915c, "gpu_prim" },
  { 0x8008921c, "effect_sprite" },
  { 0x80083e0c, "fight_actor" },
}

local function removeBps()
  for _, bp in ipairs(DNA9_REND_BPS) do pcall(function() bp:remove() end) end
  DNA9_REND_BPS = {}
end

local function emit(name)
  if #DNA9_REND_LOG >= MAX_EVENTS then return end
  local r = PCSX.getRegisters().GPR.n
  local p = r.a0
  local words = ""
  if valid(p) then
    words = string.format(" mem=%s,%s,%s,%s",
      hex(u32(p)), hex(u32(p + 4)), hex(u32(p + 8)), hex(u32(p + 12)))
  end
  DNA9_REND_LOG[#DNA9_REND_LOG + 1] = string.format(
    "f=%d fn=%s a0=%s a1=%s a2=%s a3=%s ra=%s s0=%s s1=%s s2=%s%s",
    DNA9_REND_FRAME, name, hex(r.a0), hex(r.a1), hex(r.a2), hex(r.a3), hex(r.ra),
    hex(r.s0), hex(r.s1), hex(r.s2), words)
end

local function arm()
  removeBps()
  for _, t in ipairs(targets) do
    local name = t[2]
    DNA9_REND_BPS[#DNA9_REND_BPS + 1] =
      PCSX.addBreakpoint(t[1], "Exec", 4, "dna9_" .. name, function()
        pcall(emit, name)
        return false
      end)
  end
end

DNA9_REND_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA9_REND_DONE then return end
  DNA9_REND_FRAME = DNA9_REND_FRAME + 1
  if DNA9_REND_FRAME == PRESS_AT then
    dnaPad = PCSX.SIO0.slots[1].pads[1]
    dnaPad.setOverride(BTN.X)
  end
  if DNA9_REND_FRAME == PRESS_AT + 6 then dnaPad.clearOverride(BTN.X) end

  if DNA9_REND_FRAME >= TRACE_FROM and DNA9_REND_FRAME <= TRACE_TO
      and DNA9_REND_FRAME % 10 == 0 then
    arm()
  end
  if DNA9_REND_FRAME >= TRACE_FROM and DNA9_REND_FRAME <= TRACE_TO
      and DNA9_REND_FRAME % 50 == 0 then
    pcall(shot, string.format("dna9rend_%04d", DNA9_REND_FRAME))
  end

  if DNA9_REND_FRAME >= MAX_FRAMES or #DNA9_REND_LOG >= MAX_EVENTS then
    DNA9_REND_DONE = true
    removeBps()
    print(string.format("DNA9_REND_DONE frames=%d events=%d",
      DNA9_REND_FRAME, #DNA9_REND_LOG))
  end
end)

PCSX.resumeEmulator()
print("DNA9_REND_ARMED")
