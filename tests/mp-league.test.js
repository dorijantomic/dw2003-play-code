// tests/mp-league.test.js — the Server Champ night: the bracket (web/mp-league.js) and its room block
// (`lg` in server/room-core.mjs). Node only: pure numbers and the room core, no browser.
//
// The rules below are all NEW (nothing here is original-game behaviour): 2..8 tamers in one room, single
// elimination, best of three fights, byes only in the first round, the host the only one who opens a night,
// calls a fight or reports a result, a tamer may drop out (a loss, no re-entry), and the last one standing is
// the Server Champ until the next night. The fiction is the game's own guide: "Server Champs can battle with
// others to be the next World Champ" / "become the strongest of the over 200,000 players"
// (docs/research/reference/dw3-systems-reference.md, `Server Tournament / Server Champ / World Champ`).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newLeague, nextPairing, report, forfeit, standings, champ, matchScore, packLeague, unpackLeague } from "../web/mp-league.js";
import { Hub } from "../server/room-core.mjs";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const lgSrc = src("../web/mp-league.js");
const socialSrc = src("../web/mpsocial.js");
const mpSrc = src("../web/multiplayer.js");
const ambienceSrc = src("../web/ambience.js");

const ids = (n) => Array.from({ length: n }, (_, i) => i + 1);

/** Play every fight the module offers, `p.a` winning 2-0. Returns how many fights were reported. */
function playNight(lg) {
    let played = 0;
    for (let guard = 0; guard < 100 && lg.phase !== "done"; guard++) {
        const p = nextPairing(lg);
        if (!p) continue;                 // null between rounds: the next call draws the next round
        const r = report(lg, p.a, [p.a, p.a]);
        assert.ok(r.ok, `report ${p.a} vs ${p.b}: ${r.refused}`);
        played++;
    }
    return played;
}

// ------------------------------------------------------------ the bracket

test("brackets of 2..8: rounds = ceil(log2 n), fights = n-1, and only the byes the bracket needs", () => {
    for (let n = 2; n <= 8; n++) {
        const lg = newLeague({ ids: ids(n) });
        const rounds = Math.ceil(Math.log2(n));
        assert.equal(lg.roundsPlanned, rounds, `${n} tamers: rounds`);
        assert.equal(lg.size, 2 ** rounds, `${n} tamers: bracket size`);
        assert.equal(lg.matches, n - 1, `${n} tamers: fights`);
        assert.equal(lg.byes, lg.size - n, `${n} tamers: byes`);
        // the first round holds every tamer exactly once, and exactly `byes` of its matches are byes
        const first = lg.rounds[0];
        const there = first.flatMap((m) => [m.a, m.b]).filter((x) => x != null).sort((x, y) => x - y);
        assert.deepEqual(there, ids(n), `${n} tamers: everyone is in the first round once`);
        assert.equal(first.filter((m) => m.bye).length, lg.byes, `${n} tamers: byes in the first round`);
        for (const m of first) if (m.bye) { assert.equal(m.b, null); assert.equal(m.w, m.a, "a bye goes through"); }
        // the whole night is n-1 fights and no later round has a bye
        assert.equal(playNight(lg), n - 1, `${n} tamers: fights played`);
        for (const round of lg.rounds.slice(1)) {
            assert.equal(round.filter((m) => m.bye).length, 0, `${n} tamers: no bye after the first round`);
            assert.equal(round.filter((m) => m.dead).length, 0);
            assert.equal(round.filter((m) => m.g.length === 0 && m.w != null).length, 0, "nobody walked over");
        }
        assert.ok(champ(lg) != null);
    }
});

test("nextPairing is null between rounds; the next call draws the next round", () => {
    const lg = newLeague({ ids: ids(4) });
    const p1 = nextPairing(lg);
    assert.ok(p1);
    assert.equal(report(lg, p1.a, [p1.a, p1.a]).ended, true);
    const p2 = nextPairing(lg);
    assert.ok(p2);
    assert.equal(report(lg, p2.a, [p2.a, p2.a]).ended, true);
    assert.equal(nextPairing(lg), null, "the first round is over");
    assert.equal(lg.phase, "break", "between rounds");
    const p3 = nextPairing(lg);
    assert.ok(p3, "the next call draws the final");
    assert.equal(p3.r, 1);
    assert.equal(lg.rounds.length, 2);
    assert.equal(report(lg, p3.a, [p3.a, p3.a]).ended, true);
    assert.equal(nextPairing(lg), null, "the night is won");
    assert.equal(lg.phase, "done");
});

