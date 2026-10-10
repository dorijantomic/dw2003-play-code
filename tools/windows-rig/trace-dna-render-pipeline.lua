-- Bounded Jogress render-pipeline trace.
--
-- Loads GUI savestate 8 and records only calls and fixed fields reachable from
-- the already-identified clip-12 director/effect/render functions.  The hard
-- event and frame caps keep this safe to run on the Windows rig.

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

DNA_PIPE_FRAME = 0
DNA_PIPE_DONE = false
DNA_PIPE_TRACE = {}
DNA_PIPE_SEEN = {}
DNA_PIPE_BPS = {}

local MAX_EVENTS = 384
local MAX_FRAMES = 420

local function emit(line)
  if #DNA_PIPE_TRACE < MAX_EVENTS then
    DNA_PIPE_TRACE[#DNA_PIPE_TRACE + 1] = line
  end
end

local function regs()
  return PCSX.getRegisters().GPR.n
end

local function add(addr, name, callback)
  DNA_PIPE_BPS[#DNA_PIPE_BPS + 1] = PCSX.addBreakpoint(addr, "Exec", 4, name, function()
    pcall(callback)
    return false
  end)
end

local function once(key, line)
  if not DNA_PIPE_SEEN[key] then
    DNA_PIPE_SEEN[key] = true
    emit(line)
  end
end

DNA_PIPE_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_PIPE_DONE then return end
  DNA_PIPE_FRAME = DNA_PIPE_FRAME + 1

  if DNA_PIPE_FRAME == 1 then
    add(0x8008c590, "director_init", function()
      local r = regs()
      emit(string.format("f=%d director_init a0=%s a1=%s a2=%s a3=%s ra=%s",
        DNA_PIPE_FRAME, hex(r.a0), hex(r.a1), hex(r.a2), hex(r.a3), hex(r.ra)))
    end)

    add(0x8008bc80, "op3_spawn", function()
      local r = regs()
      local p = r.a0
      emit(string.format("f=%d op3 a0=%s a1=%s cursor=%s bytes=%02x,%02x,%02x,%02x,%02x,%02x",
        DNA_PIPE_FRAME, hex(p), hex(r.a1), valid(p) and hex(u32(p + 0x80)) or "invalid",
        valid(p) and u8(p + 0x8c) or 0, valid(p) and u8(p + 0x8d) or 0,
        valid(p) and u8(p + 0x8e) or 0, valid(p) and u8(p + 0x8f) or 0,
        valid(p) and u8(p + 0x90) or 0, valid(p) and u8(p + 0x91) or 0))
    end)

    add(0x80089be4, "effect_create", function()
      local r = regs()
      emit(string.format("f=%d effect_create type=%s pos=%s a2=%s a3=%s ra=%s",
        DNA_PIPE_FRAME, hex(r.a0), hex(r.a1), hex(r.a2), hex(r.a3), hex(r.ra)))
    end)

    add(0x80089a24, "effect_manager", function()
      local r = regs()
      local p = r.a0
      if valid(p) then
        local key = string.format("manager:%08x:%d", bit.band(p, 0xffffffff), math.floor(DNA_PIPE_FRAME / 15))
        once(key, string.format("f=%d effect_manager obj=%s state=%s type=%s resource=%s count=%s",
          DNA_PIPE_FRAME, hex(p), hex(u32(p + 0x0c)), hex(u32(p + 0x50)),
          hex(u32(p + 0x58)), hex(u32(p + 0x64))))
      end
    end)

    add(0x8008966c, "effect_child_create", function()
      local r = regs()
      local key = string.format("child-create:%d:%08x:%08x", DNA_PIPE_FRAME,
        bit.band(r.a0, 0xffffffff), bit.band(r.a1, 0xffffffff))
      once(key, string.format("f=%d effect_child_create a0=%s a1=%s a2=%s a3=%s ra=%s",
        DNA_PIPE_FRAME, hex(r.a0), hex(r.a1), hex(r.a2), hex(r.a3), hex(r.ra)))
    end)

    add(0x800893dc, "effect_child", function()
      local r = regs()
      local p = r.a0
      if valid(p) then
        local elapsed = u32(p + 0x6c)
        local key = string.format("child:%08x:%d", bit.band(p, 0xffffffff), math.floor(elapsed / 8))
        once(key, string.format("f=%d effect_child obj=%s program=%s archive=%s elapsed=%s mask=%s stride=%s duration=%s",
          DNA_PIPE_FRAME, hex(p), hex(u32(p + 0x50)), hex(u32(p + 0x68)), hex(elapsed),
          hex(u32(p + 0x70)), hex(u32(p + 0x74)), hex(u32(p + 0x78))))
      end
    end)

    add(0x8008921c, "sprite_draw", function()
      local r = regs()
      local p = r.a0
      local key = string.format("sprite:%d:%08x", math.floor(DNA_PIPE_FRAME / 15), bit.band(p, 0xffffffff))
      once(key, string.format("f=%d sprite_draw obj=%s a1=%s a2=%s a3=%s ra=%s",
        DNA_PIPE_FRAME, hex(p), hex(r.a1), hex(r.a2), hex(r.a3), hex(r.ra)))
    end)

    add(0x80083e0c, "actor_draw", function()
      local r = regs()
      local p = r.a0
      local key = string.format("actor:%d:%08x", math.floor(DNA_PIPE_FRAME / 15), bit.band(p, 0xffffffff))
      if valid(p) then
        once(key, string.format("f=%d actor_draw obj=%s f50=%s f54=%s f58=%s f5c=%s f60=%s f64=%s ra=%s",
          DNA_PIPE_FRAME, hex(p), hex(u32(p + 0x50)), hex(u32(p + 0x54)),
          hex(u32(p + 0x58)), hex(u32(p + 0x5c)), hex(u32(p + 0x60)),
          hex(u32(p + 0x64)), hex(r.ra)))
      end
    end)
  end

  if DNA_PIPE_FRAME % 15 == 0 then
    local director = 0x800c106c
    local actor = u32(director + 0x88)
    emit(string.format("f=%d sample director_state=%s cursor=%s actor=%s resource=%s",
      DNA_PIPE_FRAME, hex(u32(director + 0x0c)), hex(u32(director + 0x80)),
      hex(actor), hex(u32(director + 0x78))))
  end

  if DNA_PIPE_FRAME >= MAX_FRAMES or #DNA_PIPE_TRACE >= MAX_EVENTS then
    DNA_PIPE_DONE = true
    print(string.format("DNA_PIPE_TRACE_DONE frames=%d events=%d", DNA_PIPE_FRAME, #DNA_PIPE_TRACE))
  end
end)

PCSX.resumeEmulator()
print("DNA_PIPE_TRACE_ARMED")
