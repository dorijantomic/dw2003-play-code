// Types only: the shapes web/damage-lab.ts builds for the damage walk. Nothing here is emitted
// (node's strip mode erases it), so this file must never hold runtime code.

/** A fighter as the damage walk reads it: the five stats, the family and the defence side. */
export interface DamageLabFighter {
  str?: number;
  def?: number;
  spt?: number;
  wis?: number;
  spd?: number;
  family?: number;
  resistances?: Record<string, number>;
  armor?: number;
}

/** The attacker adds the charged affinity, the worn weapon's families and the Multi Crest gate. */
export interface DamageLabAttacker extends DamageLabFighter {
  affinity?: number;
  multiAttack?: boolean;
  weaponFamilies?: number[];
}

/** One technique row of the lab's table, as the walker hands it to the engine. */
export interface DamageLabSkill {
  id?: number;
  name?: string;
  power?: number;
  element?: string;
  category?: number;
  magical?: boolean;
  effect_id?: number;
  effect_power?: number;
  target_family?: number;
  damage_scalar?: number;
  clip?: number;
  hits?: number;
  basic_attack?: boolean;
}

/** What the lab hands the walk for one hit: the two forms, the technique, the field, and the two flags. */
export interface DamageLabStages {
  atk?: DamageLabAttacker;
  def?: DamageLabFighter;
  skill?: DamageLabSkill;
  field?: { element?: string; power?: number } | null;
  rng?: () => number;
  multiCrest?: boolean;
}
