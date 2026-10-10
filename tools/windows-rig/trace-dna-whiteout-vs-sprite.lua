-- Pass 3: decide whether clip 12's op7 draws a full-screen monochrome
-- primitive (F0x80092e18/F0x800930c0), the pack-0x079d sprite effect seen in
-- pass 2, or both.  Capture-only breakpoints plus in-emulator screenshots
-- around the spawn (never loop RPC shots; never pause).

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate8"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

DNA_P3_FRAME = 0
DNA_P3_DONE = false
DNA_P3_TRACE = {}
DNA_P3_SEEN = {}
DNA_P3_BPS = {}
DNA_P3_SPAWN = 0

local MAX_EVENTS = 256
local MAX_FRAMES = 900

local function emit(line)
  if #DNA_P3_TRACE < MAX_EVENTS then
    DNA_P3_TRACE[#DNA_P3_TRACE + 1] = line
  end
end

local function once(key, line)
  if not DNA_P3_SEEN[key] then
    DNA_P3_SEEN[key] = true
    emit(line)
  end
end

local function add(addr, name)
  DNA_P3_BPS[#DNA_P3_BPS + 1] = PCSX.addBreakpoint(addr, "Exec", 4, name, function()
    pcall(function()
      local r = PCSX.getRegisters().GPR.n
      once(string.format("%s:%d", name, DNA_P3_FRAME),
        string.format("f=%d %s a0=%08x a1=%08x a2=%08x ra=%08x",
          DNA_P3_FRAME, name, bit.band(r.a0, 0xffffffff), bit.band(r.a1, 0xffffffff),
          bit.band(r.a2, 0xffffffff), bit.band(r.ra, 0xffffffff)))
    end)
    return false
  end)
end

DNA_P3_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_P3_DONE then return end
  DNA_P3_FRAME = DNA_P3_FRAME + 1

  if DNA_P3_FRAME == 1 then
    add(0x80092e18, "mono_prim_a")
    add(0x800930c0, "mono_prim_b")
    add(0x8008921c, "sprite_draw")
    DNA_P3_BPS[#DNA_P3_BPS + 1] = PCSX.addBreakpoint(0x8008966c, "Exec", 4, "spawn", function()
      pcall(function()
        if DNA_P3_SPAWN == 0 then
          DNA_P3_SPAWN = DNA_P3_FRAME
          emit(string.format("f=%d SPAWN", DNA_P3_FRAME))
        end
      end)
      return false
    end)
  end

  if DNA_P3_SPAWN ~= 0 then
    local rel = DNA_P3_FRAME - DNA_P3_SPAWN
    if rel >= 0 and rel <= 140 and rel % 10 == 0 then
      pcall(shot, string.format("dnafx_r%03d", rel))
    end
  elseif DNA_P3_FRAME % 150 == 0 then
    pcall(shot, string.format("dnapre_f%03d", DNA_P3_FRAME))
  end

  if DNA_P3_FRAME >= MAX_FRAMES or #DNA_P3_TRACE >= MAX_EVENTS then
    DNA_P3_DONE = true
    print(string.format("DNA_P3_DONE frames=%d spawn=%d events=%d",
      DNA_P3_FRAME, DNA_P3_SPAWN, #DNA_P3_TRACE))
  end
end)

PCSX.resumeEmulator()
print("DNA_P3_ARMED")
