
/** One of the four evolutions the form page offers: the species, its two branch ids, its techs, its level and earned exp. */
export interface BattleFormOptionSeed {
  species?: number;
  left?: number[];
  right?: number[];
  techs?: number[];
  level?: number;
  dvexp?: number;
}

/** Where the form page opens: the acting slot, the three species' forms, the four options, and the equipment. */
export interface BattleFormSeed {
  activeIndex?: number;
  slotIndex?: number;
  currentSpecies?: number;
  liveSpecies?: number;
  reservedForm?: number;
  rosterSlots?: number[];
  options?: BattleFormOptionSeed[];
  equipped?: number[];
  panelBlock?: number[];
  preselected?: number;
}
