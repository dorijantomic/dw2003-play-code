-- Arm for a stage that is about to become resident, and stamp the frame it does.
--
-- The stage overlays all load at the same RAM range, so hits recorded while the
-- previous stage is still in memory belong to that stage. Arming early is still
-- worth doing -- a stage's constructors and spawners run while its overlay loads,
-- before any host-side poll could notice -- so each hit carries the frame it
-- first appeared on, and the frame-end listener watches for the moment the target
-- overlay's own instruction words appear in RAM. Hits at or after that frame are
-- attributable to this stage; hits before it are reported separately, never
-- merged in.
--
-- Callbacks only count. They never read RAM and never return a value: in BizHawk
-- a numeric return from a memory callback replaces the value of that access, so
-- returning one here would rewrite the executed instruction. Removal happens in
-- collect-stage-entries.lua, from a later call, because these callbacks are
-- registered PROHIBITED_MID_FRAME.

local ROOT = "C:/bizhawk-rig/"
-- DW3_STAGE names the list to arm. A number means the stage overlay wstagNNN;
-- any other value ("fieldstg", "cardgame", "ststatus") is a resident or screen
-- overlay the generator was asked to emit by name, which is how the gated
-- content -- NPC spawns, dialogue, the auto-event dispatcher -- gets traced,
-- since none of that lives in the stage overlay.
local stage = DW3_STAGE
assert(stage, "set DW3_STAGE to a stage number or an overlay name")

dofile(ROOT .. "fnlist.lua")
local list = DW3FN and DW3FN[tostring(stage)]
assert(list, "no entry list for stage " .. stage)

-- How much of this stage is already resident. Used only to report: a stage armed
-- after its own warp lands verifies almost entirely, an armed-before-warp pass
-- verifies nothing until the load happens.
--
-- Identity is every instruction word carried for an entry, not just the first:
-- `addiu sp,sp,-N` prologues repeat across overlays, and a one-word check let
-- arming accept the previous stage's code by coincidence.
local function matches(i)
  local e = list[i]
  for j = 2, #e do
    if rd32(e[1] + (j - 2) * 4) ~= e[j] then return false end
  end
  return true
end

local need = math.floor(#list / 2) + 1
local now = 0
for i = 1, #list do
  if matches(i) then now = now + 1 end
end

_G.DW3T = { before = {}, after = {}, guids = {}, stage = stage, frame = 0,
            resident_at = nil, expect = list[1][2], expect_addr = list[1][1],
            scene_at_arm = getSceneID(), armed_at = emu.framecount() }
-- Re-arming on the stage that is already loaded (a retry, or a walk-only pass)
-- means residency began with this run, not at frame 1: otherwise every hit on
-- frame 0 falls into the pre-residency bucket and the run reports nothing.
if now >= need then
  DW3T.resident_at = 0
  DW3T.scene_at_residency = DW3T.scene_at_arm
end

-- Checked once per frame: the target overlay is resident when a majority of its
-- entries match on all their instruction words. The scene is captured at that
-- same instant, because arming happens while the previous stage is still on
-- screen -- a scene change after this point, not before it, is the run going
-- wrong.
local function resident()
  local got = 0
  for i = 1, #list do
    if matches(i) then
      got = got + 1
      if got >= need then return true end
    end
    if (#list - i) + got < need then return false end
  end
  return false
end

event.onframeend(function()
  local t = DW3T
  if t then
    t.frame = t.frame + 1
    if not t.resident_at and resident() then
      t.resident_at = t.frame
      t.scene_at_residency = getSceneID()
    end
  end
end, "dw3t_frame")

local armed = 0
for i = 1, #list do
  local a = list[i][1]
  local g = event.on_bus_exec(function(addr)
    -- Count the two phases separately. A single first-hit stamp would file every
    -- address that the outgoing stage also happens to use under "before", even
    -- when this stage runs it again afterwards, which silently discards the
    -- load-time constructors that arming early exists to catch.
    local t = DW3T
    local side = t.resident_at and t.after or t.before
    side[addr] = (side[addr] or 0) + 1
  end, a, "dw3e_" .. i, "System Bus")
  if g and g ~= "00000000-0000-0000-0000-000000000000" then
    DW3T.guids[#DW3T.guids + 1] = g
    armed = armed + 1
  end
end
print(string.format("ARMED stage=%s pre_resident=%d/%d armed=%d scene=0x%x frame=%d",
  tostring(stage), now, #list, armed, DW3T.scene_at_arm, DW3T.armed_at))
