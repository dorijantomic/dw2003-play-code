/** One part picker under a row: the wrapping div and what it currently resolves to. */
export interface FusionPartPicker {
  el: HTMLDivElement;
  /** the chosen part spec, or null when nothing is chosen yet */
  value: () => string | null;
  /** the model has no part of this kind */
  missing: boolean;
  /** more than one candidate, so a chain still has to be picked */
  needs?: boolean;
}

/** What /api/candidates hands back for one kind: the parts of the donor or base model. */
export interface FusionCandidate {
  spec: string;
  [extra: string]: unknown;
}

/** One part row: "take part `part` from `donor`". */
export interface FusionLabSelection {
  /** the part-chain pick, when the part kind had several candidates */
  base_chain?: string;
  donor: number;
  donor_chain?: string;
  /** the picked part kind (the row's dropdown: "head", "arm", ...) */
  part: string;
}

/** What the lab builds: the base model plus one donor per part row. */
export interface FusionLabRecipe {
  base: number | null;
  ops: FusionLabSelection[];
}

/** A row's DOM and its last resolved selection (web/fusion-lab.ts). */
export interface FusionLabRow {
  /** the candidate list /api/candidates returned for the base model */
  baseCands: any;
  basePick?: FusionPartPicker | null;
  cands?: HTMLDivElement;
  donor: HTMLInputElement;
  /** the candidate list /api/candidates returned for the donor model */
  donorCands: any;
  donorPick?: FusionPartPicker | null;
  el?: HTMLDivElement;
  part: HTMLSelectElement;
  /** the favourite this row was restored from, until its pickers have been filled */
  pre?: FusionLabSelection | null;
  refresh?: () => Promise<void>;
  /** bumped per refresh; a late response checks it before painting */
  token?: number;
  warn?: HTMLDivElement;
}

/** A POST body to the lab's server (web/fusion-lab.ts). */
export interface FusionLabBody {
  base?: number | null;
  ops?: FusionLabSelection[];
  /** a model path the server should reuse instead of rebuilding */
  out?: any;
  name?: string;       // a saved favourite's name
  recipe?: FusionLabRecipe;  // a saved favourite's recipe (base, ops)
  model?: string;      // the model id a favourite or boss is built from
}
