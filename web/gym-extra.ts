
import type { InventoryRow } from "./game/types.js";
interface GymExtraHall {
  map: string;
  npc_id: string;
  trainer?: string;
  greeting?: string[];
}
// Extra training halls (idea I6): our own greeters in towns that have no disc gym.
// Data: data/authored/web/assets/data/gym_extra.json (installed as assets/data/gym_extra.json).
// A hall opens the ordinary gym screen (web/gym.js) with the game own rank menu cut down to
// the hall theme. The file holds drill ids only; rows, gains and TP costs come from progression.json at run time.
// Rank gate = the ID cards, as the disc greeters (gym_ranks.json): Platinum > Silver+Gold > Silver > none.
export function gymExtraHallAt(data: { halls?: GymExtraHall[] } | null | undefined, mapId: string, npcId: string): GymExtraHall | null {
  return data?.halls?.find((h) => h.map === mapId && h.npc_id === npcId) ?? null;
}

export function gymExtraTier(inventory: InventoryRow[], cards: { platinum: number; silver: number; gold: number; }) {
  const has = (id: number) => !!inventory?.some((s) => s.id === id && s.qty > 0);
  if (has(cards.platinum)) return "platinum";
  if (has(cards.silver) && has(cards.gold)) return "gold";
  if (has(cards.silver)) return "silver";
  return "none";
}

// Returns { tier, group, drills }: group = 0-based rank_menus index (the group argument of gym.open),
// drills = the compact drill ids kept from that menu.
export function gymExtraPlan(data: { cards: { platinum: number; silver: number; gold: number; }; }, hall, inventory: InventoryRow[]) {
  const tier = gymExtraTier(inventory, data.cards);
  const t = hall.tiers[tier];
  return { tier, group: t.group, drills: t.drills };
}
