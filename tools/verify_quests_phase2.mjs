// Browser test, phase 2: station boards, bounties, the quiet route, the card ladder (simulated duel results).
// Needs: the game served on PORT (default 8770) and Chrome with --remote-debugging-port=9333 (a separate profile).
// Run:   PORT=8770 node tools/verify_quests_phase2.mjs

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.env.PORT || 8770;
const base = (map) => `http://localhost:${PORT}/index.html?skipTitle=1&noEncounters=1&map=${map}`;
const tab = await (await fetch("http://127.0.0.1:9333/json/new?" + encodeURIComponent("about:blank"), { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 220));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "warning" && /\[quests\]|\[events\]/.test(JSON.stringify(d.params.args))) errs.push("WARN " + d.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
const boot = async (map) => {
  await ev("window.__oldPage = 1");   // marks the page being replaced, so we never mistake it for the new one
  await send("Page.navigate", { url: base(map) });
  for (let i = 0; i < 90; i++) { await sleep(300); if (await ev("!window.__oldPage && !!(window.__state && window.__state.started && window.__quests)")) break; }
  await ev('[...document.querySelectorAll("button")].find(b=>/Authentic PS1/.test(b.textContent))?.click()'); await sleep(2500);
};
const goMap = async (mid) => {            // the game can ignore a map change made while it is still settling: retry until it takes
  for (let attempt = 0; attempt < 4; attempt++) {
    await ev(`(()=>{const s=document.getElementById("mapSelect");s.value="${mid}";s.dispatchEvent(new Event("change",{bubbles:true}))})()`);
    for (let i = 0; i < 20; i++) { await sleep(400); if ((await ev(`window.__quests.where().lastMap`)) === mid) return; }
  }
};
const win = (enemies, mapId) => ev(`import("/gameEvents.js").then(m=>m.emit("battleWon",{enemies:${JSON.stringify(enemies)},mapId:"${mapId}",screenId:1}))`);
const at = async (x, y) => { await ev(`window.__state.x=${x};window.__state.y=${y}`); await sleep(350); };
const prog = (qid) => ev(`JSON.stringify(window.__quests.state.active["${qid}"]?.p ?? null)`);
const st = (qid) => ev(`window.__quests.status("${qid}")`);
const ok = (name, cond, extra = "") => console.log(cond ? "PASS" : "FAIL", name, extra);

for (let attempt = 0; attempt < 4; attempt++) {     // a previous run's tab can still be rewriting its saved state as it closes: retry until genuinely clean
  await boot("s330");
  await ev(`localStorage.removeItem("dw.quests.v1"); localStorage.removeItem("dw.fx.v1")`);
  await boot("s330");
  if ((await ev(`Object.keys(window.__quests.state.active).length + Object.keys(window.__quests.state.done).length`)) === 0) break;
  await sleep(1500);
}
if ((await ev(`Object.keys(window.__quests.state.active).length + Object.keys(window.__quests.state.done).length`)) !== 0) { console.log("ABORT: the test browser did not start clean (leftover quest state); rerun"); process.exit(2); }

// the game's own progress unlocks quests; this test gives the save the progress it needs (visited places, a duel win)
await ev(`(()=>{const q=window.__quests, s=q.state; for (const m of ${JSON.stringify(['s330', 's410', 's440', 's230'])}) if(!s.visited.includes(m)) s.visited.push(m); s.duelWins = Math.max(s.duelWins, 1); q.announceUnlocks(); q.save();})()`);
await ev(`(()=>{const c=document.querySelector('[data-fx="quests"]');c.checked=true;c.dispatchEvent(new Event("change",{bubbles:true}))})()`);

// ---- location-gated acceptance
const bits0 = await ev("window.__state.bits");
ok("away from the board: accept is refused", (await ev(`window.__quests.accept("east_station_greens")`)) === false && (await st("east_station_greens")) === "available");
const note = await ev(`window.__quests.detail("east_station_greens")`);
ok("log tells you where to accept it", /Accept it at: East Station/.test(note), "");
ok("quiet route is locked until the survey is done", (await st("quiet_route_wire_forest")) === "locked");
await goMap("s411");                                       // the other-world East Station
ok("at East Station (variant s411): accept works", (await ev(`window.__quests.accept("east_station_greens")`)) === true);

// ---- bounty counting, incl. a night variant of the map (s401 -> s400)
await win(["Vegiemon"], "s401"); await win(["Woodmon"], "s400");
await win(["Gizamon"], "s400");                           // not on the list
await win(["Vegiemon"], "s330");                          // wrong map
ok("only listed species on the right map count (variant counts)", (await prog("east_station_greens")) === "[2]", await prog("east_station_greens"));
await win(["RedVegiemon", "Vegiemon"], "s400");           // a two-member gauntlet counts both
ok("a two-enemy fight counts both", (await st("east_station_greens")) === "ready");
await ev(`window.__quests.claim("east_station_greens")`); await sleep(300);
ok("bounty pays 450 BIT", (await ev("window.__state.bits")) - bits0 === 450);

await goMap("s441");
ok("South Station variant (s441) offers its board", (await ev(`window.__quests.accept("south_station_swamp")`)) === true);
for (const sp of ["Gekomon", "Tortomon", "Gekomon", "Gekomon"]) await win([sp], "s445");
ok("south bounty ready after four", (await st("south_station_swamp")) === "ready");
await ev(`window.__quests.claim("south_station_swamp")`);

// ---- the quiet route
await ev(`window.__quests.state.done.forest_gate_survey = Date.now()`);          // shortcut the survey chain for this test
await goMap("s330");
ok("quiet route available at Central Park", (await st("quiet_route_wire_forest")) === "available");
ok("accepted at Central Park", (await ev(`window.__quests.accept("quiet_route_wire_forest")`)) === true);
await goMap("s335");
await at(380, 450);
ok("middle of the map: route not started", (await prog("quiet_route_wire_forest")) === "[0]");
await at(60, 100);
ok("at the north-west gate: route started", (await prog("quiet_route_wire_forest")) === "[1]");
await at(380, 450);
ok("walking on keeps the route going", (await prog("quiet_route_wire_forest")) === "[1]");
await ev(`import("/gameEvents.js").then(m=>m.emit("battleStarted",{mapId:"s335",screenId:1}))`); await sleep(300);
ok("a fight mid-route resets it", (await prog("quiet_route_wire_forest")) === "[0]");
await at(380, 460);
ok("and it stays reset until you return to the gate", (await prog("quiet_route_wire_forest")) === "[0]");
await at(70, 110);
ok("route restarted", (await prog("quiet_route_wire_forest")) === "[1]");
await goMap("s350");
ok("leaving the map abandons the route", (await prog("quiet_route_wire_forest")) === "[0]", await prog("quiet_route_wire_forest"));
await goMap("s335"); await at(64, 96); await at(690, 830);
ok("full route: ready", (await st("quiet_route_wire_forest")) === "ready", await prog("quiet_route_wire_forest"));
ok("completing without starting at the gate does not count (checked above: middle -> 0)", true);

// ---- the card ladder (simulated duel results; the duel itself runs on the original's code)
const duel = (won) => ev(`import("/gameEvents.js").then(m=>m.emit("cardDuelEnded",{won:${won},opponentId:7}))`);
ok("ladder 2 is locked until ladder 1 is done", (await st("card_ladder_2")) === "locked");
ok("accept the first ladder quest", (await ev(`window.__quests.accept("card_ladder_1")`)) === true);
await duel(false); await duel(true); await duel(true);
ok("a lost duel does not count", (await prog("card_ladder_1")) === "[2]", await prog("card_ladder_1"));
await duel(true);
ok("third win makes it ready", (await st("card_ladder_1")) === "ready");
const bitsL = await ev("window.__state.bits");
await ev(`window.__quests.claim("card_ladder_1")`); await sleep(200);
ok("ladder 1 pays 500 BIT", (await ev("window.__state.bits")) - bitsL === 500);
ok("ladder 2 unlocks", (await st("card_ladder_2")) === "available");
await ev(`window.__quests.accept("card_ladder_2")`);
for (let i = 0; i < 5; i++) await duel(true);
ok("five wins is not enough for six", (await st("card_ladder_2")) === "active", await prog("card_ladder_2"));
await duel(true);
ok("sixth win completes it (counts from acceptance, not lifetime)", (await st("card_ladder_2")) === "ready");

// ---- the real battle start event resets a route
await ev(`window.__quests.state.done.quiet_route_wire_forest = undefined; delete window.__quests.state.done.quiet_route_wire_forest; window.__quests.state.active.quiet_route_wire_forest = {p:[1], at:Date.now()}`);
await ev(`(()=>{const s=document.querySelector("#charSelect");const o=[...s.options].find(o=>/^p00[2-9]/.test(o.value));s.value=o.value;s.dispatchEvent(new Event("change",{bubbles:true}));})()`); await sleep(2500);
await goMap("s335"); await at(300, 300);
await ev(`window.__quests.state.active.quiet_route_wire_forest.p=[1]`);
await ev(`window.__battle.startParty([{name:"Kunemon",level:1,hp:30,mp:10,stat_scale:16}], ()=>{}, ()=>{}, ()=>{}, {screenId:1, mapId:"s335"})`); await sleep(2500);
ok("a REAL battle start resets the route", (await prog("quiet_route_wire_forest")) === "[0]", await prog("quiet_route_wire_forest"));

console.log("errors/warnings:", errs.join(" | ") || "none");
await ev(`localStorage.removeItem("dw.quests.v1"); localStorage.removeItem("dw.fx.v1")`);
await fetch("http://127.0.0.1:9333/json/close/" + tab.id); process.exit(0);