test("the fight on the table is the same until it is decided, and the game number counts up", () => {
    const lg = newLeague({ ids: ids(2) });
    const first = nextPairing(lg);
    assert.deepEqual(nextPairing(lg), first, "asking again does not skip the fight");
    assert.equal(first.game, 1);
    report(lg, first.a, [first.b, first.a]);                  // 1-1
    const again = nextPairing(lg);
    assert.deepEqual([again.a, again.b, again.game], [first.a, first.b, 3]);
});

test("a night is 2 to 8 distinct tamers and an odd best-of: anything else is refused", () => {
    assert.throws(() => newLeague({ ids: [1] }), /2\.\.8/);
    assert.throws(() => newLeague({ ids: ids(9) }), /2\.\.8/);
    assert.throws(() => newLeague({ ids: [1, 1] }), /distinct/);
    assert.throws(() => newLeague({ ids: [0, 1] }), /distinct/);
    assert.throws(() => newLeague({ ids: [1, 2], bestOf: 2 }), /best of/);
    assert.equal(newLeague({ ids: [1, 2], bestOf: 1 }).bestOf, 1, "a quick night of one game a fight is allowed");
});

// ------------------------------------------------------------ best of three

test("best of three: 2-0 and 2-1 end the fight, 1-1 goes on, a refused game changes nothing", () => {
    const fresh = () => { const lg = newLeague({ ids: ids(4) }); const p = nextPairing(lg); return { lg, p, A: p.a, B: p.b }; };

    {   // 2-0
        const { lg, A } = fresh();
        assert.equal(report(lg, A, [A, A]).ended, true);
    }
    {   // 2-1
        const { lg, A, B } = fresh();
        assert.equal(report(lg, B, [A, B]).ended, false, "1-1 is not the end");
        assert.equal(report(lg, A, [A, B, A]).ended, true, "2-1 is");
    }
    {   // a fourth game
        const { lg, A, B } = fresh();
        report(lg, B, [A, B]);
        const four = report(lg, A, [A, B, A, A]);
        assert.equal(four.refused, "too_many_games", "a fourth game is refused");
        // the match is still on 1-1 and the third game is still to be played
        assert.equal(nextPairing(lg).game, 3);
    }
    {   // a third game inside the same report after a 2-0
        const { lg, A, B } = fresh();
        assert.equal(report(lg, B, [A, A, B]).refused, "already_over");
        assert.equal(nextPairing(lg).game, 1, "the refused report changed nothing");
    }
    {   // the host's say must match the games it reports
        const { lg, A, B } = fresh();
        report(lg, B, [A, B]);
        assert.equal(report(lg, A, [A, B, B]).refused, "wrong_winner");
        assert.equal(report(lg, B, [A, B, B]).ended, true, "the right report still goes through");
    }
    {   // a game by someone who is not in the fight
        const { lg, A } = fresh();
        assert.equal(report(lg, A, [A, 99]).refused, "not_in_match");
        assert.equal(report(lg, A, []).refused, "no_games");
    }
});

test("a finished fight's score is written from the winner's side: 2-1 and 2-0 read the same whoever won", () => {
    const m = (a, b, w, g) => ({ a, b, w, g });
    assert.equal(matchScore(m(1, 2, 1, [1, 2, 1])), "2-1", "the first tamer of the pairing won 2-1");
    assert.equal(matchScore(m(1, 2, 2, [1, 2, 2])), "2-1", "the second tamer won 2-1: no 1-2");
    assert.equal(matchScore(m(1, 2, 1, [1, 1])), "2-0", "the first tamer won 2-0");
    assert.equal(matchScore(m(1, 2, 2, [2, 2])), "2-0", "the second tamer won 2-0");
    assert.equal(matchScore({ a: 1, b: 2 }), "", "a fight still to be played has no score");
});

// ------------------------------------------------------------ dropping out

