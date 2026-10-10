-- Log EVERY cardgame-overlay function entry during the card-duel UI phase.
--
-- Method: one Exec breakpoint per function entry address (247 of them, from
-- docs/generated/function-extents.json for ~/ddw3/asm/dw2003/pro/cardgame.s),
-- capture-only (the callback returns NOTHING and never pauses), armed only
-- while two sentinel words positively identify the resident cardgame overlay:
-- 0x8009bac8 must read 0x27bdffd8 and 0x800a1b48 must read 0x27bdffe0
-- (static pins from cardgame.s, UNCONFIRMED LIVE until the first probe).
-- cardgame and fieldstg share load base 0x80082cb0, so breakpoints armed
-- before the load -- or left armed after the unload -- would record fieldstg
-- code at those addresses and the whole trace would be a lie. Identity is
-- therefore re-checked every frame; a mismatch disarms at once and ends the
-- run as overlay_changed. Do NOT add `return false`: measured on build 314,
-- 2026-08-24, a callback returning `false` fires exactly ONCE and then goes
-- silent forever.
--
-- Never call bp:remove() inside a callback (use-after-free, kills build 314).
-- Breakpoint objects live in one global list, removed from a later RPC call.
--
-- Output: two files. The data artifact holds every observed line, the
-- function summary, and a last-line seal proving the writer reached the end:
--   fn      <idx> <addr> <size> <static_callers> <hits> <first_frame> <first_ra>
--   frames  <first_frame> x<repeat> : <idx>,<idx>,...   (per-frame entry order,
--           run-length collapsed -- identical consecutive frames emit once)
--   mode    <frame> <mode_key>                          (duel mode machine)
--   input   <frame> <action>
--   # seal run=<id> complete
-- The completion artifact (<output>.done) holds exactly one terminal record:
--   # terminal run=<id> status=<ok|failed> reason=<why> ... captured=<n> ...
-- published only after the sealed data artifact is written and closed. A
-- host watchdog may trust ONLY a .done terminal whose run id matches with
-- status=ok AND whose data file carries the matching seal -- never a bare
-- CG_DONE print, which the file bridge does not capture after arming.
--
-- Run contract (see tools/windows-rig/rig-watchdog.sh): the host starts every
-- probe with CG_RUN set to a unique id, which appears in the file header, the
-- CG_ARMED acknowledgement and the terminal record. A capture file without
-- this run's terminal line is not this run's completion, however it ends.
assert(type(PCSX) == "table", "This card-duel recorder requires PCSX-Redux, not BizHawk; it is not a shop recorder.")
local OUT   = CG_OUT   or "C:/dw3-rig/dumps/cardgame_callgraph.txt"
local FNLIST= CG_FNLIST or "C:/dw3-rig/cardgame-fnlist.lua"
local MAXF  = CG_MAX   or 5400        -- ~90 s of duel
local PULSE = CG_PULSE or 70
local WIDTH = 4
local PRESS, RELEASE = 10, 14
local DRIVE = CG_DRIVE
if DRIVE == nil then DRIVE = false end -- the user controls the game by default
local PERFRAME_CAP = 3000             -- events kept per frame
local EXPECT_ANIM  = CG_EXPECT_ANIM  or 0x27bdffd8
local EXPECT_ROUND = CG_EXPECT_ROUND or 0x27bdffe0
-- Pinned cardgame-resident identity for the two sentinel words, always
-- required, never change-detection: cardgame.s L25485 @0x8009bac8
-- (.word 0x27bdffd8, `addiu $sp,-0x28`) and L31661 @0x800a1b48
-- (.word 0x27bdffe0, `addiu $sp,-0x20`), both function-entry stack
-- prologues. STATIC-DERIVED, UNCONFIRMED LIVE: the first bounded probe must
-- confirm these against RAM. Any mismatch refuses to arm and logs the actual
-- words, so a wrong pin fails loudly instead of misattributing. Overrides
-- for that probe or a rebuilt disc: CG_EXPECT_ANIM / CG_EXPECT_ROUND.
-- Uniqueness caveat: two `addiu $sp` prologue words are a common shape, so
-- the PAIR is only a heuristic screen, not a proof no other code shares it.
-- What makes a match evidence of THIS overlay loading is the observed
-- transition (baseline words -> pins on entry, pins -> other words on exit),
-- recorded below; a run whose pins already matched at start says so.
local IDENTIFY_BUDGET = CG_IDENTIFY_BUDGET or 1800  -- ~30 s to reach the duel
local RUN = CG_RUN or "no-run-id"  -- host watchdog sets a unique id per probe

local FN_ANIM_DRIVER  = 0x8009bac8
local FN_ROUND_DRIVER = 0x800a1b48
local STAGE           = 0x80055d2c

