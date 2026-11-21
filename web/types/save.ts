/** The 0x44 per-slot record web/save.ts buildRecord() builds — the fields the card screen draws. */
export interface SaveRecord {
  /** the tamer's registered name */
  name: string;
  /** index into the esstarea city bank */
  areaIndex: number;
  /** index into the esshpnam save-point bank */
  placeIndex: number;
  /** the walker's own map name, kept for the CITY row when the bank has no match */
  areaText: string;
  /** the BIT (`0x20`) */
  bits: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** one digimon.json type id per party starter, -1 when unknown */
  partyTypes: number[];
  /** one level per party starter */
  partyLevels: number[];
}

export interface SaveEntry {
  /** the localStorage snapshot the slot restores on load */
  data: Record<string, string>;
  /** the screen's 0x26C4 save image, one entry per pixel value */
  image?: number[];
  residentImageVersion?: number;
  record: SaveRecord | null;
  savedAt: number;
}

/** What a caller hands writeSlot() for one slot (web/save.ts). */
export interface SaveSlotWrite {
  /** the 0x44 summary fields from buildRecord(); left any because save-translated hands over its own untyped slot table */
  record?: any;
  /** the screen's own 0x26C4 save image, when it produced one */
  image?: ArrayLike<number> | null;
  /** the localStorage snapshot the slot restores on load */
  data?: Record<string, string> | null;
  playSeconds?: number | null;
  residentImageVersion?: number;
  /** the live game state, read by localStorage key name */
  state?: Record<string, unknown> | null;
}

/** What buildRecord() is told about where the save was made (web/save.ts resolves the rest from the game's own banks). */
export interface SaveRecordOpts {
  areaIndex?: number;
  /** the walker's map name, matched against the city bank */
  areaName?: string;
  placeIndex?: number;
  /** the walker's map name, matched against the save-point bank */
  placeName?: string;
  playSeconds?: number | null;
}
