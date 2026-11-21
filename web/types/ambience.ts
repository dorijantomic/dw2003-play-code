// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

/** The Effects settings: the player's own values, plus one on/off switch per effect in FX_GROUPS. */
export interface AmbienceSettings {
  // the values the OPTIONS screen and the panel sliders own (not switches)
  battleSpeed?: number;
  encounterDialMode?: string;
  hd2dStrength?: number;
  lightGain?: number;
  mapScreen?: string;
  musicVolume?: number;
  quality: string;
  soundVolume?: number;
  spriteFilter: string;
  /** one of TODMODES' keys ("auto", "day", "golden", "dusk", "night") */
  todMode: string;
  /** "auto", "clear", "storm" or "always" */
  weatherMode: string;
  // the switches (web/ambience.ts FX_GROUPS): off unless switched on
  aishift?: boolean;
  ambience?: boolean;
  anglermap?: boolean;
  arrivallab?: boolean;
  battleatmos?: boolean;
  battlepano?: boolean;
  battlespeed?: boolean;
  battlewide?: boolean;
  birds?: boolean;
  bitledger?: boolean;
  blastladder?: boolean;
  bossgrows?: boolean;
  bossmusic?: boolean;
  bossphases?: boolean;
  breath?: boolean;
  butterflies?: boolean;
  chatqueue?: boolean;
  cinema?: boolean;
  clouds?: boolean;
  critters?: boolean;
  cursorbook?: boolean;
  cutcontent?: boolean;
  damagelab?: boolean;
  devils?: boolean;
  dragonflies?: boolean;
  dw2motion?: boolean;
  encounterdial?: boolean;
  enemytells?: boolean;
  fireflies?: boolean;
  fish?: boolean;
  fog?: boolean;
  footsteps?: boolean;
  frost?: boolean;
  fusionbosses?: boolean;
  giantmode?: boolean;
  glossary?: boolean;
  grass?: boolean;
  grasspush?: boolean;
  gusts?: boolean;
  gymmap?: boolean;
  hd2d?: boolean;
  heat?: boolean;
  indoor?: boolean;
  itemsource?: boolean;
  itemrulebook?: boolean;
  lamps?: boolean;
  langdesk?: boolean;
  leaves?: boolean;
  lightpool?: boolean;
  lightreveal?: boolean;
  lightning?: boolean;
  mirror?: boolean;
  mount?: boolean;
  mountseat?: boolean;
  movetheatre?: boolean;
  mpbubbles?: boolean;
  mpcredit?: boolean;
  musicfx?: boolean;
  nightlight?: boolean;
  omen?: boolean;
  options?: boolean;
  ownclips?: boolean;
  planner?: boolean;
  pollen?: boolean;
  practice2v2?: boolean;
  puddles?: boolean;
  questemotes?: boolean;
  questplacecard?: boolean;
  quests?: boolean;
  questsecondjob?: boolean;
  questtriggers?: boolean;
  rain?: boolean;
  rainwater?: boolean;
  redirectview?: boolean;
  reflect?: boolean;
  replay?: boolean;
  sand?: boolean;
  saveverify?: boolean;
  savexray?: boolean;
  screenfx?: boolean;
  seam?: boolean;
  serverchamp?: boolean;
  shafts?: boolean;
  showfps?: boolean;
  silence?: boolean;
  smartcam?: boolean;
  smoothanim?: boolean;
  snow?: boolean;
  softalpha?: boolean;
  sound?: boolean;
  soundtest?: boolean;
  soundtrack?: boolean;
  sparkle?: boolean;
  stageselect?: boolean;
  steps?: boolean;
  sway?: boolean;
  tod?: boolean;
  toonoutline?: boolean;
  toonshade?: boolean;
  uisharp?: boolean;
  villagers?: boolean;
  water?: boolean;
  weaponlab?: boolean;
  wetlook?: boolean;
  widefield?: boolean;
  wildlife?: boolean;
  windows?: boolean;
}

/** What the map being shown can carry, measured from the map itself (web/ambience.ts profileOf):
 *  the flags each effect is gated on, and the measurements the gates compare. */
export interface AmbienceConditions {
  open?: boolean;
  snowy?: boolean;
  sandy?: boolean;
  night?: boolean;
  rainy?: boolean;
  leaves?: boolean;
  fireflies?: boolean;
  tod?: boolean;
  fog?: boolean;
  /** how dark the fog is drawn */
  fogK?: number;
  shafts?: boolean;
  heat?: boolean;
  pollen?: boolean;
  butterflies?: boolean;
  birds?: boolean;
  breath?: boolean;
  sway?: boolean;
  villagers?: boolean;
  swamp?: boolean;
  coast?: boolean;
  bats?: boolean;
  clouds?: boolean;
  lamps?: boolean;
  devils?: boolean;
  /** share of the map's tiles that are grass */
  grassShare?: number;
  /** mean luminance of the map image, 0..255 */
  lum?: number;
  /** share of the map that is indoors */
  room?: number;
  /** the map image's size */
  w?: number;
  h?: number;
  /** the map's stable draw seed */
  seed?: number;
  /** the map id the profile was measured on (its class base) */
  cls?: string;
}

/** One saved F2 profile slot: every switch as it was, plus the three settings that are not switches. */
export interface AmbienceMode {
  quality?: string;
  todMode?: string;
  weatherMode?: string;
}
