/** A quest's prop: a sprite the quest pins on the map (web/quests.ts -> web/quest-props.ts). */
export interface QuestProp {
  clip?: string | undefined;
  key: string;
  /** where the sprite sorts: with people (default), behind every person, or drawn over them */
  layer?: "entity" | "behind" | "front" | undefined;
  /** set by normalize() as "prop:" + key; absent on the rows quests.ts hands in */
  name?: string;
  /** the sprite sheet pack id the prop is drawn from */
  sheet: string;
  solid?: boolean;
  x: number;
  y: number;
}

/** A prop after web/quest-props.ts normalize(): the effect name is always there. */
export interface QuestPropRow extends QuestProp {
  name: string;
}

/** The solid foot box of one prop (web/quest-props.ts propFootBox). */
export interface QuestPropBox {
  x: number;
  y: number;
  halfW: number;
  depth: number;
}
