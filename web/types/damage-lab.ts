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
  field?: { element?: string | undefined; power?: number | undefined } | null | undefined;
  rng?: () => number;
  multiCrest?: boolean;
}

/** One stage of the walk: the running damage after it, and what it did. */
export interface DamageLabStage {
  name: string;
  value: number;
  note: string;
}

/** What damageStages returns: every stage, and what lands. */
export interface DamageLabResult {
  stages: DamageLabStage[];
  total: number;
}

/** One form (digimon.json) or one enemy (enemies.json) as the pickers list it. */
export interface DamageLabFighterRow {
  id: number | string;
  name: string;
  family: number;
  str: number;
  def: number;
  spt: number;
  wis: number;
  spd: number;
  resistances: Record<string, number>;
}

/** One technique record of the picker (fight_tech_table.json with the skill bank's name). */
export interface DamageLabTechRow {
  id: number;
  name: string;
  named: boolean;
  mp: number;
  power: number;
  category: number;
  element: string;
  target_family: number;
  damage_scalar: number;
  effect_id: number;
  effect_power: number;
  clip: number;
  hits: number;
  basic_attack: boolean;
}

/** A row of any of the three pickers. */
export type DamageLabRow = DamageLabFighterRow | DamageLabTechRow;

/** Which value each picker is on. */
export interface DamageLabPick {
  form: number;
  enemy: number;
  technique: number;
  field: number;
  crit: number;
  armour: number;
  multi: number;
}

/** The one state object of the page. */
export interface DamageLabState {
  open: boolean;
  wasOn: boolean;
  loading: Promise<boolean> | null;
  error: string | null;
  sel: number;
  forms: DamageLabFighterRow[];
  enemies: DamageLabFighterRow[];
  techniques: DamageLabTechRow[];
  pick: DamageLabPick;
  result: DamageLabResult | null;
  notDamage: string | null;
  rng: () => number;
}

/** A row of digimon.json as formRows reads it. */
export interface DamageLabDigimonRow {
  id: number | string;
  name: string;
  family?: number;
  str?: number;
  def?: number;
  spt?: number;
  wis?: number;
  spd?: number;
  resistances?: Record<string, number>;
}

/** digimon.json: the rows, or a file holding them with the skill bank. */
export interface DamageLabDigimonFile {
  digimon?: DamageLabDigimonRow[];
  skills?: DamageLabSkillBankRow[];
}

/** A row of the skill bank (digimon.json skills). */
export interface DamageLabSkillBankRow {
  id: number;
  name?: string;
  element?: string;
}

/** A row of enemies.json as enemyRows reads it. */
export interface DamageLabEnemyRow {
  enemy_id: string;
  digimon_type?: number;
  str?: number;
  def?: number;
  spt?: number;
  wis?: number;
  spd?: number;
  resistances?: Record<string, number>;
}

/** enemies.json: the rows, or a file holding them. */
export interface DamageLabEnemyFile {
  enemies?: DamageLabEnemyRow[];
}
