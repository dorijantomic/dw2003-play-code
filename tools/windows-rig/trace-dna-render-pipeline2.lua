-- Bounded Jogress render-pipeline trace, pass 2.
--
-- Pass 1 proved the director's wait(310) ticks at ~2 vsyncs/tick, so the
-- op7 aux-effect spawn landed exactly at the old 420-frame cap.  This pass
-- extends the window to cover the whole terminating stream, dumps the
-- spawned effect child's program bytes in-emulator (never pause: build 314
-- stops servicing the RPC tick loop while paused), and samples the child's
-- lifecycle fields as it animates.

local mem = PCSX.getMemPtr()

local function u8(a)
  return mem[bit.band(a, 0x1fffff)]
end

local function u16(a)
  return u8(a) + u8(a + 1) * 256
end

local function u32(a)
  return u16(a) + u16(a + 2) * 65536
end

local function hex(v)
  return string.format("%08x", bit.band(v or 0, 0xffffffff))
end

local function valid(p)
  return p >= 0x80000000 and p < 0x80200000
end

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate8"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))

DNA_P2_FRAME = 0
DNA_P2_DONE = false
DNA_P2_TRACE = {}
DNA_P2_SEEN = {}
DNA_P2_BPS = {}
DNA_P2_CHILD = 0
DNA_P2_MGR = 0

local MAX_EVENTS = 384
local MAX_FRAMES = 900

local function emit(line)
  if #DNA_P2_TRACE < MAX_EVENTS then
    DNA_P2_TRACE[#DNA_P2_TRACE + 1] = line
  end
end

local function regs()
  return PCSX.getRegisters().GPR.n
end

local function add(addr, name, callback)
  DNA_P2_BPS[#DNA_P2_BPS + 1] = PCSX.addBreakpoint(addr, "Exec", 4, name, function()
    pcall(callback)
    return false
  end)
end

local function once(key, line)
  if not DNA_P2_SEEN[key] then
    DNA_P2_SEEN[key] = true
    emit(line)
  end
end

local function dumpwords(name, base, words)
  for i = 0, words - 1, 4 do
    local a = base + i * 4
    emit(string.format("%s+%02x: %s %s %s %s", name, i * 4,
      hex(u32(a)), hex(u32(a + 4)), hex(u32(a + 8)), hex(u32(a + 12))))
  end
end

DNA_P2_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_P2_DONE then return end
  DNA_P2_FRAME = DNA_P2_FRAME + 1

  if DNA_P2_FRAME == 1 then
    add(0x8008bc80, "op3_spawn", function()
      local r = regs()
      local p = r.a0
      emit(string.format("f=%d op3 a0=%s a1=%s cursor=%s", DNA_P2_FRAME,
        hex(p), hex(r.a1), valid(p) and hex(u32(p + 0x80)) or "invalid"))
    end)

    add(0x80089be4, "effect_create", function()
      local r = regs()
      emit(string.format("f=%d effect_create type=%s pos=%s a2=%s a3=%s ra=%s",
        DNA_P2_FRAME, hex(r.a0), hex(r.a1), hex(r.a2), hex(r.a3), hex(r.ra)))
    end)

    add(0x80089a24, "effect_manager", function()
      local r = regs()
      local p = r.a0
      if valid(p) and DNA_P2_MGR == 0 then
        DNA_P2_MGR = p
        emit(string.format("f=%d effect_manager first obj=%s", DNA_P2_FRAME, hex(p)))
        dumpwords("mgr", p, 32)
      end
    end)

    add(0x8008966c, "effect_child_create", function()
      local r = regs()
      local key = string.format("child-create:%08x:%08x",
        bit.band(r.a0, 0xffffffff), bit.band(r.a1, 0xffffffff))
      once(key, string.format("f=%d effect_child_create a0=%s a1=%s a2=%s a3=%s ra=%s",
        DNA_P2_FRAME, hex(r.a0), hex(r.a1), hex(r.a2), hex(r.a3), hex(r.ra)))
    end)

    add(0x800893dc, "effect_child", function()
      local r = regs()
      local p = r.a0
      if not valid(p) then return end
      if DNA_P2_CHILD == 0 then
        DNA_P2_CHILD = p
        emit(string.format("f=%d effect_child first obj=%s", DNA_P2_FRAME, hex(p)))
        dumpwords("child", p, 36)
        local prog = u32(p + 0x50)
        if valid(prog) then
          dumpwords("prog", prog, 48)
        end
      end
    end)

    add(0x8008921c, "sprite_draw", function()
      local r = regs()
      local p = r.a0
      local key = string.format("sprite:%d:%08x", math.floor(DNA_P2_FRAME / 20),
        bit.band(p, 0xffffffff))
      once(key, string.format("f=%d sprite_draw obj=%s a1=%s a2=%s a3=%s ra=%s",
        DNA_P2_FRAME, hex(p), hex(r.a1), hex(r.a2), hex(r.a3), hex(r.ra)))
    end)
  end

  if DNA_P2_FRAME % 30 == 0 then
    local director = 0x800c106c
    emit(string.format("f=%d dir state=%s cursor=%s", DNA_P2_FRAME,
      hex(u32(director + 0x0c)), hex(u32(director + 0x80))))
    if DNA_P2_CHILD ~= 0 then
      local p = DNA_P2_CHILD
      emit(string.format(
        "f=%d childsample obj=%s state=%s prog=%s arch=%s elapsed=%d mask=%s stride=%s dur=%d x=%d y=%d z=%d",
        DNA_P2_FRAME, hex(p), hex(u32(p + 0x0c)), hex(u32(p + 0x50)),
        hex(u32(p + 0x68)), u32(p + 0x6c), hex(u32(p + 0x70)), hex(u32(p + 0x74)),
        u32(p + 0x78), u16(p + 0x58), u16(p + 0x5a), u16(p + 0x5c)))
    end
  end

  if DNA_P2_FRAME >= MAX_FRAMES or #DNA_P2_TRACE >= MAX_EVENTS then
    DNA_P2_DONE = true
    print(string.format("DNA_P2_DONE frames=%d events=%d", DNA_P2_FRAME, #DNA_P2_TRACE))
  end
end)

PCSX.resumeEmulator()
print("DNA_P2_ARMED")
