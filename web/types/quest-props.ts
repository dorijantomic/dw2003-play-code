/** A quest's prop: a sprite the quest pins on the map (web/quests.ts -> web/quest-props.ts). */
export interface QuestProp {
  clip?: string;
  key: string;
  /** where the sprite sorts: with people (default), behind every person, or drawn over them */
  layer?: "entity" | "behind" | "front";
  name: string;
  /** the sprite sheet pack id the prop is drawn from */
  sheet: string;
  solid?: boolean;
  x: number;
  y: number;
}
