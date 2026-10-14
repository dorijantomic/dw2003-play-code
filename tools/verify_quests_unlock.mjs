// Browser test: quests are on by default with a visible Quests button, unlock as you play, can be run by real NPCs
// (offer, talk steps, report), and wanted-board jobs are generated and scale with the party.
// Needs: the game served on PORT (default 8770) and Chrome with --remote-debugging-port=9333 (a separate, clean profile).
// Run:   PORT=8770 node tools/verify_quests_unlock.mjs

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
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
const boot = async (map) => {
  await ev("window.__oldPage = 1");
  await send("Page.navigate", { url: base(map) });
  for (let i = 0; i < 90; i++) { await sleep(300); if (await ev("!window.__oldPage && !!(window.__state && window.__state.started && window.__quests)")) break; }
  await ev('[...document.querySelectorAll("button")].find(b=>/Authentic PS1/.test(b.textContent))?.click()'); await sleep(2500);
};
const key = async (k, code) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: code || k, windowsVirtualKeyCode: k === "Enter" ? 13 : k === "F3" ? 114 : 0 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: code || k, windowsVirtualKeyCode: k === "Enter" ? 13 : k === "F3" ? 114 : 0 }); await sleep(250); };
const ok = (name, cond, extra = "") => console.log(cond ? "PASS" : "FAIL", name, extra);
const titles = () => ev(`(()=>{const p=document.getElementById("quest-panel"); const was=p.hidden; if(was) window.__quests.togglePanel(true); const t=[...p.querySelectorAll(".qc b")].map(b=>b.textContent); if(was) window.__quests.togglePanel(false); return JSON.stringify(t)})()`);
const stand = (npcId, dx = 0, dy = 28) => ev(`(()=>{const r=window.__npcsHere().find(n=>n.npc_id===${npcId}); if(!r) return false; const s=window.__state; s.x=r.x+(${dx}); s.y=r.y+(${dy}); s.dir="up"; return true;})()`);

for (let attempt = 0; attempt < 6; attempt++) {
  await boot("s330");
  await ev(`localStorage.clear()`);
  await boot("s330");
  if ((await ev(`window.__quests.state.done && Object.keys(window.__quests.state.done).length`)) === 0 && (await ev(`window.__npcsHere().some(n=>n.npc_id===27)`)) === true) break;
  await sleep(1500);
}
// ---- on by default, with a button
ok("quests are on by default (no F2 step)", (await ev("window.__fx.quests")) !== false);
ok("a Quests button is on the screen", (await ev(`!!document.getElementById("quest-btn") && document.getElementById("quest-btn").hidden === false`)) === true);
await ev(`document.getElementById("quest-btn").click()`); await sleep(300);
ok("the button opens the log", (await ev(`document.getElementById("quest-panel").hidden`)) === false);
await ev(`document.getElementById("quest-btn").click()`);
await key("F3"); ok("F3 still opens it", (await ev(`document.getElementById("quest-panel").hidden`)) === false); await key("F3");

// ---- unlocking
let t = await titles();
ok("the first quest is there; later ones are not", t.includes("Central Park pest control") && !t.includes("Card ladder: first steps") && !t.includes("Arena qualifiers") && !t.includes("Seiryu's rematch") && !t.includes("Circuit Board cartographer") && !t.includes("Wire Forest survey"), t);
await ev(`import("/gameEvents.js").then(m=>m.emit("cardDuelEnded",{won:true}))`); await sleep(300);
ok("the button shows something new", /\d/.test(await ev(`document.getElementById("quest-btn").textContent`)), await ev(`document.getElementById("quest-btn").textContent`));
t = await titles();
ok("winning a card duel unlocks the card ladder", t.includes("Card ladder: first steps"), t);
ok("looking at the log clears the badge", !/\d/.test(await ev(`document.getElementById("quest-btn").textContent`)));

// ---- an NPC hands out a quest (Leomon, Central Park)
await ev(`document.querySelector('[data-q="accept:park_pest_control"]')?.click(); window.__quests.togglePanel(true); document.querySelector('[data-q="accept:park_pest_control"]')?.click(); window.__quests.togglePanel(false)`);
ok("the park job is accepted", (await ev(`window.__quests.status("park_pest_control")`)) === "active");
for (let i = 0; i < 3; i++) await ev(`import("/gameEvents.js").then(m=>m.emit("battleWon",{enemies:["Kunemon"],mapId:"s330",screenId:1}))`);
await ev(`window.__quests.claim("park_pest_control")`);
ok("done; the survey is now offered", (await ev(`window.__quests.status("forest_gate_survey")`)) === "available");
ok("...but it cannot be taken from the log", (await ev(`window.__quests.accept("forest_gate_survey")`)) === false);
ok("Leomon is standing in the park", await stand(27));
await key("Enter"); await sleep(300);
ok("talking to Leomon opens the quest dialogue", (await ev(`document.getElementById("quest-dlg").hidden`)) === false, await ev(`document.getElementById("quest-dlg").textContent.slice(0,80)`));
const pos0 = await ev(`[window.__state.x, window.__state.y]`);
await key("Enter"); await key("Enter"); await sleep(200);
ok("the offer asks yes or no", (await ev(`document.querySelectorAll("#quest-dlg .dc button").length`)) === 2);
await key("Enter"); await sleep(300);
ok("accepted through Leomon", (await ev(`window.__quests.status("forest_gate_survey")`)) === "active");
ok("the dialogue closed and the player did not move", (await ev(`document.getElementById("quest-dlg").hidden`)) === true && JSON.stringify(await ev(`[window.__state.x, window.__state.y]`)) === JSON.stringify(pos0));
await ev(`window.__quests.bump("visit", () => true)`);
ok("both places seen: ready, but it must be reported", (await ev(`window.__quests.status("forest_gate_survey")`)) === "ready" && (await ev(`window.__quests.claim("forest_gate_survey")`)) === false);
const bits0 = await ev("window.__state.bits");
await stand(27); await key("Enter"); await sleep(200); await key("Enter"); await key("Enter"); await sleep(400);
ok("reporting to Leomon pays the reward once", (await ev(`window.__quests.status("forest_gate_survey")`)) === "done" && (await ev("window.__state.bits")) === bits0 + 200, `(bits ${bits0} -> ${await ev("window.__state.bits")})`);

