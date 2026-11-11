// web/mpsocial.js: a player who is away is not "here" for trades, duels, party, co-op and the player list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../web/mpsocial.js", import.meta.url), "utf8");

test("the multiplayer import carries peerHere and playingCount", () => {
    assert.match(src, /import \{[^}]*\bpeerHere\b[^}]*\bplayingCount\b[^}]*\} from "\.\/multiplayer\.js";|import \{[^}]*\bplayingCount\b[^}]*\bpeerHere\b[^}]*\} from "\.\/multiplayer\.js";/);
});

test("the roster branch asks peerHere, not peerOf, for all five waiting states", () => {
    const at = src.indexOf('else if (type === "roster") {');
    const body = src.slice(at, src.indexOf('else if (type === "trade") onTrade(d);'));
    for (const re of [/if \(trade && !peerHere\(trade\.id\)\)/, /if \(duel && !peerHere\(duel\.id\) && duel\.st !== "fight"\)/,
        /if \(partner != null && !peerHere\(partner\)\)/, /if \(partyAsk && !peerHere\(partyAsk\.id\)\)/, /if \(coop && !peerHere\(coop\.id\)\)/]) assert.match(body, re);
    assert.doesNotMatch(body, /peerOf\(/);
});

test("a duel that has not been answered when the other side is away ends as 'left before finishing'", () => {
    assert.match(src, /if \(!duel\.theirs\) \{ if \(!peerHere\(duel\.id\)\) endDuel\(`\$\{n\} left before finishing the duel\.`\); return; \}/);
    assert.match(src, /const p = peerHere\(duel\?\.id\);\s*if \(!p\) \{ endDuel\("They left\."\); return; \}/);
});

test("co-op and team-up are offered only to a partner who is here", () => {
    assert.match(src, /export const coopReady = \(\) => !!\(isOnline\(\) && partner != null && peerHere\(partner\) && /);
    assert.match(src, /if \(!\(isOnline\(\) && partner != null && peerHere\(partner\) && !coop && !duel && !trade\)\) return false;/);
});

test("asking an away player to trade, duel or team up says so instead of waiting forever", () => {
    assert.equal((src.match(/if \(p\.away\) \{ note\(`\$\{p\.name\} is away\.`\); return; \}/g) ?? []).length, 3);
});

test("the player list marks away players and gives them no actions but Inspect; the tab counts only the present", () => {
    assert.match(src, /p\.away \? h\("span", "sub", "  \(away\)"\) : ""/);
    assert.match(src, /if \(!p\.self && !p\.away\) \{\s*acts\.append\(btn\("Trade"/);
    assert.match(src, /const n = playingCount\(\);/);
});
