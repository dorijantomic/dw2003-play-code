// EXPERIMENT (F2 -> Extras -> "Chat: keep every line I type"): spaces what one player types so the room
// hears every line. The relay drops a chat line that arrives under CHAT_GAP (600 ms) after the previous one
// from the same player (server/room-core.mjs, `#chat`); this queue waits a little longer (650 ms) so a line
// typed in a hurry arrives instead of vanishing. The relay is not touched and the wire message is unchanged:
// the only thing this file decides is WHEN `send(text)` is called, never what is said.
//
//   const q = createChatQueue({ send: (text) => sendRaw({ t: "chat", text }) });
//   q.push("hi")        // "sent" | "queued" | false (send refused: nothing was sent and nothing waits)
//   q.flush()           // called from the game's per-frame tick: sends one line per gap that has come due
//   q.pending()         // how many lines are still waiting
//   q.reset()           // a closed connection: drops the queue; returns the dropped items' meta, if any
//
// `push(text, meta)` passes `meta` through to `send(text, meta)`, so the caller can clear the "..." it put
// on that line's local echo once the line really leaves.
export function createChatQueue({ gap = 650, now = () => performance.now(), send } = {}) {
    if (typeof send !== "function") throw new TypeError("createChatQueue needs a send(text) function");
    let nextAt = -Infinity;             // when the next line may leave; the first one never waits
    const waiting = [];                 // { text, meta }, oldest first

    const push = (text, meta) => {
        const t = now();
        if (t >= nextAt) {
            if (send(text, meta) === false) return false;    // refused: not sent, not queued, not counted
            nextAt = t + gap;
            return "sent";
        }
        waiting.push({ text, meta });
        return "queued";
    };

    // One line per due gap. A tick that arrives late still sends only one line, so two lines can never
    // leave closer together than `gap` even if the game was paused between frames.
    const flush = () => {
        const t = now();
        while (waiting.length && t >= nextAt) {
            const item = waiting[0];
            if (send(item.text, item.meta) === false) return;   // still refused: keep it for the next tick
            waiting.shift();
            nextAt = Math.max(t, nextAt) + gap;
        }
    };

    const pending = () => waiting.length;

    const reset = () => {
        const dropped = waiting.map((w) => w.meta).filter((m) => m != null);
        waiting.length = 0;
        nextAt = -Infinity;
        return dropped;
    };

    return { push, flush, pending, reset };
}
