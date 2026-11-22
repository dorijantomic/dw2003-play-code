/** One bracket match of the league (wire row: [a, b, w, ...rest]). */
export interface MpLeagueState {
  /** tamer id of the first side, null when the round is not played yet */
  a: number | null;
  /** tamer id of the second side, null when the first side has a bye */
  b: number | null;
  bye?: boolean;
  dead?: boolean;
  /** tie-break counts the row carries after the winner (the games of the match) */
  g: number[];
  /** tamer id of the winner once played, null while the match is open */
  w: number | null;
  wo?: boolean;
}


/** A night as it travels in one relay message (packLeague / unpackLeague). */
export interface MpLeagueWire {
  b?: number;
  i: number[];
  d?: number[];
  r?: number;
  f?: string;
  k?: number;
  c?: number | null;
  /** each match as [a, b, winner, ...gameWinners] (a null b is a bye or an empty slot) */
  R?: (number | null)[][][];
}

/** The whole night: the bracket and who stands where in it (newLeague, unpackLeague). */
export interface MpNight {
  bestOf: number;
  ids: number[];
  size: number;
  byes: number;
  roundsPlanned: number;
  matches: number;
  /** who left the night, in order */
  dropped: number[];
  /** the round being played */
  r: number;
  /** "play" | "break" (between rounds) | "done" */
  phase: string;
  /** the round is over and nextPairing has said so once */
  asked: boolean;
  champ: number | null;
  rounds: MpLeagueState[][];
}
