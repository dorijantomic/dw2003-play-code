-- Collect, split by attribution, and disarm a trace armed by
-- trace-stage-entries.lua.
--
-- Unregistration happens here, in its own RPC call: BizHawk registers execution
-- callbacks as PROHIBITED_MID_FRAME, and removing one while the core is inside a
-- callback is the use-after-free class of failure. Removal is by stored GUID, so
-- a stale run cannot tear down another run's hook.
--
-- Only the "after" counts are attributable to this stage. Before the target
-- overlay became resident the same addresses held the previous stage's code, so
-- a "before" hit says that *some* stage ran that address, never which one. The
-- two are kept side by side in the artifact rather than merged or dropped.
--
-- Taint means the scene moved after the run reached the target stage -- a battle
-- or a scripted transition taking it out mid-trace. The scene at residency is
-- not a good baseline: on a fast load the target's own code appears in RAM in the
-- same frame the scene word still shows the previous stage, which is the warp
-- working, not a taint. The sweep passes the scene it landed in as DW3_SCENE;
-- callers that do not get the old residency-scene comparison.

if type(DW3T) ~= "table" then
  print("NO_SESSION")
  return
end

local scene_now = getSceneID()
local frames = emu.framecount() - DW3T.armed_at
local res = DW3T.resident_at
local after, before, total = 0, 0, 0
local lines = {}
local seen = {}
for addr in pairs(DW3T.after) do seen[addr] = true end
for addr in pairs(DW3T.before) do seen[addr] = true end
for addr in pairs(seen) do
  local a = DW3T.after[addr] or 0
  local b = DW3T.before[addr] or 0
  total = total + a + b
  if a > 0 then after = after + 1 end
  if a == 0 and b > 0 then before = before + 1 end
  lines[#lines + 1] = string.format("%08x after=%d before=%d %s", addr, a, b,
    a > 0 and "attributable" or "previous-stage-only")
end
table.sort(lines)

local removed = 0
for i = 1, #DW3T.guids do
  if event.unregisterbyid(DW3T.guids[i]) then removed = removed + 1 end
end
event.unregisterbyname("dw3t_frame")

local expect_scene = DW3_SCENE or DW3T.scene_at_residency
local tainted = res == nil or scene_now ~= expect_scene
local out = string.format("C:/bizhawk-rig/dumps/stage%s_entries.txt", tostring(DW3T.stage))
local f = io.open(out, "w")
f:write(string.format("# stage=%s armed_scene=0x%x resident_at=%s resident_scene=0x%x scene_now=0x%x frames=%d armed=%d attributable=%d previous_stage_only=%d total=%d tainted=%s\n",
  tostring(DW3T.stage), DW3T.scene_at_arm, tostring(res), DW3T.scene_at_residency or 0,
  scene_now, frames, #DW3T.guids, after, before, total, tostring(tainted)))
for i = 1, #lines do f:write(lines[i] .. "\n") end
f:write(string.format("# seal stage=%s complete\n", tostring(DW3T.stage)))
f:close()

DW3T = nil
print(string.format("COLLECTED attributable=%d previous_stage_only=%d total_hits=%d resident_at=%s unregistered=%d frames=%d tainted=%s out=%s",
  after, before, total, tostring(res), removed, frames, tostring(tainted), out))
