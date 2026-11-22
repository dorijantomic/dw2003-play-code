// How web/quest-endings.ts writes a quest's endings out.

/** endingsBlock()'s options: a markdown table instead of plain lines, and whether to list the problems. */
export interface QuestEndingsOpts {
  markdown?: boolean;
  problems?: boolean;
}

/** One step of a quest scene as web/quests.json writes it; only the keys this reader looks at. */
export interface QuestEndingStep {
  ask?: string | undefined;
  battle?: unknown;
  chase?: unknown;
  options?: string[] | undefined;
  say?: unknown;
  text?: string | undefined;
}

/** A step that is an ask with at least one option (isAskStep()). */
export interface QuestEndingAskStep extends QuestEndingStep {
  options: string[];
}

/** One item of a reward or a verdict pay. */
export interface QuestEndingItem {
  count?: number | undefined;
  name?: string | undefined;
}

/** A reward or a verdict option's pay, as the data writes it. */
export interface QuestEndingReward {
  bits?: number | undefined;
  items?: QuestEndingItem[] | undefined;
}

/** payOf()'s result: bits and items, always there. */
export interface QuestEndingPay {
  bits: number;
  items: QuestEndingItem[];
}

/** The hand-in questions of a quest: the options, the pay and the words after each. */
export interface QuestEndingVerdict {
  after?: string[][] | undefined;
  options?: string[] | undefined;
  pay?: (QuestEndingReward | null | undefined)[] | undefined;
}

/** A character a quest names (its offer or hand-in): what the endings reader looks at. */
export interface QuestEndingGiver {
  ask?: string | undefined;
  doneLines?: string[] | undefined;
  scene?: QuestEndingStep[] | undefined;
}

/** One quest definition of web/quests.json, the keys the endings reader looks at. */
export interface QuestEndingDef {
  acceptAt?: string[] | undefined;
  acceptScene?: QuestEndingStep[] | undefined;
  doneScene?: QuestEndingStep[] | undefined;
  id?: string | undefined;
  objectives?: ({ scene?: QuestEndingStep[] | undefined })[] | undefined;
  offer?: QuestEndingGiver | null | undefined;
  reward?: QuestEndingReward | null | undefined;
  title?: string | undefined;
  turnIn?: QuestEndingGiver | null | undefined;
  verdict?: QuestEndingVerdict | null | undefined;
}

/** A scene of a quest and the slot name it plays under (offer, accept, done, turnin, objective-<n>). */
export interface QuestEndingSlot {
  slot: string;
  steps: QuestEndingStep[];
}

/** One way a quest can go (endingsOf()). */
export interface QuestEndingRow {
  choice: string | null;
  kind: string;
  lines: string[];
  note: string;
  pay: QuestEndingPay | null;
  slot: string;
}

/** The ask step of the offer scene that offerRows() already turned into the two offer rows. */
export interface QuestEndingSkipAsk {
  index: number;
  slot: string;
}

/** endingsTable()'s totals. */
export interface QuestEndingsTotals {
  askRows: number;
  askSteps: number;
  battles: number;
  chases: number;
  choicePoints: number;
  closingless: number;
  offers: number;
  optionRows: number;
  quests: number;
  verdictRows: number;
  verdicts: number;
}