test("a forfeit drops that tamer: their opponent goes through and the night never pairs them again", () => {
    const lg = newLeague({ ids: ids(4) });
    const first = nextPairing(lg);
    const [A, B] = [first.a, first.b];
    const res = forfeit(lg, B);
    assert.deepEqual(res, { ok: true, id: B, to: A });
    assert.deepEqual(lg.dropped, [B]);
    assert.equal(lg.rounds[0][0].w, A);
    assert.equal(lg.rounds[0][0].wo, true, "a walkover, not a played fight");
    const next = nextPairing(lg);
    assert.ok(next);
    assert.notEqual(next.a, B);
    assert.notEqual(next.b, B);
    // no re-entry: a second forfeit is refused and the tamer is in no pairing any more
    assert.equal(forfeit(lg, B).refused, "dropped");
    for (let guard = 0; guard < 50 && lg.phase !== "done"; guard++) {
        const p = nextPairing(lg);
        if (!p) continue;
        assert.notEqual(p.a, B, "a dropped tamer is never called again");
        assert.notEqual(p.b, B, "a dropped tamer is never called again");
        report(lg, p.a, [p.a, p.a]);
    }
    assert.notEqual(champ(lg), B);
    assert.ok(standings(lg).find((row) => row.id === B).out, "the dropped tamer is out");
});

test("a tamer who forfeits between rounds hands their next fight to the opponent", () => {
    const lg = newLeague({ ids: ids(8) });
    // play the whole first round; the first id of every match wins
    for (let i = 0; i < 4; i++) {
        const p = nextPairing(lg);
        assert.ok(p);
        report(lg, p.a, [p.a, p.a]);
    }
    assert.equal(lg.phase, "break");
    const winner = lg.rounds[0][0].w;                         // in the next round's first fight
    forfeit(lg, winner);
    assert.equal(nextPairing(lg), null, "between rounds");
    const firstOfNext = nextPairing(lg);
    assert.ok(firstOfNext, "the other half of the round is still played");
    assert.notEqual(firstOfNext.a, winner, "the dropped tamer is not called again");
    assert.notEqual(firstOfNext.b, winner);
    // the dropped tamer's own next fight was a walkover for their opponent
    const handed = lg.rounds[1].find((m) => m.a === winner || m.b === winner);
    assert.equal(handed.wo, true);
    assert.notEqual(handed.w, winner);
    let guard = 0;
    while (lg.phase !== "done" && guard++ < 20) {
        const p = nextPairing(lg);
        if (!p) continue;
        report(lg, p.a, [p.a, p.a]);
    }
    assert.ok(champ(lg) != null);
    assert.notEqual(champ(lg), winner);
});

// ------------------------------------------------------------ the champion

test("champ is null until the final is won; the champion is the last tamer standing", () => {
    const lg = newLeague({ ids: ids(5) });
    assert.equal(champ(lg), null);
    let guard = 0;
    while (!champ(lg) && guard++ < 50) {
        const p = nextPairing(lg);
        if (!p) continue;
        assert.equal(champ(lg), null, "no champion before the final is over");
        report(lg, p.a, [p.a, p.a]);
    }
    assert.ok(champ(lg) != null);
    const last = lg.rounds[lg.roundsPlanned - 1][0];
    assert.equal(lg.champ, last.w);
    assert.equal(standings(lg)[0].id, lg.champ, "the champion is first");
    assert.equal(standings(lg)[0].champ, true);
    assert.equal(standings(lg).filter((row) => !row.out).length, 1, "one tamer is still standing");
    assert.equal(standings(lg).length, 5, "every tamer is in the standings");
});

// ------------------------------------------------------------ the room's `lg` block

function client(hub, opts) {
    const got = [];
    const r = hub.open((s) => got.push(JSON.parse(s)), opts);
    return { got, ...r, last: (t) => got.filter((m) => m.t === t).at(-1) };
}
const send = (c, o) => c.session.onMessage(JSON.stringify(o));
const state = (c) => c.got.filter((m) => m.t === "lg" && m.op === "state").at(-1);
const night = (c) => unpackLeague(state(c)?.lg);            // the same bracket the dock reads

function room(n, hub = new Hub()) {
    const host = client(hub, { create: true, name: "T1" });
    const code = host.last("welcome").room;
    const all = [host];
    for (let i = 2; i <= n; i++) all.push(client(hub, { room: code, name: "T" + i }));
    return { host, all, hub, ids: all.map((c) => c.session.id) };
}

