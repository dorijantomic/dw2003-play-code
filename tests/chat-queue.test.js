// tests/chat-queue.test.js — F2 -> Extras -> Chat: a happy typist's lines wait their turn instead of vanishing.
//
// The relay drops a chat line that arrives under CHAT_GAP (600 ms) after the previous one from the same
// player (server/room-core.mjs, `#chat`). The relay is NOT touched here: this test pins its drop, and pins
// that the new client-side queue (web/chat-queue.js) only changes WHEN a line leaves this game, never what
// it is. The queue waits a little longer (650 ms) than the relay so a line it would have dropped arrives
// instead. Everything on the wire is still `{t:"chat", text}`: no new message type.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createChatQueue } from "../web/chat-queue.js";
import { Hub } from "../server/room-core.mjs";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

/** A queue on a fake clock; `sent` records the text and the clock reading of every send that left. */
function fakeQueue({ gap = 650, online = true } = {}) {
    const clock = { t: 0 };
    const sent = [];
    const q = createChatQueue({
        gap,
        now: () => clock.t,
        send: (text) => {
            if (!online) return false;
            sent.push({ text, at: clock.t });
            return true;
        },
    });
    return { q, clock, sent, setOnline: (v) => { online = v; } };
}

test("a line inside the gap waits, and leaves exactly one gap after the line before it", () => {
    const { q, clock, sent } = fakeQueue();
    assert.equal(q.push("a"), "sent", "the first line goes at once");
    assert.deepEqual(sent.map((s) => s.text), ["a"]);
    clock.t = 100;
    assert.equal(q.push("b"), "queued", "100 ms later is inside the 650 ms gap");
    assert.equal(sent.length, 1, "the queued line has not left yet");
    assert.equal(q.pending(), 1);

    q.flush();                                   // t = 100: not due
    assert.equal(sent.length, 1);
    clock.t = 649;
    q.flush();                                   // one millisecond short
    assert.equal(sent.length, 1);
    clock.t = 650;
    q.flush();
    assert.deepEqual(sent.map((s) => s.text), ["a", "b"], "due at exactly one gap");
    assert.equal(sent[1].at - sent[0].at, 650, "the recorded gap is exactly 650 ms");
    assert.equal(q.pending(), 0);
});

test("five lines typed in 50 ms all reach the room, in order, never closer than the gap", () => {
    const { q, clock, sent } = fakeQueue();
    for (let i = 0; i < 5; i++) { q.push(String(i)); clock.t += 10; }
    assert.equal(sent.length, 1, "only the first went straight out");
    assert.equal(q.pending(), 4, "the other four wait");

    for (clock.t = 50; clock.t <= 5000; clock.t += 10) q.flush();
    assert.deepEqual(sent.map((s) => s.text), ["0", "1", "2", "3", "4"], "every line, in the order typed");
    for (let i = 1; i < sent.length; i++) {
        assert.ok(sent[i].at - sent[i - 1].at >= 650, `line ${i} waited ${sent[i].at - sent[i - 1].at} ms`);
    }
    assert.equal(q.pending(), 0);
});

test("reset drops what is waiting, sends nothing more, and a new line after it goes at once", () => {
    const { q, clock, sent } = fakeQueue();
    q.push("a"); q.push("b"); q.push("c");
    assert.equal(sent.length, 1);
    assert.equal(q.pending(), 2);
    q.reset();
    assert.equal(q.pending(), 0, "the queue is empty");
    for (clock.t = 0; clock.t <= 5000; clock.t += 10) q.flush();
    assert.deepEqual(sent.map((s) => s.text), ["a"], "the dropped lines never leave");
    clock.t = 6000;
    assert.equal(q.push("d"), "sent", "a fresh connection is not held back by the old one");
    assert.deepEqual(sent.map((s) => s.text), ["a", "d"]);
});

test("a line the connection refuses is not counted as sent, and the next one after reconnecting works", () => {
    const { q, clock, sent, setOnline } = fakeQueue({ online: false });
    assert.equal(q.push("a"), false, "offline: the caller is told it did not leave");
    assert.equal(sent.length, 0);
    assert.equal(q.pending(), 0, "nothing is counted as sent or waiting");
    setOnline(true);
    clock.t = 100;
    assert.equal(q.push("b"), "sent");
    assert.deepEqual(sent.map((s) => s.text), ["b"]);
    assert.equal(sent[0].at, 100);
});

