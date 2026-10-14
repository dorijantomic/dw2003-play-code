// Browser test: two separate players meet through the multiplayer relay and see each other in the game.
// Needs the game served on PORT (default 8770). Starts its own relay on a free port.
// Run:   tools/run-playwright.sh tools/verify_multiplayer.mjs     (SHOTS=dir to keep screenshots)
import { chromium } from "playwright";
import { startRelay } from "../server/relay.mjs";

const PORT = process.env.PORT || 8770;
const SHOTS = process.env.SHOTS || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => { console.log(cond ? "PASS" : "FAIL", name, extra); if (!cond) process.exitCode = 1; };

const relay = await startRelay({ port: 0, host: "127.0.0.1" });
const plain = `http://localhost:${PORT}/index.html?skipTitle=1&noEncounters=1&map=s330`;
const hostUrl = `${plain}&relay=ws://127.0.0.1:${relay.port}`;   // only the host page needs this (no launcher in the test); the friend types the address
const browser = await chromium.launch();
const errors = [];

async function player(label, url) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`.slice(0, 200)));
    page.on("console", (m) => { if (/\[multiplayer\]/.test(m.text())) errors.push(`${label}: ${m.text()}`.slice(0, 300)); });
    await page.goto(url);
    await page.waitForFunction(() => window.__state?.started && window.__mp, null, { timeout: 60000 });
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Authentic PS1/.test(b.textContent))?.click());
    await sleep(3500);
    return page;
}

try {
    const a = await player("A", hostUrl);
    const b = await player("B", plain);
    await a.evaluate(() => { window.__state.playerName = "SENIOR"; });   // the name each player gave their character
    await b.evaluate(() => { window.__state.playerName = "Ana"; });

    // the panel opens with F4 and starts in the "not connected" state
    await a.keyboard.press("F4");
    ok("F4 opens the panel", await a.evaluate(() => !document.getElementById("mp-panel").hidden));
    ok("the name box starts with the character name, exactly as typed in the game", (await a.inputValue("#mp-name")) === "SENIOR", await a.inputValue("#mp-name"));

    // typing in the panel did not move the character
    const before = await a.evaluate(() => [window.__state.x, window.__state.y]);
    await a.focus("#mp-name");
    for (const k of ["a", "s", "d", "w", "ArrowLeft", "ArrowUp"]) await a.keyboard.press(k);
    const after = await a.evaluate(() => [window.__state.x, window.__state.y]);
    ok("typing in the panel does not walk the character", before[0] === after[0] && before[1] === after[1], `${before} -> ${after}`);

    // A creates a room by clicking the real button; B joins by typing the code
    await a.fill("#mp-name", "SENIOR");
    await a.click("#mp-host");
    await a.waitForFunction(() => window.__mp.mp.status === "online", null, { timeout: 8000 });
    const room = await a.evaluate(() => window.__mp.mp.room);
    ok("a five-character room code is shown", /^[A-Z0-9]{5}$/.test(room) && (await a.textContent("#mp-code")) === room, room);

    await b.keyboard.press("F4");
    ok("the host panel shows the host's addresses to give out", (await a.textContent("#mp-addrs")).trim().length > 0, (await a.textContent("#mp-addrs")).trim());
    await b.fill("#mp-addr", `127.0.0.1:${relay.port}`);
    await b.fill("#mp-join-code", room.toLowerCase());
    await b.click("#mp-join");
    await b.waitForFunction(() => window.__mp.mp.status === "online", null, { timeout: 8000 });
    ok("both players are in the room", (await a.evaluate(() => window.__mp.mp.peers.size)) === 1 && (await b.evaluate(() => window.__mp.mp.peers.size)) === 1);

    // A is moved; B should see A's ghost at that place, in the same stage
    const where = await a.evaluate(() => { const s = window.__state; s.x += 40; s.y += 24; s.dir = "left"; return [Math.round(s.x), Math.round(s.y)]; });
    await b.waitForFunction(() => window.__mp.ghosts(window.__state.manifest.maps[window.__state.mapIdx].id).length === 1, null, { timeout: 5000 });
    await sleep(900);                                            // let the ghost glide into place
    const ghost = await b.evaluate(() => window.__mp.ghosts(window.__state.manifest.maps[window.__state.mapIdx].id)[0]);
    ok("B sees A's ghost by name, as typed", ghost.name === "SENIOR", ghost.name);
    ok("the ghost is where A stands", Math.abs(ghost.x - where[0]) <= 2 && Math.abs(ghost.y - where[1]) <= 2, `${ghost.x},${ghost.y} vs ${where}`);
    ok("and faces the way A faces", ghost.dir === "left", ghost.dir);

    // an emote travels too
    await a.evaluate(() => window.__mp.sendEmote(1));
    await b.waitForFunction(() => window.__mp.ghosts(window.__state.manifest.maps[window.__state.mapIdx].id)[0]?.emote === "!", null, { timeout: 3000 });
    ok("an emote shows over the ghost", true);
    if (SHOTS) await b.screenshot({ path: `${SHOTS}/multiplayer-b.png` });

    // ---- the social box: chat, events, players, inspect, trade
    ok("the chat box appears once online", await b.evaluate(() => document.getElementById("mp-dock").style.display !== "none"));
    await a.fill("#mp-dock .say input", "hello there friend");
    await a.press("#mp-dock .say input", "Enter");
    await b.waitForFunction(() => window.__mpsocial.S.log.some((e) => e.k === "chat" && e.text === "hello there friend" && e.name === "SENIOR"), null, { timeout: 4000 });
    ok("B's chat history shows SENIOR's line, with the name as typed", true);
    ok("the line is also over SENIOR's head for B", (await b.evaluate(() => window.__mp.ghosts(window.__state.manifest.maps[window.__state.mapIdx].id)[0]?.say)) === "hello there friend");
    ok("and over my own head for A", (await a.evaluate(() => window.__mp.mp.me.say)) === "hello there friend");
    ok("chat does not walk the character", await a.evaluate(() => !window.__state.keys.size));
    if (SHOTS) { await b.screenshot({ path: `${SHOTS}/multiplayer-chat-b.png` }); await a.screenshot({ path: `${SHOTS}/multiplayer-chat-a.png` }); }

    // a level up is announced to everyone
    await a.evaluate(() => {                                     // the debug start has no party; give A the usual three starters
        const s = window.__state, block = (digimonId, hp, mp) => ({ digimonId, level: 1, xp: 0, tp: 0, hp, maxHp: hp, mp, maxMp: mp, bonuses: {}, elemBonuses: {} });
        s.party = ["p003pken", "p009rena", "p010pata"]; s.charId = "p003pken";
        s.partnerStats = block(1, 86, 38); s.partyStats = [s.partnerStats, block(7, 80, 40), block(8, 90, 55)];
    });
    await sleep(3200);                                           // A's card baseline (the box polls every 1.5 s)
    await a.evaluate(() => { window.__state.partnerStats.level += 1; });
    await b.waitForFunction(() => window.__mpsocial.S.log.some((e) => e.k === "feed" && e.kind === "level" && /reached Lv/.test(e.text)), null, { timeout: 5000 });
    ok("B sees SENIOR's level up in the events", true, await b.evaluate(() => window.__mpsocial.S.log.filter((e) => e.k === "feed").map((e) => e.name + " " + e.text).join(" / ")));

    // players tab + inspect
    await b.click('#mp-dock .top button:has-text("PLAYERS")');
    await b.waitForFunction(() => /SENIOR/.test(document.querySelector("#mp-dock .players").textContent) && /Lv \d+/.test(document.querySelector("#mp-dock .players").textContent), null, { timeout: 5000 });
    ok("the players list shows SENIOR with a level", true, (await b.textContent("#mp-dock .players")).replace(/\s+/g, " ").slice(0, 160));
    await b.click('#mp-dock .pl:has-text("SENIOR") button:has-text("Inspect")');
    const win = (await b.textContent(".mp-win:not(.wide)")).replace(/\s+/g, " ");
    ok("inspect shows the name, HP and BIT", /SENIOR/.test(win) && /HP/.test(win) && /BIT/.test(win), win.slice(0, 200));
    if (SHOTS) await b.screenshot({ path: `${SHOTS}/multiplayer-inspect-b.png` });
    await b.click(".mp-win:not(.wide) .x");

    // trade: B asks, A accepts, A offers an item and 5 BIT, both confirm
    const item = await a.evaluate(() => {
        const api = window.__mpsocial.api;
        for (let id = 1; id < 300; id++) {
            if (!window.__ITEM_BY_ID[id]) continue;
            window.__state.inventory.push({ id, qty: 3 });
            if (api.tradable().some((x) => x.id === id)) return id;
            window.__state.inventory.pop();
        }
        return null;
    });
    ok("found an item that can be traded", item != null, String(item));
    await a.evaluate(() => { window.__state.bits = 100; });
    await b.evaluate(() => { window.__state.bits = 20; });
    await b.click('#mp-dock .pl:has-text("SENIOR") button:has-text("Trade")');
    await a.waitForSelector('.mp-win.wide:not([hidden]) button:has-text("Accept")', { timeout: 4000 });
    await a.click('.mp-win.wide button:has-text("Accept")');
    await b.waitForSelector('.mp-win.wide .bag', { timeout: 4000 });
    await a.waitForSelector('.mp-win.wide .bag .it button:has-text("+")', { timeout: 4000 });
    await a.click('.mp-win.wide .bag .it button:has-text("+")');
    await a.click('.mp-win.wide .bag .it button:has-text("+")');
    await a.fill(".mp-win.wide input.bits", "5"); await a.press(".mp-win.wide input.bits", "Tab");
    await b.waitForFunction(() => /2 x/.test(document.querySelector(".mp-win.wide .offer")?.textContent ?? "") && /5 BIT/.test(document.querySelector(".mp-win.wide .offer")?.textContent ?? ""), null, { timeout: 4000 });
    ok("B sees exactly what A offers (2 items, 5 BIT)", true, (await b.textContent(".mp-win.wide .offer")));
    await a.click('.mp-win.wide button:has-text("Confirm trade")');
    ok("one confirmation is not enough", await b.evaluate(() => !!document.querySelector(".mp-win.wide:not([hidden])")));
    if (SHOTS) await b.screenshot({ path: `${SHOTS}/multiplayer-trade-b.png` });
    const before2 = await b.evaluate((id) => (window.__state.inventory.find((s) => s.id === id)?.qty ?? 0), item);
    await b.click('.mp-win.wide button:has-text("Confirm trade")');
    await b.waitForFunction(() => document.querySelector(".mp-win.wide").hidden, null, { timeout: 4000 });
    await a.waitForFunction(() => document.querySelector(".mp-win.wide").hidden, null, { timeout: 4000 });
    const got = await b.evaluate((id) => ({ q: window.__state.inventory.find((s) => s.id === id)?.qty ?? 0, bits: window.__state.bits }), item);
    const gave = await a.evaluate((id) => ({ q: window.__state.inventory.find((s) => s.id === id)?.qty ?? 0, bits: window.__state.bits }), item);
    ok("B received the 2 items and 5 BIT", got.q === before2 + 2 && got.bits === 25, JSON.stringify(got));
    ok("A gave them: 1 item left and 95 BIT", gave.q === 1 && gave.bits === 95, JSON.stringify(gave));

    // a trade is cancelled when one side leaves the room
    await b.click('#mp-dock .pl:has-text("SENIOR") button:has-text("Trade")');
    await a.waitForSelector('.mp-win.wide:not([hidden]) button:has-text("Accept")', { timeout: 4000 });
    await a.click('.mp-win.wide button:has-text("Decline")');
    await b.waitForFunction(() => document.querySelector(".mp-win.wide").hidden, null, { timeout: 4000 });
    ok("a declined trade closes on both sides", true);

    // A leaves: B no longer sees them
    await a.click("#mp-leave");
    await b.waitForFunction(() => window.__mp.mp.peers.size === 0, null, { timeout: 5000 });
    ok("when A leaves, B's ghost list is empty", (await b.evaluate(() => window.__mp.ghosts(window.__state.manifest.maps[window.__state.mapIdx].id).length)) === 0);

    // a wrong code is refused with a clear message
    await a.fill("#mp-join-code", "QQQQQ");
    await a.click("#mp-join");
    await a.waitForFunction(() => document.getElementById("mp-msg").textContent.length > 0, null, { timeout: 5000 });
    ok("a wrong code says so", /no room/i.test(await a.textContent("#mp-msg")), await a.textContent("#mp-msg"));
    ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
    console.log("ERRORS SO FAR:", errors.join(" | "));
    throw e;
} finally {
    await browser.close();
    await relay.close();
}