test("Hub: only the host opens, calls and reports; a tamer drops themselves; state reaches every peer", () => {
    const { host, all, ids: who } = room(3);
    const [, b, c] = all;
    for (const x of [b, c]) {
        send(x, { t: "lg", op: "open", ids: who });
        send(x, { t: "lg", op: "next" });
        send(x, { t: "lg", op: "win", winner: who[0], games: [who[0], who[0]] });
    }
    assert.equal(all.some((x) => x.got.some((m) => m.t === "lg")), false, "a non-host cannot open or call a fight");
    send(b, { t: "lg", op: "drop" });                         // nothing open yet: refused, and only to them
    assert.deepEqual(b.last("lg"), { t: "lg", op: "no", why: "no_league" });
    assert.equal(c.got.filter((m) => m.t === "lg").length, 0);

    send(host, { t: "lg", op: "open", ids: who });
    for (const x of all) {
        const st = state(x);
        assert.ok(st, "every peer is told");
        assert.equal(st.host, host.session.id, "the room names its host");
        assert.deepEqual(night(x).ids, who);
        assert.equal(night(x).bestOf, 3);
    }
    // the host calls the first fight (two tamers with no bye), every peer hears the pairing
    send(host, { t: "lg", op: "next" });
    for (const x of all) {
        const st = state(x);
        assert.ok(st.pair, "the pairing reaches every peer");
        assert.deepEqual([st.pair.a, st.pair.b].sort(), who.slice(1, 3).sort(), "the two tamers without a bye");
    }
});

test("Hub: a whole 8-tamer night, best of three, and every message stays under 600 bytes", () => {
    const hub = new Hub();
    hub.nextId = 1000;                                        // a long-running relay: tamer ids are not 1..8
    const { host, all, ids: who } = room(8, hub);
    send(host, { t: "lg", op: "open", ids: who });
    for (let guard = 0; guard < 60; guard++) {
        const before = night(host);
        if (!before || before.phase === "done") break;
        if (!state(host).pair) { send(host, { t: "lg", op: "next" }); continue; }
        // make every fight a 2-1 so the bracket carries the most games it can
        const pair = state(host).pair;
        send(host, { t: "lg", op: "win", winner: pair.a, games: [pair.b, pair.a, pair.a] });
        assert.equal(state(host).ev.k, "win", "a 2-1 ends the fight");
        assert.equal(state(host).ev.g, "2-1", "the result line carries the score");
    }
    const end = night(host);
    assert.equal(end.phase, "done");
    assert.equal(end.champ, who[0]);
    assert.equal(end.rounds.flat().length, 7, "seven fights in an eight-tamer bracket");
    let worst = 0;
    for (const x of all) {
        for (const m of x.got) {
            const len = JSON.stringify(m).length;
            worst = Math.max(worst, len);
            assert.ok(len < 600, `a ${m.t}/${m.op ?? ""} message is ${len} bytes`);
        }
    }
    assert.ok(worst > 400, `the biggest message is really tested (${worst} bytes)`);
    assert.equal(all.every((x) => night(x).champ === who[0]), true, "the champion is in every peer's state");
    // the room holds the bracket; closing the room drops it
    assert.ok(hub.rooms.size > 0);
    for (const x of all) x.session.onClose();
    assert.equal(hub.rooms.size, 0);
});

test("Hub: a self drop is accepted, every peer sees it, and the room names a new host when the host leaves", () => {
    const { host, all, ids: who } = room(4);
    send(host, { t: "lg", op: "open", ids: who });
    const quitter = all[2];
    send(quitter, { t: "lg", op: "drop" });
    for (const x of all) assert.deepEqual(night(x).dropped, [quitter.session.id]);
    assert.equal(state(host).ev.k, "drop");
    // the host leaves mid-night: the night cannot go on, so it is dropped and a new host is named
    host.session.onClose();
    const survivor = all[1];
    assert.equal(state(survivor).lg, null, "the bracket died with its host");
    assert.equal(survivor.last("host").id, survivor.session.id, "the next tamer is host");
});

test("Hub: a tamer who joins mid-night is shown the bracket", () => {
    const { host, ids: who, hub } = room(2);
    send(host, { t: "lg", op: "open", ids: who });
    const late = client(hub, { room: host.last("welcome").room, name: "Late" });
    const st = state(late);
    assert.ok(st, "the late tamer gets the state");
    assert.deepEqual(night(late).ids, who);
    assert.equal(st.pair, null);
});

test("Hub: a tamer who disconnects mid-night drops out like a forfeit", () => {
    const { host, all, ids: who } = room(4);
    send(host, { t: "lg", op: "open", ids: who });
    send(host, { t: "lg", op: "next" });
    const pair = state(host).pair;
    const leaver = all.find((x) => x.session.id === pair.b);
    leaver.session.onClose();
    const lg = night(host);
    assert.deepEqual(lg.dropped, [pair.b], "a disconnect counts as leaving the night");
    assert.equal(lg.rounds[0].find((m) => m.a === pair.a || m.b === pair.a).wo, true, "the opponent goes through");
    assert.notEqual(state(host).pair?.a, pair.b, "the disconnected tamer is not called again");
    assert.notEqual(state(host).pair?.b, pair.b);
});

