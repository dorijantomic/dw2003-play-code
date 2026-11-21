// Types only: the shapes web/chat-queue.ts takes and hands back. Nothing here is emitted
// (node's strip mode erases it), so this file must never hold runtime code.

/** What the queue needs from the room: the gap it leaves between lines, the clock, and the send. */
export interface ChatQueueOptions {
  gap?: number;
  now?: () => number;
  send?: (text: string, meta?: unknown) => boolean | void;
}

/** Where one waiting line is in its life; `false` means the send refused it and nothing waits. */
export type ChatPushResult = "sent" | "queued" | false;
