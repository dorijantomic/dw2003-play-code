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