test("Hub: the next night starts once one is won, with no champion on the board", () => {
    const { host, ids: who } = room(2);
    send(host, { t: "lg", op: "open", ids: who });
    send(host, { t: "lg", op: "next" });
    const pair = state(host).pair;
    send(host, { t: "lg", op: "win", winner: pair.a, games: [pair.a, pair.a] });
    assert.equal(night(host).champ, pair.a);
    assert.equal(state(host).ev.c, 1, "the final win is announced as the championship");
    send(host, { t: "lg", op: "open", ids: who });
    assert.equal(night(host).champ, null, "the next night has no champion yet");
    assert.deepEqual(night(host).rounds.flat().length, 1, "a fresh bracket");
});

test("Hub: a result names the winner first and scores from their side, the second tamer of the pairing too", () => {
    const { host, all, ids: who } = room(2);
    send(host, { t: "lg", op: "open", ids: who });
    send(host, { t: "lg", op: "next" });
    const pair = state(host).pair;
    assert.deepEqual([pair.a, pair.b], who, "the first tamer of the draw is the first one of the pairing");
    // the SECOND tamer wins 2-1: every dock prints "<winner> beat <loser> 2-1"
    send(host, { t: "lg", op: "win", winner: pair.b, games: [pair.a, pair.b, pair.b] });
    for (const x of all) {
        const ev = state(x).ev;
        assert.equal(ev.k, "win");
        assert.deepEqual([ev.w, ev.l], [pair.b, pair.a], "the winner is named first, the loser second");
        assert.equal(ev.g, "2-1", "the winner's games come first, the loser's second (never 1-2)");
    }
    // the next night the second tamer wins 2-0: still from their side
    send(host, { t: "lg", op: "open", ids: who });
    send(host, { t: "lg", op: "next" });
    const again = state(host).pair;
    send(host, { t: "lg", op: "win", winner: again.b, games: [again.b, again.b] });
    assert.equal(state(host).ev.g, "2-0");
    // and the first tamer winning reads the same way round
    send(host, { t: "lg", op: "open", ids: who });
    send(host, { t: "lg", op: "next" });
    const third = state(host).pair;
    send(host, { t: "lg", op: "win", winner: third.a, games: [third.a, third.b, third.a] });
    assert.deepEqual([state(host).ev.w, state(host).ev.l, state(host).ev.g], [third.a, third.b, "2-1"]);
});

// ------------------------------------------------------------ the champion's card, and the switch

test("a champion card is a normal player card plus one flag, and stays under the relay's 2000-byte cap", () => {
    const card = {
        v: 1, chapter: 7, bits: 1234567, quests: 12, champ: true,
        party: [
            { n: "Agumon", f: "WarGreymon", id: 3, lv: 99, xp: 999999, hp: 9999, mhp: 9999, mp: 999, mmp: 999, st: { str: 999, def: 999, spr: 999, spd: 999, wis: 999, cha: 999 } },
            { n: "Gabumon", f: "MetalGarurumon", id: 9, lv: 99, xp: 999999, hp: 9999, mhp: 9999, mp: 999, mmp: 999, st: { str: 999, def: 999, spr: 999, spd: 999, wis: 999, cha: 999 } },
            { n: "Patamon", f: "Seraphimon", id: 17, lv: 99, xp: 999999, hp: 9999, mhp: 9999, mp: 999, mmp: 999, st: { str: 999, def: 999, spr: 999, spd: 999, wis: 999, cha: 999 } },
        ],
    };
    assert.ok(JSON.stringify(card).length < 2000, `the champion card is ${JSON.stringify(card).length} bytes`);
    const { host, all, ids: who } = room(2);
    send(host, { t: "lg", op: "open", ids: who });
    send(host, { t: "lg", op: "next" });
    send(host, { t: "card", card });
    assert.equal(all[1].last("card").card.champ, true, "the relay carries the flag like any other card field");
});

