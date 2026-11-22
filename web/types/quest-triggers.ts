// What web/quest-triggers.ts needs from the host it runs in.
import type { QuestSnapshot } from "./quest-shelf.js";

/** One of the host's switches, as a value or a getter (read() calls it when it is a function). */
export type QuestTriggerSwitch = boolean | (() => boolean);

/**
 * The host context installTriggers() runs against (web/quests.ts passes the quest layer in):
 * whether the layer is on, a quest's status, whether the game is idle, and how to play a scene, save and warn.
 */
export interface QuestTriggerContext {
  /** start a scene; null when the game is busy or an actor is missing (the trigger stays armed) */
  playScene?: (scene: unknown[] | undefined) => unknown;
  save?: () => void;
  /** the quest layer's state store, read again after a scene ran */
  state?: QuestSnapshot | (() => QuestSnapshot);
  /** a quest's status as the quest layer reports it ("available", "active", "ready", "done") */
  statusOf?: (id: string) => string | null;
  warn?: (msg: string) => void;
  battle?: QuestTriggerSwitch;
  dialogBusy?: QuestTriggerSwitch;
  enabled?: QuestTriggerSwitch;
  idle?: QuestTriggerSwitch;
}

/** What a trigger needs of a quest before it may fire: the quest and the status it must be in. */
export interface QuestTriggerWhen {
  quest?: string;
  status?: string;
}

/** One authored trigger of quests.json: a map, a walk-in rectangle (x, y, w, h) or an arrival (`on: "enter"`), and the scene it plays. */
export interface QuestTriggerRow {
  id: string;
  map: string;
  on?: string;
  once?: boolean;
  rect?: number[];
  scene?: unknown[];
  when?: QuestTriggerWhen;
}
