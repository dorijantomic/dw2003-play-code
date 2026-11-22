/** One digimon.json profile as the blast ladder reads it: its id, name, starter flag and its five forms. */
export interface BlastProfile {
  id: number;
  name: string;
  is_starter?: boolean;
  blasts?: number[];
  tech_signature?: number;
}

/** One skill record of digimon.json (the form's signature technique lives here). */
export interface BlastSkill {
  id: number;
  name?: string;
}

/** digimon.json as the ladder reads it: the profile rows and the optional skill table. */
export interface BlastTable {
  digimon?: BlastProfile[];
  skills?: BlastSkill[];
}

/** What a fetch hands back: the parsed table itself, or a response whose json() gives it. */
export interface BlastFetched extends BlastTable {
  json?: () => Promise<BlastTable>;
}

/** The page's fetch: the real `fetch`, or a test's stand-in. */
export type BlastFetch = (url: string) => BlastFetched | Promise<BlastFetched>;

/** One rung of a card: a Blast form, the level bracket that reaches it and its signature technique ("" when unknown). */
export interface BlastForm {
  id: number;
  name: string;
  tier: number;
  min: number;
  max: number;
  technique: string;
}

/** One starter card: the starter and its five forms. */
export interface BlastCard {
  starter: string;
  id: number;
  forms: BlastForm[];
}

/** The page's own state. */
export interface BlastState {
  open: boolean;
  wasOn: boolean;
  index: number;
  cards: BlastCard[];
  loading: Promise<boolean> | null;
  error: string | null;
}
