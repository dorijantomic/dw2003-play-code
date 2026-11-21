// How web/quest-endings.ts writes a quest's endings out.

/** endingsBlock()'s options: a markdown table instead of plain lines, and whether to list the problems. */
export interface QuestEndingsOpts {
  markdown?: boolean;
  problems?: boolean;
}
