// Wiring of the fight pause into web/mpbattle.js and web/game.js. The screen itself needs a DOM and WebGL, so what is proved here is the
// real exports (safe with no fight running) and the order of the real source lines. The pure rules are in tests/mpbattle-pause.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as bat from "../web/mpbattle.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const src = read("../web/mpbattle.js");
const fn = (name, next) => src.slice(src.indexOf(`function ${name}(`), src.indexOf(next));

test("the new exports exist and do nothing when no fight is running", () => {
    for (const n of ["mpbPeerAway", "mpbPeerBack"]) assert.equal(typeof bat[n], "function", n);
    assert.doesNotThrow(() => { bat.mpbPeerAway(5); bat.mpbPeerBack(5); });
});

test("nextTurn parks at its very top, before it clears the timer or asks the Arena who is next", () => {
    const body = fn("nextTurn", "/** PRACTICE");
    const gate = body.indexOf('H.pause.gate("next", nextTurn)');
    assert.ok(gate > 0, "gate present");
    assert.ok(gate < body.indexOf("clearTimeout(H.turnTimer)"));
    assert.ok(gate < body.indexOf("ar.next()"));
});

test("foeTurn parks before the Arena rolls the enemy action", () => {
    const body = fn("foeTurn", "/** A player's choice");
    const gate = body.indexOf('H.pause.gate("foe", () => foeTurn(key))');
    assert.ok(gate > 0 && gate < body.indexOf("ar.foeAction(key)"));
});

test("snapshot carries pz only while someone is away; the pause lives on F.H and is cleared by finish", () => {
    assert.match(fn("snapshot", "/** The other PEOPLE"), /const pz = H\.pause\?\.view\(\);[\s\S]*\.\.\.\(pz \? \{ pz \} : \{\}\)/);
    assert.match(src, /pause: createPause\(\)/);
    assert.match(fn("finish", "// ------------------------------------------------------------ install"), /f\.H\?\.pause\?\.clear\(\)/);
});

test("hostGone says whether it scheduled nextTurn; hostAway keeps the turn and clears only the timer; hostBack answers a fled player with left", () => {
    assert.match(fn("hostGone", "function hostEnd"), /later\(MIN_ANIM_MS, nextTurn\); return true; \}[^\n]*\n\s*return false;/);
    const away = fn("hostAway", "function hostBack");
    assert.match(away, /if \(H\.turn === p\.key\) clearTimeout\(H\.turnTimer\);/);
    assert.doesNotMatch(away, /p\.fled = true/);
    assert.match(fn("hostBack", "function rearmTurn"), /if \(p\.fled\) \{ A\.send\(\[from\], \{ k: "left", fid: F\.fid \}\); return; \}/);
});

test("mpbMessage hands a guest's back to the referee only", () => {
    const body = src.slice(src.indexOf("export function mpbMessage"), src.indexOf("/** Someone left the room mid-fight. */"));
    assert.match(body, /else if \(d\.k === "back"\) hostBack\(from\);/);
});

test("the status and hint show the wait, but my own turn stays usable", () => {
    assert.match(src, /import \{[^}]*\bcreatePause\b[^}]*\bpzText\b[^}]*\} from "\.\/mpbattle-pause\.js";/);
    assert.match(src, /t === "p" \+ A\.myId\(\) \? "YOUR TURN" : S\.pz \? pzText\(S\.pz, S\.P\)/);
    assert.match(src, /S\?\.ph === "play" \? \(S\.pz \? pzText\(S\.pz, S\.P\) : "Waiting\.\.\."\) : ""/);
});

test("game.js sends away and back to the fight code, and leave still ends it", () => {
    const g = read("../web/game.js");
    assert.match(g, /import \{[^}]*mpbPeerAway, mpbPeerBack[^}]*\} from "\.\/mpbattle\.js"/);
    assert.match(g, /else if \(type === "leave"\) mpbPeerGone\(d\.id\);\s*else if \(type === "away"\) mpbPeerAway\(d\.id\);\s*else if \(type === "back"\) mpbPeerBack\(d\.id\);/);
});

test("the link exports exist and do nothing when no fight is running", () => {
    for (const n of ["mpbLinkLost", "mpbLinkBack"]) assert.equal(typeof bat[n], "function", n);
    assert.doesNotThrow(() => { bat.mpbLinkLost(); bat.mpbLinkBack(true); bat.mpbLinkBack(false); });
});

test("every fight gets a link that closes it cleanly (fled, hostLeft) when it runs out; finish clears it", () => {
    assert.match(src, /link: createLink\(\{ onEnd: \(\) => \{ if \(F\) finish\(false, \{ fled: true, hostLeft: true \}\); \} \}\)/);
    assert.match(fn("finish", "// ------------------------------------------------------------ install"), /f\.link\?\.clear\(\)/);
});

test("a guest's link back sends back to the referee and waits; a new id (not resumed) leaves at once; the referee resumes itself", () => {
    const body = src.slice(src.indexOf("export function mpbLinkBack"), src.indexOf("function finish("));
    assert.match(body, /if \(!resumed\) \{ finish\(false, \{ fled: true, hostLeft: true \}\); return; \}/);
    assert.match(body, /F\.link\.reconnected\(\);[^\n]*\n\s*A\.send\(\[F\.hostId\], \{ k: "back", fid: F\.fid \}\);/);
    assert.match(body, /if \(F\.isHost\) \{ F\.link\.clear\(\); hostLinkBack\(\); render\(\); return; \}/);
});

test("a snapshot from the referee ends the guest's wait", () => {
    assert.match(src, /else if \(d\.k === "st"\) \{ F\.S = d\.S; F\.link\.clear\(\); render\(\); \}/);
});

test("while the link is down nobody can choose, and the status line says why", () => {
    assert.match(src, /const mineTurn = S && S\.ph === "play" && S\.t === myKey && F\.me\.hp > 0 && !F\.iFled && !F\.link\.active;/);
    assert.match(src, /const mineTurn = !!\(S && S\.ph === "play" && S\.t === myKey && !F\.iFled && !F\.link\.active && mine && \(forced \|\| !mine\.ko\)\);/);
    assert.match(src, /U\.status\.textContent = F\.link\.text \?\? \(S\.ph !== "play"/);
});

test("the referee's drop: guests wait for it (refWait); its own link loss holds the pause with no timer", () => {
    const peer = src.slice(src.indexOf("export function mpbPeerAway"), src.indexOf("export function mpbPeerBack"));
    assert.match(peer, /if \(!F\.isHost\) \{ if \(id === F\.hostId\) \{ F\.link\.refWait\(\); render\(\); \} return; \}/);
    assert.match(src, /H\.pause\.add\(SELF, null\)/);
});

test("game.js passes linklost and linkback on", () => {
    const g = read("../web/game.js");
    assert.match(g, /mpbLinkLost, mpbLinkBack/);
    assert.match(g, /else if \(type === "linklost"\) mpbLinkLost\(\);\s*else if \(type === "linkback"\) mpbLinkBack\(d\.resumed\);/);
});
