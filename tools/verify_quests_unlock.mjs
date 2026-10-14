// Browser test: quests are on by default (F3), unlock as you play, are handed out and taken back by real NPCs through the GAME'S OWN
// conversation box and list widget, and wanted-board jobs are generated and scale with the party.
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
  await ev('[...document.querySelectorAll("button")].find(b=>/Authentic PS1/.test(b.textContent))?.click()'); await sleep(3500);
};
const VK = { Enter: 13, F3: 114, ArrowUp: 38, ArrowDown: 40 };
const key = async (k) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: VK[k] }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: VK[k] }); await sleep(450); };
const ok = (name, cond, extra = "") => console.log(cond ? "PASS" : "FAIL", name, extra);
const boxOpen = () => ev("window.__textbox.isOpen()");          // either box (the game falls back to its older one if the data cannot load)
const nativeOpen = () => ev("window.__dialogueBox.isOpen()");
const choiceOpen = () => ev("window.__choice.isOpen()");
const waitBox = async () => { for (let i = 0; i < 20; i++) { if (await boxOpen()) return true; await sleep(400); } return false; };
const advance = async () => { for (let i = 0; i < 20 && (await boxOpen()); i++) { await key("Enter"); await sleep(500); } };   // real key presses, page by page
const titles = () => ev(`JSON.stringify(window.__quests.entries().map(e=>e.title))`);
const waitNpc = async (npcId) => { for (let i = 0; i < 40; i++) { if (await ev(`window.__npcsHere().some(n=>n.npc_id===${npcId})`)) return true; await sleep(400); } return false; };   // a map can take a few seconds to place its characters
const stand = (npcId, dx = 0, dy = 28) => ev(`(()=>{const r=window.__npcsHere().find(n=>n.npc_id===${npcId}); if(!r) return false; const s=window.__state; s.x=r.x+(${dx}); s.y=r.y+(${dy}); s.dir="up"; return true;})()`);

for (let attempt = 0; attempt < 6; attempt++) {
  await boot("s330");
  await ev(`localStorage.clear()`);
  await boot("s330");
  if ((await ev(`Object.keys(window.__quests.state.done).length`)) === 0 && (await ev(`window.__npcsHere().some(n=>n.npc_id===27)`)) === true) break;
  await sleep(1500);
}
// ---- on by default; the log is the game's own list
ok("quests are on by default (no F2 step)", (await ev("window.__fx.quests")) !== false);
ok("there is no page-level quest button or panel any more", (await ev(`!document.getElementById("quest-btn") && !document.getElementById("quest-panel") && !document.getElementById("quest-dlg")`)) === true);
await key("F3"); await sleep(400);
ok("F3 opens the log as the game's own choice list", (await ev(`window.__quests.isLogOpen() && window.__choice.isOpen()`)) === true, await ev(`window.__choice.prompt + " | " + window.__choice.options.join(" / ")`));
await key("ArrowUp"); await key("Enter"); await sleep(300);          // wraps to "Close"
ok("Close closes it", (await ev(`!window.__quests.isLogOpen() && !window.__choice.isOpen()`)) === true);

// ---- unlocking
let t = await titles();
ok("the first quest is there; later ones are not", t.includes("Central Park pest control") && !t.includes("Card ladder: first steps") && !t.includes("Arena qualifiers") && !t.includes("Seiryu's rematch") && !t.includes("Circuit Board cartographer") && !t.includes("Wire Forest survey"), t);
await ev(`import("/gameEvents.js").then(m=>m.emit("cardDuelEnded",{won:true}))`); await sleep(300);
t = await titles();
ok("winning a card duel unlocks the card ladder", t.includes("Card ladder: first steps"), t);
ok("and it was announced once", (await ev(`window.__quests.state.announced.card_ladder_1`)) === 1);

