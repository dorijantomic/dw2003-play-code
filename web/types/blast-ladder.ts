
/** One digimon.json profile as the blast ladder reads it: its id, name, starter flag and its five forms. */
export interface BlastProfile {
  id?: number;
  name?: string;
  is_starter?: boolean;
  blasts?: number[];
  tech_signature?: number;
}

/** One skill record of digimon.json (the form's signature technique lives here). */
export interface BlastSkill {
  id?: number;
  name?: string;
}
