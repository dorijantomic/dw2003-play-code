-- Bounded caller trace for the four decoded fight camera-manager methods.
-- Identifies the exact path that replaces clip 12's last explicit transform.

local mem = PCSX.getMemPtr()
local function u8(a) return mem[bit.band(a, 0x1fffff)] end
local function u32(a) return u8(a) + u8(a+1)*256 + u8(a+2)*65536 + u8(a+3)*16777216 end

local state = "C:/Users/dorij/AppData/Roaming/pcsx-redux/SLES03936.sstate8"
PCSX.loadSaveState(Support.File.zReader(Support.File.open(state)))
DNA_CC_FRAME, DNA_CC_TRACE, DNA_CC_DONE, DNA_CC_BPS = 0, {}, false, {}

local function arm(addr, name)
  DNA_CC_BPS[#DNA_CC_BPS + 1] = PCSX.addBreakpoint(addr, "Exec", 4, name, function()
    pcall(function()
      local r = PCSX.getRegisters().GPR.n
      DNA_CC_TRACE[#DNA_CC_TRACE + 1] = string.format(
        "f=%d fn=%s ra=%08x a0=%08x a1=%08x a2=%08x a3=%08x",
        DNA_CC_FRAME, name, bit.band(r.ra,0xffffffff), bit.band(r.a0,0xffffffff),
        bit.band(r.a1,0xffffffff), bit.band(r.a2,0xffffffff), bit.band(r.a3,0xffffffff))
    end)
    return false
  end)
end

DNA_CC_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  if DNA_CC_DONE then return end
  DNA_CC_FRAME = DNA_CC_FRAME + 1
  if DNA_CC_FRAME == 1 then
    arm(0x80092244, "cam_immediate")
    arm(0x800922b4, "cam_tween")
    arm(0x800923b4, "cam_preset")
    arm(0x8009257c, "cam_reset")
  end
  if DNA_CC_FRAME >= 520 then
    DNA_CC_DONE = true
    print("DNA_CC_TRACE_DONE lines=" .. #DNA_CC_TRACE)
  end
end)

PCSX.resumeEmulator()
print("DNA_CC_TRACE_ARMED")
