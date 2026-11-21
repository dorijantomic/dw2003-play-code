// The tri-state flag store's inputs (web/flag-store.ts reads them through Partial<StoryExplorerOpts>):
// every callback answers one run-time condition the disc's get_flag table asks about.

/** What the extractor decoded out of one roster predicate record (tools/extract_roster_predicate_table.py):
 *  `kind` picks the family, the other fields are that family's operands (value, slot, slots,
 *  collection_indices, flag_ids, test, n, min_level, effect...). */
export interface RosterSemantics {
  kind: string;
  [field: string]: any;
}

/** One row of the roster predicate table, keyed by the flag id it answers; the extractor's
 *  columns (op, op_lo, param2, ordinal_lo/hi, semantics) are read straight off the record. */
export interface RosterRecord {
  /** the record's opcode byte (op & 0xf0 picks the family) */
  op: number;
  [column: string]: any;
}

export interface StoryExplorerOpts {
  /** the story beat the walker stands on (the ordinal the range tests compare) */
  getOrdinal?: () => number;
  hasCard?: (cardId: number) => boolean;
  /** one bag entry by its 9-bit index */
  hasItem?: (bit: number) => boolean;
  /** the obtained-partner bitmask (bit n = roster slot n obtained) */
  ownedSlots?: () => number;
  /** the starter-pack selector: 0..2 once chosen, -1 or null before that */
  packIndex?: () => number | null;
  /** per-slot levels: a Map, or a slot-indexed object, whichever the caller keeps */
  partnerLevels?: (() => any) | null;
  /** the active party's charisma total */
  partyCharisma?: () => number;
  /** the roster predicate table, keyed by flag id */
  rosterTable?: Record<string, RosterRecord>;
  /** [route key, companion] for the route gates */
  routePair?: () => [number, number];
}