test("a queued line survives a send that fails and leaves once the connection is back", () => {
    const { q, clock, sent, setOnline } = fakeQueue();
    q.push("a");                                   // sent at 0
    q.push("b");                                   // queued
    setOnline(false);
    clock.t = 650;
    q.flush();
    assert.equal(q.pending(), 1, "the refusal does not lose the line");
    assert.deepEqual(sent.map((s) => s.text), ["a"]);
    setOnline(true);
    clock.t = 2000;
    q.flush();
    assert.deepEqual(sent.map((s) => s.text), ["a", "b"]);
    assert.ok(sent[1].at - sent[0].at >= 650, "it still keeps the gap");
    assert.equal(q.pending(), 0);
});

test("three lines typed in one second all reach the room through the real relay", () => {
    // the queue's sends go through the real room core, on one fake clock: what a player types, what the relay does
    const clock = { t: 1000 };
    const hub = new Hub({ now: () => clock.t });
    const a = hub.open(() => { }, { create: true, name: "SENIOR" }).session;
    const heard = [];
    const sentAt = [];
    hub.open((s) => heard.push(JSON.parse(s)), { room: a.room, name: "Ana" });
    const q = createChatQueue({
        now: () => clock.t,
        send: (text) => { sentAt.push(clock.t); a.onMessage(JSON.stringify({ t: "chat", text })); return true; },
    });

    q.push("one");
    clock.t += 300; q.push("two");
    clock.t += 300; q.push("three");
    assert.deepEqual(heard.filter((m) => m.t === "chat").map((m) => m.text), ["one"], "the relay heard the first line only");
    for (clock.t = 1600; clock.t <= 4000; clock.t += 50) q.flush();
    assert.deepEqual(heard.filter((m) => m.t === "chat").map((m) => m.text), ["one", "two", "three"], "all three arrived, in order");

    // the relay is still the backstop: a line typed 100 ms after the last one is dropped by the relay itself
    clock.t = sentAt.at(-1) + 100;
    a.onMessage(JSON.stringify({ t: "chat", text: "too soon" }));
    assert.deepEqual(heard.filter((m) => m.t === "chat").map((m) => m.text), ["one", "two", "three"], "the relay's 600 ms drop is untouched");
});

test("the queue is client-side only: the relay keeps its 600 ms drop and hears the same chat message", () => {
    const core = src("../server/room-core.mjs");
    assert.match(core, /const CHAT_GAP = 600;\s+\/\/ ms between two chat lines from one player/, "the relay's gap is untouched");
    assert.match(core, /if \(!text \|\| t - peer\.lastChat < CHAT_GAP\) return;/, "the relay still drops a line under it");
    assert.match(core, /const CHAT_MAX = 100/, "the line length cap is untouched");
    assert.ok(!/chatqueue|chatq/i.test(core), "the relay knows nothing about the queue");

    const queue = src("../web/chat-queue.js");
    assert.ok(!/JSON\.stringify|\.send\(|WebSocket|fetch\(|document\.|window\./.test(queue), "the queue is pure: no socket, no page");

    const mp = src("../web/multiplayer.js");
    assert.match(mp, /import \{ createChatQueue \} from "\.\/chat-queue\.js";/, "the game's chat uses the queue");
    assert.match(mp, /window\.__fx\?\.chatqueue === true/, "the F2 switch is the gate");
    assert.match(mp, /if \(!chatQueueOn\(\)\) return sendRaw\(\{ t: "chat", text \}\) \? "sent" : false;/, "switch off = today's send, at once");
    assert.match(mp, /t: "chat", text/, "the wire message is still the relay's chat message");
    assert.ok(!/t: "chat[a-z]/i.test(mp), "no new relay message type");
    assert.match(mp, /chatQ\.flush\(\)/, "the per-frame tick drains the queue");
    assert.match(mp, /resetChatQueue\(\)/, "a closed connection drops its queue");

    const social = src("../web/mpsocial.js");
    assert.match(social, /const r = sendChat\(text\)/, "the dock reads what happened to the line");
    assert.match(social, /r === "queued"/, "and knows a line is waiting");
    assert.match(social, /chatPending\(\)/, "and how many wait");
});

test("F2 -> Extras -> Chat: one row, in EXPERIMENTAL, off until switched on", () => {
    const ambience = src("../web/ambience.js");
    assert.match(ambience, /\["chatqueue", "Chat: keep every line I type"\]/, "the Extras row");
    assert.match(ambience, /const EXPERIMENTAL = \[[^\]]*"chatqueue"/, "chatqueue is EXPERIMENTAL");
    assert.match(ambience, /for \(const k of MANUAL\) fx\[k\] = false/, "and therefore off until switched on");
});
