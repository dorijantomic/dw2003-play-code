-- Runtime probe for UI-Q003: audio-bank phase timeline and packed-sound cues.
--
-- Hooks three resident entries and append-logs frame-stamped lines:
--   F0x8002044c  bank request (a0 = channel, a1 = archive)
--   F0x800205f0  phase dispatch (phase halfword D0x80055c40; values 1/2/3 run,
--                0 = ready, per UI-AUDIO-BANK-LOAD-PHASE-001)
--   F0x8002006c  packed-sound play entry (a0 = id, ra = caller)
--
-- Arm:   tools/windows-rig/bizhawk-rpc tools/windows-rig/capture-ui-q003.lua
-- Read:  tools/windows-rig/bizhawk-rpc "UI_Q003.dump()"
-- Mark:  tools/windows-rig/bizhawk-rpc "UI_Q003.mark(\"buy-plate\")"
-- Stop:  tools/windows-rig/bizhawk-rpc "UI_Q003.stop()"
--
-- Writes an append-only line log to C:/bizhawk-rig/dumps/ui-q003-timing.log so a
-- crash mid-run still leaves the entries captured so far.

UI_Q003 = UI_Q003 or {}
UI_Q003.log = UI_Q003.log or {}
UI_Q003.path = UI_Q003.path or "C:/bizhawk-rig/dumps/ui-q003-timing.log"
UI_Q003.phase_addr = 0x80055c40

local function hex(v)
  return string.format("0x%08x", bit.band(v or 0, 0xffffffff))
end

local function append(line)
  local f = io.open(UI_Q003.path, "a")
  if f then
    f:write(line .. "\n")
    f:close()
  end
end

local function emit(line)
  UI_Q003.log[#UI_Q003.log + 1] = line
  append(line)
end

local function phase()
  local ok, v = pcall(rd16, UI_Q003.phase_addr)
  if not ok or type(v) ~= "number" then return nil end
  if v > 0x7fff then v = v - 0x10000 end
  return v
end

local function regs()
  local ok, r = pcall(emu.getregisters)
  if not ok or type(r) ~= "table" then return nil end
  return r
end

if UI_Q003.armed then
  for _, n in ipairs({"uiq3_play", "uiq3_bankreq", "uiq3_dispatch"}) do
    pcall(function() event.unregisterbyname(n) end)
  end
  UI_Q003.armed = nil
end

local function install(name, addr, fn)
  pcall(function() event.unregisterbyname(name) end)
  event.onmemoryexecute(fn, addr, name)
end

install("uiq3_play", 0x8002006c, function()
  local r = regs()
  if not r then return end
  emit(string.format("f=%d cue a0=%s ra=%s phase=%s",
    emu.framecount(), hex(r.a0), hex(r.ra), tostring(phase())))
end)

install("uiq3_bankreq", 0x8002044c, function()
  local r = regs()
  if not r then return end
  emit(string.format("f=%d bankreq a0=%s a1=%s phase=%s",
    emu.framecount(), hex(r.a0), hex(r.a1), tostring(phase())))
end)

local last_phase = nil

install("uiq3_dispatch", 0x800205f0, function()
  local p = phase()
  if p == nil then return end
  if p == last_phase then return end
  last_phase = p
  emit(string.format("f=%d phase=%s", emu.framecount(), tostring(p)))
end)

UI_Q003.armed = true
UI_Q003.start_frame = emu.framecount()

function UI_Q003.mark(label)
  emit(string.format("f=%d mark=%s scene=%s", emu.framecount(), tostring(label),
    tostring(getSceneID and getSceneID() or "?")))
end

function UI_Q003.dump()
  print("ui-q003 entries=" .. #UI_Q003.log)
  for i = 1, #UI_Q003.log do print(UI_Q003.log[i]) end
end

function UI_Q003.stop()
  for _, n in ipairs({"uiq3_play", "uiq3_bankreq", "uiq3_dispatch"}) do
    pcall(function() event.unregisterbyname(n) end)
  end
  UI_Q003.armed = nil
  print("ui-q003 stopped entries=" .. #UI_Q003.log)
end

emit(string.format("# armed frame=%d scene=%s", UI_Q003.start_frame,
  tostring(getSceneID and getSceneID() or "?")))
print("ui-q003 probe armed at F0x8002044c/F0x800205f0/F0x8002006c frame=" ..
  tostring(UI_Q003.start_frame))