// ---- Leomon hands out a quest, through the game's own box
ok("the first job is not taken from the log: Leomon hands it out", (await ev(`window.__quests.accept("park_pest_control")`)) === false);
ok("Leomon is standing in the park", await stand(27));
await key("Enter"); await waitBox();
ok("a fresh game: talking to Leomon offers the park job in the game's box", /Kunemon/.test(await ev(`window.__textbox.dialogue.pages.flat().join(" ")`)) && (await nativeOpen()) === true);
await advance();
await key("Enter"); await sleep(400);
ok("the park job is accepted through him", (await ev(`window.__quests.status("park_pest_control")`)) === "active");
for (let i = 0; i < 3; i++) await ev(`import("/gameEvents.js").then(m=>m.emit("battleWon",{enemies:["Kunemon"],mapId:"s330",screenId:1}))`);
await ev(`window.__quests.claim("park_pest_control", true)`);
ok("done; the survey is now offered", (await ev(`window.__quests.status("forest_gate_survey")`)) === "available");
ok("...but it cannot be taken from the log", (await ev(`window.__quests.accept("forest_gate_survey")`)) === false);
ok("Leomon is standing in the park", await stand(27));
const pos0 = await ev(`[window.__state.x, window.__state.y]`);
await key("Enter"); await sleep(1500);
ok("talking to Leomon opens the GAME'S translated conversation box", (await nativeOpen()) === true, await ev(`JSON.stringify(window.__dialogueBox.diagnostics().painted)`));
ok("it is the game's translated box showing the quest's line, with Leomon's name", /Leomon/.test(await ev(`JSON.stringify(window.__dialogueBox.diagnostics().painted)`)) && (await ev(`window.__dialogueBox.diagnostics().state.child`)) === "dialogue balloon");
ok("the line is the one written for the quest", /keeping the park clear/.test(await ev(`window.__textbox.dialogue.pages.flat().join(" ")`)));
await advance();
ok("after the last page the game's yes/no list asks", (await choiceOpen()) === true && (await ev(`window.__choice.options.join("|")`)) === "I will do it|Not now", await ev(`window.__choice.prompt`));
await key("Enter"); await sleep(400);
ok("accepted through Leomon", (await ev(`window.__quests.status("forest_gate_survey")`)) === "active");
ok("everything closed and the player did not move", !(await boxOpen()) && !(await choiceOpen()) && JSON.stringify(await ev(`[window.__state.x, window.__state.y]`)) === JSON.stringify(pos0));
await ev(`window.__quests.bump("visit", () => true)`);
ok("both places seen: ready, but it must be reported", (await ev(`window.__quests.status("forest_gate_survey")`)) === "ready" && (await ev(`window.__quests.claim("forest_gate_survey")`)) === false);
const bits0 = await ev("window.__state.bits");
await stand(27); await key("Enter"); await sleep(1500); await advance(); await sleep(500);
ok("reporting to Leomon pays the reward once", (await ev(`window.__quests.status("forest_gate_survey")`)) === "done" && (await ev("window.__state.bits")) === bits0 + 200, `(bits ${bits0} -> ${await ev("window.__state.bits")})`);

// ---- the log: details come through the game's own system window
await key("F3"); await sleep(400);
ok("the log lists the quests with their state, four to a page", /Central Park pest control/.test(await ev(`window.__choice.options.join("|")`)) && /More \(1\/2\)/.test(await ev(`window.__choice.options.join("|")`)), await ev(`window.__choice.options.join(" / ")`));
await key("Enter"); await sleep(1500);
ok("choosing one shows its details in the game's conversation box (system window)", (await boxOpen()) === true && /Reward/.test(await ev(`window.__textbox.dialogue.pages.flat().join(" ")`)));
await advance(); await sleep(400);
await key("ArrowUp"); await key("Enter"); await sleep(300);
if (await ev(`window.__quests.isLogOpen()`)) { await key("ArrowUp"); await key("Enter"); await sleep(300); }
ok("and the log can be left again", (await ev(`!window.__quests.isLogOpen() && !window.__choice.isOpen() && !window.__dialogueBox.isOpen()`)) === true);

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
ok("Takato is standing in that city", await waitNpc(179));
await ev(`window.__state.party = ["p008giru"]`); await sleep(1800);
ok("meeting him unlocks it", (await ev(`window.__quests.status("guilmon_lost_tamer")`)) === "available", await ev(`JSON.stringify(window.__quests.state.met)`));
await ev(`window.__quests.accept("guilmon_lost_tamer")`);
ok("accepted from the log", (await ev(`window.__quests.status("guilmon_lost_tamer")`)) === "active");
await boot("s955");
await ev(`window.__state.party = ["p008giru"]`);
ok("Agumon is at the station", await waitNpc(365));
if (await ev(`!window.__quests.state.active.guilmon_lost_tamer`)) await ev(`window.__quests.state.active.guilmon_lost_tamer = { p: [0,0], seen: [[],[]], at: Date.now() }`);
// a jump-in load has no story state, so which Agumon record is standing there varies: call the hook the game calls
await ev(`window.__quests.questTalk(365, "s955"); 0`); await waitBox();
ok("the first clue is spoken by Agumon in the game's box", (await boxOpen()) === true && /Guilmon is looking/.test(await ev(`window.__textbox.dialogue.pages.flat().join(" ")`)));
await advance();
for (let i = 0; i < 20 && (await ev(`window.__quests.state.active.guilmon_lost_tamer.p[0]`)) !== 1; i++) await sleep(300);
ok("that step is ticked", (await ev(`window.__quests.state.active.guilmon_lost_tamer.p[0]`)) === 1);
await boot("s956");
await ev(`window.__quests.questTalk(179, "s956"); 0`); await waitBox();
ok("Takato must be spoken to second: his box opens", (await boxOpen()) === true);
await advance();
for (let i = 0; i < 20 && (await ev(`window.__quests.status("guilmon_lost_tamer")`)) !== "ready"; i++) await sleep(300);
ok("the quest is ready to claim", (await ev(`window.__quests.status("guilmon_lost_tamer")`)) === "ready");
console.log("errors:", errs.join(" | ") || "none");
await ev(`localStorage.removeItem("dw.quests.v1")`);
await fetch("http://127.0.0.1:9333/json/close/" + tab.id);
process.exit(0);
