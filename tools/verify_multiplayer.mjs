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
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`.slice(0, 200)));
    await page.goto(url);
    await page.waitForFunction(() => window.__state?.started && window.__mp, null, { timeout: 60000 });
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Authentic PS1/.test(b.textContent))?.click());
    await sleep(3500);
    return page;
}

try {
    const a = await player("A", hostUrl);
    const b = await player("B", plain);
    await a.evaluate(() => localStorage.setItem("dw.mp.name", "Ken"));
    await b.evaluate(() => localStorage.setItem("dw.mp.name", "Ana"));

    // the panel opens with F4 and starts in the "not connected" state
    await a.keyboard.press("F4");
    ok("F4 opens the panel", await a.evaluate(() => !document.getElementById("mp-panel").hidden));

    // typing in the panel did not move the character
    const before = await a.evaluate(() => [window.__state.x, window.__state.y]);
    await a.focus("#mp-name");
    for (const k of ["a", "s", "d", "w", "ArrowLeft", "ArrowUp"]) await a.keyboard.press(k);
    const after = await a.evaluate(() => [window.__state.x, window.__state.y]);
    ok("typing in the panel does not walk the character", before[0] === after[0] && before[1] === after[1], `${before} -> ${after}`);

    // A creates a room by clicking the real button; B joins by typing the code
    await a.fill("#mp-name", "Ken");
    await a.click("#mp-host");
    await a.waitForFunction(() => window.__mp.mp.status === "online", null, { timeout: 8000 });
    const room = await a.evaluate(() => window.__mp.mp.room);
    ok("a five-character room code is shown", /^[A-Z0-9]{5}$/.test(room) && (await a.textContent("#mp-code")) === room, room);

    await b.keyboard.press("F4");
    await b.fill("#mp-name", "Ana");
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
    ok("B sees A's ghost by name", ghost.name === "Ken", ghost.name);
    ok("the ghost is where A stands", Math.abs(ghost.x - where[0]) <= 2 && Math.abs(ghost.y - where[1]) <= 2, `${ghost.x},${ghost.y} vs ${where}`);
    ok("and faces the way A faces", ghost.dir === "left", ghost.dir);

    // an emote travels too
    await a.evaluate(() => window.__mp.sendEmote(1));
    await b.waitForFunction(() => window.__mp.ghosts(window.__state.manifest.maps[window.__state.mapIdx].id)[0]?.emote === "!", null, { timeout: 3000 });
    ok("an emote shows over the ghost", true);
    if (SHOTS) await b.screenshot({ path: `${SHOTS}/multiplayer-b.png` });

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
} finally {
    await browser.close();
    await relay.close();
}