// ---- wanted-board jobs scale with the party
const gen = (lvl, n) => ev(`JSON.stringify(window.__quests.generateBounty(["s330","s445","s400"], ${lvl}, ${n}, window.__quests.roam))`);
const lo = JSON.parse(await gen(1, 0)), hi = JSON.parse(await gen(30, 0)), again = await gen(1, 0);
ok("a job is generated from places you have been", lo && lo.objectives[0].type === "defeat" && lo.objectives[0].maps.length === 1, lo && lo.title);
ok("the same inputs give the same job", JSON.stringify(lo) === again);
ok("a stronger party gets bigger jobs and rewards", hi.reward.bits > lo.reward.bits && hi.objectives[0].count >= lo.objectives[0].count, `(${lo.reward.bits} BIT x${lo.objectives[0].count} -> ${hi.reward.bits} BIT x${hi.objectives[0].count})`);
const elite = JSON.parse(await gen(30, 2));
ok("every third job is an elite hunt that scales", elite.objectives[0].type === "challenge" && elite.objectives[0].scale > 16, JSON.stringify(elite.objectives[0]));
ok("no job without two places to hunt", (await ev(`window.__quests.generateBounty(["s330"], 5, 0, window.__quests.roam)`)) === null);
await boot("s445");
ok("with two hunting grounds visited the game offers a Wanted-board job", (await ev(`window.__quests.state.gen.def && window.__quests.state.gen.def.generated === true`)) === true, await ev(`window.__quests.state.gen.def && window.__quests.state.gen.def.title`));

// ---- a story character unlocks a quest only after you have met them
await ev(`window.__state.party = ["p008giru"]`);
ok("Guilmon's quest is hidden until you have met Takato", (await ev(`window.__quests.status("guilmon_lost_tamer")`)) === "locked");
await boot("s956");
ok("Takato is standing in that city", (await ev(`window.__npcsHere().some(n=>n.npc_id===179)`)) === true);
await ev(`window.__state.party = ["p008giru"]`); await sleep(1800);
ok("meeting him unlocks it", (await ev(`window.__quests.status("guilmon_lost_tamer")`)) === "available", await ev(`JSON.stringify(window.__quests.state.met)`));
await ev(`window.__quests.accept("guilmon_lost_tamer")`);
ok("accepted from the log", (await ev(`window.__quests.status("guilmon_lost_tamer")`)) === "active");
await boot("s955");
await ev(`window.__state.party = ["p008giru"]`);
ok("Agumon is at the station", (await ev(`window.__npcsHere().some(n=>n.npc_id===365)`)) === true);
await ev(`window.__quests.state.active.guilmon_lost_tamer ??= null`);
if (await ev(`!window.__quests.state.active.guilmon_lost_tamer`)) { await ev(`window.__quests.state.active.guilmon_lost_tamer = { p: [0,0], seen: [[],[]], at: Date.now() }`); }
// a jump-in load has no story state, so which Agumon record is standing there varies: call the hook the game calls
await ev(`window.__quests.questTalk(365, "s955")`); await sleep(300);
ok("the first clue is spoken by Agumon", /Guilmon is looking/.test(await ev(`document.getElementById("quest-dlg").textContent`)), await ev(`document.getElementById("quest-dlg").textContent.slice(0,60)`));
await key("Enter"); await key("Enter"); await sleep(300);
ok("that step is ticked", (await ev(`window.__quests.state.active.guilmon_lost_tamer.p[0]`)) === 1);
await boot("s956");
await ev(`window.__quests.questTalk(179, "s956")`); await sleep(300);
ok("Takato must be spoken to second: dialogue opens", (await ev(`document.getElementById("quest-dlg").hidden`)) === false);
await key("Enter"); await key("Enter"); await sleep(300);
ok("the quest is ready to claim", (await ev(`window.__quests.status("guilmon_lost_tamer")`)) === "ready");
console.log("errors:", errs.join(" | ") || "none");
await ev(`localStorage.removeItem("dw.quests.v1")`);
await fetch("http://127.0.0.1:9333/json/close/" + tab.id);
process.exit(0);