dofile(FNLIST)

if CG_LISTENER then CG_LISTENER:remove(); CG_LISTENER = nil end
if CG_BPS then for i = 1, #CG_BPS do pcall(function() CG_BPS[i]:remove() end) end end
CG_BPS = {}
CG_BPS_FAILED = {}

local function u32(v) v = v % 4294967296; if v < 0 then v = v + 4294967296 end; return v end
local function hex(v) return string.format("%08x", u32(v)) end

local N       = {}   -- idx -> hits committed only after identity check
local FIRSTF  = {}   -- idx -> first validated frame seen
local FIRSTRA = {}   -- idx -> caller ra at first validated hit
local BUF     = {}   -- this frame's unvalidated entry indices
local BUFRA   = {}   -- idx -> stashed caller ra, captured once per index
local RA_SEEN = {}   -- idx -> true once ra stashed
local BUFN    = 0
local DROPPED = 0    -- entries discarded by the per-frame cap (never silent)
local QUARANTINED = 0 -- buffered hits discarded with a failed-identity frame
local BP_FAILED = 0   -- breakpoints that failed removal (handles retained)
local IDENTITY_BROKEN = false -- a per-hit check saw foreign code mid-frame
local CAPTURED = 0    -- frames committed after passing identity (post-arm)
local finished = false -- freeze flag: set once, checked by every callback

for i = 1, #CG_FNS do N[i] = 0 end

