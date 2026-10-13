// Browser test, phase 3b: the visitSet objective (Circuit Board cartographer, 'Before and after') and the arena qualifiers gauntlet.
// Needs: the game served on PORT (default 8770) and Chrome with --remote-debugging-port=9333 (a separate profile).
// Run:   PORT=8770 node tools/verify_quests_phase3b.mjs

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
  await ev("window.__oldPage = 1");
  await send("Page.navigate", { url: base(map) });
  for (let i = 0; i < 90; i++) { await sleep(300); if (await ev("!window.__oldPage && !!(window.__state && window.__state.started && window.__quests)")) break; }
  await ev('[...document.querySelectorAll("button")].find(b=>/Authentic PS1/.test(b.textContent))?.click()'); await sleep(2500);
};
// enter a map and wait until the quest layer has actually seen it (a big map can take a few seconds to draw its first frame)
const goMap = async (mid) => {            // the game can ignore a map change made while it is still settling: retry until it takes
  for (let attempt = 0; attempt < 4; attempt++) {
    await ev(`(()=>{const s=document.getElementById("mapSelect");s.value="${mid}";s.dispatchEvent(new Event("change",{bubbles:true}))})()`);
    for (let i = 0; i < 20; i++) { await sleep(400); if ((await ev(`window.__quests.where().lastMap`)) === mid) return; }
  }
};
const st = (q) => ev(`window.__quests.status("${q}")`);
const prog = (q) => ev(`JSON.stringify(window.__quests.state.active["${q}"]?.p ?? null)`);
const ok = (name, cond, extra = "") => console.log(cond ? "PASS" : "FAIL", name, extra);

for (let attempt = 0; attempt < 4; attempt++) {     // a previous run's tab can still be rewriting its saved state as it closes: retry until genuinely clean
  await boot("s330");
  await ev(`localStorage.removeItem("dw.quests.v1"); localStorage.removeItem("dw.fx.v1")`);
  await boot("s330");
  if ((await ev(`JSON.stringify(window.__quests.state)`)) === '{"v":1,"active":{},"done":{}}') break;
  await sleep(1500);
}
if ((await ev(`JSON.stringify(window.__quests.state)`)) !== '{"v":1,"active":{},"done":{}}') { console.log("ABORT: dirty start"); process.exit(2); }
await ev(`(()=>{const c=document.querySelector('[data-fx="quests"]');c.checked=true;c.dispatchEvent(new Event("change",{bubbles:true}))})()`);

// ---- cartographer: six DIFFERENT boards (s870 is a variant of s865, s890 of s885: each pair is one place)
ok("accept the cartographer quest", (await ev(`window.__quests.accept("circuit_board_cartographer")`)) === true);
await goMap("s870"); ok("first board charted", (await prog("circuit_board_cartographer")) === "[1]", await prog("circuit_board_cartographer"));
await goMap("s330");
ok("an unrelated map adds nothing", (await prog("circuit_board_cartographer")) === "[1]");
await goMap("s870");
ok("revisiting a charted board adds nothing", (await prog("circuit_board_cartographer")) === "[1]", await prog("circuit_board_cartographer"));
for (const m of ["s875", "s880", "s885"]) await goMap(m);
ok("four distinct boards", (await prog("circuit_board_cartographer")) === "[4]", await prog("circuit_board_cartographer"));
await goMap("s890");
ok("a variant of a charted board (s890 = s885) adds nothing", (await prog("circuit_board_cartographer")) === "[4]", await prog("circuit_board_cartographer"));
await boot("s895");        // a reload: which boards were seen must have been remembered
for (let i = 0; i < 20 && (await prog("circuit_board_cartographer")) !== "[5]"; i++) await sleep(500);
ok("fifth board, after a reload (earlier ones remembered)", (await prog("circuit_board_cartographer")) === "[5]", await prog("circuit_board_cartographer"));
ok("not ready at five", (await st("circuit_board_cartographer")) === "active");
await goMap("s968");
for (let i = 0; i < 20 && (await st("circuit_board_cartographer")) !== "ready"; i++) await sleep(500);
ok("sixth distinct board: ready", (await st("circuit_board_cartographer")) === "ready", await prog("circuit_board_cartographer"));
ok("the seen list persisted", (await ev(`window.__quests.state.active.circuit_board_cartographer.seen[0].length`)) === 6);
const bits0 = await ev("window.__state.bits");
await ev(`window.__quests.claim("circuit_board_cartographer")`); await sleep(300);
ok("pays 700 BIT", (await ev("window.__state.bits")) - bits0 === 700);

// ---- before and after: both versions of the lobby, in either order
ok("accept 'Before and after'", (await ev(`window.__quests.accept("witness_the_change")`)) === true);
await goMap("s210"); ok("Asuka lobby seen", (await prog("witness_the_change")) === "[1]", await prog("witness_the_change"));
await goMap("s210");
ok("the same lobby again adds nothing", (await prog("witness_the_change")) === "[1]");
ok("still active: the changed city has not been seen", (await st("witness_the_change")) === "active");
await goMap("s211");
for (let i = 0; i < 20 && (await st("witness_the_change")) !== "ready"; i++) await sleep(500);
ok("seeing the Amaterasu lobby completes it", (await st("witness_the_change")) === "ready", await prog("witness_the_change"));

// ---- arena qualifiers: accepted at the front desk, fought on the arena floor (a real three-match gauntlet)
await ev(`window.__state.party=[window.__state.manifest.characters[window.__state.charIdx].id]`);
await ev(`(()=>{const s=document.querySelector("#charSelect");const o=[...s.options].find(o=>/^p00[2-9]/.test(o.value));s.value=o.value;s.dispatchEvent(new Event("change",{bubbles:true}));})()`); await sleep(2500);
await ev(`window.__state.party=[window.__state.manifest.characters[window.__state.charIdx].id]`);
await goMap("s232");
ok("away from the front desk: the arena quest is refused", (await ev(`window.__quests.accept("arena_qualifiers")`)) === false);
await goMap("s230");
ok("accepted at the Arena front desk", (await ev(`window.__quests.accept("arena_qualifiers")`)) === true);
await goMap("s232");
ok("begin is allowed on the arena floor", (await ev(`window.__quests.beginChallenge("arena_qualifiers")`)) === true);
await sleep(5000);
const aparty = await ev(`(()=>{const b=window.__battleB&&window.__battleB();return b?JSON.stringify(b.party.map(e=>[e.enemyId,e.enemyLevel,e.enemyHp])):null})()`);
ok("a real three-match gauntlet of rising difficulty", aparty === '[["Woodmon",5,240],["Gekomon",8,312],["Flymon",13,432]]', aparty);

console.log("errors/warnings:", errs.join(" | ") || "none");
await ev(`localStorage.removeItem("dw.quests.v1"); localStorage.removeItem("dw.fx.v1")`);
await fetch("http://127.0.0.1:9333/json/close/" + tab.id); process.exit(0);
