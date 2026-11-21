// What the fold helpers of web/ui-kit.ts are told.

/** createFoldChain()'s options: the fold length, and what to do when a fold starts opening or closing. */
export interface FoldChainOptions {
  /** frames a fold takes to open or shut */
  steps?: number;
  /** called with the name of the fold that started and whether it is opening (the open / close sound) */
  onStart?: (name: string, opening: boolean) => void;
}
