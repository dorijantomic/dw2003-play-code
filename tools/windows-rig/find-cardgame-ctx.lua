-- Locate the live CardBattleContext by its sprite-pool signature.
--
-- docs/research/card/cardduel-animation-decoded-2026-08-05.md: the pool is 40
-- sprites of 0x4C bytes at ctx+0x108, and each sprite stores its own slot index
-- at +0x24. Four ascending indices in a row is a far stronger signature than the
-- class word, and it validates itself.

local mem = PCSX.getMemPtr()
local SPRITE_BASE, SPRITE_SIZE = 0x108, 0x4c
local out = {}

for off = 0x00080000, 0x001f0000 - 4, 4 do
  if mem[off + SPRITE_SIZE + 0x24] == 1
      and mem[off + 0x24] == 0
      and mem[off + SPRITE_SIZE * 2 + 0x24] == 2
      and mem[off + SPRITE_SIZE * 3 + 0x24] == 3
      and mem[off + SPRITE_SIZE * 4 + 0x24] == 4 then
    local pool = 0x80000000 + off
    local ctx = pool - SPRITE_BASE
    out[#out + 1] = string.format(
      "pool=%08x ctx=%08x class=%08x link50=%08x",
      pool, ctx, rd32(ctx), rd32(ctx + 0x50))
  end
end

print("pool_hits=" .. #out)
for i = 1, math.min(#out, 12) do print(out[i]) end

-- also report where the class word lives, for cross-checking the base offset
local hits = {}
for off = 0x00080000, 0x001f0000 - 4, 4 do
  if mem[off] == 0xa8 and mem[off + 1] == 0xbb
      and mem[off + 2] == 0x09 and mem[off + 3] == 0x80 then
    hits[#hits + 1] = 0x80000000 + off
  end
end
print("class_word_hits=" .. #hits)
for i = 1, math.min(#hits, 12) do print(string.format("class_at=%08x", hits[i])) end
