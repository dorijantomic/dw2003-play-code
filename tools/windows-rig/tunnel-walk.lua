-- Walk the live rig from savestate 10 (operator parked it in front of the Protocol
-- Ruins tunnel) STRAIGHT FORWARD into the tunnel, capturing frames, to settle what
-- the original draws when the character goes under the stonework.
--
-- Usage: tools/windows-rig/bizhawk-rpc tools/windows-rig/tunnel-walk.lua
-- Needs rig_control('agent') set first.

local OUT = (DW3_RIG_ROOT or "C:/bizhawk-rig") .. "/shots/"
local ENC_GATE   = 0x8009b6d4   -- encounter driver module gate; 0 = no random battles
local ENC_SWITCH = 0x80042b1c   -- battle launch switch; 0 = launcher never fires

TUN_N, TUN_DONE = 0, false

local function log(s) print("TUN " .. s) end

local function png(name)
  if savestatePNG then savestatePNG(name); return name end
  if shot then shot(name); return name end
  return "NO-PNG-HELPER"
end

local function loadslot(n)
  if loadstate then loadstate(n); return "loadstate" end
  if savestate and savestate.loadslot then savestate.loadslot(n); return "savestate.loadslot" end
  return "NO-LOAD-HELPER"
end

local function finish(msg)
  TUN_DONE = true
  log("FINISH " .. tostring(msg))
  local f = io.open((DW3_RIG_ROOT or "C:/bizhawk-rig") .. "/rpc/tunnel.done", "w")
  if f then f:write("1"); f:close() end
end

local ARM = PCSX.Events.createEventListener("GPU::Vsync", function()
  if TUN_DONE then return end
  TUN_N = TUN_N + 1
  local ok, err = pcall(function()
    if TUN_N == 1 then
      log("helpers press=" .. tostring(press) .. " joypad=" .. tostring(joypad)
          .. " loadstate=" .. tostring(loadstate) .. " savestatePNG=" .. tostring(savestatePNG))
      log("loading slot 10 via " .. loadslot(10))
      wr32(ENC_GATE, 0)
      wr32(ENC_SWITCH, 0)
    end
    if TUN_N == 4 then
      log("enc gate=" .. string.format("%d", rd32(ENC_GATE))
          .. " switch=" .. string.format("%d", rd32(ENC_SWITCH))
          .. " png=" .. png("tun_00_before"))
    end
    -- hold Up (north) every frame from frame 20 to frame 320
    if TUN_N >= 20 and TUN_N <= 320 then
      joypad.set({ [BTN.UP] = true }, 1)
    elseif TUN_N == 321 then
      joypad.set({}, 1)
      log("released pad")
    end
    -- capture every 20 frames through the walk, so the transition is visible
    if TUN_N >= 20 and TUN_N <= 340 and (TUN_N % 20 == 0) then
      png(string.format("tun_%03d", TUN_N))
    end
    if TUN_N >= 340 and TUN_N <= 400 and (TUN_N % 5 == 0) then
      png(string.format("tun_%03d", TUN_N))
    end
    if TUN_N > 410 then finish("frames done") end
  end)
  if not ok then finish("ERR " .. tostring(err)) end
end)

log("tunnel walk armed (slot 10, hold Up 20-320, captures every 20)")