local BASE_ANIM, BASE_ROUND = rd32(FN_ANIM_DRIVER), rd32(FN_ROUND_DRIVER)
local lines = {
  "# cardgame-overlay function-entry trace, card duel UI phase",
  string.format("# run %s", RUN),
  string.format("# %d exec breakpoints, one per function entry", #CG_FNS),
  string.format("# extent %08x..%08x  fnlist=%s", CG_FN_LO, CG_FN_HI, FNLIST),
  string.format("# pins anim=%s round=%s", hex(EXPECT_ANIM), hex(EXPECT_ROUND)),
  string.format("# baseline anim=%s round=%s", hex(BASE_ANIM), hex(BASE_ROUND)),
}
if BASE_ANIM == EXPECT_ANIM and BASE_ROUND == EXPECT_ROUND then
  lines[#lines + 1] = "# note pins already matched at start; load transition not observed"
end

local frame = 0
local armed = false
local loaded = false
local pad = PCSX.SIO0.slots[1].pads[1]
local lastSig, lastSigFrame, lastSigRun = nil, 0, 0
local lastMode = ""
local duelPtr = 0

local function summary()
  local out, called = {}, 0
  for i = 1, #CG_FNS do
    local f = CG_FNS[i]
    if N[i] > 0 then called = called + 1 end
    out[#out + 1] = string.format("fn %03d %08x %5d %3d %7d %04d %s",
      i, f[1], f[2], f[3], N[i], FIRSTF[i] or -1, hex(FIRSTRA[i] or 0))
  end
  out[#out + 1] = string.format("# called=%d never_called=%d total=%d",
    called, #CG_FNS - called, #CG_FNS)
  out[#out + 1] = string.format("# dropped_by_perframe_cap=%d (cap=%d/frame)",
    DROPPED, PERFRAME_CAP)
  out[#out + 1] = string.format("# quarantined_by_identity_failure=%d", QUARANTINED)
  out[#out + 1] = string.format("# bp_remove_failed=%d", BP_FAILED)
  return out, called
end

local function flush()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  local s = summary()
  f:write(table.concat(s, "\n") .. "\n")
  f:close()
end

local function armAll()
  for i = 1, #CG_FNS do
    local addr = CG_FNS[i][1]
    local idx = i
    CG_BPS[i] = PCSX.addBreakpoint(addr, "Exec", 4, "cg" .. idx, function()
      -- Frozen callbacks must not mutate anything: after disarm/finish the
      -- breakpoints may still be installed (removal failed or is pending),
      -- and any hit from another overlay's code at these addresses is not
      -- this run's data.
      if finished or not armed then return end
      -- Per-hit identity: the frame-end check cannot see a swap that comes
      -- and goes between two frames, but any hit landing inside such a
      -- window executes THIS callback, so validating here observes exactly
      -- the boundary that matters. A foreign hit is quarantined and flags
      -- the run; all state transitions stay in the frame-end handler.
      if rd32(FN_ANIM_DRIVER) ~= EXPECT_ANIM or rd32(FN_ROUND_DRIVER) ~= EXPECT_ROUND then
        QUARANTINED = QUARANTINED + 1
        IDENTITY_BROKEN = true
        return
      end
      -- Buffer only. Totals are committed at frame end after the identity
      -- check passes, so a mid-frame overlay swap contaminates nothing.
      if BUFN < PERFRAME_CAP then
        BUFN = BUFN + 1; BUF[BUFN] = idx
        if not RA_SEEN[idx] then
          RA_SEEN[idx] = true
          local ok, r = pcall(PCSX.getRegisters)
          BUFRA[idx] = ok and r.GPR.n.ra or 0
        end
      else DROPPED = DROPPED + 1 end
      -- Return NOTHING. Measured on build 314, 2026-08-24: a callback that
      -- returns `false` fires exactly ONCE and the breakpoint then goes silent
      -- forever; the identical breakpoint whose callback returns nil fired
      -- 6,849,405 times in 60 frames and never paused the emulator. The
      -- `return false` advice in docs/research/infra/rig-reference.md silently
      -- turns every capture-only breakpoint into a one-shot.
    end)
  end
  armed = true
end

-- Commit this frame's buffered hits. Called only after the frame-end
-- identity check passes; unvalidated callbacks never touch totals.
local function fold()
  for k = 1, BUFN do
    local idx = BUF[k]
    N[idx] = N[idx] + 1
    if N[idx] == 1 then
      FIRSTF[idx] = frame
      FIRSTRA[idx] = BUFRA[idx] or 0
    end
  end
  BUFN = 0
  CAPTURED = CAPTURED + 1
end

-- Data artifact: every observed line plus the summary, sealed last. The
-- seal line proves the writer reached the end; a torn write cannot contain
-- it. No terminal record lives here by design (finding: a visible ok must
-- never predate a complete artifact).
local function write_data()
  local f = Support.File.open(OUT, "TRUNCATE")
  f:write(table.concat(lines, "\n") .. "\n")
  local s = summary()
  f:write(table.concat(s, "\n") .. "\n")
  f:write(string.format("# seal run=%s complete\n", RUN))
  f:close()
end

-- Completion artifact: the run-bound terminal record, published only after
-- the data artifact (seal included) is written and closed. The host accepts
-- a run only when this file carries its run id with status=ok AND the data
-- file carries the matching seal.
local function write_done(term)
  local f = Support.File.open(OUT .. ".done", "TRUNCATE")
  f:write(term .. "\n")
  f:close()
end

local function emitSig()
  if lastSig ~= nil then
    lines[#lines + 1] = string.format("frames %04d x%d : %s",
      lastSigFrame, lastSigRun, lastSig)
  end
end

-- Disarm first: no further breakpoint hits may be attributed once the overlay
-- identity is gone. Accumulates into BP_FAILED and retains failed handles in
-- CG_BPS_FAILED for controlled recovery instead of dropping them.
local function disarm()
  if CG_BPS then
    for i = 1, #CG_BPS do
      local ok = pcall(function() CG_BPS[i]:remove() end)
      if not ok then
        BP_FAILED = BP_FAILED + 1
        CG_BPS_FAILED[#CG_BPS_FAILED + 1] = CG_BPS[i]
      end
    end
    CG_BPS = {}
  end
  armed = false
end

-- Terminal cleanup: freeze inputs and capture first, persist the outcome,
-- report it. Every step is attempted even if an earlier one fails.
-- Publication is two-phase: the sealed data artifact first, the run-bound
-- completion artifact second. The final status is computed AFTER the data
-- write, so a failed write can never leave a visible (or printed) ok.
-- status=ok means ALL of: the full window ran (reason==max_frames), the
-- overlay was identified (loaded), at least one validated frame was
-- captured (CAPTURED>=1), no observation was lost (DROPPED==0), every hook
-- was removed (BP_FAILED==0), no cleanup step failed, and the sealed data
-- artifact was written and closed. Anything else is failed, with the reason
-- and counts preserved in the data file for inspection.
-- Re-entrant: safe to call from the error path after a partial run.
local function finish(reason)
  if finished then return end
  finished = true
  local errs = {}
  if DRIVE then
    local ok, e = pcall(function() pad.clearOverride(BTN.X) end)
    if not ok then errs[#errs + 1] = "pad:" .. tostring(e) end
  end
  disarm()
  local okl, e4 = pcall(function()
    if CG_LISTENER then CG_LISTENER:remove(); CG_LISTENER = nil end
  end)
  if not okl then errs[#errs + 1] = "listener:" .. tostring(e4) end
  local ok, e = pcall(emitSig)
  if not ok then errs[#errs + 1] = "emit:" .. tostring(e) end
  local called = -1
  local oks, e3 = pcall(function() local _, c = summary(); called = c end)
  if not oks then errs[#errs + 1] = "summary:" .. tostring(e3) end
  -- The VSync callback checks `finished` first, so no listener failure can
  -- keep driving inputs or flushing after this point whatever removal did.
  lines[#lines + 1] = string.format("# finish=%s frame=%d duel=%s", reason, frame, hex(duelPtr))
  local okd, edata = pcall(write_data)
  if not okd then errs[#errs + 1] = "data:" .. tostring(edata) end
  local status = (reason == "max_frames" and loaded and CAPTURED >= 1
      and DROPPED == 0 and BP_FAILED == 0 and #errs == 0 and okd)
    and "ok" or "failed"
  local term = string.format(
    "# terminal run=%s status=%s reason=%s frame=%d called=%d/%d captured=%d dropped=%d quarantined=%d bp_remove_failed=%d errors=%s",
    RUN, status, reason, frame, called, #CG_FNS, CAPTURED, DROPPED,
    QUARANTINED, BP_FAILED, (#errs == 0) and "none" or table.concat(errs, ","))
  local okw, e2 = pcall(write_done, term)
  if not okw then term = term .. " completion_unpublished=" .. tostring(e2) end
  print(term)
end

CG_LISTENER = PCSX.Events.createEventListener("GPU::Vsync", function()
  -- Frozen listener performs no work: whatever a failed removal left
  -- installed can neither drive inputs nor flush nor mutate counters.
  if finished then return end
  local ok, err = pcall(function()
    frame = frame + 1

    if DRIVE then
      if frame == PRESS then
        pad.setOverride(BTN.X)
        lines[#lines + 1] = string.format("input %04d X=1 accept", frame)
      elseif frame == RELEASE then
        pad.clearOverride(BTN.X)
        lines[#lines + 1] = string.format("input %04d X=0 accept", frame)
      elseif frame > RELEASE then
        local p = frame % PULSE
        if p == 0 then
          pad.setOverride(BTN.X)
        elseif p == WIDTH then
          pad.clearOverride(BTN.X)
        end
      end
    end

    -- Overlay identity is required continuously, not just at load: cardgame
    -- and fieldstg share load base 0x80082cb0, so leaving the duel swaps the
    -- code under these addresses. Every hit is validated in its callback
    -- against the same pins, so a swap that comes and goes between two
    -- frame-end checks still quarantines the foreign hit and flags the run;
    -- the frame-end check is the backstop for swaps with no hooked hit.
    -- Hits are buffered unvalidated and committed only here, after the check
    -- passes; a failed frame's buffer is counted as quarantined and never
    -- touches totals, signatures, or first-hit records. Terminal branches
    -- return at once so nothing below runs post-finish in the same frame.
    local anim, round = rd32(FN_ANIM_DRIVER), rd32(FN_ROUND_DRIVER)
    if not loaded then
      if anim == EXPECT_ANIM and round == EXPECT_ROUND then
        loaded = true
        lines[#lines + 1] = string.format("# overlay_loaded frame=%d anim=%s round=%s",
          frame, hex(anim), hex(round))
        armAll()
        lines[#lines + 1] = string.format("# armed frame=%d n=%d", frame, #CG_BPS)
      elseif frame >= IDENTIFY_BUDGET then
        lines[#lines + 1] = string.format(
          "# identify_failed frame=%d anim=%s round=%s expect_anim=%s expect_round=%s",
          frame, hex(anim), hex(round), hex(EXPECT_ANIM), hex(EXPECT_ROUND))
        finish("identify_failed")
        return
      end
    elseif anim ~= EXPECT_ANIM or round ~= EXPECT_ROUND then
      QUARANTINED = QUARANTINED + BUFN
      BUFN = 0
      lines[#lines + 1] = string.format("# overlay_changed frame=%d anim=%s round=%s",
        frame, hex(anim), hex(round))
      finish("overlay_changed")
      return
    elseif IDENTITY_BROKEN then
      -- A per-hit check already quarantined the foreign hit mid-frame. The
      -- rest of this buffer passed per-hit validation, so commit it for the
      -- record -- then fail the run anyway: stable residency broke.
      fold()
      lines[#lines + 1] = string.format("# identity_break_observed frame=%d quarantined=%d",
        frame, QUARANTINED)
      finish("identity_break_observed")
      return
    else
      -- Identity holds: commit the buffer, then the run-length signature.
      local sig
      if BUFN == 0 then sig = "" else sig = table.concat(BUF, ",", 1, BUFN) end
      fold()
      if sig == lastSig then
        lastSigRun = lastSigRun + 1
      else
        emitSig()
        lastSig, lastSigFrame, lastSigRun = sig, frame, 1
      end
    end

    if frame % 120 == 0 then flush() end
    if frame >= MAXF then finish("max_frames"); return end
  end)
  if not ok then
    lines[#lines + 1] = "# error=" .. tostring(err)
    finish("error")
  end
end)

flush()
print(string.format("CG_ARMED run=%s stage=%d fns=%d out=%s", RUN, rd32(STAGE), #CG_FNS, OUT))