test("F2 -> Extras -> Server Champ league: off by default, and off means no button, no lg, a normal card", () => {
    // the switch and its default: the Extras row plus the EXPERIMENTAL list (the panel's own two lists)
    assert.match(ambienceSrc, /\["serverchamp", "Server Champ league"\]/, "the Extras row");
    assert.match(ambienceSrc, /const EXPERIMENTAL = \[[^\]]*"serverchamp"/, "serverchamp is EXPERIMENTAL");
    assert.match(ambienceSrc, /for \(const k of MANUAL\) fx\[k\] = false/, "and therefore off until switched on");
    // no message leaves a client with the switch off
    assert.match(mpSrc, /export const sendLeague = \(o\) => serverChampOn\(\) \? sendRaw\(\{ t: "lg", \.\.\.o \}\) : false;/, "the send is gated");
    assert.match(mpSrc, /window\.__fx\?\.serverchamp === true/, "the gate reads the F2 switch");
    // no button and no bracket with the switch off
    assert.match(socialSrc, /if \(serverChampOn\(\)\) el\.players\.append\(leagueStrip\(\)\)/, "the strip is gated");
    // a card that carries champ draws as a normal card: the flag is only read behind the switch
    assert.match(socialSrc, /const isChamp = \(p\) => serverChampOn\(\) && \(p\.id === champId\(\) \|\| p\.card\?\.champ === true\)/, "the champ colour is gated");
});

test("the dock prints the winner's name and the winner's score, in the feed and in the bracket strip", () => {
    // the feed's result line: winner first, loser second, the score the relay computed
    const feed = socialSrc.match(/else if \(ev\.k === "win"\)[^\n]*/)?.[0] ?? "";
    assert.match(feed, /lgName\(ev\.w\)\} beat \$\{lgName\(ev\.l\)\} \$\{ev\.g\}/, "the feed says who won, then the score");
    // the strip's finished match: no bracket-order score any more
    const fn = socialSrc.match(/function matchText\(m\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    assert.match(fn, /matchScore\(m\)/, "the strip scores a finished fight from the winner's side");
    assert.ok(!/leagueScore\(m, m\.a\)\}-\$\{leagueScore\(m, m\.b\)/.test(fn), "no bracket-order score in the strip");
});

test("a room bigger than a night still starts one, and the strip appears when the switch is turned on", () => {
    const between = (a, b) => socialSrc.slice(socialSrc.indexOf(a), socialSrc.indexOf(b));
    const start = between("function startLeague()", "function reportGame");
    assert.match(start, /all\.slice\(0, MAX_TAMERS\)/, "the start keeps a night to the 8 tamers the relay allows");
    assert.match(start, /note\(/, "and tells the host who is in it when the room is bigger");
    assert.ok(!/sendLeague\(\{ op: "open", ids: \[myId\(\), \.\.\.peerList\(\)/.test(start), "no 9-tamer open the relay would refuse");
    const poll = between("function pollSelf()", "// ------------------------------------------------------------ install");
    assert.match(poll, /if \(on !== champOn\)/, "the dock notices the switch flipping");
    assert.match(poll, /drawPlayers\(\)/, "and redraws the PLAYERS tab: the strip appears at once");
});

test("one night travels packed and comes back the same, small enough for the relay's 600-byte cap", () => {
    const lg = newLeague({ ids: ids(5) });                 // three byes in the first round
    const p = nextPairing(lg);                             // the one real first-round fight
    report(lg, p.a, [p.b, p.a, p.a]);                      // 2-1 in the book
    forfeit(lg, lg.rounds[0][0].w);                        // a bye tamer leaves
    forfeit(lg, lg.rounds[0][1].w);                        // and a second one: their next fight is a hole
    nextPairing(lg);                                       // between rounds
    nextPairing(lg);                                       // draw the next round: a dead match and a real one
    assert.deepEqual(unpackLeague(packLeague(lg)), lg, "a dead match, a walkover and a bye survive the wire");
    // play the rest and check the outside slot (a fight against nobody) too
    for (let guard = 0; guard < 20 && lg.phase !== "done"; guard++) {
        const q = nextPairing(lg);
        if (q) report(lg, q.a, [q.a, q.a]);
    }
    assert.ok(champ(lg) != null);
    assert.deepEqual(unpackLeague(packLeague(lg)), lg, "a whole finished night survives the wire");
    assert.ok(JSON.stringify(packLeague(lg)).length < 400, `a whole night is ${JSON.stringify(packLeague(lg)).length} bytes`);
    assert.equal(unpackLeague(null), null);
});

test("mp-league.js is pure: no DOM, no imports, and the client only reads it", () => {
    assert.ok(!/^\s*import\s/m.test(lgSrc), "no imports");
    assert.ok(!/document\.|window\.|localStorage|fetch\(|requestAnimationFrame/.test(lgSrc), "no browser");
    assert.ok(!/sendRaw|JSON\.stringify/.test(lgSrc), "the bracket does not build wire messages");
});
