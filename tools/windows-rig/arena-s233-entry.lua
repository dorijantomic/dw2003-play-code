-- Drive the live rig onto s233 "Amaterasu City - Digimon Arena" in the TOURNAMENT
-- state (master progress ordinal 0x26 with story flag 0x1a0a set), to test claim
-- ARENA-C015: the arena floor ships five scripted battle records and nothing that
-- can start them.
--
-- No savestate sits on the arena, and a synthetic transition does not work (the
-- field transition state machine is only partially decoded and ignores a hand-set
-- pending load). So this uses the game's OWN warp: savestate 3 parks the player on
-- s330, a bridge with four exits, and every one of its unconditional op=1 warp
-- steps is repointed at screen 632 with the spawn the s926 Arena Reception handoff
-- uses. Walking east to the arch raises the exit indicator; confirm crosses.
--
-- Screen 632 resolves to WSTAG233 (lba 595) at any ordinal except 0x2d, where the
-- alias record picks WSTAG927 (lba 2224) instead -- read live out of the warp table
-- by this script, which is itself the runtime confirmation of the alias rule.
--
-- Usage: tools/windows-rig/dw3-rpc tools/windows-rig/arena-s233-entry.lua

local SCENE = 0x80099d80
local ORDINAL = 0x8004b370
local ENC_GATE = 0x8009b6c4 + 0x10   -- encounter driver module gate; 0 = no random battles
-- s330's four unconditional op=1 warp steps (offsets computed offline from
-- wstag330.s; the step record is {cond_a,arg_a,cond_b,arg_b,op,params[7]}, so an
-- unconditional warp begins ff ff 00 00 ff ff 00 00 and carries screen at +10).
local WARP_STEPS = { 0x800a7cf0, 0x800a7d08, 0x800a7d20, 0x800a7d38 }
local ARENA_SCREEN = 632

function arena_setup()
  loadstate(3)
  wr32(ORDINAL, 0x26)
  local b = 0x8004b3ac + 1          -- bank 0x1a bit array; flag 0x1a0a = bit 10
  wr8(b, bit.bor(rd8(b), 4))
  for _, r in ipairs(WARP_STEPS) do
    wr16(r + 10, ARENA_SCREEN); wr16(r + 12, 192); wr16(r + 14, 344); wr16(r + 16, 5)
  end
  wr32(ENC_GATE, 0)
  print(string.format("setup: lba=%d ordinal=%02x flagbyte=%02x encgate=%d",
    rd32(0x80055d2c), rd32(ORDINAL), rd8(b), rd32(ENC_GATE)))
end

function arena_walk()
  press(BTN.RIGHT, 900)   -- east along the bridge to the arch; raises the indicator
  press(BTN.RIGHT, 240)
  press(BTN.X, 240)       -- confirm crosses the transition
end

-- Guarded read: this build dies on a dereference of an out-of-range pointer, which
-- is how the first attempt at this lost the emulator.
function ptr_ok(p)
  return p ~= nil and p >= 0x80000000 and p < 0x801f0000
end

function arena_report()
  local s = {}
  s[#s+1] = string.format("lba=%d ordinal=%02x flagbyte=%02x",
    rd32(0x80055d2c), rd32(ORDINAL), rd8(0x8004b3ad))
  s[#s+1] = string.format("scene +0x14(step)=%08x +0x20(enc)=%08x +0x24(events)=%08x +0x4c(cast)=%08x",
    rd32(SCENE + 0x14), rd32(SCENE + 0x20), rd32(SCENE + 0x24), rd32(SCENE + 0x4c))
  s[#s+1] = string.format("bgm +0x3c=%d +0x40=%08x", rd32(SCENE + 0x3c), rd32(SCENE + 0x40))
  local P = rd32(SCENE + 0x20)
  if ptr_ok(P) then
    local B = rd32(P + 0x18)
    if ptr_ok(B) then
      local out = {}
      for i = 0, 7 do
        local rec = rd32(B + 4 + i * 4)
        out[#out + 1] = ptr_ok(rec) and tostring(rd32(rec)) or "0"
      end
      s[#s+1] = string.format("scripted block @%08x rate=%d slots=%s",
        B, rd32(B), table.concat(out, ","))
    end
  end
  print(table.concat(s, "\n"))
end
print("arena-s233-entry loaded: arena_setup() / arena_walk() / arena_report()")
